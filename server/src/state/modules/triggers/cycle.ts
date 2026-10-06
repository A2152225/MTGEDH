/**
 * Cycle triggers (CR 702.29): "When you cycle this card, ..." on the cycled card itself and
 * "Whenever you / a player / an opponent cycle(s) [or discard(s)] a card, ..." on permanents.
 *
 * Cycling puts its ability on the stack after paying its costs; these triggers then go on the
 * stack above it, so they resolve first. A trigger from the cycled card carries the X paid for
 * cycling as its xValue (Shark Typhoon: "create an X/X blue Shark creature token").
 *
 * Public entry symbols: detectCycleTriggers, queueCycleTriggeredAbilities.
 */

import type { GameContext } from '../../context.js';
import { appendEvent } from '../../../db/index.js';
import { uid } from '../../utils.js';
import { debugWarn } from '../../../utils/debug.js';
import { timingTriggerEffect } from './timing-effect-extraction.js';
import { orderTriggersByAPNAP } from './ordering.js';
import {
  hasUnsupportedTargetRequirement,
  inferGenericTriggeredAbilityTargetMetadata,
} from './target-metadata.js';

export type CycleTriggerScope = 'self' | 'you' | 'opponent' | 'any_player';

export interface CycleTrigger {
  sourceId: string;
  cardName: string;
  controllerId: string;
  scope: CycleTriggerScope;
  effect: string;
  mandatory: boolean;
}

function escapeRegex(text: string): string {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selfReferenceAlternatives(cardName: string): string {
  const names = new Set<string>(['this card']);
  const full = String(cardName || '').trim();
  if (full) {
    names.add(full);
    const front = full.split('//')[0]?.trim();
    if (front) names.add(front);
  }
  return [...names].map(escapeRegex).join('|');
}

const BATTLEFIELD_CYCLE_PATTERNS: ReadonlyArray<{ pattern: RegExp; scope: Exclude<CycleTriggerScope, 'self'> }> = [
  { pattern: /\bwhenever you cycle(?: or discard)? (?:a|an|another|one or more) (?:other )?cards?,\s*([^\n]+)/gi, scope: 'you' },
  { pattern: /\bwhenever a player cycles(?: or discards)? (?:a|an|another|one or more) cards?,\s*([^\n]+)/gi, scope: 'any_player' },
  { pattern: /\bwhenever an opponent cycles(?: or discards)? (?:a|an|another|one or more) cards?,\s*([^\n]+)/gi, scope: 'opponent' },
];

function effectFromMatch(oracleText: string, match: RegExpMatchArray): string {
  return String(timingTriggerEffect(oracleText, match, 1) || '').trim();
}

/**
 * Cycle triggers on one object. `asCycledCard` reads "When you cycle this card" abilities
 * (the card being cycled); otherwise reads the battlefield "whenever ... cycle(s)" abilities.
 */
export function detectCycleTriggers(card: any, options: { sourceId: string; controllerId: string; asCycledCard: boolean }): CycleTrigger[] {
  const oracleText = String(card?.oracle_text || '');
  if (!oracleText || !/\bcycl/i.test(oracleText)) return [];
  const cardName = String(card?.name || 'Unknown');
  const base = { sourceId: options.sourceId, cardName, controllerId: options.controllerId };
  const triggers: CycleTrigger[] = [];
  const pushTrigger = (scope: CycleTriggerScope, effect: string) => {
    if (!effect || triggers.some((t) => t.scope === scope && t.effect === effect)) return;
    triggers.push({ ...base, scope, effect, mandatory: !/^you may\b/i.test(effect) });
  };

  if (options.asCycledCard) {
    const selfPattern = new RegExp(`\\bwhen(?:ever)? you cycle (?:${selfReferenceAlternatives(cardName)}),\\s*([^\\n]+)`, 'gi');
    for (const match of oracleText.matchAll(selfPattern)) {
      pushTrigger('self', effectFromMatch(oracleText, match));
    }
    return triggers;
  }

  for (const { pattern, scope } of BATTLEFIELD_CYCLE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of oracleText.matchAll(pattern)) {
      pushTrigger(scope, effectFromMatch(oracleText, match));
    }
  }
  return triggers;
}

