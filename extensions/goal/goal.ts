import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Goal mode: Claude Code-style autonomous completion loop.
//
// One goal per session. The user states a checkable stop condition via /goal;
// the extension keeps queueing continuation turns at agent_settled (Pi's
// fully-idle signal: no retry, compaction, or queued continuation pending)
// until the agent reports goal_complete / goal_blocked or the budget runs out.
// State persists as custom session entries so /reload + /resume keep it.
// ---------------------------------------------------------------------------

export const GOAL_ENTRY_TYPE = "goal-state";
export const GOAL_COMPLETE_TOOL = "goal_complete";
export const GOAL_BLOCKED_TOOL = "goal_blocked";
/** Subagent type the verifier must run as: read-only built-ins only. */
export const GOAL_VERIFIER_TYPE = "Explore";
/** Verdict marker the verifier's final line must start with. */
export const VERDICT_PREFIX = "GOAL_VERDICT:";
export type GoalStatus = "active" | "paused" | "blocked" | "budget_limited" | "complete";

export type Verdict = "PASS" | "FAIL" | "IMPOSSIBLE";

export interface LastVerdict {
  verdict: Verdict;
  reason: string;
  at: number;
}

export interface GoalState {
  goalId: string;
  condition: string;
  status: GoalStatus;
  maxTurns: number | undefined;
  maxTokens: number | undefined;
  turns: number;
  tokensUsed: number;
  startedAt: number;
  updatedAt: number;
  wrapUpQueued: boolean;
  settledCount: number;
  /** Set when a goal_complete claim is parked awaiting the verifier's verdict. */
  pendingVerdict: boolean;
  /** Last evidence claimed; compared to detect new evidence after FAIL. */
  lastEvidence: string | undefined;
  /** Consecutive FAIL verdicts with no new evidence (2 stops the goal). */
  failStreak: number;
  lastVerdict: LastVerdict | undefined;
}

export interface GoalStore {
  current: GoalState | undefined;
  toolsVisible: boolean;
}

export function isTerminal(status: GoalStatus): boolean {
  return status === "blocked" || status === "budget_limited" || status === "complete";
}

export function createStore(): GoalStore {
  return { current: undefined, toolsVisible: false };
}

/** A continuation is due only for active goals that have not hit budget. */
export function continuationDue(goal: GoalState): boolean {
  if (goal.status !== "active") return false;
  if (goal.maxTurns !== undefined && goal.turns >= goal.maxTurns) return false;
  return true;
}

/** Budget exhausted: wrap-up turn still allowed once, then hard stop. */
export function budgetExhausted(goal: GoalState): boolean {
  if (goal.maxTurns !== undefined && goal.turns >= goal.maxTurns) return true;
  if (goal.maxTokens !== undefined && goal.tokensUsed >= goal.maxTokens) return true;
  return false;
}

export interface TerminalParams {
  goalId: string;
  text: string;
  kind: "complete" | "blocked";
}

/** Verifier configuration: env-read at each call so tests can flip it per case. */
export interface VerifyConfig {
  enabled: boolean;
  model: string | undefined;
  timeoutMs: number | undefined;
}

export function readVerifyConfig(env: NodeJS.ProcessEnv = process.env): VerifyConfig {
  const timeoutRaw = env.PI_GOAL_VERIFY_TIMEOUT_MS;
  const timeoutMs =
    timeoutRaw !== undefined &&
    timeoutRaw.trim() !== "" &&
    Number.isFinite(Number(timeoutRaw)) &&
    Number(timeoutRaw) > 0
      ? Math.floor(Number(timeoutRaw))
      : undefined;
  const model = env.PI_GOAL_VERIFY_MODEL?.trim();
  return {
    enabled: env.PI_GOAL_VERIFY !== "0",
    model: model === undefined || model === "" ? undefined : model,
    timeoutMs,
  };
}

export type CompleteOutcome =
  | { ok: true; goal: GoalState; verified: boolean }
  | { ok: false; error: string };

export type TerminalOutcome = { ok: true; goal: GoalState } | { ok: false; error: string };

