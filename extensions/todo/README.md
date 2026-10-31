# todo

Pi extension. One `todo` tool, one `/todos` command, one live panel above the editor. The model tracks multi-step work where you can see it.

The list rebuilds from the conversation. It survives `/reload` and compaction. No disk writes. Parallel sessions keep separate lists.

Optional config at `~/.config/pi-todo/config.json` (read, never written): `maxWidgetLines` (default `12`), `collapseKey` (default `"ctrl+shift+t"`), `guidance`. Headless runs still get the tool. Nothing renders.

## Install

Install via the craft-harness installer (`bun run install` from repo root).

## License

MIT. See LICENSE. Upstream source retains original copyright.
