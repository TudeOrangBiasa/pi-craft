/**
 * config-io — guidance field validation for the todo tool.
 * File loading moved to pi-craft-settings (unified pi-craft.json sections).
 */

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
