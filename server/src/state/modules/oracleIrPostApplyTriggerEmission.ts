/**
 * Emit live trigger queues after Oracle IR steps apply on the server.
 * Closes the Baral/Lullmage class of bugs where detectors exist but IR never
 * calls process/queue helpers.
 */
import type { GameContext } from '../context.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { queueLifegainTriggers } from './triggers/lifegain.js';
import { queueLifeLossTriggers } from './triggers/life-loss.js';
import { queueSacrificeTriggers } from './triggers/sacrifice.js';
import { queueLibrarySearchTriggers } from './triggers/search.js';
import { queueLibraryShuffleTriggers } from './triggers/shuffle.js';
import { queueDiscardTriggeredAbilities } from './triggers/discard.js';
import { queueBecomesUntappedTriggers } from './triggers/tap-untap.js';
import { queueTapTriggersForTappedPermanentsOnContext } from './tap-trigger-queue.js';
import {
  processDamageReceivedTriggers,
  dispatchDamageReceivedTrigger,
} from './triggers/damage-received.js';
import { processMonstrousTriggers } from './triggerEmissionFamilyUtils.js';
import {
  extractDiscoverValueFromImpulseStep,
  processDiscoverTriggers,
} from './triggerDiscoverUtils.js';
import { debugWarn } from '../../utils/debug.js';
import { queueDealsDamageToPlayerTriggersFromPermanent } from './triggerLifeDamageUtils.js';
import { processMillTriggers } from './zones.js';
import { checkGraveyardTrigger } from './zone-manipulation.js';

export type BattlefieldTriggerSnapshot = {
  readonly lifeByPlayer: ReadonlyMap<string, number>;
  readonly permanents: ReadonlyMap<string, {
    tapped: boolean;
    damage: number;
    isMonstrous: boolean;
    controller: string;
    card: any;
    isToken?: boolean;
    type_line?: string;
  }>;
  readonly handCardIdsByPlayer: ReadonlyMap<string, readonly string[]>;
  readonly graveyardCardIdsByPlayer: ReadonlyMap<string, ReadonlySet<string>>;
};

export function snapshotBattlefieldForTriggerEmission(state: any): BattlefieldTriggerSnapshot {
  const lifeByPlayer = new Map<string, number>();
  for (const player of Array.isArray(state?.players) ? state.players : []) {
    const id = String(player?.id || '').trim();
    if (!id) continue;
    const life = Number(state?.life?.[id] ?? player?.life);
    if (Number.isFinite(life)) lifeByPlayer.set(id, life);
  }

  const permanents = new Map<string, {
    tapped: boolean;
    damage: number;
    isMonstrous: boolean;
    controller: string;
    card: any;
    isToken?: boolean;
    type_line?: string;
  }>();
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    const id = String(perm?.id || '').trim();
    if (!id) continue;
    permanents.set(id, {
      tapped: perm?.tapped === true,
      damage: Math.max(
        0,
        Number(perm?.damage || 0) || 0,
        Number(perm?.damageMarked || 0) || 0,
        Number(perm?.markedDamage || 0) || 0,
      ),
      isMonstrous: perm?.isMonstrous === true || perm?.monstrous === true,
      controller: String(perm?.controller || ''),
      card: perm?.card,
      isToken: perm?.isToken === true,
      type_line: String(perm?.card?.type_line || ''),
    });
  }

  const handCardIdsByPlayer = new Map<string, readonly string[]>();
  const graveyardCardIdsByPlayer = new Map<string, ReadonlySet<string>>();
  for (const player of Array.isArray(state?.players) ? state.players : []) {
    const id = String(player?.id || '').trim();
    if (!id) continue;
    const hand = Array.isArray(player?.hand) ? player.hand : (state?.zones?.[id]?.hand || []);
    handCardIdsByPlayer.set(
      id,
      hand.map((card: any) => String(card?.id || '').trim()).filter(Boolean),
    );
    const gy = Array.isArray(player?.graveyard) ? player.graveyard : (state?.zones?.[id]?.graveyard || []);
    graveyardCardIdsByPlayer.set(
      id,
      new Set(gy.map((card: any) => String(card?.id || '').trim()).filter(Boolean)),
    );
  }

  return { lifeByPlayer, permanents, handCardIdsByPlayer, graveyardCardIdsByPlayer };
}

function appliedKinds(result: OracleIRExecutionResult): Set<string> {
  return new Set(
    (result.appliedSteps || [])
      .map((step) => String(step?.kind || '').trim())
      .filter(Boolean),
  );
}

