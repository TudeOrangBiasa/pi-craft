# tool-repair

Pi extension. Repairs malformed model tool calls before they run. Drops nulls for optional fields. Fixes wrong field names. Coerces numeric strings. Joins string arrays. Drops unrepairable candidates so Pi reports the original error.

Optional grammar repair is off by default. It recovers leaked provider grammar back into tool calls. Enable it in `~/.pi/agent/extensions/pi-tool-repair.json`. See `docs/tool-call-grammar-leakage-survey.md` for the survey.

Set `PI_TOOL_REPAIR_DEBUG=1` to log repair diagnostics to stderr.

## Install

Install via the craft-harness installer (`bun run install` from repo root).

## License

MIT. See LICENSE. Upstream source retains original copyright.