/** Validate a terminal tool call against the live goal (stale-guard + non-empty text). */
export function applyTerminal(
  store: GoalStore,
  params: TerminalParams,
  now: number,
): TerminalOutcome {
  const goal = store.current;
  if (goal === undefined || goal.goalId !== params.goalId) {
    return { ok: false, error: `stale goal_id: no active goal matches "${params.goalId}"` };
  }
  if (isTerminal(goal.status)) {
    return { ok: false, error: `goal is already ${goal.status}` };
  }
  if (goal.status === "paused") {
    return { ok: false, error: "goal is paused; resume it before reporting" };
  }
  if (params.text.trim() === "") {
    const field = params.kind === "complete" ? "evidence" : "reason";
    return { ok: false, error: `${field} must be non-empty` };
  }
  goal.status = params.kind === "complete" ? "complete" : "blocked";
  goal.updatedAt = now;
  return { ok: true, goal };
}

/** Validate a goal_blocked call against the live goal (stale-guard + non-empty reason). */
export function applyBlocked(
  store: GoalStore,
  params: { goalId: string; reason: string },
  now: number,
): TerminalOutcome {
  const outcome = applyTerminal(
    store,
    { goalId: params.goalId, text: params.reason, kind: "blocked" },
    now,
  );
  if (outcome.ok) outcome.goal.pendingVerdict = false;
  return outcome;
}

/**
 * goal_complete with the verifier gate. Verification off → the claim completes
 * (#8 fallback). Verification on → the claim parks pendingVerdict and a
 * verifier verdict must arrive before the goal can complete.
 */
export function applyComplete(
  store: GoalStore,
  params: { goalId: string; evidence: string },
  now: number,
  config: VerifyConfig,
): CompleteOutcome {
  const goal = store.current;
  if (goal === undefined || goal.goalId !== params.goalId) {
    return { ok: false, error: `stale goal_id: no active goal matches "${params.goalId}"` };
  }
  if (isTerminal(goal.status)) {
    return { ok: false, error: `goal is already ${goal.status}` };
  }
  if (goal.status === "paused") {
    return { ok: false, error: "goal is paused; resume it before reporting" };
  }
  if (params.evidence.trim() === "") {
    return { ok: false, error: "evidence must be non-empty" };
  }
  if (!config.enabled) {
    goal.status = "complete";
    goal.updatedAt = now;
    return { ok: true, goal, verified: true };
  }
  if (goal.lastEvidence === undefined || goal.lastEvidence.trim() !== params.evidence.trim()) {
    goal.failStreak = 0;
  }
  goal.pendingVerdict = true;
  goal.lastEvidence = params.evidence;
  goal.updatedAt = now;
  return { ok: true, goal, verified: false };
}

export interface ParsedVerdict {
  verdict: Verdict;
  reason: string;
}

/**
 * Parse the verifier's verdict from Agent result text. The contract is one
 * line starting with GOAL_VERDICT: followed by PASS, FAIL(<missing>) or
 * IMPOSSIBLE(<why>). Last such line wins; anything else is not a verdict.
 */
export function parseVerdict(text: string): ParsedVerdict | undefined {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? "";
    if (!line.startsWith(VERDICT_PREFIX)) continue;
    const rest = line.slice(VERDICT_PREFIX.length).trim();
    if (rest === "PASS") return { verdict: "PASS", reason: "" };
    const fail = /^FAIL\((.*)\)$/.exec(rest);
    if (fail !== null && (fail[1] ?? "").trim() !== "") {
      return { verdict: "FAIL", reason: (fail[1] as string).trim() };
    }
    const impossible = /^IMPOSSIBLE\((.*)\)$/.exec(rest);
    if (impossible !== null && (impossible[1] ?? "").trim() !== "") {
      return { verdict: "IMPOSSIBLE", reason: (impossible[1] as string).trim() };
    }
    return undefined;
  }
  return undefined;
}

/**
 * Whether a tool_result event is our verifier reporting back: an Agent call
 * the worker made with the instructed type, description, and blocking mode.
 * The subagent_type check is what keeps the verdict read-only — Explore runs
 * read-only built-ins only, and any other type's text is ignored.
 */
