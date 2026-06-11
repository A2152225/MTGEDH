import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { parseChosenTypeCounterEachCreatureEffect } from './chosen-creature-type.js';
import { debug } from '../../utils/debug.js';
import { resolveChosenTypeCounterEachCreature } from './triggerChosenTypeCounterUtils.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function parseNumberWord(word: string | undefined, defaultValue = 1): number {
  if (!word) return defaultValue;
  const lower = word.toLowerCase();
  if (NUMBER_WORDS[lower] !== undefined) {
    return NUMBER_WORDS[lower];
  }
  const num = parseInt(lower, 10);
  return Number.isNaN(num) ? defaultValue : num;
}

export function applyRetiredTriggerLegacyChosenTypeCounterEachCreature(
  params: {
    readonly ctx: GameContext;
    readonly controller: PlayerID;
    readonly sourceName: string;
    readonly desc: string;
    readonly triggerItem: any;
  },
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (!parseChosenTypeCounterEachCreatureEffect(params.desc)) {
    return false;
  }

  const chosenType = String(params.triggerItem?.chosenCreatureType || '').trim();
  if (!chosenType) {
    return true;
  }

  resolveChosenTypeCounterEachCreature(params.ctx, params.controller, chosenType, params.sourceName);
  return true;
}

export function applyRetiredTriggerLegacyCounterInlineBatch(params: {
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const { controller, sourceName, desc, triggerItem, state } = params;

  const devotionCounterMatch = desc.match(/put (?:a number of|x) \+1\/\+1 counters? on (?:~|it|this creature) equal to (?:your devotion to (\w+)|(?:the number of )?([^.]+))/i);
  if (devotionCounterMatch) {
    const sourceId = triggerItem.source || triggerItem.permanentId;
    const devotionColor = devotionCounterMatch[1]?.toLowerCase();
    const otherScaling = devotionCounterMatch[2]?.trim().toLowerCase();

    let counterCount = 0;

    if (devotionColor) {
      const battlefield = state.battlefield || [];
      const colorSymbol = devotionColor === 'white' ? 'W' :
                          devotionColor === 'blue' ? 'U' :
                          devotionColor === 'black' ? 'B' :
                          devotionColor === 'red' ? 'R' :
                          devotionColor === 'green' ? 'G' : '';

      for (const perm of battlefield) {
        if (!perm || perm.controller !== controller) continue;
        const manaCost = perm.card?.mana_cost || '';
        const matches = manaCost.match(new RegExp(`\\{${colorSymbol}\\}`, 'g'));
        if (matches) {
          counterCount += matches.length;
        }
      }
      debug(2, `[executeTriggerEffect] ${sourceName}: Devotion to ${devotionColor} = ${counterCount}`);
    } else if (otherScaling) {
      const battlefield = state.battlefield || [];

      if (otherScaling.includes('artifact') && otherScaling.includes('you control')) {
        counterCount = battlefield.filter((p: any) =>
          p?.controller === controller && (p.card?.type_line || '').toLowerCase().includes('artifact')
        ).length;
      } else if (otherScaling.includes('creature') && otherScaling.includes('you control')) {
        counterCount = battlefield.filter((p: any) =>
          p?.controller === controller && (p.card?.type_line || '').toLowerCase().includes('creature')
        ).length;
      } else if (otherScaling.includes('land') && otherScaling.includes('you control')) {
        counterCount = battlefield.filter((p: any) =>
          p?.controller === controller && (p.card?.type_line || '').toLowerCase().includes('land')
        ).length;
      }
      debug(2, `[executeTriggerEffect] ${sourceName}: Scaling (${otherScaling}) = ${counterCount}`);
    }

    if (sourceId && counterCount > 0) {
      const perm = (state.battlefield || []).find((p: any) => p?.id === sourceId);
      if (perm) {
        perm.counters = perm.counters || {};
        perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + counterCount;
        debug(2, `[executeTriggerEffect] Added ${counterCount} +1/+1 counter(s) to ${perm.card?.name || perm.id} (scaling effect)`);
      }
    }
    return true;
  }

  const putCounterOnTargetMatch = desc.match(/put (?:a|an|one|two|three|four|five|(\d+)) \+1\/\+1 counters? on (?:up to (?:one|two|three|\d+) )?(?:target|each of up to \w+ target) creatures?/i);
  if (putCounterOnTargetMatch && (triggerItem as any).targets?.length > 0) {
    const targets = (triggerItem as any).targets || [];
    const battlefield = state.battlefield || [];
    const countMatch = desc.match(/put (a|an|one|two|three|four|five|\d+) \+1\/\+1/i);
    const counterCount = parseNumberWord(countMatch?.[1], 1);

    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((p: any) => p.id === targetId);

      if (targetCreature) {
        targetCreature.counters = targetCreature.counters || {};
        targetCreature.counters['+1/+1'] = (targetCreature.counters['+1/+1'] || 0) + counterCount;
        debug(2, `[executeTriggerEffect] Added ${counterCount} +1/+1 counter(s) to ${targetCreature.card?.name || targetId}`);
      }
    }
    return true;
  }

  const putCounterOnSelfMatch = desc.match(/put (a|an|\d+) \+1\/\+1 counters? on (?:~|it|this creature)/i);
  if (putCounterOnSelfMatch) {
    const counterCount = parseNumberWord(putCounterOnSelfMatch[1], 1);
    const sourceId = triggerItem.source || triggerItem.permanentId;

    if (sourceId) {
      const perm = (state.battlefield || []).find((p: any) => p?.id === sourceId);
      if (perm) {
        perm.counters = perm.counters || {};
        perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + counterCount;
        debug(2, `[executeTriggerEffect] Added ${counterCount} +1/+1 counter(s) to ${perm.card?.name || perm.id}`);
      }
    }
    return true;
  }

  const selfNamedCounterMatch = desc.match(/put (a|an|one|two|three|four|five|\d+) \+1\/\+1 counters? on ([^.]+)/i);
  if (selfNamedCounterMatch) {
    const counterCount = parseNumberWord(selfNamedCounterMatch[1], 1);
    const namedTarget = String(selfNamedCounterMatch[2] || '').trim().toLowerCase();
    const sourceId = triggerItem.source || triggerItem.permanentId;
    const perm = sourceId
      ? (state.battlefield || []).find((p: any) => p?.id === sourceId)
      : null;
    const sourcePermanentNameLower = String(perm?.card?.name || triggerItem.sourceName || '').trim().toLowerCase();

    if (perm && sourcePermanentNameLower && namedTarget.includes(sourcePermanentNameLower)) {
      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + counterCount;
      debug(2, `[executeTriggerEffect] Added ${counterCount} +1/+1 counter(s) to ${perm.card?.name || perm.id}`);
      return true;
    }
  }

  return false;
}
