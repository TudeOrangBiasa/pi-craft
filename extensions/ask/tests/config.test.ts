import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveCollapseKey } from "../config.js";

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

describe("ask unified config", () => {
  test("unified ask section wins; missing everything means defaults", async () => {
    scratch = mkdtempSync(join(tmpdir(), "ask-config-"));
    const agentDir = join(scratch, "agent");
    mkdirSync(agentDir, { recursive: true });
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect(loadConfig()).toEqual({});
        expect(resolveCollapseKey(loadConfig())).toBe("ctrl+]");
      },
    );
    writeFileSync(
      join(agentDir, "pi-craft.json"),
      JSON.stringify({ ask: { collapseKey: "alt+o" } }),
    );
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect(loadConfig()).toEqual({ collapseKey: "alt+o" });
        expect(resolveCollapseKey(loadConfig())).toBe("alt+o");
      },
    );
  });

  test("old XDG file migrates into the unified section once", async () => {
    scratch = mkdtempSync(join(tmpdir(), "ask-migrate-"));
    const agentDir = join(scratch, "agent");
    const xdgDir = join(scratch, "xdg", "pi-ask-user-question");
    const legacy = join(xdgDir, "config.json");
    mkdirSync(xdgDir, { recursive: true });
    writeFileSync(legacy, JSON.stringify({ collapseKey: "alt+o" }));
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect(resolveCollapseKey(loadConfig())).toBe("alt+o");
        const migrated = JSON.parse(readFileSync(join(agentDir, "pi-craft.json"), "utf-8")) as {
          ask: unknown;
        };
        expect(migrated.ask).toEqual({ collapseKey: "alt+o" });
        expect(JSON.parse(readFileSync(legacy, "utf-8"))).toEqual({ collapseKey: "alt+o" });
      },
    );
  });
});
