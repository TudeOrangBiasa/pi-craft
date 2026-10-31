import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  piCraftPath,
  readJsonObject,
  readSection,
  readSectionWithFallbacks,
  readUnifiedSection,
  writeSection,
} from "../pi-craft-settings.js";

/** Run fn with process.env keys overridden (undefined value unsets); restores afterwards. */
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

function useScratch(): string {
  scratch = mkdtempSync(join(tmpdir(), "pi-craft-settings-"));
  return scratch;
}

describe("pi-craft settings", () => {
  test("piCraftPath honors PI_CODING_AGENT_DIR", async () => {
    await withEnv({ PI_CODING_AGENT_DIR: "/tmp/pi-test-dir" }, async () => {
      expect(piCraftPath()).toBe("/tmp/pi-test-dir/pi-craft.json");
    });
  });

  test("readSection returns {} when neither file exists", async () => {
    const dir = useScratch();
    await withEnv({ PI_CODING_AGENT_DIR: dir }, async () => {
      expect(readSection("ask", join(dir, "legacy.json"))).toEqual({});
    });
  });

  test("unified section wins over legacy without touching legacy", async () => {
    const dir = useScratch();
    const legacy = join(dir, "legacy.json");
    writeFileSync(legacy, JSON.stringify({ collapseKey: "alt+o" }));
    writeFileSync(join(dir, "pi-craft.json"), JSON.stringify({ ask: { collapseKey: "ctrl+k" } }));
    await withEnv({ PI_CODING_AGENT_DIR: dir }, async () => {
      expect(readSection("ask", legacy)).toEqual({ collapseKey: "ctrl+k" });
      expect(JSON.parse(readFileSync(legacy, "utf-8"))).toEqual({ collapseKey: "alt+o" });
    });
  });

  test("legacy migrates into the unified file once and the legacy file is untouched", async () => {
    const dir = useScratch();
    const legacy = join(dir, "legacy.json");
    writeFileSync(legacy, JSON.stringify({ collapseKey: "alt+o" }));
    await withEnv({ PI_CODING_AGENT_DIR: dir }, async () => {
      expect(readSection("ask", legacy)).toEqual({ collapseKey: "alt+o" });
      const migrated = JSON.parse(readFileSync(join(dir, "pi-craft.json"), "utf-8")) as {
        ask: unknown;
      };
      expect(migrated.ask).toEqual({ collapseKey: "alt+o" });
      expect(JSON.parse(readFileSync(legacy, "utf-8"))).toEqual({ collapseKey: "alt+o" });
      // Second read comes from the unified file (delete legacy to prove it).
      rmSync(legacy);
      expect(readSection("ask", legacy)).toEqual({ collapseKey: "alt+o" });
    });
  });

  test("fallbacks try XDG then legacy in order", async () => {
    const dir = useScratch();
    const xdg = join(dir, "xdg.json");
    const legacy = join(dir, "legacy.json");
    writeFileSync(legacy, JSON.stringify({ collapseKey: "from-legacy" }));
    await withEnv({ PI_CODING_AGENT_DIR: dir }, async () => {
      expect(readSectionWithFallbacks("ask", [xdg, legacy])).toEqual({
        collapseKey: "from-legacy",
      });
    });
    writeFileSync(xdg, JSON.stringify({ collapseKey: "from-xdg" }));
    rmSync(join(dir, "pi-craft.json"));
    await withEnv({ PI_CODING_AGENT_DIR: dir }, async () => {
      expect(readSectionWithFallbacks("ask", [xdg, legacy])).toEqual({
        collapseKey: "from-xdg",
      });
    });
  });

  test("writeSection keeps sibling sections", async () => {
    const dir = useScratch();
    await withEnv({ PI_CODING_AGENT_DIR: dir }, async () => {
      writeSection("ask", { collapseKey: "ctrl+k" });
      writeSection("todo", { maxWidgetLines: 8 });
      expect(JSON.parse(readFileSync(join(dir, "pi-craft.json"), "utf-8"))).toEqual({
        ask: { collapseKey: "ctrl+k" },
        todo: { maxWidgetLines: 8 },
      });
    });
  });

  test("readUnifiedSection ignores legacy files", async () => {
    const dir = useScratch();
    writeFileSync(join(dir, "pi-craft.json"), JSON.stringify({ goal: { verify: false } }));
    await withEnv({ PI_CODING_AGENT_DIR: dir }, async () => {
      expect(readUnifiedSection("goal")).toEqual({ verify: false });
      expect(readUnifiedSection("missing")).toEqual({});
    });
  });

  test("corrupt files read as {}", async () => {
    const dir = useScratch();
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{oops");
    expect(readJsonObject(bad)).toEqual({});
    expect(readJsonObject(join(dir, "absent.json"))).toEqual({});
  });
});
