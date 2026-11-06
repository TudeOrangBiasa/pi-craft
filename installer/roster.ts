// Single deploy driver for the installer: every package shipped to forks/,
// each with its tier. Must match the Vendored table in extensions/REGISTRY.md.

export type Tier = "core" | "opt-in";

export interface PackageEntry {
  readonly name: string;
  readonly tier: Tier;
}

export const ROSTER: readonly PackageEntry[] = [
  { name: "tool-repair", tier: "core" },
  { name: "hashline", tier: "core" },
  { name: "subagents", tier: "core" },
  { name: "fff", tier: "core" },
  { name: "safety-net", tier: "core" },
  { name: "ask", tier: "core" },
  { name: "todo", tier: "core" },
];

// Owned extensions deployed to extensions/ (always installed).
// Single-file extensions (managed source: extensions/<name>/<name>.ts).
export const SINGLE_FILE: readonly string[] = ["bash-interceptor.ts", "governor.ts"];

// Directory extensions: deployed as extensions/<name>/ with siblings intact.
// (A sibling .ts next to a top-level entry would be loaded as its own
// extension — rule 1 of discovery — so omfg ships as a directory with its
// package.json manifest instead.)
export const DIR_EXTENSIONS: readonly string[] = ["omfg"];
