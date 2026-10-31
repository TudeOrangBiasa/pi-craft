import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMaxWidgetLines, loadConfig, resolveCollapseKey } from "../../config.js";

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

describe("todo unified config", () => {
  test("unified todo section wins; missing everything means defaults", async () => {
    scratch = mkdtempSync(join(tmpdir(), "todo-config-"));
    const agentDir = join(scratch, "agent");
    mkdirSync(agentDir, { recursive: true });
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect(loadConfig()).toEqual({});
        expect(getMaxWidgetLines()).toBe(12);
        expect(resolveCollapseKey()).toBe("ctrl+shift+t");
      },
    );
    writeFileSync(
      join(agentDir, "pi-craft.json"),
      JSON.stringify({ todo: { maxWidgetLines: 8, collapseKey: "alt+t" } }),
    );
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect(getMaxWidgetLines()).toBe(8);
        expect(resolveCollapseKey()).toBe("alt+t");
      },
    );
  });

  test("old XDG file migrates into the unified section once", async () => {
    scratch = mkdtempSync(join(tmpdir(), "todo-migrate-"));
    const agentDir = join(scratch, "agent");
    const xdgDir = join(scratch, "xdg", "pi-todo");
    const legacy = join(xdgDir, "config.json");
    mkdirSync(xdgDir, { recursive: true });
    writeFileSync(legacy, JSON.stringify({ maxWidgetLines: 6 }));
    await withEnv(
      { PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(scratch, "xdg") },
      async () => {
        expect(getMaxWidgetLines()).toBe(6);
        const migrated = JSON.parse(readFileSync(join(agentDir, "pi-craft.json"), "utf-8")) as {
          todo: unknown;
        };
        expect(migrated.todo).toEqual({ maxWidgetLines: 6 });
        expect(JSON.parse(readFileSync(legacy, "utf-8"))).toEqual({ maxWidgetLines: 6 });
      },
    );
  });
});
