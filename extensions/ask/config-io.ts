/**
 * config-io — inlined replacement for the original shared config helper,
 * trimmed to what this extension actually uses: XDG-aware config load with a
 * legacy fallback, plus the GuidanceFields validation.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Expand a leading `~` to the user's home directory. */
function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

/** Default config directory: `~/.config`. */
function defaultConfigDir(): string {
	return join(homedir(), ".config");
}

/** Read an environment variable, trimmed; empty → undefined. */
function readEnvVar(key: string): string | undefined {
	const v = process.env[key];
	return v && v.trim() ? v.trim() : undefined;
}

/** Resolve the config directory honoring `XDG_CONFIG_HOME`. */
function resolveConfigDir(): string {
	const xdg = readEnvVar("XDG_CONFIG_HOME");
	if (!xdg) return defaultConfigDir();
	const expanded = expandTilde(xdg);
	return isAbsolute(expanded) ? expanded : defaultConfigDir();
}

/** Always-legacy config path under `~/.config`. Ignores `XDG_CONFIG_HOME` by design. */
function legacyConfigPath(name: string, file: string = "config.json"): string {
	return join(defaultConfigDir(), name, file);
}

/** Resolve a config file path under the XDG-aware config directory. */
export function configPath(name: string, file: string = "config.json"): string {
	return join(resolveConfigDir(), name, file);
}

/** Load and parse a JSON config file; returns `{}` on missing/invalid. */
export function loadJsonConfig<T>(path: string): T {
	if (!existsSync(path)) return {} as T;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
		return parsed as T;
	} catch (err) {
		console.warn(`pi-ask-user-question: invalid JSON at ${path}, using default ({}) — ${(err as Error).message}`);
		return {} as T;
	}
}

/** Load a JSON config, preferring the XDG-resolved path, falling back to the legacy path. */
export function loadJsonConfigWithLegacyFallback<T>(name: string, file: string = "config.json"): T {
	const xdgPath = configPath(name, file);
	if (existsSync(xdgPath)) {
		return loadJsonConfig<T>(xdgPath);
	}
	return loadJsonConfig<T>(legacyConfigPath(name, file));
}

export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
	description?: string;
}

/** Validate and extract guidance fields from an unknown value. */
export function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (!fields || typeof fields !== "object") return {};
	const g = fields as Record<string, unknown>;
	const result: GuidanceFields = {};
	if (typeof g.promptSnippet === "string" && g.promptSnippet.length > 0) {
		result.promptSnippet = g.promptSnippet;
	}
	if (
		Array.isArray(g.promptGuidelines) &&
		g.promptGuidelines.length > 0 &&
		g.promptGuidelines.every((s) => typeof s === "string" && s.length > 0)
	) {
		result.promptGuidelines = g.promptGuidelines;
	}
	if (typeof g.description === "string" && g.description.length > 0) {
		result.description = g.description;
	}
	return result;
}
