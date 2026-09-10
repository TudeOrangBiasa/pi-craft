/**
 * i18n bridge for pi-ask-user-question — single thin import surface so every
 * call site routes through one place.
 *
 * This fork ships without the optional localization SDK, so `t(key, fallback)`
 * is an identity passthrough that returns the inline English fallback at every
 * call site. The extension stays fully online with an English UI.
 */

import { ROW_INTENT_META, type SentinelKind } from "./row-intent.js";

type ScopeFn = (key: string, fallback: string) => string;

const scopeImpl: ScopeFn = (_key, fallback) => fallback;

export const t: ScopeFn = scopeImpl;

export function displayLabel(kind: SentinelKind): string {
	return t(`sentinel.${kind}`, ROW_INTENT_META[kind].label);
}
