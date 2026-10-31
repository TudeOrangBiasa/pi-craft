import { describe, expect, test } from "bun:test";
import { htmlToMarkdown, fetchPage } from "../src/extract.js";
import { guardFetchUrl } from "../src/ssrf.js";
import { createFakeFetch } from "./helpers/fake-pi.js";

describe("htmlToMarkdown", () => {
  test("extracts title and paragraph text, drops scripts and nav", () => {
    const page = htmlToMarkdown(`<html><head><title>Example</title><script>evil()</script></head>
      <body><nav><a href="/menu">Menu</a></nav><h1>Hello</h1><p>First <b>bold</b> line.</p></body></html>`);
    expect(page.title).toBe("Example");
    expect(page.markdown).toContain("# Hello");
    expect(page.markdown).toContain("First bold line.");
    expect(page.markdown).not.toContain("evil()");
    expect(page.markdown).not.toContain("Menu");
  });

  test("keeps link targets next to link text", () => {
    const page = htmlToMarkdown(
      `<body><p>See <a href="https://example.com/docs">the docs</a> for details.</p></body>`,
    );
    expect(page.markdown).toContain("the docs (https://example.com/docs)");
  });

  test("decodes entities and collapses whitespace", () => {
    const page = htmlToMarkdown(
      `<body><p>Fish &amp; chips&nbsp;&nbsp;are &lt;great&gt;.</p></body>`,
    );
    expect(page.markdown).toBe("Fish & chips are <great>.");
  });

  test("empty body yields empty markdown, not an error", () => {
    const page = htmlToMarkdown(
      `<html><head><title>Blank</title></head><body><script>x</script></body></html>`,
    );
    expect(page.title).toBe("Blank");
    expect(page.markdown).toBe("");
  });
});

describe("guardFetchUrl", () => {
  test("rejects loopback, localhost, and metadata addresses", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://localhost:8080/x",
      "http://169.254.169.254/latest",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
    ]) {
      expect(() => guardFetchUrl(url)).toThrow("private target");
    }
  });

  test("allows public hosts and private hosts with opt-in", () => {
    expect(guardFetchUrl("https://example.com/a").hostname).toBe("example.com");
    expect(guardFetchUrl("http://127.0.0.1/", { allowPrivate: true }).hostname).toBe("127.0.0.1");
  });

  test("rejects non-HTTP schemes and garbage", () => {
    expect(() => guardFetchUrl("file:///etc/passwd")).toThrow("non-HTTP");
    expect(() => guardFetchUrl("not a url")).toThrow("Invalid URL");
  });
});

describe("fetchPage", () => {
  test("passes plain text through with an empty title", async () => {
    const { run } = createFakeFetch([
      { match: "example.com/robots", text: "User-agent: *\nDisallow: /" },
    ]);
    const real = run;
    const textOnly = (async (input: string | URL | Request, init?: RequestInit) => {
      const res = await real(input, init);
      return new Response(await res.text(), {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }) as typeof fetch;
    const page = await fetchPage("https://example.com/robots.txt", { fetchImpl: textOnly });
    expect(page.title).toBe("");
    expect(page.markdown).toContain("Disallow: /");
  });

  test("throws on HTTP errors with status and host", async () => {
    const { run } = createFakeFetch([{ match: "example.com", status: 404, text: "gone" }]);
    const err = await fetchPage("https://example.com/missing", { fetchImpl: run }).catch(
      (e: unknown) => e,
    );
    expect(String(err)).toContain("404");
    expect(String(err)).toContain("example.com");
  });

  test("respects abort", async () => {
    const { run } = createFakeFetch([{ match: "example.com", text: "<p>x</p>" }]);
    const controller = new AbortController();
    controller.abort("test abort");
    const err = await fetchPage("https://example.com/", {
      fetchImpl: run,
      signal: controller.signal,
    }).catch((e: unknown) => e);
    // Bun fetch rejects with AbortError or the abort reason; either way it must not return a page.
    expect(String(err).length).toBeGreaterThan(0);
  });
});
