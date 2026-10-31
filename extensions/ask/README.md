# ask

Pi extension. One tool, `ask_user_question`. The model asks you instead of guessing. It opens a terminal dialog with up to four questions and written-out options. Answers come back as structured data.

Optional settings live in `~/.config/pi-ask-user-question/config.json` (read, never written): `collapseKey` (default `"ctrl+]"`), `guidance.description`, `guidance.promptSnippet`, `guidance.promptGuidelines`. Bad values fall back to defaults.

Non-interactive runs never see the tool. RPC and ACP hosts use native dialogs.

## Install

Install via the craft-harness installer (`bun run install` from repo root).

## License

MIT. See LICENSE. Upstream source retains original copyright.
