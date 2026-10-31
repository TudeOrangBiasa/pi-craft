# args

Pi extension. Shell-style `$1` and `$ARGUMENTS` placeholders plus `` !`cmd` `` shell substitution. Placeholders expand in skill bodies at invocation. Command output lands in the prompt before the model reads it.

Per-skill frontmatter: `shell-timeout` (seconds per command, `0` disables, default `120`). Commands run in the Pi session working directory, through `sh -c` (macOS, Linux) or `powershell.exe -Command` (Windows).

## Install

Install via the craft-harness installer (`bun run install` from repo root).

## License

MIT. See LICENSE. Upstream source retains original copyright.
