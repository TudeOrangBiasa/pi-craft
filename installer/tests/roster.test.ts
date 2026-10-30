import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROSTER } from "../roster.js";

// Roster: the single typed deploy driver must match the REGISTRY.md contract
// it documents (12 core packages, 3 owned extensions, parked opt-ins).
describe("roster", () => {
  const registry = readFileSync(
    join(import.meta.dir, "..", "..", "extensions", "REGISTRY.md"),
    "utf-8",
  );

  test("roster covers every vendored REGISTRY.md entry with matching tier", () => {
    const names = ROSTER.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(ROSTER.filter((entry) => entry.tier === "core")).toHaveLength(11);
    expect(ROSTER.filter((entry) => entry.tier === "opt-in").map((entry) => entry.name)).toEqual([
      "web",
    ]);
    for (const entry of ROSTER) {
      expect(registry).toContain(`| \`${entry.name}\` |`);
      expect(registry).toContain(`| ${entry.tier} |`);
    }
  });
});
