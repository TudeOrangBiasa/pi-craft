# web

Pi extension (opt-in). Two tools for the agent:

- `web_search`, search the web and return a sourced answer.
- `fetch_content`, fetch URLs and return readable text.

No dependencies. Everything runs on the Node/Bun standard library plus the
`typebox` and `@earendil-works/pi-coding-agent` modules Pi injects at load.

## Providers

`web_search` tries providers in order until one succeeds. Built-ins:

| Name         | Needs              | Notes                                     |
| ------------ | ------------------ | ----------------------------------------- |
| `exa`        | `EXA_API_KEY`      | Neural search, first choice when keyed.   |
| `tavily`     | `TAVILY_API_KEY`   | Search API with a built-in answer.        |
| `searxng`    | `SEARXNG_BASE_URL` | Self-hosted metasearch, keyless.          |
| `duckduckgo` | nothing            | HTML fallback, keyless, always available. |

Set keys as env vars or in the `web` section of `~/.pi/agent/pi-craft.json` (old `~/.pi/web-search.json` still works and moves over once):

```json
{
  "exaApiKey": "exa-...",
  "tavilyApiKey": "$TAVILY_API_KEY",
  "searxngBaseUrl": "https://search.example.com",
  "provider": ["tavily", "duckduckgo"]
}
```

Env vars win over the file. A `$NAME` value reads that env var. `provider`
sets the default chain; the tool's `provider` param overrides it per call.

## Adding a provider

Agents add providers without touching core. Import the registry from the
extension entry and register a `{ name, isAvailable, search }` object:

```typescript
import { registerSearchProvider } from "./index.js";

registerSearchProvider({
  name: "internal-docs",
  isAvailable: () => process.env.DOCS_TOKEN !== undefined,
  search: async (query, options) => {
    const response = await fetch(`https://docs.example.com/search?q=${query}`);
    const hits = (await response.json()) as Array<{ title: string; url: string; text: string }>;
    return {
      answer: hits.map((h) => h.text).join("\n\n"),
      results: hits.map((h) => ({ title: h.title, url: h.url, snippet: h.text.slice(0, 400) })),
    };
  },
});
```

Names are lowercase ids (`[a-z0-9-]`). `search()` post-filters
`domainFilter` and clamps `numResults`, so custom providers can skip both.
See `tests/providers.test.ts` for a runnable example.

## Fetch guard

`fetch_content` refuses loopback, localhost, link-local, and RFC 1918
targets. To allow private targets (intranet docs, local dev servers), set:

```json
{ "fetch": { "allowPrivate": true } }
```

## Install

Install via the pi-craft installer (`bun run install -- --with web` from
repo root), or enable the deployed `web` package in Pi settings.

## License

MIT. See LICENSE.
