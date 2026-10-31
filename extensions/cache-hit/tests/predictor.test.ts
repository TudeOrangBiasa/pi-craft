import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  cacheLaneKey,
  makeCacheLane,
  normalizeLanePart,
  predictCacheHit,
  promptTokens,
  recordAssistantUsage,
  sanitizeNullableTokens,
  scanCacheHistory,
} from "../src/predictor.js";

let nextId = 0;

function base(type: string) {
  nextId += 1;
  return {
    type,
    id: nextId.toString(16).padStart(8, "0"),
    parentId: nextId === 1 ? null : (nextId - 1).toString(16).padStart(8, "0"),
    timestamp: new Date(nextId * 1_000).toISOString(),
  };
}

function thinking(level: unknown): SessionEntry {
  return {
    ...base("thinking_level_change"),
    type: "thinking_level_change",
    thinkingLevel: level,
  } as unknown as SessionEntry;
}

function usage(partial: Record<string, unknown>) {
  return {
    input: 0,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    ...partial,
  };
}

function assistant(model: string, prompt: number, timestamp: number, cacheRead = 0): SessionEntry {
  return {
    ...base("message"),
    type: "message",
    message: {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "openai",
      model,
      usage: {
        ...usage({ input: prompt - cacheRead, cacheRead }),
        totalTokens: prompt + 10,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop",
      timestamp,
    },
  } as SessionEntry;
}

function assistantWithUsage(
  model: unknown,
  usageValue: unknown,
  provider: unknown = "openai",
  api: unknown = "openai-responses",
): SessionEntry {
  return {
    ...base("message"),
    type: "message",
    message: {
      role: "assistant",
      content: [],
      api,
      provider,
      model,
      usage: usageValue,
      stopReason: "stop",
      timestamp: 1_000,
    },
  } as unknown as SessionEntry;
}

describe("cache lane history", () => {
  test("uses the live reasoning level when old sessions have no initial entry", () => {
    const history = scanCacheHistory([assistant("gpt-test", 25_000, 1_000, 8_000)], "medium");

    expect([...history.lanes.values()][0]?.thinkingLevel).toBe("medium");
  });

  test("keeps separate snapshots for reasoning levels", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
      thinking("high"),
      assistant("gpt-test", 100_000, 2_000, 24_000),
    ]);

    expect(history.lanes.size).toBe(2);
    expect(
      history.lanes.get(
        cacheLaneKey({
          provider: "openai",
          api: "openai-responses",
          model: "gpt-test",
          thinkingLevel: "low",
        }),
      )?.promptTokens,
    ).toBe(25_000);
  });

  test("drops incompatible pre-compaction snapshots", () => {
    const compaction = {
      ...base("compaction"),
      type: "compaction",
      summary: "summary",
      firstKeptEntryId: "00000001",
      tokensBefore: 50_000,
    } as SessionEntry;
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-old", 50_000, 1_000, 20_000),
      compaction,
      assistant("gpt-new", 10_000, 2_000, 0),
    ]);

    expect(history.lanes.size).toBe(1);
    expect([...history.lanes.values()][0]?.model).toBe("gpt-new");
  });
});

describe("cache hit prediction", () => {
  test("bounds the old lane prefix by the current prompt", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
    ]);
    const prediction = predictCacheHit(
      history,
      {
        provider: "openai",
        api: "openai-responses",
        model: "gpt-test",
        thinkingLevel: "low",
      },
      100_000,
    );

    expect(prediction.estimatedCacheTokens).toBe(25_000);
    expect(prediction.percent).toBe(25);
  });

  test("reports an unseen destination as cold", () => {
    const history = scanCacheHistory([
      thinking("high"),
      assistant("gpt-test", 100_000, 1_000, 20_000),
    ]);
    const prediction = predictCacheHit(
      history,
      {
        provider: "openai",
        api: "openai-responses",
        model: "gpt-test",
        thinkingLevel: "low",
      },
      100_000,
    );

    expect(prediction.hasLaneHistory).toBe(false);
    expect(prediction.estimatedCacheTokens).toBe(0);
    expect(prediction.percent).toBe(0);
  });
});

