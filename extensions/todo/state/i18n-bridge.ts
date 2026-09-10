/**
 * i18n bridge for pi-todo — single thin import surface so every call site
 * routes through one module. This fork bundles no external i18n SDK, so
 * `t(key, fallback)` is an identity passthrough returning the inline English
 * fallback at every call site.
 *
 * - `t(key, fallback)` returns `fallback` (identity passthrough). Strings in
 *   this fork are English-only by design; no locale switching is wired up.
 * - `formatStatusLabel(status)` resolves a TaskStatus to its English label.
 *   This is the SINGLE point of localization for status words — overlay,
 *   /todos header, /todos render-call all route through here.
 *
 * No registration step is needed: `t` is a static passthrough. Call sites
 * MUST use this module at render time — never bake the result into a top-level
 * `const X = formatStatusLabel(...)`.
 */

import type { TaskStatus } from "../tool/types.js";

type ScopeFn = (key: string, fallback: string) => string;

// No i18n SDK bundled in this fork: `t` is a static passthrough that returns
// the inline English fallback at every call site.
const scopeImpl: ScopeFn = (_key, fallback) => fallback;

export const t: ScopeFn = scopeImpl;

const STATUS_LABEL_PENDING = "pending";
const STATUS_LABEL_IN_PROGRESS = "in progress";
const STATUS_LABEL_COMPLETED = "completed";
const STATUS_LABEL_DELETED = "deleted";

export function formatStatusLabel(status: TaskStatus): string {
	switch (status) {
		case "pending":
			return t("status.pending", STATUS_LABEL_PENDING);
		case "in_progress":
			return t("status.in_progress", STATUS_LABEL_IN_PROGRESS);
		case "completed":
			return t("status.completed", STATUS_LABEL_COMPLETED);
		case "deleted":
			return t("status.deleted", STATUS_LABEL_DELETED);
	}
}
