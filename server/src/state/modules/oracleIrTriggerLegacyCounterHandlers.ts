import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export function applyRetiredTriggerLegacyDistributeCounters(_params: {  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}): boolean {
  return false;
}

export function applyRetiredTriggerLegacyChosenTypeCounterEachCreature(  _params: {
    readonly ctx: GameContext;
    readonly controller: PlayerID;
    readonly sourceName: string;
    readonly desc: string;
    readonly triggerItem: any;
  },
): boolean {
  return false;
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

  return false;
}
