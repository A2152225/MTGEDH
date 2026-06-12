import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { queueMayAbilityStep } from '../../socket/may-ability-prompts.js';
import { cardMatchesChosenTypeFilter, parseChosenTypeTopCardRevealToHand } from './chosen-creature-type.js';
import { cardHasCreatureType } from '../creatureTypeNow.js';
import { drawCards as drawCardsFromZone } from './zones.js';
import { millCardsFromLibrary } from './triggerLibraryMillUtils.js';
import { debug } from '../../utils/debug.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyLibraryParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyRetiredTriggerLegacyChosenTypeTopCardReveal(
  params: TriggerLegacyLibraryParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const chosenTypeTopReveal = parseChosenTypeTopCardRevealToHand(params.desc);
  if (!chosenTypeTopReveal) {
    return false;
  }

  const sourcePermanentId = String(params.triggerItem?.source || params.triggerItem?.permanentId || '');
  const sourcePermanent = (params.state.battlefield || []).find((perm: any) => perm && String(perm.id) === sourcePermanentId);
  const chosenType = String(
    params.triggerItem?.chosenCreatureType || (sourcePermanent as any)?.chosenCreatureType || '',
  ).trim();
  const lib = params.ctx.libraries?.get(params.controller) || [];
  if (!chosenType || lib.length === 0) {
    return true;
  }

  const topCard = lib[0];
  if (!cardMatchesChosenTypeFilter(topCard, chosenType, chosenTypeTopReveal.creatureCardsOnly)) {
    debug(2, `[executeTriggerEffect] ${params.sourceName}: top card is not a ${chosenType} match`);
    return true;
  }

  const gameId = String((params.ctx as any).gameId || 'unknown');
  const io = (params.ctx as any).io;
  const putIntoHand = async () => {
    const drawn = drawCardsFromZone(params.ctx, params.controller, 1);
    debug(
      2,
      `[executeTriggerEffect] ${params.sourceName}: ${params.controller} revealed ${topCard?.name || 'a card'} (${chosenType}) and put it into hand (${drawn.length} drawn)`,
    );
  };
  const putIntoGraveyard = async () => {
    const milled = millCardsFromLibrary(params.state, params.controller, 1, params.ctx);
    debug(
      2,
      `[executeTriggerEffect] ${params.sourceName}: ${params.controller} put ${topCard?.name || 'a card'} into graveyard (${milled} milled)`,
    );
  };

  if (io && gameId !== 'unknown' && !(params.ctx as any).isReplaying) {
    queueMayAbilityStep(
      io,
      gameId,
      { state: params.state },
      String(params.controller),
      params.sourceName,
      `put ${topCard?.name || 'the top card'} into your hand`,
      params.desc,
      putIntoHand,
      chosenTypeTopReveal.allowGraveyardIfDeclined ? putIntoGraveyard : undefined,
    );
  } else {
    void putIntoHand();
  }
  return true;
}

export function applyRetiredTriggerLegacyRevealTopCreatureOfChosenType(
  params: TriggerLegacyLibraryParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (
    !params.desc.includes('reveal the top card of your library')
    || !params.desc.includes('creature card of the chosen type')
  ) {
    return false;
  }

  const sourcePermanentId = String(params.triggerItem?.source || params.triggerItem?.permanentId || '');
  const sourcePermanent = (params.state.battlefield || []).find((perm: any) => perm && String(perm.id) === sourcePermanentId);
  const chosenType = String(
    params.triggerItem?.chosenCreatureType || (sourcePermanent as any)?.chosenCreatureType || '',
  ).trim();
  const lib = params.ctx.libraries?.get(params.controller) || [];
  if (!chosenType || lib.length === 0) {
    return true;
  }

  const topCard = lib[0];
  const typeLine = String(topCard?.type_line || '').toLowerCase();
  if (typeLine.includes('creature') && cardHasCreatureType(topCard, chosenType)) {
    const drawn = drawCardsFromZone(params.ctx, params.controller, 1);
    debug(
      2,
      `[executeTriggerEffect] ${params.sourceName}: ${params.controller} revealed ${topCard?.name || 'a creature'} (${chosenType}) and put it into hand (${drawn.length} drawn)`,
    );
  } else {
    const milled = millCardsFromLibrary(params.state, params.controller, 1, params.ctx);
    debug(
      2,
      `[executeTriggerEffect] ${params.sourceName}: ${params.controller} revealed ${topCard?.name || 'a card'} (not ${chosenType}) and put it into graveyard (${milled} milled)`,
    );
  }
  return true;
}
