import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, saveSettings } from "../src/settings.js";

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

describe("subagents settings", () => {
  test("unified subagents section wins; missing everything means defaults", async () => {
    scratch = mkdtempSync(join(tmpdir(), "subagents-settings-"));
    const agentDir = join(scratch, "agent");
    const projectDir = join(scratch, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
      expect(loadSettings(projectDir)).toEqual({});
    });
    writeFileSync(
      join(agentDir, "pi-craft.json"),
      JSON.stringify({ subagents: { maxConcurrent: 4 } }),
    );
    await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
      expect(loadSettings(projectDir)).toEqual({ maxConcurrent: 4 });
    });
  });

  test("legacy global file migrates into the unified section once; project overrides global", async () => {
    scratch = mkdtempSync(join(tmpdir(), "subagents-migrate-"));
    const agentDir = join(scratch, "agent");
    const projectDir = join(scratch, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(agentDir, "subagents.json"), JSON.stringify({ maxConcurrent: 4 }));
    await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
      expect(loadSettings(projectDir)).toEqual({ maxConcurrent: 4 });
      const migrated = JSON.parse(readFileSync(join(agentDir, "pi-craft.json"), "utf-8")) as {
        subagents: unknown;
      };
      expect(migrated.subagents).toEqual({ maxConcurrent: 4 });
      expect(saveSettings({ maxConcurrent: 8 }, projectDir)).toBe(true);
      expect(loadSettings(projectDir)).toEqual({ maxConcurrent: 8 });
    });
  });
});
