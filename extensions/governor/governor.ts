import type {
  ExtensionAPI,
  ToolResultEvent,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";

export const MAX_LINES = 500;
export const MAX_BYTES = 50 * 1024;

export type TailMode = "head" | "tail";

/** Tools whose useful output lives at the end (errors, final results). */
export function tailModeFor(toolName: string): TailMode {
  return toolName === "bash" || toolName === "powershell" ? "tail" : "head";
}

export interface BoundResult {
  text: string;
  truncated: boolean;
  keptLines: number;
  totalLines: number;
}

/** Bound one text block. Never returns partial lines. */
export function boundText(text: string, mode: TailMode): BoundResult {
  const raw = text.split("\n");
  // A trailing newline is a terminator, not an extra line ("a\n" is 1 line).
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();
  const lines = raw;
  const totalLines = lines.length;
  if (totalLines <= MAX_LINES && text.length <= MAX_BYTES) {
    return { text, truncated: false, keptLines: totalLines, totalLines };
  }
  const kept: string[] = [];
  let bytes = 0;
  const push = (line: string): boolean => {
    if (kept.length >= MAX_LINES) return false;
    const cost = line.length + 1;
    if (bytes + cost > MAX_BYTES && kept.length > 0) return false;
    bytes += cost;
    kept.push(line);
    return true;
  };
  if (mode === "tail") {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line === undefined || !push(line)) {
        if (kept.length === 0 && line !== undefined) {
          kept.push(line);
        }
        break;
      }
    }
    kept.reverse();
  } else {
    for (const line of lines) {
      if (!push(line)) break;
    }
  }
  const direction = mode === "tail" ? "last" : "first";
  if (kept.length === totalLines) {
    // Nothing dropped (e.g. one over-byte line): a notice would lengthen
    // output and lie about narrowing — pass through unchanged.
    return { text, truncated: false, keptLines: totalLines, totalLines };
  }
  const notice = `…[truncated by governor: showing ${direction} ${kept.length} of ${totalLines} lines — re-run narrower]`;
  return {
    text: `${kept.join("\n")}\n${notice}`,
    truncated: true,
    keptLines: kept.length,
    totalLines,
  };
}

// --- Wiring (impure) ---

let boundedCalls = 0;
let savedChars = 0;

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("governor", {
    description: "Show central output-bound counters",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      ctx.ui.notify(
        `governor: ${boundedCalls} result(s) bounded, ${savedChars.toLocaleString()} chars saved (500 lines / 50KB ceiling)`,
        "info",
      );
    },
  });

  // Central output bound (playbook Ch3: bound output once). Runs after each
  // tool result; per-tool truncation stays, this is the ceiling above it.
  pi.on("tool_result", (event: ToolResultEvent) => {
    try {
      const mode = tailModeFor(event.toolName);
      let changed = false;
      const next = event.content.map((b: TextContent | ImageContent) => {
        if (b.type !== "text" || typeof b.text !== "string") return b;
        const r = boundText(b.text, mode);
        if (!r.truncated) return b;
        changed = true;
        boundedCalls += 1;
        savedChars += b.text.length - r.text.length;
        return { ...b, text: r.text };
      });
      if (changed) return { content: next };
    } catch {
      // Governor must never break a tool result; fail open to original.
    }
    return undefined;
  });
}
