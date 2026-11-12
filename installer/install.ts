import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ROSTER, SINGLE_FILE } from "./roster.js";
import { mergeSettings } from "./settings.js";
import type { PiSettings } from "./settings.js";
import { loadManifest, MANIFEST_FILENAME, saveManifest } from "./manifest.js";

// Plugin-based installer for the pi-craft Pi config.
// Layout: extensions/<name>/ = source of truth for EVERY extension.
// Roster-driven: ROSTER (installer/roster.ts, matching extensions/REGISTRY.md)
// is the single deploy driver. Everything deploys, every run. An
// installer-owned manifest in the Pi home tracks what was deployed; re-runs
// prune stale manifest-owned packages from forks/ and settings.json. Entries
// not in the manifest (user-installed) are never touched.

const REPO = join(dirname(new URL(import.meta.url).pathname), "..");
const PI =
  process.env.PI_CODING_AGENT_DIR?.trim() !== "" && process.env.PI_CODING_AGENT_DIR !== undefined
    ? (process.env.PI_CODING_AGENT_DIR as string)
    : join(homedir(), ".pi", "agent");

function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) copyTree(s, d);
    else copyFileSync(s, d);
  }
}

function failSettings(settingsPath: string): never {
  console.error(
    `error: cannot parse ${settingsPath} — refusing to modify it; fix by hand and re-run`,
  );
  process.exit(1);
}

function readSettings(settingsPath: string): PiSettings {
  if (!existsSync(settingsPath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as unknown;
  } catch {
    failSettings(settingsPath);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    failSettings(settingsPath);
  return parsed as PiSettings;
}

function main(): void {
  if (process.argv.length > 2) {
    console.error(`error: unknown argument: ${process.argv[2]} (usage: install.ts)`);
    process.exit(1);
  }

  const extDir = join(PI, "extensions");
  const forksDir = join(PI, "forks");
  mkdirSync(extDir, { recursive: true });
  mkdirSync(forksDir, { recursive: true });

  const settingsPath = join(PI, "settings.json");
  const settings = readSettings(settingsPath);

  // What to deploy: everything in the roster, every run. What is stale:
  // previously deployed but since dropped from the roster.
  const deployList = [...ROSTER];
  const deployNames = new Set(deployList);
  const oldManifest = loadManifest(join(PI, MANIFEST_FILENAME));
  const stale =
    oldManifest === undefined ? [] : oldManifest.packages.filter((name) => !deployNames.has(name));

  // 1. Single-file extensions.
  const deployedExts: string[] = [];
  for (const file of SINGLE_FILE) {
    const src = join(REPO, "extensions", file.replace(/\.ts$/, ""), file);
    if (!existsSync(src)) {
      console.error(`missing extension source: ${src}`);
      process.exit(1);
    }
    copyFileSync(src, join(extDir, file));
    deployedExts.push(join(extDir, file));
    console.log(`installed extension: ${file}`);
  }

  // 2. Package extensions + deps.
  for (const name of deployList) {
    const src = join(REPO, "extensions", name);
    if (!existsSync(src)) {
      console.error(`missing package source: ${src}`);
      process.exit(1);
    }
    const dest = join(forksDir, name);
    copyTree(src, dest);
    if (name === "safety-net") {
      for (const extra of ["api.js", "api.d.ts", "index.js", "index.d.ts"]) {
        rmSync(join(dest, "dist", extra), { recursive: true, force: true });
      }
    }
    const hadModules = existsSync(join(dest, "node_modules"));
    if (existsSync(join(dest, "package.json")) && !hadModules) {
      const r = Bun.spawnSync(["bun", "install", "--cwd", dest], {
        stdout: "ignore",
        stderr: "inherit",
      });
      if (r.exitCode !== 0 && !existsSync(join(dest, "node_modules"))) {
        console.error(`bun install failed in ${dest} with no node_modules to fall back on`);
        process.exit(1);
      }
      if (r.exitCode !== 0) {
        console.warn(`warning: bun install failed in ${dest} — keeping existing node_modules`);
      }
    }
    console.log(`installed package: ${name}`);
  }

  // 3. Prune stale manifest-owned packages.
  for (const name of stale) {
    rmSync(join(forksDir, name), { recursive: true, force: true });
    console.log(`removed package: ${name}`);
  }
  // One-time #2 migration: pi-rtk-optimizer was runtime-managed by the
  // removed extension, never manifest-owned, so stale-prune can't reach it.
  rmSync(join(extDir, "pi-rtk-optimizer"), { recursive: true, force: true });

  // 4. Agents and system prompt.
  copyTree(join(REPO, "agents"), join(PI, "agents"));
  copyFileSync(join(REPO, "prompt", "APPEND_SYSTEM.md"), join(PI, "APPEND_SYSTEM.md"));
  console.log("installed agents/, APPEND_SYSTEM.md");

  // 5. Merge settings (prune stale, preserve user entries + order).
  if (settings.extensions !== undefined && !Array.isArray(settings.extensions)) {
    console.warn("warning: settings.json `extensions` is not an array — leaving it untouched");
  }
  const merged = mergeSettings(settings, {
    deployedExtPaths: deployedExts,
    stalePackages: new Set(stale),
    forksDir,
    extDir,
    exists: existsSync,
  });
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`merged settings.json (Pi home: ${PI})`);

  // 6. Record what was deployed.
  saveManifest(join(PI, MANIFEST_FILENAME), deployList);
  console.log("done — restart Pi to load.");
}

main();
