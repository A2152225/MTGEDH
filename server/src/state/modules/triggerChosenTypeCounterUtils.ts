import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { isCreatureNow, permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import { debug } from '../../utils/debug.js';

export function resolveChosenTypeCounterEachCreature(
  ctx: GameContext,
  controller: PlayerID,
  chosenType: string,
  sourceName: string,
): number {
  const state = (ctx as any).state;
  const battlefield = state?.battlefield || [];
  let count = 0;
  for (const perm of battlefield) {
    if (!perm || perm.controller !== controller) continue;
    if (!isCreatureNow(perm)) continue;
    if (!permanentHasCreatureTypeNow(perm, chosenType)) continue;
    perm.counters = perm.counters || {};
    perm.counters['+1/+1'] = Number(perm.counters['+1/+1'] || 0) + 1;
    count += 1;
  }
  debug(2, `[resolveChosenTypeCounterEachCreature] ${sourceName}: ${controller} put +1/+1 counters on ${count} ${chosenType} creature(s)`);
  return count;
}
