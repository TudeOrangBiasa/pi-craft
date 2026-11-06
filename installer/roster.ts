// Single deploy driver for the installer: every package shipped to forks/.
// Must match the Vendored table in extensions/REGISTRY.md. All core, no
// opt-ins: deploy everything, every run.
export const ROSTER: readonly string[] = [
  "tool-repair",
  "hashline",
  "subagents",
  "fff",
  "safety-net",
  "ask",
  "todo",
];

// Owned extensions deployed to extensions/ (always installed).
// Single-file extensions (managed source: extensions/<name>/<name>.ts).
export const SINGLE_FILE: readonly string[] = ["bash-interceptor.ts", "governor.ts"];

// Directory extensions: deployed as extensions/<name>/ with siblings intact.
// (A sibling .ts next to a top-level entry would be loaded as its own
// extension — rule 1 of discovery — so omfg ships as a directory with its
// package.json manifest instead.)
export const DIR_EXTENSIONS: readonly string[] = ["omfg"];
