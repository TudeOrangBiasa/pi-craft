/** Keep-behavior: background spawn + fetch, foreground inline, steer, resume. */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	activateExtension,
	assistantTextMessage,
	assistantToolUseMessage,
	createFakeModel,
	createFakePi,
	createTestCtx,
	createTestRuntime,
	executeTool,
	installScriptedProvider,
	resetSubagentTestState,
	resultText,
	useTempCwd,
	type FakePi,
} from "./helpers/fake-harness.js";

let cwd = "";
let fake: FakePi;
let ctx: any;
let tools: Map<string, any>;
let shutdown = async () => {};
let model: any;

beforeEach(async () => {
	cwd = useTempCwd("subagents-lifecycle-");
	model = createFakeModel();
	const runtime = await createTestRuntime();
	installScriptedProvider(runtime, model, ({ index }) => {
		const text = `reply-${index}`;
		return { message: assistantTextMessage(model, text), deltas: [text] };
	});
	fake = createFakePi();
	ctx = createTestCtx({ cwd, model, runtime });
	const activated = await activateExtension(fake, ctx);
	tools = activated.tools;
	shutdown = activated.shutdown;
});

afterEach(async () => {
	await shutdown();
	resetSubagentTestState();
	rmSync(cwd, { recursive: true, force: true });
});

test("spawns a background Agent and fetches it with get_subagent_result", async () => {
	const spawn = await executeTool(
		tools.get("Agent"),
		{ prompt: "do background work", description: "bg work", subagent_type: "general-purpose", isolated: true },
		ctx,
	);
	expect(spawn.details.status).toBe("background");
	expect(typeof spawn.details.agentId).toBe("string");

	const fetched = await executeTool(
		tools.get("get_subagent_result"),
		{ agent_id: spawn.details.agentId, wait: true },
		ctx,
	);
	const text = resultText(fetched);
	expect(text).toContain("Status: completed");
	expect(text).toContain("reply-1");
});

test("foreground Agent with run_in_background:false returns output inline", async () => {
	const result = await executeTool(
		tools.get("Agent"),
		{
			prompt: "do foreground work",
			description: "fg work",
			subagent_type: "general-purpose",
			run_in_background: false,
			isolated: true,
		},
		ctx,
	);
	expect(result.details.status).toBe("completed");
	const fgText = resultText(result);
	expect(fgText).toContain("Agent completed in");
	expect(fgText).toContain("reply-1");
});

test("steer_subagent reaches a running agent", async () => {
	// The agent loops on the read tool until its context carries the steer note,
	// then wraps up — so the final text proves the steer reached the live run.
	// Stream 1 is gated: it cannot finish until after the steer is sent, which
	// forces the note to arrive mid-run (stream 2) rather than racing turn 1.
	writeFileSync(join(cwd, "notes.txt"), "some research notes\n");
	const runtime = ctx.modelRegistry.runtime;
	const firstStream = Promise.withResolvers<void>();
	const streamStarted = Promise.withResolvers<void>();
	let streams = 0;
	installScriptedProvider(runtime, model, ({ index, context }) => {
		if (index === 1) streamStarted.resolve();
		streams = index;
		if (JSON.stringify(context.messages).includes("steer-note-alpha")) {
			return { message: assistantTextMessage(model, "wrapped-after-steer"), deltas: ["wrapped-after-steer"] };
		}
		if (index > 12) {
			return { message: assistantTextMessage(model, "unsteered-fallback"), deltas: ["unsteered-fallback"] };
		}
		return {
			message: assistantToolUseMessage(model, `tc-${index}`, "read", { path: join(cwd, "notes.txt") }),
			gate: index === 1 ? firstStream.promise : undefined,
		};
	});

	const spawn = await executeTool(
		tools.get("Agent"),
		{ prompt: "do slow work", description: "slow work", subagent_type: "general-purpose", isolated: true },
		ctx,
	);
	const id = spawn.details.agentId as string;
	await streamStarted.promise;

	const steer = await executeTool(tools.get("steer_subagent"), { agent_id: id, message: "steer-note-alpha" }, ctx);
	expect(resultText(steer)).toMatch(/Steering message (sent|queued)/);
	expect(fake.emitted.some((e) => e.event === "subagents:steered")).toBe(true);
	firstStream.resolve();


	const fetched = await executeTool(tools.get("get_subagent_result"), { agent_id: id, wait: true }, ctx);
	const text = resultText(fetched);
	expect(text).toContain("Status: completed");
	expect(text).toContain("wrapped-after-steer");
	expect(text).not.toContain("unsteered-fallback");
	expect(streams).toBeGreaterThanOrEqual(2);
});

test("resumes a finished agent", async () => {
	const first = await executeTool(
		tools.get("Agent"),
		{
			prompt: "first turn",
			description: "resumable",
			subagent_type: "general-purpose",
			run_in_background: false,
			isolated: true,
		},
		ctx,
	);
	expect(first.details.status).toBe("completed");
	expect(resultText(first)).toContain("reply-1");

	const resumed = await executeTool(
		tools.get("Agent"),
		{
			prompt: "continue please",
			description: "resumable",
			subagent_type: "general-purpose",
			resume: first.details.agentId,
			run_in_background: false,
			isolated: true,
		},
		ctx,
	);
	expect(resumed.details.status).toBe("completed");
	expect(resultText(resumed)).toContain("reply-2");
});
