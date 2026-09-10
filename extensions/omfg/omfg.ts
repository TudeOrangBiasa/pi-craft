import type {
  ExtensionAPI,
  ExtensionCommandContext,
  MessageUpdateEvent,
  MessageEndEvent,
  ToolResultEvent,
  ToolCallEvent,
  ContextEvent,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import { guidanceDir, guidanceNotice, loadGuidanceDir, matchGuidance } from "./guidance.js";
import type { GuidanceRule } from "./guidance.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// TTSR - Time Travelling Stream Rules
//
// Governs the token/tool stream with named rules, and can re-apply a rule to
// the conversation history via session-tree time-travel.
//
// Scopes (enforcement points):
//   live    -> message_update / tool_execution_update (mutate the stream)
//   post    -> message_end / tool_result (replace the finalized message/result)
//   context -> context event (rewrite history before each LLM call)
//
// Time-travel: `apply <rule> --from <msgId>` attaches the rule to the session
// context and rewinds the session tree to <msgId> via ctx.navigateTree. Pi
// sessions are append-only (no public in-place entry edit), so past entries are
// not edited in place; instead the rule governs the history the model re-reads
// when you continue from the rewound point. `apply` without --from attaches
// without rewinding.
// ---------------------------------------------------------------------------

export type ScopeStage = "live" | "post" | "context";
export type RuleType = "redact" | "replace" | "gate" | "inject" | "transform";

export interface Rule {
  name: string;
  type: RuleType;
  scope: ScopeStage[];
  enabled?: boolean;
  pattern?: string;
  flags?: string;
  replacement?: string;
  position?: "prefix" | "suffix";
  text?: string;
  transform?: string;
  gateMessage?: string;
}

// Local view of a Pi message. Pi's AgentMessage is structurally compatible;
// we cast at the event boundary (see asChatMessage) rather than re-declare the
// whole union.
interface TextBlock {
  type: "text";
  text: string;
}
interface OtherBlock {
  type: string;
  [key: string]: unknown;
}
type ContentBlock = TextBlock | OtherBlock;
interface ChatMessage {
  content: ContentBlock[];
  [key: string]: unknown;
}

// Single source of truth for the persisted rules path (~/.config/omfg/rules.json,
// XDG_CONFIG_HOME-aware).
function rulesFile(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const dir = xdg ? join(xdg, "omfg") : join(homedir(), ".config", "omfg");
  return join(dir, "rules.json");
}

export let rules: Rule[] = [];
function isValidRule(r: unknown): r is Rule {
  if (!r || typeof r !== "object") return false;
  const v = r as Record<string, unknown>;
  const types = ["redact", "replace", "gate", "inject", "transform"];
  const stages = ["live", "post", "context"];
  return (
    typeof v.name === "string" &&
    v.name.length > 0 &&
    typeof v.type === "string" &&
    types.includes(v.type) &&
    Array.isArray(v.scope) &&
    v.scope.length > 0 &&
    (v.scope as unknown[]).every((s) => typeof s === "string" && stages.includes(s)) &&
    (v.enabled === undefined || typeof v.enabled === "boolean")
  );
}
function loadRules(): void {
  try {
    const p = rulesFile();
    if (!existsSync(p)) {
      rules = [];
      return;
    }
    const data = JSON.parse(readFileSync(p, "utf-8"));
    const loaded: unknown[] = Array.isArray(data?.rules) ? data.rules : [];
    // Drop hand-edited shape-invalid entries instead of throwing per-event.
    rules = loaded.filter(isValidRule).map((r) => ({ ...r, enabled: r.enabled ?? true }));
  } catch {
    rules = [];
  }
}
function saveRules(): void {
  try {
    const p = rulesFile();
    const dir = p.slice(0, p.lastIndexOf("/"));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify({ rules }, null, 2), "utf-8");
  } catch {
    // non-fatal: in-memory state still works for the session
  }
}

// Rules attached to the current session via `apply` (transient; lost on reload).
const appliedRules = new Set<string>();

