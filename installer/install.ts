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
import { DIR_EXTENSIONS, ROSTER, SINGLE_FILE } from "./roster.js";
import { addPackageEntry, enabledForks, mergeSettings } from "./settings.js";
import type { PiSettings } from "./settings.js";
import { loadManifest, MANIFEST_FILENAME, saveManifest } from "./manifest.js";

// Plugin-based installer for the craft-harness Pi config.
// Layout: extensions/<name>/ = source of truth for EVERY extension.
// Roster-driven: ROSTER (installer/roster.ts, matching extensions/REGISTRY.md)
// is the single deploy driver. Opt-ins deploy only when already enabled in
// the user's settings or passed via --with. An installer-owned manifest in
// the Pi home tracks what was deployed; re-runs prune stale manifest-owned
// packages from forks/ and settings.json. Entries not in the manifest
// (user-installed) are never touched.
// Idempotent: safe to re-run. Never touches anything outside the Pi home
// except reading this repo.

const REPO = join(dirname(new URL(import.meta.url).pathname), "..");
const PI =
  process.env.PI_CODING_AGENT_DIR?.trim() !== "" && process.env.PI_CODING_AGENT_DIR !== undefined
    ? (process.env.PI_CODING_AGENT_DIR as string)
    : join(homedir(), ".pi", "agent");

const CORE_NAMES = new Set(
  ROSTER.filter((entry) => entry.tier === "core").map((entry) => entry.name),
);
const OPT_IN_NAMES = new Set(
  ROSTER.filter((entry) => entry.tier === "opt-in").map((entry) => entry.name),
);

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

function parseArgs(argv: readonly string[]): { withNames: string[] } {
  const withNames: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--with") {
      if (i + 1 >= argv.length) {
        console.error("error: --with needs a package name");
        process.exit(1);
      }
      withNames.push(argv[i + 1]);
      i++;
    } else if (arg.startsWith("--with=")) {
      const name = arg.slice("--with=".length);
      if (name === "") {
        console.error("error: --with needs a package name");
        process.exit(1);
      }
      withNames.push(name);
    } else {
      console.error(`error: unknown argument: ${arg} (usage: install.ts [--with <name>]...)`);
      process.exit(1);
    }
  }
  return { withNames };
}

function validateWithNames(withNames: readonly string[]): void {
  for (const name of withNames) {
    if (CORE_NAMES.has(name)) {
      console.error(`error: --with ${name}: already core (always deployed)`);
      process.exit(1);
    }
    if (!OPT_IN_NAMES.has(name)) {
      console.error(`error: --with ${name}: not an opt-in package in the roster`);
      process.exit(1);
    }
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
  const { withNames } = parseArgs(process.argv.slice(2));
  validateWithNames(withNames);

  const extDir = join(PI, "extensions");
  const forksDir = join(PI, "forks");
  mkdirSync(extDir, { recursive: true });
  mkdirSync(forksDir, { recursive: true });

  const settingsPath = join(PI, "settings.json");
  let settings = readSettings(settingsPath);
  for (const name of withNames) {
    const result = addPackageEntry(settings.packages, join(forksDir, name));
    if ("error" in result) {
      console.error(`error: --with ${name}: ${result.error}`);
      process.exit(1);
    }
    settings = { ...settings, packages: result.added };
  }

  // What to deploy: core always, plus opt-ins the user already enabled or
  // passed explicitly. What is stale: previously deployed but no longer —
  // either dropped from the roster or an opt-in since disabled.
  const deployOptIns = new Set(withNames);
  for (const name of enabledForks(settings, forksDir)) {
    if (OPT_IN_NAMES.has(name)) deployOptIns.add(name);
  }
  const deployList = ROSTER.filter(
    (entry) => entry.tier === "core" || deployOptIns.has(entry.name),
  ).map((entry) => entry.name);
  const deployNames = new Set(deployList);
  const oldManifest = loadManifest(join(PI, MANIFEST_FILENAME));
  const stale =
    oldManifest === undefined ? [] : oldManifest.packages.filter((name) => !deployNames.has(name));

  // 1. Single-file + directory extensions.
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
  for (const name of DIR_EXTENSIONS) {
    const src = join(REPO, "extensions", name);
    const dest = join(extDir, name);
    if (!existsSync(join(src, "package.json"))) {
      console.error(`missing manifest for directory extension: ${src}`);
      process.exit(1);
    }
    copyTree(src, dest);
    console.log(`installed directory extension: ${name}/`);
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

  // 4. Agents, guidance corpus, system prompt (auto-discovered).
  for (const dir of ["agents", "guidance"]) {
    const src = join(REPO, dir);
    if (!existsSync(src)) {
      console.error(`missing source dir: ${src}`);
      process.exit(1);
    }
    copyTree(src, join(PI, dir));
  }
  copyFileSync(join(REPO, "prompt", "APPEND_SYSTEM.md"), join(PI, "APPEND_SYSTEM.md"));
  console.log("installed agents/, guidance/, APPEND_SYSTEM.md");

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
