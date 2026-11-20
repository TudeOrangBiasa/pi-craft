// Overlay module loader: jiti replays the same cached namespace on retry,
// so a poisoned load can never heal. Latch it and ask for a restart.
export type TodoOverlayModule = typeof import("../todo-overlay.js");
export type TodoOverlayImporter = () => Promise<TodoOverlayModule>;

/** Marker shared by the loader's poisoned-namespace error and its predicate. */
const STALE_OVERLAY_MESSAGE = "Todo overlay module cache is stale; restart Pi";

/** True for the loader's latched poisoned-namespace error. */
export function isStaleOverlayModuleError(e: unknown): boolean {
  return String(e).includes(STALE_OVERLAY_MESSAGE);
}

export function makeTodoOverlayLoader(
  importOverlay: TodoOverlayImporter = () => import("../todo-overlay.js"),
): TodoOverlayImporter {
  let memo: Promise<TodoOverlayModule> | undefined;

  return async (): Promise<TodoOverlayModule> => {
    memo ??= importOverlay();
    const current = memo;
    let mod: TodoOverlayModule;
    try {
      mod = await current;
    } catch (error) {
      // Clear only OUR rejected promise: a late catch from a concurrent
      // awaiter must never clobber a fresh retry another caller installed.
      if (memo === current) memo = undefined;
      throw error;
    }
    if (typeof mod.TodoOverlay !== "function") {
      // Deliberately latched (see header): retry replays the cached namespace.
      const keys = JSON.stringify(Object.keys(mod));
      throw new Error(`${STALE_OVERLAY_MESSAGE} (resolved namespace keys: ${keys})`);
    }
    return mod;
  };
}
