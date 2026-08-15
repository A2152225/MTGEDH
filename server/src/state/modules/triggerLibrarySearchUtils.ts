import { getLibrarySearchTypeLine } from '../../../../shared/src/cardFactory.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { calculateVariablePT } from '../utils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { debug } from '../../utils/debug.js';

export interface EnqueueLibrarySearchStepOptions {
  description?: string;
  searchFor?: string;
  destination?: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split';
  sourceId?: string;
  tapped?: boolean;
  optional?: boolean;
  source?: string;
  shuffleAfter?: boolean;
  filter?: any;
  maxSelections?: number;
  minSelections?: number;
  reveal?: boolean;
  remainderDestination?: string;
  splitDestination?: boolean;
  toBattlefield?: number;
  toHand?: number | 'rest';
  entersTapped?: boolean;
  lifeLoss?: number;
  maxTotalManaValue?: number;
  persistLibrarySearchResolve?: boolean;
  persistLibrarySearchResolveReason?: string;
  persistLibrarySearchResolveAbilityId?: string;
  chosenTypeBattlefieldIfPaid?: {
    chosenType: string;
    additionalCostPaid: boolean;
  };
}

export type EnqueueLibrarySearchStepFn = (
  ctx: GameContext,
  controller: PlayerID,
  options: EnqueueLibrarySearchStepOptions,
) => void;

export function enqueueLibrarySearchStep(
  ctx: GameContext,
  controller: PlayerID,
  options: EnqueueLibrarySearchStepOptions,
): void {
  const gameId = (ctx as any).gameId || 'unknown';
  const lib = ctx.libraries?.get(controller) || [];
  if (!lib.length) {
    debug(2, `[enqueueLibrarySearchStep] Player ${controller} has empty library, skipping search`);
    return;
  }

  const {
    description = options.searchFor || 'Search your library',
    searchFor = 'a card',
    destination = 'hand',
    sourceId,
    tapped = false,
    optional = false,
    source = 'Library Search',
    shuffleAfter = true,
    filter = {},
    maxSelections = 1,
    minSelections = optional ? 0 : 1,
    reveal = true,
    remainderDestination = 'shuffle',
    splitDestination = false,
    toBattlefield = 0,
    toHand = 0,
    entersTapped = tapped,
    lifeLoss,
    maxTotalManaValue,
    persistLibrarySearchResolve = true,
    persistLibrarySearchResolveReason = 'stack_resolution',
    persistLibrarySearchResolveAbilityId,
    chosenTypeBattlefieldIfPaid,
  } = options;

  const allCards = lib.map((card: any) => ({
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: (card as any).power,
    toughness: (card as any).toughness,
    loyalty: (card as any).loyalty,
  }));

  const gameStateForCDA = {
    battlefield: (ctx as any).state?.battlefield || [],
    zones: (ctx as any).state?.zones || {},
    players: (ctx as any).state?.players || {},
    life: (ctx as any).state?.life || {},
    manaPool: (ctx as any).state?.manaPool || {},
  };

  const availableCards = allCards.filter((card: any) => {
    let matches = true;
    const typeLine = getLibrarySearchTypeLine(card).toLowerCase();

    if (filter.types && filter.types.length > 0) {
      matches = filter.types.some((type: string) => typeLine.includes(type.toLowerCase()));
    }

    if (matches && filter.allTypes && filter.allTypes.length > 0) {
      matches = filter.allTypes.every((requiredType: string) => typeLine.includes(String(requiredType || '').toLowerCase()));
    }

    if (matches && filter.subtypes && filter.subtypes.length > 0) {
      matches = filter.subtypes.some((subtype: string) => typeLine.includes(subtype.toLowerCase()));
    }

    if (matches && filter.supertypes && filter.supertypes.length > 0) {
      matches = filter.supertypes.every((supertype: string) => typeLine.includes(String(supertype).toLowerCase()));
    }

    if (matches && typeof filter.maxPower === 'number') {
      if (card.power !== undefined && card.power !== null) {
        const powerStr = String(card.power);
        const powerNum = parseInt(powerStr, 10);
        if (!isNaN(powerNum)) {
          matches = powerNum <= filter.maxPower;
        } else if (powerStr.includes('*')) {
          const cardWithOwner = { ...card, owner: controller, controller: controller };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.power <= filter.maxPower;
          }
        }
      }
    }

    if (matches && typeof filter.maxToughness === 'number') {
      if (card.toughness !== undefined && card.toughness !== null) {
        const toughnessStr = String(card.toughness);
        const toughnessNum = parseInt(toughnessStr, 10);
        if (!isNaN(toughnessNum)) {
          matches = toughnessNum <= filter.maxToughness;
        } else if (toughnessStr.includes('*')) {
          const cardWithOwner = { ...card, owner: controller, controller: controller };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.toughness <= filter.maxToughness;
          }
        }
      }
    }

    if (matches && typeof filter.maxCmc === 'number') {
      matches = (card.cmc || 0) <= filter.maxCmc;
    }

    if (matches && typeof filter.minCmc === 'number') {
      matches = (card.cmc || 0) >= filter.minCmc;
    }

    return matches;
  });

  const effectiveMaxSelections = Number.isFinite(maxSelections)
    ? Math.max(minSelections, Math.min(maxSelections, Math.max(availableCards.length, minSelections)))
    : Math.max(availableCards.length, minSelections);

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: controller as PlayerID,
    sourceId,
    description,
    mandatory: !optional,
    sourceName: source,
    searchCriteria: searchFor,
    minSelections,
    maxSelections: effectiveMaxSelections,
    maxTotalManaValue,
    destination,
    reveal,
    shuffleAfter,
    availableCards,
    entersTapped,
    remainderDestination,
    remainderRandomOrder: true,
    splitDestination,
    toBattlefield,
    toHand,
    filter,
    lifeLoss,
    persistLibrarySearchResolve,
    persistLibrarySearchResolveReason,
    persistLibrarySearchResolveAbilityId,
    ...(chosenTypeBattlefieldIfPaid
      ? { chosenTypeBattlefieldIfPaid }
      : {}),
  });
}
