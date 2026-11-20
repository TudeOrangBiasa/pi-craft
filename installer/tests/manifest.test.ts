import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest, saveManifest } from "../manifest.js";

describe("installer manifest", () => {
  test("missing file means nothing installer-owned", () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-missing-"));
    try {
      expect(loadManifest(join(dir, "installer-manifest.json"))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("malformed file warns and prunes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-malformed-"));
    try {
      writeFileSync(join(dir, "installer-manifest.json"), "{oops");
      expect(loadManifest(join(dir, "installer-manifest.json"))).toBeUndefined();
      writeFileSync(
        join(dir, "installer-manifest.json"),
        JSON.stringify({ version: 1, packages: "nope" }),
      );
      expect(loadManifest(join(dir, "installer-manifest.json"))).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("save then load round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-roundtrip-"));
    try {
      const path = join(dir, "installer-manifest.json");
      saveManifest(path, ["ask", "todo"]);
      expect(loadManifest(path)).toEqual({ version: 1, packages: ["ask", "todo"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
