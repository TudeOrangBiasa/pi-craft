# subagents

Pi extension for parallel subagents. Spawn background agents, watch them in FleetView, steer them mid-run, resume finished runs.

## Tools

- `Agent` (`subagent_type`, `prompt`, `description`, `run_in_background`, `resume`, `isolated`). No scheduling. No nesting.
- `get_subagent_result`. Returns the result. After a reload, interrupted runs return `interrupted` and partial output.
- `steer_subagent`. Sends a message into a running agent.

## Behavior

- Each session holds a maximum of one level. Subagents never get the `Agent` tool.
- Runs persist under the session state. A reload lists interrupted runs with a one-line notice.
- Each agent has a `timeoutMs` limit (frontmatter `timeout_ms` or the settings default). A hung run ends as `timeout`.
- Old settings keys (`schedulingEnabled`, `workflowsEnabled`) are ignored. Old frontmatter (`allowed_subagents`, `memory`) loads with a warning.
- Custom agents live in `.pi/agents/<name>.md`. `Explore` is the read-only type.

## Install

Install via the craft-harness installer (`bun run install` from repo root).

## License

MIT. See LICENSE. Upstream source retains original copyright.
