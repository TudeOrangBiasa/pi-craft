/** Keep-behavior: turn-limit wrap-up produces a partial result (status `steered`). */

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
let callCount = () => 0;

beforeEach(async () => {
	cwd = useTempCwd("subagents-turns-");
	writeFileSync(join(cwd, "notes.txt"), "some research notes\n");
	model = createFakeModel();
	const runtime = await createTestRuntime();
	// Loop on the read tool until the soft-limit steer arrives, then wrap up with text.
	const provider = installScriptedProvider(runtime, model, ({ index, context }) => {
		const steered = JSON.stringify(context.messages).includes("turn limit");
		if (steered) {
			return { message: assistantTextMessage(model, "partial-wrap-up"), deltas: ["partial-wrap-up"] };
		}
		return {
			message: assistantToolUseMessage(model, `tc-${index}`, "read", { path: join(cwd, "notes.txt") }),
		};
	});
	callCount = provider.callCount;
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

test("hitting max_turns steers to wrap-up and keeps the partial result", async () => {
	const result = await executeTool(
		tools.get("Agent"),
		{
			prompt: "keep researching forever",
			description: "loopy research",
			subagent_type: "general-purpose",
			run_in_background: false,
			max_turns: 2,
			isolated: true,
		},
		ctx,
	);
	expect(result.details.status).toBe("steered");
	expect(callCount()).toBe(3);
	const text = resultText(result);
	expect(text).toContain("partial-wrap-up");
	expect(text).toMatch(/wrap.?up/i);
});
