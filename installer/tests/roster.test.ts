import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROSTER } from "../roster.js";

// Roster: the single typed deploy driver must match the REGISTRY.md contract
// it documents (all core, no opt-ins).
describe("roster", () => {
  const registry = readFileSync(
    join(import.meta.dir, "..", "..", "extensions", "REGISTRY.md"),
    "utf-8",
  );

  test("roster covers every vendored REGISTRY.md entry", () => {
    expect(new Set(ROSTER).size).toBe(ROSTER.length);
    expect([...ROSTER]).toEqual([
      "tool-repair",
      "hashline",
      "subagents",
      "fff",
      "safety-net",
      "ask",
      "todo",
    ]);
    for (const name of ROSTER) {
      expect(registry).toContain(`| \`${name}\` |`);
      expect(registry).toContain("| core |");
    }
  });
});
