# todo

Pi extension. One `todo` tool, one `/todos` command, one live panel above the editor. The model tracks multi-step work where you can see it.

The list rebuilds from the conversation. It survives `/reload` and compaction. No disk writes. Parallel sessions keep separate lists.

Config lives in the `todo` section of `~/.pi/agent/pi-craft.json` (old `~/.config/pi-todo/config.json` still works and moves over once): `maxWidgetLines` (default `12`), `collapseKey` (default `"ctrl+shift+t"`), `guidance`. Headless runs still get the tool. Nothing renders.

## Install

Install via the craft-harness installer (`bun run install` from repo root).

## License

MIT. See LICENSE. Upstream source retains original copyright.
