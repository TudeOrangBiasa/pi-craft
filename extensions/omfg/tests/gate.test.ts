import { describe, expect, test } from "bun:test";
import { applyTextRules, rules } from "../omfg.js";

describe("gate rules", () => {
  test("same gate blocks on consecutive evaluations (no lastIndex flip-flop)", () => {
    rules.length = 0;
    rules.push({
      name: "no-secret",
      type: "gate",
      scope: ["post"],
      enabled: true,
      pattern: "secret",
      flags: "g",
      gateMessage: "[blocked]",
    });
    const first = applyTextRules("has secret here", "post");
    const second = applyTextRules("has secret here", "post");
    const third = applyTextRules("has secret here", "post");
    expect(first).toBe("[blocked]");
    expect(second).toBe("[blocked]");
    expect(third).toBe("[blocked]");
    rules.length = 0;
  });
});
