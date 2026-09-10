import { describe, expect, test } from "bun:test";
import { handleCommand, rules } from "../omfg.js";

const fakeCtx = (seen: string[]) =>
  ({
    ui: { notify: (m: string) => void seen.push(m) },
  }) as never;

describe("omfg rule add", () => {
  test("bad scope warns instead of throwing", async () => {
    rules.length = 0;
    const seen: string[] = [];
    await handleCommand("rule add replace x foo bar --scope bogus", fakeCtx(seen));
    expect(rules.length).toBe(0);
    expect(seen.join("\n")).toContain("Bad scope");
  });

  test("valid add works and duplicates are rejected", async () => {
    rules.length = 0;
    const seen: string[] = [];
    await handleCommand("rule add replace x foo bar", fakeCtx(seen));
    expect(rules.length).toBe(1);
    await handleCommand("rule add replace x foo bar", fakeCtx(seen));
    expect(rules.length).toBe(1);
    expect(seen.join("\n")).toContain("already exists");
    rules.length = 0;
  });

  test("bad transform kind warns", async () => {
    rules.length = 0;
    const seen: string[] = [];
    await handleCommand("rule add transform t --transform trimm", fakeCtx(seen));
    expect(rules.length).toBe(0);
    expect(seen.join("\n")).toContain("Bad transform");
  });
});
