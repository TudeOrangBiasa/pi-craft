import type { ExtensionAPI, BashToolInput } from "@earendil-works/pi-coding-agent";

/**
 * Bash interceptor for vanilla Pi (pi-mono).
 *
 * Ports OMP's bashInterceptor to vanilla Pi as an extension. When the model reaches for `bash`
 * to do something a dedicated tool already does better, we block the call and steer it to the
 * right tool.
 *
 * Vanilla Pi's tool *names* vary by install and by the extensions you load. File discovery is
 * `fffind` (fff) or `find` (core); text search is `ffgrep` (fff),
 * in-place edits go to `replace` (hashline)
 * or `edit` (core). Each rule lists candidate tool names in preference order and resolves to the
 * first one actually active this session, so the block message names a tool that exists. If no
 * candidate is active, the rule silently no-ops (best-effort nudge, not a security boundary).
 *
 *   cat|head|tail|less|more              -> read
 *   grep|rg|ripgrep|ag|ack               -> ffgrep
 *   find|fd|locate (name/type/glob/...)  -> fffind | find
 *   sed -i | perl -i | awk -i inplace    -> replace | edit
 *   echo|printf|cat with redirect/herdoc -> write
 *   ls (no flags)                        -> ls
 */

interface InterceptorRule {
  pattern: RegExp;
  /** Tool names in preference order; first one active this session wins. */
  candidates: string[];
  message: (tool: string) => string;
}

const RULES: InterceptorRule[] = [
  {
    // `cat` with a redirect or heredoc is a write, not a read; exclude it here so the
    // write rule below wins. Plain `cat file` routes to read.
    // `tail -f` / `-F` follows a log — legit bash, exempt it.
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
    // Any bare `ls` (plain, flagged, or piped) routes to read/fffind: fragment
    // matching blocks `ls -la | grep foo` on its first fragment. Split it —
    // list via read/fffind, then count/filter with bash only if needed.
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

/**
 * Split a command into runnable fragments on the common compound separators.
 * Stages that consume another command's stdout through `|` / `|&` are marked
 * `pipeConsumer` and skipped: path-based dedicated tools cannot supply their stdin.
 */
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

/** Drop leading `NAME=value` assignments, incl. quoted values with spaces. */
function stripAssignment(cmd: string): string {
  return cmd.replace(/^\s*(?:[A-Za-z_][\w]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, "");
}

/** First candidate tool that is active this session, or null if none are. */
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

/**
 * Returns the resolved tool + message for the rule that should intercept `command`,
 * or null if it should run as bash. Checks the whole command first, then
 * each flat fragment (skipping pipe-stdin consumers and leading NAME=value assignments).
 */
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
