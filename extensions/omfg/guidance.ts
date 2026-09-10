import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// Guidance rules (OMP builtin-rules port): frontmatter-driven contextual
// guidance. Fires on tool_call matches, delivered at tool_result as a compact
// pointer — never the full body, never blocking. Deduplicated per session.

export interface GuidanceRule {
  name: string;
  description: string;
  conditions: string[];
  scopes: Array<{ tool: string; glob: string }>;
}

function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const data: Record<string, unknown> = {};
  if (!text.startsWith("---")) return { data, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data, body: text };
  const head = text.slice(3, end);
  let currentKey: string | null = null;
  for (const rawLine of head.split("\n")) {
    const line = rawLine.trim();
    if (line === "") continue;
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv && !rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
      currentKey = kv[1]!;
      const value = kv[2]!.trim();
      if (value !== "") {
        data[currentKey] = unquote(value);
        currentKey = null;
      } else {
        data[currentKey] = [];
      }
    } else if (currentKey && Array.isArray(data[currentKey])) {
      const item = line.replace(/^-\s*/, "").trim();
      if (item !== "") (data[currentKey] as string[]).push(unquote(item));
    }
  }
  return { data, body: text.slice(end + 4) };
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    // Minimal YAML double-quoted scalar unescaping: without this, regex
    // conditions like "\\b" compile to a literal backslash and never fire.
    return s
      .slice(1, -1)
      .replace(/\\(\\|"|n|t|r)/g, (m, c: string) =>
        c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c,
      );
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/** Minimal glob: *, **, ?, {a,b} — matched against the full string (basename or path). */
export function globMatch(glob: string, value: string): boolean {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (glob[i] === "/") i++;
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
        i++;
      } else {
        const opts = glob
          .slice(i + 1, end)
          .split(",")
          .map((o) => o.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
          .join("|");
        re += `(?:${opts})`;
        i = end + 1;
      }
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  try {
    return new RegExp(`^(?:${re})$`).test(value);
  } catch {
    return false;
  }
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function parseScopes(scopeRaw: unknown): Array<{ tool: string; glob: string }> {
  if (typeof scopeRaw !== "string") return [];
  const out: Array<{ tool: string; glob: string }> = [];
  for (const part of splitTopLevel(scopeRaw)) {
    const m = part.trim().match(/^tool:([A-Za-z_][\w-]*)\((.+)\)$/);
    if (m) out.push({ tool: m[1]!, glob: m[2]!.trim() });
  }
  return out;
}

function ruleFromFile(name: string, text: string): GuidanceRule | null {
  const { data } = parseFrontmatter(text);
  if (data["interruptMode"] !== undefined && data["interruptMode"] !== "never") return null;
  if ("astCondition" in data) return null; // v1: regex conditions only
  const description = typeof data["description"] === "string" ? data["description"] : "";
  const conditions = asStringList(data["condition"]);
  const scopes = parseScopes(data["scope"]);
  if (description === "" || conditions.length === 0 || scopes.length === 0) return null;
  return { name, description, conditions, scopes };
}

export function loadGuidanceDir(dir: string): GuidanceRule[] {
  const rules: GuidanceRule[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return rules;
  }
  for (const file of files) {
    try {
      const rule = ruleFromFile(file.replace(/\.md$/, ""), readFileSync(join(dir, file), "utf-8"));
      if (rule) rules.push(rule);
    } catch {
      // skip unreadable files
    }
  }
  return rules;
}

export function guidanceDir(): string {
  const override = process.env.PI_OMFG_GUIDANCE_DIR;
  if (override && override.trim() !== "") return override;
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, "pi", "guidance") : join(homedir(), ".pi", "agent", "guidance");
}

function stringArgsOf(args: unknown, out: string[] = []): string[] {
  if (typeof args === "string") {
    out.push(args);
  } else if (Array.isArray(args)) {
    for (const item of args) stringArgsOf(item, out);
  } else if (args && typeof args === "object") {
    for (const value of Object.values(args as Record<string, unknown>)) stringArgsOf(value, out);
  }
  return out;
}

function safeRegex(source: string): RegExp | null {
  // PCRE inline flags at the pattern head have no JS literal form —
  // hoist the common ones to flags instead of failing the rule silent.
  let flags = "";
  let pattern = source;
  const head = pattern.match(/^\(\?([ims]+)\)/);
  if (head && head[1]) {
    flags = [...new Set(head[1].split(""))].join("");
    pattern = pattern.slice(head[0].length);
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
/** Rules whose scope tool matches and whose condition hits the serialized args. */
export function matchGuidance(
  rules: GuidanceRule[],
  toolName: string,
  args: unknown,
): GuidanceRule[] {
  const haystack = JSON.stringify(args ?? null);
  const values = stringArgsOf(args);
  const hits: GuidanceRule[] = [];
  for (const rule of rules) {
    const inScope = rule.scopes.some(
      (s) =>
        s.tool === toolName &&
        values.some((v) => globMatch(s.glob, v) || globMatch(s.glob, basename(v))),
    );
    if (!inScope) continue;
    // Conditions run against the JSON haystack AND each raw string value:
    // JSON escapes every `"` in content, so a condition like `"io/ioutil"`
    // only matches the raw value, never the haystack.
    const fires = rule.conditions.some((c) => {
      const re = safeRegex(c);
      if (!re) return false;
      return re.test(haystack) || values.some((v) => re.test(v));
    });
    if (fires) hits.push(rule);
  }
  return hits;
}

export function guidanceNotice(rule: GuidanceRule): string {
  return `guidance: ${rule.name} — ${rule.description}`;
}
