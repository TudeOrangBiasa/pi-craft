import type { ExtensionAPI, BashToolInput } from "@earendil-works/pi-coding-agent";

/**
 * Bash interceptor: when the model reaches for `bash` to do something a
 * dedicated tool already does better, block the call and steer it there.
 * Tool names vary by install, so each rule lists candidates in preference
 * order; if none is active the rule silently no-ops (best-effort nudge,
 * not a security boundary).
 */

interface InterceptorRule {
  pattern: RegExp;
  /** Tool names in preference order; first one active this session wins. */
  candidates: string[];
  message: (tool: string) => string;
}

const RULES: InterceptorRule[] = [
  {
    pattern:
      /^\s*(?:cat|head|tail|less|more|tac|nl)\b(?!.*(?:[>]|<<?\s*\w))(?!.*\s-[a-zA-Z]*[fF]\b)/,
    candidates: ["read"],
    message: () =>
      "Use the read tool instead of cat/head/tail/less (read handles dirs, binaries, offsets); tail -f stays in bash.",
  },
  {
    pattern: /^\s*(?:grep|rg|ripgrep|ag|ack)\b/,
    candidates: ["ffgrep", "anchor_grep"],
    message: (tool) =>
      `Use the ${tool} tool instead of grep/rg/ag; it is the dedicated text-search tool.`,
  },
  {
    pattern:
      /^\s*(?:fd\b(?=\s|$)|find\b(?=.*(?:-name|-type|-glob|-path|-regex|-iname)\b)|locate\b(?=\s|$))/,
    candidates: ["fffind", "find"],
    message: (tool) =>
      `Use the ${tool} tool instead of find/fd/locate; it is the dedicated file-search tool.`,
  },
  {
    pattern: /^\s*ls\b(?!.*[|&;])/,
    candidates: ["read", "fffind"],
    message: (tool) =>
      `Use the ${tool} tool instead of ls (any flags); read lists dirs with structured output.`,
  },
  {
    pattern: /^\s*(?:sed\b.*?-i\b|perl\b.*?-i\b|awk\b.*?-i\s+inplace\b)/,
    candidates: ["replace", "edit"],
    message: (tool) =>
      `Use the ${tool} tool for in-place edits (anchored [file#TAG]); it tracks changes cleanly.`,
  },
  {
    pattern: /^\s*(?:echo|printf|cat)\b(?=.*(?:[>]|<<?\s*\w))/,
    candidates: ["write"],
    message: () =>
      "Use the write tool when writing file content from the shell; it is safer and reviewable.",
  },
];

function* fragments(command: string): Generator<{ text: string; pipeConsumer: boolean }> {
  const sep = /(\|\||\|&|\||&&|\n|;|&)/g;
  let prev = "";
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = sep.exec(command)) !== null) {
    const text = command.slice(lastIndex, m.index);
    if (text.trim().length > 0) {
      yield { text, pipeConsumer: prev === "|" || prev === "|&" };
    }
    prev = m[1];
    lastIndex = sep.lastIndex;
  }
  const tail = command.slice(lastIndex);
  if (tail.trim().length > 0) {
    yield { text: tail, pipeConsumer: prev === "|" || prev === "|&" };
  }
}

function stripAssignment(cmd: string): string {
  return cmd.replace(/^\s*(?:[A-Za-z_][\w]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, "");
}

function resolveTool(rule: InterceptorRule, toolNames: string[]): string | null {
  for (const candidate of rule.candidates) {
    if (toolNames.includes(candidate)) return candidate;
  }
  return null;
}

function matchRule(cmd: string, toolNames: string[]): InterceptorRule | null {
  for (const rule of RULES) {
    if (rule.pattern.test(cmd) && resolveTool(rule, toolNames)) {
      return rule;
    }
  }
  return null;
}

export function checkInterception(
  command: string,
  toolNames: string[],
): { tool: string; message: string; fragment: string } | null {
  const build = (
    rule: InterceptorRule,
    fragment: string,
  ): { tool: string; message: string; fragment: string } => {
    const tool = resolveTool(rule, toolNames)!;
    return { tool, message: rule.message(tool), fragment: fragment.trim() };
  };
  const whole = matchRule(command, toolNames);
  if (whole) return build(whole, command);
  for (const { text, pipeConsumer } of fragments(command)) {
    if (pipeConsumer) continue;
    const stripped = stripAssignment(text);
    const rule = matchRule(stripped, toolNames);
    if (rule) return build(rule, stripped);
  }
  return null;
}

export default function (pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;
    const command = (event.input as BashToolInput).command;
    const result = checkInterception(command, pi.getActiveTools());
    if (result) {
      const suffix =
        result.fragment !== command.trim() ? ` Offending fragment: \`${result.fragment}\`.` : "";
      return {
        block: true,
        reason: `Blocked: ${result.message}${suffix} Original command: ${command}`,
      };
    }
    return undefined;
  });
}
