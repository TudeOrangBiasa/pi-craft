import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertOk,
  installLog,
  makePiHome,
  makeStub,
  removedLines,
  runInstaller,
  snapshotTree,
} from "./helpers.js";

// Idempotency: the second consecutive run changes nothing — no removals, no
// reinstalls, whole-home tree and settings byte-identical.
describe("idempotency", () => {
  test("second consecutive run is a no-op", () => {
    const home = makePiHome();
    const stub = makeStub();

    assertOk(runInstaller(home, ["--with", "web"], stub));
    const installsAfterFirst = installLog(stub);
    expect(installsAfterFirst.length).toBeGreaterThan(0);

    const settingsBefore = readFileSync(join(home, "settings.json"), "utf-8");
    const treeBefore = snapshotTree(home);

    const run = runInstaller(home, [], stub);
    assertOk(run);
    expect(removedLines(run.stdout)).toEqual([]);
    expect(installLog(stub)).toEqual(installsAfterFirst);
    expect(readFileSync(join(home, "settings.json"), "utf-8")).toBe(settingsBefore);
    expect(snapshotTree(home)).toBe(treeBefore);
  });
});
