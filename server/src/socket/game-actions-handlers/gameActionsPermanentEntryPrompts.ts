/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the prompts a permanent raises as it enters the battlefield -
 * creature-type choice, color choice, player choice, enchantment ETB triggers,
 * and the self-referential battlefield tutor search some permanents queue.
 *
 * Public entry symbols: runPostResolutionPermanentPromptChecks plus the
 * individual checkXForNewPermanents passes it drives.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { getAsEntersChoiceRequirements } from "../../state/modules/asEntersChoiceRequirements.js";
import { checkAsEntersCopyChoiceForNewPermanents } from "../../state/modules/asEntersCopyChoice.js";
import { detectETBTriggers } from "../../state/modules/triggered-abilities";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { oracleTextReferencesCard } from "../../state/utils";
import { debug } from "../../utils/debug.js";
import {
  applyCreatureTypeSelection,
  getDominantCreatureType,
  getOfferedCreatureTypesForSelection,
  isAIPlayer,
  requiresCreatureTypeSelection,
} from "../creature-type";
import { detectTutorEffect, parseSearchCriteria } from "../interaction";
import { filterLibraryCardsForSearch } from "../library-search.js";
import { detectETBPlayerSelection, requestPlayerSelection } from "../player-selection";

/**
 * Check newly entered permanents for creature type selection requirements
 * and request selection from the player if needed.
 */
export function checkCreatureTypeSelectionForNewPermanents(
  io: Server,
  game: any,
  gameId: string
): void {
  const battlefield = game.state?.battlefield || [];
  const queue = ResolutionQueueManager.getQueue(gameId);
  const morophonChosenType = ((game.state as any)?.morophonChosenType || {}) as Record<string, string>;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    // Resume/replay may leave the choice on the card or Morophon mirror map only.
    const existingType = String(
      permanent.chosenCreatureType
      || permanent.card?.chosenCreatureType
      || morophonChosenType[String(permanent.id || '')]
      || '',
    ).trim();
    if (existingType) {
      if (!permanent.chosenCreatureType) {
        permanent.chosenCreatureType = existingType;
      }
      if (permanent.card && typeof permanent.card === 'object' && !permanent.card.chosenCreatureType) {
        permanent.card.chosenCreatureType = existingType;
      }
      continue;
    }
    
    // Check if this card requires creature type selection
    const { required, reason } = requiresCreatureTypeSelection(permanent.card);
    
    if (required) {
      const controller = permanent.controller;
      const cardName = permanent.card.name || "Unknown";
      const permanentId = permanent.id;
      const isAI = isAIPlayer(game, controller);

      // Avoid queueing duplicate steps if this scan runs multiple times
      const alreadyQueued = queue.steps.some(
        (s: any) => s.type === ResolutionStepType.CREATURE_TYPE_CHOICE && s.permanentId === permanentId
      );
      if (alreadyQueued) continue;

      // For AI players, resolve immediately without queueing a step.
      // (The global Resolution Queue AI handler would also handle this, but this path
      // chooses a smarter creature type via deck analysis.)
      const offeredCreatureTypes = getOfferedCreatureTypesForSelection(permanent.card);

      if (isAI) {
        let chosenType = getDominantCreatureType(game, controller);
        if (
          offeredCreatureTypes
          && !offeredCreatureTypes.some((type) => String(type).toLowerCase() === String(chosenType).toLowerCase())
        ) {
          chosenType = offeredCreatureTypes[0];
        }
        applyCreatureTypeSelection(io, game, gameId, controller, permanentId, cardName, chosenType, true);
        continue;
      }
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.CREATURE_TYPE_CHOICE,
        playerId: controller as any,
        description: reason || `Choose a creature type for ${cardName}`,
        mandatory: true,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: permanent.card?.image_uris?.normal,
        permanentId,
        cardName,
        reason,
        ...(offeredCreatureTypes ? { offeredCreatureTypes } : null),
      });
      
      debug(2, `[game-actions] Queued creature type selection for ${cardName} (${permanentId}) from ${controller}`);
    }
  }
}

/**
 * Check newly entered permanents for color choice requirements
 * and request selection from the player if needed.
 */
