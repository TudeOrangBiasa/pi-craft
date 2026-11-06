import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, getConfigPath, readConfig } from "./index.js";

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

describe("vision unified config", () => {
  test("unified vision section wins; missing everything means defaults", async () => {
    scratch = mkdtempSync(join(tmpdir(), "vision-config-"));
    const agentDir = join(scratch, "agent");
    mkdirSync(agentDir, { recursive: true });
    await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
      expect(readConfig()).toEqual(DEFAULT_CONFIG);
    });
    writeFileSync(join(agentDir, "pi-craft.json"), JSON.stringify({ vision: { enabled: false } }));
    await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
      expect(readConfig().enabled).toBe(false);
    });
  });

  test("old extensions file migrates into the unified section once", async () => {
    scratch = mkdtempSync(join(tmpdir(), "vision-migrate-"));
    const agentDir = join(scratch, "agent");
    await withEnv({ PI_CODING_AGENT_DIR: agentDir }, async () => {
      const legacy = getConfigPath();
      mkdirSync(join(agentDir, "extensions"), { recursive: true });
      writeFileSync(legacy, JSON.stringify({ enabled: false }));
      expect(readConfig().enabled).toBe(false);
      const migrated = JSON.parse(readFileSync(join(agentDir, "pi-craft.json"), "utf-8")) as {
        vision: unknown;
      };
      expect(migrated.vision).toEqual({ enabled: false });
      expect(JSON.parse(readFileSync(legacy, "utf-8"))).toEqual({ enabled: false });
    });
  });
});
