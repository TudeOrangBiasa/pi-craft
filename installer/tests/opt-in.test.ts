import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

const OPT_INS = ["web"];
const CORE = [
  "tool-repair",
  "hashline",
  "subagents",
  "fff",
  "vision",
  "safety-net",
  "ask",
  "clear",
  "todo",
  "cache-hit",
];

// Opt-in skip: parked packages deploy only when already enabled in settings
// or passed via --with. --with persists so the next flagless run keeps it.
describe("opt-in skip", () => {
  test("fresh home deploys core only; enabling via settings or --with deploys", () => {
    const home = makePiHome();
    const stub = makeStub();
    const forksDir = join(home, "forks");

    assertOk(runInstaller(home, [], stub));
    let forks = readdirSync(forksDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(forks).toEqual([...CORE].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const name of OPT_INS) {
      expect(existsSync(join(forksDir, name))).toBe(false);
    }
    expect(
      installLog(stub)
        .map((dest) => dest.split("/").at(-1) ?? "")
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual([...CORE].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const manifest = readJson(join(home, "installer-manifest.json")) as { packages: string[] };
    expect([...manifest.packages].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(
      [...CORE].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );

    // Already enabled in settings → deployed on the next run.
    const settingsPath = join(home, "settings.json");
    const settings = readJson(settingsPath) as { packages?: unknown[] };
    settings.packages = [...(settings.packages ?? []), join(forksDir, "web")];
    writeFileSync(settingsPath, `${JSON.stringify(settings)}\n`);
    assertOk(runInstaller(home, [], stub));
    forks = readdirSync(forksDir);
    expect(forks).toContain("web");
    expect(forks).not.toContain("rtk");
    expect(forks).not.toContain("advisor");
    expect(forks).not.toContain("btw");
    expect(forks).not.toContain("preview");
    expect(readFileSync(join(home, "settings.json"), "utf-8")).toContain(join(forksDir, "web"));

    // Explicit --with re-deploys an already-enabled opt-in and stays a no-op.
    assertOk(runInstaller(home, ["--with", "web"], stub));
    expect(existsSync(join(forksDir, "web"))).toBe(true);
    const settingsText = readFileSync(settingsPath, "utf-8");
    expect(settingsText).toContain(join(forksDir, "web"));

    const rerun = runInstaller(home, [], stub);
    assertOk(rerun);
    expect(removedLines(rerun.stdout)).toEqual([]);
    expect(existsSync(join(forksDir, "web"))).toBe(true);
    const kept = readJson(join(home, "installer-manifest.json")) as { packages: string[] };
    expect(kept.packages).toContain("web");
  });

  test("--with rejects unknown and core names without deploying", () => {
    const home = makePiHome();
    const stub = makeStub();
    for (const args of [["--with", "nope"], ["--with=nope"], ["--with", "ask"], ["--bogus"]]) {
      const run = runInstaller(home, args, stub);
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("error:");
    }
    expect(existsSync(join(home, "installer-manifest.json"))).toBe(false);
  });
});
