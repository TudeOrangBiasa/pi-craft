import type { SearchOptions, SearchProvider, SearchResponse, SearchResult } from "../providers.js";

// DuckDuckGo HTML fallback: keyless, always available, no dependencies. It
// scrapes the html endpoint with regexes over the result anchors, so it is
// brittle by nature and only the last resort. Prefer a keyed provider.

const SEARCH_URL = "https://html.duckduckgo.com/html/";
const TIMEOUT_MS = 30_000;

const ANCHOR_PATTERN =
  /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/gi;
const SNIPPET_PATTERN = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a\s*>/gi;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo wraps result links in a /l/?uddg= redirect; unwrap to the target. */
function unwrapResultUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (
    trimmed.startsWith("//duckduckgo.com/l/") ||
    trimmed.startsWith("https://duckduckgo.com/l/")
  ) {
    try {
      const target = new URL(
        trimmed.startsWith("//") ? `https:${trimmed}` : trimmed,
      ).searchParams.get("uddg");
      return target && (target.startsWith("http://") || target.startsWith("https://"))
        ? target
        : null;
    } catch {
      return null;
    }
  }
  return trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : null;
}

/** Parse result anchors and snippets out of a DDG html page. Pure, tested. */
export function parseDuckResults(html: string, limit: number): SearchResult[] {
  const anchors: Array<{ url: string; title: string }> = [];
  for (const match of html.matchAll(ANCHOR_PATTERN)) {
    // Skip ad slots: the anchor sits inside a `result--ad` container.
    const contextStart = Math.max(0, (match.index ?? 0) - 400);
    const context = html.slice(contextStart, match.index ?? 0);
    const lastContainer = context.lastIndexOf('class="result');
    if (
      lastContainer >= 0 &&
      context.slice(lastContainer, lastContainer + 60).includes("result--ad")
    )
      continue;
    const url = unwrapResultUrl(match[1] ?? "");
    const title = stripTags(match[2] ?? "");
    if (url && title) anchors.push({ url, title });
    if (anchors.length >= limit) break;
  }
  const snippets: string[] = [];
  for (const match of html.matchAll(SNIPPET_PATTERN)) {
    snippets.push(stripTags(match[1] ?? ""));
    if (snippets.length >= limit) break;
  }
  return anchors.map((anchor, i) => ({ ...anchor, snippet: snippets[i] ?? "" }));
}

export const duckduckgoProvider: SearchProvider = {
  name: "duckduckgo",
  isAvailable(): boolean {
    return true;
  },
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const run = options.fetchImpl ?? fetch;
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS);
    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", query);
    let response: Response;
    try {
      response = await run(url, {
        method: "POST",
        headers: {
          Accept: "text/html",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (compatible; pi-web/0.1)",
        },
        body: new URLSearchParams({ q: query }).toString(),
        signal,
      });
    } catch (err) {
      throw new Error(
        `DuckDuckGo request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`DuckDuckGo error ${response.status}: ${text.slice(0, 300)}`);
    }
    const results = parseDuckResults(await response.text(), options.numResults ?? 5);
    if (results.length === 0) {
      throw new Error("DuckDuckGo returned no parseable results");
    }
    const answer = results
      .map((r) =>
        r.snippet ? `${r.snippet}\nSource: ${r.title} (${r.url})` : `Source: ${r.title} (${r.url})`,
      )
      .join("\n\n");
    return { answer, results };
  },
};
