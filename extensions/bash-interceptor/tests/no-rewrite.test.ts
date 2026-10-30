import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bashInterceptor from "../bash-interceptor.js";
import governor from "../../governor/governor.js";
import omfg from "../../omfg/omfg.js";

type ToolCallEvent = { toolName: string; input: { command: string } };
type ToolCallHandler = (event: ToolCallEvent, ctx: unknown) => unknown;

function fakePi(): {
  pi: ExtensionAPI;
  handlers: ToolCallHandler[];
  commands: string[];
} {
  const handlers: ToolCallHandler[] = [];
  const commands: string[] = [];
  const pi = {
    on: (event: string, handler: ToolCallHandler) => {
      if (event === "tool_call") handlers.push(handler);
    },
    registerCommand: (name: string) => {
      commands.push(name);
    },
    getActiveTools: () => ["read", "ffgrep", "fffind", "replace", "write"],
  } as unknown as ExtensionAPI;
  return { pi, handlers, commands };
}

const ctx = { sessionManager: { getSessionId: () => "test" }, cwd: "/tmp" };

// No owned extension rewrites bash command text: the tool_call handlers see
// the original model-written command, and what they pass on is unchanged.
// (Proves issue #2: no component modifies input.command; a fake `rtk` on PATH
// changes nothing because nothing shells out to it.)
describe("no command rewrite", () => {
  test("bash runs verbatim through every owned extension handler", () => {
    const owned = fakePi();
    bashInterceptor(owned.pi);
    governor(owned.pi);
    omfg(owned.pi);

    expect(owned.commands).not.toContain("rtk");
    expect(owned.handlers.length).toBeGreaterThan(0);

    for (const command of ["git status", "git log --oneline | head -50", "rtk status"]) {
      const event: ToolCallEvent = { toolName: "bash", input: { command } };
      for (const handler of owned.handlers) handler(event, ctx);
      expect(event.input.command).toBe(command);
    }
  });
});
