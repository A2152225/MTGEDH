import type { GameContext } from '../../context.js';
import { timingTriggerEffect } from './timing-effect-extraction.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';
import { maybeIncreaseSpeedFromOpponentLifeLoss } from '../statefulPaperKeywords.js';

export interface LifeLossTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'opponent_loses_life' | 'player_loses_life' | 'you_lose_life';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
}

export function detectLifeLossTriggers(card: any, permanent: any): LifeLossTrigger[] {
  const triggers: LifeLossTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const gainOrLoseLifeMatch = oracleText.match(
    /whenever you gain or lose life(?: during your turn)?,?\s*([^.]+)/i,
  );
  if (gainOrLoseLifeMatch) {
    const effect = timingTriggerEffect(oracleText, gainOrLoseLifeMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'you_lose_life',
        oracleClause: String(gainOrLoseLifeMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
      });
    }
  }

  const opponentsLoseLifeMatch = oracleText.match(
    /whenever one or more opponents lose life,?\s*([^.]+)/i,
  );
  if (opponentsLoseLifeMatch) {
    const effect = timingTriggerEffect(oracleText, opponentsLoseLifeMatch);
    if (effect) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'opponent_loses_life',
        oracleClause: String(opponentsLoseLifeMatch[0] || '').trim(),
        effect,
        mandatory: !/^you may\b/i.test(effect),
      });
    }
  }

  const matches = oracleText.matchAll(/whenever (an opponent|a player|you) lose(?:s)? life(?:[^,]*?),?\s*([^.]+)/gi);
  for (const match of matches) {
    const subject = String(match[1] || '').trim().toLowerCase();
    const effect = timingTriggerEffect(oracleText, match, 2);
    if (!effect) continue;

    const triggerType = subject === 'an opponent'
      ? 'opponent_loses_life'
      : subject === 'a player'
        ? 'player_loses_life'
        : 'you_lose_life';

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType,
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
    });
  }

  return triggers;
}

export function getLifeLossTriggers(ctx: GameContext, losingPlayerId: string): LifeLossTrigger[] {
  const triggers: LifeLossTrigger[] = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permanentController = String(permanent.controller || '');
    const permanentTriggers = detectLifeLossTriggers(permanent.card, permanent);
    for (const trigger of permanentTriggers) {
      const interveningText = String(trigger.oracleClause || trigger.effect || '').trim();
      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanentController,
        interveningText,
        permanent,
        {
          thatPlayerId: losingPlayerId,
          referencedPlayerId: losingPlayerId,
          theirPlayerId: losingPlayerId,
        },
      );
      if (ok === false) continue;

      switch (trigger.triggerType) {
        case 'opponent_loses_life':
          if (losingPlayerId !== permanentController) {
            triggers.push({ ...trigger, controllerId: permanentController });
          }
          break;
        case 'player_loses_life':
          triggers.push({ ...trigger, controllerId: permanentController });
          break;
        case 'you_lose_life':
          if (losingPlayerId === permanentController) {
            triggers.push({ ...trigger, controllerId: permanentController });
          }
          break;
      }
    }
  }

  return triggers;
}

function findBattlefieldPermanentById(ctx: GameContext, permanentId: string): any | undefined {
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const normalizedPermanentId = String(permanentId || '').trim();
  if (!normalizedPermanentId) return undefined;
  return battlefield.find((permanent: any) => String(permanent?.id || '') === normalizedPermanentId);
}

function snapshotPermanentForLifeLossTrigger(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;

  return {
    id: String(permanent?.id || ''),
    controller: String(permanent?.controller || ''),
    owner: String(permanent?.owner || permanent?.controller || ''),
    tapped: permanent?.tapped === true,
    counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
    card: permanent?.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
  };
}

export function queueLifeLossTriggers(
  ctx: GameContext,
  losingPlayerId: string,
  lifeLost: number,
  sourcePlayerId?: string,
  options: { trackLifeLost?: boolean; wasLifePayment?: boolean; paymentSourceId?: string; paymentSourceName?: string } = {},
): any[] {
  if (!losingPlayerId || lifeLost <= 0) {
    return [];
  }
  if ((ctx as any)?.isReplaying) return [];

  const stateAny = ctx.state as any;
  if (options.trackLifeLost !== false) {
    stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
    stateAny.lifeLostThisTurn[losingPlayerId] = Number(stateAny.lifeLostThisTurn[losingPlayerId] || 0) + lifeLost;
  }

  // CR 702.179d: inherent once-per-turn speed increase when an opponent loses life.
  try {
    const turnPlayer = String(stateAny.turnPlayer || stateAny.activePlayer || '').trim();
    const previousSpeed = Number(stateAny.speed?.[turnPlayer]);
    const nextSpeed = maybeIncreaseSpeedFromOpponentLifeLoss(stateAny, losingPlayerId);
    if (nextSpeed != null && turnPlayer) {
      const gameId = String((ctx as any).gameId || '').trim();
      if (gameId && gameId !== 'unknown') {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'increasePlayerSpeed', {
          playerId: turnPlayer,
          from: Number.isFinite(previousSpeed) ? previousSpeed : undefined,
          to: nextSpeed,
          reason: 'opponent_life_loss',
          losingPlayerId,
        });
      }
    }
  } catch (err) {
    debugWarn(1, '[lifeLossTrigger] Failed to apply Start Your Engines! speed increase:', err);
  }

  const triggers = orderTriggersByAPNAP(ctx, getLifeLossTriggers(ctx, losingPlayerId));
  if (triggers.length === 0) {
    return [];
  }

  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) {
      continue;
    }

    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = snapshotPermanentForLifeLossTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPlayer: losingPlayerId,
      targetPlayer: losingPlayerId,
      effectData: {
        losingPlayerId,
        lifeLost,
        ...(sourcePlayerId ? { sourcePlayerId } : null),
        ...(options.wasLifePayment ? { wasLifePayment: true } : null),
        ...(options.paymentSourceId ? { paymentSourceId: options.paymentSourceId } : null),
        ...(options.paymentSourceName ? { paymentSourceName: options.paymentSourceName } : null),
      },
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          targetPlayer: losingPlayerId,
          triggeringPlayer: losingPlayerId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[lifeLossTrigger] Failed to persist generic life-loss trigger:', err);
      }
    }
  }

  return queued;
}