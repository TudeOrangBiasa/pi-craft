/**
 * fff: FFF-powered file + content search for pi.
 *
 * Registers two tools — `ffgrep` (content grep) and `fffind` (file find) —
 * backed by @ff-labs/fff-node, plus optional FFF-backed @-mention autocomplete.
 */
import nodePath from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type AutocompleteItem,
  type AutocompleteProvider,
  Text,
} from "@earendil-works/pi-tui";
import type {
  FileFinderApi,
  GrepCursor,
  GrepMode,
  GrepResult,
  MixedItem,
  SearchResult,
} from "@ff-labs/fff-node";
import { Type } from "@sinclair/typebox";
import { AuxFinderPool, routePathConstraint } from "./aux-finders";
import { FilePickerFactory } from "./file-picker";
import { resolveDbPaths } from "./paths";
import { buildQuery } from "./query";

// --- constants ---
const DEFAULT_GREP_LIMIT = 20;
const DEFAULT_FIND_LIMIT = 30;
const GREP_PAGE_SIZE_MAX = 50;
const GREP_CONTEXT_MAX = 20;
const GREP_MAX_LINE_LENGTH = 500;
const MENTION_MAX_RESULTS = 20;
const GREP_TIME_BUDGET_MS = 10_000;

// Tool names registered by this fork. Must match the bash-interceptor candidate
// lists: grep -> ["ffgrep"], find -> ["fffind"].
const FF_GREP = "ffgrep";
const FF_FIND = "fffind";

// Mentions are on by default; set PI_FFF_MENTIONS=0 to disable.
const ENABLE_MENTIONS = process.env.PI_FFF_MENTIONS !== "0";

// --- pagination cursor store ---
interface FindCursor {
  query: string;
  pattern: string;
  pageSize: number;
  nextPageIndex: number;
  auxRoot?: string;
}

function createCursorStore<T>() {
  const store = new Map<string, T>();
  let counter = 0;
  return {
    store(value: T): string {
      const id = `fff_${++counter}`;
      store.set(id, value);
      if (store.size > 200) {
        const first = store.keys().next().value;
        if (first !== undefined) store.delete(first);
      }
      return id;
    },
    get(id: string): T | undefined {
      return store.get(id);
    },
  };
}

const grepCursorStore = createCursorStore<GrepPage>();
const findCursorStore = createCursorStore<FindCursor>();

// Grep pagination bound to its picker (mirrors FindCursor.auxRoot):
// resuming re-acquires the SAME picker instead of resolving a fresh one
// from params.path, which may point at a different tree.
interface GrepPage {
  cursor: GrepCursor;
  query: string;
  pattern: string;
  auxRoot?: string;
}

// --- output formatting ---
function truncateLine(line: string, max = GREP_MAX_LINE_LENGTH): string {
  const trimmed = line.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

function clampContext(context: number | undefined): number {
  if (!context || context < 0) return 0;
  return Math.min(Math.floor(context), GREP_CONTEXT_MAX);
}

const HOT_FRECENCY = 25;
const WARM_FRECENCY = 20;

// One annotation helper for both tools so git/frecency signal never drifts.
function fffFileAnnotation(item: {
  gitStatus?: string;
  totalFrecencyScore?: number;
  accessFrecencyScore?: number;
}): string {
  const git = item.gitStatus;
  if (git && git !== "clean" && git !== "unknown" && git !== "") {
    return `  [${git} in git]`;
  }
  const frecency = item.totalFrecencyScore ?? item.accessFrecencyScore ?? 0;
  if (frecency >= HOT_FRECENCY) return "  [VERY often touched file]";
  if (frecency >= WARM_FRECENCY) return "  [often touched file]";
  return "";
}

// DO NOT RESORT HERE — it only confuses models. Native frecency order is preserved.
function formatGrepOutput(result: GrepResult): string {
  if (result.items.length === 0) return "No matches found";
  const lines: string[] = [];
  let currentFile = "";
  for (const match of result.items) {
    if (match.relativePath !== currentFile) {
      if (lines.length > 0) lines.push("");
      currentFile = match.relativePath;
      lines.push(`${currentFile}${fffFileAnnotation(match)}`);
    }
    match.contextBefore?.forEach((line, i) => {
      const lineNum = match.lineNumber - match.contextBefore!.length + i;
      lines.push(` ${lineNum}- ${truncateLine(line)}`);
    });
    lines.push(` ${match.lineNumber}: ${truncateLine(match.lineContent)}`);
    match.contextAfter?.forEach((line, i) => {
      const lineNum = match.lineNumber + 1 + i;
      lines.push(` ${lineNum}- ${truncateLine(line)}`);
    });
  }
  return lines.join("\n");
}

function formatFindOutput(result: SearchResult, limit: number): string {
  if (result.items.length === 0) return "No files found matching pattern";
  return result.items
    .slice(0, limit)
    .map((item) => `${item.relativePath}${fffFileAnnotation(item)}`)
    .join("\n");
}

// --- mention autocomplete ---
function extractAtPrefix(textBeforeCursor: string): string | null {
  const match = textBeforeCursor.match(/(?:^|[ \t])(@(?:"[^"]*|[^\s]*))$/);
  return match?.[1] ?? null;
}

