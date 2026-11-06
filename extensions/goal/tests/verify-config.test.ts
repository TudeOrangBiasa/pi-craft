import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVerifyConfig } from "../goal.js";

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

describe("goal verify config", () => {
  test("env wins over the unified section", async () => {
    scratch = mkdtempSync(join(tmpdir(), "goal-verify-env-"));
    const agentDir = join(scratch, "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "pi-craft.json"),
      JSON.stringify({ goal: { verify: true, verifyModel: "section/model" } }),
    );
    await withEnv(
      {
        PI_CODING_AGENT_DIR: agentDir,
        PI_GOAL_VERIFY: "0",
        PI_GOAL_VERIFY_MODEL: "env/model",
        PI_GOAL_VERIFY_TIMEOUT_MS: undefined,
      },
      async () => {
        const config = readVerifyConfig();
        expect(config.enabled).toBe(false);
        expect(config.model).toBe("env/model");
      },
    );
  });

  test("section-only values are read; empty section means defaults", async () => {
    scratch = mkdtempSync(join(tmpdir(), "goal-verify-section-"));
    const agentDir = join(scratch, "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "pi-craft.json"),
      JSON.stringify({ goal: { verify: false, verifyModel: "x/y", verifyTimeoutMs: 5000 } }),
    );
    await withEnv(
      {
        PI_CODING_AGENT_DIR: agentDir,
        PI_GOAL_VERIFY: undefined,
        PI_GOAL_VERIFY_MODEL: undefined,
        PI_GOAL_VERIFY_TIMEOUT_MS: undefined,
      },
      async () => {
        const config = readVerifyConfig();
        expect(config.enabled).toBe(false);
        expect(config.model).toBe("x/y");
        expect(config.timeoutMs).toBe(5000);
      },
    );
    writeFileSync(join(agentDir, "pi-craft.json"), JSON.stringify({}));
    await withEnv(
      {
        PI_CODING_AGENT_DIR: agentDir,
        PI_GOAL_VERIFY: undefined,
        PI_GOAL_VERIFY_MODEL: undefined,
        PI_GOAL_VERIFY_TIMEOUT_MS: undefined,
      },
      async () => {
        const config = readVerifyConfig();
        expect(config.enabled).toBe(true);
        expect(config.model).toBeUndefined();
        expect(config.timeoutMs).toBeUndefined();
      },
    );
  });
});
