import { afterAll, describe, expect, mock, test } from "bun:test";
import { fetchPage } from "../src/extract.js";
import { registerSearchProvider, type SearchProvider } from "../src/providers.js";
import { createFakeFetch, createFakePi, outcomeText, runTool, withEnv } from "./helpers/fake-pi.js";

// Pi injects the real `typebox` when it loads extensions; outside Pi the
// import is unresolvable, so stub it before the extension module loads.
// Schemas are inert here: the fake pi passes params straight to execute().
void mock.module("typebox", () => ({
  Type: {
    Object: (shape: unknown) => ({ shape }),
    Optional: (schema: unknown) => ({ schema }),
    String: (options?: unknown) => ({ options }),
    Integer: (options?: unknown) => ({ options }),
    Array: (items: unknown, options?: unknown) => ({ items, options }),
    Union: (variants: unknown, options?: unknown) => ({ variants, options }),
    Literal: (value: unknown) => ({ value }),
  },
}));
const { default: activate, FETCH_CONTENT_TOOL, WEB_SEARCH_TOOL } = await import("../index.js");
afterAll(() => {
  mock.restore();
});

// The tools call searchWithFallback without a fetch seam, so these tests
// register stub providers that return canned data and keep everything offline.

function stubProvider(name: string, answer: string, failWith?: string): SearchProvider {
  return {
    name,
    isAvailable: () => true,
    search: async (query: string) => {
      if (failWith) throw new Error(failWith);
      return {
        answer,
        results: [
          {
            title: `${name} result`,
            url: `https://${name}.example.com/${query.length}`,
            snippet: answer,
          },
        ],
      };
    },
  };
}

describe("web_search", () => {
  test("registers under the web_search name", async () => {
    const fake = createFakePi();
    await withEnv(
      { EXA_API_KEY: undefined, TAVILY_API_KEY: undefined, SEARXNG_BASE_URL: undefined },
      async () => {
        activate(fake.pi as never);
      },
    );
    expect(fake.tools.has(WEB_SEARCH_TOOL)).toBe(true);
    expect(WEB_SEARCH_TOOL).toBe("web_search");
  });

  test("searches the requested provider chain and reports the winner", async () => {
    const fake = createFakePi();
    activate(fake.pi as never);
    registerSearchProvider(stubProvider("stub-a", "answer from a"));
    registerSearchProvider(stubProvider("stub-b", "answer from b"));
    const outcome = await runTool(fake, WEB_SEARCH_TOOL, {
      query: "pi extensions",
      provider: ["stub-a", "stub-b"],
    });
    expect(outcomeText(outcome)).toContain("answer from a");
    expect(outcomeText(outcome)).toContain("(provider: stub-a)");
  });

  test("falls back to the next provider when the first fails", async () => {
    const fake = createFakePi();
    activate(fake.pi as never);
    registerSearchProvider(stubProvider("stub-fail", "", "boom"));
    registerSearchProvider(stubProvider("stub-ok", "recovered answer"));
    const outcome = await runTool(fake, WEB_SEARCH_TOOL, {
      query: "fallback",
      provider: ["stub-fail", "stub-ok"],
    });
    expect(outcomeText(outcome)).toContain("recovered answer");
    expect(outcomeText(outcome)).toContain("(provider: stub-ok)");
  });

  test("throws when every provider fails, naming each error", async () => {
    const fake = createFakePi();
    activate(fake.pi as never);
    registerSearchProvider(stubProvider("stub-x", "", "x broke"));
    registerSearchProvider(stubProvider("stub-y", "", "y broke"));
    const err = await runTool(fake, WEB_SEARCH_TOOL, {
      query: "doomed",
      provider: ["stub-x", "stub-y"],
    }).catch((e: unknown) => e);
    expect(String(err)).toContain("stub-x: x broke");
    expect(String(err)).toContain("stub-y: y broke");
  });

  test("rejects unknown providers", async () => {
    const fake = createFakePi();
    activate(fake.pi as never);
    const err = await runTool(fake, WEB_SEARCH_TOOL, { query: "q", provider: ["nope"] }).catch(
      (e: unknown) => e,
    );
    expect(String(err)).toContain("Unknown search provider(s): nope");
  });

  test("requires a query", async () => {
    const fake = createFakePi();
    activate(fake.pi as never);
    registerSearchProvider(stubProvider("stub-q", "unused"));
    const err = await runTool(fake, WEB_SEARCH_TOOL, { provider: ["stub-q"] }).catch(
      (e: unknown) => e,
    );
    expect(String(err)).toContain("No query provided");
  });

  test("searches multiple queries, one block each", async () => {
    const fake = createFakePi();
    activate(fake.pi as never);
    registerSearchProvider({
      name: "stub-echo",
      isAvailable: () => true,
      search: async (query: string) => ({ answer: `got:${query}`, results: [] }),
    });
    const outcome = await runTool(fake, WEB_SEARCH_TOOL, {
      queries: ["one", "two"],
      provider: ["stub-echo"],
    });
    const text = outcomeText(outcome);
    expect(text).toContain("got:one");
    expect(text).toContain("got:two");
    expect(text).toContain("## one");
    expect(text).toContain("## two");
  });
});

describe("fetch_content", () => {
  test("registers under the fetch_content name", () => {
    const fake = createFakePi();
    activate(fake.pi as never);
    expect(fake.tools.has(FETCH_CONTENT_TOOL)).toBe(true);
    expect(FETCH_CONTENT_TOOL).toBe("fetch_content");
  });

  test("refuses private targets without opt-in", async () => {
    const fake = createFakePi();
    activate(fake.pi as never);
    const outcome = await runTool(fake, FETCH_CONTENT_TOOL, { url: "http://127.0.0.1/latest" });
    expect(outcomeText(outcome)).toContain("Refusing to fetch private target");
    expect(outcome.details).toMatchObject({ urlCount: 1, successful: 0 });
  });
  test("requires a url", async () => {
    const fake = createFakePi();
    activate(fake.pi as never);
    const err = await runTool(fake, FETCH_CONTENT_TOOL, {}).catch((e: unknown) => e);
    expect(String(err)).toContain("No URL provided");
  });

  test("fetchPage reads HTML through the fake fetch", async () => {
    const { run, requests } = createFakeFetch([
      {
        match: "example.com",
        text: "<html><head><title>Hi</title></head><body><p>Hello world</p></body></html>",
      },
    ]);
    const page = await fetchPage("https://example.com/", { fetchImpl: run });
    expect(page.title).toBe("Hi");
    expect(page.markdown).toBe("Hello world");
    expect(requests).toHaveLength(1);
  });
});
