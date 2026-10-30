import { sep } from "node:path";

export interface PiSettings {
  packages?: unknown;
  extensions?: unknown;
  [key: string]: unknown;
}

export interface MergeOptions {
  readonly deployedExtPaths: readonly string[];
  readonly stalePackages: ReadonlySet<string>;
  readonly forksDir: string;
  readonly extDir: string;
  readonly exists: (path: string) => boolean;
}

export type AddEntryResult = { added: unknown[] } | { error: string };

// Forks package a settings entry points at, or undefined when the entry is
// not under forksDir. Anything outside forksDir is never installer-owned.
export function forkNameFromEntry(entry: string, forksDir: string): string | undefined {
  const rest = entry.startsWith(forksDir + sep) ? entry.slice(forksDir.length + 1) : undefined;
  if (rest === undefined || rest === "") return undefined;
  const end = rest.indexOf(sep);
  return end === -1 ? rest : rest.slice(0, end);
}

// Forks packages the user's settings already enable. Only the packages key
// counts — that is the key Pi reads for fork dirs.
export function enabledForks(settings: PiSettings, forksDir: string): Set<string> {
  const enabled = new Set<string>();
  if (!Array.isArray(settings.packages)) return enabled;
  for (const entry of settings.packages) {
    if (typeof entry !== "string") continue;
    const name = forkNameFromEntry(entry, forksDir);
    if (name !== undefined) enabled.add(name);
  }
  return enabled;
}

// Merge + prune for settings.json. Removes only stale manifest-owned entries
// (both keys) and dead paths under the managed extensions dir; every other
// entry — non-strings, live user entries, even missing user paths — passes
// through in order. A missing extensions key is created; a present-but-
// not-array key of either kind is preserved untouched.
export function mergeSettings(settings: PiSettings, opts: MergeOptions): PiSettings {
  const packages = Array.isArray(settings.packages)
    ? settings.packages.filter((entry) => {
        if (typeof entry !== "string") return true;
        const name = forkNameFromEntry(entry, opts.forksDir);
        return name === undefined || !opts.stalePackages.has(name);
      })
    : settings.packages;
  let extensions = settings.extensions === undefined ? [] : settings.extensions;
  if (Array.isArray(extensions)) {
    const kept = extensions.filter((entry) => {
      if (typeof entry !== "string") return true;
      const name = forkNameFromEntry(entry, opts.forksDir);
      if (name !== undefined) return !opts.stalePackages.has(name);
      return !entry.startsWith(opts.extDir + sep) || opts.exists(entry);
    });
    for (const path of opts.deployedExtPaths) {
      if (!kept.includes(path)) kept.push(path);
    }
    extensions = kept;
  }
  return { ...settings, packages, extensions };
}

// Append a forks entry to the packages key. Missing key is created; a
// present-but-not-array key is refused rather than clobbered.
export function addPackageEntry(packages: unknown, entry: string): AddEntryResult {
  if (packages === undefined) return { added: [entry] };
  if (!Array.isArray(packages)) {
    return {
      error:
        "settings.json `packages` is not an array — refusing to modify it; fix by hand and re-run",
    };
  }
  return { added: packages.includes(entry) ? [...packages] : [...packages, entry] };
}
