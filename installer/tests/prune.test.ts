import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertOk,
  installLog,
  makePiHome,
  makeStub,
  readJson,
  removedLines,
  runInstaller,
} from "./helpers.js";

// Prune: packages in the old manifest but not in the current roster are
// removed from forks/ and from settings.json packages/extensions, with one
// printed line each.
describe("prune", () => {
  test("dropped manifest packages are removed from forks and settings, one line each", () => {
    const home = makePiHome();
    const stub = makeStub();
    const forksDir = join(home, "forks");

    assertOk(runInstaller(home, [], stub));

    // Simulate a package the repo used to ship: existing forks dir, entries
    // in both settings keys, and a manifest listing it.
    const manifestPath = join(home, "installer-manifest.json");
    const manifest = readJson(manifestPath) as { packages: string[] };
    mkdirSync(join(forksDir, "retired-pkg"), { recursive: true });
    writeFileSync(join(forksDir, "retired-pkg", "index.ts"), "export {};\n");
    const settingsPath = join(home, "settings.json");
    const settings = readJson(settingsPath) as { packages?: unknown[]; extensions: unknown[] };
    const forkEntry = join(forksDir, "retired-pkg");
    settings.packages = [...(settings.packages ?? []), forkEntry];
    settings.extensions.push(forkEntry);
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ version: 1, packages: [...manifest.packages, "retired-pkg"] })}\n`,
    );

    const run = runInstaller(home, [], stub);
    assertOk(run);
    expect(removedLines(run.stdout)).toEqual(["removed package: retired-pkg"]);
    expect(existsSync(join(forksDir, "retired-pkg"))).toBe(false);

    const after = readJson(settingsPath) as { packages: unknown[]; extensions: unknown[] };
    expect(after.packages).not.toContain(forkEntry);
    expect(after.extensions).not.toContain(forkEntry);
    const afterManifest = readJson(manifestPath) as { packages: string[] };
    expect(afterManifest.packages).not.toContain("retired-pkg");

    // Core roster still deployed.
    const forks = readdirSync(forksDir);
    expect(forks).toContain("tool-repair");
    expect(forks).toContain("todo");
    expect(installLog(stub).filter((dest) => dest.includes("retired-pkg"))).toEqual([]);
    expect(readFileSync(join(forksDir, "tool-repair", "tool-repair.ts"), "utf-8")).toContain(
      "tool",
    );
  });
});
