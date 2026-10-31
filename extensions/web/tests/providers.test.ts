import { describe, expect, test } from "bun:test";
import { exaProvider } from "../src/providers/exa.js";
import { tavilyProvider } from "../src/providers/tavily.js";
import { searxngProvider } from "../src/providers/searxng.js";
import { duckduckgoProvider, parseDuckResults } from "../src/providers/duckduckgo.js";
import {
  getSearchProvider,
  listSearchProviderNames,
  registerSearchProvider,
  search,
  searchWithFallback,
  type SearchProvider,
} from "../src/providers.js";
import { createFakeFetch, withEnv } from "./helpers/fake-pi.js";

const NO_KEYS = { EXA_API_KEY: undefined, TAVILY_API_KEY: undefined, SEARXNG_BASE_URL: undefined };

describe("exa", () => {
  test("posts the query and maps highlights to snippets", async () => {
    const { run, requests } = createFakeFetch([
      {
        match: "api.exa.ai",
        json: {
          results: [
            { title: "Exa result", url: "https://example.com/a", highlights: ["matching passage"] },
            { title: "No URL" },
          ],
        },
      },
    ]);
    await withEnv({ ...NO_KEYS, EXA_API_KEY: "test-key", EXA_BASE_URL: undefined }, async () => {
      const response = await exaProvider.search("pi extensions", { fetchImpl: run });
      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toMatchObject({
        title: "Exa result",
        url: "https://example.com/a",
        snippet: "matching passage",
      });
      expect(response.answer).toContain("matching passage");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toContain("api.exa.ai/search");
      expect(requests[0]?.init?.body).toEqual(expect.stringContaining("pi extensions"));
    });
  });

  test("unavailable without a key, with a helpful error", async () => {
    await withEnv(NO_KEYS, async () => {
      expect(exaProvider.isAvailable()).toBe(false);
      const err = await exaProvider.search("q").catch((e: unknown) => e);
      expect(String(err)).toContain("EXA_API_KEY");
    });
  });

  test("scrubs the key from HTTP errors", async () => {
    const { run } = createFakeFetch([
      { match: "api.exa.ai", status: 401, text: "bad key secret-key-123" },
    ]);
    await withEnv({ EXA_API_KEY: "secret-key-123" }, async () => {
      const err = await exaProvider.search("q", { fetchImpl: run }).catch((e: unknown) => e);
      expect(String(err)).toContain("401");
      expect(String(err)).not.toContain("secret-key-123");
      expect(String(err)).toContain("[redacted]");
    });
  });
});

describe("tavily", () => {
  test("uses the built-in answer when present", async () => {
    const { run } = createFakeFetch([
      {
        match: "api.tavily.com",
        json: {
          answer: "Tavily says yes.",
          results: [{ title: "T", url: "https://example.com/t", content: "body text" }],
        },
      },
    ]);
    await withEnv({ ...NO_KEYS, TAVILY_API_KEY: "k" }, async () => {
      const response = await tavilyProvider.search("q", { fetchImpl: run });
      expect(response.answer).toBe("Tavily says yes.");
      expect(response.results[0]?.snippet).toBe("body text");
    });
  });

  test("unavailable without a key", async () => {
    await withEnv(NO_KEYS, async () => {
      expect(tavilyProvider.isAvailable()).toBe(false);
    });
  });
});

describe("searxng", () => {
  test("queries the configured instance json endpoint", async () => {
    const { run, requests } = createFakeFetch([
      {
        match: "search.example.com",
        json: {
          answers: ["instant answer"],
          results: [{ title: "S", url: "https://example.com/s", content: "found it" }],
        },
      },
    ]);
    await withEnv({ ...NO_KEYS, SEARXNG_BASE_URL: "https://search.example.com" }, async () => {
      const response = await searxngProvider.search("q", { fetchImpl: run });
      expect(response.answer).toContain("instant answer");
      expect(response.results[0]?.snippet).toBe("found it");
      expect(requests[0]?.url).toContain("format=json");
    });
  });

  test("unavailable without a base URL", async () => {
    await withEnv(NO_KEYS, async () => {
      expect(searxngProvider.isAvailable()).toBe(false);
    });
  });
});

describe("duckduckgo", () => {
  test("parses result anchors out of the html page", () => {
    const html = `<div class="result"><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=x">Example <b>Page</b></a>
      <a class="result__snippet" href="#">A fine <b>snippet</b> here.</a></div>
      <div class="result result--ad"><a class="result__a" href="https://ads.example.com/">Ad</a></div>`;
    const results = parseDuckResults(html, 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: "Example Page", url: "https://example.com/page" });
    expect(results[0]?.snippet).toContain("A fine snippet here.");
  });

  test("always available, throws when nothing parses", async () => {
    expect(duckduckgoProvider.isAvailable()).toBe(true);
    const { run } = createFakeFetch([
      { match: "duckduckgo.com", text: "<html><body>no results markup</body></html>" },
    ]);
    const err = await duckduckgoProvider.search("q", { fetchImpl: run }).catch((e: unknown) => e);
    expect(String(err)).toContain("no parseable results");
  });
});

describe("provider registry", () => {
  test("registerSearchProvider adds a provider agents can search", async () => {
    const custom: SearchProvider = {
      name: "custom-docs",
      isAvailable: () => true,
      search: async (query: string) => ({ answer: `docs:${query}`, results: [] }),
    };
    registerSearchProvider(custom);
    expect(getSearchProvider("custom-docs")).toBe(custom);
    expect(listSearchProviderNames()).toContain("custom-docs");
    const viaRegistry = await search("custom-docs", "  spaced  ");
    expect(viaRegistry.provider).toBe("custom-docs");
    expect(viaRegistry.response.answer).toBe("docs:spaced");
  });

  test("search post-filters domains and clamps counts", async () => {
    registerSearchProvider({
      name: "stub-many",
      isAvailable: () => true,
      search: async () => ({
        answer: "",
        results: [1, 2, 3, 4, 5, 6].map((n) => ({
          title: `t${n}`,
          url: n % 2 === 0 ? `https://keep.example.com/${n}` : `https://drop.example.com/${n}`,
          snippet: "",
        })),
      }),
    });
    const call = await search("stub-many", "q", {
      numResults: 2,
      domainFilter: ["keep.example.com", "-drop.example.com"],
    });
    expect(call.provider).toBe("stub-many");
    expect(call.response.results).toHaveLength(2);
    expect(call.response.results.every((r) => r.url.includes("keep.example.com"))).toBe(true);
  });

  test("searchWithFallback collects errors and returns the winner", async () => {
    registerSearchProvider({
      name: "stub-always-fails",
      isAvailable: () => true,
      search: async () => {
        throw new Error("nope");
      },
    });
    const result = await searchWithFallback(["stub-always-fails", "custom-docs"], "hello");
    expect(result.provider).toBe("custom-docs");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ provider: "stub-always-fails", error: "nope" });
  });

  test("unknown provider names fail with the available list", async () => {
    const err = await search("missing-provider", "q").catch((e: unknown) => e);
    expect(String(err)).toContain("Unknown search provider");
  });
});
