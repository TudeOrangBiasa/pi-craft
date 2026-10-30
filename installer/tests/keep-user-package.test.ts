import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertOk,
  installLog,
  makePiHome,
  makeStub,
  readJson,
  removedLines,
  runInstaller,
  snapshotTree,
} from "./helpers.js";

// Keep-user-package: anything not in the manifest survives byte-for-byte —
// its forks dir, its settings entries, and even a missing path in settings.
describe("keep-user-package", () => {
  test("user-installed package survives untouched across prune and re-run", () => {
    const home = makePiHome();
    const stub = makeStub();
    const forksDir = join(home, "forks");
    const userDir = join(forksDir, "my-own-thing");
    const ghostEntry = join(forksDir, "ghost-no-longer-on-disk");

    mkdirSync(join(userDir, "src", "lib"), { recursive: true });
    writeFileSync(join(userDir, "package.json"), '{"name":"my-own-thing"}\n');
    writeFileSync(join(userDir, "src", "lib", "code.ts"), "export const meaning = 42;\n");
    const settingsPath = join(home, "settings.json");
    const userSettings = {
      packages: [join(userDir), ghostEntry],
      extensions: ["/home/user/.pi/agent/extensions/personal.ts", join(userDir)],
      theme: "dark",
    };
    writeFileSync(settingsPath, `${JSON.stringify(userSettings)}\n`);

    assertOk(runInstaller(home, [], stub));

    // Retire a manifest package so the prune path runs alongside user content.
    const manifestPath = join(home, "installer-manifest.json");
    const manifest = readJson(manifestPath) as { packages: string[] };
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ version: 1, packages: [...manifest.packages, "gone-pkg"] })}`,
    );
    mkdirSync(join(forksDir, "gone-pkg"), { recursive: true });

    const beforeUserTree = snapshotTree(userDir);
    const run = runInstaller(home, [], stub);
    assertOk(run);
    expect(removedLines(run.stdout)).toEqual(["removed package: gone-pkg"]);

    // User's forks dir byte-identical, never bun-installed into.
    expect(snapshotTree(userDir)).toBe(beforeUserTree);
    expect(installLog(stub).filter((dest) => dest.includes("my-own-thing"))).toEqual([]);

    // User's settings entries intact: kept, in order, ghost path not pruned.
    const after = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
      packages: unknown[];
      extensions: unknown[];
      theme: unknown;
    };
    expect(after.packages).toContain(join(userDir));
    expect(after.packages).toContain(ghostEntry);
    expect(after.packages.indexOf(join(userDir))).toBeLessThan(after.packages.indexOf(ghostEntry));
    expect(after.extensions).toContain("/home/user/.pi/agent/extensions/personal.ts");
    expect(after.extensions).toContain(join(userDir));
    expect(after.theme).toBe("dark");

    const afterManifest = readJson(manifestPath) as { packages: string[] };
    expect(afterManifest.packages).not.toContain("my-own-thing");

    // Second consecutive run: full no-op, still byte-identical.
    const settingsBefore = readFileSync(settingsPath, "utf-8");
    const treeBefore = snapshotTree(userDir);
    const rerun = runInstaller(home, [], stub);
    assertOk(rerun);
    expect(removedLines(rerun.stdout)).toEqual([]);
    expect(readFileSync(settingsPath, "utf-8")).toBe(settingsBefore);
    expect(snapshotTree(userDir)).toBe(treeBefore);
  });
});
