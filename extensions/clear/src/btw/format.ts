/**
 * format.ts: native widget formatting helpers for /btw.
 *
 * Small pure functions: spinner frames, status icons, duration and token
 * formatters, activity text, and a session-stats reader. Glyphs are plain
 * unicode that ships with every monospace font.
 */

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Status glyphs for the widget heading and the answer card. */
export const ICON_OK = "✓";
export const ICON_ERROR = "✗";
export const ICON_PENDING = "○";
export const ICON_DONE = "●";

/** Stat glyphs: context usage, turn count, tool uses. */
export const ICON_TOKENS = "▤";
export const ICON_TURNS = "↻";
export const ICON_TOOLS = "⚒";

/** Minimal shape we read from upstream `getSessionStats()`. */
export type SessionStatsLike = {
  tokens: { input: number; output: number; cacheWrite: number };
  contextUsage?: { tokens?: number | null; contextWindow?: number; percent: number | null };
};
export type SessionLike = { getSessionStats(): SessionStatsLike };

/** Context usage snapshot: estimated used tokens, window size, percent. */
export type ContextUsageLike = {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
};

/** Full context usage, or null when unavailable. */
export function getSessionContextUsage(session: SessionLike | undefined): ContextUsageLike | null {
  if (!session) return null;
  try {
    const cu = session.getSessionStats().contextUsage;
    if (!cu) return null;
    return {
      tokens: cu.tokens ?? null,
      contextWindow: cu.contextWindow ?? null,
      percent: cu.percent ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Join non-empty parts with a middot separator: `dotJoin(["a", "", "b"])` gives `"a · b"`.
 * Empty parts are dropped so callers can pass conditional pieces inline.
 */
export function dotJoin(parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(" · ");
}

/** Compact token count: 500 gives "500", 30_100 gives "30.1K", 1_000_000 gives "1.00M". */
export function fmtTokenCount(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Format context-window utilization: "▤ 30.1K/1.00M (3%)".
 * Falls back to "▤ 3% ctx" when the window size is unknown.
 * Returns "" when percent is unavailable (caller should skip the segment).
 */
export function formatContext(usage: ContextUsageLike | null | undefined): string {
  if (usage?.percent == null) return "";
  const pct = Math.round(usage.percent);
  if (!usage.contextWindow) return `${ICON_TOKENS} ${pct}% ctx`;
  const used = usage.tokens ?? Math.round((usage.percent / 100) * usage.contextWindow);
  return `${ICON_TOKENS} ${fmtTokenCount(used)}/${fmtTokenCount(usage.contextWindow)} (${pct}%)`;
}

export function formatTurns(turnCount: number, maxTurns?: number | null): string {
  return maxTurns != null ? `${ICON_TURNS} ${turnCount}≤${maxTurns}` : `${ICON_TURNS} ${turnCount}`;
}

export function formatToolUses(count: number): string {
  return `${ICON_TOOLS} ${count}`;
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Compact duration for the answer card: ms under a second, s under a minute, m+s above. */
export function formatDuration(ms: number): string {
  const n = Math.max(0, Math.floor(ms));
  if (n < 1_000) return `${n}ms`;
  if (n < 60_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1_000)}s`;
}

/**
 * Output tokens per second over a duration. "" when either input is
 * non-positive (no work or zero elapsed) so callers can skip the segment.
 */
export function formatSpeed(outputTokens: number, durationMs: number): string {
  if (outputTokens <= 0 || durationMs <= 0) return "";
  return `${Math.round(outputTokens / (durationMs / 1000))} t/s`;
}

export const TOOL_DISPLAY: Record<string, string> = {
  read: "reading",
  bash: "running command",
  edit: "editing",
  write: "writing",
  grep: "searching",
  find: "finding files",
  ls: "listing",
};

/**
 * Live tail of agent output: latest non-empty line, tail-anchored to `len`
 * chars (keeps the moving edge, not the stale first line).
 */
export function truncateLine(text: string, len = 32): string {
  const lines = text.split("\n").filter((l) => l.trim());
  const line = (lines.at(-1) ?? "").trim();
  if (line.length <= len) return line;
  return `…${line.slice(-len)}`;
}

/**
 * One-line description of what a job is doing: grouped active tools,
 * else a tail (`tailLen` chars, default 32) of the streaming answer text, else
 * "thinking…".
 */
export function describeActivity(
  activeTools: Map<string, string>,
  responseText?: string,
  tailLen = 32,
): string {
  if (activeTools.size > 0) {
    const groups = new Map<string, number>();
    for (const toolName of activeTools.values()) {
      const action = TOOL_DISPLAY[toolName] ?? toolName;
      groups.set(action, (groups.get(action) ?? 0) + 1);
    }
    const parts: string[] = [];
    for (const [action, count] of groups) {
      parts.push(count > 1 ? `${action} ${count}×` : action);
    }
    return `${parts.join(", ")}…`;
  }
  if (responseText?.trim()) return truncateLine(responseText, tailLen);
  return "thinking…";
}
