/**
 * socket/resolution-handlers/optionChoiceBoardActionPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the two `step.action` keyed OPTION_CHOICE branches that close the function -
 * `tap_or_untap_decision` (tap or untap the named permanent, queueing the becomes-tapped /
 * becomes-untapped triggers and persisting the matching permanent_tapped / permanent_untapped
 * event) and `mox_diamond_choice` (pull Mox Diamond off the stack, then either discard the chosen
 * land and put it onto the battlefield, or send the Mox itself to the graveyard).
 * Public entry symbols: handleTapOrUntapDecision, handleMoxDiamondStackChoice.
 *
 * Both branches always returned, so each call site is `await handler(...); return;`. The
 * land-entry `moxDiamondChoice` prompt (a different, step-flag keyed path) lives in
 * `optionChoiceLandEntryReplacementHandlers.ts`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";
import { queueTapTriggersForTappedPermanents } from "../../state/modules/tap-trigger-queue.js";
import { queueBecomesUntappedTriggers } from "../../state/modules/triggers/tap-untap.js";
import {
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { broadcastGame } from "../util.js";

/** "You may tap or untap target permanent." */
export async function handleTapOrUntapDecision(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const selectedOption = response.selections;

  const targetId = stepData.targetId;
  if (!targetId) return;
  const battlefield = game.state?.battlefield || [];
  const perm = battlefield.find((p: any) => p.id === targetId);
  if (!perm) return;
  const choice = Array.isArray(selectedOption) ? selectedOption[0] : selectedOption;
  let changed = false;
  if (choice === 'tap') {
    if (!(perm as any).tapped) {
      (perm as any).tapped = true;
      changed = true;
      queueTapTriggersForTappedPermanents(io, game, gameId, [String(targetId)], String((perm as any)?.controller || step.playerId || ''));
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'permanent_tapped', {
          playerId: String(step.playerId || ''),
          resolvedStepId: String((step as any).id || ''),
          permanentIds: [String(targetId)],
          source: String(step.sourceName || ''),
          ts: Date.now(),
        });
      } catch (e) {
        debugWarn(1, '[Resolution] appendEvent(permanent_tapped) failed:', e);
      }
    }
    debug(2, `[Resolution] Tap/Untap: tapped ${perm.card?.name || perm.id}`);
  } else if (choice === 'untap') {
    if ((perm as any).tapped) {
      (perm as any).tapped = false;
      changed = true;
      queueBecomesUntappedTriggers(game as any, perm);
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'permanent_untapped', {
          playerId: String(step.playerId || ''),
          resolvedStepId: String((step as any).id || ''),
          permanentIds: [String(targetId)],
          source: String(step.sourceName || ''),
          ts: Date.now(),
        });
      } catch (e) {
        debugWarn(1, '[Resolution] appendEvent(permanent_untapped) failed:', e);
      }
    }
    debug(2, `[Resolution] Tap/Untap: untapped ${perm.card?.name || perm.id}`);
  }
  if (changed && typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

/** Mox Diamond resolving off the stack: discard a land to keep it, or let it hit the graveyard. */
export async function handleMoxDiamondStackChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const selectedOption = response.selections;

  const selection = Array.isArray(selectedOption) ? selectedOption[0] : selectedOption;
  const state = game.state || {};
  state.stack = state.stack || [];
  const stackIndex = state.stack.findIndex((s: any) => s.id === step.sourceId);
  if (stackIndex === -1) return;
  const stackItem = state.stack[stackIndex];
  const controller = stackItem.controller as PlayerID;
  const zones = state.zones = state.zones || {};
  zones[controller] = zones[controller] || { hand: [], graveyard: [], graveyardCount: 0 } as any;
  const playerZones = zones[controller] as any;
  playerZones.hand = playerZones.hand || [];
  playerZones.graveyard = playerZones.graveyard || [];
  const moxChoiceCtx = {
    state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as any;

  // Remove Mox from stack
  state.stack.splice(stackIndex, 1);

  if (selection && selection !== 'DECLINE') {
    const hand = playerZones.hand;
    const landIdx = hand.findIndex((c: any) => c?.id === selection);
    if (landIdx !== -1) {
      const landCard = hand.splice(landIdx, 1)[0];
      playerZones.handCount = hand.length;
      pushCardToPlayerGraveyardWithReplacements(moxChoiceCtx, String(controller), landCard, playerZones.graveyard);
      playerZones.graveyardCount = playerZones.graveyard.length;

      // Put Mox Diamond onto battlefield
      state.battlefield = state.battlefield || [];
      state.battlefield.push({
        id: stackItem.id,
        card: stackItem.card,
        controller,
        tapped: false,
      });
      debug(2, `[Resolution] Mox Diamond: discarded ${landCard.name}, put onto battlefield`);
    } else {
      // If land missing, fall back to graveyard
      pushCardToPlayerGraveyardWithReplacements(moxChoiceCtx, String(controller), stackItem.card || {}, playerZones.graveyard);
      playerZones.graveyardCount = playerZones.graveyard.length;
      debugWarn(2, `[Resolution] Mox Diamond: selected land not found, card to graveyard`);
    }
  } else {
    // Decline: put Mox Diamond into graveyard
    pushCardToPlayerGraveyardWithReplacements(moxChoiceCtx, String(controller), stackItem.card || {}, playerZones.graveyard);
    playerZones.graveyardCount = playerZones.graveyard.length;
    debug(2, `[Resolution] Mox Diamond: declined discard, card to graveyard`);
  }

  broadcastGame(io, game, gameId);
}