export function checkColorChoiceForNewPermanents(
  io: Server,
  game: any,
  gameId: string
): void {
  const battlefield = game.state?.battlefield || [];
  const queue = ResolutionQueueManager.getQueue(gameId);
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const existingColor = String(permanent.chosenColor || permanent.card?.chosenColor || '').trim();
    if (existingColor) {
      if (!permanent.chosenColor) {
        permanent.chosenColor = existingColor;
      }
      if (permanent.card && typeof permanent.card === 'object' && !permanent.card.chosenColor) {
        permanent.card.chosenColor = existingColor;
      }
    }

    const existingBasicLandType = String(
      permanent.chosenBasicLandType || permanent.card?.chosenBasicLandType || '',
    ).trim();
    if (existingBasicLandType) {
      if (!permanent.chosenBasicLandType) {
        permanent.chosenBasicLandType = existingBasicLandType;
      }
      if (permanent.card && typeof permanent.card === 'object' && !permanent.card.chosenBasicLandType) {
        permanent.card.chosenBasicLandType = existingBasicLandType;
      }
    }

    const asEntersChoices = getAsEntersChoiceRequirements(permanent.card);
    for (const requirement of asEntersChoices) {
      const controller = permanent.controller;
      const cardName = permanent.card.name || "Unknown";
      const permanentId = permanent.id;

      if (requirement.kind === 'color') {
        if (existingColor) continue;
        const alreadyQueued = queue.steps.some(
          (s: any) => s.type === ResolutionStepType.COLOR_CHOICE && s.permanentId === permanentId
        );
        if (alreadyQueued) continue;

        const availableColors = Array.isArray(requirement.colors) && requirement.colors.length > 0
          ? requirement.colors
          : ['white', 'blue', 'black', 'red', 'green'];

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.COLOR_CHOICE,
          playerId: controller as any,
          description: requirement.reason || `Choose a color for ${cardName}`,
          mandatory: requirement.mandatory,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: permanent.card?.image_uris?.normal,
          permanentId,
          cardName,
          reason: requirement.reason,
          colors: availableColors,
        });
        debug(2, `[game-actions] Requesting color choice for ${cardName} (${permanentId}) from ${controller}`);
        continue;
      }

      if (requirement.kind === 'basic_land_type') {
        if (existingBasicLandType) continue;
        const alreadyQueued = queue.steps.some(
          (s: any) =>
            (s.type === ResolutionStepType.BASIC_LAND_TYPE_CHOICE || s.choiceKind === 'basic_land_type')
            && s.permanentId === permanentId
        );
        if (alreadyQueued) continue;

        const basicLandOptions = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.BASIC_LAND_TYPE_CHOICE,
          playerId: controller as any,
          description: requirement.reason || `Choose a basic land type for ${cardName}`,
          mandatory: requirement.mandatory,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: permanent.card?.image_uris?.normal,
          permanentId,
          cardName,
          reason: requirement.reason,
          choiceKind: 'basic_land_type',
          options: basicLandOptions.map((landType, idx) => ({
            id: `basic_land_${idx}`,
            label: landType,
            value: landType,
          })),
          minSelections: 1,
          maxSelections: 1,
        });
        debug(2, `[game-actions] Requesting basic land type choice for ${cardName} (${permanentId}) from ${controller}`);
        continue;
      }

      if (requirement.kind === 'creature_type') {
        const existingType = String(permanent.chosenCreatureType || permanent.card?.chosenCreatureType || '').trim();
        if (existingType) continue;
        const alreadyQueued = queue.steps.some(
          (s: any) => s.type === ResolutionStepType.CREATURE_TYPE_CHOICE && s.permanentId === permanentId
        );
        if (alreadyQueued) continue;

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.CREATURE_TYPE_CHOICE,
          playerId: controller as any,
          description: requirement.reason || `Choose a creature type for ${cardName}`,
          mandatory: requirement.mandatory,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: permanent.card?.image_uris?.normal,
          permanentId,
          cardName,
          reason: requirement.reason,
          ...(requirement.excludedCreatureTypes
            ? { excludedCreatureTypes: requirement.excludedCreatureTypes }
            : {}),
        });
        debug(2, `[game-actions] Requesting creature type choice for ${cardName} (${permanentId}) from ${controller}`);
      }
    }
  }
}

