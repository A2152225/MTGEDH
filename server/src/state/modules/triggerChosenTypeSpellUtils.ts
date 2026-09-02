import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { isCreatureNow, permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import {
  cardMatchesChosenTypeFilter,
  countControlledCreaturesOfChosenType,
  isMetallicMimicOracle,
  parseChosenTypeTopCardRevealToHand,
} from './chosen-creature-type.js';
import { millCardsFromLibrary } from './triggerLibraryMillUtils.js';
import { drawCards as drawCardsFromZone, drawCardsByIds } from './zones.js';

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

export function resolveChosenTypeTopCardRevealToHand(
  ctx: GameContext,
  controller: PlayerID,
  chosenType: string,
  effectText: string,
  sourceName: string,
): boolean {
  const parsed = parseChosenTypeTopCardRevealToHand(effectText);
  if (!parsed || !String(chosenType || '').trim()) return false;

  const library = (ctx as any).libraries?.get?.(controller)
    || (ctx as any).state?.zones?.[controller]?.library
    || [];
  const topCard = Array.isArray(library) ? library[0] : undefined;
  if (!topCard) return true;

  if (!cardMatchesChosenTypeFilter(topCard, chosenType, parsed.creatureCardsOnly)) {
    if (parsed.otherwiseGraveyard) {
      millCardsFromLibrary((ctx as any).state, controller, 1, ctx, { skipEventPersistence: true });
    }
    debug(2, `[resolveChosenTypeTopCardRevealToHand] ${sourceName}: top card is not a ${chosenType}`);
    return true;
  }

  const cardId = String(topCard.id || '').trim();
  if (!cardId) return true;
  drawCardsByIds(ctx, controller, [cardId]);
  debug(2, `[resolveChosenTypeTopCardRevealToHand] ${sourceName}: put ${topCard.name || cardId} into hand`);
  return true;
}