describe("lane hardening", () => {
  test("separator-like model ids cannot collide lanes", () => {
    const tricky = makeCacheLane('a","b', "c", "d", "low");
    const plain = makeCacheLane("a", 'b","c', "d", "low");
    expect(cacheLaneKey(tricky)).not.toBe(cacheLaneKey(plain));
  });

  test("blank lane parts throw instead of keying silently", () => {
    expect(() => makeCacheLane("  ", "api", "model", "low")).toThrow();
    expect(() => makeCacheLane("p", "", "model", "low")).toThrow();
    expect(() =>
      cacheLaneKey({
        provider: "p",
        api: "a",
        model: "  ",
        thinkingLevel: "low",
      }),
    ).toThrow();
  });

  test("unknown and blank reasoning levels fall back explicitly", () => {
    expect(makeCacheLane("p", "a", "m", "  ").thinkingLevel).toBe("unknown");
    expect(makeCacheLane("p", "a", "m", undefined).thinkingLevel).toBe("unknown");
    expect(normalizeLanePart(" high ")).toBe("high");
    expect(normalizeLanePart("")).toBe(null);
    const history = scanCacheHistory([thinking("  ")]);
    expect(history.lanes.size).toBe(0);
  });

  test("invalid prompt sizes read as missing, never NaN", () => {
    expect(promptTokens(usage({ input: NaN, cacheRead: 10 }))).toBe(10);
    expect(promptTokens(usage({ input: -5, cacheRead: 8 }))).toBe(8);
    expect(promptTokens(usage({ input: Infinity }))).toBe(0);
    expect(sanitizeNullableTokens(NaN)).toBe(null);
    expect(sanitizeNullableTokens(-100)).toBe(null);
    expect(sanitizeNullableTokens(0)).toBe(null);
    expect(sanitizeNullableTokens(10.9)).toBe(10);
  });

  test("corrupt entries are skipped, not fatal", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
      assistantWithUsage("gpt-test", usage({ input: NaN })),
      assistantWithUsage("", usage({ input: 50_000 })),
      assistantWithUsage("gpt-test", null),
      null,
    ] as unknown as SessionEntry[]);
    expect(history.lanes.size).toBe(1);
    expect([...history.lanes.values()][0]?.promptTokens).toBe(25_000);
  });

  test("recordAssistantUsage ignores broken messages and keeps the old lane", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
    ]);
    const lane = makeCacheLane("openai", "openai-responses", "gpt-test", "low");
    recordAssistantUsage(history, null as never, lane);
    recordAssistantUsage(history, { role: "user" } as never, lane);
    expect(history.lanes.size).toBe(1);
    expect(history.lanes.get(cacheLaneKey(lane))?.promptTokens).toBe(25_000);
  });

  test("prediction treats invalid current prompts as missing", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
    ]);
    const lane = makeCacheLane("openai", "openai-responses", "gpt-test", "low");
    const missing = predictCacheHit(history, lane, NaN);
    expect(missing.currentPromptTokens).toBe(null);
    expect(missing.percent).toBe(null);
    expect(missing.estimatedCacheTokens).toBe(25_000);
  });
});

describe("lane switch performance", () => {
  test("many lanes stay on the Map hot path", () => {
    const history = scanCacheHistory([]);
    const lanes = Array.from({ length: 2_000 }, (_, i) =>
      makeCacheLane("openai", "openai-responses", `gpt-${i}`, "low"),
    );
    for (const lane of lanes) {
      history.lanes.set(cacheLaneKey(lane), { ...lane, promptTokens: 25_000 });
    }

    let total = 0;
    for (let round = 0; round < 5; round += 1) {
      for (const lane of lanes) {
        total += predictCacheHit(history, lane, 100_000).estimatedCacheTokens;
      }
    }

    expect(total).toBe(2_000 * 5 * 25_000);
    expect(history.lanes.size).toBe(2_000);
  });
});