/**
 * Check newly entered permanents for player selection requirements
 * and request selection from the player if needed.
 * 
 * Uses generic player selection system that routes to appropriate effects:
 * - Stuffy Doll: set chosenPlayer property
 * - Vislor Turlough/Xantcha: control change with optional goad
 */
export function checkPlayerSelectionForNewPermanents(
  io: Server,
  game: any,
  gameId: string
): void {
  const battlefield = game.state?.battlefield || [];
  const queue = ResolutionQueueManager.getQueue(gameId);
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    if ((permanent as any).asEntersControlChangeQueued) continue;

    const existingPlayer = String(permanent.chosenPlayer || permanent.card?.chosenPlayer || '').trim();
    if (existingPlayer) {
      if (!permanent.chosenPlayer) {
        permanent.chosenPlayer = existingPlayer;
      }
      if (permanent.card && typeof permanent.card === 'object' && !permanent.card.chosenPlayer) {
        permanent.card.chosenPlayer = existingPlayer;
      }
      continue;
    }
    
    // Detect if this card requires player selection
    const detection = detectETBPlayerSelection(permanent.card);
    
    if (detection.required && detection.effectData) {
      const controller = permanent.controller;
      const cardName = permanent.card.name || "Unknown";
      const permanentId = permanent.id;

      // Avoid queueing duplicate steps if this scan runs multiple times
      const alreadyQueued = queue.steps.some(
        (s: any) => s.type === ResolutionStepType.PLAYER_CHOICE && s.permanentId === permanentId
      );
      if (alreadyQueued) continue;
      
      // Set permanentId in effect data
      detection.effectData.permanentId = permanentId;
      
      // Request player selection from the controller
      requestPlayerSelection(
        io,
        gameId,
        controller,
        cardName,
        detection.description,
        detection.effectData,
        detection.allowOpponentsOnly,
        detection.isOptional
      );
      
      debug(2, `[game-actions] Requesting player selection for ${cardName} (${permanentId}) from ${controller}`);
    }
  }
}

/**
 * Check newly entered enchantments for ETB triggers like Growing Rites of Itlimoc
 * "When ~ enters, look at the top four cards of your library..."
 */
export function checkEnchantmentETBTriggers(
  io: Server,
  game: any,
  gameId: string
): void {
  const battlefield = game.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    // Skip if already processed ETB
    if (permanent.etbProcessed) continue;
    
    const activeCardFace = getActivePermanentCardFace(permanent);
    const typeLine = String(activeCardFace.typeLine || permanent.card.type_line || '').toLowerCase();
    const cardName = activeCardFace.name.toLowerCase();
    
    // Check for enchantments
    if (typeLine.includes('enchantment')) {
      // Growing Rites of Itlimoc: "When Growing Rites of Itlimoc enters, look at the top four cards..."
      if (cardName.includes('growing rites of itlimoc')) {
        const controller = permanent.controller;
        permanent.etbProcessed = true;
        
        const library = Array.isArray((game as any).libraries?.get(controller))
          ? ((game as any).libraries.get(controller) as any[])
          : (Array.isArray((game as any)?.state?.zones?.[controller]?.library)
            ? ((game as any).state.zones[controller].library as any[])
            : []);
        if (library.length === 0) continue;

        const topCards = library.slice(0, 4);
        const selectableCards = topCards.filter((card: any) => String(card?.type_line || '').toLowerCase().includes('creature'));
        const nonSelectableCards = topCards.filter((card: any) => !String(card?.type_line || '').toLowerCase().includes('creature'));
        
        // Queue top-of-library look + optional take + bottom ordering via Resolution Queue
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: controller as PlayerID,
          sourceName: 'Growing Rites of Itlimoc',
          description: 'Look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
          searchCriteria: 'Top 4 cards - choose a creature',
          minSelections: 0,
          maxSelections: 1,
          mandatory: false,
          destination: 'hand',
          reveal: true,
          shuffleAfter: false,
          availableCards: selectableCards,
          nonSelectableCards,
          revealedCards: topCards,
          filter: { types: ['creature'] },
          remainderDestination: 'bottom',
          remainderPlayerChoosesOrder: true,
        } as any);
        
        debug(2, `[game-actions] Growing Rites of Itlimoc ETB trigger for ${controller}`);
      }
    }
    
    if (!permanent.etbProcessed) {
      queueSelfEtbBattlefieldTutorSearch(game, gameId, permanent);
    }
  }
}

