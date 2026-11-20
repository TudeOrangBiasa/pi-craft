// Single deploy driver for the installer: every package shipped to forks/.
// All core, no opt-ins: deploy everything, every run.
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
