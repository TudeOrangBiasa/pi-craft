import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "./config.js";

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

describe("hashline unified config", () => {
  test("unified hashline section wins; missing everything means defaults", async () => {
    scratch = mkdtempSync(join(tmpdir(), "hashline-config-"));
    const agentDir = join(scratch, "agent");
    mkdirSync(agentDir, { recursive: true });
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect((await readConfig()).autoRead).toBe(true);
      },
    );
    writeFileSync(
      join(agentDir, "pi-craft.json"),
      JSON.stringify({ hashline: { autoRead: false, anchorGrepEnabled: true } }),
    );
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        const config = await readConfig();
        expect(config.autoRead).toBe(false);
        expect(config.anchorGrepEnabled).toBe(true);
      },
    );
  });

  test("old configPath() file migrates into the unified section once", async () => {
    scratch = mkdtempSync(join(tmpdir(), "hashline-migrate-"));
    const agentDir = join(scratch, "agent");
    const legacyDir = join(scratch, "xdg", "pi-hashline-edit-pro");
    const legacy = join(legacyDir, "config.json");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(legacy, JSON.stringify({ autoRead: false }));
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect((await readConfig()).autoRead).toBe(false);
        const migrated = JSON.parse(readFileSync(join(agentDir, "pi-craft.json"), "utf-8")) as {
          hashline: unknown;
        };
        expect(migrated.hashline).toEqual({ autoRead: false });
      },
    );
  });
});