export function isVerifierResult(
  goal: GoalState,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  return (
    goal.pendingVerdict &&
    toolName === "Agent" &&
    input.subagent_type === GOAL_VERIFIER_TYPE &&
    input.description === `verify goal ${goal.goalId}` &&
    input.run_in_background === false
  );
}

export type VerdictOutcome =
  | { ok: true; goal: GoalState; action: "completed" | "continue" | "blocked" }
  | { ok: false; error: string };

/**
 * Apply a parsed verifier verdict to the parked goal. PASS completes; FAIL
 * feeds back (the wiring sends the next continuation); IMPOSSIBLE blocks.
 * The second consecutive FAIL with no new evidence blocks instead of looping.
 */
export function applyVerdict(
  store: GoalStore,
  params: { goalId: string; verdict: Verdict; reason: string },
  now: number,
): VerdictOutcome {
  const goal = store.current;
  if (goal === undefined || goal.goalId !== params.goalId) {
    return { ok: false, error: `stale goal_id: no active goal matches "${params.goalId}"` };
  }
  if (!goal.pendingVerdict) {
    return { ok: false, error: "no verdict is pending for this goal" };
  }
  if (isTerminal(goal.status)) {
    return { ok: false, error: `goal is already ${goal.status}` };
  }
  goal.pendingVerdict = false;
  goal.updatedAt = now;
  goal.lastVerdict = { verdict: params.verdict, reason: params.reason, at: now };
  if (params.verdict === "PASS") {
    goal.status = "complete";
    goal.failStreak = 0;
    return { ok: true, goal, action: "completed" };
  }
  if (params.verdict === "IMPOSSIBLE") {
    goal.status = "blocked";
    return { ok: true, goal, action: "blocked" };
  }
  goal.failStreak += 1;
  if (goal.failStreak >= 2) {
    goal.status = "blocked";
    return { ok: true, goal, action: "blocked" };
  }
  return { ok: true, goal, action: "continue" };
}

// --- arg parsing (pure) ---

export interface GoalArgs {
  condition: string;
  maxTurns: number | undefined;
  maxTokens: number | undefined;
  error: string | undefined;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

function parseTokenCount(raw: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(k)?$/i.exec(raw.trim());
  if (m === null) return undefined;
  const value = Number.parseFloat(m[1] as string);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value * (m[2] === undefined ? 1 : 1000));
}

/** Parse `/goal <condition> [--max-turns N] [--tokens 200k]`. Flags anywhere. */
export function parseGoalArgs(input: string): GoalArgs {
  const condition: string[] = [];
  let maxTurns: number | undefined;
  let maxTokens: number | undefined;
  let error: string | undefined;
  const tokens = tokenize(input.trim());
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (token === "--max-turns" || token === "--tokens") {
      const raw = tokens[i + 1];
      i += 1;
      if (raw === undefined || raw === "") {
        error = `${token} needs a value`;
        break;
      }
      if (token === "--max-turns") {
        const n = Number.parseInt(raw, 10);
        if (!Number.isInteger(n) || n <= 0) {
          error = `--max-turns needs a positive integer, got "${raw}"`;
          break;
        }
        maxTurns = n;
      } else {
        const n = parseTokenCount(raw);
        if (n === undefined) {
          error = `--tokens needs a positive count like 200k, got "${raw}"`;
          break;
        }
        maxTokens = n;
      }
      continue;
    }
    condition.push(token);
  }
  return { condition: condition.join(" "), maxTurns, maxTokens, error };
}

// --- persistence (pure encode/decode; pi boundary stays in the entry) ---

