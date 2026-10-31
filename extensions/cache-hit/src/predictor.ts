import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const UNKNOWN_THINKING_LEVEL = "unknown";

export interface CacheLane {
  provider: string;
  api: string;
  model: string;
  thinkingLevel: string;
}

export interface CacheLaneSnapshot extends CacheLane {
  promptTokens: number;
}

export interface CacheHistory {
  lanes: Map<string, CacheLaneSnapshot>;
}

export interface CachePrediction {
  lane: CacheLane;
  estimatedCacheTokens: number;
  currentPromptTokens: number | null;
  percent: number | null;
  hasLaneHistory: boolean;
}

function errorFor(part: string): Error {
  return new Error(`cache lane needs a non-empty ${part}`);
}

/** Trimmed string, or null when the value cannot name a lane part. */
export function normalizeLanePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Build a lane from raw parts. A blank provider, api, or model throws, so a
 * broken identity never silently merges into another lane. A blank thinking
 * level falls back to UNKNOWN_THINKING_LEVEL.
 */
export function makeCacheLane(
  provider: unknown,
  api: unknown,
  model: unknown,
  thinkingLevel: unknown,
): CacheLane {
  const cleanProvider = normalizeLanePart(provider);
  if (cleanProvider === null) throw errorFor("provider");
  const cleanApi = normalizeLanePart(api);
  if (cleanApi === null) throw errorFor("api");
  const cleanModel = normalizeLanePart(model);
  if (cleanModel === null) throw errorFor("model");
  return {
    provider: cleanProvider,
    api: cleanApi,
    model: cleanModel,
    thinkingLevel: normalizeLanePart(thinkingLevel) ?? UNKNOWN_THINKING_LEVEL,
  };
}

/**
 * Collision-free lane key. JSON encoding keeps separators, quotes, and
 * control characters inside values from merging two lanes into one key.
 * Throws on a broken lane instead of keying it somewhere wrong.
 */
export function cacheLaneKey(lane: CacheLane): string {
  const clean = makeCacheLane(lane?.provider, lane?.api, lane?.model, lane?.thinkingLevel);
  return JSON.stringify([clean.provider, clean.api, clean.model, clean.thinkingLevel]);
}

/** Usable token count, or 0 when the value is missing or invalid. */
export function sanitizeTokenCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

/** Usable token count, or null when the value is missing or invalid. */
export function sanitizeNullableTokens(value: unknown): number | null {
  const tokens = sanitizeTokenCount(value);
  return tokens <= 0 ? null : tokens;
}

/**
 * Prompt tokens behind one usage sample. Non-finite and negative components
 * count as zero, so a corrupt sample reads as empty instead of NaN.
 */
export function promptTokens(usage: {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}): number {
  if (typeof usage !== "object" || usage === null) return 0;
  return (
    sanitizeTokenCount(usage.input) +
    sanitizeTokenCount(usage.cacheRead) +
    sanitizeTokenCount(usage.cacheWrite)
  );
}

export function scanCacheHistory(
  entries: readonly SessionEntry[],
  initialThinkingLevel = UNKNOWN_THINKING_LEVEL,
): CacheHistory {
  const history: CacheHistory = { lanes: new Map() };
  if (!Array.isArray(entries)) return history;
  let thinkingLevel = normalizeLanePart(initialThinkingLevel) ?? UNKNOWN_THINKING_LEVEL;

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    if (entry.type === "thinking_level_change") {
      thinkingLevel = normalizeLanePart(entry.thinkingLevel) ?? UNKNOWN_THINKING_LEVEL;
      continue;
    }

    if (entry.type === "compaction" || entry.type === "branch_summary") {
      history.lanes.clear();
      continue;
    }

    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const message = entry.message;
    if (message.stopReason === "aborted" || message.stopReason === "error") {
      continue;
    }

    const tokens = promptTokens(message.usage);
    if (tokens <= 0) continue;

    const provider = normalizeLanePart(message.provider);
    const api = normalizeLanePart(message.api);
    const model = normalizeLanePart(message.model);
    if (provider === null || api === null || model === null) continue;

    const lane: CacheLane = { provider, api, model, thinkingLevel };
    history.lanes.set(cacheLaneKey(lane), {
      ...lane,
      promptTokens: tokens,
    });
  }

  return history;
}

export function recordAssistantUsage(
  history: CacheHistory,
  message: Extract<SessionEntry, { type: "message" }>["message"],
  lane: CacheLane,
): void {
  const clean = makeCacheLane(lane?.provider, lane?.api, lane?.model, lane?.thinkingLevel);
  if (typeof message !== "object" || message === null) return;
  if (
    message.role !== "assistant" ||
    message.stopReason === "aborted" ||
    message.stopReason === "error"
  ) {
    return;
  }

  const tokens = promptTokens(message.usage);
  if (tokens <= 0) return;

  history.lanes.set(cacheLaneKey(clean), {
    ...clean,
    promptTokens: tokens,
  });
}

export function predictCacheHit(
  history: CacheHistory,
  lane: CacheLane,
  currentPromptTokens: number | null,
): CachePrediction {
  const clean = makeCacheLane(lane?.provider, lane?.api, lane?.model, lane?.thinkingLevel);
  const snapshot =
    history?.lanes instanceof Map ? history.lanes.get(cacheLaneKey(clean)) : undefined;
  const currentTokens = sanitizeNullableTokens(currentPromptTokens);
  const estimatedCacheTokens = snapshot
    ? Math.min(snapshot.promptTokens, currentTokens ?? snapshot.promptTokens)
    : 0;

  return {
    lane: clean,
    estimatedCacheTokens,
    currentPromptTokens: currentTokens,
    percent:
      currentTokens === null ? null : Math.min(100, (estimatedCacheTokens / currentTokens) * 100),
    hasLaneHistory: snapshot !== undefined,
  };
}
