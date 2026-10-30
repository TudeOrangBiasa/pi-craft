import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Installer-owned record of what was deployed to the Pi home. Read before
// and written after every deploy; drives stale-package pruning. Never
// contains user-installed names.
export const MANIFEST_FILENAME = "installer-manifest.json";

export interface InstallerManifest {
  readonly version: 1;
  readonly packages: readonly string[];
}

function isManifest(value: unknown): value is { version: 1; packages: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const { version, packages } = value as { version?: unknown; packages?: unknown };
  return (
    version === 1 &&
    Array.isArray(packages) &&
    packages.every((entry): entry is string => typeof entry === "string")
  );
}

// Missing or malformed manifests mean "nothing installer-owned": warn and
// prune nothing rather than guessing.
export function loadManifest(manifestPath: string): InstallerManifest | undefined {
  if (!existsSync(manifestPath)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
  } catch {
    console.warn(`warning: ignoring malformed installer manifest: ${manifestPath}`);
    return undefined;
  }
  if (!isManifest(parsed)) {
    console.warn(`warning: ignoring malformed installer manifest: ${manifestPath}`);
    return undefined;
  }
  return { version: 1, packages: parsed.packages };
}

export function saveManifest(manifestPath: string, packages: readonly string[]): void {
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ version: 1, packages: [...packages] }, null, 2)}\n`,
  );
}
