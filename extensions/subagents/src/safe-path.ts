/**
 * safe-path.ts — Shared path-safety guards: name whitelist, symlink rejection,
 * symlink-rejecting file reads.
 *
 * Used by the skill loader (and anywhere else that reads user-addressable
 * files). Split out of the removed persistent-memory module (#6), which was
 * the only other consumer of these helpers.
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";

/**
 * Returns true if a name contains characters not allowed in agent/skill names.
 * Uses a whitelist: only alphanumeric, hyphens, underscores, and dots (no leading dot).
 */
export function isUnsafeName(name: string): boolean {
	if (!name || name.length > 128) return true;
	return !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
}

/**
 * Returns true if the given path is a symlink (defense against symlink attacks).
 */
export function isSymlink(filePath: string): boolean {
	try {
		return lstatSync(filePath).isSymbolicLink();
	} catch {
		return false;
	}
}

/**
 * Safely read a file, rejecting symlinks.
 * Returns undefined if the file doesn't exist, is a symlink, or can't be read.
 */
export function safeReadFile(filePath: string): string | undefined {
	if (!existsSync(filePath)) return undefined;
	if (isSymlink(filePath)) return undefined;
	try {
		return readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
}
