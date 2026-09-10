/**
 * config-io — inlined replacement for the original shared config helper.
 *
 * The advisor only ever used a handful of its helpers; reimplemented here as
 * native, stateless functions so the fork carries no external config dependency.
 * `validateGuidanceFields` is the original runtime check (no TypeBox needed).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_FILE_MODE = 0o600;

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) {
    if (xdg.startsWith("/")) return xdg;
    if (xdg === "~" || xdg.startsWith("~/")) return join(homedir(), xdg.slice(xdg === "~" ? 0 : 1));
  }
  return join(homedir(), ".config");
}

export const ADVISOR_CONFIG_PATH = join(configDir(), "pi-advisor", "advisor.json");

export interface GuidanceFields {
  promptSnippet?: string;
  promptGuidelines?: string[];
  description?: string;
}

/** Read + parse a JSON config. Returns {} for a missing, malformed, or non-object file. */
export function loadJsonConfig<T>(path: string): T {
  if (!existsSync(path)) return {} as T;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
    return parsed as T;
  } catch (err) {
    console.warn(`pi-advisor: invalid JSON at ${path}, using default ({}) — ${(err as Error).message}`);
    return {} as T;
  }
}

/** Persist `data` as formatted JSON. Returns false on a filesystem failure. */
export function saveJsonConfig(path: string, data: unknown): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  } catch {
    return false;
  }
  try {
    chmodSync(path, CONFIG_FILE_MODE);
  } catch {
    // best-effort perms across filesystems that ignore chmod
  }
  return true;
}

/** Validate + extract guidance fields from an unknown value; drops invalid entries. */
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

/** Parse a model key: tolerant of slash (canonical) or colon (legacy) separators. */
export function parseModelKey(key: string): { provider: string; modelId: string } | undefined {
  const slashIdx = key.indexOf("/");
  if (slashIdx >= 1) return { provider: key.slice(0, slashIdx), modelId: key.slice(slashIdx + 1) };
  const colonIdx = key.indexOf(":");
  if (colonIdx >= 1) return { provider: key.slice(0, colonIdx), modelId: key.slice(colonIdx + 1) };
  return undefined;
}

/** Compose the canonical "provider/modelId" string. */
export function modelKey(m: { provider: string; id: string }): string {
  return `${m.provider}/${m.id}`;
}
