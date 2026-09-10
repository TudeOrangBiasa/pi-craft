import { describe, expect, test } from "bun:test";
import { checkInterception } from "../bash-interceptor.js";

const TOOLS = ["read", "ffgrep", "anchor_grep", "fffind", "find", "replace", "edit", "write"];
describe("bash interception", () => {
  test("routes file reads to read", () => {
    expect(checkInterception("cat file.txt", TOOLS)?.tool).toBe("read");
    expect(checkInterception("head -20 file.txt", TOOLS)?.tool).toBe("read");
  });
  test("exempts tail -f (log follow stays in bash)", () => {
    expect(checkInterception("tail -f app.log", TOOLS)).toBeNull();
  });

  test("blocks all ls variants, including piped", () => {
    expect(checkInterception("ls -la", TOOLS)?.tool).toBe("read");
    const piped = checkInterception("ls -la | grep foo", TOOLS);
    expect(piped?.tool).toBe("read");
    expect(piped?.fragment).toBe("ls -la");
  });

  test("skips pipe consumers (path tools cannot feed stdin)", () => {
    expect(checkInterception("git log --oneline | grep fix", TOOLS)).toBeNull();
    expect(checkInterception("cmd |& grep foo", TOOLS)).toBeNull();
  });

  test("strips quoted env assignments before matching", () => {
    expect(checkInterception('FOO="a b" cat x', TOOLS)?.tool).toBe("read");
    expect(checkInterception("FOO=1 BAR=2 cat x", TOOLS)?.tool).toBe("read");
  });

  test("routes search and write correctly", () => {
    expect(checkInterception("rg pattern src", TOOLS)?.tool).toBe("ffgrep");
    expect(checkInterception("fd config", TOOLS)?.tool).toBe("fffind");
    expect(checkInterception("echo hello > out.txt", TOOLS)?.tool).toBe("write");
    expect(checkInterception("sed -i s/a/b/ file", TOOLS)?.tool).toBe("replace");
  });

  test("leaves real binaries alone", () => {
    expect(checkInterception("git status", TOOLS)).toBeNull();
    expect(checkInterception("bun test", TOOLS)).toBeNull();
    expect(checkInterception("cargo build", TOOLS)).toBeNull();
  });
});
