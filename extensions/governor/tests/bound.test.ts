import { describe, expect, test } from "bun:test";
import { boundText, tailModeFor } from "../governor.js";

const big = (n: number, len = 10): string =>
  Array.from({ length: n }, (_, i) => `l${i}`.padEnd(len, "x")).join("\n");
describe("governor bound", () => {
  test("trailing newline is a terminator, not an extra line", () => {
    const r = boundText("a\nb\n", "head");
    expect(r.truncated).toBe(false);
    expect(r.totalLines).toBe(2);
  });

  test("under-limit text passes through untouched", () => {
    const r = boundText("a\nb", "head");
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("a\nb");
  });
  test("head mode keeps the first lines + notice", () => {
    const r = boundText(big(600), "head");
    expect(r.truncated).toBe(true);
    expect(r.keptLines).toBe(500);
    expect(r.text.startsWith("l0")).toBe(true);
    expect(r.text).toContain("showing first 500 of 600");
  });

  test("tail mode keeps the last lines + notice", () => {
    const r = boundText(big(600), "tail");
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("l599");
    expect(r.text).toContain("showing last");
    expect(r.text.startsWith("l0")).toBe(false);
  });

  test("byte limit can cut before line limit", () => {
    const r = boundText(big(100, 2000), "head");
    expect(r.truncated).toBe(true);
    expect(r.keptLines).toBeLessThan(100);
  });

  test("single over-byte line passes through without lying notice", () => {
    const blob = "x".repeat(60 * 1024);
    const r = boundText(blob, "head");
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(blob);
  });

  test("tail mode selects errors at the end", () => {
    expect(tailModeFor("bash")).toBe("tail");
    expect(tailModeFor("powershell")).toBe("tail");
    expect(tailModeFor("read")).toBe("head");
    expect(tailModeFor("ffgrep")).toBe("head");
  });
});
