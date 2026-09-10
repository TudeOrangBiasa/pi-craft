# ask

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Let the model ask you instead of guessing. This extension gives [Pi Agent](https://github.com/badlogic/pi-mono) one tool — `ask_user_question` — that opens a terminal dialog of up to four questions with written-out options, and hands your choices back as structured data. Install it if you would rather spend fifteen seconds picking than an hour undoing a wrong assumption.

## Install

Install via the craft-harness installer (`bun run install` from repo root).

Restart your Pi session.

## Quick start

Nothing to set up — the tool is live as soon as Pi restarts. Hand the model a task with a real decision buried in it:

> Add caching to the API client.

Rather than picking a strategy on your behalf, the model calls `ask_user_question` and a dialog takes over the bottom of your terminal. Move with `↑`/`↓`, choose with `Enter`, press `n` to attach a note to a question — or a global note to the whole questionnaire from the Submit tab — or land on the `Type something.` row to answer in your own words. While typing, `Shift+Enter` adds a line, `Ctrl+G` opens Pi's configured external editor, and `Ctrl+U` clears the draft; browsing another option and returning keeps what you wrote. `Esc` abandons the questionnaire entirely.

When the questionnaire begins waiting in an interactive TTY, it emits one standard terminal BEL (`\x07`). Your terminal configuration determines whether that appears as an audible alert, a visual alert, or nothing; redirected and non-TTY output is untouched.

The dialog shows one question at a time with its options, descriptions, and a `Type something.` row for a custom answer.

When the model asks several things at once, `Tab` moves between them and a Submit tab reviews everything before it goes back. The Submit tab lists your answers, names anything still blank, and offers Submit or Cancel.

## What you get

- **Typed options instead of a wall of prose** — each question carries 2-4 authored choices, and every choice comes with a description of what it means or what it costs you.
- **You can always answer in your own words** — a `Type something.` row is appended to every question, single- or multi-select, widens to the full pane while you type, keeps its multiline draft visible in that row while you browse, and supports Pi's `Shift+Enter` newline and `Ctrl+G` external-editor flows.
- **Compare real artifacts, not just labels** — an option can carry a markdown `preview` (ASCII mockup, code, diagram, config) that renders in a bordered box beside the option list.
- **One interruption, not five** — up to four questions arrive in a single tabbed dialog, and the Submit tab lists your answers and names anything still blank before you commit.
- **Notes on any answer — or on all of them** — `n` opens a multiline note editor on any question tab, and on the Submit tab it opens one global note for the whole questionnaire. Per-question notes reach the model as `user notes: <text>`, the global note as `global note: <text>`; neither marks a question answered.
- **Read the transcript behind the dialog** — `Ctrl+]` collapses the overlay so you can scroll the conversation, then brings it back with your answers intact.
- **Works outside the terminal too** — in RPC and ACP hosts such as the VS Code pendant or Zed the questionnaire walks through the host's native dialogs (notes are terminal-only and do not carry over), and in non-interactive runs the tool is removed from the model's tool list instead of failing every call.

## Configuration

Optional. Settings live in `~/.config/pi-ask-user-question/config.json`; the file is read, never written.

| Setting | What it does | Default |
| --- | --- | --- |
| `collapseKey` | Key that collapses and expands the dialog. Accepts Pi keybinding ids such as `alt+o`; `"off"` disables the shortcut. | `"ctrl+]"` |
| `guidance.description` | Full replacement for the tool description the model sees. A non-empty string replaces the built-in text entirely — no merging. | built-in description |
| `guidance.promptSnippet` | One-line description of the tool in the system prompt — tune how eagerly the model asks. | built-in snippet |
| `guidance.promptGuidelines` | Usage guidelines given to the model, as a list of strings. | 4 built-in guidelines |

```json
{ "collapseKey": "alt+o" }
```

Malformed JSON falls back to the defaults with a warning; an individual unusable value is silently dropped back to its default. Never an error.

## Reference

- [Tool schema](./docs/tool-schema.md) — parameters, limits, reserved labels, validation errors, the result envelope, and the `pi-ask-user-question:prompt` event.
- [Keyboard and layout](./docs/keyboard.md) — every key, the rows the dialog appends, notes, collapse mode, and how previews and overflow adapt to terminal size.
- [Configuration](./docs/configuration.md) — file lookup and `XDG_CONFIG_HOME`, the `collapseKey` grammar, the `guidance.*` prompt overrides, and how invalid values are handled.
- [Hosts and runtime behavior](./docs/hosts.md) — terminal vs RPC vs non-interactive, what degrades in each, and the load-failure envelopes.
- [Localization](./docs/localization.md) — the nine shipped languages, how the locale is chosen, and how to add one.

## Requirements

- Node.js 22 or newer.
- Pi Agent, with an interactive terminal or an RPC/ACP host. Non-interactive runs never see the tool.
- A terminal at least 100 columns wide for side-by-side previews; narrower terminals stack the preview under the options.

No native dependencies, no compiler, no API keys — the extension makes no model calls of its own.

## Troubleshooting

**The model says the questionnaire UI failed to load and asks its questions as chat text.** The dialog's modules were replaced on disk while Pi was running, usually by a package-manager install touching the store. Repair the install if it is broken, then restart Pi; the failure is not recoverable inside the running process.

**`Ctrl+]` does nothing.** On keyboard layouts where `]` sits on the shifted layer (Latin American among them) the default is unreachable. Set `collapseKey` to something you can type, for example `"alt+o"`.

