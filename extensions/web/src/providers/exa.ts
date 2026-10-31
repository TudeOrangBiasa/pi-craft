import { resolveCredential, redactCredential, cleanString } from "../config.js";
import type { SearchOptions, SearchProvider, SearchResponse, SearchResult } from "../providers.js";

// Exa (https://exa.ai): neural web search over the /search endpoint.
// Key from EXA_API_KEY or the pi-craft.json web section {"exaApiKey": "..."}.
// Optional EXA_BASE_URL override exists for tests and proxies.

const DEFAULT_BASE_URL = "https://api.exa.ai";
const API_KEY_ENV = "EXA_API_KEY";
const TIMEOUT_MS = 60_000;

interface ExaHit {
  title?: string;
  url?: string;
  publishedDate?: string;
  highlights?: string[];
  text?: string;
}

interface ExaSearchResponse {
  results?: ExaHit[];
}

function exaBaseUrl(): string {
  const override = cleanString(process.env.EXA_BASE_URL);
  return (override ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function startDate(recency: SearchOptions["recencyFilter"]): string | undefined {
  if (!recency) return undefined;
  const days = { day: 1, week: 7, month: 30, year: 365 }[recency];
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function domainFilters(domainFilter: string[] | undefined): {
  includeDomains?: string[];
  excludeDomains?: string[];
} {
  const include = (domainFilter ?? [])
    .filter((d) => !d.trim().startsWith("-"))
    .map((d) => d.trim())
    .filter(Boolean);
  const exclude = (domainFilter ?? [])
    .filter((d) => d.trim().startsWith("-"))
    .map((d) => d.trim().slice(1).trim())
    .filter(Boolean);
  return {
    ...(include.length > 0 ? { includeDomains: include } : {}),
    ...(exclude.length > 0 ? { excludeDomains: exclude } : {}),
  };
}

function mapResult(hit: ExaHit): SearchResult | null {
  if (!hit.url) return null;
  const highlights = Array.isArray(hit.highlights)
    ? hit.highlights.filter((h): h is string => typeof h === "string" && h.trim().length > 0)
    : [];
  const snippet =
    highlights[0]?.trim() ?? (typeof hit.text === "string" ? hit.text.slice(0, 400).trim() : "");
  return { title: hit.title?.trim() || hit.url, url: hit.url, snippet };
}

export const exaProvider: SearchProvider = {
  name: "exa",
  isAvailable(): boolean {
    return resolveCredential("exaApiKey", API_KEY_ENV) !== null;
  },
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const key = resolveCredential("exaApiKey", API_KEY_ENV);
    if (!key) {
      throw new Error(
        "Exa API key not found. Set EXA_API_KEY or add exaApiKey to the pi-craft.json web section (get a key at https://exa.ai).",
      );
    }
    const run = options.fetchImpl ?? fetch;
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS);
    const published = startDate(options.recencyFilter);
    let response: Response;
    try {
      response = await run(`${exaBaseUrl()}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        body: JSON.stringify({
          query,
          type: "auto",
          numResults: options.numResults ?? 5,
          contents: { highlights: true },
          ...domainFilters(options.domainFilter),
          ...(published ? { startPublishedDate: published } : {}),
        }),
        signal,
      });
    } catch (err) {
      throw new Error(
        redactCredential(
          `Exa request failed: ${err instanceof Error ? err.message : String(err)}`,
          key,
        ),
      );
    }
    if (!response.ok) {
      const text = redactCredential(await response.text().catch(() => ""), key);
      throw new Error(`Exa API error ${response.status}: ${text.slice(0, 300)}`);
    }
    let data: ExaSearchResponse;
    try {
      data = (await response.json()) as ExaSearchResponse;
    } catch {
      throw new Error("Exa API returned invalid JSON");
    }
    const results: SearchResult[] = [];
    for (const hit of data.results ?? []) {
      const mapped = mapResult(hit);
      if (mapped) results.push(mapped);
    }
    const answer = results
      .map((r) =>
        r.snippet ? `${r.snippet}\nSource: ${r.title} (${r.url})` : `Source: ${r.title} (${r.url})`,
      )
      .join("\n\n");
    return { answer, results };
  },
};
