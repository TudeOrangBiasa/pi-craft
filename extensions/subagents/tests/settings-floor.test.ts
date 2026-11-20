import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../src/settings.js";

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) {
    saved.set(key, process.env[key]);
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

let scratch: string | undefined;

afterEach(() => {
  if (scratch !== undefined) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
});

describe("subagents settings floors", () => {
  test("maxConcurrentForeground 0 survives (unlimited), maxConcurrent 0 is dropped", async () => {
    scratch = mkdtempSync(join(tmpdir(), "subagents-floors-"));
    const agentDir = join(scratch, "agent");
    const projectDir = join(scratch, "project");
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(
      join(projectDir, ".pi", "subagents.json"),
      JSON.stringify({ maxConcurrentForeground: 0, maxConcurrent: 0 }),
    );
    await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
      mkdirSync(agentDir, { recursive: true });
      expect(loadSettings(projectDir)).toEqual({ maxConcurrentForeground: 0 });
    });
  });

  test("ordinary power-user values pass through unclamped", async () => {
    scratch = mkdtempSync(join(tmpdir(), "subagents-ceilings-"));
    const agentDir = join(scratch, "agent");
    const projectDir = join(scratch, "project");
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
    writeFileSync(
      join(projectDir, ".pi", "subagents.json"),
      JSON.stringify({ maxConcurrent: 64, defaultMaxTurns: 500 }),
    );
    await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
      mkdirSync(agentDir, { recursive: true });
      expect(loadSettings(projectDir)).toEqual({ maxConcurrent: 64, defaultMaxTurns: 500 });
    });
  });
});
