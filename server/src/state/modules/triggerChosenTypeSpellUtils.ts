import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { isCreatureNow, permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import { countControlledCreaturesOfChosenType, isMetallicMimicOracle } from './chosen-creature-type.js';
import { drawCards as drawCardsFromZone } from './zones.js';

export function applyMetallicMimicEntryBonus(ctx: GameContext, enteringPermanent: any, controller: PlayerID): void {
  if (!enteringPermanent || !isCreatureNow(enteringPermanent)) return;

  const battlefield = (ctx.state as any)?.battlefield || [];
  for (const source of battlefield) {
    if (!source || String(source.id || '') === String(enteringPermanent.id || '')) continue;
    const oracle = String(source?.card?.oracle_text || '');
    if (!isMetallicMimicOracle(oracle)) continue;
    const chosenType = String(source?.chosenCreatureType || '').trim();
    if (!chosenType) continue;
    if (!permanentHasCreatureTypeNow(enteringPermanent, chosenType)) continue;

    enteringPermanent.counters = enteringPermanent.counters || {};
    enteringPermanent.counters['+1/+1'] = Number(enteringPermanent.counters['+1/+1'] || 0) + 1;
    debug(
      2,
      `[applyMetallicMimicEntryBonus] ${enteringPermanent.card?.name || 'Creature'} enters with +1/+1 from Metallic Mimic (${chosenType})`,
    );
  }
}

export function resolveChosenTypeDrawPerCreature(
  ctx: GameContext,
  controller: PlayerID,
  chosenType: string,
  sourceName: string,
): number {
  const drawCount = countControlledCreaturesOfChosenType((ctx as any).state, controller, chosenType);
  if (drawCount <= 0) return 0;
  const drawn = drawCardsFromZone(ctx, controller, drawCount);
  debug(2, `[resolveChosenTypeDrawPerCreature] ${sourceName}: ${controller} drew ${drawn.length} card(s) for ${chosenType} creatures`);
  return drawn.length;
}
