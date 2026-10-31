import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type CacheLane,
  type CachePrediction,
  makeCacheLane,
  normalizeLanePart,
  predictCacheHit,
  recordAssistantUsage,
  sanitizeNullableTokens,
  scanCacheHistory,
  UNKNOWN_THINKING_LEVEL,
} from "./src/predictor.js";

interface ModelIdentity {
  provider: string;
  api: string;
  id: string;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return Math.round(tokens).toString();
  if (tokens < 1_000_000) {
    return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  }
  return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)}m`;
}

function predictionText(prediction: CachePrediction): string {
  const lane = `${prediction.lane.model} · ${prediction.lane.thinkingLevel}`;
  if (!prediction.hasLaneHistory) {
    const prompt = prediction.currentPromptTokens
      ? ` of ~${formatTokens(prediction.currentPromptTokens)}`
      : "";
    return `Cache hit prediction · ${lane}: cold lane (0%${prompt})`;
  }

  if (prediction.currentPromptTokens === null || prediction.percent === null) {
    return `Cache hit prediction · ${lane}: ~${formatTokens(prediction.estimatedCacheTokens)} cached`;
  }
  return `Cache hit prediction · ${lane}: ~${formatTokens(prediction.estimatedCacheTokens)} / ~${formatTokens(prediction.currentPromptTokens)} (${Math.round(prediction.percent)}%) cached`;
}

/**
 * Lane for a model identity, or null when the identity cannot name a lane.
 * A null lane means "stay silent": no prediction, no history write.
 */
function laneFor(model: ModelIdentity, thinkingLevel: string): CacheLane | null {
  try {
    return makeCacheLane(model?.provider, model?.api, model?.id, thinkingLevel);
  } catch {
    return null;
  }
}

function currentLevel(pi: ExtensionAPI): string {
  return normalizeLanePart(pi.getThinkingLevel()) ?? UNKNOWN_THINKING_LEVEL;
}

export default function (pi: ExtensionAPI) {
  let history = scanCacheHistory([]);
  let pendingPredictionTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelPending = () => {
    clearTimeout(pendingPredictionTimer);
    pendingPredictionTimer = undefined;
  };

  const rebuild = (ctx: ExtensionContext) => {
    // A queued prediction targets the pre-rebuild session, so drop it.
    cancelPending();
    try {
      history = scanCacheHistory(ctx.sessionManager.getBranch(), currentLevel(pi));
    } catch {
      // Stale ctx proxy (session_compact racing runner disposal).
      // A history refresh never raises; restart from empty instead.
      history = scanCacheHistory([]);
    }
  };

  const appendPrediction = (ctx: ExtensionContext, model: ModelIdentity, thinkingLevel: string) => {
    if (ctx.mode !== "tui") return;
    const lane = laneFor(model, thinkingLevel);
    if (lane === null) return;
    const contextTokens = sanitizeNullableTokens(ctx.getContextUsage()?.tokens);
    const prediction = predictCacheHit(history, lane, contextTokens);
    ctx.ui.notify(predictionText(prediction), "info");
  };

  const schedulePrediction = (
    ctx: ExtensionContext,
    model: ModelIdentity,
    thinkingLevel: string,
  ) => {
    if (laneFor(model, thinkingLevel) === null) {
      cancelPending();
      return;
    }
    cancelPending();
    pendingPredictionTimer = setTimeout(() => {
      pendingPredictionTimer = undefined;
      try {
        appendPrediction(ctx, model, thinkingLevel);
      } catch {
        // Stale or disposed ctx by fire time. A prediction is advisory,
        // never worth an uncaught timer exception.
      }
    }, 0);
  };

  pi.on("session_start", async (_event, ctx) => rebuild(ctx));
  pi.on("session_tree", async (_event, ctx) => rebuild(ctx));
  pi.on("session_compact", async (_event, ctx) => rebuild(ctx));

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const selected = ctx.model;
    const lane =
      selected?.provider === event.message.provider &&
      selected.id === event.message.model &&
      selected.api === event.message.api
        ? laneFor(selected, currentLevel(pi))
        : laneFor(
            {
              provider: event.message.provider,
              api: event.message.api,
              id: event.message.model,
            },
            currentLevel(pi),
          );
    if (lane === null) return;
    try {
      recordAssistantUsage(history, event.message, lane);
    } catch {
      // Hardened recorder throws only on a broken lane, which laneFor
      // already filtered. Stay silent rather than fail the turn.
    }
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    const level = normalizeLanePart(event.level) ?? UNKNOWN_THINKING_LEVEL;
    const previous = normalizeLanePart(event.previousLevel) ?? UNKNOWN_THINKING_LEVEL;
    if (level === previous || !ctx.model) return;
    schedulePrediction(ctx, ctx.model, level);
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.source === "restore" || !event.previousModel) {
      cancelPending();
      return;
    }
    schedulePrediction(ctx, event.model, currentLevel(pi));
  });

  pi.on("session_shutdown", async () => {
    cancelPending();
  });
}
