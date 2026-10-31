import type { Task } from "../tool/types.js";
import { EMPTY_STATE, type TaskState } from "./state.js";

/**
 * Per-session live state. This used to be one scalar `let state` cell; it is
 * now a Map partitioned by session id so a detached or child session (a
 * distinct sid) can never read or clobber another session's tasks.
 *
 * The Map is the single mutation seam: only `commitState`, `replaceState`,
 * and `evictSession` write it; the reducer (state/state-reducer.ts) stays
 * pure. Every accessor below is O(1).
 */
const sessions = new Map<string, TaskState>();

/**
 * Ctx-less render pointer: which slot do the ctx-free readers (the overlay's
 * `getSnapshot()`, the tool's `renderCall()`) render? Set when the first UI
 * session claims the foreground, before the overlay loads (see index.ts). A
 * distinct concept from the three task-state mutation seams; not a fourth
 * writer of task state.
 */
let activeRenderSession = "";

/**
 * Session-id extractor. Structural ctx type (no Pi-runtime import) mirrors
 * replay.ts's ctx shape so state/ stays Pi-import-free. Returns `... ?? ""`
 * so an unknown session resolves to "" rather than undefined.
 *
 * Complexity: O(1).
 */
export function sid(ctx: { sessionManager: { getSessionId(): string } }): string {
  return ctx.sessionManager.getSessionId() ?? "";
}

/**
 * Fresh, non-aliasing EMPTY_STATE copy (never returns `EMPTY_STATE.tasks`).
 *
 * Complexity: O(1).
 */
function freshState(): TaskState {
  return { tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId };
}

/**
 * Get-or-read a session's slot: the committed slot by identity, or a fresh
 * EMPTY_STATE copy (not stored) when the slot is absent.
 *
 * Complexity: O(1).
 */
function slotFor(sessionId: string): TaskState {
  return sessions.get(sessionId) ?? freshState();
}

/**
 * Live tasks accessor for a session. Returned `readonly Task[]` so callers
 * (overlay render hook, /todos command, renderCall subject lookup) cannot
 * mutate the live slot. Consumers must not cast back.
 *
 * Complexity: O(1).
 */
export function getTodos(sessionId: string): readonly Task[] {
  return slotFor(sessionId).tasks;
}

/**
 * Complexity: O(1).
 */
export function getNextId(sessionId: string): number {
  return slotFor(sessionId).nextId;
}

/**
 * Snapshot accessor used by reducer callers to pass canonical state in.
 *
 * Complexity: O(1).
 */
export function getState(sessionId: string): TaskState {
  return slotFor(sessionId);
}

/**
 * Replay seam. Lifecycle handlers in index.ts call this on `session_start`,
 * `session_compact`, and `session_tree` after `replayFromBranch` decodes the
 * latest snapshot, keyed to the session.
 *
 * Complexity: O(1).
 */
export function replaceState(sessionId: string, next: TaskState): void {
  sessions.set(sessionId, next);
}

/**
 * Post-reducer commit seam. Tool `execute()` calls this with the reducer's
 * `state` output to publish the new canonical state to live readers
 * (overlay, /todos, renderCall), keyed to the calling session.
 *
 * Complexity: O(1).
 */
export function commitState(sessionId: string, next: TaskState): void {
  sessions.set(sessionId, next);
}

/**
 * Drop a session's slot on `session_shutdown`. No-op if the slot is absent.
 *
 * Complexity: O(1) amortized.
 */
export function evictSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Ctx-less render reader: the slot the overlay and `renderCall` render.
 * Resolves to the `activeRenderSession` slot, or a fresh EMPTY_STATE copy
 * when no foreground has been set yet.
 *
 * Complexity: O(1).
 */
export function getRenderState(): TaskState {
  return slotFor(activeRenderSession);
}

/**
 * Set the ctx-less render pointer when the first UI session claims the
 * foreground.
 *
 * Complexity: O(1).
 */
export function setActiveRenderSession(sessionId: string): void {
  activeRenderSession = sessionId;
}

/**
 * Reads the foreground render pointer, the sid the index.ts sid-gate compares
 * against and the slot `getRenderState()` resolves to. Distinct from
 * `setActiveRenderSession` (the writer).
 *
 * Complexity: O(1).
 */
export function getActiveRenderSession(): string {
  return activeRenderSession;
}

/**
 * Foreground teardown (session_shutdown of the foreground session). Resets the
 * pointer to "" so the next `hasUI` session_start reclaims the foreground.
 *
 * Complexity: O(1).
 */
export function clearActiveRenderSession(): void {
  activeRenderSession = "";
}

/**
 * Test-setup reset. Signature unchanged, so no test setup edit is needed.
 * Clears BOTH the session Map and the render pointer so resets start from a
 * clean state.
 *
 * Complexity: O(s) for s sessions.
 */
export function __resetState(): void {
  sessions.clear();
  activeRenderSession = "";
}
