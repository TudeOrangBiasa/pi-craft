import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "@sinclair/typebox";

// Tool / command identity. TOOL_NAME must stay "todo": replay.ts filters on
// the literal (it cannot import this module without dragging typebox into
// the test graph), and old sessions already store "todo".

export const TOOL_NAME = "todo";
export const TOOL_LABEL = "Todo";
export const COMMAND_NAME = "todos";

export const ERR_REQUIRES_INTERACTIVE = "/todos requires interactive mode";
export const MSG_NO_TODOS = "No todos yet. Ask the agent to add some!";

// ---------------------------------------------------------------------------
// Public domain types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TaskStatus;
  blockedBy?: number[];
  owner?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Persistence + replay snapshot. Every successful `todo` tool call returns this
 * shape under `details`; `state/replay.ts` reads the latest one from the branch
 * to reconstruct module state. Keep field names stable: old sessions must replay.
 */
export interface TaskDetails {
  action: TaskAction;
  params: Record<string, unknown>;
  tasks: Task[];
  nextId: number;
  error?: string;
}

/**
 * Open-shape input bag the reducer accepts. Stays an interface so the index
 * signature (`[key: string]: unknown`) lets the runtime pass through TypeBox
 * `Static<typeof TodoParamsSchema>` without `as` casts.
 */
export interface TaskMutationParams {
  [key: string]: unknown;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  blockedBy?: number[];
  addBlockedBy?: number[];
  removeBlockedBy?: number[];
  owner?: string;
  metadata?: Record<string, unknown>;
  id?: number;
  includeDeleted?: boolean;
}

// TypeBox parameter schema. Every `description` doubles as LLM-facing prompt
// copy: rewording one changes what the model sees.

export const TodoParamsSchema = Type.Object({
  action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
  subject: Type.Optional(Type.String({ description: "Task subject (required for create)" })),
  description: Type.Optional(Type.String({ description: "Long-form details" })),
  activeForm: Type.Optional(
    Type.String({
      description: "Spinner label while in_progress",
    }),
  ),
  status: Type.Optional(
    StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
      description: "Set status (update) or filter (list)",
    }),
  ),
  blockedBy: Type.Optional(
    Type.Array(Type.Number(), {
      description: "Initial deps (create only)",
    }),
  ),
  addBlockedBy: Type.Optional(
    Type.Array(Type.Number(), {
      description: "Add deps (update only)",
    }),
  ),
  removeBlockedBy: Type.Optional(
    Type.Array(Type.Number(), {
      description: "Remove deps (update only)",
    }),
  ),
  owner: Type.Optional(Type.String({ description: "Assignee" })),
  metadata: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Freeform metadata (null value deletes key)",
    }),
  ),
  id: Type.Optional(
    Type.Number({
      description: "Task id (update/get/delete)",
    }),
  ),
  includeDeleted: Type.Optional(
    Type.Boolean({
      description: "Include tombstones in list",
    }),
  ),
});

export type TodoParams = Static<typeof TodoParamsSchema>;
