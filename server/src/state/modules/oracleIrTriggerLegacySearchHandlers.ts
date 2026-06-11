import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { debug } from '../../utils/debug.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { checkOpponentHasMoreLands } from './stackLandCountUtils.js';
import { enqueueLibrarySearchStep, type EnqueueLibrarySearchStepFn } from './triggerLibrarySearchUtils.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export type { EnqueueLibrarySearchStepFn };

export interface TriggerLegacySearchParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}

export function applyRetiredTriggerLegacyProteanHulkSearch(
  params: TriggerLegacySearchParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const proteanHulkMatch = params.desc.match(
    /search your library for any number of creature cards with total mana value (\d+) or less and put them onto the battlefield/i,
  );
  if (!proteanHulkMatch) {
    return false;
  }

  const maxTotalManaValue = Math.max(0, Number(proteanHulkMatch[1] || 0));
  enqueueLibrarySearchStep(params.ctx, params.controller, {
    sourceId: String(params.triggerItem?.source || params.triggerItem?.permanentId || ''),
    source: params.sourceName,
    description: `${params.sourceName}: Search your library for any number of creature cards with total mana value ${maxTotalManaValue} or less.`,
    searchFor: `any number of creature cards with total mana value ${maxTotalManaValue} or less`,
    destination: 'battlefield',
    optional: true,
    maxSelections: Number.MAX_SAFE_INTEGER,
    minSelections: 0,
    reveal: true,
    shuffleAfter: true,
    filter: { types: ['creature'] },
    maxTotalManaValue,
    persistLibrarySearchResolve: true,
    persistLibrarySearchResolveReason: 'stack_resolution',
  });

  debug(2, `[executeTriggerEffect] ${params.sourceName}: queued Protean Hulk search with total mana value cap ${maxTotalManaValue}`);
  return true;
}

export function applyRetiredTriggerLegacyGenericSearchLibrary(
  _params: TriggerLegacySearchParams,
): boolean {
  return false;
}

function summarizeLibraryCard(card: any): any {
  return {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    imageUrl: card.image_uris?.normal || card.image_uris?.small,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
  };
}

export function applyRetiredTriggerLegacyRevealUntilEquipment(
  params: TriggerLegacySearchParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  if (
    !params.desc.includes('reveal cards from the top of your library until you reveal an equipment card')
    || !params.desc.includes('put that card onto the battlefield attached to that creature')
    || !params.desc.includes('put the rest on the bottom of your library in a random order')
  ) {
    return false;
  }

  const effectData = params.triggerItem?.effectData || {};
  const attachTargetId = String(effectData?.exertedPermanentId || '').trim();
  const lib = ((params.ctx as any).libraries as Map<string, any[]>)?.get(params.controller) || [];
  const availableCards: any[] = [];
  const nonSelectableCards: any[] = [];

  for (const card of lib) {
    const summary = summarizeLibraryCard(card);
    const typeLine = String(card?.type_line || '').toLowerCase();
    if (availableCards.length === 0 && typeLine.includes('equipment')) {
      availableCards.push(summary);
      break;
    }
    nonSelectableCards.push(summary);
  }

  queueResolveTopOfStackPrompt(params.ctx, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: params.controller as any,
    description: `${params.sourceName}: Reveal cards from the top of your library until you reveal an Equipment card. Put that card onto the battlefield attached to that creature, then put the rest on the bottom of your library in a random order.`,
    mandatory: availableCards.length > 0,
    sourceId: String(params.triggerItem?.source || params.triggerItem?.permanentId || '').trim() || undefined,
    sourceName: params.sourceName,
    searchCriteria: 'Equipment card',
    minSelections: availableCards.length > 0 ? 1 : 0,
    maxSelections: availableCards.length > 0 ? 1 : 0,
    destination: 'battlefield',
    reveal: true,
    shuffleAfter: false,
    availableCards,
    nonSelectableCards,
    revealedCards: [...nonSelectableCards, ...availableCards],
    remainderDestination: 'bottom',
    remainderRandomOrder: true,
    persistLibrarySearchResolve: true,
    persistLibrarySearchResolveReason: 'stack_resolution',
    ...(attachTargetId ? { attachSelectedEquipmentToPermanentId: attachTargetId } : null),
  } as any);
  debug(2, `[executeTriggerEffect] Queued reveal-until-equipment search for ${params.sourceName} with ${availableCards.length} matching card(s)`);
  return true;
}