const regexCache = new Map<string, RegExp>();
function compile(pattern: string, flags?: string): RegExp | null {
  const key = `${pattern} ${flags || ""}`;
  let re = regexCache.get(key);
  if (!re) {
    try {
      re = new RegExp(pattern, flags || "g");
    } catch {
      return null;
    }
    regexCache.set(key, re);
  }
  return re;
}

function doTransform(text: string, kind?: string): string {
  switch (kind) {
    case "trim":
      return text.trim();
    case "collapse-ws":
      return text.replace(/\s+/g, " ").trim();
    case "strip-ansi":
      // All CSI sequences (not just SGR colors) + OSC hyperlinks.
      return text
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    case "no-emoji":
      return text.replace(
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{E000}-\u{F8FF}\u{1F1E6}-\u{1F1FF}]/gu,
        "",
      );
    case "lowercase":
      return text.toLowerCase();
    case "uppercase":
      return text.toUpperCase();
    default:
      return text;
  }
}

// A rule applies to a stage if enabled and (scope includes stage, or it was
// session-applied via `apply` for the context stage).
function ruleApplies(r: Rule, stage: ScopeStage): boolean {
  if (!r.enabled) return false;
  if (stage === "context") return r.scope.includes("context") || appliedRules.has(r.name);
  return r.scope.includes(stage);
}

// Apply all enabled rules of a stage to one string, in deterministic type order
// so redact/replace run before inject/gate.
export function applyTextRules(text: string, stage: ScopeStage): string {
  if (!text) return text;
  const order: RuleType[] = ["redact", "replace", "transform", "inject", "gate"];
  for (const type of order) {
    for (const r of rules) {
      if (!ruleApplies(r, stage) || r.type !== type) continue;
      try {
        switch (type) {
          case "redact":
          case "replace": {
            if (!r.pattern) break;
            const re = compile(r.pattern, r.flags);
            if (!re) break;
            text = text.replace(re, () => r.replacement ?? (type === "redact" ? "***" : ""));
            break;
          }
          case "transform":
            text = doTransform(text, r.transform);
            break;
          case "inject":
            if (r.position === "suffix") text = text + (r.text ?? "");
            else text = (r.text ?? "") + text;
            break;
          case "gate":
            if (r.pattern) {
              const re = compile(r.pattern, r.flags);
              // Cached regexes carry the `g` flag: reset lastIndex or
              // consecutive .test() calls flip-flop true/false.
              if (re) re.lastIndex = 0;
              if (re?.test(text)) {
                text = r.gateMessage ?? `[blocked by TTSR rule '${r.name}']`;
              }
            }
            break;
        }
      } catch {
        // skip broken rule, keep going
      }
    }
  }
  return text;
}

function transformBlocks(
  blocks: ContentBlock[],
  stage: ScopeStage,
): { blocks: ContentBlock[]; changed: boolean } {
  let changed = false;
  const out = blocks.map((b) => {
    if (b.type !== "text") return b;
    const text: unknown = b.text;
    if (typeof text !== "string") return b;
    const t = applyTextRules(text, stage);
    if (t !== text) {
      changed = true;
      return { ...b, text: t };
    }
    return b;
  });
  return { blocks: out, changed };
}
function transformMessage(msg: ChatMessage, stage: ScopeStage): ChatMessage {
  if (!Array.isArray(msg.content)) return msg;
  const { blocks, changed } = transformBlocks(msg.content, stage);
  return changed ? { ...msg, content: blocks } : msg;
}

function stageHasRules(stage: ScopeStage): boolean {
  return rules.some((r) => ruleApplies(r, stage));
}

// Pi's AgentMessage is structurally a superset of ChatMessage; cast at the
// boundary. This is the one place we cross the external-message-shape line.
function asChatMessage(m: AgentMessage): ChatMessage {
  return m as unknown as ChatMessage;
}
function asAgentMessage(m: ChatMessage): AgentMessage {
  return m as unknown as AgentMessage;
}
function asBlocks(blocks: (TextContent | ImageContent)[]): ContentBlock[] {
  return blocks as unknown as ContentBlock[];
}