function readLife(state: any, playerId: string): number | null {
  const fromState = Number(state?.life?.[playerId]);
  if (Number.isFinite(fromState)) return fromState;
  const player = (Array.isArray(state?.players) ? state.players : []).find(
    (entry: any) => String(entry?.id || '') === playerId,
  );
  const fromPlayer = Number(player?.life);
  return Number.isFinite(fromPlayer) ? fromPlayer : null;
}

/**
 * After IR mutates state, emit trigger families that socket/legacy already cover.
 */
export function emitTriggersAfterOracleIRApply(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  before: BattlefieldTriggerSnapshot,
  options?: { controller?: string; sourcePermanentId?: string },
): void {
  if ((ctx as any)?.isReplaying) return;

  try {
    const kinds = appliedKinds(result);
    const irController = String(options?.controller || '').trim();
    const sourcePermanentId = String(options?.sourcePermanentId || '').trim();

    // Life gain / loss
    const playerIds = new Set<string>([
      ...before.lifeByPlayer.keys(),
      ...((Array.isArray(state?.players) ? state.players : [])
        .map((p: any) => String(p?.id || '').trim())
        .filter(Boolean)),
    ]);
    for (const playerId of playerIds) {
      const beforeLife = before.lifeByPlayer.get(playerId);
      const afterLife = readLife(state, playerId);
      if (beforeLife == null || afterLife == null) continue;
      const delta = afterLife - beforeLife;
      if (delta > 0) {
        queueLifegainTriggers(ctx, playerId, delta);
      } else if (delta < 0) {
        const lost = -delta;
        queueLifeLossTriggers(ctx, playerId, lost);
        if (kinds.has('deal_damage')) {
          state.damageTakenThisTurnByPlayer = state.damageTakenThisTurnByPlayer || {};
          state.damageTakenThisTurnByPlayer[playerId] =
            Number(state.damageTakenThisTurnByPlayer[playerId] || 0) + lost;
          if (sourcePermanentId) {
            queueDealsDamageToPlayerTriggersFromPermanent(ctx, sourcePermanentId, playerId, lost);
          }
        }
      }
    }

    // Pay-life emission is handled in resolveOracleIrOptionalPaymentPromptFromResolution
    // (exact amount + avoids double-firing with life-loss diffs).

    // Tap / untap + damage + monstrous
    const newlyTappedIds: string[] = [];
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    for (const perm of battlefield) {
      const id = String(perm?.id || '').trim();
      if (!id) continue;
      const prev = before.permanents.get(id);
      const nowTapped = perm?.tapped === true;
        const nowDamage = Math.max(
          0,
          Number(perm?.damage || 0) || 0,
          Number(perm?.damageMarked || 0) || 0,
          Number(perm?.markedDamage || 0) || 0,
        );
      const nowMonstrous = perm?.isMonstrous === true || perm?.monstrous === true;

      if (prev) {
        if (!prev.tapped && nowTapped) {
          newlyTappedIds.push(id);
        } else if (prev.tapped && !nowTapped) {
          queueBecomesUntappedTriggers(ctx, perm);
        }
        if (nowDamage > prev.damage) {
          const amount = nowDamage - prev.damage;
          processDamageReceivedTriggers(ctx, perm, amount, (triggerInfo) => {
            if (dispatchDamageReceivedTrigger(ctx, triggerInfo)) return;
            const stateAny = state as any;
            stateAny.pendingDamageTriggers = stateAny.pendingDamageTriggers || {};
            stateAny.pendingDamageTriggers[triggerInfo.triggerId] = {
              sourceId: triggerInfo.sourceId,
              sourceName: triggerInfo.sourceName,
              controller: triggerInfo.controller,
              damageAmount: triggerInfo.damageAmount,
              triggerType: triggerInfo.triggerType,
              targetType: triggerInfo.targetType,
              targetRestriction: triggerInfo.targetRestriction,
              effect: triggerInfo.effect,
              effectMode: triggerInfo.effectMode,
              attackingPlayerId: triggerInfo.attackingPlayerId,
            };
          });
        }
        if (!prev.isMonstrous && nowMonstrous) {
          processMonstrousTriggers(ctx, perm);
        }
      } else if (kinds.has('monstrosity') && nowMonstrous) {
        processMonstrousTriggers(ctx, perm);
      }
    }

    if (newlyTappedIds.length > 0) {
      const tappedBy = String(
        (state as any)?.activePlayer
          || (state as any)?.turnPlayer
          || newlyTappedIds[0]
          || '',
      );
      // Prefer controller of first tapped permanent as "tapped by" for controller-scoped triggers.
      const firstTapped = battlefield.find((p: any) => String(p?.id || '') === newlyTappedIds[0]);
      queueTapTriggersForTappedPermanentsOnContext(
        ctx,
        newlyTappedIds,
        String(firstTapped?.controller || tappedBy),
      );
    }

    // Sacrifice — permanents removed while a sacrifice step applied.
    if (kinds.has('sacrifice')) {
      for (const [id, prev] of before.permanents) {
        const stillPresent = battlefield.some((p: any) => String(p?.id || '') === id);
        if (stillPresent) continue;
        const sacrificedSnapshot = {
          id,
          controller: prev.controller,
          card: prev.card,
          isToken: prev.isToken,
        };
        queueSacrificeTriggers(ctx, String(prev.controller || ''), sacrificedSnapshot);
      }
    }

    // Mill — new graveyard cards that did not come from hand.
    if (kinds.has('mill')) {
      for (const player of Array.isArray(state?.players) ? state.players : []) {
        const playerId = String(player?.id || '').trim();
        if (!playerId) continue;
        const beforeHand = new Set(before.handCardIdsByPlayer.get(playerId) || []);
        const beforeGy = before.graveyardCardIdsByPlayer.get(playerId) || new Set<string>();
        const afterGyCards = Array.isArray(player?.graveyard) && player.graveyard.length > 0
          ? player.graveyard
          : (state?.zones?.[playerId]?.graveyard || []);
        const milledCards = afterGyCards.filter((card: any) => {
          const cardId = String(card?.id || '').trim();
          return cardId && !beforeGy.has(cardId) && !beforeHand.has(cardId);
        });
        if (milledCards.length > 0) {
          for (const milledCard of milledCards) {
            checkGraveyardTrigger(ctx, milledCard, playerId, 'library');
          }
          processMillTriggers(ctx, playerId, milledCards, irController || undefined);
        }
      }
    }

    if (kinds.has('discard')) {
      for (const player of Array.isArray(state?.players) ? state.players : []) {
        const playerId = String(player?.id || '').trim();
        if (!playerId) continue;
        const beforeHand = new Set(before.handCardIdsByPlayer.get(playerId) || []);
        const beforeGy = before.graveyardCardIdsByPlayer.get(playerId) || new Set<string>();
        const afterHand = new Set(
          (Array.isArray(player?.hand) ? player.hand : (state?.zones?.[playerId]?.hand || []))
            .map((card: any) => String(card?.id || '').trim())
            .filter(Boolean),
        );
        const afterGyCards = Array.isArray(player?.graveyard)
          ? player.graveyard
          : (state?.zones?.[playerId]?.graveyard || []);
        const discardedCards = afterGyCards.filter((card: any) => {
          const cardId = String(card?.id || '').trim();
          return cardId && beforeHand.has(cardId) && !afterHand.has(cardId) && !beforeGy.has(cardId);
        });
        if (discardedCards.length > 0) {
          queueDiscardTriggeredAbilities(ctx, playerId, discardedCards);
        }
      }
    }

    // Library search / shuffle — emit for the IR controller (typical tutor/shuffle caster).
    const libraryActor = irController
      || String((state as any)?.activePlayer || (state as any)?.turnPlayer || '').trim();
    if (kinds.has('search_library') && libraryActor) {
      queueLibrarySearchTriggers(ctx, libraryActor, {
        sourceName: 'Oracle IR library search',
        searchedLibraryOwnerId: libraryActor,
      });
    }

    if (
      (kinds.has('shuffle_library') || kinds.has('shuffle_zones_into_library'))
      && libraryActor
    ) {
      queueLibraryShuffleTriggers(ctx, libraryActor, {
        sourceName: 'Oracle IR library shuffle',
      });
    }

    // Discover — impulse exile shaped as Discover N fires "whenever you discover".
    if (kinds.has('impulse_exile_top') && irController) {
      for (const step of result.appliedSteps || []) {
        const discoverValue = extractDiscoverValueFromImpulseStep(step);
        if (discoverValue == null) continue;
        processDiscoverTriggers(ctx, irController, discoverValue);
      }
    }
  } catch (err) {
    debugWarn(1, '[oracleIrPostApplyTriggerEmission] Failed to emit post-IR triggers:', err);
  }
}
