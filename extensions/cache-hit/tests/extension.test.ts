import { expect, test, vi } from "bun:test";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import cacheHitPredictor from "../index.js";

type Handler = (event: never, ctx: ExtensionContext) => unknown;

function setup(thinkingLevel: unknown) {
  const handlers = new Map<string, Handler>();
  const notifications: string[] = [];
  const pi = {
    events: {},
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    getThinkingLevel: () => thinkingLevel,
  } as unknown as ExtensionAPI;
  cacheHitPredictor(pi);

  async function fire(event: string, payload: unknown, ctx: ExtensionContext) {
    await handlers.get(event)?.(payload as never, ctx);
  }

  // The extension coalesces back-to-back selections onto a zero-delay timer.
  // Advancing the fake clock flushes it with no real wait.
  function flushPredictions() {
    vi.advanceTimersByTime(0);
  }

  return { handlers, notifications, fire, flushPredictions };
}

function usage() {
  return {
    input: 17_000,
    output: 10,
    cacheRead: 8_000,
    cacheWrite: 0,
    totalTokens: 25_010,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

const oldModel = {
  provider: "openai",
  api: "openai-responses",
  id: "gpt-old",
  name: "Old",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 10_000,
} as const;

function branch(): SessionEntry[] {
  return [
    {
      type: "thinking_level_change",
      id: "00000001",
      parentId: null,
      timestamp: new Date(1_000).toISOString(),
      thinkingLevel: "low",
    },
    {
      type: "message",
      id: "00000002",
      parentId: "00000001",
      timestamp: new Date(2_000).toISOString(),
      message: {
        role: "assistant",
        content: [],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-old",
        usage: usage(),
        stopReason: "stop",
        timestamp: 2_000,
      },
    },
  ] as SessionEntry[];
}

function ctxFor(model: unknown, notifications: string[], tokens: unknown) {
  return {
    mode: "tui",
    model,
    getContextUsage: () => ({
      tokens,
      contextWindow: 200_000,
      percent: 50,
    }),
    sessionManager: { getBranch: () => branch() },
    modelRegistry: { find: () => undefined },
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionContext;
}

test("coalesces a model clamp into one inline notification", async () => {
  vi.useFakeTimers();
  try {
    const { fire, flushPredictions, notifications } = setup("high");
    const newModel = { ...oldModel, id: "gpt-new", name: "New" };
    const ctx = ctxFor(newModel, notifications, 100_000);

    await fire("session_start", {}, ctx);
    await fire("thinking_level_select", { level: "high", previousLevel: "low" }, ctx);
    await fire("model_select", { model: newModel, previousModel: oldModel, source: "set" }, ctx);
    expect(notifications).toHaveLength(0);
    flushPredictions();

    expect(notifications).toEqual([
      "Cache hit prediction · gpt-new · high: cold lane (0% of ~100k)",
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("a broken model identity stays silent instead of notifying", async () => {
  vi.useFakeTimers();
  try {
    const { fire, flushPredictions, notifications } = setup("high");
    const broken = { ...oldModel, id: "   ", name: "Broken" };
    const ctx = ctxFor(broken, notifications, 100_000);

    await fire("session_start", {}, ctx);
    await fire("model_select", { model: broken, previousModel: oldModel, source: "set" }, ctx);
    flushPredictions();

    expect(notifications).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test("an invalid prompt size degrades to the no-prompt message", async () => {
  vi.useFakeTimers();
  try {
    const { fire, flushPredictions, notifications } = setup("low");
    const knownModel = { ...oldModel, name: "Old" };
    const ctx = ctxFor(knownModel, notifications, NaN);

    await fire("session_start", {}, ctx);
    await fire(
      "model_select",
      {
        model: knownModel,
        previousModel: { ...oldModel, id: "other" },
        source: "set",
      },
      ctx,
    );
    flushPredictions();

    expect(notifications).toEqual(["Cache hit prediction · gpt-old · low: ~25k cached"]);
  } finally {
    vi.useRealTimers();
  }
});

test("an unknown reasoning level falls back instead of failing", async () => {
  vi.useFakeTimers();
  try {
    const { fire, flushPredictions, notifications } = setup(undefined);
    const newModel = { ...oldModel, id: "gpt-new", name: "New" };
    const ctx = ctxFor(newModel, notifications, 100_000);

    await fire("session_start", {}, ctx);
    await fire("thinking_level_select", { level: "", previousLevel: "low" }, ctx);
    await fire("model_select", { model: newModel, previousModel: oldModel, source: "set" }, ctx);
    flushPredictions();

    expect(notifications).toEqual([
      "Cache hit prediction · gpt-new · unknown: cold lane (0% of ~100k)",
    ]);
  } finally {
    vi.useRealTimers();
  }
});
