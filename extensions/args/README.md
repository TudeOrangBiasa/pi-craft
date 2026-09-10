# args

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Pass arguments to a skill the way you pass them to a shell command.
`args` adds `$1`, `$2`, `$ARGUMENTS` and friends to
[Pi Agent](https://github.com/badlogic/pi-mono) skill bodies, and runs
`` !`cmd` `` and ```` ```! ```` blocks so real command output is in the prompt
before the model reads it. It is for anyone who writes Pi skills and wants to
parameterize them instead of keeping one hard-coded copy per case.

## Install

Install via the craft-harness installer (`bun run install` from repo root).

Restart your Pi session.

## Quick start

Create `.pi/skills/deploy/SKILL.md` in your project (or
`~/.pi/agent/skills/deploy/SKILL.md` for a personal skill) and put a
placeholder in the body:

```yaml
---
name: deploy
description: Deploy a service to an environment
---

Deploy service $1 to $2.
Current branch: !`git branch --show-current`
```

Invoke it with arguments:

```
/skill:deploy api production
```

The model receives the body with `$1` as `api`, `$2` as `production`, the real
branch name in place of the `git` command, and a trailing
`Skill input: api production` line marking your raw input.

## What you get

- **Skills take arguments like shell commands** — positionals, `$ARGUMENTS`
  and `${@:N:L}` slices, split with shell-style quoting, so
  `/skill:deploy "staging server" --force` puts `staging server` in `$1`.
- **Command output lands in the prompt, not in a tool call** — inline
  `` !`git status -s` `` and ```` ```! ```` blocks execute first and the model
  reads the evidence instead of deciding to go fetch it.
- **Installing it is a no-op for existing skills** — a body with no
  placeholder and no shell syntax emits text byte-identical to Pi's built-in
  expansion, pinned by a regression test.
- **The model stops reading your argument as a new instruction** — arguments
  are emitted under an explicit `Skill input:` label and a skill-invocation
  protocol is prepended to the system prompt every turn.
- **Runaway commands can't hang the turn or flood the context** — every
  command is capped at 120 s by default and output is tail-truncated to
  50 KB / 2000 lines; errors are inlined so the rest of the body still gets
  through.
- **Commands run in the order you wrote them** — strictly sequential, never
  parallel, so `` !`mkdir x` `` then `` !`ls x` `` behaves.
- **Skill-relative paths keep working** — `${SKILL_DIR}` always resolves to
  the skill file's own directory, however the skill was installed;
  `${SESSION_ID}` gives the current session id.

## Configuration

`args` reads no config file and no environment variables. The one knob is
per-skill frontmatter, in the skill's own `SKILL.md`:

| Key | What it does | Default |
| --- | --- | --- |
| `shell-timeout` | Ceiling in **seconds** for each `` !`cmd` `` / ```` ```! ```` command in that skill. `0` disables the timer. | `120` |

Shell commands always run in the Pi session's working directory, not the skill
directory.

## Reference

- [Placeholders and variables](./docs/placeholders.md)
  — every placeholder and runtime variable, indexing and slicing rules,
  quoting, and what substitution deliberately does not do.
- [Authoring skills](./docs/authoring-skills.md)
  — choosing `$ARGUMENTS` over positionals, empty-argument behaviour,
  frontmatter, and a worked example with the exact text the model receives.
- [Shell substitution](./docs/shell-substitution.md)
  — shell syntax, execution order, timeouts, error strings, output budgets,
  and Windows / PowerShell authoring.
- [How it works](./docs/how-it-works.md)
  — the three event hooks, the transformation pipeline, both emit paths, the
  skill index, and the paths that are not covered.

## Requirements

- A Pi Agent host. No API key, no model selection, no native modules —
  nothing here calls a model.
- **A POSIX shell or PowerShell** for `` !`cmd` `` / ```` ```! ```` blocks.
  Commands run through `sh -c` on macOS and Linux and `powershell.exe -Command`
  on Windows, where POSIX-only tools such as `grep`, `sed` and `awk` are not
  aliased — see
  [Shell substitution](./docs/shell-substitution.md).

## License

MIT — see [LICENSE](LICENSE).
