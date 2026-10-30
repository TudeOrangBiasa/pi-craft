/** Removed surfaces (#6): legacy `allowed_subagents`/`memory` frontmatter warns, not errors. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { loadCustomAgents } from "../src/custom-agents.js";

let cwd = "";
let warnings: string[] = [];
const origWarn = console.warn;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "subagents-frontmatter-"));
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.warn = origWarn;
  rmSync(cwd, { recursive: true, force: true });
});

function writeAgentFile(frontmatter: string): void {
  const dir = join(cwd, ".pi", "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "legacy.md"), `---\n${frontmatter}\n---\n\nYou are a legacy agent.\n`);
}

test("legacy allowed_subagents + memory frontmatter loads with warnings, not errors", () => {
  writeAgentFile("description: legacy\nallowed_subagents: all\nmemory: project");
  const agents = loadCustomAgents(cwd);
  const cfg = agents.get("legacy");
  expect(cfg).toBeDefined();
  expect(cfg).not.toHaveProperty("allowedSubagents");
  expect(cfg).not.toHaveProperty("memory");
  expect(cfg?.description).toBe("legacy");
  expect(warnings.some((w) => w.includes("allowed_subagents"))).toBe(true);
  expect(warnings.some((w) => w.includes('"memory"'))).toBe(true);
});

test("repeat load does not re-warn (one-time warning)", () => {
  writeAgentFile("description: legacy\nallowed_subagents: Explore\nmemory: user");
  loadCustomAgents(cwd);
  const first = warnings.length;
  loadCustomAgents(cwd);
  expect(first).toBeGreaterThan(0);
  expect(warnings.length).toBe(first);
});
