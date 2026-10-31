import { guardFetchUrl, type FetchGuardOptions } from "./ssrf.js";

// HTML to markdown without dependencies: strip scripts, styles, nav, and other
// chrome, then convert the surviving block elements to markdown lines. This is
// a readability pass, not a renderer. Pages that need JavaScript come back
// thin, and that is fine: the agent reads text, not pixels.

const BLOCK_TAGS: Record<string, true> = {
  p: true,
  div: true,
  section: true,
  article: true,
  main: true,
  header: true,
  footer: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  li: true,
  tr: true,
  blockquote: true,
  pre: true,
  dd: true,
  dt: true,
  figcaption: true,
};

const DROP_TAGS: Record<string, true> = {
  script: true,
  style: true,
  noscript: true,
  template: true,
  svg: true,
  canvas: true,
  nav: true,
  aside: true,
  dialog: true,
};
const MAX_HTML_BYTES = 2_000_000;

export interface ReadablePage {
  title: string;
  markdown: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
}

/** Remove a tag and everything inside it, repeatedly until none match. */
function stripTag(html: string, tag: string): string {
  const open = new RegExp(`<${tag}[\\s>]`, "i");
  const pattern = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}\\s*>|<${tag}[\\s>][^>]*>`, "gi");
  let out = html;
  while (open.test(out)) {
    const next = out.replace(pattern, " ");
    if (next === out) break;
    out = next;
  }
  return out;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!match?.[1]) return "";
  return decodeEntities(match[1].replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Convert one HTML document to title plus markdown-ish text. Pure. */
export function htmlToMarkdown(html: string): ReadablePage {
  const bounded = html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html;
  const title = extractTitle(bounded);
  const bodyMatch = bounded.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i);
  let text = bodyMatch?.[1] ?? bounded;

  for (const tag of Object.keys(DROP_TAGS)) text = stripTag(text, tag);
  // Comments, doctype, head leftovers outside body match.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Links keep their text and gain the target in parens when useful.
  text = text.replace(
    /<a\s[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_m, d: string, s: string, b: string, label: string) => {
      const href = (d ?? s ?? b ?? "").trim();
      const words = label
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!words) return " ";
      if (href && !href.startsWith("#") && !href.startsWith("javascript:"))
        return ` ${words} (${href}) `;
      return ` ${words} `;
    },
  );
  // Headings become # lines before the generic block pass.
  text = text.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
    (_m, level: string, inner: string) => {
      const words = inner
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return words ? `\n\n${"#".repeat(Number(level))} ${words}\n\n` : "\n\n";
    },
  );
  // Line breaks and block boundaries become newlines.
  text = text.replace(/<(br|hr)[^>]*>/gi, "\n");
  text = text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (tag, name: string) =>
    name.toLowerCase() in BLOCK_TAGS ? "\n" : " ",
  );

  const markdown = decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return { title, markdown };
}

export interface FetchPageOptions extends FetchGuardOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Test seam: replaces global fetch. */
  fetchImpl?: typeof fetch;
}

export interface FetchedPage extends ReadablePage {
  url: string;
  status: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** GET a URL and return its readable text. Throws on network or HTTP errors. */
export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
  const target = guardFetchUrl(url, options);
  const run = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await run(target, {
    method: "GET",
    headers: { Accept: "text/html,application/xhtml+xml,text/*;q=0.8", "User-Agent": "pi-web/0.1" },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Fetch failed: ${response.status} ${response.statusText} for ${target.host}${target.pathname}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (contentType.includes("html") || contentType.includes("xhtml") || contentType === "") {
    const page = htmlToMarkdown(body);
    return { url: target.toString(), status: response.status, ...page };
  }
  return {
    url: target.toString(),
    status: response.status,
    title: "",
    markdown: body.slice(0, 200_000),
  };
}
