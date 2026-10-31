import { resolveCredential, redactCredential } from "../config.js";
import type { SearchOptions, SearchProvider, SearchResponse } from "../providers.js";

// Tavily (https://tavily.com): search API with a built-in answer.
// Key from TAVILY_API_KEY or the pi-craft.json web section {"tavilyApiKey": "..."}.

const API_URL = "https://api.tavily.com/search";
const API_KEY_ENV = "TAVILY_API_KEY";
const TIMEOUT_MS = 60_000;

interface TavilyHit {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilySearchResponse {
  answer?: string;
  results?: TavilyHit[];
}

export const tavilyProvider: SearchProvider = {
  name: "tavily",
  isAvailable(): boolean {
    return resolveCredential("tavilyApiKey", API_KEY_ENV) !== null;
  },
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const key = resolveCredential("tavilyApiKey", API_KEY_ENV);
    if (!key) {
      throw new Error(
        "Tavily API key not found. Set TAVILY_API_KEY or add tavilyApiKey to the pi-craft.json web section (get a key at https://tavily.com).",
      );
    }
    const run = options.fetchImpl ?? fetch;
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS);
    const include = (options.domainFilter ?? [])
      .filter((d) => !d.trim().startsWith("-"))
      .map((d) => d.trim())
      .filter(Boolean);
    const exclude = (options.domainFilter ?? [])
      .filter((d) => d.trim().startsWith("-"))
      .map((d) => d.trim().slice(1).trim())
      .filter(Boolean);
    let response: Response;
    try {
      response = await run(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: options.numResults ?? 5,
          include_answer: "basic",
          ...(options.recencyFilter ? { time_range: options.recencyFilter } : {}),
          ...(include.length > 0 ? { include_domains: include } : {}),
          ...(exclude.length > 0 ? { exclude_domains: exclude } : {}),
        }),
        signal,
      });
    } catch (err) {
      throw new Error(
        redactCredential(
          `Tavily request failed: ${err instanceof Error ? err.message : String(err)}`,
          key,
        ),
      );
    }
    if (!response.ok) {
      const text = redactCredential(await response.text().catch(() => ""), key);
      throw new Error(`Tavily API error ${response.status}: ${text.slice(0, 300)}`);
    }
    let data: TavilySearchResponse;
    try {
      data = (await response.json()) as TavilySearchResponse;
    } catch {
      throw new Error("Tavily API returned invalid JSON");
    }
    const results = (data.results ?? [])
      .filter(
        (hit): hit is TavilyHit & { url: string } =>
          typeof hit.url === "string" && hit.url.length > 0,
      )
      .map((hit) => ({
        title: hit.title?.trim() || hit.url,
        url: hit.url,
        snippet: typeof hit.content === "string" ? hit.content.slice(0, 400).trim() : "",
      }));
    const answer =
      typeof data.answer === "string" && data.answer.trim()
        ? data.answer.trim()
        : results
            .map((r) =>
              r.snippet
                ? `${r.snippet}\nSource: ${r.title} (${r.url})`
                : `Source: ${r.title} (${r.url})`,
            )
            .join("\n\n");
    return { answer, results };
  },
};