export function isGoalState(value: unknown): value is GoalState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.goalId === "string" &&
    v.goalId !== "" &&
    typeof v.condition === "string" &&
    v.condition !== "" &&
    (v.status === "active" ||
      v.status === "paused" ||
      v.status === "blocked" ||
      v.status === "budget_limited" ||
      v.status === "complete") &&
    (v.maxTurns === undefined || (typeof v.maxTurns === "number" && v.maxTurns > 0)) &&
    (v.maxTokens === undefined || (typeof v.maxTokens === "number" && v.maxTokens > 0)) &&
    typeof v.turns === "number" &&
    typeof v.tokensUsed === "number" &&
    typeof v.startedAt === "number" &&
    typeof v.updatedAt === "number" &&
    typeof v.wrapUpQueued === "boolean" &&
    typeof v.settledCount === "number" &&
    typeof v.pendingVerdict === "boolean" &&
    (v.lastEvidence === undefined || typeof v.lastEvidence === "string") &&
    typeof v.failStreak === "number" &&
    (v.lastVerdict === undefined || isLastVerdict(v.lastVerdict))
  );
}

function isLastVerdict(value: unknown): value is LastVerdict {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.verdict === "PASS" || v.verdict === "FAIL" || v.verdict === "IMPOSSIBLE") &&
    typeof v.reason === "string" &&
    typeof v.at === "number"
  );
}

/** Latest goal entry in a session listing wins (entries are append-only). */
export function restoreFromEntries(entries: ReadonlyArray<unknown>): GoalState | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry?.type === "custom" && entry?.customType === GOAL_ENTRY_TYPE) {
      if (isGoalState(entry.data)) return entry.data;
    }
  }
  return undefined;
}

// --- status rendering (pure) ---

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export function formatStatus(goal: GoalState, now: number): string {
  const lines = [
    `goal ${goal.goalId}: ${goal.status}`,
    `condition: ${goal.condition}`,
    `turns: ${goal.turns}${goal.maxTurns === undefined ? "" : `/${goal.maxTurns}`}`,
    `elapsed: ${formatElapsed(now - goal.startedAt)}`,
    `tokens: ~${goal.tokensUsed}${goal.maxTokens === undefined ? "" : `/${goal.maxTokens}`}`,
  ];
  if (goal.pendingVerdict) lines.push("verdict: pending");
  else if (goal.lastVerdict !== undefined) {
    lines.push(`verdict: ${goal.lastVerdict.verdict} — ${goal.lastVerdict.reason}`);
  }
  return lines.join("\n");
}

function continuationPrompt(goal: GoalState): string {
  const budget = goal.maxTurns === undefined ? "" : ` (turn ${goal.turns + 1} of ${goal.maxTurns})`;
  return (
    `Continue working toward this goal${budget}:\n${goal.condition}\n\n` +
    `Rules: keep the stop condition as stated — do not relax it. ` +
    `Call goal_complete with goal_id "${goal.goalId}" and non-empty evidence when the condition is met, ` +
    `or goal_blocked with goal_id "${goal.goalId}" and a reason if a real blocker stops you.`
  );
}

/** Next-turn feedback after a FAIL verdict: the missing items, verbatim. */
export function failFeedbackPrompt(goal: GoalState, missing: string): string {
  return (
    `The independent verifier checked your claim against the repo and found it incomplete:\n${missing}\n\n` +
    `Address every missing item against the goal condition below — do not relax it — ` +
    `then call goal_complete with goal_id "${goal.goalId}" and new checkable evidence.\n` +
    `Second consecutive FAIL with no new evidence stops the goal as blocked.\n` +
    `Goal: ${goal.condition}`
  );
}

/**
 * Spawn instructions returned to the worker after a parked claim. The worker
 * spawns the verifier through the subagents Agent tool (the only spawn
 * surface an outside extension can reach); the goal extension then reads the
 * verdict from the Agent tool_result — never from the worker's own claim.
 */
export function verifyInstructions(
  goal: GoalState,
  evidence: string,
  config: VerifyConfig,
): string {
  const modelLine =
    config.model === undefined
      ? "Omit model to use the session model."
      : `model: "${config.model}".`;
  const timeoutLine =
    config.timeoutMs === undefined
      ? "Omit timeout_ms for no ceiling."
      : `timeout_ms: ${config.timeoutMs}.`;
  return (
    `goal ${goal.goalId} is NOT complete yet — your claim is parked awaiting an independent verdict.\n` +
    `Spawn the verifier now with the Agent tool (blocking, so its verdict lands in your context):\n` +
    `subagent_type: "${GOAL_VERIFIER_TYPE}" (read-only: read, bash for tests/git, grep, find — no write/replace/insert), ` +
    `run_in_background: false, ${modelLine} ${timeoutLine}\n` +
    `description: "verify goal ${goal.goalId}"\n` +
    `prompt: the goal condition and the claimed evidence below, ending with this exact contract: ` +
    `"Check the condition against the repo itself (read files, run read-only commands). ` +
    `End your final message with exactly one line starting with ${VERDICT_PREFIX} ` +
    `followed by PASS, or FAIL(<what is missing>), or IMPOSSIBLE(<why>)."\n` +
    `Goal condition:\n${goal.condition}\n\nClaimed evidence:\n${evidence}`
  );
}