// ---------------------------------------------------------------------------
// Command surface
// ---------------------------------------------------------------------------

function tokenize(input: string): string[] {
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

interface ParsedArgs {
  positional: string[];
  opts: Record<string, string | boolean>;
}
function parseArgs(tokens: string[]): ParsedArgs {
  const positional: string[] = [];
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    } else {
      positional.push(t);
    }
  }
  return { positional, opts };
}

const HELP = `TTSR - Time Travelling Stream Rules

Usage:
  /omfg rule add <type> <name> <pattern> [replacement] [--scope live,post] [--flags g]
  /omfg rule add inject <name> --text "..." [--position prefix|suffix] [--scope live,post]
  /omfg rule add transform <name> --transform <trim|collapse-ws|strip-ansi|no-emoji|lowercase|uppercase> [--scope live,post]
  /omfg rule add gate <name> <pattern> [--message "..."] [--scope post,context]
  /omfg rule list
  /omfg rule rm <name>
  /omfg rule enable <name>  |  /omfg rule disable <name>
  /omfg apply <name> [--from <msgId>]   # time-travel: rewind to msgId and govern history
  /omfg applied                          # list session-applied rules
  /omfg rewind <msgId>                   # navigate session tree to an entry
  /omfg reload                           # re-read rules.json
  /omfg help

Rule types: redact (mask matches), replace (swap matches), gate (block on match),
            inject (prefix/suffix), transform (built-in text transforms).
Scopes: live (streaming), post (finalized message/tool), context (history before LLM call).
Rules persist to ~/.config/omfg/rules.json.`;

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  type: "info" | "warning" | "error" = "info",
): void {
  try {
    ctx.ui.notify(message, type);
  } catch {
    /* no-op */
  }
}

function findRule(name: string): Rule | undefined {
  return rules.find((r) => r.name === name);
}

