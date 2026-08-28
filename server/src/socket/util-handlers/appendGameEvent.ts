// server/src/socket/util-handlers/appendGameEvent.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: appendGameEvent and persistAndResolveTopOfStack.
// Public entry symbols: appendGameEvent, persistAndResolveTopOfStack.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { InMemoryGame } from "../../state/types.js";
import { appendEvent } from "../../db/index.js";
import { isGameRestoring } from "../../gameRestoreState.js";
import { contextHasBlockingNonPaymentResolutionSteps } from "../../state/resolution/resolutionQueueGameIds.js";
import { debugWarn } from "../../utils/debug.js";

/**
 * Appends a game event (both in-memory and persisted to the DB).
 * This attempts to call game.applyEvent and then persists via appendEvent.
 */
export function appendGameEvent(
  game: InMemoryGame,
  gameId: string,
  type: string,
  payload: Record<string, any> = {}
) {
  // Do not apply+persist while event-log replay is rebuilding state (restart/undo).
  // Concurrent auto-pass / AI during replayAsync yields would duplicate actions and
  // stamp regressive turn/phase metadata onto the tail of the log.
  if ((game as any)?.isReplaying || isGameRestoring(gameId)) {
    return;
  }

  try {
    if (typeof (game as any).applyEvent === "function") {
      (game as any).applyEvent({ type, ...payload });
    } else if (typeof (game as any).apply === "function") {
      (game as any).apply(type, payload);
    } else {
      if ((game as any).state && typeof (game as any).state === "object") {
        // no-op; rely on persisted events for reconstruction
      }
    }
  } catch (err) {
    debugWarn(1, "appendGameEvent: in-memory apply failed:", err);
  }

  try {
    appendEvent(gameId, (game as any).seq, type, payload);
  } catch (err) {
    debugWarn(1, "appendGameEvent: DB appendEvent failed:", err);
  }
}

/**
 * Persist-first stack resolve: write `resolveTopOfStack` to the event log *before*
 * applying the resolve, so as-enters prompts / ETB `pushTriggeredAbility` events
 * appended during live resolve appear *after* it. Replay needs that order to put
 * permanent spells onto the battlefield while they are still on top of the stack.
 *
 * Do not call `game.resolveTopOfStack()` or `appendGameEvent(resolveTopOfStack)`
 * around this — this helper owns both the DB row and the in-memory apply.
 */
export function persistAndResolveTopOfStack(
  game: InMemoryGame,
  gameId: string,
  payload: Record<string, unknown> = {},
): boolean {
  if (
    typeof (game as any).resolveTopOfStack !== "function"
    && typeof (game as any).applyEvent !== "function"
  ) {
    return false;
  }

  if ((game as any)?.isReplaying || isGameRestoring(gameId)) {
    return false;
  }

  if (contextHasBlockingNonPaymentResolutionSteps(game, gameId)) {
    debugWarn(
      2,
      '[persistAndResolveTopOfStack] Refusing to resolve stack — blocking non-payment resolution prompt still open',
    );
    return false;
  }

  // DB first — side effects during apply append after this row.
  try {
    appendEvent(gameId, (game as any).seq ?? 0, "resolveTopOfStack", payload);
  } catch (err) {
    debugWarn(1, "persistAndResolveTopOfStack: DB appendEvent failed:", err);
  }

  try {
    if (typeof (game as any).applyEvent === "function") {
      (game as any).applyEvent({ type: "resolveTopOfStack", ...payload });
    } else if (typeof (game as any).resolveTopOfStack === "function") {
      (game as any).resolveTopOfStack();
    }
  } catch (err) {
    debugWarn(1, "persistAndResolveTopOfStack: in-memory apply failed:", err);
    return false;
  }

  return true;
}