function wrapUpPrompt(goal: GoalState): string {
  return (
    `The goal budget is exhausted (turns ${goal.turns}` +
    `${goal.maxTurns === undefined ? "" : `/${goal.maxTurns}`}` +
    `${goal.maxTokens === undefined ? "" : `, tokens ~${goal.tokensUsed}/${goal.maxTokens}`}). ` +
    `This is the final wrap-up turn: summarize what was achieved against the goal condition, ` +
    `what remains, and the key files touched. Do not start new work.\nGoal: ${goal.condition}`
  );
}

// --- tool schemas (typebox 1.x) ---

export const GoalCompleteParams = Type.Object({
  goal_id: Type.String({ description: "Current goal id from the /goal continuation prompt." }),
  evidence: Type.String({ description: "Checkable proof the stop condition is met." }),
});

export const GoalBlockedParams = Type.Object({
  goal_id: Type.String({ description: "Current goal id from the /goal continuation prompt." }),
  reason: Type.String({ description: "Concrete blocker that stops the goal." }),
});

function toolOk(text: string): AgentToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

function toolErr(text: string): AgentToolResult {
  return { content: [{ type: "text", text }], details: undefined, isError: true };
}

// --- wiring (impure) ---

const HELP = `goal - autonomous completion loop
/goal <condition> [--max-turns N] [--tokens 200k]  start (one per session; replaces after confirm)
/goal              show condition, status, turns, elapsed, tokens
/goal pause        stop continuation until resumed
/goal resume       continue a paused goal
/goal clear        drop the goal; no further continuation`;

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