function buildAtCompletionValue(path: string): string {
  return path.includes(" ") ? `@"${path}"` : `@${path}`;
}

function createFffMentionProvider(
  getItems: (query: string, signal: AbortSignal) => Promise<AutocompleteItem[]>,
): AutocompleteProvider {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const currentLine = lines[cursorLine] || "";
      const prefix = extractAtPrefix(currentLine.slice(0, cursorCol));
      if (!prefix || options.signal.aborted) return null;
      const query = prefix.startsWith('@"') ? prefix.slice(2) : prefix.slice(1);
      const items = await getItems(query, options.signal);
      return options.signal.aborted || items.length === 0 ? null : { items, prefix };
    },
    applyCompletion(_lines, cursorLine, cursorCol, item, prefix) {
      const currentLine = _lines[cursorLine] || "";
      const before = currentLine.slice(0, cursorCol - prefix.length);
      const after = currentLine.slice(cursorCol);
      const newLine = before + item.value + after;
      const newCursorCol = cursorCol - prefix.length + item.value.length;
      return {
        lines: [..._lines.slice(0, cursorLine), newLine, ..._lines.slice(cursorLine + 1)],
        cursorLine,
        cursorCol: newCursorCol,
      };
    },
  };
}

// --- extension ---
export default function fffExtension(pi: ExtensionAPI) {
  let mainFinder: FileFinderApi | null = null;
  let finderCwd: string | null = null;
  let finderPromise: Promise<FileFinderApi> | null = null;
  let activeCwd = process.cwd();

  const resolvedDbPaths = resolveDbPaths({
    frecency: process.env.FFF_FRECENCY_DB,
    history: process.env.FFF_HISTORY_DB,
  });

  const enableFsRootScanning =
    process.env.FFF_ENABLE_ROOT_SCAN === "1" || process.env.FFF_ENABLE_ROOT_SCAN === "true";
  const enableHomeDirScanning =
    process.env.FFF_ENABLE_HOME_SCAN !== "0" && process.env.FFF_ENABLE_HOME_SCAN !== "false";

  let uiCtx: {
    ui: {
      notify: (message: string, type?: "info" | "warning" | "error") => void;
    };
  } | null = null;

  const pickers = new FilePickerFactory({
    frecencyDbPath: resolvedDbPaths.frecency,
    historyDbPath: resolvedDbPaths.history,
    onDbFailure: (error) =>
      uiCtx?.ui.notify(
        `(fff): Failed to open frecency/history database (${error}). Continuing without frecency persistence.`,
        "error",
      ),
  });

  const auxPool = new AuxFinderPool({
    enableFsRootScanning,
    enableHomeDirScanning,
    pickers,
    onHomeDirScan: (root) =>
      uiCtx?.ui.notify(`(fff): scanning home tree from ${root} — scoped path narrows faster.`, "warning"),
  });

  // Concurrent ensureFinder() callers share one in-flight promise so
  // FileFinder.create() (which takes native DB locks) runs at most once per
  // base path — otherwise parallel tool calls would race and deadlock (issue #403).
  function ensureFinder(cwd: string): Promise<FileFinderApi> {
    if (mainFinder && !mainFinder.isDestroyed && finderCwd === cwd)
      return Promise.resolve(mainFinder);
    if (finderPromise) return finderPromise;

    finderPromise = (async () => {
      if (mainFinder && !mainFinder.isDestroyed) {
        mainFinder.destroy();
        mainFinder = null;
        finderCwd = null;
      }
      mainFinder = await pickers.create({
        basePath: cwd,
        enableHomeDirScanning,
        enableFsRootScanning,
      });
      finderCwd = cwd;
      return mainFinder;
    })().finally(() => {
      finderPromise = null;
    });

    return finderPromise;
  }

  function destroyFinder() {
    if (mainFinder && !mainFinder.isDestroyed) {
      mainFinder.destroy();
      mainFinder = null;
      finderCwd = null;
    }
    auxPool?.destroy();
  }

  async function resolveFinderForPath(
    pathParam: string | undefined,
    pattern: string,
    exclude: string | string[] | undefined,
  ): Promise<{ finder: FileFinderApi; query: string; root: string } | null> {
    const route = routePathConstraint(pathParam, activeCwd);
    if (!route) return null;
    const aux = await auxPool.acquire(route.root);
    // A broader covering picker may have been reused; rebase the suffix so the
    // constraint stays relative to the picker's actual root.
    const rebase = nodePath.relative(aux.root, route.root).replaceAll(nodePath.sep, "/");
    const suffix = [rebase, route.suffix].filter(Boolean).join("/");
    const query = buildQuery(suffix || undefined, pattern, exclude, aux.root);
    return { finder: aux.finder, query, root: aux.root };
  }

  async function getMentionItems(
    query: string,
    signal: AbortSignal,
  ): Promise<AutocompleteItem[]> {
    if (signal.aborted) return [];
    const f = await ensureFinder(activeCwd);
    if (signal.aborted) return [];

    const result = f.mixedSearch(query, { pageSize: MENTION_MAX_RESULTS });
    if (!result.ok) return [];

    return result.value.items.slice(0, MENTION_MAX_RESULTS).map((mixed: MixedItem) => {
      const p = mixed.item.relativePath;
      return mixed.type === "directory"
        ? { value: buildAtCompletionValue(p), label: mixed.item.dirName, description: p }
        : { value: buildAtCompletionValue(p), label: mixed.item.fileName, description: p };
    });
  }

  function registerAutocompleteProvider(ctx: {
    ui: {
      addAutocompleteProvider?: (
        factory: (current: AutocompleteProvider) => AutocompleteProvider,
      ) => void;
    };
  }) {
    // pi forks may not expose addAutocompleteProvider; skip UI wiring and let
    // tools continue to work instead of failing session_start.
    if (typeof ctx.ui.addAutocompleteProvider !== "function") return;

    ctx.ui.addAutocompleteProvider((current) => {
      const mentionProvider = createFffMentionProvider(getMentionItems);
      return {
        async getSuggestions(lines, cursorLine, cursorCol, options) {
          try {
            const mentionResult = await mentionProvider.getSuggestions(
              lines,
              cursorLine,
              cursorCol,
              options,
            );
            if (mentionResult) return mentionResult;
          } catch {
            // Delegate when FFF lookup is unavailable.
          }
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        },
        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
          return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        },
        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
          return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
        },
      };
    });
  }

  // --- shared render helper ---
  const renderTextResult = (
    result: { content?: { type: string; text?: string }[] },
    options: { expanded?: boolean },
    theme: any,
    context: any,
    maxLines = 15,
  ) => {
    const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
    const output = result.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
    if (!output) {
      text.setText(theme.fg("muted", "No output"));
      return text;
    }
    const lines = output.split("\n");
    const displayLines = lines.slice(0, options.expanded ? lines.length : maxLines);
    let content = `\n${displayLines.map((line: string) => theme.fg("toolOutput", line)).join("\n")}`;
    if (lines.length > displayLines.length) {
      content += theme.fg("muted", `\n... (${lines.length - displayLines.length} more lines)`);
    }
    text.setText(content);
    return text;
  };

  // --- grep tool ---
  const grepSchema = Type.Object({
    pattern: Type.String({
      description:
        "Live grep over file contents. Frecency-ranked, git-aware. Prefer this over bash grep/rg/ag/ack — it's faster and gives better context. Use for content, not file paths (use the find tool for paths). Multi-word = narrower (AND). literal substring by default, regex when you need it; the tool auto-detects.",
    }),
    path: Type.Optional(
      Type.String({
        description:
          "Path constraint. Directory prefix (src/ or src/foo/), bare filename with extension (main.rs), or glob (*.ts, src/**/*.cc, {src,lib}/**). Applied to the full repo-relative path. Absolute, ~/, and ../ paths outside the workspace are also supported and searched with a separate index.",
      }),
    ),
    exclude: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description:
          "Exclude paths (comma/space-separated or array). Same syntax as path: directory prefix ('test/'), filename with extension ('config.json'), or glob ('*.min.js', '**/*.{rs,go}'). A leading '!' is optional and ignored — both 'test/' and '!test/' work. Example: 'test/,*.min.js,!vendor/'.",
      }),
    ),
    context: Type.Optional(
      Type.Number({ description: `Context lines before+after (0-${GREP_CONTEXT_MAX})` }),
    ),
    limit: Type.Optional(
      Type.Number({ description: `Max matches (default ${DEFAULT_GREP_LIMIT})` }),
    ),
    caseSensitive: Type.Optional(
      Type.Boolean({ description: "Case-sensitive match (default false / smart-case)" }),
    ),
    cursor: Type.Optional(Type.String({ description: "Pagination cursor from previous result" })),
  });

  pi.registerTool({
    name: FF_GREP,
    label: FF_GREP,
    description: `Live grep over file contents. Frecency-ranked, git-aware. Prefer this over bash grep/rg/ag/ack — it's faster and gives better context. Use for content, not file paths (use the find tool for paths). Multi-word = narrower (AND). literal substring by default, regex when you need it (e.g. \`colou?r\`); the tool auto-detects.`,
    promptSnippet: "Search file contents with FFF",
    promptGuidelines: [
      `${FF_GREP}: file CONTENT, not paths (paths → fffind); concrete identifier, 1-3 tokens, literal unless regex needed.`,
      `${FF_GREP}: context: N for surrounding lines.`,
      `Use ${FF_GREP} instead of bash grep/rg/ag/ack for file content search.`,
    ],
    parameters: grepSchema,

    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Operation aborted");

      const pattern = params.pattern;
      // Resume on the SAME picker that produced the cursor (like fffind):
      // resolving fresh from params.path could land on a different tree.
      const resumed = params.cursor ? grepCursorStore.get(params.cursor) : undefined;
      const aux = resumed
        ? resumed.auxRoot
          ? {
              finder: (await auxPool.acquire(resumed.auxRoot, { exact: true })).finder,
              root: resumed.auxRoot,
            }
          : null
        : await resolveFinderForPath(params.path, pattern, params.exclude);

      const picker = aux ? aux.finder : await ensureFinder(activeCwd);
      const auxRoot = resumed?.auxRoot ?? aux?.root;
      const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);
      // pageSize caps TOTAL matches across all files; maxMatchesPerFile alone
      // only caps per-file, so limit=5 could still return a full SDK page.
      const pageSize = Math.min(effectiveLimit, GREP_PAGE_SIZE_MAX);
      const context = clampContext(params.context);
      const effectivePattern = resumed ? resumed.pattern : pattern;
      const query = resumed
        ? resumed.query
        : aux && "query" in aux
          ? aux.query
          : buildQuery(params.path, pattern, params.exclude, activeCwd);

      // Auto-detect: regex if the pattern has regex metacharacters AND parses
      // as a valid regex, otherwise plain literal.
      const hasRegexSyntax =
        effectivePattern !== effectivePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let mode: GrepMode = hasRegexSyntax ? "regex" : "plain";
      if (mode === "regex") {
        try {
          new RegExp(effectivePattern);
        } catch {
          mode = "plain";
        }
      }

      // Guard: the agent keeps calling grep with '.*' or similar wildcard-only
      // regex to read a whole file. Steer to a real pattern, preventing wasted retries.
      const p = effectivePattern.trim();
      const isWildcardOnly =
        hasRegexSyntax &&
        /^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.\*\??|\.\*[+?]?|\.\+\??|\.|\*|\?)$/.test(
          p,
        );
      if (isWildcardOnly) {
        return {
          content: [
            {
              type: "text",
              text: `Pattern '${effectivePattern}' matches everything — grep needs a concrete substring or identifier. Example: \`pattern: 'MyClass'\` or \`pattern: 'export function'\`.`,
            },
          ],
          details: { totalMatched: 0, totalFiles: 0 },
        };
      }

      const smartCase = params.caseSensitive !== true;

      const grepResult = picker.grep(query, {
        mode,
        smartCase,
        maxMatchesPerFile: pageSize,
        pageSize,
        cursor: resumed?.cursor ?? null,
        beforeContext: context,
        afterContext: context,
        classifyDefinitions: true,
        timeBudgetMs: GREP_TIME_BUDGET_MS,
      });

      if (grepResult.ok === false) throw new Error(grepResult.error);

      const result = grepResult.value;
      let output = formatGrepOutput(result);

      const notices: string[] = [];
      if (result.regexFallbackError) {
        notices.push(`Invalid regex: ${result.regexFallbackError}, used literal match`);
      }
      if (result.nextCursor) {
        notices.push(`Continue with cursor="${grepCursorStore.store({ cursor: result.nextCursor, query, pattern: effectivePattern, auxRoot })}"`);
      }

      if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

      return {
        content: [{ type: "text", text: output }],
        details: {
          totalMatched: result.totalMatched,
          totalFiles: result.totalFiles,
        },
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const pattern = args?.pattern ?? "";
      const path = args?.path ?? ".";
      let content =
        theme.fg("toolTitle", theme.bold(FF_GREP)) +
        " " +
        theme.fg("accent", `/${pattern}/`) +
        theme.fg("toolOutput", ` in ${path}`);
      if (args?.limit !== undefined)
        content += theme.fg("toolOutput", ` limit ${args.limit}`);
      if (args?.cursor) content += theme.fg("muted", ` (page)`);
      text.setText(content);
      return text;
    },

    renderResult(result, options, theme, context) {
      return renderTextResult(result, options, theme, context, 15);
    },
  });

  // --- find tool ---
  const findSchema = Type.Object({
    pattern: Type.String({
      description:
        "Fuzzy filename search and glob search. Frecency-ranked, git-aware. Multi-word = narrower (AND) not bound to order, use for multi word related concept search. Prefer this over ls/find/bash as the first exploration step whenever the user names a concept, feature, or symbol — it surfaces the relevant files in one call. Only use ls/read on a directory when you specifically need the alphabetical layout of an unknown repo, or when a concept search returned nothing.",
    }),
    path: Type.Optional(
      Type.String({
        description:
          "Path constraint. Directory prefix (src/ or src/foo/), bare filename with extension (main.rs), or glob (*.ts, src/**/*.cc, {src,lib}/**). Applied to the full repo-relative path. Absolute, ~/, and ../ paths outside the workspace are also supported and searched with a separate index.",
      }),
    ),
    exclude: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description:
          "Exclude paths (comma/space-separated or array). Same syntax as path: directory prefix ('test/'), filename with extension ('config.json'), or glob ('*.min.js', '**/*.{rs,go}'). A leading '!' is optional and ignored — both 'test/' and '!test/' work. Example: 'test/,*.min.js,!vendor/'.",
      }),
    ),
    limit: Type.Optional(
      Type.Number({ description: `Max results per page (default ${DEFAULT_FIND_LIMIT})` }),
    ),
    cursor: Type.Optional(
      Type.String({ description: "Pagination cursor from previous result" }),
    ),
  });

  pi.registerTool({
    name: FF_FIND,
    label: FF_FIND,
    description: `Fuzzy path search and glob search. Matches against the whole repo-relative path, not just the filename. Frecency-ranked, git-aware. Multi-word = narrower (AND). Default limit ${DEFAULT_FIND_LIMIT}.`,
    promptSnippet: "Find files by path or glob",
    promptGuidelines: [
      `${FF_FIND}: WHOLE path match, not content (content → ffgrep); 1-2 terms.`,
      `${FF_FIND}: exclude: 'test/,*.min.js' cuts noise.`,
      `Use ${FF_FIND} instead of bash find/fd/locate for file path search.`,
    ],
    parameters: findSchema,

    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Operation aborted");

      // if resumed we use the same picker as before
      const resumed = params.cursor ? findCursorStore.get(params.cursor) : undefined;
      const aux = resumed
        ? resumed.auxRoot
          ? {
              finder: (await auxPool.acquire(resumed.auxRoot, { exact: true })).finder,
              root: resumed.auxRoot,
            }
          : null
        : await resolveFinderForPath(params.path, params.pattern, params.exclude);

      const picker = aux ? aux.finder : await ensureFinder(activeCwd);
      const effectiveLimit = resumed
        ? resumed.pageSize
        : Math.max(1, params.limit ?? DEFAULT_FIND_LIMIT);

      const query = resumed
        ? resumed.query
        : aux && "query" in aux
          ? (aux as { query: string }).query
          : buildQuery(params.path, params.pattern, params.exclude, activeCwd);

      const pattern = resumed ? resumed.pattern : params.pattern;
      const pageIndex = resumed?.nextPageIndex ?? 0;
      const auxRoot = resumed?.auxRoot ?? aux?.root;

      const searchResult = picker.fileSearch(query, {
        pageIndex,
        pageSize: effectiveLimit,
      });
      if (searchResult.ok === false) throw new Error(searchResult.error);

      const result = searchResult.value;
      let output = formatFindOutput(result, effectiveLimit);

      // Infer hasMore: native fileSearch fills pageSize when more results exist.
      const shownSoFar = pageIndex * effectiveLimit + result.items.length;
      const hasMore =
        result.items.length >= effectiveLimit && result.totalMatched > shownSoFar;

      const notices: string[] = [];
      if (hasMore) {
        const remaining = result.totalMatched - shownSoFar;
        const cursorId = findCursorStore.store({
          query,
          pattern,
          pageSize: effectiveLimit,
          nextPageIndex: pageIndex + 1,
          auxRoot,
        });
        notices.push(
          `${remaining} more match${remaining === 1 ? "" : "es"} available. cursor="${cursorId}" to continue`,
        );
      }

      if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
      return {
        content: [{ type: "text", text: output }],
        details: {
          totalMatched: result.totalMatched,
          totalFiles: result.totalFiles,
          pageIndex,
          hasMore,
        },
      };
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const pattern = args?.pattern ?? "";
      const path = args?.path ?? ".";
      let content =
        theme.fg("toolTitle", theme.bold(FF_FIND)) +
        " " +
        theme.fg("accent", pattern) +
        theme.fg("toolOutput", ` in ${path}`);
      if (args?.limit !== undefined)
        content += theme.fg("toolOutput", ` limit ${args.limit}`);
      if (args?.cursor) content += theme.fg("muted", ` (page)`);
      text.setText(content);
      return text;
    },

    renderResult(result, options, theme, context) {
      return renderTextResult(result, options, theme, context, 20);
    },
  });

  // --- lifecycle ---
  pi.on("session_start", async (_event, ctx) => {
    try {
      activeCwd = ctx.cwd;
      uiCtx = ctx as unknown as typeof uiCtx;
      if (ENABLE_MENTIONS) registerAutocompleteProvider(ctx);
      await ensureFinder(activeCwd);
    } catch (e: unknown) {
      ctx.ui.notify(
        `FFF init failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
  });

  pi.on("session_shutdown", async () => {
    destroyFinder();
  });
}
