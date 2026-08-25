/**
 * socket/resolution-handlers/targetSelectionBlightKeywordHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the Lorwyn Eclipsed "Blight N" generic hook - the TARGET_SELECTION branch for the
 * select_target / ward_payment / cast_additional_cost / ability_activation_cost stages. Places the
 * -1/-1 counters, then (per stage) releases the pending cast payment prompt or pays the rest of the
 * activation cost and puts the ability on the stack.
 * Public entry symbols: handleBlightKeywordTargetSelection.
 *
 * The branch always returned, so the caller does `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { maybeMarkPowerUpAbilityUsedFromActivationContext } from "../../state/modules/marvelMechanicsHelpers.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import {
  battlefieldAbilityStackReplayEvidence,
  fireBattlefieldAbilityActivatedTriggers,
} from "../resolutionActivatedAbilityTargetingUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import { emitPendingCastPaymentIfNeeded } from "./resolutionPendingCastPaymentPrompt.js";

/** Stages of the Blight keyword this handler owns. */
export const BLIGHT_TARGET_SELECTION_STAGES = ['select_target', 'ward_payment', 'cast_additional_cost', 'ability_activation_cost'];

/** TARGET_SELECTION with `keywordBlight`: apply the -1/-1 counters and continue the paying flow. */
export async function handleBlightKeywordTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];

  const controllerId = String((step as any).keywordBlightController || pid);
  const n = Number((step as any).keywordBlightN || 0);
  const sourceName = String((step as any).keywordBlightSourceName || step.sourceName || 'Blight');
  const stage = String((step as any)?.keywordBlightStage || '');
  const effectId = String((step as any)?.keywordBlightEffectId || '');
  const activationId = String((step as any)?.keywordBlightActivationId || '');
  if (selections.length === 0) {
    // Some templates allow "up to one target". In that case, selecting no target is a valid no-op.
    debug(2, `[Resolution] Blight: no target selected (no-op)`);
    return;
  }

  const targetId = selections[0];

  const targetPerm = (game.state?.battlefield || []).find((p: any) => p && p.id === targetId);
  if (!targetPerm) {
    debugWarn(1, `[Resolution] Blight target not found: ${targetId}`);
    return;
  }

  const safeN = Number.isFinite(n) ? n : 0;
  if (safeN <= 0) return;

  const targetName = targetPerm.card?.name || 'a creature';

  // For activated-ability Blight costs, validate remaining mana BEFORE placing counters.
  // Otherwise, we could place -1/-1 counters and then fail the rest of the activation cost.
  if (stage === 'ability_activation_cost') {
    try {
      if (!activationId) {
        debugWarn(1, `[Resolution] Blight ability_activation_cost: missing activation id`);
        return;
      }
      const pending = (game.state as any)?.pendingBlightAbilityActivations?.[activationId];
      if (!pending) {
        debugWarn(1, `[Resolution] Blight ability_activation_cost: pending activation not found (${activationId})`);
        return;
      }

      const permanentId = String(pending.permanentId || '');
      const requiresTap = Boolean(pending.requiresTap);
      const manaCost = String(pending.manaCost || '');

      const remainingNonManaCostText = manaCost
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bblight\s+\w+\b/gi, ' ')
        .replace(/[\s,]+/g, ' ')
        .trim();
      if (remainingNonManaCostText.length > 0) {
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'UNSUPPORTED_COST',
          message: `Unsupported activation cost after Blight payment (${remainingNonManaCostText}).`,
        });
        return;
      }

      const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const perm = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
      if (!perm) {
        emitToPlayer(io, controllerId as any, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
        return;
      }
      if (String(perm.controller || '') !== controllerId) {
        emitToPlayer(io, controllerId as any, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
        return;
      }
      if (requiresTap && (perm as any).tapped) {
        emitToPlayer(io, controllerId as any, 'error', { code: 'ALREADY_TAPPED', message: 'Permanent is already tapped' });
        return;
      }

      const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
      const manaOnly = manaSymbols
        .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
        .join('');

      if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'UNSUPPORTED_COST',
          message: `Unsupported activation cost after Blight payment (${manaOnly || 'complex cost'})`,
        });
        return;
      }

      if (manaOnly) {
        const { getOrInitManaPool, resolveManaCostForPoolPayment, calculateTotalAvailableMana, validateManaPayment } = await import('../util.js');
        const pool = getOrInitManaPool(game.state, controllerId) as any;
        const resolved = resolveManaCostForPoolPayment(pool, manaOnly);
        if (!resolved.ok) {
          emitToPlayer(io, controllerId as any, 'error', { code: 'INSUFFICIENT_MANA', message: (resolved as any).error || 'Insufficient mana.' });
          return;
        }
        const totalAvailable = calculateTotalAvailableMana(pool, undefined);
        const validationError = validateManaPayment(totalAvailable, resolved.coloredCost, resolved.genericCost);
        if (validationError) {
          emitToPlayer(io, controllerId as any, 'error', { code: 'INSUFFICIENT_MANA', message: validationError });
          return;
        }
      }
    } catch (e) {
      debugWarn(1, `[Resolution] Blight ability_activation_cost: pre-validation failed`, e);
      emitToPlayer(io, controllerId as any, 'error', { code: 'CANNOT_PAY_COST', message: 'Unable to validate activation cost; please try again.' });
      return;
    }
  }

  try {
    const { updateCounters } = await import('../../state/modules/counters_tokens.js');
    const ctx = {
      state: game.state,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      zones: game.state?.zones,
      gameId,
    } as any;

    updateCounters(ctx, targetId, { '-1/-1': safeN });
  } catch (err) {
    // Defensive fallback: apply counter directly if the counters module can't be loaded.
    debugWarn(1, `[Resolution] Blight: updateCounters failed, falling back to direct counter mutation`, err);
    targetPerm.counters = targetPerm.counters || {};
    targetPerm.counters['-1/-1'] = (targetPerm.counters['-1/-1'] || 0) + safeN;
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName}: ${getPlayerName(game, controllerId as any)} put ${safeN} -1/-1 counter${safeN === 1 ? '' : 's'} on ${targetName}.`,
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);

  if (stage === 'cast_additional_cost') {
    if (effectId && (game.state as any)?.pendingSpellCasts?.[effectId]) {
      (game.state as any).pendingSpellCasts[effectId].additionalCostPaid = true;
      (game.state as any).pendingSpellCasts[effectId].additionalCostMethod = 'blight';
    }
    emitPendingCastPaymentIfNeeded(game, gameId, effectId, controllerId);
  }

  if (stage === 'ability_activation_cost') {
    try {
      if (!activationId) {
        debugWarn(1, `[Resolution] Blight ability_activation_cost: missing activation id`);
        return;
      }

      const pending = (game.state as any)?.pendingBlightAbilityActivations?.[activationId];
      if (!pending) {
        debugWarn(1, `[Resolution] Blight ability_activation_cost: pending activation not found (${activationId})`);
        return;
      }

      // Clear pending state before proceeding (prevents double-activation on retries).
      delete (game.state as any).pendingBlightAbilityActivations[activationId];

      const permanentId = String(pending.permanentId || '');
      const abilityId = String(pending.abilityId || '');
      const abilityText = String(pending.abilityText || '');
      const cardName = String(pending.cardName || pending.sourceName || 'Ability');
      const requiresTap = Boolean(pending.requiresTap);
      const manaCost = String(pending.manaCost || '');
      const activatedAbilityText = String(pending.activatedAbilityText || '').trim();

      // Defensive: we only support resuming activations whose costs are strictly
      // (mana symbols and/or {T}/{Q}) plus the already-paid "Blight N".
      // If other non-mana text remains, refuse to proceed rather than granting a free cost.
      const remainingNonManaCostText = manaCost
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bblight\s+\w+\b/gi, ' ')
        .replace(/[\s,]+/g, ' ')
        .trim();
      if (remainingNonManaCostText.length > 0) {
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'UNSUPPORTED_COST',
          message: `Unsupported activation cost after Blight payment (${remainingNonManaCostText}).`,
        });
        return;
      }

      const battlefield = game.state?.battlefield || [];
      const perm = battlefield.find((p: any) => p && p.id === permanentId);
      if (!perm) {
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'PERMANENT_NOT_FOUND',
          message: 'Permanent no longer on battlefield',
        });
        return;
      }

      if (String(perm.controller || '') !== controllerId) {
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'NOT_CONTROLLER',
          message: 'You no longer control that permanent',
        });
        return;
      }

      if (requiresTap && (perm as any).tapped) {
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'ALREADY_TAPPED',
          message: `${cardName} is already tapped`,
        });
        return;
      }

      // Pay mana portion of the activation cost (conservative: no Phyrexian and no X).
      const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
      const manaOnly = manaSymbols
        .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
        .join('');

      if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
        emitToPlayer(io, controllerId as any, 'error', {
          code: 'UNSUPPORTED_COST',
          message: `Unsupported activation cost after Blight payment (${manaOnly || 'complex cost'})`,
        });
        return;
      }

      if (manaOnly) {
        const { payAbilityManaCostFromPool } = await import('../util.js');
        const paid = payAbilityManaCostFromPool(game.state, controllerId, manaOnly, perm, '[blightAbilityAsCost]');
        if (!paid.ok) {
          emitToPlayer(io, controllerId as any, 'error', {
            code: 'INSUFFICIENT_MANA',
            message: (paid as any).error || 'Insufficient mana.',
          });
          return;
        }
      }

      const tappedPermanentsForCost: string[] = [];
      // Tap as part of cost.
      if (requiresTap && !(perm as any).tapped) {
        (perm as any).tapped = true;
        tappedPermanentsForCost.push(String(permanentId));
      }

      // Put the ability on the stack.
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: controllerId,
        source: permanentId,
        sourceName: cardName,
        description: abilityText,
      } as any;

      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      maybeMarkPowerUpAbilityUsedFromActivationContext(game, controllerId, permanentId, {
        activatedAbilityText: activatedAbilityText || `${manaCost}: ${abilityText}`,
        abilityId,
      });
      fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
        // Persist deterministic evidence so replay applies the Blight counters and tap.
        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
            ...battlefieldAbilityStackReplayEvidence(stackItem.id),
            playerId: controllerId,
            permanentId,
            abilityId: abilityId || undefined,
            cardName,
            abilityText,
            activatedAbilityText: activatedAbilityText || undefined,
            tappedPermanents: tappedPermanentsForCost,
            blightTargetPermanentIdForCost: String(targetId || ''),
            blightNForCost: safeN,
          });
        } catch {
          // ignore persistence failures
        }
      });

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, controllerId as any)} activated ${cardName}'s ability: ${abilityText}`,
        ts: Date.now(),
      });

      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
    } catch (err) {
      debugError(1, `[Resolution] Failed to resume blight-cost activation`, err);
    }
  }
}
