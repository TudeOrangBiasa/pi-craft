# clear

Pi extension with slash commands:

- `/clear`, flush cached model data.
- `/btw [--ctx] <question>`, ask an isolated side question without interrupting the main agent.

## `/clear`

Deletes `~/.cache/pi` to flush stale model-data cache, then prompts you to run `/reload`.

## `/btw`

`/btw` runs a separate in-memory child session concurrently with the main agent:

```text
/btw what is the difference between a mutex and a semaphore?
/btw --ctx given what we just did, what should I test first?
```

Run `/btw` with no question to print usage. The live
above-editor widget lingers finished asides for 30s (errors 90s), so a
fire-and-leave aside stays visible while you are away; the durable answer
card in the log never expires.

The child session:

- starts with an empty conversation and a lean system prompt;
- snapshots the main session's model, thinking level, active tools, credentials, extensions, and working directory;
- never imports the main conversation **unless you pass `--ctx`**, which folds the last 10 main-session turns in as a one-shot, read-only preamble (visible in the question, still a fresh isolated session, nothing is written back to the main thread);
- publishes its Markdown answer in a visually distinct side-thread card;
- keeps rendered BTW answers out of future main-agent LLM context;
- supports multiple concurrent side questions.

The card lands the instant the side question finishes, even mid-stream. It is
a display-only entry, so it never enters the main agent's LLM context and
never steers the running turn.

## Install

Install via the pi-craft installer (`bun run install` from repo root).

## License

MIT
