import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfigPath, loadGrammarRepairConfig } from "../src/grammar-repair.js";

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

describe("tool-repair unified config", () => {
  test("unified tool-repair section wins; missing everything means defaults", async () => {
    scratch = mkdtempSync(join(tmpdir(), "tool-repair-config-"));
    const agentDir = join(scratch, "agent");
    mkdirSync(agentDir, { recursive: true });
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect(loadGrammarRepairConfig().mode).toBe("recover");
        expect(loadGrammarRepairConfig().enabled).toBe(false);
      },
    );
    writeFileSync(
      join(agentDir, "pi-craft.json"),
      JSON.stringify({ "tool-repair": { grammarRepair: { mode: "strip" } } }),
    );
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect(loadGrammarRepairConfig().mode).toBe("strip");
      },
    );
  });

  test("old pi-tool-repair.json migrates into the unified section once", async () => {
    scratch = mkdtempSync(join(tmpdir(), "tool-repair-migrate-"));
    const agentDir = join(scratch, "agent");
    mkdirSync(agentDir, { recursive: true });
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        const legacy = defaultConfigPath();
        mkdirSync(join(agentDir, "extensions"), { recursive: true });
        writeFileSync(legacy, JSON.stringify({ grammarRepair: { mode: "strip" } }));
        expect(loadGrammarRepairConfig().mode).toBe("strip");
        const migrated = JSON.parse(readFileSync(join(agentDir, "pi-craft.json"), "utf-8")) as {
          "tool-repair": unknown;
        };
        expect(migrated["tool-repair"]).toEqual({ grammarRepair: { mode: "strip" } });
        expect(JSON.parse(readFileSync(legacy, "utf-8"))).toEqual({
          grammarRepair: { mode: "strip" },
        });
      },
    );
  });
});
