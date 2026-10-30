/** Shared fake harness for subagents keep-behavior tests: fake `pi`, fake model provider, test ctx. */

import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ModelRuntime,
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  setDefaultMaxTurns,
  setDefaultTimeoutMs,
  setGraceTurns,
  setRememberAgents,
} from "../../src/agent-runner.js";
import { registerAgents, setDefaultsDisabled, setFallbackSubagent } from "../../src/agent-types.js";
import { setOutputTranscriptDefault } from "../../src/output-file.js";
import { setWorktreeIsolationEnabled } from "../../src/worktree.js";

export const FAKE_PROVIDER_ID = "fake-test-harness";

/** A model object owned by the fake provider. Never touches the network: baseUrl is unroutable. */
export function createFakeModel(): any {
  return {
    id: "fake-echo",
    name: "Fake Echo",
    api: "openai-completions",
    provider: FAKE_PROVIDER_ID,
    baseUrl: "http://127.0.0.1:9/",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8000,
    maxTokens: 1000,
  };
}

function zeroUsage(): any {
  return {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function assistantTextMessage(model: any, text: string): any {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export function assistantToolUseMessage(model: any, id: string, name: string, args: unknown): any {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: args }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

export interface ScriptedReply {
  message: any;
  /** Text deltas to emit before `done` (what the runner collects as output). */
  deltas?: string[];
  /** When set, the stream holds after `start` until this resolves. */
  gate?: Promise<void>;
}

/**
 * Register a scripted in-process provider. Each LLM call runs `script` with its
 * 1-based index and the request context; no model calls, no network.
 */
export function installScriptedProvider(
  runtime: any,
  model: any,
  script: (call: { index: number; context: any }) => ScriptedReply,
): { callCount: () => number } {
  let calls = 0;
  const handler = (_m: any, context: any) => {
    const index = ++calls;
    const { message, deltas = [], gate } = script({ index, context });
    const stream = createAssistantMessageEventStream();
    queueMicrotask(async () => {
      stream.push({ type: "start", partial: message });
      if (gate) await gate;
      for (const delta of deltas) {
        stream.push({ type: "text_delta", contentIndex: 0, delta, partial: message });
      }
      stream.push({ type: "done", reason: "stop", message });
    });
    return stream;
  };
  runtime.registerNativeProvider({
    id: FAKE_PROVIDER_ID,
    name: "Fake Harness",
    auth: { apiKey: { name: "Fake", resolve: async () => ({ auth: { headers: {} } }) } },
    getModels: () => [model],
    stream: handler,
    streamSimple: handler,
  });
  return { callCount: () => calls };
}

/** ModelRuntime with no credentials, no catalog, no network refresh. Creates in ~10ms. */
export async function createTestRuntime(): Promise<any> {
  return ModelRuntime.create({
    authPath: join(tmpdir(), `zz-nope-${Math.random().toString(36).slice(2)}.json`),
    modelsPath: null,
    refreshOnCreate: false,
  });
}

export interface FakePi {
  pi: any;
  tools: Map<string, any>;
  handlers: Map<string, (...args: any[]) => any>;
  emitted: Array<{ event: string; payload: unknown }>;
  sentMessages: unknown[];
}

/** Fake `pi` object capturing tools, lifecycle handlers, events, and nudges. */
export function createFakePi(): FakePi {
  const tools = new Map<string, any>();
  const handlers = new Map<string, (...args: any[]) => any>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const sentMessages: unknown[] = [];
  const pi = {
    registerTool: (t: any) => {
      tools.set(t.name, t);
    },
    registerMessageRenderer: () => {},
    registerEntryRenderer: () => {},
    registerFlag: () => {},
    registerCommand: () => {},
    on: (event: string, handler: (...args: any[]) => any) => {
      handlers.set(event, handler);
    },
    getFlag: (_name: string) => undefined,
    events: {
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
      },
      on: () => () => {},
    },
    sendMessage: (message: unknown) => {
      sentMessages.push(message);
    },
    appendEntry: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    exec: failingExec,
  };
  return { pi, tools, handlers, emitted, sentMessages };
}

/** `pi.exec` stub that fails every command (env detection degrades gracefully). */
export const failingExec = async () => ({
  code: 1,
  stdout: "",
  stderr: "not available in tests",
  killed: false,
});

/** Real `pi.exec` implemented over `execFile`, for the git-backed worktree tests. */
export function createGitExec(): ExtensionAPI["exec"] {
  return ((command: string, args: string[], opts?: { cwd?: string; timeout?: number }) =>
    new Promise((resolve) => {
      execFile(
        command,
        args ?? [],
        { cwd: opts?.cwd, timeout: opts?.timeout ?? 15000 },
        (error, stdout, stderr) => {
          resolve({
            code: (error as any)?.code ?? 0,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            killed: Boolean((error as any)?.killed),
          });
        },
      );
    })) as ExtensionAPI["exec"];
}

/** Reset module-level subagents state to hermetic test values (in-memory, no transcripts). */
export function resetSubagentTestState(): void {
  setRememberAgents(false);
  setOutputTranscriptDefault(false);
  setGraceTurns(5);
  setDefaultMaxTurns(undefined);
  setDefaultTimeoutMs(undefined);
  setFallbackSubagent(undefined);
  setDefaultsDisabled(false);
  setWorktreeIsolationEnabled(true);
  registerAgents(new Map());
}

export function createTestCtx(opts: { cwd: string; model: any; runtime: any }): any {
  const sessionManager = SessionManager.inMemory(opts.cwd);
  const ui = {
    notify: () => {},
    select: async () => undefined,
    custom: async () => undefined,
    editor: async () => undefined,
    addAutocompleteProvider: () => {},
    setWidget: () => {},
    setStatus: () => {},
  };
  return {
    cwd: opts.cwd,
    getSystemPrompt: () => "parent system prompt",
    model: opts.model,
    modelRegistry: {
      find: () => opts.model,
      getAvailable: () => [opts.model],
      runtime: opts.runtime,
    },
    sessionManager,
    ui,
    mode: "print",
    hasUI: false,
    signal: undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    scopedModels: [],
  } as unknown as ExtensionContext;
}

/** Activate the extension against the fake pi and fire `session_start`. */
export async function activateExtension(
  fake: FakePi,
  ctx: ExtensionContext,
): Promise<{ tools: Map<string, any>; shutdown: () => Promise<void> }> {
  const { default: factory } = await import("../../src/index.js");
  factory(fake.pi as ExtensionAPI);
  // Factory applies persisted settings; force hermetic values before any spawn.
  resetSubagentTestState();
  await fake.handlers.get("session_start")?.({}, ctx);
  return {
    tools: fake.tools,
    shutdown: async () => {
      await fake.handlers.get("session_shutdown")?.({}, ctx);
    },
  };
}

export function useTempCwd(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function executeTool(
  tool: any,
  params: Record<string, unknown>,
  ctx: ExtensionContext,
): Promise<any> {
  return tool.execute(
    `tc-${Math.random().toString(36).slice(2)}`,
    params,
    new AbortController().signal,
    undefined,
    ctx,
  );
}

export function resultText(result: any): string {
  return result?.content?.[0]?.text ?? "";
}
