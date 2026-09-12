import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Plugin-based installer for the craft-harness Pi config.
// Layout: extensions/<name>/ = source of truth for EVERY extension.
// Idempotent: safe to re-run. Never touches anything outside the Pi home
// except reading this repo.

const REPO = join(dirname(new URL(import.meta.url).pathname), "..");
const PI = process.env.PI_CODING_AGENT_DIR?.trim() !== "" && process.env.PI_CODING_AGENT_DIR !== undefined
	? process.env.PI_CODING_AGENT_DIR as string
	: join(homedir(), ".pi", "agent");

// Single-file extensions (managed source: extensions/<name>/<name>.ts).
const SINGLE_FILE = ["omfg.ts", "bash-interceptor.ts", "governor.ts"];

// Extra sibling sources copied next to the entry file when it imports them.
const SIBLING_SOURCES: Record<string, string[]> = {
	"omfg.ts": ["guidance.ts"],
};

// Package extensions deployed to forks/ (settings.json already points there).
// Opt-in packages ship too — dormant until added to settings packages.
const PACKAGES = [
	"tool-repair",
	"hashline",
	"subagents",
	"fff",
	"vision",
	"safety-net",
	"rtk",
	"ask",
	"args",
	"clear",
	"todo",
	"cache-hit",
	"advisor",
	"btw",
	"preview",
	"web",
];

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

function main(): void {
	const extDir = join(PI, "extensions");
	const forksDir = join(PI, "forks");
	mkdirSync(extDir, { recursive: true });
	mkdirSync(forksDir, { recursive: true });

	// 1. Single-file extensions.
	const deployedExts: string[] = [];
	for (const file of SINGLE_FILE) {
		const dir = join(REPO, "extensions", file.replace(/\.ts$/, ""));
		const src = join(dir, file);
		if (!existsSync(src)) {
			console.error(`missing extension source: ${src}`);
			process.exit(1);
		}
		copyFileSync(src, join(extDir, file));
		// Sibling sources the entry file imports (e.g. omfg.ts → guidance.ts).
		for (const extra of SIBLING_SOURCES[file] ?? []) {
			copyFileSync(join(dir, extra), join(extDir, extra));
		}
		deployedExts.push(join(extDir, file));
		console.log(`installed extension: ${file}`);
	}

	// 2. Package extensions + deps.
	for (const name of PACKAGES) {
		const src = join(REPO, "extensions", name);
		if (!existsSync(src)) {
			console.error(`missing package source: ${src}`);
			process.exit(1);
		}
		const dest = join(forksDir, name);
		copyTree(src, dest);
		const hadModules = existsSync(join(dest, "node_modules"));
		if (existsSync(join(dest, "package.json")) && !hadModules) {
			const r = Bun.spawnSync(["bun", "install", "--cwd", dest], { stdout: "ignore", stderr: "inherit" });
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

	// 3. Agents, guidance corpus, system prompt (auto-discovered).
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

	// 4. Merge extensions array (idempotent, preserves user entries + order).
	const settingsPath = join(PI, "settings.json");
	const settings = (existsSync(settingsPath)
		? JSON.parse(readFileSync(settingsPath, "utf-8"))
		: {}) as { extensions?: unknown };
	const current = Array.isArray(settings.extensions)
		? settings.extensions.filter((e): e is string => typeof e === "string")
		: [];
	for (const path of deployedExts) {
		if (!current.includes(path)) current.push(path);
	}
	settings.extensions = current;
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
	console.log(`merged settings.json extensions (Pi home: ${PI})`);
	console.log("done — restart Pi to load.");
}

main();
