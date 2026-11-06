import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCommand, rules } from "../omfg.js";

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

const fakeCtx = (seen: string[]) =>
  ({
    ui: { notify: (m: string) => void seen.push(m) },
  }) as never;

const validRule = {
  name: "r1",
  type: "replace",
  scope: ["live"],
  pattern: "x",
  replacement: "y",
};

let scratch: string | undefined;

afterEach(() => {
  rules.length = 0;
  if (scratch !== undefined) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
});

describe("omfg unified rules", () => {
  test("unified omfg section wins; reload reads it back", async () => {
    scratch = mkdtempSync(join(tmpdir(), "omfg-config-"));
    const agentDir = join(scratch, "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "pi-craft.json"),
      JSON.stringify({ omfg: { rules: [validRule] } }),
    );
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        const seen: string[] = [];
        rules.length = 0;
        await handleCommand("reload", fakeCtx(seen));
        expect(rules.length).toBe(1);
        expect(rules[0]?.name).toBe("r1");
      },
    );
  });

  test("old file migrates once; invalid entries are dropped", async () => {
    scratch = mkdtempSync(join(tmpdir(), "omfg-migrate-"));
    const agentDir = join(scratch, "agent");
    const xdgDir = join(scratch, "xdg", "omfg");
    mkdirSync(xdgDir, { recursive: true });
    writeFileSync(
      join(xdgDir, "rules.json"),
      JSON.stringify({ rules: [validRule, { name: "", type: "bogus", scope: [] }] }),
    );
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        const seen: string[] = [];
        rules.length = 0;
        await handleCommand("reload", fakeCtx(seen));
        expect(rules.length).toBe(1);
        expect(rules[0]?.name).toBe("r1");
        const migrated = JSON.parse(readFileSync(join(agentDir, "pi-craft.json"), "utf-8")) as {
          omfg: { rules: unknown[] };
        };
        // Migration copies the old file raw; invalid entries are dropped
        // in memory by loadRules, not from the persisted copy.
        expect(migrated.omfg.rules.length).toBe(2);
      },
    );
  });
});
