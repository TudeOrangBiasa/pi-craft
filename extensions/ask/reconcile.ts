/**
 * reconcile — mid-session lifecycle reconciliation for ask_user_question.
 *
 * Strips or re-adds the tool to the active set so it is invisible to the LLM
 * in non-interactive runs (no UI) and present in interactive ones. RPC hosts
 * keep the tool: they render via rpc-fallback.ts, so hasUI (not mode) is the
 * signal.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL_NAME } from "./ask-user-question.js";

/** Strip-or-restore `ask_user_question` to match `ctx.hasUI`. Idempotent. */
export function reconcileAskUserQuestionTool(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const active = pi.getActiveTools();
  const hasTool = active.includes(ASK_USER_QUESTION_TOOL_NAME);
  // !hasUI → strip; hasUI → restore. The in-handler guards stay as one-turn
  // backstops against hosts that report hasUI with no usable primitive.
  if (!ctx.hasUI && hasTool) {
    pi.setActiveTools(active.filter((n) => n !== ASK_USER_QUESTION_TOOL_NAME));
  } else if (ctx.hasUI && !hasTool) {
    pi.setActiveTools([...active, ASK_USER_QUESTION_TOOL_NAME]);
  }
}

/** Attach the reconciler to `before_agent_start`. Safe to call once at load. */
export function registerAskUserQuestionReconciler(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (_event, ctx) => reconcileAskUserQuestionTool(pi, ctx));
}
