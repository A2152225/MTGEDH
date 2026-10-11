import type { GameContext } from '../../context.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { queueLifeLossTriggers } from './life-loss.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';
import { collectMatchingParsedEventLines } from './triggerConditionFamilyMatch.js';

export interface PayLifeTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'you_pay_life' | 'opponent_pays_life' | 'player_pays_life';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
}

export interface LifePaymentTriggerSource {
  sourceId?: string;
  sourceName?: string;
}

export function detectPayLifeTriggers(card: any, permanent: any): PayLifeTrigger[] {
  const triggers: PayLifeTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const matches = oracleText.matchAll(/whenever (you|an opponent|a player) pay(?:s)? life,\s*([^.]+)/gi);
  for (const match of matches) {
    const subject = String(match[1] || '').trim().toLowerCase();
    const effect = String(match[2] || '').trim();
    if (!effect) continue;

    const triggerType = subject === 'an opponent'
      ? 'opponent_pays_life'
      : subject === 'a player'
        ? 'player_pays_life'
        : 'you_pay_life';

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

export function getPayLifeTriggers(ctx: GameContext, payingPlayerId: string): PayLifeTrigger[] {
  const triggers: PayLifeTrigger[] = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permanentController = String(permanent.controller || '');
    const permanentTriggers = detectPayLifeTriggers(permanent.card, permanent);
    for (const trigger of permanentTriggers) {
      const interveningText = String(trigger.oracleClause || trigger.effect || '').trim();
      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanentController,
        interveningText,
        permanent,
        {
          thatPlayerId: payingPlayerId,
          referencedPlayerId: payingPlayerId,
          theirPlayerId: payingPlayerId,
        },
      );
      if (ok === false) continue;

      switch (trigger.triggerType) {
        case 'opponent_pays_life':
          if (payingPlayerId !== permanentController) {
            triggers.push({ ...trigger, controllerId: permanentController });
          }
          break;
        case 'player_pays_life':
          triggers.push({ ...trigger, controllerId: permanentController });
          break;
        case 'you_pay_life':
          if (payingPlayerId === permanentController) {
            triggers.push({ ...trigger, controllerId: permanentController });
          }
          break;
      }
    }
  }

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'pays_life',
      subjectPermanent: { id: '', controller: payingPlayerId },
      subjectControllerId: payingPlayerId,
      sourcePermanent: permanent,
    })) {
      const normalized = line.effect.toLowerCase();
      if (triggers.some((existing) => (
        String(existing.permanentId || '') === String(permanent.id || '')
        && String(existing.effect || '').toLowerCase().includes(normalized.slice(0, 24))
      ))) continue;
      const controller = line.condition?.alternatives[0]?.controller;
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        triggerType: controller === 'you'
          ? 'you_pay_life'
          : controller === 'not_you'
            ? 'opponent_pays_life'
            : 'player_pays_life',
        oracleClause: line.effect,
        effect: line.effect,
        mandatory: !/^you may\b/i.test(line.effect),
      });
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

function snapshotPermanentForPayLifeTrigger(permanent: any): any | undefined {
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

export function queuePayLifeTriggers(
  ctx: GameContext,
  payingPlayerId: string,
  lifePaid: number,
  source?: LifePaymentTriggerSource,
): any[] {
  if (!payingPlayerId || lifePaid <= 0) {
    return [];
  }
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getPayLifeTriggers(ctx, payingPlayerId));
  if (triggers.length === 0) {
    return [];
  }

  const stateAny = ctx.state as any;
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
    const sourcePermanentSnapshot = snapshotPermanentForPayLifeTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
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
      triggeringPlayer: payingPlayerId,
      targetPlayer: payingPlayerId,
      effectData: {
        payingPlayerId,
        lifePaid,
        amount: lifePaid,
        ...(source?.sourceId ? { paymentSourceId: source.sourceId } : null),
        ...(source?.sourceName ? { paymentSourceName: source.sourceName } : null),
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
          targetPlayer: payingPlayerId,
          triggeringPlayer: payingPlayerId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[payLifeTrigger] Failed to persist generic pay-life trigger:', err);
      }
    }
  }

  return queued;
}

export function queueLifePaymentTriggers(
  ctx: GameContext,
  payingPlayerId: string,
  lifePaid: number,
  source?: LifePaymentTriggerSource,
): any[] {
  if (!payingPlayerId || lifePaid <= 0) {
    return [];
  }

  return [
    ...queuePayLifeTriggers(ctx, payingPlayerId, lifePaid, source),
    ...queueLifeLossTriggers(ctx, payingPlayerId, lifePaid, payingPlayerId, {
      trackLifeLost: false,
      wasLifePayment: true,
      paymentSourceId: source?.sourceId,
      paymentSourceName: source?.sourceName,
    }),
  ];
}