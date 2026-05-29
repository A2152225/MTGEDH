import type { GameContext } from '../../context.js';

import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';

export interface CounterPlacedTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'counters_put_on_creature_you_control' | 'counters_put_on_permanent_you_control';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  counterFilter: 'any' | '+1/+1';
  targetFilter: 'creature' | 'permanent';
}

export interface CounterRemovedTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'counters_removed_from_self' | 'counters_removed_from_permanent_you_control';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  counterFilter: 'any' | string;
  targetFilter: 'self' | 'creature' | 'permanent' | 'enchantment' | 'artifact' | 'planeswalker';
}

function normalizeCounterType(counterType: string): string {
  const normalized = String(counterType || '').trim().toLowerCase();
  if (['+1/+1', 'p1p1', 'plus_one', 'plusone', 'plus1plus1', '+1+1'].includes(normalized)) {
    return '+1/+1';
  }
  return normalized;
}

function normalizeCounterFilter(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^(?:a|an|one or more)\s+/i, '')
    .replace(/\s+counters?$/i, '')
    .trim();
  return cleaned ? normalizeCounterType(cleaned) : 'any';
}

function collectCounterRemovedTriggerEffectText(oracleText: string, match: RegExpMatchArray, effectCaptureIndex: number): string {
  const effect = String(match?.[effectCaptureIndex] || '').trim().replace(/\s+/g, ' ');
  if (!effect) return effect;

  const matchText = String(match?.[0] || '');
  const matchStart = typeof match?.index === 'number'
    ? match.index
    : String(oracleText || '').indexOf(matchText);
  if (matchStart < 0) return effect;

  const sameLineTail = String(oracleText || '')
    .slice(matchStart + matchText.length)
    .split(/\r?\n/)[0] || '';
  const continuationMatch = sameLineTail.match(
    /^\s*\.\s*((?:then\s+if\s+this\s+(?:creature|enchantment|artifact|permanent|planeswalker)\s+has\s+no\s+[a-z0-9/+\- ]+?\s+counters?\s+on\s+it,\s*exile\s+it\.\s*when\s+you\s+do,?\s+[^.]+\.))/i
  );
  const continuation = String(continuationMatch?.[1] || '').trim();
  return continuation ? `${effect}. ${continuation}` : effect;
}

export function detectCounterPlacedTriggers(card: any, permanent: any): CounterPlacedTrigger[] {
  const triggers: CounterPlacedTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const matches = oracleText.matchAll(/whenever one or more (\+1\/\+1 )?counters are put on a (creature|permanent) you control,\s*([^.]+)/gi);
  for (const match of matches) {
    const counterFilter: CounterPlacedTrigger['counterFilter'] = match[1] ? '+1/+1' : 'any';
    const targetFilter = String(match[2] || '').trim().toLowerCase() === 'creature' ? 'creature' : 'permanent';
    const effect = collectCounterRemovedTriggerEffectText(oracleText, match, 3);
    if (!effect) continue;

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: targetFilter === 'creature'
        ? 'counters_put_on_creature_you_control'
        : 'counters_put_on_permanent_you_control',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      counterFilter,
      targetFilter,
    });
  }

  return triggers;
}

export function getCounterPlacedTriggers(
  ctx: GameContext,
  targetPermanent: any,
  placedDeltas: Record<string, number>,
): Array<CounterPlacedTrigger & { countersPlaced: number; placedCounterType: string }> {
  const triggers: Array<CounterPlacedTrigger & { countersPlaced: number; placedCounterType: string }> = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const targetController = String(targetPermanent?.controller || '');
  const targetTypeLine = String(targetPermanent?.card?.type_line || '').toLowerCase();
  const positiveEntries = Object.entries(placedDeltas || {})
    .map(([counterType, amount]) => ({ counterType: normalizeCounterType(counterType), amount: Math.max(0, Number(amount) || 0) }))
    .filter((entry) => entry.amount > 0);
  if (!targetController || positiveEntries.length === 0) {
    return triggers;
  }

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (String(permanent.controller || '') !== targetController) continue;

    const permanentTriggers = detectCounterPlacedTriggers(permanent.card, permanent);
    for (const trigger of permanentTriggers) {
      if (trigger.targetFilter === 'creature' && !targetTypeLine.includes('creature')) {
        continue;
      }

      const matchingEntries = positiveEntries.filter((entry) =>
        trigger.counterFilter === 'any' || entry.counterType === trigger.counterFilter
      );
      const countersPlaced = matchingEntries.reduce((sum, entry) => sum + entry.amount, 0);
      if (countersPlaced <= 0) {
        continue;
      }

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId,
        String(trigger.oracleClause || trigger.effect || ''),
        permanent,
        {
          thatPermanent: targetPermanent,
          referencedPermanent: targetPermanent,
          countersPlaced,
        } as any,
      );
      if (ok === false) continue;

      triggers.push({
        ...trigger,
        countersPlaced,
        placedCounterType: trigger.counterFilter === '+1/+1' ? '+1/+1' : matchingEntries[0]?.counterType || 'counter',
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

function snapshotPermanentForCounterTrigger(permanent: any): any | undefined {
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

export function queueCounterPlacedTriggers(
  ctx: GameContext,
  targetPermanent: any,
  targetPermanentId: string,
  placedDeltas: Record<string, number>,
): any[] {
  if (!targetPermanent || !targetPermanentId) {
    return [];
  }
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getCounterPlacedTriggers(ctx, targetPermanent, placedDeltas));
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
    const sourcePermanentSnapshot = snapshotPermanentForCounterTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
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
      triggeringPermanent: targetPermanentId,
      effectData: {
        targetPermanentId,
        targetPermanentName: String(targetPermanent?.card?.name || 'Permanent'),
        countersPlaced: trigger.countersPlaced,
        counterType: trigger.placedCounterType,
      },
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          triggeringPermanent: targetPermanentId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[counterTrigger] Failed to persist generic counter trigger:', err);
      }
    }
  }

  return queued;
}

