/**
 * socket/resolution-handlers/manaColorSelectionResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: MANA_COLOR_SELECTION case body (any-color / distribution mana abilities,
 * deferred activation-cost evidence, Forbidden Orchard follow-up).
 * Public entry symbols: handleManaColorSelectionResponse.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  createResolutionStep,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debugWarn } from "../../utils/debug.js";
import { finalizeBattlefieldAbilitySelfExertCost } from "../resolutionGraveyardSelectionHelperUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

/** MANA_COLOR_SELECTION: add the chosen mana, apply deferred activation costs, persist replay evidence. */
export async function handleManaColorSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const stepData = step as any;
  const selectionKind = String(stepData.selectionKind || 'any_color');
  const permanentId = String(stepData.permanentId || step.sourceId || '');
  const cardName = String(stepData.cardName || step.sourceName || '');
  const abilityId = stepData.abilityId;
  const removedCountersForCost: Array<{ permanentId: string; counterType: string; count: number }> = [];
  const requiresSelfExertForCost = stepData.requiresSelfExertForCost === true;

  const { getOrInitManaPool, broadcastManaPoolUpdate, recordTreasureManaProduced } = await import('../util.js');
  const manaPool = getOrInitManaPool(game.state, pid) as any;

  // Treasure provenance tracking for replay-stable "mana from a Treasure" clauses.
  let isTreasureSource = false;
  try {
    const battlefield = game.state?.battlefield || [];
    const perm = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
    const typeLineLower = String((perm as any)?.card?.type_line || '').toLowerCase();
    isTreasureSource = /\btreasure\b/.test(typeLineLower);
  } catch {
    // best-effort only
  }

  const codeToPoolKey: Record<string, keyof typeof manaPool> = {
    W: 'white',
    U: 'blue',
    B: 'black',
    R: 'red',
    G: 'green',
    C: 'colorless',
  };
  const poolKeyToCode: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    colorless: 'C',
  };
  const addedMana: Record<string, number> = {};

  if (selectionKind === 'distribution') {
    let distribution = response.selections as any;
    // Same shorthand as validate-before-complete: a single color puts the full amount there.
    if (typeof distribution === 'string') {
      const chosenKey = String(distribution);
      const chosenCode = poolKeyToCode[chosenKey]
        || (['W', 'U', 'B', 'R', 'G', 'C'].includes(chosenKey.toUpperCase()) ? chosenKey.toUpperCase() : '');
      const totalAmount = Number(stepData.totalAmount ?? stepData.amount ?? 0);
      if (!chosenCode) {
        emitToPlayer(io, pid as any, 'error', {
          code: 'INVALID_COLOR',
          message: `Invalid color selection (${chosenKey})`,
        });
        return;
      }
      distribution = { [chosenCode]: Math.max(0, totalAmount) };
    }
    if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_SELECTION',
        message: 'Invalid distribution format',
      });
      return;
    }

    const totalAmount = Number(stepData.totalAmount ?? stepData.amount ?? 0);
    const availableColors: string[] = Array.isArray(stepData.availableColors)
      ? stepData.availableColors
      : (Array.isArray(stepData.allowedColors) ? stepData.allowedColors : ['W', 'U', 'B', 'R', 'G']);

    const totalDistributed = Object.values(distribution).reduce((sum: number, val: any) => sum + Number(val || 0), 0);
    if (totalAmount > 0 && totalDistributed !== totalAmount) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_DISTRIBUTION',
        message: `Total mana distributed (${totalDistributed}) doesn't match required amount (${totalAmount})`,
      });
      return;
    }

    for (const [color, amountRaw] of Object.entries(distribution)) {
      const amount = Number(amountRaw || 0);
      if (amount <= 0) continue;
      if (!availableColors.includes(color)) {
        emitToPlayer(io, pid as any, 'error', {
          code: 'INVALID_COLOR',
          message: `${color} is not an available color for this ability`,
        });
        return;
      }
    }

    // Storage counter special-case: remove counters as part of the "add mana" resolution.
    if (stepData.isStorageCounter) {
      const battlefield = game.state?.battlefield || [];
      const perm = battlefield.find((p: any) => p && p.id === permanentId);
      if (perm) {
        const counterType = String(stepData.counterType || '');
        const removeN = Number(stepData.removeCounterCount ?? totalAmount);
        if (counterType && removeN > 0) {
          (perm as any).counters = (perm as any).counters || {};
          const current = Number((perm as any).counters?.[counterType] || 0);
          const next = Math.max(0, current - removeN);
          if (next > 0) {
            (perm as any).counters[counterType] = next;
          } else {
            delete (perm as any).counters[counterType];
          }

          removedCountersForCost.push({
            permanentId,
            counterType,
            count: removeN,
          });
        }
      }
    }

    for (const [color, amountRaw] of Object.entries(distribution)) {
      const amount = Number(amountRaw || 0);
      if (amount <= 0) continue;
      const poolKey = codeToPoolKey[color];
      if (poolKey) {
        manaPool[poolKey] = Number(manaPool[poolKey] || 0) + amount;
        addedMana[String(poolKey)] = (addedMana[String(poolKey)] || 0) + amount;
        if (isTreasureSource) {
          try {
            recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, amount);
          } catch {}
        }
      }
    }

    const manaParts: string[] = [];
    for (const [color, amountRaw] of Object.entries(distribution)) {
      const amount = Number(amountRaw || 0);
      if (amount > 0) {
        manaParts.push(amount > 8 ? `${amount}{${color}}` : `{${String(color).repeat(amount)}}`);
      }
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} added ${manaParts.join(', ')} to their mana pool from ${cardName || 'an ability'}.`,
      ts: Date.now(),
    });
  } else {
    const chosen = response.selections as any;
    if (typeof chosen !== 'string') {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_SELECTION',
        message: 'Invalid color selection',
      });
      return;
    }

    let amount = Number(stepData.amount || 1);
    const allowedCodes: string[] | undefined = Array.isArray(stepData.allowedColors) ? stepData.allowedColors : undefined;

    const poolKey = String(chosen);
    const chosenCode = poolKeyToCode[poolKey];
    if (!chosenCode) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_COLOR',
        message: `Invalid color selection (${chosen})`,
      });
      return;
    }
    if (allowedCodes && allowedCodes.length > 0 && !allowedCodes.includes(chosenCode)) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_COLOR',
        message: `That color isn't allowed for this ability`,
      });
      return;
    }

    if (String(stepData.dynamicAmountSource || '') === 'devotion') {
      const { calculateDevotion } = await import('../../state/modules/mana-abilities.js');
      const controllerId = String(stepData.playerId || pid);
      const multiplier = Math.max(1, Number(stepData.manaMultiplier || 1));
      amount = calculateDevotion(game.state, controllerId, chosenCode as 'W' | 'U' | 'B' | 'R' | 'G') * multiplier;
    }

    const manaRestriction = String(stepData.manaRestriction || '').trim();
    const manaRestrictedTo = String(stepData.manaRestrictedTo || '').trim() || undefined;
    if (manaRestriction) {
      const { addRestrictedManaToPool } = await import('../util.js');
      addRestrictedManaToPool(
        game.state,
        pid,
        poolKey as any,
        amount,
        manaRestriction as any,
        manaRestrictedTo,
        permanentId || step.sourceId,
        cardName || step.sourceName,
      );
      addedMana[String(poolKey)] = (addedMana[String(poolKey)] || 0) + amount;
    } else {
      manaPool[poolKey] = Number(manaPool[poolKey] || 0) + amount;
      addedMana[String(poolKey)] = (addedMana[String(poolKey)] || 0) + amount;
      if (isTreasureSource) {
        try {
          recordTreasureManaProduced(game.state, String(pid), String(poolKey) as any, amount);
        } catch {}
      }
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: amount > 0
        ? `${getPlayerName(game, pid)} added ${amount > 8 ? `${amount}{${chosenCode}}` : `{${chosenCode.repeat(amount)}}`} to their mana pool from ${cardName || 'an ability'}${manaRestriction ? ' (restricted)' : ''}.`
        : `${getPlayerName(game, pid)} added no mana from ${cardName || 'an ability'} (devotion was 0).`,
      ts: Date.now(),
    });
  }

  // Intervening-if support: mark that this ability produced mana this turn (best-effort).
  try {
    const stateAny = game.state as any;
    stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
    stateAny.addedManaWithThisAbilityThisTurn[String(pid)] = stateAny.addedManaWithThisAbilityThisTurn[String(pid)] || {};
    const permKey = String(permanentId);
    const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
    const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
    (stateAny.addedManaWithThisAbilityThisTurn[String(pid)] as any)[k] = true;
  } catch {}

  // Persist replay-stable evidence for "added mana with this ability this turn".
  // If this mana ability activation had additional costs (e.g., "Pay N life", "Sacrifice this"),
  // apply and persist those here, because the activation path may have returned early to wait
  // for this selection.
  try {
    const lifeToPay = Number(stepData.lifeToPayForCost || 0);
    const manaLifeLossAmount = Number(stepData.manaLifeLossAmount || 0);
    const manaLifeLossIsDamage = stepData.manaLifeLossIsDamage === true;
    const tappedPermanentsForCost: string[] = Array.isArray(stepData.tappedPermanentsForCost)
      ? stepData.tappedPermanentsForCost.map((x: any) => String(x))
      : [];
    const sacrificedPermanentsForCost: string[] = Array.isArray(stepData.sacrificedPermanentsForCost)
      ? stepData.sacrificedPermanentsForCost.map((x: any) => String(x))
      : [];

    // Deferred remove-counter activation costs (e.g. Gemstone Array any-color mana).
    // activateBattlefieldAbility queues color choice and returns before applying these.
    const deferredCounterRemovals = Array.isArray(stepData.pendingCounterRemovals)
      ? stepData.pendingCounterRemovals
      : [];
    if (deferredCounterRemovals.length > 0) {
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const perm = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permanentId));
      for (const entry of deferredCounterRemovals) {
        const counterType = String(entry?.counterType || '').trim();
        const count = Number(entry?.count || 0);
        if (!counterType || !Number.isFinite(count) || count <= 0) continue;
        if (perm) {
          try {
            const ctx = {
              state: game.state,
              libraries: (game as any).libraries,
              bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
              rng: (game as any).rng,
              gameId,
            } as any;
            const { updateCounters } = await import('../../state/modules/counters_tokens.js');
            updateCounters(ctx, String(permanentId), { [counterType]: -count });
          } catch {
            (perm as any).counters = (perm as any).counters || {};
            const next = Math.max(0, Number((perm as any).counters[counterType] || 0) - count);
            if (next > 0) (perm as any).counters[counterType] = next;
            else delete (perm as any).counters[counterType];
          }
        }
        removedCountersForCost.push({
          permanentId: String(permanentId),
          counterType,
          count,
        });
      }
    }

    const needsActivationEvidence =
      (lifeToPay > 0) ||
      tappedPermanentsForCost.length > 0 ||
      sacrificedPermanentsForCost.length > 0 ||
      removedCountersForCost.length > 0 ||
      requiresSelfExertForCost;
    if (needsActivationEvidence) {
      if (lifeToPay > 0) {
        try {
          (game.state as any).life = (game.state as any).life || {};
          const cur = Number((game.state as any).life?.[pid] ?? 40);
          if (!Number.isFinite(cur) || cur < lifeToPay) {
            emitToPlayer(io, pid as any, 'error', {
              code: 'INSUFFICIENT_LIFE',
              message: `Need to pay ${lifeToPay} life to complete this activation.`
            });
            return;
          }
          (game.state as any).life[pid] = Math.max(0, cur - lifeToPay);

          (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
          (game.state as any).lifeLostThisTurn[String(pid)] =
            Number((game.state as any).lifeLostThisTurn[String(pid)] || 0) + lifeToPay;
          queueLifePaymentTriggers(game as any, String(pid), lifeToPay, { sourceId: permanentId, sourceName: cardName || 'an ability' });

          const player = (game.state.players || []).find((entry: any) => entry?.id === pid);
          if (player) {
            player.life = (game.state as any).life[pid];
          }

          io.to(gameId).emit('chat', {
            id: `m_${Date.now()}`,
            gameId,
            from: 'system',
            message: `${getPlayerName(game, pid)} pays ${lifeToPay} life for ${cardName || 'an ability'} (${cur} → ${(game.state as any).life[pid]}).`,
            ts: Date.now(),
          });
        } catch {
          // best-effort only
        }
      }

      const exertedPermanentIdForCost = finalizeBattlefieldAbilitySelfExertCost(
        game,
        gameId,
        String(pid),
        permanentId,
        requiresSelfExertForCost,
      );

      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        abilityText: String(stepData.abilityText || '').trim() || undefined,
        activatedAbilityText: String(stepData.activatedAbilityText || '').trim() || undefined,
        tappedPermanents: tappedPermanentsForCost,
        sacrificedPermanents: sacrificedPermanentsForCost,
        removedCountersForCost,
        lifePaidForCost: lifeToPay,
        exertedPermanentIdForCost,
      });
    }

    if (Number.isFinite(manaLifeLossAmount) && manaLifeLossAmount > 0) {
      try {
        (game.state as any).life = (game.state as any).life || {};
        const cur = Number((game.state as any).life?.[pid] ?? 40);
        (game.state as any).life[pid] = Math.max(0, cur - manaLifeLossAmount);

        if (manaLifeLossIsDamage) {
          (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
          (game.state as any).damageTakenThisTurnByPlayer[String(pid)] =
            Number((game.state as any).damageTakenThisTurnByPlayer[String(pid)] || 0) + manaLifeLossAmount;
        }

        (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
        (game.state as any).lifeLostThisTurn[String(pid)] =
          Number((game.state as any).lifeLostThisTurn[String(pid)] || 0) + manaLifeLossAmount;
        if (!manaLifeLossIsDamage) {
          queueLifePaymentTriggers(game as any, String(pid), manaLifeLossAmount, { sourceId: permanentId, sourceName: cardName || 'an ability' });
        }

        const player = (game.state.players || []).find((entry: any) => entry?.id === pid);
        if (player) {
          player.life = (game.state as any).life[pid];
        }

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: manaLifeLossIsDamage
            ? `${cardName} dealt ${manaLifeLossAmount} damage to ${getPlayerName(game, pid)} (${cur} → ${(game.state as any).life[pid]}).`
            : `${getPlayerName(game, pid)} pays ${manaLifeLossAmount} life for ${cardName} (${cur} → ${(game.state as any).life[pid]}).`,
          ts: Date.now(),
        });
      } catch {
        // best-effort only
      }
    }
  } catch (e) {
    debugWarn(1, '[Resolution] activateBattlefieldAbility (mana color selection evidence) failed:', e);
  }

  let orchardQueuedResolutionStep: ResolutionStep | undefined;

  // Forbidden Orchard uses the any-color mana path, so its target-opponent trigger
  // must be queued here after the mana color has been chosen.
  if (String(cardName || '').trim().toLowerCase() === 'forbidden orchard') {
    const players = Array.isArray(game.state?.players) ? game.state.players : [];
    const opponents = players.filter(
      (player: any) => player?.id != null && String(player.id) !== String(pid) && !player?.hasLost
    );

    if (opponents.length > 0) {
      orchardQueuedResolutionStep = createResolutionStep({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: 'Forbidden Orchard',
        description: 'Choose target opponent to create a 1/1 colorless Spirit creature token.',
        mandatory: true,
        options: opponents.map((player: any) => ({
          id: String(player.id),
          label: String(player.name || player.id),
        })),
        minSelections: 1,
        maxSelections: 1,
        forbiddenOrchardTargetChoice: true,
        permanentId,
        cardName: 'Forbidden Orchard',
      } as any);
    }
  }

  try {
    const manaColor = selectionKind === 'distribution'
      ? 'MULTI'
      : (typeof (response.selections as any) === 'string' ? String(response.selections) : undefined);
    appendEvent(gameId, (game as any).seq ?? 0, 'activateManaAbility', {
      playerId: pid,
      resolvedStepId: String((step as any).id || ''),
      permanentId,
      abilityId,
      manaColor,
      addedMana,
      lifeLost: Number.isFinite(Number(stepData.manaLifeLossAmount || 0)) && Number(stepData.manaLifeLossAmount || 0) > 0
        ? Number(stepData.manaLifeLossAmount || 0)
        : undefined,
      lifeLossIsDamage: Number.isFinite(Number(stepData.manaLifeLossAmount || 0)) && Number(stepData.manaLifeLossAmount || 0) > 0
        ? (typeof stepData.manaLifeLossIsDamage === 'boolean' ? stepData.manaLifeLossIsDamage : undefined)
        : undefined,
      queuedResolutionStep: orchardQueuedResolutionStep,
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(activateManaAbility) failed:', e);
  }

  if (orchardQueuedResolutionStep) {
    ResolutionQueueManager.addStep(gameId, orchardQueuedResolutionStep as any);
  }

  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastManaPoolUpdate(io, gameId, pid, manaPool, `Added mana (${cardName || 'ability'})`, game);
  broadcastGame(io, game, gameId);
}