export async function handleCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const tokens = tokenize(args.trim());
  const [cmd, ...rest] = tokens;
  const { positional, opts } = parseArgs(rest);

  if (!cmd || cmd === "help") {
    notify(ctx, HELP);
    return;
  }

  if (cmd === "reload") {
    loadRules();
    notify(ctx, `Reloaded ${rules.length} rule(s) from disk.`);
    return;
  }

  if (cmd === "applied") {
    const list = [...appliedRules];
    notify(
      ctx,
      list.length ? `Session-applied rules:\n${list.join("\n")}` : "No session-applied rules.",
    );
    return;
  }

  if (cmd === "rewind") {
    const id = positional[0];
    if (!id) {
      notify(ctx, "Usage: /omfg rewind <msgId>", "warning");
      return;
    }
    try {
      await ctx.navigateTree(id, { summarize: false });
      notify(ctx, `Rewound session to ${id}.`);
    } catch (e) {
      notify(ctx, `rewind failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
    return;
  }

  if (cmd === "rule") {
    const sub = positional[0];
    if (!sub || sub === "list") {
      if (rules.length === 0) {
        notify(ctx, "No rules. Add one with /omfg rule add ...");
        return;
      }
      const lines = rules.map((r) => {
        const bits = [
          `${r.enabled ? "on " : "off"} ${r.name}  [${r.type}]  scope=${r.scope.join(",")}`,
        ];
        if (r.pattern) bits.push(` /${r.pattern}/${r.flags || "g"}`);
        if (r.replacement !== undefined) bits.push(` -> ${r.replacement}`);
        if (r.text) bits.push(` text="${r.text}"`);
        if (r.transform) bits.push(` xform=${r.transform}`);
        return bits.join("");
      });
      notify(ctx, `Rules (${rules.length}):\n${lines.join("\n")}`);
      return;
    }
    if (sub === "rm") {
      const name = positional[1];
      if (!name) {
        notify(ctx, "Usage: /omfg rule rm <name>", "warning");
        return;
      }
      const before = rules.length;
      rules = rules.filter((r) => r.name !== name);
      appliedRules.delete(name);
      if (rules.length === before) {
        notify(ctx, `No rule named '${name}'.`, "warning");
        return;
      }
      saveRules();
      notify(ctx, `Removed rule '${name}'.`);
      return;
    }
    if (sub === "enable" || sub === "disable") {
      const name = positional[1];
      const r = findRule(name);
      if (!r) {
        notify(ctx, `No rule named '${name}'.`, "warning");
        return;
      }
      r.enabled = sub === "enable";
      saveRules();
      notify(ctx, `Rule '${name}' ${r.enabled ? "enabled" : "disabled"}.`);
      return;
    }
    if (sub === "add") {
      const type = positional[1] as RuleType;
      const name = positional[2];
      if (!type || !name) {
        notify(ctx, "Usage: /omfg rule add <type> <name> ...", "warning");
        return;
      }
      const scopeRaw = typeof opts.scope === "string" ? opts.scope : "live,post";
      const scope = scopeRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as ScopeStage[];
      const bad = scope.filter((s) => s !== "live" && s !== "post" && s !== "context");
      if (bad.length > 0 || scope.length === 0) {
        notify(ctx, `Bad scope '${scopeRaw}'. Use comma-separated live,post,context.`, "warning");
        return;
      }
      if (findRule(name)) {
        notify(
          ctx,
          `Rule '${name}' already exists. Use a different name or rm it first.`,
          "warning",
        );
        return;
      }
      const rule: Rule = { name, type, scope, enabled: true };
      if (type === "redact" || type === "replace") {
        rule.pattern = positional[3];
        rule.flags = typeof opts.flags === "string" ? opts.flags : "g";
        rule.replacement = positional[4] ?? (type === "redact" ? "***" : "");
        if (!rule.pattern) {
          notify(ctx, `Usage: /omfg rule add ${type} ${name} <pattern> [replacement]`, "warning");
          return;
        }
      } else if (type === "gate") {
        rule.pattern = positional[3];
        rule.flags = typeof opts.flags === "string" ? opts.flags : "g";
        rule.gateMessage = typeof opts.message === "string" ? opts.message : undefined;
        if (!rule.pattern) {
          notify(ctx, `Usage: /omfg rule add gate ${name} <pattern>`, "warning");
          return;
        }
      } else if (type === "inject") {
        rule.text = typeof opts.text === "string" ? opts.text : (positional[3] ?? "");
        rule.position = opts.position === "suffix" ? "suffix" : "prefix";
        if (!rule.text) {
          notify(ctx, `Usage: /omfg rule add inject ${name} --text "..."`, "warning");
          return;
        }
      } else if (type === "transform") {
        rule.transform = typeof opts.transform === "string" ? opts.transform : positional[3];
        const kinds = ["trim", "collapse-ws", "strip-ansi", "no-emoji", "lowercase", "uppercase"];
        if (!rule.transform || !kinds.includes(rule.transform)) {
          notify(
            ctx,
            `Bad transform '${rule.transform ?? ""}'. Use one of: ${kinds.join(", ")}.`,
            "warning",
          );
          return;
        }
      } else {
        const unknownType: string = type;
        notify(ctx, `Unknown rule type '${unknownType}'.`, "warning");
        return;
      }
      rules.push(rule);
      saveRules();
      notify(ctx, `Added rule '${name}' (${type}) scope=${scope.join(",")}.`);
      return;
    }
    notify(ctx, `Unknown rule subcommand '${sub}'.\n${HELP}`, "warning");
    return;
  }

  if (cmd === "apply") {
    const name = positional[0];
    if (!name) {
      notify(ctx, "Usage: /omfg apply <name> [--from <msgId>]", "warning");
      return;
    }
    const r = findRule(name);
    if (!r) {
      notify(ctx, `No rule named '${name}'.`, "warning");
      return;
    }
    if (!r.enabled) {
      notify(ctx, `Rule '${name}' is disabled; enabling it.`, "warning");
      r.enabled = true;
      saveRules();
    }
    const from = typeof opts.from === "string" ? opts.from : undefined;
    if (from) {
      try {
        await ctx.navigateTree(from, { summarize: false });
      } catch (e) {
        notify(
          ctx,
          `navigateTree failed: ${e instanceof Error ? e.message : String(e)} — rule NOT applied.`,
          "error",
        );
        return;
      }
      appliedRules.add(name);
      notify(
        ctx,
        `Time-travelled to ${from}. Rule '${name}' now governs history from there - continue the conversation to replay with the rule applied.`,
      );
    } else {
      appliedRules.add(name);
      notify(
        ctx,
        `Rule '${name}' is now applied to this session's context. Continue to replay with it applied.`,
      );
    }
    return;
  }

  notify(ctx, `Unknown command '${cmd}'.\n${HELP}`, "warning");
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  loadRules();
  const guidanceRules = loadGuidanceDir(guidanceDir());
  const firedGuidance = new Set<string>();
  let pendingGuidance: GuidanceRule[] = [];

  pi.registerCommand("omfg", {
    description:
      "TTSR - Time Travelling Stream Rules. Manage named stream rules and time-travel apply.",
    handler: (args: string, ctx: ExtensionCommandContext) => handleCommand(args, ctx),
  });

  // guidance: match compact pointers on tool_call, deliver at tool_result.
  // Fires once per rule per session; never blocks (interruptMode: never).
  pi.on("tool_call", (event: ToolCallEvent) => {
    try {
      for (const rule of matchGuidance(guidanceRules, event.toolName, event.input)) {
        if (firedGuidance.has(rule.name)) continue;
        firedGuidance.add(rule.name);
        pendingGuidance.push(rule);
      }
    } catch {
      // Guidance must never break dispatch.
    }
    return undefined;
  });

  // live: mutate the streaming assistant message in place (best-effort; post enforces final).
  // NOTE: Pi core emits no content on tool_execution_update (only ids/args/
  // partialResult) — live tool-stream governing is impossible; the post-stage
  // tool_result handler below is the enforcement point.
  pi.on("message_update", (event: MessageUpdateEvent) => {
    if (!stageHasRules("live")) return;
    try {
      event.message = asAgentMessage(transformMessage(asChatMessage(event.message), "live"));
    } catch {
      /* no-op */
    }
  });

  // post: replace finalized assistant message.
  pi.on("message_end", (event: MessageEndEvent) => {
    if (!stageHasRules("post")) return;
    try {
      const next = transformMessage(asChatMessage(event.message), "post");
      if (next !== asChatMessage(event.message)) return { message: asAgentMessage(next) };
    } catch {
      /* no-op */
    }
    return undefined;
  });

  // post: replace finalized tool result content.
  pi.on("tool_result", (event: ToolResultEvent) => {
    if (!stageHasRules("post")) return;
    try {
      const content = (event.content ?? []) as unknown as (TextContent | ImageContent)[];
      const { blocks, changed } = transformBlocks(asBlocks(content), "post");
      if (changed) return { content: blocks as unknown as (TextContent | ImageContent)[] };
    } catch {
      /* no-op */
    }
    return undefined;
  });

  // guidance delivery: append compact pointers collected at tool_call.
  // Registered after the post-stage handler so notices land post-transform.
  pi.on("tool_result", (event: ToolResultEvent) => {
    if (pendingGuidance.length === 0) return undefined;
    try {
      const notes = pendingGuidance.map((r) => ({ type: "text", text: guidanceNotice(r) }));
      pendingGuidance = [];
      const content = (event.content ?? []) as unknown as (TextContent | ImageContent)[];
      return { content: [...content, ...(notes as unknown as (TextContent | ImageContent)[])] };
    } catch {
      pendingGuidance = [];
    }
    return undefined;
  });
  pi.on("context", (event: ContextEvent) => {
    if (!stageHasRules("context")) return;
    try {
      const msgs = event.messages as unknown as AgentMessage[];
      let changed = false;
      const next = msgs.map((m) => {
        const r = transformMessage(asChatMessage(m), "context");
        if (r !== asChatMessage(m)) changed = true;
        return asAgentMessage(r);
      });
      if (changed) return { messages: next };
    } catch {
      /* no-op */
    }
    return undefined;
  });
}