export function runPostResolutionPermanentPromptChecks(
  io: Server,
  game: any,
  gameId: string,
): void {
  checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
  checkColorChoiceForNewPermanents(io, game, gameId);
  checkAsEntersCopyChoiceForNewPermanents(game, gameId);
  checkPlayerSelectionForNewPermanents(io, game, gameId);
  checkEnchantmentETBTriggers(io, game, gameId);
}

function filterLibraryCardsForTutor(library: any[], filter: any): any[] {
  return filterLibraryCardsForSearch(library, filter);
}

function getActivePermanentCardFace(permanent: any): { name: string; oracleText: string; typeLine: string } {
  const card = permanent?.card;
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const isTransformCard =
    (card?.layout === 'transform' || card?.layout === 'double_faced_token') &&
    cardFaces.length >= 2;
  const activeFaceIndex = permanent?.transformed ? 1 : 0;
  const activeFace = isTransformCard ? cardFaces[activeFaceIndex] || cardFaces[0] : undefined;

  return {
    name: String(isTransformCard ? activeFace?.name || card?.name || '' : card?.name || '').trim(),
    oracleText: String(isTransformCard ? activeFace?.oracle_text || card?.oracle_text || '' : card?.oracle_text || ''),
    typeLine: String(isTransformCard ? activeFace?.type_line || card?.type_line || '' : card?.type_line || ''),
  };
}

function queueSelfEtbBattlefieldTutorSearch(game: any, gameId: string, permanent: any): boolean {
  const card = permanent?.card;
  const controller = permanent?.controller;
  const { name: cardName, oracleText } = getActivePermanentCardFace(permanent);
  if (!controller || !cardName || !oracleText) return false;

  // Stack self-ETB + Oracle IR search_library already owns these tutors (Solemn,
  // Farhaven Elf, Wood Elves, etc.). Queuing a second LIBRARY_SEARCH here causes
  // a double land-search prompt and undo/apply drift from duplicate resolves.
  try {
    const selfEtbTriggers = detectETBTriggers(card, permanent).filter((trigger: any) => {
      const triggerType = String(trigger?.triggerType || '').trim();
      return triggerType === 'etb' || triggerType === 'etb_search';
    });
    const stackOwnsBattlefieldTutor = selfEtbTriggers.some((trigger: any) => {
      const effectText = String(trigger?.effect || trigger?.description || '');
      return /search your library/i.test(effectText)
        && /onto the battlefield/i.test(effectText);
    });
    if (stackOwnsBattlefieldTutor) {
      permanent.etbProcessed = true;
      return false;
    }
  } catch {
    // Conservative: if detection fails, keep the legacy prompt path below.
  }

  const etbTutorLine = oracleText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .find((line) => {
      const lowerLine = line.toLowerCase();
      return /^when\s+/i.test(line) &&
        lowerLine.includes('search your library') &&
        lowerLine.includes('enters') &&
        oracleTextReferencesCard(line, cardName);
    });

  if (!etbTutorLine) return false;

  const tutorInfo = detectTutorEffect(etbTutorLine);
  if (!tutorInfo.isTutor || tutorInfo.splitDestination === true || tutorInfo.destination !== 'battlefield') {
    return false;
  }

  const library = Array.isArray((game as any).libraries?.get(controller))
    ? ((game as any).libraries.get(controller) as any[])
    : (Array.isArray((game as any)?.state?.zones?.[controller]?.library)
      ? ((game as any).state.zones[controller].library as any[])
      : []);
  const filter = parseSearchCriteria(tutorInfo.searchCriteria || '');
  const availableCards = filterLibraryCardsForTutor(library, filter);

  permanent.etbProcessed = true;
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: controller as PlayerID,
    sourceName: cardName,
    description: etbTutorLine,
    searchCriteria: tutorInfo.searchCriteria || 'any card',
    minSelections: 0,
    maxSelections: tutorInfo.maxSelections || 1,
    mandatory: false,
    destination: 'battlefield',
    reveal: false,
    shuffleAfter: true,
    availableCards,
    filter,
    entersTapped: tutorInfo.entersTapped === true,
  } as any);

  debug(2, `[game-actions] Generic ETB battlefield tutor trigger for ${cardName} (${controller})`);
  return true;
}
