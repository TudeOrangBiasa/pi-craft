# Configuration

Every setting the package reads, where the file lives, and what happens when a value is
wrong.

## The config file

Set options in the `ask` section of `~/.pi/agent/pi-craft.json`:

```json
{
  "ask": {
    "collapseKey": "alt+o",
    "guidance": {
      "description": "Ask the user structured questions whenever requirements are ambiguous.",
      "promptSnippet": "Ask me before guessing on anything ambiguous",
      "promptGuidelines": [
        "Batch every clarifying question into one ask_user_question call.",
        "Put your recommended option first and suffix it with (Recommended)."
      ]
    }
  }
}
```

The unified file is optional. With no `ask` section every setting takes its
default. This package only reads the file. It writes the migrated section
once when falling back to an old path, never deletes or chmods anything.

### Old paths (fallback only)

When the unified file has no `ask` section, the old files still work and
migrate over once. The section migrates whole: once `ask` exists in the
unified file, the old files are ignored for that section.

1. `$XDG_CONFIG_HOME/pi-ask-user-question/config.json`, if `XDG_CONFIG_HOME` is set,
   non-empty and absolute. A leading `~` is expanded first; a relative value is ignored.
   Unset or ignored, the directory falls back to `~/.config`.
2. If that file does not exist, the legacy path `~/.config/pi-ask-user-question/config.json`
   is read. This path deliberately ignores `XDG_CONFIG_HOME`, so an existing config keeps
   working after you set the variable.
3. Neither present: all defaults.

### When a file is invalid

Bad JSON in the unified file is silent: the loader falls back to defaults
with no warning. The same applies to migrated old files: valid JSON that is
not an object (a string, number, `null`, or an array) is treated as `{}`.
Individual keys with the wrong type are dropped back to their default without
a warning.

## Settings

| Setting                     | What it does                                                                                           | Default               |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------- |
| `collapseKey`               | Key that collapses and expands the dialog overlay.                                                     | `"ctrl+]"`            |
| `guidance.description`      | Full text of the tool description the model sees. Replaces the built-in default entirely — no merging. | built-in description  |
| `guidance.promptSnippet`    | One-line snippet describing the tool in the system prompt.                                             | built-in snippet      |
| `guidance.promptGuidelines` | List of usage guidelines given to the model.                                                           | 4 built-in guidelines |

### `collapseKey`

The value uses Pi's keybinding id format: zero or more distinct modifiers from `ctrl`,
`shift`, `alt`, `super`, joined by `+`, followed by a base key. Values are trimmed and
lowercased before matching.

The base key is either a single printable character from
`a-z 0-9 _ - ! @ # $ % ^ & * ( ) | ~ \` ' " : ; , . / < > ? [ ] { } = \`, or one of the
named keys `escape`, `esc`, `enter`, `return`, `tab`, `space`, `backspace`, `delete`,
`insert`, `clear`, `home`, `end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`,
`f1` to `f12`.

Examples that work: `"ctrl+]"`, `"alt+o"`, `"ctrl+shift+h"`, `"f9"`, `"ctrl+}"`.

Set `"off"` (any casing) to disable the collapse shortcut entirely. With `off`
no raw terminal listener is registered.

A spec that does not match the grammar is rejected and the default is used. This is
strict on purpose: Pi's parser takes the last `+`-separated part as the key and ignores
unknown parts, so a typo like `"ctr+]"` would otherwise silently capture every bare `]`
keypress at the terminal level.

The footer hint inside the dialog names whatever key you configure (`Alt+O to collapse`
for `"alt+o"`), as do the collapsed one-line footer and the one-shot notification shown
when the dialog is first hidden. With `"off"` the collapse hint is dropped from the
footer entirely, since no shortcut can fire.

### `guidance.description`, `guidance.promptSnippet` and `guidance.promptGuidelines`

`guidance.description` replaces the entire built-in description Pi registers for the
`ask_user_question` tool (the text the model reads when deciding how to use it).
There is no merging: a valid value wins wholesale. It is used only when it is a non-empty string;
anything else falls back to the built-in default. Like the other guidance fields it is read
once, when the extension registers the tool, so changes take effect on the next Pi restart.

These replace the text Pi puts in the system prompt about when to reach for
`ask_user_question`. Use them to make the model ask more or less often, or to enforce a
house style for options.

`promptSnippet` is used only when it is a non-empty string. `promptGuidelines` is used
only when it is a non-empty array whose entries are all non-empty strings. Anything else
falls back to the built-in defaults. Both are read once, when the extension registers the
tool, so changes take effect on the next Pi restart.

## Environment variables

| Variable          | Effect                                                                |
| ----------------- | --------------------------------------------------------------------- |
| `XDG_CONFIG_HOME` | Relocates the config directory, as described above. Must be absolute. |

`LANG` and `LC_ALL` influence the dialog language, but they are read by
the localization SDK rather than by this package. See [localization.md](./localization.md).

No other environment variables are read. The package makes no model calls, so it needs no
API keys or model settings of its own.
