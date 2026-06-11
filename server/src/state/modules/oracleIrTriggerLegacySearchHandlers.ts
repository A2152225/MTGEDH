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
  params: TriggerLegacySearchParams,
): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const searchLibraryMatch = params.desc.match(/(?:you may )?search your library for (?:a|an|up to (?:one|two|three|\d+)) ([^,\.]+)/i);
  if (!searchLibraryMatch) {
    return false;
  }

  const searchFor = searchLibraryMatch[1].trim();
  const isOptional = params.desc.includes('you may search');

  let destination = 'hand';
  let entersTapped = false;
  if (params.desc.includes('put it onto the battlefield') || params.desc.includes('put that card onto the battlefield')
    || params.desc.includes('put it on the battlefield') || params.desc.includes('battlefield under your control')) {
    destination = 'battlefield';
    if (params.desc.includes('tapped')) {
      entersTapped = true;
    }
  } else if (params.desc.includes('put it on top of your library') || params.desc.includes('put that card on top')) {
    destination = 'top';
  }

  const filter: {
    types?: string[];
    subtypes?: string[];
    name?: string;
    maxPower?: number;
    maxToughness?: number;
    maxCmc?: number;
    minCmc?: number;
  } = {};
  const subtypes: string[] = [];

  const basicLandTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  for (const landType of basicLandTypes) {
    if (searchFor.toLowerCase().includes(landType)) {
      subtypes.push(landType.charAt(0).toUpperCase() + landType.slice(1));
    }
  }

  const cardTypes = ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'];
  const types: string[] = [];
  for (const cardType of cardTypes) {
    if (searchFor.toLowerCase().includes(cardType)) {
      types.push(cardType);
    }
  }

  const powerMatch = searchFor.match(/power\s*(\d+)\s*or\s*(less|greater)/i);
  if (powerMatch) {
    const value = parseInt(powerMatch[1], 10);
    const direction = powerMatch[2].toLowerCase();
    if (direction === 'less') {
      filter.maxPower = value;
    }
  }

  const toughnessMatch = searchFor.match(/toughness\s*(\d+)\s*or\s*(less|greater)/i);
  if (toughnessMatch) {
    const value = parseInt(toughnessMatch[1], 10);
    const direction = toughnessMatch[2].toLowerCase();
    if (direction === 'less') {
      filter.maxToughness = value;
    }
  }

  const cmcLessMatch = searchFor.match(/(?:mana value|converted mana cost|cmc)\s*(\d+)\s*or\s*(?:less|fewer)/i);
  if (cmcLessMatch) {
    filter.maxCmc = parseInt(cmcLessMatch[1], 10);
  }

  const cmcGreaterMatch = searchFor.match(/(?:mana value|converted mana cost|cmc)\s*(\d+)\s*or\s*(?:greater|more)/i);
  if (cmcGreaterMatch) {
    filter.minCmc = parseInt(cmcGreaterMatch[1], 10);
  }

  if (types.length > 0) filter.types = types;
  if (subtypes.length > 0) filter.subtypes = subtypes;

  const hasLandCondition = params.desc.match(/if (?:an|any) opponent controls more lands than you/i);
  if (hasLandCondition) {
    const { myLandCount, anyOpponentHasMoreLands } = checkOpponentHasMoreLands(params.state, params.controller);

    if (!anyOpponentHasMoreLands) {
      debug(2, `[executeTriggerEffect] ${params.sourceName}: Condition NOT met - ${params.controller} has ${myLandCount} lands, no opponent has more`);
      return true;
    }

    debug(2, `[executeTriggerEffect] ${params.sourceName}: Condition met - opponent has more lands than ${params.controller} (${myLandCount} lands)`);
  }

  const gameId = (params.ctx as any).gameId || 'unknown';
  const lib = ((params.ctx as any).libraries as Map<string, any[]>)?.get(params.controller) || [];

  if (lib.length === 0) {
    debug(2, `[executeTriggerEffect] ${params.sourceName}: Player ${params.controller} has empty library, skipping search`);
    return true;
  }

  const filterAny = filter as any;
  const availableCards: any[] = [];
  for (const card of lib) {
    let matches = true;

    if (filterAny.types && filterAny.types.length > 0) {
      const typeLine = (card.type_line || '').toLowerCase();
      matches = filterAny.types.some((type: string) => typeLine.includes(type.toLowerCase()));
    }

    if (matches && filterAny.subtypes && filterAny.subtypes.length > 0) {
      const typeLine = (card.type_line || '').toLowerCase();
      matches = filterAny.subtypes.some((subtype: string) => typeLine.includes(subtype.toLowerCase()));
    }

    if (matches && filterAny.supertypes && filterAny.supertypes.length > 0) {
      const typeLine = (card.type_line || '').toLowerCase();
      matches = filterAny.supertypes.some((supertype: string) => typeLine.includes(supertype.toLowerCase()));
    }

    if (matches && filterAny.colors && filterAny.colors.length > 0) {
      const cardColors = card.colors || [];
      matches = filterAny.colors.some((color: string) => cardColors.includes(color));
    }

    if (matches && typeof filterAny.maxManaValue === 'number') {
      matches = (card.cmc || 0) <= filterAny.maxManaValue;
    }

    if (matches && typeof filterAny.minCmc === 'number') {
      matches = (card.cmc || 0) >= filterAny.minCmc;
    }

    if (matches && typeof filterAny.maxCmc === 'number') {
      matches = (card.cmc || 0) <= filterAny.maxCmc;
    }

    const power = Number.parseInt(String(card.power ?? ''), 10);
    if (matches && typeof filterAny.minPower === 'number' && Number.isFinite(power)) {
      matches = power >= filterAny.minPower;
    }

    if (matches && typeof filterAny.maxPower === 'number' && Number.isFinite(power)) {
      matches = power <= filterAny.maxPower;
    }

    const toughness = Number.parseInt(String(card.toughness ?? ''), 10);
    if (matches && typeof filterAny.minToughness === 'number' && Number.isFinite(toughness)) {
      matches = toughness >= filterAny.minToughness;
    }

    if (matches && typeof filterAny.maxToughness === 'number' && Number.isFinite(toughness)) {
      matches = toughness <= filterAny.maxToughness;
    }

    if (matches) {
      availableCards.push({
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        imageUrl: card.image_uris?.normal,
        mana_cost: card.mana_cost,
        cmc: card.cmc,
        colors: card.colors,
        power: card.power,
        toughness: card.toughness,
        loyalty: card.loyalty,
      });
    }
  }

  debug(2, `[executeTriggerEffect] ${params.sourceName}: Creating library search for ${params.controller}, ${availableCards.length} matching cards`);

  let stepDescription = searchFor || 'Search your library';
  if (destination === 'battlefield') {
    stepDescription += entersTapped ? ' (enters tapped)' : ' (enters untapped)';
  }

  const shuffleAfter = params.desc.includes('shuffle');
  const isReplaying = !!(params.ctx as any).isReplaying;
  if (!isReplaying) {
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: params.controller,
      description: stepDescription,
      mandatory: !isOptional,
      sourceName: params.sourceName,
      searchCriteria: searchFor || 'any card',
      minSelections: 0,
      maxSelections: 1,
      destination,
      reveal: true,
      shuffleAfter,
      availableCards,
      entersTapped,
      remainderDestination: 'shuffle',
      remainderRandomOrder: true,
    });

    debug(2, `[executeTriggerEffect] ${params.sourceName} trigger: ${params.controller} may search for ${searchFor} (destination: ${destination}, filter: ${JSON.stringify(filter)})`);
  } else {
    debug(2, `[executeTriggerEffect] ${params.sourceName}: skipping library search during replay`);
  }

  return true;
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