function collectCycleTriggers(ctx: GameContext, cyclingPlayerId: string, cycledCard: any): CycleTrigger[] {
  const triggers: CycleTrigger[] = [
    ...detectCycleTriggers(cycledCard, {
      sourceId: String(cycledCard?.id || ''),
      controllerId: cyclingPlayerId,
      asCycledCard: true,
    }),
  ];

  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const controllerId = String(permanent.controller || '');
    for (const trigger of detectCycleTriggers(permanent.card, {
      sourceId: String(permanent.id || ''),
      controllerId,
      asCycledCard: false,
    })) {
      if (trigger.scope === 'you' && controllerId !== cyclingPlayerId) continue;
      if (trigger.scope === 'opponent' && controllerId === cyclingPlayerId) continue;
      triggers.push(trigger);
    }
  }
  return triggers;
}

/**
 * Put the cycle triggers for `cycledCard` on the stack (call after the cycling ability is on it).
 * Returns the queued stack items.
 */
export function queueCycleTriggeredAbilities(
  ctx: GameContext,
  cyclingPlayerId: string,
  cycledCard: any,
  options: { xValue?: number } = {},
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!cyclingPlayerId || !cycledCard) return [];

  const triggers = orderTriggersByAPNAP(ctx, collectCycleTriggers(ctx, String(cyclingPlayerId), cycledCard));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const cycledCardId = String(cycledCard?.id || '');
  const cycledCardName = String(cycledCard?.name || 'that card');
  const xValue = typeof options.xValue === 'number' && Number.isFinite(options.xValue)
    ? Math.max(0, Math.floor(options.xValue))
    : undefined;
  const queued: any[] = [];

  for (const trigger of triggers) {
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(trigger.effect);
    if (hasUnsupportedTargetRequirement(targetMetadata)) continue;

    const fromCycledCard = trigger.scope === 'self';
    const triggerId = uid('trigger');
    const sourcePermanent = fromCycledCard || !Array.isArray(stateAny.battlefield)
      ? undefined
      : stateAny.battlefield.find((permanent: any) => String(permanent?.id || '') === trigger.sourceId);
    const card = fromCycledCard ? { ...cycledCard } : sourcePermanent?.card ? { ...sourcePermanent.card } : undefined;
    const triggerType = fromCycledCard ? 'cycle_this_card' : `cycle_${trigger.scope}`;
    const effectData = {
      cyclingPlayerId: String(cyclingPlayerId),
      cycledCardId,
      cycledCardName,
      ...(typeof xValue === 'number' && fromCycledCard ? { cyclingXValue: xValue } : null),
    };
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.sourceId || triggerId,
      permanentId: trigger.sourceId || triggerId,
      sourceName: trigger.cardName,
      description: trigger.effect,
      effect: trigger.effect,
      ...targetMetadata,
      ...(card ? { card } : null),
      triggerType,
      triggeringPlayer: String(cyclingPlayerId),
      mandatory: trigger.mandatory,
      ...(typeof xValue === 'number' && fromCycledCard ? { xValue } : null),
      effectData,
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number(stateAny.seq ?? (ctx as any).seq?.value ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: stackItem.source,
          permanentId: stackItem.permanentId,
          sourceName: stackItem.sourceName,
          controllerId: stackItem.controller,
          description: trigger.effect,
          triggerType,
          effect: trigger.effect,
          ...targetMetadata,
          mandatory: trigger.mandatory,
          triggeringPlayer: String(cyclingPlayerId),
          ...(typeof stackItem.xValue === 'number' ? { xValue: stackItem.xValue } : null),
          effectData,
          ...(card ? { card } : null),
        });
      } catch (err) {
        debugWarn(1, '[cycle] appendEvent(pushTriggeredAbility) failed:', err);
      }
    }
  }

  return queued;
}
