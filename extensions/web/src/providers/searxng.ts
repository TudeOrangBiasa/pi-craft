import { cleanString, loadWebConfig } from "../config.js";
import type { SearchOptions, SearchProvider, SearchResponse, SearchResult } from "../providers.js";

// SearXNG: self-hosted metasearch over its JSON endpoint. No key needed, but
// the instance URL must be configured: SEARXNG_BASE_URL env var or
// the pi-craft.json web section {"searxngBaseUrl": "https://search.example.com"}.

const TIMEOUT_MS = 30_000;

interface SearXNGHit {
  title?: string;
  url?: string;
  content?: string;
}

interface SearXNGResponse {
  answers?: unknown[];
  results?: SearXNGHit[];
}

function searxngBaseUrl(): string | null {
  const raw =
    cleanString(process.env.SEARXNG_BASE_URL) ?? cleanString(loadWebConfig().searxngBaseUrl);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString().replace(/\/+$/, "");
}

function withDomainFilters(query: string, domainFilter: string[] | undefined): string {
  const parts = [query];
  for (const raw of domainFilter ?? []) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("-")) parts.push(`-site:${trimmed.slice(1).trim()}`);
    else if (trimmed) parts.push(`site:${trimmed}`);
  }
  return parts.join(" ");
}

export const searxngProvider: SearchProvider = {
  name: "searxng",
  isAvailable(): boolean {
    return searxngBaseUrl() !== null;
  },
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const base = searxngBaseUrl();
    if (!base) {
      throw new Error(
        "SearXNG base URL not configured. Set SEARXNG_BASE_URL or add searxngBaseUrl to the pi-craft.json web section.",
      );
    }
    const run = options.fetchImpl ?? fetch;
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS);
    const url = new URL(`${base}/search`);
    url.searchParams.set("q", withDomainFilters(query, options.domainFilter));
    url.searchParams.set("format", "json");
    if (options.recencyFilter) url.searchParams.set("time_range", options.recencyFilter);
    let response: Response;
    try {
      response = await run(url, {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": "pi-web/0.1" },
        signal,
      });
    } catch (err) {
      throw new Error(
        `SearXNG request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`SearXNG error ${response.status}: ${text.slice(0, 300)}`);
    }
    let data: SearXNGResponse;
    try {
      data = (await response.json()) as SearXNGResponse;
    } catch {
      throw new Error("SearXNG returned invalid JSON");
    }
    const results: SearchResult[] = [];
    for (const hit of data.results ?? []) {
      if (!hit.url) continue;
      results.push({
        title: hit.title?.trim() || hit.url,
        url: hit.url,
        snippet: typeof hit.content === "string" ? hit.content.slice(0, 400).trim() : "",
      });
    }
    const instant = (data.answers ?? []).filter(
      (a): a is string => typeof a === "string" && a.trim().length > 0,
    );
    const cited = results.map((r) =>
      r.snippet ? `${r.snippet}\nSource: ${r.title} (${r.url})` : `Source: ${r.title} (${r.url})`,
    );
    return { answer: [...instant, ...cited].join("\n\n"), results };
  },
};