export function detectCounterRemovedTriggers(card: any, permanent: any): CounterRemovedTrigger[] {
  const triggers: CounterRemovedTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');
  const cardName = String(card?.name || 'Unknown');

  const selfMatches = oracleText.matchAll(/whenever (?:one or more\s+)?(.+?\s+)?counters? (?:are|is) removed from this (creature|enchantment|artifact|permanent|planeswalker),\s*([^.]+)/gi);
  for (const match of selfMatches) {
    const counterFilter = normalizeCounterFilter(String(match[1] || ''));
    const targetFilter = String(match[2] || 'permanent').trim().toLowerCase() as CounterRemovedTrigger['targetFilter'];
    const effect = collectCounterRemovedTriggerEffectText(oracleText, match, 3);
    if (!effect) continue;

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'counters_removed_from_self',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      counterFilter,
      targetFilter: 'self',
    });
  }

  const controlledMatches = oracleText.matchAll(/whenever one or more\s+(.+?\s+)?counters? are removed from a (creature|enchantment|artifact|permanent|planeswalker) you control,\s*([^.]+)/gi);
  for (const match of controlledMatches) {
    const counterFilter = normalizeCounterFilter(String(match[1] || ''));
    const targetFilter = String(match[2] || 'permanent').trim().toLowerCase() as CounterRemovedTrigger['targetFilter'];
    const effect = String(match[3] || '').trim().replace(/\s+/g, ' ');
    if (!effect) continue;

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'counters_removed_from_permanent_you_control',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      counterFilter,
      targetFilter,
    });
  }

  return triggers;
}

export function getCounterRemovedTriggers(
  ctx: GameContext,
  targetPermanent: any,
  removedDeltas: Record<string, number>,
): Array<CounterRemovedTrigger & { countersRemoved: number; removedCounterType: string }> {
  const triggers: Array<CounterRemovedTrigger & { countersRemoved: number; removedCounterType: string }> = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const targetController = String(targetPermanent?.controller || '');
  const targetTypeLine = String(targetPermanent?.card?.type_line || '').toLowerCase();
  const positiveEntries = Object.entries(removedDeltas || {})
    .map(([counterType, amount]) => ({ counterType: normalizeCounterType(counterType), amount: Math.max(0, Number(amount) || 0) }))
    .filter((entry) => entry.amount > 0);
  if (!targetController || positiveEntries.length === 0) {
    return triggers;
  }

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permanentTriggers = detectCounterRemovedTriggers(permanent.card, permanent);
    for (const trigger of permanentTriggers) {
      if (trigger.targetFilter === 'self' && String(permanent.id || '') !== String(targetPermanent?.id || '')) {
        continue;
      }
      if (trigger.targetFilter !== 'self') {
        if (String(permanent.controller || '') !== targetController) continue;
        if (trigger.targetFilter !== 'permanent' && !targetTypeLine.includes(trigger.targetFilter)) continue;
      }

      const matchingEntries = positiveEntries.filter((entry) =>
        trigger.counterFilter === 'any' || entry.counterType === normalizeCounterType(trigger.counterFilter)
      );
      const countersRemoved = matchingEntries.reduce((sum, entry) => sum + entry.amount, 0);
      if (countersRemoved <= 0) {
        continue;
      }

      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId,
        String(trigger.oracleClause || trigger.effect || ''),
        permanent,
        {
          thatPermanent: targetPermanent,
          referencedPermanent: targetPermanent,
          countersRemoved,
        } as any,
      );
      if (ok === false) continue;

      triggers.push({
        ...trigger,
        countersRemoved,
        removedCounterType: trigger.counterFilter === 'any' ? matchingEntries[0]?.counterType || 'counter' : trigger.counterFilter,
      });
    }
  }

  return triggers;
}

export function queueCounterRemovedTriggers(
  ctx: GameContext,
  targetPermanent: any,
  targetPermanentId: string,
  removedDeltas: Record<string, number>,
): any[] {
  if (!targetPermanent || !targetPermanentId) {
    return [];
  }
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getCounterRemovedTriggers(ctx, targetPermanent, removedDeltas));
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
    const sourcePermanentSnapshot = snapshotPermanentForCounterTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
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
      triggeringPermanent: targetPermanentId,
      effectData: {
        targetPermanentId,
        targetPermanentName: String(targetPermanent?.card?.name || 'Permanent'),
        targetPermanentController: String(targetPermanent?.controller || ''),
        targetPermanentTypeLine: String(targetPermanent?.card?.type_line || ''),
        countersRemoved: trigger.countersRemoved,
        counterType: trigger.removedCounterType,
      },
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          triggeringPermanent: targetPermanentId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[counterTrigger] Failed to persist generic counter-removed trigger:', err);
      }
    }
  }

  return queued;
}