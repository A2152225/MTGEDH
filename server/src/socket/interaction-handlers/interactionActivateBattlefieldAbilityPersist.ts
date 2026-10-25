/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility trailing persist after both
 * generic mana and non-mana branches (bumpSeq, cost apply, replay events).
 *
 * Public entry symbols: applyActivateBattlefieldAbilityPersist.
 */

import { notifyNoncombatPlayerDamage } from '../../state/modules/triggers/player-dealt-damage-ir.js';
import { appendEvent } from "../../db";
import { pushWheneverYouExertTriggersOntoStack } from "../exert-triggers.js";
import { broadcastGame, getPlayerName } from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import type {
  ActivateGenericAbilityExtras,
  ActivateGenericAbilityMutationState,
} from "./interactionActivateGenericAbilityState.js";

export async function applyActivateBattlefieldAbilityPersist(
  ctx: ActivateBattlefieldAbilityContext,
  mut: ActivateGenericAbilityMutationState,
  extras: ActivateGenericAbilityExtras,
  isManaAbility: boolean,
): Promise<boolean> {
  const {
    requiresSelfExert,
    resolvedAbilityText,
    resolvedActivatedAbilityText,
    selectedAbilityIndex,
    isExhaustActivation,
  } = extras;
  const pendingLifePaymentForCost = mut.pendingLifePaymentForCost;
  const pendingManaLifeLossAmount = mut.pendingManaLifeLossAmount;
  const pendingManaLifeLossIsDamage = mut.pendingManaLifeLossIsDamage;
  const manaGrantsCreatureSpellHasteUntilEndOfTurn = mut.manaGrantsCreatureSpellHasteUntilEndOfTurn;
  const persistedStackItemId = mut.persistedStackItemId;
  const tappedPermanentsForCost = mut.tappedPermanentsForCost;
  const sacrificedPermanentsForCost = mut.sacrificedPermanentsForCost;
  const recordedAddedMana = mut.recordedAddedMana;
  const removedCountersForCost = mut.removedCountersForCost;
  const pendingCounterRemovals = mut.pendingCounterRemovals;
  const {
    io,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    selectedXValue,
    permanent,
    cardName,
  } = ctx;

  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  // Intervening-if support: if this activation was a mana ability and we didn't early-return
  // for a later color-choice step, then mana was added immediately.
  try {
    if (isManaAbility) {
      const stateAny = game.state as any;
      stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
      stateAny.addedManaWithThisAbilityThisTurn[String(pid)] = stateAny.addedManaWithThisAbilityThisTurn[String(pid)] || {};
      const permKey = String(permanentId);
      const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
      const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
      (stateAny.addedManaWithThisAbilityThisTurn[String(pid)] as any)[k] = true;
    }
  } catch {}

  // Apply any deferred counter removals for activation costs now that we know the activation completed.
  // This ensures we don't remove counters if the activation later fails due to mana payment, etc.
  if (pendingCounterRemovals.length > 0) {
    for (const entry of pendingCounterRemovals) {
      const counterType = String(entry?.counterType || '').trim();
      const count = Number(entry?.count || 0);
      if (!counterType || !Number.isFinite(count) || count <= 0) continue;

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
        // best-effort direct mutation fallback
        (permanent as any).counters = (permanent as any).counters || {};
        const next = Math.max(0, Number((permanent as any).counters[counterType] || 0) - count);
        if (next > 0) (permanent as any).counters[counterType] = next;
        else delete (permanent as any).counters[counterType];
      }

      removedCountersForCost.push({ permanentId: String(permanentId), counterType, count });
    }
  }

  // Apply any deferred life payment for activation costs now that we know the activation completed.
  // This ensures we don't pay life if the activation later fails due to mana payment, etc.
  if (pendingLifePaymentForCost > 0) {
    try {
      (game.state as any).life = (game.state as any).life || {};
      const cur = Number((game.state as any).life?.[pid] ?? 40);
      const paidLife = Math.max(0, Number(pendingLifePaymentForCost || 0));
      (game.state as any).life[pid] = Math.max(0, cur - paidLife);

      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[String(pid)] =
        Number((game.state as any).lifeLostThisTurn[String(pid)] || 0) + paidLife;

      const player = (game.state.players || []).find((entry: any) => entry?.id === pid);
      if (player) {
        player.life = (game.state as any).life[pid];
      }
    } catch {
      // best-effort only
    }
  }

  if (pendingManaLifeLossAmount > 0) {
    try {
      (game.state as any).life = (game.state as any).life || {};
      const cur = Number((game.state as any).life?.[pid] ?? 40);
      (game.state as any).life[pid] = Math.max(0, cur - pendingManaLifeLossAmount);

      if (pendingManaLifeLossIsDamage) {
        (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
        (game.state as any).damageTakenThisTurnByPlayer[String(pid)] =
          Number((game.state as any).damageTakenThisTurnByPlayer[String(pid)] || 0) + pendingManaLifeLossAmount;
        notifyNoncombatPlayerDamage(game as any, String(pid), pendingManaLifeLossAmount);
      }

      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[String(pid)] =
        Number((game.state as any).lifeLostThisTurn[String(pid)] || 0) + pendingManaLifeLossAmount;

      const player = (game.state.players || []).find((entry: any) => entry?.id === pid);
      if (player) {
        player.life = (game.state as any).life[pid];
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: pendingManaLifeLossIsDamage
          ? `${cardName} dealt ${pendingManaLifeLossAmount} damage to ${getPlayerName(game, pid)} (${cur} → ${(game.state as any).life[pid]}).`
          : `${getPlayerName(game, pid)} pays ${pendingManaLifeLossAmount} life for ${cardName} (${cur} → ${(game.state as any).life[pid]}).`,
        ts: Date.now(),
      });
    } catch {
      // best-effort only
    }
  }

  const exertedPermanentIdForCost = (() => {
    if (!requiresSelfExert) {
      return undefined;
    }

    const battlefieldNow = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const currentPermanent = battlefieldNow.find((entry: any) => entry && String(entry.id || '') === String(permanentId)) as any;
    if (!currentPermanent) {
      return undefined;
    }

    currentPermanent.doesntUntapNextTurn = true;
    currentPermanent.exertedThisTurn = true;
    return String(permanentId);
  })();

  const activatedAbilityText = resolvedActivatedAbilityText;
  const persistedAbilityText = String(resolvedAbilityText || '').trim()
    || (activatedAbilityText.includes(':') ? activatedAbilityText.split(':').slice(1).join(':').trim() : activatedAbilityText);
  
  // Contract (Critical undo/replay gap #3): this event records cost/tap/stack evidence.
  // Arbitrary activated effects must be reconstructible from:
  // - usesStack + stackItemId (later resolve events apply the effect), or
  // - rich payload fields (counterUpdates / specialAnimation / hideaway / queued step / abilityType), or
  // - follow-up discrete events (activateManaAbility, battlefieldPermanentPatch, updateCounters, etc.).
  appendEvent(gameId, (game as any).seq ?? 0, "activateBattlefieldAbility", { 
    playerId: pid, 
    permanentId, 
    abilityId,
    cardName,
    abilityText: persistedAbilityText,
    activatedAbilityText,
    usesStack: !isManaAbility,
    ...(persistedStackItemId ? { stackItemId: persistedStackItemId } : null),
    xValue: selectedXValue,
    activatedAbilityIndex: selectedAbilityIndex,
    ...(isExhaustActivation ? { exhaustAbility: true } : null),
    tappedPermanents: tappedPermanentsForCost,
    sacrificedPermanents: sacrificedPermanentsForCost,
    removedCountersForCost,
    lifePaidForCost: pendingLifePaymentForCost,
    exertedPermanentIdForCost,
  });

  if (exertedPermanentIdForCost) {
    pushWheneverYouExertTriggersOntoStack(game as any, gameId, String(pid), String(exertedPermanentIdForCost));
  }

  if (Object.keys(recordedAddedMana).length > 0) {
    const poolKeyToManaColor: Record<string, string> = {
      white: 'W',
      blue: 'U',
      black: 'B',
      red: 'R',
      green: 'G',
      colorless: 'C',
    };
    const manaEntries = Object.entries(recordedAddedMana).filter(([, amount]) => Number(amount || 0) > 0);
    const manaColor = manaEntries.length === 1
      ? (poolKeyToManaColor[String(manaEntries[0][0])] || String(manaEntries[0][0]).toUpperCase())
      : 'MULTI';
    appendEvent(gameId, (game as any).seq ?? 0, "activateManaAbility", {
      playerId: pid,
      permanentId,
      abilityId,
      manaColor,
      addedMana: { ...recordedAddedMana },
      ...(manaGrantsCreatureSpellHasteUntilEndOfTurn ? { manaGrantsCreatureSpellHasteUntilEndOfTurn: true } : null),
      lifeLost: pendingManaLifeLossAmount > 0 ? pendingManaLifeLossAmount : undefined,
      lifeLossIsDamage: pendingManaLifeLossAmount > 0 ? pendingManaLifeLossIsDamage === true : undefined,
    });
  }
  
  broadcastGame(io, game, gameId);
  return false;
}
