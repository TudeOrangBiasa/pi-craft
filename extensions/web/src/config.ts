import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { piCraftPath, readSection } from "./pi-craft-settings.js";

// Config lives in the unified pi-craft.json `web` section. The old
// web-search.json path stays as a fallback and migrates once.
// PI_CODING_AGENT_DIR wins when set (tests point it at a temp dir).
export function webConfigDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, "pi");
  return join(homedir(), ".pi");
}

export function webConfigPath(): string {
  return join(webConfigDir(), "web-search.json");
}

/** Strict JSON object parse that throws on bad JSON or a non-object. */
function parseObjectFile(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid config in ${path}: expected a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Parse the unified `web` section, or {} when absent. Throws on bad JSON. */
export function loadWebConfig(): Record<string, unknown> {
  const unified = piCraftPath();
  if (existsSync(unified)) {
    const doc = parseObjectFile(unified);
    const section = doc.web;
    if (section === undefined) return {};
    if (section === null || typeof section !== "object" || Array.isArray(section)) {
      throw new Error(`Invalid config in ${unified}: expected the web section to be a JSON object`);
    }
    return section as Record<string, unknown>;
  }
  const legacyPath = webConfigPath();
  if (existsSync(legacyPath)) {
    const legacy = parseObjectFile(legacyPath);
    // Best-effort one-time migration into the unified file; a failed copy
    // still returns the legacy values for this run and retries next run.
    readSection("web", legacyPath);
    return legacy;
  }
  return {};
}

/** Trimmed non-empty string, else null. */
export function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve a credential: explicit env var first, then the config file value.
 * A config value of "$NAME" or "${NAME}" reads that env var instead.
 * Empty env values are ignored so an exported-but-empty var cannot shadow config.
 */
export function resolveCredential(configKey: string, envName: string): string | null {
  const fromEnv = cleanString(process.env[envName]);
  if (fromEnv) return fromEnv;
  const raw = cleanString(loadWebConfig()[configKey]);
  if (!raw) return null;
  const match = raw.match(/^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/);
  if (!match) return raw;
  return cleanString(process.env[match[1] ?? match[2]]);
}

/** Scrub a credential from text so keys never leak into errors or logs. */
export function redactCredential(text: string, credential: string | null): string {
  return credential ? text.split(credential).join("[redacted]") : text;
}
