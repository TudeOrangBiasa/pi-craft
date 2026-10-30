/**
 * run-store.ts — Durable run records, persisted as pi session custom entries.
 *
 * Every status change appends a `subagents:run` custom entry to the PARENT
 * session (via `pi.appendEntry`, which writes to that session's own file).
 * Custom entries never reach the LLM, and they survive `/reload`, `/resume`
 * and a killed process — unlike the manager's in-memory map.
 *
 * On `session_start`, `loadInterrupted` replays the branch and returns one
 * snapshot per run whose LAST entry still says `running` or `queued`. Those
 * runs never settled: the process died or reloaded mid-flight. The manager
 * re-registers them as `interrupted` — a state that is truthful (the run did
 * not finish) and resumable (the child session file is intact).
 *
 * Last-write-wins: a run's final entry decides. A run that settled before the
 * restart has a later `completed`/`error`/… entry and is filtered out, so the
 * replay only ever surfaces runs that genuinely never finished.
 */

import type { AgentRecord } from "./types.js";

/** Custom entry type for run snapshots. Distinct from anything the LLM sees. */
export const RUN_ENTRY_TYPE = "subagents:run";

/** The persisted half of a run: identifiers, status, and resume coordinates. */
export interface PersistedRun {
  id: string;
  type: string;
  description: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  toolUses: number;
  /** Child session file — the resume coordinate. Absent when the run never reached session creation. */
  sessionFile?: string;
  cwd?: string;
  agentDir?: string;
}

/** A `running`/`queued` snapshot found on replay, ready to become `interrupted`. */
export interface InterruptedRun extends PersistedRun {
  status: "running" | "queued";
}

/** Minimal session-manager surface this store reads. Both pi's real manager and the in-memory test one satisfy it. */
export interface RunStoreReader {
  getBranch(): Iterable<unknown>;
}

/** Minimal parent-session surface the store writes through. */
export interface RunStoreWriter {
  appendEntry<T = unknown>(customType: string, data?: T): void;
}

/** Defensive shape check — branch entries from older or corrupt sessions are skipped silently. */
export function isPersistedRun(value: unknown): value is PersistedRun {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.type === "string" &&
    typeof v.description === "string" &&
    typeof v.status === "string" &&
    typeof v.startedAt === "number" &&
    typeof v.toolUses === "number"
  );
}

/**
 * Build the snapshot persisted on every status change. Bounded: `result` is
 * the run's own answer text (typically short); anything a caller needs in full
 * lives in the child's session file, not here.
 */
export function toPersistedRun(record: AgentRecord): PersistedRun {
  const snapshot: PersistedRun = {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    startedAt: record.startedAt,
    toolUses: record.toolUses,
  };
  if (record.completedAt !== undefined) snapshot.completedAt = record.completedAt;
  if (record.result !== undefined) snapshot.result = record.result;
  if (record.error !== undefined) snapshot.error = record.error;
  const sessionFile = record.session?.sessionFile ?? record.sessionFile;
  if (sessionFile) snapshot.sessionFile = sessionFile;
  if (record.cwd !== undefined) snapshot.cwd = record.cwd;
  if (record.agentDir !== undefined) snapshot.agentDir = record.agentDir;
  return snapshot;
}

/**
 * Persist one status change. Best-effort by contract: a failure to write must
 * never take a run down — durability is a courtesy, execution is the job.
 */
export function persistRun(writer: RunStoreWriter | undefined, record: AgentRecord): void {
  if (!writer) return;
  try {
    writer.appendEntry(RUN_ENTRY_TYPE, toPersistedRun(record));
  } catch {
    /* durability is best-effort; the run itself must never fail for it */
  }
}

/**
 * Replay the branch and return the runs that never settled: one snapshot per
 * run id whose LAST entry still says `running` or `queued`. Last-write-wins —
 * a later `completed`/`error`/`timeout`/… entry for the same id removes it.
 */
export function loadInterrupted(reader: RunStoreReader): InterruptedRun[] {
  const latest = new Map<string, PersistedRun>();
  for (const raw of reader.getBranch()) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry.type !== "custom" || entry.customType !== RUN_ENTRY_TYPE) continue;
    if (!isPersistedRun(entry.data)) continue;
    latest.set(entry.data.id, entry.data);
  }
  const out: InterruptedRun[] = [];
  for (const run of latest.values()) {
    if (run.status === "running" || run.status === "queued") {
      out.push({ ...run, status: run.status });
    }
  }
  return out;
}
