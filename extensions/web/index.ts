import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadWebConfig, cleanString } from "./src/config.js";
import { fetchPage } from "./src/extract.js";
import {
  listSearchProviderNames,
  listSearchProviders,
  registerSearchProvider,
  searchWithFallback,
} from "./src/providers.js";
import { exaProvider } from "./src/providers/exa.js";
import { tavilyProvider } from "./src/providers/tavily.js";
import { searxngProvider } from "./src/providers/searxng.js";
import { duckduckgoProvider } from "./src/providers/duckduckgo.js";

// web: owned pi-craft extension. Two tools:
//   web_search    search the web through a small provider chain
//   fetch_content fetch URLs and return readable text
//
// No dependencies beyond the Pi host modules (typebox resolves from Pi).

export const WEB_SEARCH_TOOL = "web_search";
export const FETCH_CONTENT_TOOL = "fetch_content";

function registerBuiltins(): void {
  registerSearchProvider(exaProvider);
  registerSearchProvider(tavilyProvider);
  registerSearchProvider(searxngProvider);
  registerSearchProvider(duckduckgoProvider);
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

/** Provider chain: explicit param wins, then the unified `web` section provider, then built-in default order. */
function resolveChain(requested: string[] | undefined): string[] {
  const known = new Set(listSearchProviderNames());
  if (requested?.length) {
    const unknown = requested.filter((n) => !known.has(n));
    if (unknown.length > 0) throw new Error(`Unknown search provider(s): ${unknown.join(", ")}`);
    return requested;
  }
  const config = loadWebConfig();
  const fromConfig = cleanStringArray(config.provider ?? config.searchProvider);
  if (fromConfig) {
    const unknown = fromConfig.filter((n) => !known.has(n));
    if (unknown.length > 0)
      throw new Error(
        `Unknown provider(s) in the pi-craft.json web section: ${unknown.join(", ")}`,
      );
    return fromConfig;
  }
  return ["exa", "tavily", "searxng", "duckduckgo"].filter((n) => known.has(n));
}

function cleanQueries(query: unknown, queries: unknown): string[] {
  const raw = Array.isArray(queries) ? queries : query === undefined ? [] : [query];
  return raw
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter(Boolean);
}

function cleanUrls(url: unknown, urls: unknown): string[] {
  const raw = Array.isArray(urls) && urls.length > 0 ? urls : url === undefined ? [] : [url];
  const out = raw
    .filter((u): u is string => typeof u === "string")
    .map((u) => u.trim())
    .filter(Boolean);
  return [...new Set(out)];
}

const MAX_INLINE_CHARS = 12_000;

function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

export default function (pi: ExtensionAPI): void {
  registerBuiltins();

  pi.registerTool({
    name: WEB_SEARCH_TOOL,
    label: "Web Search",
    description:
      "Search the web and return a sourced answer. Tries providers in order (exa, tavily, searxng, duckduckgo) until one succeeds.",
    promptSnippet: "Use for web research questions.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Single search query." })),
      queries: Type.Optional(
        Type.Array(Type.String(), { description: "Multiple queries, each searched separately." }),
      ),
      numResults: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 20, description: "Results per query (default 5)." }),
      ),
      recencyFilter: Type.Optional(
        Type.Union(
          [Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")],
          { description: "Filter by recency." },
        ),
      ),
      domainFilter: Type.Optional(
        Type.Array(Type.String(), { description: "Limit to domains (prefix with - to exclude)." }),
      ),
      provider: Type.Optional(
        Type.Array(Type.String(), {
          description: "Provider chain to try in order; defaults to configured order.",
        }),
      ),
    }),
    async execute(_callId, params, signal, onUpdate, _ctx) {
      const queryList = cleanQueries(params.query, params.queries);
      if (queryList.length === 0) {
        throw new Error("No query provided. Use 'query' or 'queries'.");
      }
      const chain = resolveChain(
        params.provider !== undefined ? cleanStringArray(params.provider) : undefined,
      );
      const blocks: string[] = [];
      const details: Record<string, unknown> = { providers: chain, queryCount: queryList.length };
      for (const [qi, query] of queryList.entries()) {
        onUpdate?.({
          content: [
            { type: "text", text: `Searching ${qi + 1}/${queryList.length}: "${query}"...` },
          ],
          details: { phase: "searching", query },
        });
        const call = await searchWithFallback(chain, query, {
          numResults: params.numResults,
          recencyFilter: params.recencyFilter,
          domainFilter: params.domainFilter ? [...params.domainFilter] : undefined,
          ...(signal ? { signal } : {}),
        });
        const header =
          queryList.length > 1
            ? `## ${query}\n(provider: ${call.provider})\n\n`
            : `(provider: ${call.provider})\n\n`;
        const body = call.response.answer || "No results.";
        blocks.push(`${header}${body}`);
      }
      return { content: [{ type: "text", text: blocks.join("\n\n---\n\n") }], details };
    },
  });

  pi.registerTool({
    name: FETCH_CONTENT_TOOL,
    label: "Fetch Content",
    description:
      "Fetch URL(s) and return readable text. Blocks private-network targets unless fetch.allowPrivate is set.",
    promptSnippet: "Use to read page content as text.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Single URL to fetch." })),
      urls: Type.Optional(
        Type.Array(Type.String(), { description: "Multiple URLs, fetched in parallel." }),
      ),
    }),
    async execute(_callId, params, signal, onUpdate, _ctx) {
      const urlList = cleanUrls(params.url, params.urls);
      if (urlList.length === 0) {
        throw new Error("No URL provided. Use 'url' or 'urls'.");
      }
      const fetchConfig = loadWebConfig().fetch;
      const allowPrivate =
        !!fetchConfig &&
        typeof fetchConfig === "object" &&
        (fetchConfig as Record<string, unknown>).allowPrivate === true;
      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${urlList.length} URL(s)...` }],
        details: { phase: "fetch", urlCount: urlList.length },
      });
      const pages = await Promise.all(
        urlList.map(async (url) => {
          try {
            return {
              url,
              page: await fetchPage(url, { allowPrivate, ...(signal ? { signal } : {}) }),
            };
          } catch (err) {
            return { url, error: err instanceof Error ? err.message : String(err) };
          }
        }),
      );
      const blocks = pages.map((entry) => {
        if ("error" in entry) return `# ${entry.url}\n\nError: ${entry.error}`;
        const title = entry.page.title ? `${entry.page.title}\n\n` : "";
        const slice = truncate(entry.page.markdown, MAX_INLINE_CHARS);
        const note = slice.truncated ? `\n\n[truncated at ${MAX_INLINE_CHARS} chars]` : "";
        return `# ${entry.url}\n\n${title}${slice.text}${note}`;
      });
      const successful = pages.filter((p) => !("error" in p)).length;
      return {
        content: [{ type: "text", text: blocks.join("\n\n---\n\n") }],
        details: { urls: urlList, urlCount: urlList.length, successful },
      };
    },
  });
}

export { listSearchProviders, listSearchProviderNames, registerSearchProvider, searchWithFallback };
export type {
  SearchOptions,
  SearchProvider,
  SearchResponse,
  SearchResult,
} from "./src/providers.js";
export { cleanString };