function newGoalId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function (pi: ExtensionAPI): void {
  const store = createStore();

  function persist(): void {
    if (store.current === undefined) return;
    try {
      pi.appendEntry(GOAL_ENTRY_TYPE, store.current);
    } catch {
      /* persistence is best-effort; the live goal keeps working */
    }
  }

  function setToolsVisible(visible: boolean): void {
    if (store.toolsVisible === visible) return;
    store.toolsVisible = visible;
    try {
      const active = pi
        .getActiveTools()
        .filter((t) => t !== GOAL_COMPLETE_TOOL && t !== GOAL_BLOCKED_TOOL);
      pi.setActiveTools(visible ? [...active, GOAL_COMPLETE_TOOL, GOAL_BLOCKED_TOOL] : active);
    } catch {
      /* tool list failure must not break the command path */
    }
  }

  function trackUsage(ctx: ExtensionContext): void {
    const goal = store.current;
    if (goal === undefined) return;
    try {
      const usage = ctx.getContextUsage();
      if (usage?.tokens !== undefined && usage.tokens !== null) {
        goal.tokensUsed = Math.max(goal.tokensUsed, usage.tokens);
      }
    } catch {
      /* usage is advisory */
    }
  }

  pi.registerCommand("goal", {
    description: "Autonomous goal loop: state a stop condition, Pi keeps working until it holds.",
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      const input = args.trim();
      if (input === "") {
        const goal = store.current;
        notify(
          ctx,
          goal === undefined ? `no goal this session\n${HELP}` : formatStatus(goal, Date.now()),
        );
        return;
      }
      const [sub] = tokenize(input);
      if (sub === "help") {
        notify(ctx, HELP);
        return;
      }
      if (sub === "pause") {
        const goal = store.current;
        if (goal === undefined || isTerminal(goal.status)) {
          notify(ctx, "no active goal to pause", "warning");
          return;
        }
        if (goal.status === "paused") {
          notify(ctx, `goal ${goal.goalId} is already paused`);
          return;
        }
        goal.status = "paused";
        goal.updatedAt = Date.now();
        persist();
        notify(ctx, `goal ${goal.goalId} paused — /goal resume to continue`);
        return;
      }
      if (sub === "resume") {
        const goal = store.current;
        if (goal === undefined) {
          notify(ctx, "no goal to resume", "warning");
          return;
        }
        if (isTerminal(goal.status)) {
          notify(
            ctx,
            `goal ${goal.goalId} is ${goal.status}; start a new one with /goal <condition>`,
            "warning",
          );
          return;
        }
        if (goal.status === "active") {
          notify(ctx, `goal ${goal.goalId} is already active`);
          return;
        }
        goal.status = "active";
        goal.updatedAt = Date.now();
        persist();
        setToolsVisible(true);
        notify(ctx, `goal ${goal.goalId} resumed`);
        pi.sendUserMessage(continuationPrompt(goal));
        return;
      }
      if (sub === "clear") {
        const goal = store.current;
        if (goal === undefined) {
          notify(ctx, "no goal to clear");
          return;
        }
        store.current = undefined;
        persist();
        setToolsVisible(false);
        notify(ctx, `goal ${goal.goalId} cleared — no further continuation`);
        return;
      }
      // Start: /goal <condition> [--max-turns N] [--tokens 200k]
      const parsed = parseGoalArgs(input);
      if (parsed.error !== undefined) {
        notify(ctx, parsed.error, "error");
        return;
      }
      if (parsed.condition === "") {
        notify(ctx, HELP);
        return;
      }
      const existing = store.current;
      if (existing !== undefined && !isTerminal(existing.status)) {
        let replace = false;
        try {
          replace = ctx.hasUI
            ? await ctx.ui.confirm(
                "Replace goal?",
                `Replace the ${existing.status} goal "${existing.condition}"?`,
              )
            : true;
        } catch {
          replace = false;
        }
        if (!replace) {
          notify(ctx, `keeping goal ${existing.goalId}`);
          return;
        }
      }
      const now = Date.now();
      store.current = {
        goalId: newGoalId(),
        condition: parsed.condition,
        status: "active",
        maxTurns: parsed.maxTurns,
        maxTokens: parsed.maxTokens,
        turns: 0,
        tokensUsed: 0,
        startedAt: now,
        updatedAt: now,
        wrapUpQueued: false,
        settledCount: 0,
        pendingVerdict: false,
        lastEvidence: undefined,
        failStreak: 0,
        lastVerdict: undefined,
      };
      persist();
      setToolsVisible(true);
      const started = store.current;
      notify(ctx, formatStatus(started, now));
      pi.sendUserMessage(continuationPrompt(started));
    },
  });

  pi.registerTool({
    name: GOAL_COMPLETE_TOOL,
    label: "Goal Complete",
    description: "Report the active goal's stop condition as met, with checkable evidence.",
    promptSnippet: "goal_complete reports the active goal done with evidence",
    promptGuidelines: [
      "Call goal_complete only when the /goal stop condition holds; goal_complete evidence must be checkable proof, not a summary of effort.",
      "Pass goal_complete the goal_id from the latest continuation prompt; goal_complete rejects stale ids.",
      "goal_complete parks the claim for an independent verifier; spawn it with the Agent tool exactly as the goal_complete result instructs, then wait for its verdict.",
    ],
    parameters: GoalCompleteParams,
    defaultActive: false,
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      const config = readVerifyConfig();
      const outcome = applyComplete(
        store,
        { goalId: params.goal_id, evidence: params.evidence },
        Date.now(),
        config,
      );
      if (!outcome.ok) return toolErr(outcome.error);
      persist();
      if (outcome.verified) {
        return toolOk(`goal ${outcome.goal.goalId} complete — no further continuation`);
      }
      return toolOk(verifyInstructions(outcome.goal, params.evidence as string, config));
    },
  });

  pi.registerTool({
    name: GOAL_BLOCKED_TOOL,
    label: "Goal Blocked",
    description: "Report the active goal as stopped by a real blocker.",
    promptSnippet: "goal_blocked reports the active goal stopped by a blocker",
    promptGuidelines: [
      "Call goal_blocked only for a real blocker outside your control; goal_blocked reason must name the blocker concretely.",
      "Pass goal_blocked the goal_id from the latest continuation prompt; goal_blocked rejects stale ids.",
    ],
    parameters: GoalBlockedParams,
    defaultActive: false,
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      const outcome = applyBlocked(
        store,
        { goalId: params.goal_id, reason: params.reason },
        Date.now(),
      );
      if (!outcome.ok) return toolErr(outcome.error);
      persist();
      return toolOk(`goal ${outcome.goal.goalId} blocked — no further continuation`);
    },
  });

  // Count goal turns; goal tools are agent-called so turn_end is the boundary.
  pi.on("turn_end", (_event, ctx) => {
    const goal = store.current;
    if (goal === undefined || goal.status !== "active") return;
    goal.turns += 1;
    goal.updatedAt = Date.now();
    trackUsage(ctx);
    persist();
  });

  // Idle-gated continuation: agent_settled is Pi's fully-idle signal (no
  // retry, compaction, or queued continuation pending). One continuation per
  // settled point: the counter increments every settle, and queuing happens
  // only on the transition — a re-emitted settle for the same point is a no-op.
  let lastContinuedSettle = -1;
  pi.on("agent_settled", (_event, ctx) => {
    const goal = store.current;
    if (goal === undefined) return;
    goal.settledCount += 1;
    const point = goal.settledCount;
    if (point === lastContinuedSettle) return;
    // A parked claim waits on the verifier, not on a fresh continuation turn:
    // queueing one here would double-prompt the worker mid-verification.
    if (goal.pendingVerdict) return;
    if (!continuationDue(goal)) {
      if (goal.status === "active" && budgetExhausted(goal) && !goal.wrapUpQueued) {
        goal.wrapUpQueued = true;
        goal.status = "budget_limited";
        goal.updatedAt = Date.now();
        persist();
        lastContinuedSettle = point;
        pi.sendUserMessage(wrapUpPrompt(goal));
      }
      return;
    }
    trackUsage(ctx);
    if (budgetExhausted(goal)) {
      goal.wrapUpQueued = true;
      goal.status = "budget_limited";
      goal.updatedAt = Date.now();
      persist();
      lastContinuedSettle = point;
      pi.sendUserMessage(wrapUpPrompt(goal));
      return;
    }
    lastContinuedSettle = point;
    persist();
    pi.sendUserMessage(continuationPrompt(goal));
  });

  // Verdict capture: the verifier reports through the Agent tool_result, which
  // carries the spawn input back — the only verdict channel the worker cannot
  // forge, since the goal extension reads the subagent's text, not the claim.
  pi.on("tool_result", (event) => {
    try {
      const goal = store.current;
      if (goal === undefined || !goal.pendingVerdict) return;
      if (event.isError) return;
      if (!isVerifierResult(goal, event.toolName, event.input)) return;
      const text = event.content
        .filter((part) => part.type === "text")
        .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
        .join("\n");
      const parsed = parseVerdict(text);
      if (parsed === undefined) return;
      const outcome = applyVerdict(
        store,
        { goalId: goal.goalId, verdict: parsed.verdict, reason: parsed.reason },
        Date.now(),
      );
      if (!outcome.ok) return;
      persist();
      if (outcome.action === "continue") {
        pi.sendUserMessage(failFeedbackPrompt(goal, parsed.reason));
      }
    } catch {
      /* a malformed tool result must not break the verdict path */
    }
  });

  // Restore across /reload + /resume: session entries replay into ctx.
  pi.on("session_start", (_event, ctx) => {
    try {
      const restored = restoreFromEntries(ctx.sessionManager.getEntries());
      if (restored === undefined) return;
      store.current = restored;
      lastContinuedSettle = restored.settledCount;
      if (!isTerminal(restored.status)) {
        setToolsVisible(true);
      }
    } catch {
      /* a corrupt entry must not break session start */
    }
  });
}
