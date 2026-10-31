// Unified pi-craft settings: one JSON file, one section per extension.
//
// File: `<agentDir>/pi-craft.json` (`~/.pi/agent/pi-craft.json`, honoring
// `PI_CODING_AGENT_DIR` like every other Pi path). Sections use the extension
// dir name: ask, todo, web, subagents, vision, goal, hashline, tool-repair,
// omfg, fff.
//
// Migration: when the unified file (or a section) is missing but the
// extension's old file exists, the old file wins for that read and its
// section is copied into the unified file once. Old files are never
// modified or deleted, so a user config keeps working even if the copy
// fails. Once a section exists in the unified file, the old file is
// ignored for that section.
//
// vendored copies: this module is dependency-free (node stdlib only) by
// design. Each package extension vendors a copy under its own tree because
// Pi loads forks/ packages in isolation; there is no shared import path.
// Keep copies in sync by hand (see the header note in each copy).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

/** File name of the unified settings under the Pi agent dir. */
export const PI_CRAFT_FILENAME = "pi-craft.json";

/** Resolve the Pi agent dir (same rule as Pi's getAgentDir). */
export function piCraftAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  if (override !== undefined && override !== "") {
    if (override === "~") return homedir();
    if (override.startsWith("~/")) return join(homedir(), override.slice(2));
    return override;
  }
  return join(homedir(), ".pi", "agent");
}

/** Full path of the unified settings file. */
export function piCraftPath(): string {
  return join(piCraftAgentDir(), PI_CRAFT_FILENAME);
}

/** Resolve the XDG-aware config dir (same rule as the ask/todo loaders). */
export function piCraftXdgDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const trimmed = xdg === undefined ? "" : xdg.trim();
  if (trimmed === "") return join(homedir(), ".config");
  const expanded =
    trimmed === "~"
      ? homedir()
      : trimmed.startsWith("~/")
        ? join(homedir(), trimmed.slice(2))
        : trimmed;
  return isAbsolute(expanded) ? expanded : join(homedir(), ".config");
}

/** Parse a JSON object file; missing file, bad JSON, or a non-object yields {}. */
export function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sectionOf(doc: Record<string, unknown>, section: string): Record<string, unknown> {
  const value = doc[section];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * Read one extension's section from the unified file, migrating from its
 * old file on first use. Returns {} when neither has the section.
 *
 * The old path is a fallback, not a merge: a unified section wins whole,
 * an absent unified section falls back to the whole old file. Migration
 * copies the old file's object into the unified section and persists the
 * unified file, so the fallback runs at most once per section.
 */
export function readSection(section: string, legacyPath: string): Record<string, unknown> {
  const unified = piCraftPath();
  const doc = readJsonObject(unified);
  const fromUnified = sectionOf(doc, section);
  if (Object.keys(fromUnified).length > 0) return fromUnified;
  const fromLegacy = readJsonObject(legacyPath);
  if (Object.keys(fromLegacy).length === 0) return {};
  doc[section] = fromLegacy;
  try {
    mkdirSync(dirname(unified), { recursive: true });
    writeFileSync(unified, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
  } catch {
    // Migration is best-effort: the legacy read still applies this run,
    // and the next run retries the copy.
  }
  return fromLegacy;
}

/**
 * Read one extension's section from the unified file only. No legacy
 * fallback, no migration. Use for sections with no old file (goal).
 */
export function readUnifiedSection(section: string): Record<string, unknown> {
  return sectionOf(readJsonObject(piCraftPath()), section);
}

/**
 * Read one extension's section, trying several old files in order. The
 * first non-empty source wins and migrates into the unified file once.
 * Use for extensions with an XDG path plus a legacy path (ask, todo).
 */
export function readSectionWithFallbacks(
  section: string,
  legacyPaths: string[],
): Record<string, unknown> {
  for (const legacyPath of legacyPaths) {
    const found = readSection(section, legacyPath);
    if (Object.keys(found).length > 0) return found;
  }
  return {};
}

/**
 * Persist one extension's section into the unified file, keeping sibling
 * sections untouched. Returns the unified path written.
 */
export function writeSection(section: string, value: Record<string, unknown>): string {
  const unified = piCraftPath();
  const doc = readJsonObject(unified);
  doc[section] = value;
  mkdirSync(dirname(unified), { recursive: true });
  writeFileSync(unified, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
  return unified;
}
