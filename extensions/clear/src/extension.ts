import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBtw } from "./btw/index.js";
import registerClear from "./clear.js";

/**
 * Per-instance registration guard. Pi rebuilds the extension runtime on /new,
 * /resume, /fork, and /reload with a brand-new `pi`, which must re-register.
 * Keying on the `pi` instance covers both: same instance skips, new instance
 * runs. The registry lives on globalThis because the loader may re-evaluate
 * this module on every load pass.
 */
const REGISTRY_KEY = "__clearOnce";

function once(pi: object, key: string, fn: () => void): void {
  const g = globalThis as { [REGISTRY_KEY]?: WeakMap<object, Set<string>> };
  g[REGISTRY_KEY] ??= new WeakMap<object, Set<string>>();
  const registry = g[REGISTRY_KEY];
  let loaded = registry.get(pi);
  if (!loaded) {
    loaded = new Set<string>();
    registry.set(pi, loaded);
  }
  if (loaded.has(key)) return;
  loaded.add(key);
  fn();
}

export default function (pi: ExtensionAPI): void {
  once(pi, "clear-commands", () => {
    registerClear(pi);
    registerBtw(pi);
  });
}
