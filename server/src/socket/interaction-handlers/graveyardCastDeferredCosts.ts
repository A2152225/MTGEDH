// server/src/socket/interaction-handlers/graveyardCastDeferredCosts.ts
// B44: non-mana additional costs of a graveyard cast that are chosen at pick time but paid only when the
// cast commits (CR 601.2h), so cancelling a later step (targets, mana) never strands a paid cost.
// Covers sacrifice-as-cost (graveyardCastSacrificeAsCost picker) and beam me up (return-to-hand).
// Public entry symbols: validateDeferredGraveyardCastCosts, commitDeferredGraveyardCastCosts.

import { appendEvent } from "../../db/index.js";
import { debugWarn } from "../../utils/debug.js";
import { movePermanentToGraveyard } from "../../state/modules/counters_tokens.js";
import { getEligibleCreaturesForBeamMeUp } from "./interactionGraveyardCastCostAndTimingRules.js";
import { commitBeamMeUpReturnCost } from "./interactionGraveyardCastBeamMeUp.js";

type EmitError = (payload: { code: string; message: string }) => void;
export interface DeferredGraveyardCastCosts {
  game: any; gameId: string; playerId: string; cardId: string; cardName?: string;
  sacrificedPermanentIdsForCost?: string[]; beamedUpPermanentIdsForCost?: string[];
  emitError: EmitError;
}

function ids(list: unknown): string[] {
  return Array.isArray(list) ? list.map((id) => String(id)).filter(Boolean) : [];
}

/** Non-mutating re-check of every deferred pick. Returns false (after emitting) when one is no longer payable. */
export function validateDeferredGraveyardCastCosts(p: DeferredGraveyardCastCosts): boolean {
  const battlefield: any[] = Array.isArray(p.game?.state?.battlefield) ? p.game.state.battlefield : [];
  const sac = ids(p.sacrificedPermanentIdsForCost);
  if (new Set(sac).size !== sac.length) { p.emitError({ code: 'INVALID_SELECTION', message: 'The same permanent was chosen twice for the sacrifice cost.' }); return false; }
  for (const id of sac) {
    const perm = battlefield.find((x: any) => x && String(x.id) === id);
    if (!perm || String(perm.controller || '') !== String(p.playerId)) {
      p.emitError({ code: 'INVALID_SELECTION', message: 'One or more chosen permanents can no longer be sacrificed for this cost' });
      return false;
    }
  }
  const beam = ids(p.beamedUpPermanentIdsForCost);
  if (beam.length > 0) {
    const eligible = new Set(getEligibleCreaturesForBeamMeUp(p.game.state, p.playerId).map((x: any) => String(x.id)));
    if (beam.some((id) => !eligible.has(id) || sac.includes(id))) {
      p.emitError({ code: 'INVALID_SELECTION', message: 'That creature can no longer be beamed up.' });
      return false;
    }
  }
  return true;
}

/** Validate all deferred picks, then pay them: sacrifices first (recorded as sacrificeSelectionResolve), then beam returns. */
export function commitDeferredGraveyardCastCosts(p: DeferredGraveyardCastCosts): boolean {
  if (!validateDeferredGraveyardCastCosts(p)) return false;
  const sac = ids(p.sacrificedPermanentIdsForCost);
  if (sac.length > 0) {
    const game = p.game;
    const ctx: any = {
      state: game.state, libraries: game.libraries, rng: game.rng, gameId: p.gameId,
      bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : (() => {}),
    };
    const done: string[] = [];
    for (const id of sac) { if (movePermanentToGraveyard(ctx, id, true)) done.push(id); }
    if (done.length < sac.length) { p.emitError({ code: 'SACRIFICE_FAILED', message: 'Failed to sacrifice the required permanents' }); return false; }
    try {
      appendEvent(p.gameId, game.seq ?? 0, 'sacrificeSelectionResolve', {
        playerId: String(p.playerId), sourceId: String(p.cardId), sourceName: p.cardName || 'Spell',
        permanentType: 'permanent', permanentIds: done, reason: 'graveyard cast additional cost',
      });
    } catch (err) {
      debugWarn(1, '[graveyardCastDeferredCosts] Failed to persist sacrificeSelectionResolve:', err);
    }
  }
  return commitBeamMeUpReturnCost(p.game, p.gameId, p.playerId, p.beamedUpPermanentIdsForCost, p.emitError);
}
