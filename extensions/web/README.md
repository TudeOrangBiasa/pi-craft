# web

Pi extension (opt-in). Web search and page fetch for the agent. `web_search` searches the web and returns sourced answers. `fetch_content` converts pages, GitHub repos, PDFs, and videos to readable markdown.

Keys live in `~/.pi/web-search.json`. No keys means limited search. The installer never enables this package on its own. Enable it in settings or pass `bun run install -- --with web`.

## Install

Install via the craft-harness installer (`bun run install` from repo root).

## License

MIT. See LICENSE. Upstream source retains original copyright.
