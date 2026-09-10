import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globMatch, guidanceNotice, loadGuidanceDir, matchGuidance } from "../guidance.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("guidance rules", () => {
  test("loads regex rules, skips ast-only", () => {
    const rules = loadGuidanceDir(fixtures);
    expect(rules.map((r) => r.name)).toEqual([
      "ts-brace-scope",
      "ts-escape",
      "ts-no-any",
      "ts-quoted",
    ]);
  });

  test("quoted conditions match raw values, not just the JSON haystack", () => {
    const rules = loadGuidanceDir(fixtures);
    // JSON.stringify escapes the quotes in content, so `"io/ioutil"` only
    // matches the raw value — the haystack holds `\"io/ioutil\"`.
    const hits = matchGuidance(rules, "write", { path: "m.go", content: 'import "io/ioutil"' });
    expect(hits.map((r) => r.name)).toContain("ts-quoted");
    const clean = matchGuidance(rules, "write", { path: "m.go", content: "// io/ioutil docs" });
    expect(clean.map((r) => r.name)).not.toContain("ts-quoted");
  });

  test("double-quoted escapes unescape before regex compile", () => {
    const rules = loadGuidanceDir(fixtures);
    const hits = matchGuidance(rules, "replace", { path: "y.ts", replacement_lines: ["foo(1)"] });
    expect(hits.map((r) => r.name)).toContain("ts-escape");
    expect(
      matchGuidance(rules, "replace", { path: "y.ts", replacement_lines: ["afoo(1)"] }),
    ).not.toContainEqual(expect.objectContaining({ name: "ts-escape" }));
  });

  test("brace-glob scopes survive the comma split and fire on replace/insert", () => {
    const rules = loadGuidanceDir(fixtures);
    const replaceHits = matchGuidance(rules, "replace", {
      path: "y.tsx",
      replacement_lines: ["x as any"],
    });
    expect(replaceHits.map((r) => r.name)).toContain("ts-brace-scope");
    const insertHits = matchGuidance(rules, "insert", { path: "y.ts", lines: ["x as any"] });
    expect(insertHits.map((r) => r.name)).toContain("ts-brace-scope");
    expect(
      matchGuidance(rules, "edit", { path: "y.ts", text: "x as any" }).map((r) => r.name),
    ).not.toContain("ts-brace-scope");
  });

  test("matches tool + glob + condition", () => {
    const rules = loadGuidanceDir(fixtures);
    const hits = matchGuidance(rules, "edit", { path: "/x/y.ts", text: "const v: any = 1;" });
    expect(hits.map((r) => r.name)).toEqual(["ts-no-any"]);
  });

  test("misses on wrong tool, wrong ext, clean code", () => {
    const rules = loadGuidanceDir(fixtures);
    expect(matchGuidance(rules, "read", { path: "/x/y.ts", text: "const v: any = 1;" })).toEqual(
      [],
    );
    expect(matchGuidance(rules, "edit", { path: "/x/y.js", text: "const v: any = 1;" })).toEqual(
      [],
    );
    expect(
      matchGuidance(rules, "edit", { path: "/x/y.ts", text: "const v: unknown = 1;" }),
    ).toEqual([]);
  });

  test("matches basename paths and multi-condition lists", () => {
    const rules = loadGuidanceDir(fixtures);
    const hits = matchGuidance(rules, "write", { file: "y.ts", content: "x as any" });
    expect(hits.map((r) => r.name)).toEqual(["ts-brace-scope", "ts-no-any"]);
  });

  test("glob matcher handles braces and stars", () => {
    expect(globMatch("*.ts", "y.ts")).toBe(true);
    expect(globMatch("*.ts", "/x/y.ts")).toBe(false);
    expect(globMatch("*.{ts,tsx}", "y.tsx")).toBe(true);
    expect(globMatch("**/*.ts", "/x/y.ts")).toBe(true);
    expect(globMatch("*.test.ts", "y.test.ts")).toBe(true);
  });

  test("notice is a compact pointer", () => {
    const rules = loadGuidanceDir(fixtures);
    expect(guidanceNotice(rules.find((r) => r.name === "ts-no-any")!)).toContain("ts-no-any");
  });
});
