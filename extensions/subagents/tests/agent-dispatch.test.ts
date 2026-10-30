/** Keep-behavior: unknown subagent_type refused under fallbackSubagent:none (ADR-0002 negative case). */

import { rmSync } from "node:fs";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { setFallbackSubagent } from "../src/agent-types.js";
import {
	activateExtension,
	assistantTextMessage,
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
let callCount = () => 0;

beforeEach(async () => {
	cwd = useTempCwd("subagents-dispatch-");
	const model = createFakeModel();
	const runtime = await createTestRuntime();
	const provider = installScriptedProvider(runtime, model, () => ({
		message: assistantTextMessage(model, "must never run"),
		deltas: ["must never run"],
	}));
	callCount = provider.callCount;
	fake = createFakePi();
	ctx = createTestCtx({ cwd, model, runtime });
	const activated = await activateExtension(fake, ctx);
	tools = activated.tools;
	shutdown = activated.shutdown;
	setFallbackSubagent("none");
});

afterEach(async () => {
	await shutdown();
	resetSubagentTestState();
	rmSync(cwd, { recursive: true, force: true });
});

test("unknown subagent_type is refused and spawns nothing", async () => {
	const result = await executeTool(
		tools.get("Agent"),
		{
			prompt: "anything",
			description: "refused",
			subagent_type: "no-such-agent-xyz",
			run_in_background: false,
			isolated: true,
		},
		ctx,
	);
	expect(resultText(result)).toStartWith('Unknown or disabled agent type: "no-such-agent-xyz"');
	expect(result.details?.agentId).toBeUndefined();
	expect(callCount()).toBe(0);
});
