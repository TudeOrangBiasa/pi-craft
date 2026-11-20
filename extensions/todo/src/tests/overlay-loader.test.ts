import { describe, expect, test } from "bun:test";
import {
  isStaleOverlayModuleError,
  makeTodoOverlayLoader,
  type TodoOverlayModule,
} from "../overlay-loader.js";

/** Minimal namespace doubles: the loader only checks typeof TodoOverlay. */
const goodNs = { TodoOverlay: class {} } as unknown as TodoOverlayModule;
const poisonedNs = { notAThing: 1 } as unknown as TodoOverlayModule;

describe("overlay loader", () => {
  test("loads once and memoizes the module", async () => {
    let calls = 0;
    const load = makeTodoOverlayLoader(async () => {
      calls += 1;
      return goodNs;
    });
    const first = await load();
    expect(await load()).toBe(first);
    expect(calls).toBe(1);
  });

  test("drops rejected imports so retry works", async () => {
    let calls = 0;
    const load = makeTodoOverlayLoader(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return goodNs;
    });
    await expect(load()).rejects.toThrow("transient");
    expect(await load()).toBe(goodNs);
    expect(calls).toBe(2);
  });

  test("latches poisoned namespaces into a restart error", async () => {
    let calls = 0;
    const load = makeTodoOverlayLoader(async () => {
      calls += 1;
      return poisonedNs;
    });
    const first = await load().catch((e) => e);
    expect(String(first)).toContain("restart Pi");
    expect(isStaleOverlayModuleError(first)).toBe(true);
    // Latched: the jiti cache replays the same namespace, so no retry.
    const second = await load().catch((e) => e);
    expect(String(second)).toContain("restart Pi");
    expect(calls).toBe(1);
  });

  test("stale predicate ignores other errors", () => {
    expect(isStaleOverlayModuleError(new Error("nope"))).toBe(false);
    expect(isStaleOverlayModuleError(undefined)).toBe(false);
  });
});
