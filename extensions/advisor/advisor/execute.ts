/**
 * execute — the advisor side-call. Curates the executor's branch (inventory
 * prefix + tail massaging), invokes the advisor model via completeSimple with
 * no tools, and returns a structured tool result. Every result branch (success
 * / abort / error / empty) and the pre-call error paths funnel through
 * buildAdvisorResult so the envelope is built in exactly one place.
 */

import type { AssistantMessage, Message, StopReason, TextContent, ThinkingLevel, Usage } from "@earendil-works/pi-ai";
import {
	type AgentToolResult,
	type AgentToolUpdateCallback,
	buildSessionContext,
	convertToLlm,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { ensureUserTailForAdvisor, stripInflightAdvisorCall } from "./context.js";
import { getInventoryMessage } from "./inventory.js";
import {
	ERR_ABORTED_DETAIL,
	ERR_CALL_ABORTED,
	ERR_EMPTY_RESPONSE,
	ERR_EMPTY_RESPONSE_DETAIL,
	ERR_NO_MODEL,
	ERR_NO_MODEL_SELECTED,
	errCallFailed,
	errCallThrew,
	errMisconfigured,
	errNoApiKey,
	errNoApiKeyDetail,
	msgConsulting,
} from "./messages.js";
import { getRuntimeCompleteSimple, loadCompleteSimple } from "./pi-compat.js";
import { ADVISOR_SYSTEM_PROMPT } from "./prompt.js";
import { getAdvisorEffort, getAdvisorModel } from "./state.js";

interface AdvisorDetails {
	advisorModel?: string;
	effort?: ThinkingLevel;
	usage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
}

// Single result-envelope builder — every executeAdvisor branch and the pre-call
// error paths funnel through here. `effort` is snapshotted once at executeAdvisor
// entry and threaded through every call so the returned details.effort always
// matches the value sent as `reasoning` to completeSimple, even if module-level
// state is mutated during the await window.
function advisorTextFromResponse(response: AssistantMessage): string {
	return response.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

// Payload bound: full-branch forwards bill full context at the strongest-model
// rate with zero backpressure. Cap text chars, keeping the inventory head plus
// the newest tail; a dropped prefix is announced, never silent.
// Boundary `as Message` below: literals constructed to pi-ai shape; the cast
// only crosses the library boundary, never unvalidated input.
function textCharsOf(message: Message): number {
	if (typeof message !== "object" || message === null || !("content" in message)) return 0;
	const content: unknown = message.content;
	if (!Array.isArray(content)) return 0;
	let n = 0;
	for (const part of content) {
		if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
			const text: unknown = part.text;
			if (typeof text === "string") n += text.length;
		}
	}
	return n;
}

const MAX_ADVISOR_CHARS = 150_000;
export function capAdvisorMessages(messages: Message[]): { messages: Message[]; dropped: number } {
	const sizes = messages.map(textCharsOf);
	const total = sizes.reduce((a, b) => a + b, 0);
	if (total <= MAX_ADVISOR_CHARS) return { messages, dropped: 0 };
	// Always keep message 0 (tool inventory prefix); fill the tail newest-first,
	// then restore chronological order. Dropped prefix is announced, never silent.
	const tail: Message[] = [];
	let budget = MAX_ADVISOR_CHARS - (sizes[0] ?? 0);
	let dropped = 0;
	for (let i = messages.length - 1; i >= 1; i--) {
		const cost = sizes[i] ?? 0;
		if (cost > budget) {
			dropped = i;
			break;
		}
		budget -= cost;
		tail.push(messages[i]!);
	}
	tail.reverse();
	const capped: Message[] = [messages[0]!];
	if (dropped > 0) {
		capped.push({
			role: "user",
			content: [{ type: "text", text: `[advisor context capped: oldest ${dropped} message(s) dropped to fit ${MAX_ADVISOR_CHARS} chars]` }],
		} as Message);
	}
	capped.push(...tail);
	return { messages: capped, dropped };
}

// Single result-envelope builder — every executeAdvisor branch and the pre-call
// error paths funnel through here. `effort` is snapshotted once at executeAdvisor
// entry and threaded through every call so the returned details.effort always
// matches the value sent as `reasoning` to completeSimple, even if module-level
// state is mutated during the await window.
function buildAdvisorResult(opts: {
	text: string;
	effort: ThinkingLevel | undefined;
	advisorLabel?: string;
	usage?: Usage;
	stopReason?: StopReason;
	errorMessage?: string;
}): AgentToolResult<AdvisorDetails> {
	const details: AdvisorDetails = { effort: opts.effort };
	if (opts.advisorLabel !== undefined) details.advisorModel = opts.advisorLabel;
	if (opts.usage !== undefined) details.usage = opts.usage;
	if (opts.stopReason !== undefined) details.stopReason = opts.stopReason;
	if (opts.errorMessage !== undefined) details.errorMessage = opts.errorMessage;
	return { content: [{ type: "text", text: opts.text }], details };
}

function buildErrorResult(
	advisorLabel: string | undefined,
	effort: ThinkingLevel | undefined,
	userText: string,
	errorMessage: string,
): AgentToolResult<AdvisorDetails> {
	return buildAdvisorResult({ text: userText, effort, advisorLabel, errorMessage });
}

export async function executeAdvisor(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<AdvisorDetails> | undefined,
): Promise<AgentToolResult<AdvisorDetails>> {
	// Snapshot effort once at entry — every result envelope and the API call
	// itself use this same value so a concurrent setAdvisorEffort() during the
	// await window cannot desync details.effort from the `reasoning` actually sent.
	const effort = getAdvisorEffort();
	const advisor = getAdvisorModel();
	if (!advisor) {
		return buildErrorResult(undefined, effort, ERR_NO_MODEL, ERR_NO_MODEL_SELECTED);
	}
	const advisorLabel = `${advisor.provider}:${advisor.id}`;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
	if (!auth.ok) {
		return buildErrorResult(advisorLabel, effort, errMisconfigured(advisorLabel, auth.error), auth.error);
	}
	// OAuth-backed providers resolve `{ ok: true }` with no literal apiKey — their
	// credentials are applied inside Pi's runtime facade. A missing key is only
	// fatal on legacy hosts without that facade, where the global completion
	// fallback needs the key passed explicitly.
	const runtimeCompleteSimple = getRuntimeCompleteSimple(ctx.modelRegistry);
	if (!auth.apiKey && !runtimeCompleteSimple) {
		return buildErrorResult(advisorLabel, effort, errNoApiKey(advisorLabel), errNoApiKeyDetail(advisor.provider));
	}

	// Live-read every call — advisor runs mid-turn so any message_end snapshot
	// is always one turn stale. buildSessionContext() preserves Pi's resolved
	// LLM context, including compaction summaries and branch summaries, instead
	// of replaying raw pre-compaction branch messages. convertToLlm is
	// pass-through for user/assistant/toolResult (messages.js:111-114), so
	// element refs are stable across calls via the session store.
	const { messages: sessionMessages } = buildSessionContext(
		ctx.sessionManager.getEntries(),
		ctx.sessionManager.getLeafId(),
	);
	const branchMessages = ensureUserTailForAdvisor(stripInflightAdvisorCall(convertToLlm(sessionMessages)));
	const inventoryMessage = getInventoryMessage(pi.getAllTools());
	const messages: Message[] = inventoryMessage ? [inventoryMessage, ...branchMessages] : branchMessages;
	const capped = capAdvisorMessages(messages);
	const sendMessages = capped.messages;

	onUpdate?.({
		content: [{ type: "text", text: msgConsulting(advisorLabel, effort) }],
		details: { advisorModel: advisorLabel, effort },
	});

	try {
		// Prefer Pi's auth-aware runtime facade (resolved once above, before the
		// missing-key guard). Unlike the global compatibility function, it runs
		// request preparation and applies credential-derived fields such as GitHub
		// Copilot's OAuth-specific baseUrl. Do not pass the preflight key/headers
		// to this path: explicit overrides would bypass that resolution and
		// reintroduce the endpoint mismatch.
		const completeSimple = runtimeCompleteSimple ?? (await loadCompleteSimple());
		const requestOptions = runtimeCompleteSimple
			? { signal, reasoning: effort }
			: { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort };

		// Single dispatch point — both attempts reuse the SAME capped `messages`
		// and `requestOptions`, so the retry cannot diverge from attempt 1. `tools: []`
		// reaffirms the "never calls tools" contract even when `messages` contains
		// prior toolCall/toolResult blocks (btw.ts:235).
		const callAdvisor = (): Promise<AssistantMessage> =>
			completeSimple(advisor, { systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: sendMessages, tools: [] }, requestOptions);

		// Build the terminal envelope for an aborted/error stopReason, or return
		// undefined when the attempt produced a normal stop whose text (or lack of
		// text) the caller must still resolve. Aborted/error short-circuit and are
		// NEVER retried — they are not the empty-response class R6.4 targets.
		const stopReasonEnvelope = (r: AssistantMessage): AgentToolResult<AdvisorDetails> | undefined => {
			if (r.stopReason === "aborted") {
				return buildAdvisorResult({
					text: ERR_CALL_ABORTED,
					effort,
					advisorLabel,
					usage: r.usage,
					stopReason: r.stopReason,
					errorMessage: r.errorMessage ?? ERR_ABORTED_DETAIL,
				});
			}
			if (r.stopReason === "error") {
				return buildAdvisorResult({
					text: errCallFailed(r.errorMessage),
					effort,
					advisorLabel,
					usage: r.usage,
					stopReason: r.stopReason,
					errorMessage: r.errorMessage,
				});
			}
			return undefined;
		};

		let response = await callAdvisor();

		// Aborted/error short-circuit on the first attempt — no retry.
		const firstTerminal = stopReasonEnvelope(response);
		if (firstTerminal) return firstTerminal;

		let advisorText = advisorTextFromResponse(response);

		// R6.4: a transient empty advisor response (normal stop, no text) gets
		// exactly ONE retry with identical inputs before surfacing as a terminal
		// error. Bounded to a single second call — never a `while`/loop — so a
		// persistent-empty provider cannot hot-loop. The retry reuses the SAME
		// pre-computed `messages`/`requestOptions` (no re-derivation that could
		// diverge from attempt 1), then applies the same three-way route.
		if (!advisorText) {
			response = await callAdvisor();

			const retryTerminal = stopReasonEnvelope(response);
			if (retryTerminal) return retryTerminal;

			advisorText = advisorTextFromResponse(response);
			if (!advisorText) {
				return buildAdvisorResult({
					text: ERR_EMPTY_RESPONSE,
					effort,
					advisorLabel,
					usage: response.usage,
					stopReason: response.stopReason,
					errorMessage: ERR_EMPTY_RESPONSE_DETAIL,
				});
			}
		}

		return buildAdvisorResult({
			text: advisorText,
			effort,
			advisorLabel,
			usage: response.usage,
			stopReason: response.stopReason,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return buildErrorResult(advisorLabel, effort, errCallThrew(message), message);
	}
}
