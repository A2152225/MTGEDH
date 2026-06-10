import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionStepType } from '../resolution/index.js';
import { cardHasCreatureType } from '../creatureTypeNow.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { summarizeLibraryCard } from './oracleIrSpellLegacyKindredRevealUtils.js';

export function queueTopLibraryToHandSelectionPrompt(
  ctx: GameContext,
  controller: PlayerID,
  options: {
    sourceId?: string;
    sourceName: string;
    sourceImage?: string;
    description: string;
    lookCount: number;
    pickCount: number;
    remainderDestination: 'graveyard' | 'bottom';
    remainderRandomOrder?: boolean;
  },
): number {
  const lib = ctx.libraries?.get(controller) || [];
  const actualLookCount = Math.max(0, Math.min(Number(options.lookCount || 0), Array.isArray(lib) ? lib.length : 0));
  if (actualLookCount <= 0) {
    return 0;
  }

  const availableCards = lib.slice(0, actualLookCount).map((card: any) => summarizeLibraryCard(card));
  const actualPickCount = Math.max(0, Math.min(Number(options.pickCount || 0), availableCards.length));

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: controller,
    description: options.description,
    mandatory: actualPickCount > 0,
    sourceId: options.sourceId,
    sourceName: options.sourceName,
    sourceImage: options.sourceImage,
    searchCriteria: `Top ${actualLookCount} cards`,
    minSelections: actualPickCount,
    maxSelections: actualPickCount,
    destination: 'hand',
    reveal: false,
    shuffleAfter: false,
    availableCards,
    remainderDestination: options.remainderDestination,
    remainderRandomOrder: options.remainderRandomOrder === true,
    persistLibrarySearchResolve: true,
    persistLibrarySearchResolveReason: 'stack_resolution',
    contextValue: actualLookCount,
  } as any);

  return availableCards.length;
}

export function queueChosenTypeTopLibraryRevealPrompt(
  ctx: GameContext,
  controller: PlayerID,
  chosenType: string,
  options: {
    sourceId?: string;
    sourceName: string;
    sourceImage?: string;
    description: string;
    lookCount: number;
  },
): number {
  const lib = ctx.libraries?.get(controller) || [];
  const actualLookCount = Math.max(0, Math.min(Number(options.lookCount || 0), Array.isArray(lib) ? lib.length : 0));
  if (actualLookCount <= 0) {
    return 0;
  }

  const normalizedType = String(chosenType || '').trim();
  const availableCards = lib.slice(0, actualLookCount).map((card: any) => summarizeLibraryCard(card));
  const eligibleCount = availableCards.filter((card: any) => cardHasCreatureType(card, normalizedType)).length;

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: controller,
    description: options.description,
    mandatory: false,
    sourceId: options.sourceId,
    sourceName: options.sourceName,
    sourceImage: options.sourceImage,
    searchCriteria: `Top ${actualLookCount} cards (${normalizedType})`,
    minSelections: 0,
    maxSelections: eligibleCount,
    destination: 'hand',
    reveal: true,
    shuffleAfter: false,
    availableCards,
    remainderDestination: 'bottom',
    remainderRandomOrder: true,
    chosenTypeSelectionFilter: normalizedType,
    persistLibrarySearchResolve: true,
    persistLibrarySearchResolveReason: 'stack_resolution',
    contextValue: actualLookCount,
  } as any);

  return availableCards.length;
}

export function queueTopLibraryExileSelectionPrompt(
  ctx: GameContext,
  chooser: PlayerID,
  libraryOwner: PlayerID,
  options: {
    sourceId?: string;
    sourceName: string;
    sourceImage?: string;
    description: string;
    lookCount: number;
    pickCount: number;
    destinationFaceDown?: boolean;
    remainderDestination: 'graveyard' | 'bottom';
    remainderRandomOrder?: boolean;
    grantPlayableFromExileControllerId?: PlayerID;
    grantPlayableFromExileSpendManaAsThoughAnyType?: boolean;
  },
): number {
  const lib = ctx.libraries?.get(libraryOwner) || [];
  const actualLookCount = Math.max(0, Math.min(Number(options.lookCount || 0), Array.isArray(lib) ? lib.length : 0));
  if (actualLookCount <= 0) {
    return 0;
  }

  const availableCards = lib.slice(0, actualLookCount).map((card: any) => summarizeLibraryCard(card));
  const actualPickCount = Math.max(0, Math.min(Number(options.pickCount || 0), availableCards.length));

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: chooser,
    searchOwnerId: libraryOwner,
    description: options.description,
    mandatory: actualPickCount > 0,
    sourceId: options.sourceId,
    sourceName: options.sourceName,
    sourceImage: options.sourceImage,
    searchCriteria: `Top ${actualLookCount} cards`,
    minSelections: actualPickCount,
    maxSelections: actualPickCount,
    destination: 'exile',
    reveal: false,
    shuffleAfter: false,
    availableCards,
    remainderDestination: options.remainderDestination,
    remainderRandomOrder: options.remainderRandomOrder === true,
    destinationFaceDown: options.destinationFaceDown === true,
    grantPlayableFromExileToController: true,
    grantPlayableFromExileControllerId: options.grantPlayableFromExileControllerId || chooser,
    ...(options.grantPlayableFromExileSpendManaAsThoughAnyType === true
      ? { grantPlayableFromExileSpendManaAsThoughAnyType: true }
      : null),
    persistLibrarySearchResolve: true,
    persistLibrarySearchResolveReason: 'stack_resolution',
    contextValue: actualLookCount,
  } as any);

  return availableCards.length;
}
