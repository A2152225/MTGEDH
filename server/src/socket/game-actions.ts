import type { Server, Socket } from "socket.io";
import type { InMemoryGame } from "../state/types";
import { ensureGame, broadcastGame, appendGameEvent, parseManaCost, getManaColorName, MANA_COLORS, MANA_COLOR_NAMES, consumeManaFromPool, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, getPlayerName, emitToPlayer, calculateManaProduction, broadcastManaPoolUpdate, millUntilLand } from "./util";
import { processPendingCascades, processPendingScry, processPendingProliferate, processPendingPonder } from "./resolution.js";
import { appendEvent } from "../db";
import { GameManager } from "../GameManager";
import type { PaymentItem, TriggerShortcut, PlayerID } from "../../../shared/src";
import { requiresCreatureTypeSelection, getDominantCreatureType, isAIPlayer, applyCreatureTypeSelection } from "./creature-type";
import { requiresColorChoice } from "./color-choice";
import { detectETBPlayerSelection, requestPlayerSelection } from "./player-selection";
import { checkAndPromptOpeningHandActions } from "./opening-hand";
import { detectSpellCastTriggers, getBeginningOfCombatTriggers, getEndStepTriggers, getLandfallTriggers, detectETBTriggers, detectEldraziEffect, type SpellCastTrigger } from "../state/modules/triggered-abilities";
import { getOpponentSpellCastTriggers, type OpponentSpellCastTriggerType } from "../state/modules/triggers/index.js";
import { isInterveningIfSatisfied } from "../state/modules/triggers/intervening-if";
import { getUpkeepTriggersForPlayer, autoProcessCumulativeUpkeepMana } from "../state/modules/upkeep-triggers";
import { categorizeSpell, evaluateTargeting, requiresTargeting, parseTargetRequirements } from "../rules-engine/targeting";
import { recalculatePlayerEffects, hasMetalcraft, countArtifacts, calculateMaxLandsPerTurn } from "../state/modules/game-state-effects";
import { PAY_X_LIFE_CARDS, getMaxPayableLife, validateLifePayment, uid } from "../state/utils";
import { detectTutorEffect, parseSearchCriteria, type TutorInfo } from "./interaction";
import { ResolutionQueueManager, ResolutionStepType } from "../state/resolution/index.js";
import { extractModalModesFromOracleText } from "../utils/oraclePromptContext.js";
import { enqueueEdictCreatureSacrificeStep } from "./sacrifice-resolution.js";
import { emitPendingDamageTriggers as emitPendingDamageTriggersImpl } from "./damage-triggers.js";
import { hasMutateAlternateCost, parseMutateCost, getValidMutateTargets } from "../state/modules/alternate-costs.js";

// Import land-related helpers from modularized module
import { debug, debugWarn, debugError } from "../utils/debug.js";
import {
  SHOCK_LANDS,
  BOUNCE_LANDS,
  isShockLand,
  isBounceLand,
  detectScryOnETB,
  detectSacrificeUnlessPayETB,
  detectETBTappedPattern,
  evaluateConditionalLandETB,
  getLandSubtypes,
  detectAdditionalCost,
} from "./land-helpers";

export const emitPendingDamageTriggers = emitPendingDamageTriggersImpl;

// Note: SHOCK_LANDS, BOUNCE_LANDS, isShockLand, isBounceLand, detectScryOnETB, 
// detectSacrificeUnlessPayETB, detectETBTappedPattern, evaluateConditionalLandETB,
// getLandSubtypes are now imported from ./land-helpers.ts

/**
 * Get maximum hand size for a player, accounting for:
 * 1. No maximum hand size effects (Reliquary Tower, Praetor's Counsel)
 * 2. Increased maximum hand size effects (Spellbook, Library of Leng)
 * 3. Reduced maximum hand size effects (Jin-Gitaxias, Core Augur)
 * 4. Other player-specific overrides
 * 
 * @param gameState The game state
 * @param playerId The player ID
 * @returns Maximum hand size (Infinity for no maximum, 7 by default)
 */
function getMaxHandSizeForPlayer(gameState: any, playerId: string): number {
  try {
    if (!gameState) return 7;

    const playerMaxHandSize = gameState.maxHandSize?.[playerId];
    if (playerMaxHandSize === Infinity || playerMaxHandSize === Number.POSITIVE_INFINITY) {
      return Infinity;
    }
    if (typeof playerMaxHandSize === 'number' && playerMaxHandSize > 0) {
      return playerMaxHandSize;
    }

    const noMaxHandSize = gameState.noMaximumHandSize?.[playerId];
    if (noMaxHandSize === true) {
      return Infinity;
    }

    const playerEffects = gameState.playerEffects?.[playerId] || [];
    for (const effect of playerEffects) {
      if (effect && (effect.type === 'no_maximum_hand_size' || effect.effect === 'no_maximum_hand_size')) {
        return Infinity;
      }
    }

    const battlefield = Array.isArray(gameState.battlefield) ? gameState.battlefield : [];
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const oracle = String(perm.card?.oracle_text || '').toLowerCase();
        if (oracle.includes('you have no maximum hand size') || oracle.includes('no maximum hand size')) {
          return Infinity;
        }
      }
    }

    const emblems = Array.isArray(gameState.emblems) ? gameState.emblems : [];
    for (const emblem of emblems) {
      if (emblem && emblem.controller === playerId) {
        const effectText = String(emblem.effect || emblem.text || '').toLowerCase();
        if (effectText.includes('no maximum hand size')) {
          return Infinity;
        }
      }
    }

    return 7;
  } catch (err) {
    debugWarn(1, `[getMaxHandSizeForPlayer] failed:`, err);
    return 7;
  }
}

/**
 * Check if a hand qualifies for a free mulligan under "no lands or all lands" house rule.
 * Returns true if the hand has 0 lands or all cards are lands.
 */
function handHasNoLandsOrAllLands(hand: any[]): boolean {
  if (!Array.isArray(hand) || hand.length === 0) return false;

  let landCount = 0;
  for (const card of hand) {
    if (!card) continue;
    const typeLine = String(card.type_line || "").toLowerCase();
    if (/\bland\b/.test(typeLine)) {
      landCount++;
    }
  }

  // No lands or all lands
  return landCount === 0 || landCount === hand.length;
}

/**
 * Check if all human (non-AI, non-spectator) players have mulliganed in the current round.
 * Used for the "group mulligan discount" house rule.
 */
function checkAllHumanPlayersMulliganed(game: any): boolean {
  try {
    const players = game.state?.players || [];
    const mulliganState = (game.state as any)?.mulliganState || {};

    const humanPlayers = players.filter((p: any) =>
      p && !p.spectator && !p.isAI && p.id && !String(p.id).startsWith("ai_")
    );

    if (humanPlayers.length === 0) return false;

    // Check if all human players have mulliganed at least once
    for (const player of humanPlayers) {
      const playerMulliganState = mulliganState[player.id];
      if (!playerMulliganState || (playerMulliganState.mulligansTaken || 0) === 0) {
        return false;
      }
    }

    return true;
  } catch (err) {
    debugWarn(1, "checkAllHumanPlayersMulliganed failed:", err);
    return false;
  }
}

/**
 * Calculate the effective mulligan count for a player based on game rules.
 * This determines how many cards they need to put back when keeping their hand.
 *
 * In multiplayer games (3+ players), the first mulligan is always free per
 * official Commander/multiplayer rules (rule 103.5a). This is now baseline behavior.
 */
function calculateEffectiveMulliganCount(
  actualMulligans: number,
  game: any,
  playerId: string
): number {
  if (actualMulligans === 0) return 0;

  const houseRules = game.state?.houseRules || {};
  const players = game.state?.players || [];
  const isMultiplayer = players.filter((p: any) => p && !p.spectator).length > 2;

  let effectiveCount = actualMulligans;

  // Free first mulligan in multiplayer (Commander rule 103.5a)
  if (isMultiplayer && actualMulligans >= 1) {
    effectiveCount = Math.max(0, actualMulligans - 1);
    debug(1, `[mulligan] Free first mulligan applied for ${playerId} (multiplayer baseline): ${actualMulligans} -> ${effectiveCount}`);
  }

  // Group mulligan discount: if enabled and all human players mulliganed, reduce by 1
  if (houseRules.groupMulliganDiscount && checkAllHumanPlayersMulliganed(game)) {
    effectiveCount = Math.max(0, effectiveCount - 1);
    debug(1, `[mulligan] Group mulligan discount applied for ${playerId}: effective count now ${effectiveCount}`);
  }

  return effectiveCount;
}

/**
 * Check if a mulligan should be free due to "no lands or all lands" house rule.
 * This is checked before taking the mulligan.
 */
function shouldMulliganBeFree(game: any, playerId: string): boolean {
  const houseRules = game.state?.houseRules || {};
  
  if (!houseRules.freeMulliganNoLandsOrAllLands) {
    return false;
  }
  
  // Get the player's current hand
  const zones = game.state?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  
  return handHasNoLandsOrAllLands(hand);
}

/**
 * Check if all non-spectator players have kept their hands during pre-game.
 * Returns { allKept: boolean, waitingPlayers: string[] }
 */
function checkAllPlayersKeptHands(game: any): { allKept: boolean; waitingPlayers: string[] } {
  try {
    const players = game.state?.players || [];
    const mulliganState = (game.state as any)?.mulliganState || {};
    
    const nonSpectatorPlayers = players.filter((p: any) => p && !p.spectator);
    const waitingPlayers: string[] = [];
    
    for (const player of nonSpectatorPlayers) {
      const playerId = player.id;
      const playerMulliganState = mulliganState[playerId];
      
      // Player hasn't kept their hand if:
      // 1. No mulligan state exists, OR
      // 2. hasKeptHand is explicitly false
      if (!playerMulliganState || !playerMulliganState.hasKeptHand) {
        waitingPlayers.push(player.name || playerId);
      }
    }
    
    return {
      allKept: waitingPlayers.length === 0,
      waitingPlayers,
    };
  } catch (err) {
    debugWarn(1, "checkAllPlayersKeptHands failed:", err);
    return { allKept: false, waitingPlayers: [] };
  }
}

/**
 * Check if all non-spectator players have imported/selected their decks.
 * A player has a deck if their library has cards (libraryCount > 0).
 * Returns { allHaveDecks: boolean, waitingPlayers: string[] }
 */
function checkAllPlayersHaveDecks(game: any): { allHaveDecks: boolean; waitingPlayers: string[] } {
  try {
    const players = game.state?.players || [];
    const zones = game.state?.zones || {};
    
    const nonSpectatorPlayers = players.filter((p: any) => p && !p.spectator);
    const waitingPlayers: string[] = [];
    
    for (const player of nonSpectatorPlayers) {
      const playerId = player.id;
      const playerZones = zones[playerId];
      
      // Player doesn't have a deck if:
      // 1. No zones exist for them, OR
      // 2. libraryCount is 0 or undefined AND handCount is 0 or undefined
      // (hand can have cards if they've drawn already)
      const libraryCount = playerZones?.libraryCount ?? 0;
      const handCount = playerZones?.handCount ?? 0;
      
      if (libraryCount === 0 && handCount === 0) {
        waitingPlayers.push(player.name || playerId);
      }
    }
    
    return {
      allHaveDecks: waitingPlayers.length === 0,
      waitingPlayers,
    };
  } catch (err) {
    debugWarn(1, "checkAllPlayersHaveDecks failed:", err);
    return { allHaveDecks: false, waitingPlayers: [] };
  }
}

/**
 * Check newly entered permanents for creature type selection requirements
 * and request selection from the player if needed.
 */
function checkCreatureTypeSelectionForNewPermanents(
  io: Server,
  game: any,
  gameId: string
): void {
  const battlefield = game.state?.battlefield || [];
  const queue = ResolutionQueueManager.getQueue(gameId);
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    // Skip if already has a chosen creature type
    if (permanent.chosenCreatureType) continue;
    
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
      if (isAI) {
        const chosenType = getDominantCreatureType(game, controller);
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
      });
      
      debug(2, `[game-actions] Queued creature type selection for ${cardName} (${permanentId}) from ${controller}`);
    }
  }
  
  broadcastGame(io, game, gameId);
}

/**
 * Check newly entered permanents for color choice requirements
 * and request selection from the player if needed.
 */
function checkColorChoiceForNewPermanents(
  io: Server,
  game: any,
  gameId: string
): void {
  const battlefield = game.state?.battlefield || [];
  const queue = ResolutionQueueManager.getQueue(gameId);
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    // Skip if already has a chosen color
    if (permanent.chosenColor) continue;
    
    // Check if this card requires color choice
    const { required, reason } = requiresColorChoice(permanent.card);
    
    if (required) {
      const controller = permanent.controller;
      const cardName = permanent.card.name || "Unknown";
      const permanentId = permanent.id;

      // Avoid queueing duplicate steps if this scan runs multiple times
      const alreadyQueued = queue.steps.some(
        (s: any) => s.type === ResolutionStepType.COLOR_CHOICE && s.permanentId === permanentId
      );
      if (alreadyQueued) continue;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.COLOR_CHOICE,
        playerId: controller as any,
        description: reason || `Choose a color for ${cardName}`,
        mandatory: true,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: permanent.card?.image_uris?.normal,
        permanentId,
        cardName,
        reason,
        colors: ['white', 'blue', 'black', 'red', 'green'],
      });
      
      debug(2, `[game-actions] Requesting color choice for ${cardName} (${permanentId}) from ${controller}`);
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
function checkPlayerSelectionForNewPermanents(
  io: Server,
  game: any,
  gameId: string
): void {
  const battlefield = game.state?.battlefield || [];
  const queue = ResolutionQueueManager.getQueue(gameId);
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    // Skip if already has chosen player
    if (permanent.chosenPlayer) continue;
    
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
function checkEnchantmentETBTriggers(
  io: Server,
  game: any,
  gameId: string
): void {
  const battlefield = game.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    // Skip if already processed ETB
    if (permanent.etbProcessed) continue;
    
    const typeLine = (permanent.card.type_line || '').toLowerCase();
    const cardName = (permanent.card.name || '').toLowerCase();
    const oracleText = (permanent.card.oracle_text || '').toLowerCase();
    
    // Check for enchantments
    if (typeLine.includes('enchantment')) {
      // Growing Rites of Itlimoc: "When Growing Rites of Itlimoc enters, look at the top four cards..."
      if (cardName.includes('growing rites of itlimoc')) {
        const controller = permanent.controller;
        permanent.etbProcessed = true;
        
        // Get top 4 cards from library
        const zones = game.state.zones?.[controller];
        if (!zones || !Array.isArray(zones.library)) continue;
        
        const topCards = zones.library.slice(0, 4);
        
        // Queue top-of-library look + optional take + bottom ordering via Resolution Queue
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: controller as PlayerID,
          sourceName: 'Growing Rites of Itlimoc',
          description: 'Look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.',
          searchCriteria: 'Top 4 cards ΓÇö choose a creature',
          minSelections: 0,
          maxSelections: 1,
          mandatory: false,
          destination: 'hand',
          reveal: true,
          shuffleAfter: false,
          availableCards: topCards,
          filter: { type: 'creature' },
          remainderDestination: 'bottom',
          remainderPlayerChoosesOrder: true,
        } as any);
        
        debug(2, `[game-actions] Growing Rites of Itlimoc ETB trigger for ${controller}`);
      }
    }
    
    // Check for creatures with ETB triggers
    if (typeLine.includes('creature')) {
      // Casal, Lurkwood Pathfinder: "When Casal enters, search your library for a Forest card..."
      if (cardName.includes('casal') && cardName.includes('pathfinder')) {
        const controller = permanent.controller;
        permanent.etbProcessed = true;
        
        // Get library
        const zones = game.state.zones?.[controller];
        if (!zones || !Array.isArray(zones.library)) continue;
        
        // Queue library tutor via Resolution Queue
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: controller as PlayerID,
          sourceName: 'Casal, Lurkwood Pathfinder',
          description: 'Search your library for a Forest card, put it onto the battlefield tapped, then shuffle.',
          searchCriteria: 'Forest card',
          minSelections: 0,
          maxSelections: 1,
          mandatory: false,
          destination: 'battlefield',
          reveal: false,
          shuffleAfter: true,
          availableCards: zones.library,
          filter: { subtype: 'Forest' },
          entersTapped: true,
        } as any);
        
        debug(2, `[game-actions] Casal, Lurkwood Pathfinder ETB trigger for ${controller}`);
      }
    }
  }
}

/**
 * Calculate cost reduction for a spell based on battlefield effects.
 * Returns an object with the reduction for each color and generic cost.
 * 
 * Supports various cost reduction types:
 * - Creature type based: Morophon, Urza's Incubator, Herald's Horn, Goblin Warchief
 * - Card type based: Goblin Electromancer (instants/sorceries), Semblance Anvil (imprinted type)
 * - Ability based: Training Grounds (activated abilities - not spell costs)
 * - Board state based: Animar (experience/+1+1 counters), Affinity effects
 * - Color based: Ruby Medallion, Sapphire Medallion, etc.
 */
export function calculateCostReduction(
  game: any,
  playerId: string,
  card: any,
  isAbility: boolean = false
): { generic: number; colors: Record<string, number>; messages: string[] } {
  const reduction = {
    generic: 0,
    colors: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } as Record<string, number>,
    messages: [] as string[],
  };
  
  try {
    const battlefield = game.state?.battlefield || [];
    const cardTypeLine = (card.type_line || "").toLowerCase();
    const cardOracleText = (card.oracle_text || "").toLowerCase();
    const cardColors = card.colors || [];
    const cardCreatureTypes = extractCreatureTypes(cardTypeLine);
    const cardName = card.name || "Unknown";
    const cardManaCost = (card.mana_cost || "").toUpperCase();
    
    // Determine card characteristics
    const isCreature = cardTypeLine.includes("creature");
    const isInstant = cardTypeLine.includes("instant");
    const isSorcery = cardTypeLine.includes("sorcery");
    const isArtifact = cardTypeLine.includes("artifact");
    const isEnchantment = cardTypeLine.includes("enchantment");
    const isPlaneswalker = cardTypeLine.includes("planeswalker");
    
    // Determine colors from both colors array and mana cost
    const hasWhite = cardColors.includes("W") || cardColors.includes("White") || cardManaCost.includes("{W}");
    const hasBlue = cardColors.includes("U") || cardColors.includes("Blue") || cardManaCost.includes("{U}");
    const hasBlack = cardColors.includes("B") || cardColors.includes("Black") || cardManaCost.includes("{B}");
    const hasRed = cardColors.includes("R") || cardColors.includes("Red") || cardManaCost.includes("{R}");
    const hasGreen = cardColors.includes("G") || cardColors.includes("Green") || cardManaCost.includes("{G}");
    
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      
      const permName = (perm.card?.name || "").toLowerCase();
      const permOracle = (perm.card?.oracle_text || "").toLowerCase();
      const chosenType = (perm.chosenCreatureType || "").toLowerCase();
      const imprintedCard = perm.imprintedCard; // For Semblance Anvil
      const counters = perm.counters || {};
      
      // ============================================
      // CREATURE TYPE BASED REDUCTIONS
      // ============================================
      
      // Morophon, the Boundless: Spells of the chosen creature type cost {W}{U}{B}{R}{G} less
      if (permName.includes("morophon") && chosenType) {
        if (cardCreatureTypes.includes(chosenType) || cardTypeLine.includes(chosenType)) {
          reduction.colors.white += 1;
          reduction.colors.blue += 1;
          reduction.colors.black += 1;
          reduction.colors.red += 1;
          reduction.colors.green += 1;
          reduction.messages.push(`Morophon: -{W}{U}{B}{R}{G} (${chosenType})`);
        }
      }
      
      // Urza's Incubator: Creature spells of the chosen type cost {2} less
      if (permName.includes("urza's incubator") && chosenType) {
        if (isCreature && (cardCreatureTypes.includes(chosenType) || cardTypeLine.includes(chosenType))) {
          reduction.generic += 2;
          reduction.messages.push(`Urza's Incubator: -{2} (${chosenType})`);
        }
      }
      
      // Herald's Horn: Creature spells of the chosen type cost {1} less
      if (permName.includes("herald's horn") && chosenType) {
        if (isCreature && (cardCreatureTypes.includes(chosenType) || cardTypeLine.includes(chosenType))) {
          reduction.generic += 1;
          reduction.messages.push(`Herald's Horn: -{1} (${chosenType})`);
        }
      }
      
      // Goblin Warchief: Goblin spells cost {1} less
      if (permName.includes("goblin warchief") && cardTypeLine.includes("goblin")) {
        reduction.generic += 1;
        reduction.messages.push(`Goblin Warchief: -{1}`);
      }
      
      // Dragonspeaker Shaman: Dragon spells cost {2} less
      if (permName.includes("dragonspeaker shaman") && cardTypeLine.includes("dragon")) {
        reduction.generic += 2;
        reduction.messages.push(`Dragonspeaker Shaman: -{2}`);
      }
      
      // Stinkdrinker Daredevil: Giant spells cost {2} less
      if (permName.includes("stinkdrinker daredevil") && cardTypeLine.includes("giant")) {
        reduction.generic += 2;
        reduction.messages.push(`Stinkdrinker Daredevil: -{2}`);
      }
      
      // Frogtosser Banneret: Goblin and Rogue spells cost {1} less
      if (permName.includes("frogtosser banneret")) {
        if (cardTypeLine.includes("goblin") || cardTypeLine.includes("rogue")) {
          reduction.generic += 1;
          reduction.messages.push(`Frogtosser Banneret: -{1}`);
        }
      }
      
      // Stonybrook Banneret: Merfolk and Wizard spells cost {1} less
      if (permName.includes("stonybrook banneret")) {
        if (cardTypeLine.includes("merfolk") || cardTypeLine.includes("wizard")) {
          reduction.generic += 1;
          reduction.messages.push(`Stonybrook Banneret: -{1}`);
        }
      }
      
      // Ballyrush Banneret: Kithkin and Soldier spells cost {1} less
      if (permName.includes("ballyrush banneret")) {
        if (cardTypeLine.includes("kithkin") || cardTypeLine.includes("soldier")) {
          reduction.generic += 1;
          reduction.messages.push(`Ballyrush Banneret: -{1}`);
        }
      }
      
      // Bosk Banneret: Treefolk and Shaman spells cost {1} less
      if (permName.includes("bosk banneret")) {
        if (cardTypeLine.includes("treefolk") || cardTypeLine.includes("shaman")) {
          reduction.generic += 1;
          reduction.messages.push(`Bosk Banneret: -{1}`);
        }
      }
      
      // Brighthearth Banneret: Elemental and Warrior spells cost {1} less
      if (permName.includes("brighthearth banneret")) {
        if (cardTypeLine.includes("elemental") || cardTypeLine.includes("warrior")) {
          reduction.generic += 1;
          reduction.messages.push(`Brighthearth Banneret: -{1}`);
        }
      }
      
      // ============================================
      // CARD TYPE BASED REDUCTIONS
      // ============================================
      
      // Goblin Electromancer: Instant and sorcery spells cost {1} less
      if (permName.includes("goblin electromancer") || permName.includes("baral, chief of compliance")) {
        if (isInstant || isSorcery) {
          reduction.generic += 1;
          reduction.messages.push(`${perm.card?.name}: -{1} (instant/sorcery)`);
        }
      }
      
      // Etherium Sculptor: Artifact spells cost {1} less
      if (permName.includes("etherium sculptor") || permName.includes("foundry inspector")) {
        if (isArtifact) {
          reduction.generic += 1;
          reduction.messages.push(`${perm.card?.name}: -{1} (artifact)`);
        }
      }
      
      // Cloud Key: Chosen type costs {1} less
      if (permName.includes("cloud key") && chosenType) {
        const chosenCardType = chosenType.toLowerCase();
        if (cardTypeLine.includes(chosenCardType)) {
          reduction.generic += 1;
          reduction.messages.push(`Cloud Key: -{1} (${chosenType})`);
        }
      }
      
      // Semblance Anvil: Spells sharing a type with imprinted card cost {2} less
      if (permName.includes("semblance anvil") && imprintedCard) {
        const imprintedTypes = (imprintedCard.type_line || "").toLowerCase();
        const sharesType = 
          (isCreature && imprintedTypes.includes("creature")) ||
          (isArtifact && imprintedTypes.includes("artifact")) ||
          (isEnchantment && imprintedTypes.includes("enchantment")) ||
          (isInstant && imprintedTypes.includes("instant")) ||
          (isSorcery && imprintedTypes.includes("sorcery")) ||
          (isPlaneswalker && imprintedTypes.includes("planeswalker"));
        
        if (sharesType) {
          reduction.generic += 2;
          reduction.messages.push(`Semblance Anvil: -{2} (shares type)`);
        }
      }
      
      // Jhoira's Familiar: Historic spells cost {1} less (artifacts, legendaries, sagas)
      if (permName.includes("jhoira's familiar")) {
        const isLegendary = cardTypeLine.includes("legendary");
        const isSaga = cardTypeLine.includes("saga");
        if (isArtifact || isLegendary || isSaga) {
          reduction.generic += 1;
          reduction.messages.push(`Jhoira's Familiar: -{1} (historic)`);
        }
      }
      
      // ============================================
      // COLOR BASED REDUCTIONS (Medallions)
      // ============================================
      
      // Ruby Medallion: Red spells cost {1} less
      if (permName.includes("ruby medallion") && hasRed) {
        reduction.generic += 1;
        reduction.messages.push(`Ruby Medallion: -{1} (red)`);
      }
      
      // Sapphire Medallion: Blue spells cost {1} less
      if (permName.includes("sapphire medallion") && hasBlue) {
        reduction.generic += 1;
        reduction.messages.push(`Sapphire Medallion: -{1} (blue)`);
      }
      
      // Jet Medallion: Black spells cost {1} less
      if (permName.includes("jet medallion") && hasBlack) {
        reduction.generic += 1;
        reduction.messages.push(`Jet Medallion: -{1} (black)`);
      }
      
      // Pearl Medallion: White spells cost {1} less
      if (permName.includes("pearl medallion") && hasWhite) {
        reduction.generic += 1;
        reduction.messages.push(`Pearl Medallion: -{1} (white)`);
      }
      
      // Emerald Medallion: Green spells cost {1} less
      if (permName.includes("emerald medallion") && hasGreen) {
        reduction.generic += 1;
        reduction.messages.push(`Emerald Medallion: -{1} (green)`);
      }
      
      // The Wind Crystal: White spells cost {1} less
      if (permName.includes("wind crystal") && hasWhite) {
        reduction.generic += 1;
        reduction.messages.push(`The Wind Crystal: -{1} (white)`);
      }
      
      // Daru Warchief: Soldier spells cost {1} less
      if (permName.includes("daru warchief") && cardTypeLine.includes("soldier")) {
        reduction.generic += 1;
        reduction.messages.push(`Daru Warchief: -{1} (soldier)`);
      }
      
      // ============================================
      // MONUMENT COST REDUCTIONS (color creature spells)
      // ============================================
      
      // Oketra's Monument: White creature spells cost {1} less
      if (permName.includes("oketra's monument") && isCreature && hasWhite) {
        reduction.generic += 1;
        reduction.messages.push(`Oketra's Monument: -{1} (white creature)`);
      }
      
      // Bontu's Monument: Black creature spells cost {1} less
      if (permName.includes("bontu's monument") && isCreature && hasBlack) {
        reduction.generic += 1;
        reduction.messages.push(`Bontu's Monument: -{1} (black creature)`);
      }
      
      // Hazoret's Monument: Red creature spells cost {1} less
      if (permName.includes("hazoret's monument") && isCreature && hasRed) {
        reduction.generic += 1;
        reduction.messages.push(`Hazoret's Monument: -{1} (red creature)`);
      }
      
      // Kefnet's Monument: Blue creature spells cost {1} less
      if (permName.includes("kefnet's monument") && isCreature && hasBlue) {
        reduction.generic += 1;
        reduction.messages.push(`Kefnet's Monument: -{1} (blue creature)`);
      }
      
      // Rhonas's Monument: Green creature spells cost {1} less
      if (permName.includes("rhonas's monument") && isCreature && hasGreen) {
        reduction.generic += 1;
        reduction.messages.push(`Rhonas's Monument: -{1} (green creature)`);
      }
      
      // ============================================
      // BOARD STATE / COUNTER BASED REDUCTIONS
      // ============================================
      
      // Animar, Soul of Elements: Creature spells cost {1} less for each +1/+1 counter on Animar
      if (permName.includes("animar, soul of elements") || permName.includes("animar")) {
        if (isCreature) {
          const plusCounters = counters["+1/+1"] || counters["plus1plus1"] || 0;
          if (plusCounters > 0) {
            reduction.generic += plusCounters;
            reduction.messages.push(`Animar: -{${plusCounters}} (${plusCounters} +1/+1 counters)`);
          }
        }
      }
      
      // Experience counter commanders (e.g., Mizzix of the Izmagnus)
      if (permName.includes("mizzix")) {
        if (isInstant || isSorcery) {
          const expCounters = (game.state?.experienceCounters?.[playerId]) || 0;
          if (expCounters > 0) {
            reduction.generic += expCounters;
            reduction.messages.push(`Mizzix: -{${expCounters}} (experience)`);
          }
        }
      }
      
      // Edgewalker: Cleric spells cost {W}{B} less
      if (permName.includes("edgewalker") && cardTypeLine.includes("cleric")) {
        reduction.colors.white += 1;
        reduction.colors.black += 1;
        reduction.messages.push(`Edgewalker: -{W}{B} (cleric)`);
      }
      
      // ============================================
      // ABILITY COST REDUCTIONS (for activated abilities)
      // ============================================
      
      if (isAbility) {
        // Training Grounds: Activated abilities of creatures cost up to {2} less
        if (permName.includes("training grounds")) {
          reduction.generic += 2;
          reduction.messages.push(`Training Grounds: -{2} (activated ability)`);
        }
        
        // Biomancer's Familiar: Activated abilities of creatures cost {2} less
        if (permName.includes("biomancer's familiar")) {
          reduction.generic += 2;
          reduction.messages.push(`Biomancer's Familiar: -{2} (activated ability)`);
        }
        
        // Heartstone: Activated abilities of creatures cost {1} less
        if (permName.includes("heartstone")) {
          reduction.generic += 1;
          reduction.messages.push(`Heartstone: -{1} (activated ability)`);
        }
        
        // Zirda, the Dawnwaker: Activated abilities cost {2} less
        if (permName.includes("zirda")) {
          reduction.generic += 2;
          reduction.messages.push(`Zirda: -{2} (activated ability)`);
        }
      }
      
      // ============================================
      // AFFINITY EFFECTS
      // ============================================
      
      // Check for affinity in the card being cast
      // Affinity for artifacts
      if (cardOracleText.includes("affinity for artifacts")) {
        const artifactCount = battlefield.filter((p: any) => 
          p && p.controller === playerId && 
          (p.card?.type_line || "").toLowerCase().includes("artifact")
        ).length;
        if (artifactCount > 0) {
          reduction.generic += artifactCount;
          reduction.messages.push(`Affinity for artifacts: -{${artifactCount}} (${artifactCount} artifacts)`);
        }
      }
      
      // Affinity for creatures
      if (cardOracleText.includes("affinity for creatures")) {
        const creatureCount = battlefield.filter((p: any) => 
          p && p.controller === playerId && 
          (p.card?.type_line || "").toLowerCase().includes("creature")
        ).length;
        if (creatureCount > 0) {
          reduction.generic += creatureCount;
          reduction.messages.push(`Affinity for creatures: -{${creatureCount}} (${creatureCount} creatures)`);
        }
      }
      
      // Affinity for equipment
      if (cardOracleText.includes("affinity for equipment")) {
        const equipmentCount = battlefield.filter((p: any) => 
          p && p.controller === playerId && 
          (p.card?.type_line || "").toLowerCase().includes("equipment")
        ).length;
        if (equipmentCount > 0) {
          reduction.generic += equipmentCount;
          reduction.messages.push(`Affinity for equipment: -{${equipmentCount}} (${equipmentCount} equipment)`);
        }
      }
      
      // Affinity for basic land types (Plains, Island, Swamp, Mountain, Forest)
      const basicLands = ['plains', 'island', 'swamp', 'mountain', 'forest'];
      for (const landType of basicLands) {
        if (cardOracleText.includes(`affinity for ${landType}`)) {
          const landCount = battlefield.filter((p: any) => {
            if (!p || p.controller !== playerId) return false;
            const typeLine = (p.card?.type_line || "").toLowerCase();
            // Check for land type (works for both basic lands and lands with basic land types)
            return typeLine.includes('land') && typeLine.includes(landType);
          }).length;
          if (landCount > 0) {
            reduction.generic += landCount;
            const capitalizedLand = landType.charAt(0).toUpperCase() + landType.slice(1);
            reduction.messages.push(`Affinity for ${capitalizedLand}: -{${landCount}} (${landCount} ${capitalizedLand})`);
          }
        }
      }
      
      // Convoke - can tap creatures to pay for spell
      // (This is handled differently - through tapping creatures as payment)
    }
    
    // ============================================
    // CARD'S OWN COST REDUCTION (Blasphemous Act, Myr Enforcer, etc.)
    // ============================================
    
    // "This spell costs {X} less to cast for each creature on the battlefield"
    // Handles: Blasphemous Act, Myr Enforcer, Goblin Offensive, etc.
    const creatureReductionMatch = cardOracleText.match(/this spell costs \{?(\d+)\}? less to cast for each creature/i);
    if (creatureReductionMatch) {
      const reductionPerCreature = parseInt(creatureReductionMatch[1], 10);
      const creatureCount = battlefield.filter((p: any) => 
        p && (p.card?.type_line || "").toLowerCase().includes("creature")
      ).length;
      const totalReduction = reductionPerCreature * creatureCount;
      if (totalReduction > 0) {
        reduction.generic += totalReduction;
        reduction.messages.push(`${cardName}: -{${totalReduction}} (${creatureCount} creatures ├ù {${reductionPerCreature}})`);
      }
    }
    
    // "This spell costs {X} less to cast for each artifact you control"
    // Handles: Metalwork Colossus, Frogmite, Myr Enforcer (affinity variant), etc.
    const artifactReductionMatch = cardOracleText.match(/this spell costs \{?(\d+)\}? less to cast for each artifact/i);
    if (artifactReductionMatch) {
      const reductionPerArtifact = parseInt(artifactReductionMatch[1], 10);
      const artifactCount = battlefield.filter((p: any) => 
        p && p.controller === playerId && 
        (p.card?.type_line || "").toLowerCase().includes("artifact")
      ).length;
      const totalReduction = reductionPerArtifact * artifactCount;
      if (totalReduction > 0) {
        reduction.generic += totalReduction;
        reduction.messages.push(`${cardName}: -{${totalReduction}} (${artifactCount} artifacts ├ù {${reductionPerArtifact}})`);
      }
    }
    
    // "This spell costs {X} less to cast, where X is the total mana value of historic permanents you control"
    // Handles: Excalibur, Sword of Eden
    // Historic = artifacts, legendaries, and sagas
    const historicManaValueMatch = cardOracleText.match(/costs? \{?x\}? less.*where x is the total (?:mana value|mana cost) of historic/i);
    if (historicManaValueMatch) {
      let totalManaValue = 0;
      for (const perm of battlefield) {
        if (!perm || perm.controller !== playerId) continue;
        
        const permTypeLine = (perm.card?.type_line || "").toLowerCase();
        const isHistoric = permTypeLine.includes("artifact") || 
                          permTypeLine.includes("legendary") || 
                          permTypeLine.includes("saga");
        
        if (isHistoric) {
          // Get mana value from the card
          const manaCost = perm.card?.mana_cost || "";
          const cmc = perm.card?.cmc;
          
          // Use cmc if available, otherwise parse mana cost
          let manaValue = 0;
          if (typeof cmc === "number") {
            manaValue = cmc;
          } else if (manaCost) {
            // Parse mana cost to calculate CMC
            const symbols = manaCost.match(/\{[^}]+\}/g) || [];
            for (const symbol of symbols) {
              const inner = symbol.slice(1, -1);
              const numeric = parseInt(inner, 10);
              if (!isNaN(numeric)) {
                manaValue += numeric;
              } else if (inner.length === 1 && /[WUBRGC]/.test(inner)) {
                manaValue += 1; // Colored mana symbols count as 1
              } else if (inner.includes("/")) {
                manaValue += 1; // Hybrid symbols count as 1
              }
              // X, Y, Z symbols don't count toward CMC
            }
          }
          
          totalManaValue += manaValue;
        }
      }
      
      if (totalManaValue > 0) {
        reduction.generic += totalManaValue;
        reduction.messages.push(`${cardName}: -{${totalManaValue}} (historic mana value)`);
      }
    }
    
    // Log total reduction
    if (reduction.messages.length > 0) {
      debug(1, `[costReduction] ${cardName}: ${reduction.messages.join(", ")}`);
    }
    
  } catch (err) {
    debugWarn(1, "[costReduction] Error calculating cost reduction:", err);
  }
  
  return reduction;
}

/**
 * Calculate available convoke reduction for a spell
 * Returns list of creatures that can be tapped for convoke and their contribution
 * 
 * Convoke rule: Each creature you tap while casting this spell pays for {1} or one mana of that creature's color.
 * 
 * IMPORTANT: Cards that GRANT convoke to other spells (like Wand of the Worldsoul) should NOT
 * trigger convoke for themselves. We detect this by looking for patterns like:
 * - "the next spell you cast this turn has convoke"
 * - "spells you cast have convoke"
 */
export function calculateConvokeOptions(
  game: any,
  playerId: string,
  card: any
): {
  availableCreatures: Array<{
    id: string;
    name: string;
    colors: string[];
    canTapFor: string[]; // List of mana types this creature can contribute
  }>;
  messages: string[];
} {
  const options = {
    availableCreatures: [] as Array<{
      id: string;
      name: string;
      colors: string[];
      canTapFor: string[];
    }>,
    messages: [] as string[],
  };

  try {
    const battlefield = game.state?.battlefield || [];
    const cardOracleText = (card.oracle_text || "").toLowerCase();

    // Check if card has convoke
    if (!cardOracleText.includes("convoke")) {
      return options;
    }

    // CRITICAL: Exclude cards that GRANT convoke to other spells but don't have it themselves
    // These patterns indicate the card gives convoke to OTHER spells, not itself
    const grantsConvokePatterns = [
      /the next spell you cast[^.]*has convoke/i,           // Wand of the Worldsoul
      /spells you cast[^.]*have convoke/i,                  // General granting pattern
      /creature spells you cast[^.]*have convoke/i,         // Elven Chorus style
      /whenever[^.]*cast[^.]*convoke/i,                     // Triggered grant pattern
      /nontoken creatures you control[^.]*have[^.]*convoke/i, // Creature-based granting
    ];
    
    for (const pattern of grantsConvokePatterns) {
      if (pattern.test(cardOracleText)) {
        // This card grants convoke to other spells, it doesn't have convoke itself
        return options;
      }
    }
    
    // Additional check: If the word "convoke" appears but is NOT in the format of a keyword
    // (i.e., not at the start of a line or after a period), it might be granting convoke
    const convokeKeywordPattern = /(?:^|\.|\n)\s*convoke(?:\s*\(|$|\s)/i;
    if (!convokeKeywordPattern.test(cardOracleText)) {
      // "convoke" appears but not as a standalone keyword - likely grants to another spell
      return options;
    }

    // Find all untapped creatures controlled by the player
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      if (perm.tapped) continue;

      const permTypeLine = (perm.card?.type_line || "").toLowerCase();
      if (!permTypeLine.includes("creature")) continue;

      const permColors = perm.card?.colors || [];
      const canTapFor: string[] = ['generic']; // Can always pay for {1}

      // Add specific colors this creature can contribute
      if (permColors.includes('W')) canTapFor.push('white');
      if (permColors.includes('U')) canTapFor.push('blue');
      if (permColors.includes('B')) canTapFor.push('black');
      if (permColors.includes('R')) canTapFor.push('red');
      if (permColors.includes('G')) canTapFor.push('green');

      // Colorless creatures can only pay generic
      if (permColors.length === 0) {
        canTapFor.push('colorless');
      }

      options.availableCreatures.push({
        id: perm.id,
        name: perm.card?.name || "Unknown Creature",
        colors: permColors,
        canTapFor,
      });
    }

    if (options.availableCreatures.length > 0) {
      options.messages.push(
        `Convoke available: ${options.availableCreatures.length} untapped creature(s)`
      );
    }
  } catch (error) {
    debugError(1, "[calculateConvokeOptions] Error:", error);
  }

  return options;
}

/**
 * Extract creature types from a type line
 */
export function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lower = typeLine.toLowerCase();
  
  // Check for creature types after "ΓÇö" or "-"
  const dashIndex = lower.indexOf("ΓÇö") !== -1 ? lower.indexOf("ΓÇö") : lower.indexOf("-");
  if (dashIndex !== -1) {
    const subtypes = lower.slice(dashIndex + 1).trim().split(/\s+/);
    types.push(...subtypes.filter(t => t.length > 0));
  }
  
  return types;
}

/**
 * Get spell-cast triggers that should fire for a spell being cast
 * Checks battlefield for permanents with spell-cast triggered abilities
 */
function getSpellCastTriggersForCard(game: any, casterId: string, spellCard: any): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const battlefield = game.state?.battlefield || [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
  const isNoncreatureSpell = !isCreatureSpell;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue; // Only controller's permanents trigger
    
    const permTriggers = detectSpellCastTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      let shouldTrigger = false;
      
      switch (trigger.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'creature':
          shouldTrigger = isCreatureSpell;
          break;
        case 'noncreature':
          shouldTrigger = isNoncreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = isInstantOrSorcery;
          break;
        case 'tribal_type':
          // Check if the spell has the required creature type
          if (trigger.tribalType) {
            const spellSubtypes = extractCreatureTypes(spellTypeLine);
            shouldTrigger = spellSubtypes.includes(trigger.tribalType.toLowerCase()) ||
                           spellTypeLine.includes(trigger.tribalType.toLowerCase());
          }
          break;
      }
      
      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Apply spell-cast untap trigger effects (Jeskai Ascendancy, Paradox Engine)
 */
function applySpellCastUntapTrigger(game: any, playerId: string): number {
  const battlefield = game.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.tapped) continue;
    if (permanent.controller !== playerId) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    
    // Untap creatures (Jeskai Ascendancy pattern)
    if (typeLine.includes('creature')) {
      permanent.tapped = false;
      untappedCount++;
    }
  }
  
  return untappedCount;
}

/**
 * Heroic trigger type definition
 */
interface HeroicTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effect: string;
  description: string;
}

/**
 * Get heroic triggers for creatures targeted by a spell
 * Heroic: "Whenever you cast a spell that targets this creature..."
 * 
 * @param game The game instance
 * @param casterId The player who cast the spell
 * @param targetIds The IDs of permanents targeted by the spell
 * @returns Array of heroic triggers to fire
 */
function getHeroicTriggers(game: any, casterId: string, targetIds: string[]): HeroicTrigger[] {
  const triggers: HeroicTrigger[] = [];
  const battlefield = game.state?.battlefield || [];
  
  if (!targetIds || targetIds.length === 0) return triggers;
  
  for (const targetId of targetIds) {
    const permanent = battlefield.find((p: any) => p?.id === targetId);
    if (!permanent || !permanent.card) continue;
    
    // Heroic only triggers on creatures you control
    if (permanent.controller !== casterId) continue;
    
    const typeLine = (permanent.card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const oracleText = (permanent.card.oracle_text || '');
    const lowerOracle = oracleText.toLowerCase();
    
    // Check for heroic pattern: "Heroic ΓÇö Whenever you cast a spell that targets ~"
    // Must match the specific keyword ability format with em-dash or colon
    // Also check for non-keyworded heroic: "Whenever you cast a spell that targets this creature"
    const heroicKeywordMatch = /heroic\s*[ΓÇö:\-]/i.test(oracleText);
    const hasTargetTrigger = lowerOracle.includes('whenever you cast a spell that targets') && 
                             (lowerOracle.includes('this creature') || lowerOracle.includes('~'));
    
    if (heroicKeywordMatch || hasTargetTrigger) {
      // Extract the effect text - handle multi-sentence effects by capturing until end of ability
      let effectText = '';
      
      // Try to match heroic pattern with em-dash/colon - capture everything after the trigger condition
      // Use a more permissive pattern that captures until newline or end of text
      const heroicMatch = oracleText.match(/heroic\s*[ΓÇö:\-]\s*whenever you cast a spell that targets [^,\n]+,?\s*(.+?)(?:\n|$)/i);
      if (heroicMatch) {
        effectText = heroicMatch[1].trim();
      } else {
        // Try generic pattern for non-keyworded heroic
        const genericMatch = oracleText.match(/whenever you cast a spell that targets (?:this creature|~),?\s*(.+?)(?:\n|$)/i);
        if (genericMatch) {
          effectText = genericMatch[1].trim();
        }
      }
      
      if (effectText) {
        triggers.push({
          permanentId: permanent.id,
          cardName: permanent.card.name || 'Unknown',
          controllerId: permanent.controller,
          effect: effectText,
          description: `Heroic ΓÇö Whenever you cast a spell that targets ${permanent.card.name}, ${effectText}`,
        });
      }
    }
  }
  
  return triggers;
}

/**
 * Apply heroic trigger effects
 * 
 * @param game The game instance
 * @param trigger The heroic trigger to apply
 * @param io Socket.io server instance
 * @param gameId The game ID
 */
function applyHeroicTrigger(game: any, trigger: HeroicTrigger, io: any, gameId: string): void {
  const effectLower = trigger.effect.toLowerCase();
  const battlefield = game.state?.battlefield || [];
  
  // Find the permanent that has the heroic ability
  const permanent = battlefield.find((p: any) => p?.id === trigger.permanentId);
  if (!permanent) return;
  
  // Common heroic effects:
  
  // "+1/+1 counter" pattern (Favored Hoplite, Hero of Leina Tower, Phalanx Leader, etc.)
  if (effectLower.includes('+1/+1 counter') || effectLower.includes('put a +1/+1 counter')) {
    permanent.counters = permanent.counters || {};
    permanent.counters['+1/+1'] = (permanent.counters['+1/+1'] || 0) + 1;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${trigger.cardName}'s Heroic triggers! Put a +1/+1 counter on ${trigger.cardName}.`,
      ts: Date.now(),
    });
    return;
  }
  
  // "draw a card" pattern (Sage of Hours, etc.)
  if (effectLower.includes('draw a card') || effectLower.includes('draw cards')) {
    if (typeof game.drawCards === 'function') {
      game.drawCards(trigger.controllerId, 1);
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${trigger.cardName}'s Heroic triggers! ${getPlayerName(game, trigger.controllerId)} draws a card.`,
        ts: Date.now(),
      });
    }
    return;
  }
  
  // "scry" pattern (Battlewise Hoplite)
  if (effectLower.includes('scry')) {
    const scryMatch = effectLower.match(/scry (\d+)/);
    const scryAmount = scryMatch ? parseInt(scryMatch[1], 10) : 1;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${trigger.cardName}'s Heroic triggers! ${getPlayerName(game, trigger.controllerId)} may scry ${scryAmount}.`,
      ts: Date.now(),
    });
    // Note: Full scry implementation requires UI interaction
    return;
  }
  
  // "gains first strike" or "gains [keyword]" until end of turn
  if (effectLower.includes('gains ') && effectLower.includes('until end of turn')) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${trigger.cardName}'s Heroic triggers! ${trigger.effect}`,
      ts: Date.now(),
    });
    // Note: Temporary keyword grants would need more complex tracking
    return;
  }
  
  // "+X/+X" or "gets +X/+X" until end of turn
  const pumpMatch = effectLower.match(/gets? \+(\d+)\/\+(\d+)/);
  if (pumpMatch) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${trigger.cardName}'s Heroic triggers! ${trigger.cardName} gets +${pumpMatch[1]}/+${pumpMatch[2]} until end of turn.`,
      ts: Date.now(),
    });
    // Note: Temporary pump effects would need end-of-turn cleanup
    return;
  }
  
  // Default: just announce the trigger
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${trigger.cardName}'s Heroic triggers! ${trigger.effect}`,
    ts: Date.now(),
  });
}

/**
 * Apply cost reduction to a parsed mana cost
 */
export function applyCostReduction(
  parsedCost: { generic: number; colors: Record<string, number> },
  reduction: { generic: number; colors: Record<string, number>; messages?: string[] }
): { generic: number; colors: Record<string, number> } {
  const result = {
    generic: Math.max(0, parsedCost.generic - reduction.generic),
    colors: { ...parsedCost.colors },
  };
  
  // Apply color reductions (can reduce to 0 but not below)
  for (const color of Object.keys(result.colors)) {
    if (reduction.colors[color]) {
      result.colors[color] = Math.max(0, result.colors[color] - reduction.colors[color]);
    }
  }
  
  return result;
}

/**
 * Check if a creature has haste (either inherently or from effects)
 * Rule 702.10: Haste allows a creature to attack and use tap abilities immediately
 * 
 * Sources of haste:
 * - Creature's own oracle text containing "haste"
 * - Granted abilities on the permanent (from other effects)
 * - Battlefield permanents that grant haste to creatures (e.g., "creatures you control have haste")
 * - Specific creature type grants (e.g., "Goblin creatures you control have haste")
 * - Equipment attached to the creature (e.g., "Equipped creature has haste")
 * 
 * @param permanent - The creature permanent to check
 * @param battlefield - Array of all battlefield permanents
 * @param controller - The controller of the creature
 * @returns true if the creature has haste
 */
export function creatureHasHaste(permanent: any, battlefield: any[], controller: string): boolean {
  try {
    const permCard = permanent?.card || {};
    const permTypeLine = (permCard.type_line || "").toLowerCase();
    const permOracleText = (permCard.oracle_text || "").toLowerCase();
    
    // 1. Check creature's own oracle text
    if (permOracleText.includes('haste')) {
      return true;
    }
    
    // 2. Check granted abilities on the permanent
    const grantedAbilities = permanent?.grantedAbilities || [];
    if (Array.isArray(grantedAbilities) && grantedAbilities.some((a: string) => 
      a && a.toLowerCase().includes('haste')
    )) {
      return true;
    }
    
    // 3. Check attached equipment for haste grants (e.g., Lightning Greaves, Swiftfoot Boots)
    // Pattern: "Equipped creature has haste" or "Equipped creature has shroud and haste"
    
    // Helper function to detect if equipment/aura grants haste
    const equipmentGrantsHaste = (equipOracle: string): boolean => {
      if (!equipOracle.includes('equipped creature') && !equipOracle.includes('enchanted creature')) {
        return false;
      }
      return equipOracle.includes('has haste') || 
             equipOracle.includes('have haste') ||
             equipOracle.includes('gains haste') ||
             /(?:equipped|enchanted) creature has (?:[\w\s,]+\s+and\s+)?haste/i.test(equipOracle);
    };
    
    const attachedEquipment = permanent?.attachedEquipment || [];
    for (const equipId of attachedEquipment) {
      const equipment = battlefield.find((p: any) => p.id === equipId);
      if (equipment && equipment.card) {
        const equipOracle = (equipment.card.oracle_text || "").toLowerCase();
        if (equipmentGrantsHaste(equipOracle)) {
          return true;
        }
      }
    }
    
    // Also check by attachedTo relationship (in case attachedEquipment isn't set)
    if (permanent.id) {
      for (const equip of battlefield) {
        if (!equip || !equip.card) continue;
        const equipTypeLine = (equip.card.type_line || "").toLowerCase();
        if (!equipTypeLine.includes('equipment') && !equipTypeLine.includes('aura')) continue;
        if (equip.attachedTo !== permanent.id) continue;
        
        const equipOracle = (equip.card.oracle_text || "").toLowerCase();
        if (equipmentGrantsHaste(equipOracle)) {
          return true;
        }
      }
    }
    
    // 4. Check battlefield for permanents that grant haste
    for (const perm of battlefield) {
      if (!perm || !perm.card) continue;
      
      const grantorOracle = (perm.card.oracle_text || "").toLowerCase();
      const grantorController = perm.controller;
      
      // Only check permanents that could grant haste to this creature
      // Common patterns: "creatures you control have haste", "Goblin creatures you control have haste"
      
      // Check for global "creatures you control have haste" effects
      if (grantorController === controller) {
        if (grantorOracle.includes('creatures you control have haste') ||
            grantorOracle.includes('other creatures you control have haste')) {
          return true;
        }
        
        // Check for "activate abilities... as though... had haste" effects
        // This covers Thousand-Year Elixir: "You may activate abilities of creatures 
        // you control as though those creatures had haste."
        if (grantorOracle.includes('as though') && 
            grantorOracle.includes('had haste') &&
            (grantorOracle.includes('creatures you control') || 
             grantorOracle.includes('activate abilities'))) {
          return true;
        }
        
        // Check for tribal haste grants (e.g., "Goblin creatures you control have haste")
        // Optimization: Use indexOf instead of creating RegExp for each creature type
        const creatureTypes = extractCreatureTypes(permTypeLine);
        for (const creatureType of creatureTypes) {
          const typeIndex = grantorOracle.indexOf(creatureType);
          const hasteIndex = grantorOracle.indexOf('have haste');
          // Check if creature type appears before "have haste" with no period between them
          if (typeIndex !== -1 && hasteIndex !== -1 && typeIndex < hasteIndex) {
            const textBetween = grantorOracle.slice(typeIndex, hasteIndex);
            if (!textBetween.includes('.')) {
              return true;
            }
          }
        }
        
        // Check for "all creatures have haste" (rare but exists)
        if (grantorOracle.includes('all creatures have haste')) {
          return true;
        }
        
        // Check for token-specific haste grants with turn restrictions
        // Pattern: "During your turn, creature tokens you control ... have haste"
        const isToken = permanent?.isToken === true;
        if (isToken && grantorOracle.includes('creature tokens you control') && 
            grantorOracle.includes('have haste')) {
          // Check if there's a turn restriction
          if (grantorOracle.includes('during your turn')) {
            // We don't have access to turn player in this function, so we can't reliably
            // determine if it's the controller's turn. This function is typically called
            // during combat declaration which only happens on your own turn anyway.
            // The caller should handle turn restrictions if needed.
            // For attacking/tapping purposes, this is typically called during your turn.
            // Return true here - the combat system will validate turn timing separately.
            return true;
          } else {
            // No turn restriction, always grants haste
            return true;
          }
        }
      }
      
      // Check for effects that grant haste to all creatures (both players)
      if (grantorOracle.includes('all creatures have haste') ||
          grantorOracle.includes('each creature has haste')) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, '[creatureHasHaste] Error checking haste:', err);
    return false;
  }
}

/**
 * Check if a permanent has a given keyword ability from any source
 * This includes:
 * - The permanent's own oracle text
 * - Granted abilities array
 * - Equipment attached to the permanent
 * - Auras attached to the permanent
 * - Global effects from other permanents on the battlefield
 * 
 * @param permanent - The permanent to check
 * @param battlefield - Array of all battlefield permanents
 * @param controller - The controller of the permanent
 * @param keyword - The keyword to check for (e.g., 'haste', 'vigilance', 'shroud', 'hexproof')
 * @returns true if the permanent has the keyword ability
 */
export function permanentHasKeyword(permanent: any, battlefield: any[], controller: string, keyword: string): boolean {
  try {
    const lowerKeyword = keyword.toLowerCase();
    const permCard = permanent?.card || {};
    const permTypeLine = (permCard.type_line || "").toLowerCase();
    const permOracleText = (permCard.oracle_text || "").toLowerCase();
    
    // 1. Check permanent's own oracle text
    const keywordRegex = new RegExp(`\\b${lowerKeyword}\\b`, 'i');
    if (keywordRegex.test(permOracleText)) {
      return true;
    }
    
    // 2. Check granted abilities on the permanent
    const grantedAbilities = permanent?.grantedAbilities || [];
    if (Array.isArray(grantedAbilities) && grantedAbilities.some((a: string) => 
      a && a.toLowerCase().includes(lowerKeyword)
    )) {
      return true;
    }
    
    // 3. Check attached equipment and auras for keyword grants
    // Pattern: "Equipped/Enchanted creature has [keyword]" or "Equipped/Enchanted creature has [ability] and [keyword]"
    // Pre-compile regex for efficiency
    const equipmentKeywordRegex = new RegExp(
      `(?:equipped|enchanted) creature (?:has|gains?) (?:[\\w\\s,]+\\s+and\\s+)?${lowerKeyword}`,
      'i'
    );
    
    const attachmentGrantsKeyword = (attachmentOracle: string): boolean => {
      if (!attachmentOracle.includes('equipped creature') && !attachmentOracle.includes('enchanted creature')) {
        return false;
      }
      return equipmentKeywordRegex.test(attachmentOracle);
    };
    
    // Check attachedEquipment array
    const attachedEquipment = permanent?.attachedEquipment || [];
    for (const equipId of attachedEquipment) {
      const equipment = battlefield.find((p: any) => p.id === equipId);
      if (equipment && equipment.card) {
        const equipOracle = (equipment.card.oracle_text || "").toLowerCase();
        if (attachmentGrantsKeyword(equipOracle)) {
          return true;
        }
      }
    }
    
    // Also check by attachedTo relationship (in case attachedEquipment isn't set)
    if (permanent.id) {
      for (const attachment of battlefield) {
        if (!attachment || !attachment.card) continue;
        const attachTypeLine = (attachment.card.type_line || "").toLowerCase();
        if (!attachTypeLine.includes('equipment') && !attachTypeLine.includes('aura')) continue;
        if (attachment.attachedTo !== permanent.id) continue;
        
        const attachOracle = (attachment.card.oracle_text || "").toLowerCase();
        if (attachmentGrantsKeyword(attachOracle)) {
          return true;
        }
      }
    }
    
    // 4. Check battlefield for permanents that grant the keyword globally
    for (const perm of battlefield) {
      if (!perm || !perm.card) continue;
      
      const grantorOracle = (perm.card.oracle_text || "").toLowerCase();
      const grantorController = perm.controller;
      
      // Only check permanents controlled by the same player
      if (grantorController === controller) {
        // Global grants: "creatures you control have [keyword]"
        if (grantorOracle.includes(`creatures you control have ${lowerKeyword}`) ||
            grantorOracle.includes(`other creatures you control have ${lowerKeyword}`)) {
          return true;
        }
        
        // Check for tribal grants (e.g., "Goblin creatures you control have haste")
        const creatureTypes = extractCreatureTypes(permTypeLine);
        for (const creatureType of creatureTypes) {
          const typeIndex = grantorOracle.indexOf(creatureType);
          const keywordIndex = grantorOracle.indexOf(`have ${lowerKeyword}`);
          if (typeIndex !== -1 && keywordIndex !== -1 && typeIndex < keywordIndex) {
            const textBetween = grantorOracle.slice(typeIndex, keywordIndex);
            if (!textBetween.includes('.')) {
              return true;
            }
          }
        }
        
        // Check for "all creatures have [keyword]" (rare but exists)
        if (grantorOracle.includes(`all creatures have ${lowerKeyword}`)) {
          return true;
        }
        
        // Check for token-specific keyword grants with turn restrictions
        // Pattern: "During your turn, creature tokens you control ... have [keyword]"
        // Examples: Mite Overseer ("During your turn, creature tokens you control get +1/+0 and have first strike.")
        const isToken = permanent?.isToken === true;
        if (isToken) {
          // Pattern with turn restriction
          const tokenTurnKeywordPattern = new RegExp(
            `during your turn,?\\s*creature tokens you control.*?have.*?\\b${lowerKeyword}\\b`,
            'i'
          );
          if (tokenTurnKeywordPattern.test(grantorOracle)) {
            // This function doesn't have direct access to game state, so we check if
            // it's the controller's turn by looking at the permanent's controller.
            // Since keyword checks are typically done during combat or ability resolution,
            // and the turn restriction only matters during the controller's turn,
            // this is a reasonable approximation. The caller (combat resolution, etc.)
            // can further validate turn timing if needed.
            // For now, we return true for the controller's tokens during their effects.
            return true;
          }
          
          // Pattern without turn restriction: "creature tokens you control have [keyword]"
          if (grantorOracle.includes(`creature tokens you control`) && 
              grantorOracle.includes(`have ${lowerKeyword}`) &&
              !grantorOracle.includes('during your turn')) {
            return true;
          }
        }
      }
      
      // Check for effects that grant to all creatures (both players)
      if (grantorOracle.includes(`all creatures have ${lowerKeyword}`) ||
          grantorOracle.includes(`each creature has ${lowerKeyword}`)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, `[permanentHasKeyword] Error checking ${keyword}:`, err);
    return false;
  }
}

/**
 * Check if a card has the Miracle ability and extract the miracle cost
 * Rule 702.94 - Miracle allows casting a spell for its miracle cost if it's the first card drawn this turn
 * 
 * @param card The card to check
 * @returns Object with hasMiracle boolean and miracleCost string if applicable
 */
function checkMiracle(card: any): { hasMiracle: boolean; miracleCost: string | null } {
  if (!card) return { hasMiracle: false, miracleCost: null };
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for miracle keyword
  if (!oracleText.includes('miracle')) {
    return { hasMiracle: false, miracleCost: null };
  }
  
  // Extract miracle cost - pattern: "Miracle {cost}" or "miracleΓÇö{cost}"
  // Handles regular mana symbols, X costs, hybrid mana like {w/u}, and Phyrexian mana like {w/p}
  const miracleMatch = oracleText.match(/miracle[ΓÇöΓÇô\s]*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (miracleMatch) {
    return { hasMiracle: true, miracleCost: miracleMatch[1] };
  }
  
  // Alternative pattern - broader mana symbol matching
  // Includes: numbers (1-20), WUBRGC colors, X costs, hybrid (w/u), Phyrexian (w/p)
  const altMatch = oracleText.match(/miracle\s+(\{(?:[wubrgcx]|[0-9]+|[wubrg]\/[wubrgp])\}(?:\{(?:[wubrgcx]|[0-9]+|[wubrg]\/[wubrgp])\})*)/i);
  if (altMatch) {
    return { hasMiracle: true, miracleCost: altMatch[1] };
  }
  
  return { hasMiracle: true, miracleCost: null };
}

/**
 * Check drawn cards for miracle ability and emit prompt to player
 * 
 * @param io Socket.io server
 * @param game Game instance
 * @param gameId Game ID
 * @param playerId Player who drew the cards
 * @param drawnCards Array of cards drawn
 */
function checkAndPromptMiracle(
  io: Server, 
  game: any, 
  gameId: string, 
  playerId: string, 
  drawnCards: any[]
): void {
  if (!drawnCards || drawnCards.length === 0) return;
  
  // Only the first card drawn can trigger miracle
  const firstCard = drawnCards[0];
  if (!firstCard || !firstCard.isFirstDrawnThisTurn) return;
  
  const { hasMiracle, miracleCost } = checkMiracle(firstCard);
  if (!hasMiracle) return;
  
  // Emit miracle prompt to the player
  const cardName = firstCard.name || "Unknown Card";
  const cardImageUrl = firstCard.image_uris?.small || firstCard.image_uris?.normal;
  
  debug(2, `[miracle] ${cardName} was drawn as first card this turn - prompting for miracle cost ${miracleCost}`);

  const existing = ResolutionQueueManager
    .getStepsForPlayer(gameId, playerId as any)
    .find((s: any) => (s as any)?.miraclePrompt === true && String((s as any)?.miracleCardId || '') === String(firstCard.id));

  if (!existing) {
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as any,
      sourceId: String(firstCard.id),
      sourceName: cardName,
      sourceImage: cardImageUrl,
      description: `Miracle: You may cast ${cardName} for ${miracleCost || 'its miracle cost'}.`,
      mandatory: false,
      options: [
        { id: 'cast_miracle', label: `Cast for Miracle ${miracleCost ? `(${miracleCost})` : ''}`.trim() },
        { id: 'decline', label: "Don't cast" },
      ],
      minSelections: 1,
      maxSelections: 1,

      miraclePrompt: true,
      miracleCardId: String(firstCard.id),
      miracleCost: miracleCost || '',
      normalCost: firstCard.mana_cost || '',
    } as any);
  }
}

export async function requestCastSpellForSocket(
  io: Server,
  socket: Socket,
  { gameId, cardId, faceIndex }: { gameId: string; cardId: string; faceIndex?: number },
  options?: {
    skipPriorityCheck?: boolean;
    forcedAlternateCostId?: string;
    skipMutateModePrompt?: boolean;
  }
): Promise<void> {
  try {
    debug(2, `[requestCastSpell] ======== REQUEST START ========`);
    debug(2, `[requestCastSpell] gameId: ${gameId}, cardId: ${cardId}, faceIndex: ${faceIndex}`);

    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) {
      debug(1, `[requestCastSpell] ERROR: game or playerId not found`);
      return;
    }

    debug(2, `[requestCastSpell] playerId: ${playerId}, priority: ${game.state.priority}`);

    // Basic validation (same as castSpellFromHand)
    const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
    if (phaseStr === "" || phaseStr === "PRE_GAME") {
      socket.emit("error", {
        code: "PREGAME_NO_CAST",
        message: "Cannot cast spells during pre-game.",
      });
      return;
    }

    if (options?.skipPriorityCheck !== true && game.state.priority !== playerId) {
      socket.emit("error", {
        code: "NO_PRIORITY",
        message: "You don't have priority",
      });
      return;
    }

    // Split Second: players can't cast spells while a split-second spell is on the stack.
    const splitSecondLockActive = Array.isArray((game.state as any)?.stack) && (game.state as any).stack.some((item: any) => {
      const c = item?.card ?? item?.spell?.card ?? item?.sourceCard ?? item?.source?.card;
      const keywords = Array.isArray(c?.keywords) ? c.keywords : [];
      const ot = String(c?.oracle_text || '').toLowerCase();
      return keywords.some((k: any) => String(k).toLowerCase() === 'split second') || ot.includes('split second');
    });
    if (splitSecondLockActive) {
      socket.emit('error', {
        code: 'SPLIT_SECOND_LOCK',
        message: "Can't cast spells while a spell with split second is on the stack.",
      });
      return;
    }

    const zones = game.state.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) {
      socket.emit("error", { code: "NO_HAND", message: "Hand not found" });
      return;
    }

    const cardInHand = (zones.hand as any[]).find((c: any) => c && c.id === cardId);
    if (!cardInHand) {
      socket.emit("error", { code: "CARD_NOT_IN_HAND", message: "Card not found in hand" });
      return;
    }

    const typeLine = (cardInHand.type_line || "").toLowerCase();
    const layout = (cardInHand.layout || "").toLowerCase();
    const cardFaces = cardInHand.card_faces;

    // Transform cards: only front face can be cast.
    if (layout === 'transform' && Array.isArray(cardFaces) && cardFaces.length >= 2) {
      if (faceIndex === 1) {
        socket.emit("error", {
          code: "TRANSFORM_BACK_FACE",
          message: `${cardFaces[1]?.name || "This card"} is a transform back face and cannot be cast from hand. Cast the front face (${cardFaces[0]?.name || "the card"}) instead.`,
        });
        return;
      }

      const frontFaceTypeLine = (cardFaces[0]?.type_line || "").toLowerCase();
      if (frontFaceTypeLine.includes("land")) {
        socket.emit("error", {
          code: "CANNOT_CAST_LAND",
          message: `${cardFaces[0]?.name || "This card"} is a land and cannot be cast as a spell. Use "Play Land" instead.`,
        });
        return;
      }
    }

    if (typeLine.includes("land") && layout !== 'transform') {
      socket.emit("error", { code: "CANNOT_CAST_LAND", message: "Lands cannot be cast as spells." });
      return;
    }

    // Get oracle text (possibly from card face if split/adventure)
    let oracleText = (cardInHand.oracle_text || "").toLowerCase();
    let manaCost = cardInHand.mana_cost || "";
    let cardName = cardInHand.name || "Card";
    let faceTypeLine = typeLine;

    if (faceIndex !== undefined && Array.isArray(cardFaces)) {
      if (faceIndex < 0 || faceIndex >= cardFaces.length) {
        socket.emit("error", {
          code: "INVALID_FACE_INDEX",
          message: `Invalid face index: ${faceIndex}`,
        });
        return;
      }
      const face = cardFaces[faceIndex];
      if (face) {
        oracleText = (face.oracle_text || "").toLowerCase();
        manaCost = face.mana_cost || manaCost;
        cardName = face.name || cardName;
        faceTypeLine = (face.type_line || "").toLowerCase();
      }
    } else if (layout === 'transform' && Array.isArray(cardFaces) && cardFaces.length >= 2) {
      const frontFace = cardFaces[0];
      if (frontFace) {
        oracleText = (frontFace.oracle_text || "").toLowerCase();
        manaCost = frontFace.mana_cost || manaCost;
        cardName = frontFace.name || cardName;
        faceTypeLine = (frontFace.type_line || "").toLowerCase();
      }
    }

    // Forced alternate cost (Miracle / Mutate)
    if (options?.forcedAlternateCostId === 'miracle') {
      if (!cardInHand.isFirstDrawnThisTurn) {
        socket.emit('error', {
          code: 'NOT_FIRST_DRAWN',
          message: 'Miracle can only be cast on the first card drawn this turn',
        });
        return;
      }

      const miracleInfo = checkMiracle(cardInHand);
      if (!miracleInfo.hasMiracle || !miracleInfo.miracleCost) {
        socket.emit('error', {
          code: 'NO_MIRACLE',
          message: 'This card does not have miracle',
        });
        return;
      }

      manaCost = miracleInfo.miracleCost;
    }

    // Mutate alternate cost: override mana cost now; target selection is handled via a dedicated step.
    const isForcedMutate = options?.forcedAlternateCostId === 'mutate';
    if (isForcedMutate) {
      const mutateCost = parseMutateCost(oracleText) || parseMutateCost(cardInHand.oracle_text || '');
      if (!mutateCost) {
        socket.emit('error', { code: 'NO_MUTATE', message: 'This card does not have mutate.' });
        return;
      }
      manaCost = mutateCost;
    }

    // Effective type line for the face being cast (used by several downstream checks)
    const effectiveTypeLine = faceTypeLine || typeLine;
    const isInstantOrSorcery = effectiveTypeLine.includes('instant') || effectiveTypeLine.includes('sorcery');

    // Mutate casting-mode prompt (for mutate creatures).
    // Mutate reminder text lives on the card, but a creature spell only targets when cast for its mutate cost.
    // We prompt once here to choose normal vs mutate.
    if (
      options?.skipMutateModePrompt !== true &&
      options?.forcedAlternateCostId == null &&
      !isInstantOrSorcery &&
      effectiveTypeLine.includes('creature')
    ) {
      const ctx: any = { state: game.state };
      const hasMutate = /\bmutate\b/i.test(String(oracleText || ''));
      const mutateCost = hasMutate ? (parseMutateCost(oracleText) || parseMutateCost(cardInHand.oracle_text || '')) : undefined;
      const canMutate = Boolean(mutateCost) && hasMutateAlternateCost(ctx, playerId as any, cardInHand as any);

      if (canMutate) {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.OPTION_CHOICE && (s as any)?.mutateCastModeChoice === true && String((s as any)?.mutateCardId || '') === String(cardId));

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: playerId as any,
            sourceId: String(cardId),
            sourceName: cardName,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: `Choose how to cast ${cardName}.`,
            mandatory: true,
            options: [
              { id: 'cast_normal', label: 'Cast Normally' },
              { id: 'cast_mutate', label: `Cast with Mutate${mutateCost ? ` (${mutateCost})` : ''}` },
            ],
            minSelections: 1,
            maxSelections: 1,

            mutateCastModeChoice: true,
            mutateCardId: String(cardId),
            mutateFaceIndex: faceIndex,
            mutateCost,
          } as any);
        }

        debug(2, `[requestCastSpell] Queued mutate casting-mode choice for ${cardName}`);
        return;
      }
    }

    // Check if this spell requires targets
    const isAura = effectiveTypeLine.includes("aura") && /^enchant\s+/i.test(oracleText);
    const spellSpec = (isInstantOrSorcery && !isAura) ? categorizeSpell(cardName, oracleText) : null;
    const targetReqs = (isInstantOrSorcery && !isAura) ? parseTargetRequirements(oracleText) : null;

    const needsTargets = (spellSpec && spellSpec.minTargets > 0) ||
      (targetReqs && targetReqs.needsTargets) ||
      isAura;

    const effectId = `cast_${cardId}_${Date.now()}`;

    // Forced Mutate: use dedicated mutate target selection regardless of card type.
    if (isForcedMutate) {
      const effectId = `cast_${cardId}_${Date.now()}`;
      const ctx: any = { state: game.state };
      const valid = getValidMutateTargets(ctx, playerId as any);

      if (valid.length === 0) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: `No valid mutate targets for ${cardName}`,
        });
        return;
      }

      const costReduction = calculateCostReduction(game, playerId, cardInHand);
      const convokeOptions = calculateConvokeOptions(game, playerId, cardInHand);

      (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
      (game.state as any).pendingSpellCasts[effectId] = {
        cardId,
        cardName,
        manaCost,
        playerId,
        faceIndex,
        validTargetIds: valid.map((t: any) => String(t.permanentId)),
        card: { ...cardInHand },
        forcedAlternateCostId: 'mutate',
        mutateCost: manaCost,
        costReduction: costReduction.messages.length > 0 ? costReduction : undefined,
        convokeOptions: convokeOptions.availableCreatures.length > 0 ? convokeOptions : undefined,
      };

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MUTATE_TARGET_SELECTION,
        playerId: playerId as any,
        sourceId: effectId,
        sourceName: cardName,
        sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
        description: `Choose a creature to mutate onto for ${cardName}.`,
        mandatory: true,

        effectId,
        cardId,
        cardName,
        mutateCost: manaCost,
        imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
        validTargets: valid.map((t: any) => {
          const perm: any = (game.state.battlefield || []).find((p: any) => p && String(p.id) === String(t.permanentId));
          return {
            id: String(t.permanentId),
            name: String(t.cardName || 'Creature'),
            typeLine: String(t.typeLine || ''),
            power: t.power,
            toughness: t.toughness,
            imageUrl: t.imageUrl,
            controller: String(t.controller || ''),
            owner: String(t.owner || ''),
            isAlreadyMutated: Boolean((perm as any)?.mutatedStack),
            mutationCount: Number((perm as any)?.mutatedStack?.length || 0),
          };
        }),
      } as any);

      debug(2, `[requestCastSpell] Added MUTATE_TARGET_SELECTION step to Resolution Queue for ${cardName} (effectId: ${effectId}, ${valid.length} valid targets)`);
      return;
    }

    if (needsTargets) {
      let validTargetList: { id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string }[] = [];

      if (isAura) {
        const auraMatch = oracleText.match(/enchant\s+(creature|permanent|player|artifact|land|opponent)/i);
        const auraTargetType = auraMatch ? auraMatch[1].toLowerCase() : 'creature';

        if (auraTargetType === 'player' || auraTargetType === 'opponent') {
          validTargetList = (game.state.players || [])
            .filter((p: any) => auraTargetType !== 'opponent' || p.id !== playerId)
            .map((p: any) => ({
              id: p.id,
              kind: 'player',
              name: p.name || p.id,
              isOpponent: p.id !== playerId,
            }));
        } else {
          validTargetList = (game.state.battlefield || [])
            .filter((p: any) => {
              const tl = (p.card?.type_line || '').toLowerCase();
              if (auraTargetType === 'permanent') return true;
              return tl.includes(auraTargetType);
            })
            .map((p: any) => ({
              id: p.id,
              kind: 'permanent',
              name: p.card?.name || 'Unknown',
              controller: p.controller,
              isOpponent: p.controller !== playerId,
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));
        }
      } else if (spellSpec) {
        const validRefs = evaluateTargeting(game.state as any, playerId, spellSpec);
        validTargetList = validRefs.map((t: any) => {
          if (t.kind === 'permanent') {
            const perm = (game.state.battlefield || []).find((p: any) => p.id === t.id);
            return {
              id: t.id,
              kind: t.kind,
              name: perm?.card?.name || 'Unknown',
              imageUrl: perm?.card?.image_uris?.small || perm?.card?.image_uris?.normal,
              controller: perm?.controller,
              typeLine: perm?.card?.type_line,
              isOpponent: perm?.controller !== playerId,
            };
          } else {
            const player = (game.state.players || []).find((p: any) => p.id === t.id);
            return {
              id: t.id,
              kind: t.kind,
              name: player?.name || t.id,
              life: player?.life,
              isOpponent: t.id !== playerId,
            };
          }
        });
      }

      if (validTargetList.length === 0) {
        if ((game.state as any).pendingSpellCasts?.[effectId]) {
          delete (game.state as any).pendingSpellCasts[effectId];
        }

        socket.emit("error", {
          code: "NO_VALID_TARGETS",
          message: `No valid targets for ${cardName}`,
        });
        return;
      }

      (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
      (game.state as any).pendingSpellCasts[effectId] = {
        cardId,
        cardName,
        manaCost,
        playerId,
        faceIndex,
        validTargetIds: validTargetList.map((t: any) => t.id),
        card: { ...cardInHand },
        forcedAlternateCostId: options?.forcedAlternateCostId,
      };

      const additionalCost = detectAdditionalCost(oracleText);
      if (additionalCost?.type === 'blight') {
        const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
        if (!pendingCast) {
          debugWarn(1, `[requestCastSpell] Missing pendingSpellCasts for effectId ${effectId} (blight additional cost)`);
        } else {
          const blightIsX = Boolean((additionalCost as any).blightIsX);
          const blightN = Number((additionalCost as any).blightN || 0);
          const blightOrPayCost = String((additionalCost as any).blightOrPayCost || '').trim() || undefined;
          const blightIsOptional = Boolean((additionalCost as any).blightIsOptional);

          if (blightIsX) {
            delete (game.state as any).pendingSpellCasts[effectId];
            socket.emit('error', {
              code: 'UNSUPPORTED_ADDITIONAL_COST',
              message: `Additional cost "Blight X" is not supported yet for ${cardName}.`,
            });
            return;
          }

          const battlefieldNow = game.state?.battlefield || [];
          const validBlightTargets = battlefieldNow
            .filter((p: any) => p && String(p.controller || '') === String(playerId))
            .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
            .map((p: any) => ({
              id: p.id,
              label: p.card?.name || 'Creature',
              description: p.card?.type_line || 'creature',
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));

          pendingCast.additionalCostPaid = false;
          pendingCast.additionalCostMethod = 'none';

          if (blightOrPayCost) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.OPTION_CHOICE,
              playerId: playerId as PlayerID,
              description: `Additional cost for ${cardName}: Choose how to pay`,
              mandatory: true,
              sourceId: effectId,
              sourceName: cardName,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              options: [
                {
                  id: 'blight_cost',
                  label: `Blight ${blightN}`,
                  description: `Put ${blightN} -1/-1 counter${blightN === 1 ? '' : 's'} on a creature you control.`,
                },
                {
                  id: 'pay_mana_cost',
                  label: `Pay ${blightOrPayCost}`,
                  description: `Pay ${blightOrPayCost} as the additional cost.`,
                },
              ],
              minSelections: 1,
              maxSelections: 1,
              spellAdditionalCostBlightOrPay: true,
              spellAdditionalCostEffectId: effectId,
              spellAdditionalCostCardName: cardName,
              spellAdditionalCostBlightN: blightN,
              spellAdditionalCostOrPay: blightOrPayCost,
            } as any);
          } else {
            if (validBlightTargets.length === 0) {
              if (blightIsOptional) {
                pendingCast.additionalCostPaid = false;
                pendingCast.additionalCostMethod = 'none';
              } else {
                delete (game.state as any).pendingSpellCasts[effectId];
                socket.emit('error', {
                  code: 'CANNOT_PAY_COST',
                  message: `Cannot cast ${cardName}: You must blight ${blightN}, but you control no creatures.`,
                });
                return;
              }
            } else {
              ResolutionQueueManager.addStep(gameId, {
                type: ResolutionStepType.TARGET_SELECTION,
                playerId: playerId as PlayerID,
                description: `Additional cost for ${cardName}: Blight ${blightN}${blightIsOptional ? ' (optional)' : ''}`,
                mandatory: !blightIsOptional,
                sourceId: effectId,
                sourceName: cardName,
                sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
                validTargets: validBlightTargets,
                targetTypes: ['creature'],
                minTargets: 1,
                maxTargets: 1,
                targetDescription: 'creature you control',
                keywordBlight: true,
                keywordBlightStage: 'cast_additional_cost',
                keywordBlightController: playerId,
                keywordBlightN: blightN,
                keywordBlightSourceName: `${cardName} — Additional Cost (Blight ${blightN})`,
                keywordBlightEffectId: effectId,
                keywordBlightOptional: blightIsOptional,
              } as any);
            }
          }
        }
      }

      const targetDescription = spellSpec?.targetDescription || targetReqs?.targetDescription || 'target';
      const requiredMinTargets = spellSpec?.minTargets || targetReqs?.minTargets || 1;
      const requiredMaxTargets = spellSpec?.maxTargets || targetReqs?.maxTargets || 1;

      const modal = oracleText ? extractModalModesFromOracleText(oracleText) : undefined;
      if (modal && modal.allOptionsHaveTargets) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MODE_SELECTION,
          playerId: playerId as PlayerID,
          description: `Choose a mode for ${cardName}`,
          mandatory: true,
          sourceId: effectId,
          sourceName: cardName,
          sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          modes: modal.options.map(o => ({ id: o.id, label: o.label, description: o.description })),
          minModes: modal.minModes,
          maxModes: modal.maxModes,
          allowDuplicates: false,
        });
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: playerId as PlayerID,
        description: `Choose ${targetDescription} for ${cardName}`,
        mandatory: true,
        sourceId: effectId,
        sourceName: cardName,
        sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
        validTargets: validTargetList.map((t: any) => {
          const isPlayerTarget = t.kind === 'player';
          return {
            id: t.id,
            label: t.name,
            description: t.kind,
            imageUrl: t.imageUrl,
            type: isPlayerTarget ? 'player' : 'permanent',
            controller: t.controller,
            typeLine: t.typeLine,
            life: t.life,
            isOpponent: t.isOpponent,
          };
        }),
        targetTypes: [isAura ? 'aura_target' : 'spell_target'],
        minTargets: requiredMinTargets,
        maxTargets: requiredMaxTargets,
        targetDescription,
        spellCastContext: {
          cardId,
          cardName,
          manaCost,
          playerId,
          faceIndex,
          effectId,
          oracleText,
          imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          forcedAlternateCostId: options?.forcedAlternateCostId,
        },
      });

      debug(2, `[requestCastSpell] Added TARGET_SELECTION step to Resolution Queue for ${cardName} (effectId: ${effectId}, ${validTargetList.length} valid targets)`);
      debug(2, `[requestCastSpell] ======== REQUEST END (waiting for targets via Resolution Queue) ========`);
      return;
    }

    // No targets needed — still need to handle additional costs before payment.
    const costReduction = calculateCostReduction(game, playerId, cardInHand);
    const convokeOptions = calculateConvokeOptions(game, playerId, cardInHand);

    (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
    (game.state as any).pendingSpellCasts[effectId] = {
      cardId,
      cardName,
      manaCost,
      playerId,
      faceIndex,
      validTargetIds: [],
      targets: [],
      card: { ...cardInHand },
      noTargets: true,
      pendingPaymentAfterAdditionalCost: false,
      costReduction: costReduction.messages.length > 0 ? costReduction : undefined,
      convokeOptions: convokeOptions.availableCreatures.length > 0 ? convokeOptions : undefined,
      forcedAlternateCostId: options?.forcedAlternateCostId,
    };

    const additionalCost = detectAdditionalCost(oracleText);
    if (additionalCost?.type === 'blight') {
      const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
      pendingCast.pendingPaymentAfterAdditionalCost = true;

      const blightIsX = Boolean((additionalCost as any).blightIsX);
      const blightN = Number((additionalCost as any).blightN || 0);
      const blightOrPayCost = String((additionalCost as any).blightOrPayCost || '').trim() || undefined;
      const blightIsOptional = Boolean((additionalCost as any).blightIsOptional);

      if (blightIsX) {
        delete (game.state as any).pendingSpellCasts[effectId];
        socket.emit('error', {
          code: 'UNSUPPORTED_ADDITIONAL_COST',
          message: `Additional cost "Blight X" is not supported yet for ${cardName}.`,
        });
        return;
      }

      const battlefieldNow = game.state?.battlefield || [];
      const validBlightTargets = battlefieldNow
        .filter((p: any) => p && String(p.controller || '') === String(playerId))
        .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
        .map((p: any) => ({
          id: p.id,
          label: p.card?.name || 'Creature',
          description: p.card?.type_line || 'creature',
          imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        }));

      pendingCast.additionalCostPaid = false;
      pendingCast.additionalCostMethod = 'none';

      if (blightOrPayCost) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: playerId as PlayerID,
          description: `Additional cost for ${cardName}: Choose how to pay`,
          mandatory: true,
          sourceId: effectId,
          sourceName: cardName,
          sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          options: [
            {
              id: 'blight_cost',
              label: `Blight ${blightN}`,
              description: `Put ${blightN} -1/-1 counter${blightN === 1 ? '' : 's'} on a creature you control.`,
            },
            {
              id: 'pay_mana_cost',
              label: `Pay ${blightOrPayCost}`,
              description: `Pay ${blightOrPayCost} as the additional cost.`,
            },
          ],
          minSelections: 1,
          maxSelections: 1,
          spellAdditionalCostBlightOrPay: true,
          spellAdditionalCostEffectId: effectId,
          spellAdditionalCostCardName: cardName,
          spellAdditionalCostBlightN: blightN,
          spellAdditionalCostOrPay: blightOrPayCost,
        } as any);
        debug(2, `[requestCastSpell] Queued Blight additional-cost choice for no-target spell ${cardName}`);
        return;
      }

      if (validBlightTargets.length === 0) {
        if (blightIsOptional) {
          pendingCast.additionalCostPaid = false;
          pendingCast.additionalCostMethod = 'none';
        } else {
          delete (game.state as any).pendingSpellCasts[effectId];
          socket.emit('error', {
            code: 'CANNOT_PAY_COST',
            message: `Cannot cast ${cardName}: You must blight ${blightN}, but you control no creatures.`,
          });
          return;
        }
      } else {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: playerId as PlayerID,
          description: `Additional cost for ${cardName}: Blight ${blightN}${blightIsOptional ? ' (optional)' : ''}`,
          mandatory: !blightIsOptional,
          sourceId: effectId,
          sourceName: cardName,
          sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          validTargets: validBlightTargets,
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'creature you control',
          keywordBlight: true,
          keywordBlightStage: 'cast_additional_cost',
          keywordBlightController: playerId,
          keywordBlightN: blightN,
          keywordBlightSourceName: `${cardName} — Additional Cost (Blight ${blightN})`,
          keywordBlightEffectId: effectId,
          keywordBlightOptional: blightIsOptional,
        } as any);
        debug(2, `[requestCastSpell] Queued Blight additional-cost target selection for no-target spell ${cardName}`);
        return;
      }
    }

    const existingPaymentStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId as any)
      .find((s: any) =>
        s?.type === ResolutionStepType.MANA_PAYMENT_CHOICE &&
        (s as any)?.spellPaymentRequired === true &&
        String((s as any)?.effectId || '') === String(effectId)
      );

    if (!existingPaymentStep) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: playerId as any,
        sourceId: cardId,
        sourceName: cardName,
        sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
        description: `Pay costs to cast ${cardName}.`,
        mandatory: true,

        spellPaymentRequired: true,
        cardId,
        cardName,
        manaCost,
        effectId,
        targets: undefined,
        imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
        costReduction: costReduction.messages.length > 0 ? costReduction : undefined,
        convokeOptions: convokeOptions.availableCreatures.length > 0 ? convokeOptions : undefined,
        forcedAlternateCostId: options?.forcedAlternateCostId,
      } as any);
    }

    debug(2, `[requestCastSpell] No targets needed, queued spell payment step for ${cardName}`);
    if (costReduction.messages.length > 0) {
      debug(1, `[requestCastSpell] Cost reductions: ${costReduction.messages.join(', ')}`);
    }
    if (convokeOptions.availableCreatures.length > 0) {
      debug(2, `[requestCastSpell] Convoke available: ${convokeOptions.availableCreatures.length} creatures`);
    }
    debug(2, `[requestCastSpell] ======== REQUEST END (waiting for payment) ========`);
  } catch (err: any) {
    debugError(1, `[requestCastSpell] Error:`, err);
    socket.emit("error", {
      code: "REQUEST_CAST_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export function registerGameActions(io: Server, socket: Socket) {
  // Play land from hand
  socket.on("playLand", ({ gameId, cardId, selectedFace, fromZone }: { 
    gameId: string; 
    cardId: string; 
    selectedFace?: number;
    fromZone?: 'hand' | 'graveyard';
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Check land-per-turn limit (before rules engine validation)
      // Default max is 1, but effects like Exploration, Azusa, Rites of Flourishing can increase it
      const landsPlayed = (game.state?.landsPlayedThisTurn?.[playerId] || 0);
      // Dynamically calculate max lands per turn from battlefield effects
      // This ensures we always have the current value from Exploration, Azusa, Ghirapur Orrery, etc.
      const maxLands = calculateMaxLandsPerTurn(game as any, playerId);
      debug(2, `[playLand] Player ${playerId} has played ${landsPlayed} lands this turn, max is ${maxLands}`);
      if (landsPlayed >= maxLands) {
        socket.emit("error", {
          code: "LAND_LIMIT_REACHED",
          message: maxLands > 1 
            ? `You have already played ${landsPlayed} land(s) this turn (max ${maxLands})`
            : "You have already played a land this turn",
        });
        return;
      }

      // Determine which zone to check based on fromZone parameter
      const sourceZone = fromZone || 'hand';
      
      // Check if player has permission to play from graveyard
      if (sourceZone === 'graveyard') {
        const hasConduitPermission = (game.state as any).landPlayPermissions?.[playerId]?.includes('graveyard');
        if (!hasConduitPermission) {
          socket.emit("error", {
            code: "NO_PERMISSION",
            message: "You don't have permission to play lands from your graveyard",
          });
          return;
        }
      }

      // Find the card in the specified zone
      const zones = game.state?.zones?.[playerId];
      const zone = sourceZone === 'graveyard' 
        ? (Array.isArray(zones?.graveyard) ? zones.graveyard : [])
        : (Array.isArray(zones?.hand) ? zones.hand : []);
      const cardInZone = zone.find((c: any) => c?.id === cardId);
      const cardName = (cardInZone as any)?.name || "";
      const cardImageUrl = (cardInZone as any)?.image_uris?.small || (cardInZone as any)?.image_uris?.normal;
      if (!cardInZone) {
        debugWarn(2, `[playLand] Card ${cardId} not found in ${sourceZone} for player ${playerId}`);
        socket.emit("error", {
          code: sourceZone === 'graveyard' ? "CARD_NOT_IN_GRAVEYARD" : "CARD_NOT_IN_HAND",
          message: `Card not found in ${sourceZone}. It may have already been played or moved.`,
        });
        return;
      }
      
      // Check if this is a Modal Double-Faced Card (MDFC) like Blightstep Pathway
      let layout = (cardInZone as any)?.layout;
      let cardFaces = (cardInZone as any)?.card_faces;
      const isMDFC = layout === 'modal_dfc' && Array.isArray(cardFaces) && cardFaces.length >= 2;
      
      // If MDFC and no face selected yet, prompt the player to choose
      if (isMDFC && selectedFace === undefined) {
        // Check if both faces are lands (some MDFCs have spell on one side)
        const face0 = cardFaces[0];
        const face1 = cardFaces[1];
        const face0IsLand = /\bland\b/i.test(face0?.type_line || '');
        const face1IsLand = /\bland\b/i.test(face1?.type_line || '');
        
        // If only one face is a land, auto-select it
        if (face0IsLand && !face1IsLand) {
          // Use front face (it's a land)
          (cardInZone as any).selectedMDFCFace = 0;
        } else if (!face0IsLand && face1IsLand) {
          // Use back face (it's a land)
          (cardInZone as any).selectedMDFCFace = 1;
        } else if (face0IsLand && face1IsLand) {
          // Both are lands - prompt user to choose
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => s?.type === ResolutionStepType.MDFC_FACE_SELECTION && String((s as any)?.cardId || '') === String(cardId));

          if (!existing) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.MDFC_FACE_SELECTION,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardName,
              sourceImage: cardImageUrl,
              description: `${cardName} is a Modal Double-Faced Card. Choose which land to play.`,
              mandatory: true,
              cardId,
              cardName,
              fromZone: sourceZone === 'graveyard' ? 'graveyard' : 'hand',
              title: 'Choose which side to play',
              faces: [
                {
                  index: 0,
                  name: face0.name,
                  typeLine: face0.type_line,
                  oracleText: face0.oracle_text,
                  manaCost: face0.mana_cost,
                  imageUrl: face0.image_uris?.small || face0.image_uris?.normal,
                },
                {
                  index: 1,
                  name: face1.name,
                  typeLine: face1.type_line,
                  oracleText: face1.oracle_text,
                  manaCost: face1.mana_cost,
                  imageUrl: face1.image_uris?.small || face1.image_uris?.normal,
                },
              ],
            } as any);
          }

          debug(2, `[playLand] Queued MDFC face selection for ${cardName}`);
          return; // Wait for face selection via Resolution Queue
        } else {
          // Neither face is a land - shouldn't happen in playLand flow
          socket.emit("error", {
            code: "NOT_A_LAND",
            message: `Neither side of ${cardName} is a land.`,
          });
          return;
        }
      }
      
      // If a face was selected for MDFC, apply that face's properties
      if (isMDFC && selectedFace !== undefined) {
        const selectedCardFace = cardFaces[selectedFace];
        if (selectedCardFace) {
          // Update the card to use the selected face's properties
          (cardInZone as any).name = selectedCardFace.name;
          (cardInZone as any).type_line = selectedCardFace.type_line;
          (cardInZone as any).oracle_text = selectedCardFace.oracle_text;
          (cardInZone as any).mana_cost = selectedCardFace.mana_cost;
          if (selectedCardFace.image_uris) {
            (cardInZone as any).image_uris = selectedCardFace.image_uris;
          }
          (cardInZone as any).selectedMDFCFace = selectedFace;
          debug(2, `[playLand] Playing MDFC ${cardName} as ${selectedCardFace.name} (face ${selectedFace})`);
        }
      }
      
      // Validate that the card is actually a land (check type_line)
      // For double-faced cards (transform), check the current front face, not the entire type_line
      const typeLine = (cardInZone as any)?.type_line || "";
      const cardOracleText = (cardInZone as any)?.oracle_text || "";
      layout = (cardInZone as any)?.layout;
      cardFaces = (cardInZone as any)?.card_faces;
      
      // Check if this is a transform back face (should not be playable from hand)
      // Transform back faces have "(Transforms from [Name])" in oracle text
      if (/\(transforms from [^)]+\)/i.test(cardOracleText)) {
        debugWarn(2, `[playLand] Card ${cardName} is a transform back face and cannot be played from hand`);
        socket.emit("error", {
          code: "TRANSFORM_BACK_FACE",
          message: `${cardName || "This card"} is a transform back face and cannot be played from your hand. Only the front face of a transform card can be played.`,
        });
        return;
      }
      
      let isLand = false;
      
      // For transform cards (like Growing Rites of Itlimoc), check the FRONT face only
      if ((layout === 'transform' || layout === 'double_faced_token') && Array.isArray(cardFaces) && cardFaces.length >= 2) {
        // Check front face (index 0) - this is what you play from hand
        const frontFace = cardFaces[0];
        const frontTypeLine = frontFace?.type_line || "";
        isLand = /\bland\b/i.test(frontTypeLine);
        
        if (!isLand) {
          debugWarn(2, `[playLand] Transform card ${cardName} front face is not a land. Front face type: ${frontTypeLine}`);
          socket.emit("error", {
            code: "NOT_A_LAND",
            message: `${cardName || "This card"} must be cast as a spell, not played as a land. Its back face transforms into a land.`,
          });
          return;
        }
      } else {
        // Regular card or MDFC - check type_line normally
        isLand = /\bland\b/i.test(typeLine);
      }
      
      if (!isLand) {
        debugWarn(2, `[playLand] Card ${cardName} (${cardId}) is not a land. Type line: ${typeLine}`);
        socket.emit("error", {
          code: "NOT_A_LAND",
          message: `${cardName || "This card"} is not a land and cannot be played with playLand.`,
        });
        return;
      }

      // Get RulesBridge for validation
      const bridge = (GameManager as any).getRulesBridge(gameId);
      
      if (bridge) {
        // Validate through rules engine
        const validation = bridge.validateAction({
          type: 'playLand',
          playerId,
          cardId,
        });
        
        if (!validation.legal) {
          socket.emit("error", {
            code: "INVALID_ACTION",
            message: validation.reason || "Cannot play land",
          });
          return;
        }
        
        // Execute through rules engine (this will emit events)
        const result = bridge.executeAction({
          type: 'playLand',
          playerId,
          cardId,
        });
        
        if (!result.success) {
          socket.emit("error", {
            code: "EXECUTION_ERROR",
            message: result.error || "Failed to play land",
          });
          return;
        }
      }
      
      // Also update legacy game state (for backward compatibility during migration)
      try {
        if (typeof game.playLand === 'function') {
          game.playLand(playerId, cardId);
        }
      } catch (e) {
        debugWarn(1, 'Legacy playLand failed:', e);
      }
      
      // Persist the event to DB with full card data for reliable replay after server restart
      // Note: We store the full card object so that during replay the card can be placed on
      // the battlefield even if the hand state differs
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "playLand", { 
          playerId, 
          cardId,
          fromZone: sourceZone, // Track which zone the land was played from
          // Include full card data for replay to work correctly after server restart
          card: cardInZone
        });
      } catch (e) {
        debugWarn(1, 'appendEvent(playLand) failed:', e);
      }

      // Check if this is a shock land and prompt the player
      if (isShockLand(cardName)) {
        // Find the permanent that was just played by its unique card ID (not by name)
        // This ensures we find the correct permanent when multiple copies of the same card exist
        const battlefield = game.state?.battlefield || [];
        const permanent = battlefield.find((p: any) => 
          p.card?.id === cardId && 
          p.controller === playerId
        );
        
        if (permanent) {
          // Get player's current life
          const currentLife = (game.state as any)?.life?.[playerId] || (game as any)?.life?.[playerId] || 40;

          // Queue shock land replacement choice via Resolution Queue.
          // AI will handle this via generic option-choice handling.
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => (s as any)?.shockLandChoice === true && String((s as any)?.permanentId || '') === String(permanent.id));
          if (!existing) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.OPTION_CHOICE,
              playerId: playerId as any,
              sourceName: cardName,
              sourceId: permanent.id,
              sourceImage: cardImageUrl,
              description: `${cardName}: You may pay 2 life. If you don't, it enters tapped. (Life: ${currentLife})`,
              mandatory: true,
              options: [
                { id: 'enter_tapped', label: 'Have it enter tapped' },
                { id: 'pay_2_life', label: 'Pay 2 life (enter untapped)' },
              ],
              minSelections: 1,
              maxSelections: 1,
              shockLandChoice: true,
              permanentId: permanent.id,
              payLifeAmount: 2,
              cardName,
            } as any);
          }
        }
      }

      // Check for other ETB-tapped lands (temples, gain lands, guildgates, etc.)
      // This detects lands that always enter tapped based on oracle text
      if (!isShockLand(cardName) && !isBounceLand(cardName)) {
        const oracleText = (cardInZone as any)?.oracle_text || '';
        const etbPattern = detectETBTappedPattern(oracleText);
        
        // Find the permanent that was just played
        const battlefield = game.state?.battlefield || [];
        const permanent = battlefield.find((p: any) => 
          p.card?.id === cardId && 
          p.controller === playerId
        );
        
        if (etbPattern === 'always' && permanent && !permanent.tapped) {
          permanent.tapped = true;
          debug(2, `[playLand] ${cardName} enters tapped (ETB-tapped pattern detected)`);
        } else if (etbPattern === 'conditional' && permanent) {
          // Evaluate the conditional ETB tapped pattern
          // Count OTHER lands (not including this one)
          const otherLandCount = battlefield.filter((p: any) => {
            if (p.id === permanent.id) return false; // Exclude this land
            if (p.controller !== playerId) return false;
            const typeLine = (p.card?.type_line || '').toLowerCase();
            return typeLine.includes('land');
          }).length;
          
          // Get controlled land types from other lands
          // For battle/tango lands like Cinder Glade, we need to count BASIC lands
          // A basic land has "Basic Land" in its type line (e.g., "Basic Land ΓÇö Forest")
          const controlledLandTypes: string[] = [];
          let basicLandCount = 0;
          for (const p of battlefield) {
            if (p.id === permanent.id) continue; // Exclude this land
            if (p.controller !== playerId) continue;
            const typeLine = (p.card?.type_line || '').toLowerCase();
            
            // Check if this is a basic land (has "basic" in the type line)
            if (typeLine.includes('basic')) {
              basicLandCount++;
            }
            
            const subtypes = getLandSubtypes(typeLine);
            controlledLandTypes.push(...subtypes);
          }
          
          // For battle lands, we need to pass the basic land count
          // We do this by padding the controlledLandTypes array with dummy entries
          // that represent basic lands (for the battleLand check)
          // Actually, let's enhance the function signature instead
          // For now, we use a workaround: check the oracle text here first
          const hasBattleLandPattern = oracleText.toLowerCase().includes('two or more basic lands');
          
          // Get player's hand for reveal land checks
          const playerHand = Array.isArray(zones?.hand) ? zones.hand : [];
          
          // Count opponents (other players in the game, excluding the current player)
          const allPlayers = (game.state as any)?.players || [];
          const opponentCount = allPlayers.filter((p: any) => p.id !== playerId).length;
          
          // Evaluate the conditional ETB
          // For battle lands, use basic land count instead of land types
          let evaluation;
          if (hasBattleLandPattern) {
            // Battle land - check basic land count
            const shouldTap = basicLandCount < 2;
            evaluation = {
              shouldEnterTapped: shouldTap,
              reason: shouldTap 
                ? `Enters tapped (you control only ${basicLandCount} basic land${basicLandCount !== 1 ? 's' : ''})` 
                : `Enters untapped (you control ${basicLandCount} basic lands)`,
            };
          } else {
            // Get controlled permanents (for legendary creature check, etc.)
            const controlledPermanents = battlefield.filter((p: any) => 
              p.id !== permanent.id && p.controller === playerId
            );
            
            evaluation = evaluateConditionalLandETB(
              oracleText,
              otherLandCount,
              controlledLandTypes,
              playerHand,
              basicLandCount,
              opponentCount,
              controlledPermanents
            );
          }
          
          debug(2, `[playLand] ${cardName} conditional ETB: ${evaluation.reason}`);
          
          if (evaluation.requiresRevealPrompt && evaluation.canReveal) {
            // Land can be revealed - queue choice via Resolution Queue.
            // Use OPTION_CHOICE with one option per eligible card + a decline option.
            const revealTypes: string[] = Array.isArray(evaluation.revealTypes) ? evaluation.revealTypes : [];
            const eligible = playerHand
              .filter((c: any) => {
                const typeLine = String(c?.type_line || '');
                if (!/\bland\b/i.test(typeLine)) return false;
                if (revealTypes.length === 0) return true;
                return revealTypes.some((t) => new RegExp(`\\b${String(t).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(typeLine));
              })
              .map((c: any) => ({
                id: String(c?.id || ''),
                label: String(c?.name || 'Card'),
                description: String(c?.type_line || ''),
                imageUrl: c?.image_uris?.small || c?.image_uris?.normal,
              }))
              .filter((o: any) => o.id);

            const existing = ResolutionQueueManager
              .getStepsForPlayer(gameId, playerId as any)
              .find((s: any) => (s as any)?.revealLandChoice === true && String((s as any)?.permanentId || '') === String(permanent.id));
            if (!existing) {
              ResolutionQueueManager.addStep(gameId, {
                type: ResolutionStepType.OPTION_CHOICE,
                playerId: playerId as any,
                sourceName: cardName,
                sourceId: permanent.id,
                sourceImage: cardImageUrl,
                description: `You may reveal a ${revealTypes.join(' or ')} card from your hand. If you don't, ${cardName} enters tapped.`,
                mandatory: true,
                options: [
                  ...eligible,
                  { id: 'decline_reveal', label: "Don't reveal (enter tapped)" },
                ],
                minSelections: 1,
                maxSelections: 1,
                revealLandChoice: true,
                permanentId: permanent.id,
                cardName,
                revealTypes,
              } as any);
            }
          } else if (evaluation.shouldEnterTapped && !permanent.tapped) {
            // Land should enter tapped based on condition check
            permanent.tapped = true;
            
            // Send chat message about the land entering tapped
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${getPlayerName(game, playerId)}'s ${cardName} enters tapped. (${evaluation.reason})`,
              ts: Date.now(),
            });
          }
        }
      }

      // Check for scry on ETB (Temple of Malice, etc.)
      const oracleText = (cardInZone as any)?.oracle_text || '';
      const scryAmount = detectScryOnETB(oracleText);
      if (scryAmount && scryAmount > 0) {
        // Set pendingScry state - will be processed by processPendingScry() after stack resolution
        (game.state as any).pendingScry = (game.state as any).pendingScry || {};
        (game.state as any).pendingScry[playerId] = ((game.state as any).pendingScry[playerId] || 0) + scryAmount;
        
        debug(2, `[playLand] ${cardName} has "scry ${scryAmount}" ETB trigger`);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${cardName} enters the battlefield. ${getPlayerName(game, playerId)} scries ${scryAmount}.`,
          ts: Date.now(),
        });
        
        // Legacy beginScryPrompt emission removed - now handled by processPendingScry()
      }

      // Check for "sacrifice unless you pay" ETB triggers (Transguild Promenade, Gateway Plaza, etc.)
      const sacrificeCost = detectSacrificeUnlessPayETB(cardName, oracleText);
      if (sacrificeCost) {
        // Find the permanent that was just played
        const battlefield = game.state?.battlefield || [];
        const permanent = battlefield.find((p: any) => 
          p.card?.id === cardId && 
          p.controller === playerId
        );
        
        if (permanent) {
          // Queue sacrifice-unless-pay via Resolution Queue.
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => (s as any)?.sacrificeUnlessPayChoice === true && String((s as any)?.permanentId || '') === String(permanent.id));

          if (!existing) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.OPTION_CHOICE,
              playerId: playerId as any,
              sourceName: cardName,
              sourceId: permanent.id,
              sourceImage: cardImageUrl,
              description: `${cardName}: Sacrifice it unless you pay ${sacrificeCost}. (Float mana first, then choose Pay.)`,
              mandatory: true,
              options: [
                { id: 'pay_cost', label: `Pay ${sacrificeCost}` },
                { id: 'sacrifice', label: `Don't pay (sacrifice ${cardName})` },
              ],
              minSelections: 1,
              maxSelections: 1,
              sacrificeUnlessPayChoice: true,
              permanentId: permanent.id,
              cardName,
              manaCost: sacrificeCost,
            } as any);
          }
          debug(2, `[playLand] ${cardName} has "sacrifice unless you pay ${sacrificeCost}" ETB trigger`);
        }
      }

      // Check for creature type selection requirements (e.g., Cavern of Souls, Unclaimed Territory)
      checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
      
      // Check for color choice requirements (e.g., Caged Sun, Gauntlet of Power)
      checkColorChoiceForNewPermanents(io, game, gameId);
      
      // Check for player selection requirements (e.g., Stuffy Doll, Vislor Turlough)
      checkPlayerSelectionForNewPermanents(io, game, gameId);
      
      // Check for enchantment ETB triggers (e.g., Growing Rites of Itlimoc)
      checkEnchantmentETBTriggers(io, game, gameId);

      // NOTE: Bounce land ETB triggers are now handled in stack.ts playLand function
      // via the unified ETB trigger detection system. No need for duplicate handling here.

      // NOTE: Landfall triggers are now handled in stack.ts playLand function
      // via the unified trigger detection system. No need for duplicate handling here.
      // This prevents double-triggering issues like the one with Geode Rager and Helm of the Host.

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `playLand error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "PLAY_LAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // =====================================================================
  // REQUEST CAST SPELL - First step of MTG-compliant spell casting
  // MTG Rule 601.2: Choose targets (601.2c) before paying costs (601.2h)
  // This handler checks if targets are needed and requests them first,
  // then triggers payment after targets are selected.
  // =====================================================================
  socket.on("requestCastSpell", async ({ gameId, cardId, faceIndex }: { gameId: string; cardId: string; faceIndex?: number }) => {
    try {
      debug(2, `[requestCastSpell] ======== REQUEST START ========`);
      debug(2, `[requestCastSpell] gameId: ${gameId}, cardId: ${cardId}, faceIndex: ${faceIndex}`);
      
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) {
        debug(1, `[requestCastSpell] ERROR: game or playerId not found`);
        return;
      }
      
      debug(2, `[requestCastSpell] playerId: ${playerId}, priority: ${game.state.priority}`);

      // Basic validation (same as castSpellFromHand)
      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      if (phaseStr === "" || phaseStr === "PRE_GAME") {
        socket.emit("error", {
          code: "PREGAME_NO_CAST",
          message: "Cannot cast spells during pre-game.",
        });
        return;
      }

      if (game.state.priority !== playerId) {
        socket.emit("error", {
          code: "NO_PRIORITY",
          message: "You don't have priority",
        });
        return;
      }

      // Split Second: players can't cast spells while a split-second spell is on the stack.
      const splitSecondLockActive = Array.isArray((game.state as any)?.stack) && (game.state as any).stack.some((item: any) => {
        const c = item?.card ?? item?.spell?.card ?? item?.sourceCard ?? item?.source?.card;
        const keywords = Array.isArray(c?.keywords) ? c.keywords : [];
        const ot = String(c?.oracle_text || '').toLowerCase();
        return keywords.some((k: any) => String(k).toLowerCase() === 'split second') || ot.includes('split second');
      });
      if (splitSecondLockActive) {
        socket.emit('error', {
          code: 'SPLIT_SECOND_LOCK',
          message: "Can't cast spells while a spell with split second is on the stack.",
        });
        return;
      }

      const zones = game.state.zones?.[playerId];
      if (!zones || !Array.isArray(zones.hand)) {
        socket.emit("error", { code: "NO_HAND", message: "Hand not found" });
        return;
      }

      const cardInHand = (zones.hand as any[]).find((c: any) => c && c.id === cardId);
      if (!cardInHand) {
        socket.emit("error", { code: "CARD_NOT_IN_HAND", message: "Card not found in hand" });
        return;
      }

      const typeLine = (cardInHand.type_line || "").toLowerCase();
      const layout = (cardInHand.layout || "").toLowerCase();
      const cardFaces = cardInHand.card_faces;
      
      // ========================================================================
      // TRANSFORM CARD HANDLING (Rule 712)
      // Transform cards can only be cast by their front face. The back face 
      // (marked with "(Transforms from [Name])") cannot be cast from hand.
      // Common examples:
      // - Thousand Moons Smithy // Barracks of the Thousand (Artifact that transforms into Land)
      // - Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun (Enchantment that transforms into Land)
      // - Westvale Abbey // Ormendahl, Profane Prince (Land that transforms into Creature)
      // ========================================================================
      if (layout === 'transform' && Array.isArray(cardFaces) && cardFaces.length >= 2) {
        // For transform cards, check if attempting to cast the back face
        if (faceIndex === 1) {
          // Explicitly requesting back face - not allowed
          socket.emit("error", { 
            code: "TRANSFORM_BACK_FACE", 
            message: `${cardFaces[1]?.name || "This card"} is a transform back face and cannot be cast from hand. Cast the front face (${cardFaces[0]?.name || "the card"}) instead.` 
          });
          return;
        }
        
        // Check if the front face is a land (then it's playLand, not cast)
        const frontFaceTypeLine = (cardFaces[0]?.type_line || "").toLowerCase();
        if (frontFaceTypeLine.includes("land")) {
          socket.emit("error", { 
            code: "CANNOT_CAST_LAND", 
            message: `${cardFaces[0]?.name || "This card"} is a land and cannot be cast as a spell. Use "Play Land" instead.` 
          });
          return;
        }
        
        // For transform cards, always use the front face for casting
        debug(2, `[requestCastSpell] Transform card ${cardInHand.name}: Using front face ${cardFaces[0]?.name}`);
      }
      
      // Standard land check (for non-transform cards)
      if (typeLine.includes("land") && layout !== 'transform') {
        socket.emit("error", { code: "CANNOT_CAST_LAND", message: "Lands cannot be cast as spells." });
        return;
      }

      // Get oracle text (possibly from card face if split/adventure)
      let oracleText = (cardInHand.oracle_text || "").toLowerCase();
      let manaCost = cardInHand.mana_cost || "";
      let cardName = cardInHand.name || "Card";
      let faceTypeLine = typeLine;
      
      // Handle split/modal/transform cards
      if (faceIndex !== undefined && Array.isArray(cardFaces)) {
        // Validate faceIndex bounds
        if (faceIndex < 0 || faceIndex >= cardFaces.length) {
          socket.emit("error", {
            code: "INVALID_FACE_INDEX",
            message: `Invalid face index: ${faceIndex}`,
          });
          return;
        }
        const face = cardFaces[faceIndex];
        if (face) {
          oracleText = (face.oracle_text || "").toLowerCase();
          manaCost = face.mana_cost || manaCost;
          cardName = face.name || cardName;
          faceTypeLine = (face.type_line || "").toLowerCase();
        }
      } else if (layout === 'transform' && Array.isArray(cardFaces) && cardFaces.length >= 2) {
        // For transform cards without explicit faceIndex, use front face (index 0)
        const frontFace = cardFaces[0];
        if (frontFace) {
          oracleText = (frontFace.oracle_text || "").toLowerCase();
          manaCost = frontFace.mana_cost || manaCost;
          cardName = frontFace.name || cardName;
          faceTypeLine = (frontFace.type_line || "").toLowerCase();
        }
      }

      // Check if this spell requires targets
      // Use faceTypeLine for transform/split cards, fallback to typeLine for regular cards
      const effectiveTypeLine = faceTypeLine || typeLine;
      const isInstantOrSorcery = effectiveTypeLine.includes("instant") || effectiveTypeLine.includes("sorcery");
      // An Aura is an enchantment with "Aura" in the type line AND "Enchant" at the start of its oracle text
      const isAura = effectiveTypeLine.includes("aura") && /^enchant\s+/i.test(oracleText);
      const spellSpec = (isInstantOrSorcery && !isAura) ? categorizeSpell(cardName, oracleText) : null;
      const targetReqs = (isInstantOrSorcery && !isAura) ? parseTargetRequirements(oracleText) : null;
      
      const needsTargets = (spellSpec && spellSpec.minTargets > 0) || 
                          (targetReqs && targetReqs.needsTargets) ||
                          isAura;

      // Generate effectId for tracking this cast through the workflow
      const effectId = `cast_${cardId}_${Date.now()}`;

      if (needsTargets) {
        // Build valid target list
        let validTargetList: { id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string }[] = [];
        
        if (isAura) {
          // Extract aura target type from oracle text
          const auraMatch = oracleText.match(/enchant\s+(creature|permanent|player|artifact|land|opponent)/i);
          const auraTargetType = auraMatch ? auraMatch[1].toLowerCase() : 'creature';
          
          // Build targets based on aura type
          if (auraTargetType === 'player' || auraTargetType === 'opponent') {
            validTargetList = (game.state.players || [])
              .filter((p: any) => auraTargetType !== 'opponent' || p.id !== playerId)
              .map((p: any) => ({
                id: p.id,
                kind: 'player',
                name: p.name || p.id,
                isOpponent: p.id !== playerId,
              }));
          } else {
            validTargetList = (game.state.battlefield || [])
              .filter((p: any) => {
                const tl = (p.card?.type_line || '').toLowerCase();
                if (auraTargetType === 'permanent') return true;
                return tl.includes(auraTargetType);
              })
              .map((p: any) => ({
                id: p.id,
                kind: 'permanent',
                name: p.card?.name || 'Unknown',
                controller: p.controller,
                isOpponent: p.controller !== playerId,
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              }));
          }
        } else if (spellSpec) {
          const validRefs = evaluateTargeting(game.state as any, playerId, spellSpec);
          validTargetList = validRefs.map((t: any) => {
            if (t.kind === 'permanent') {
              const perm = (game.state.battlefield || []).find((p: any) => p.id === t.id);
              return {
                id: t.id,
                kind: t.kind,
                name: perm?.card?.name || 'Unknown',
                imageUrl: perm?.card?.image_uris?.small || perm?.card?.image_uris?.normal,
                controller: perm?.controller,
                typeLine: perm?.card?.type_line,
                isOpponent: perm?.controller !== playerId,
              };
            } else {
              const player = (game.state.players || []).find((p: any) => p.id === t.id);
              return {
                id: t.id,
                kind: t.kind,
                name: player?.name || t.id,
                life: player?.life,
                isOpponent: t.id !== playerId,
              };
            }
          });
        }

        if (validTargetList.length === 0) {
          // Clean up any pending spell cast state (defensive - shouldn't exist yet at this point)
          if ((game.state as any).pendingSpellCasts?.[effectId]) {
            delete (game.state as any).pendingSpellCasts[effectId];
          }
          
          socket.emit("error", {
            code: "NO_VALID_TARGETS",
            message: `No valid targets for ${cardName}`,
          });
          return;
        }

        // Store pending cast info for after targets are selected
        // IMPORTANT: Store valid target IDs for server-side validation (Rule 601.2c compliance)
        // IMPORTANT: Copy the full card object to prevent issues where card info is deleted
        // before it can be read during the target > pay workflow (fixes loop issue)
        (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
        (game.state as any).pendingSpellCasts[effectId] = {
          cardId,
          cardName,
          manaCost,
          playerId,
          faceIndex,
          validTargetIds: validTargetList.map((t: any) => t.id), // Store for validation
          card: { ...cardInHand }, // Copy full card object to preserve oracle text, type line, etc.
        };

        // Additional costs (CR 601.2b) ΓÇö handle Blight additional-cost patterns via Resolution Queue.
        // IMPORTANT: We do this before mode/target selection so costs happen in the correct order.
        const additionalCost = detectAdditionalCost(oracleText);
        if (additionalCost?.type === 'blight') {
          const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
          if (!pendingCast) {
            debugWarn(1, `[requestCastSpell] Missing pendingSpellCasts for effectId ${effectId} (blight additional cost)`);
          } else {
            const blightIsX = Boolean((additionalCost as any).blightIsX);
            const blightN = Number((additionalCost as any).blightN || 0);
            const blightOrPayCost = String((additionalCost as any).blightOrPayCost || '').trim() || undefined;
            const blightIsOptional = Boolean((additionalCost as any).blightIsOptional);

            if (blightIsX) {
              // Conservative: requestCastSpell flow doesn't have a generic numeric input UX here.
              delete (game.state as any).pendingSpellCasts[effectId];
              socket.emit('error', {
                code: 'UNSUPPORTED_ADDITIONAL_COST',
                message: `Additional cost "Blight X" is not supported yet for ${cardName}.`,
              });
              return;
            }

            const battlefieldNow = game.state?.battlefield || [];
            const validBlightTargets = battlefieldNow
              .filter((p: any) => p && String(p.controller || '') === String(playerId))
              .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
              .map((p: any) => ({
                id: p.id,
                label: p.card?.name || 'Creature',
                description: p.card?.type_line || 'creature',
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              }));

            // Default: not paid unless explicitly completed.
            pendingCast.additionalCostPaid = false;
            pendingCast.additionalCostMethod = 'none';

            if (blightOrPayCost) {
              // Choice between blighting or paying extra mana.
              ResolutionQueueManager.addStep(gameId, {
                type: ResolutionStepType.OPTION_CHOICE,
                playerId: playerId as PlayerID,
                description: `Additional cost for ${cardName}: Choose how to pay`,
                mandatory: true,
                sourceId: effectId,
                sourceName: cardName,
                sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
                options: [
                  {
                    id: 'blight_cost',
                    label: `Blight ${blightN}`,
                    description: `Put ${blightN} -1/-1 counter${blightN === 1 ? '' : 's'} on a creature you control.`,
                  },
                  {
                    id: 'pay_mana_cost',
                    label: `Pay ${blightOrPayCost}`,
                    description: `Pay ${blightOrPayCost} as the additional cost.`,
                  },
                ],
                minSelections: 1,
                maxSelections: 1,

                spellAdditionalCostBlightOrPay: true,
                spellAdditionalCostEffectId: effectId,
                spellAdditionalCostCardName: cardName,
                spellAdditionalCostBlightN: blightN,
                spellAdditionalCostOrPay: blightOrPayCost,
              } as any);
            } else {
              // Pure blight additional cost (mandatory or optional)
              if (validBlightTargets.length === 0) {
                if (blightIsOptional) {
                  pendingCast.additionalCostPaid = false;
                  pendingCast.additionalCostMethod = 'none';
                } else {
                  delete (game.state as any).pendingSpellCasts[effectId];
                  socket.emit('error', {
                    code: 'CANNOT_PAY_COST',
                    message: `Cannot cast ${cardName}: You must blight ${blightN}, but you control no creatures.`,
                  });
                  return;
                }
              } else {
                ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.TARGET_SELECTION,
                  playerId: playerId as PlayerID,
                  description: `Additional cost for ${cardName}: Blight ${blightN}${blightIsOptional ? ' (optional)' : ''}`,
                  mandatory: !blightIsOptional,
                  sourceId: effectId,
                  sourceName: cardName,
                  sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
                  validTargets: validBlightTargets,
                  targetTypes: ['creature'],
                  minTargets: 1,
                  maxTargets: 1,
                  targetDescription: 'creature you control',

                  // Custom payload consumed by the Blight hook in server/socket/resolution.ts
                  keywordBlight: true,
                  keywordBlightStage: 'cast_additional_cost',
                  keywordBlightController: playerId,
                  keywordBlightN: blightN,
                  keywordBlightSourceName: `${cardName} ΓÇö Additional Cost (Blight ${blightN})`,
                  keywordBlightEffectId: effectId,
                  keywordBlightOptional: blightIsOptional,
                } as any);
              }
            }
          }
        }

        // Many spells require mode/choice selection before targets (CR 601.2b -> 601.2c).
        // We only auto-enqueue a mode selection prompt for a safe subset of modal spells:
        // - Oracle has a "Choose one/two/..." block
        // - Every option appears to reference targets (heuristic)
        const targetDescription = spellSpec?.targetDescription || targetReqs?.targetDescription || 'target';
        const requiredMinTargets = spellSpec?.minTargets || targetReqs?.minTargets || 1;
        const requiredMaxTargets = spellSpec?.maxTargets || targetReqs?.maxTargets || 1;

        const modal = oracleText ? extractModalModesFromOracleText(oracleText) : undefined;
        if (modal && modal.allOptionsHaveTargets) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MODE_SELECTION,
            playerId: playerId as PlayerID,
            description: `Choose a mode for ${cardName}`,
            mandatory: true,
            sourceId: effectId,
            sourceName: cardName,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            modes: modal.options.map(o => ({ id: o.id, label: o.label, description: o.description })),
            minModes: modal.minModes,
            maxModes: modal.maxModes,
            allowDuplicates: false,
          });
        }
        
        // Add target selection step to Resolution Queue
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: playerId as PlayerID,
          description: `Choose ${targetDescription} for ${cardName}`,
          mandatory: true,
          sourceId: effectId,
          sourceName: cardName,
          sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          validTargets: validTargetList.map((t: any) => {
            const isPlayerTarget = t.kind === 'player';
            return {
              id: t.id,
              label: t.name,
              description: t.kind,
              imageUrl: t.imageUrl,
              // Extra fields for client UX + mode-aware filtering.
              type: isPlayerTarget ? 'player' : 'permanent',
              controller: t.controller,
              typeLine: t.typeLine,
              life: t.life,
              isOpponent: t.isOpponent,
            };
          }),
          targetTypes: [isAura ? 'aura_target' : 'spell_target'],
          minTargets: requiredMinTargets,
          maxTargets: requiredMaxTargets,
          targetDescription,
          // Store spell casting context for payment request after targets selected
          spellCastContext: {
            cardId,
            cardName,
            manaCost,
            playerId,
            faceIndex,
            effectId,
            oracleText,
            imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          },
        });
        
        debug(2, `[requestCastSpell] Added TARGET_SELECTION step to Resolution Queue for ${cardName} (effectId: ${effectId}, ${validTargetList.length} valid targets)`);
        debug(2, `[requestCastSpell] ======== REQUEST END (waiting for targets via Resolution Queue) ========`);
      } else {
        // No targets needed ΓÇö still need to handle additional costs before payment (CR 601.2b -> 601.2h).
        const costReduction = calculateCostReduction(game, playerId, cardInHand);
        const convokeOptions = calculateConvokeOptions(game, playerId, cardInHand);

        (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
        (game.state as any).pendingSpellCasts[effectId] = {
          cardId,
          cardName,
          manaCost,
          playerId,
          faceIndex,
          validTargetIds: [],
          targets: [],
          card: { ...cardInHand },
          noTargets: true,
          pendingPaymentAfterAdditionalCost: false,
          costReduction: costReduction.messages.length > 0 ? costReduction : undefined,
          convokeOptions: convokeOptions.availableCreatures.length > 0 ? convokeOptions : undefined,
        };

        const additionalCost = detectAdditionalCost(oracleText);
        if (additionalCost?.type === 'blight') {
          const pendingCast = (game.state as any).pendingSpellCasts?.[effectId];
          pendingCast.pendingPaymentAfterAdditionalCost = true;

          const blightIsX = Boolean((additionalCost as any).blightIsX);
          const blightN = Number((additionalCost as any).blightN || 0);
          const blightOrPayCost = String((additionalCost as any).blightOrPayCost || '').trim() || undefined;
          const blightIsOptional = Boolean((additionalCost as any).blightIsOptional);

          if (blightIsX) {
            delete (game.state as any).pendingSpellCasts[effectId];
            socket.emit('error', {
              code: 'UNSUPPORTED_ADDITIONAL_COST',
              message: `Additional cost "Blight X" is not supported yet for ${cardName}.`,
            });
            return;
          }

          const battlefieldNow = game.state?.battlefield || [];
          const validBlightTargets = battlefieldNow
            .filter((p: any) => p && String(p.controller || '') === String(playerId))
            .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
            .map((p: any) => ({
              id: p.id,
              label: p.card?.name || 'Creature',
              description: p.card?.type_line || 'creature',
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));

          pendingCast.additionalCostPaid = false;
          pendingCast.additionalCostMethod = 'none';

          if (blightOrPayCost) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.OPTION_CHOICE,
              playerId: playerId as PlayerID,
              description: `Additional cost for ${cardName}: Choose how to pay`,
              mandatory: true,
              sourceId: effectId,
              sourceName: cardName,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              options: [
                {
                  id: 'blight_cost',
                  label: `Blight ${blightN}`,
                  description: `Put ${blightN} -1/-1 counter${blightN === 1 ? '' : 's'} on a creature you control.`,
                },
                {
                  id: 'pay_mana_cost',
                  label: `Pay ${blightOrPayCost}`,
                  description: `Pay ${blightOrPayCost} as the additional cost.`,
                },
              ],
              minSelections: 1,
              maxSelections: 1,
              spellAdditionalCostBlightOrPay: true,
              spellAdditionalCostEffectId: effectId,
              spellAdditionalCostCardName: cardName,
              spellAdditionalCostBlightN: blightN,
              spellAdditionalCostOrPay: blightOrPayCost,
            } as any);
            debug(2, `[requestCastSpell] Queued Blight additional-cost choice for no-target spell ${cardName}`);
            return;
          }

          if (validBlightTargets.length === 0) {
            if (blightIsOptional) {
              pendingCast.additionalCostPaid = false;
              pendingCast.additionalCostMethod = 'none';
              // Fall through: no cost step needed, request payment immediately.
            } else {
              delete (game.state as any).pendingSpellCasts[effectId];
              socket.emit('error', {
                code: 'CANNOT_PAY_COST',
                message: `Cannot cast ${cardName}: You must blight ${blightN}, but you control no creatures.`,
              });
              return;
            }
          } else {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: playerId as PlayerID,
              description: `Additional cost for ${cardName}: Blight ${blightN}${blightIsOptional ? ' (optional)' : ''}`,
              mandatory: !blightIsOptional,
              sourceId: effectId,
              sourceName: cardName,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              validTargets: validBlightTargets,
              targetTypes: ['creature'],
              minTargets: 1,
              maxTargets: 1,
              targetDescription: 'creature you control',
              keywordBlight: true,
              keywordBlightStage: 'cast_additional_cost',
              keywordBlightController: playerId,
              keywordBlightN: blightN,
              keywordBlightSourceName: `${cardName} ΓÇö Additional Cost (Blight ${blightN})`,
              keywordBlightEffectId: effectId,
              keywordBlightOptional: blightIsOptional,
            } as any);
            debug(2, `[requestCastSpell] Queued Blight additional-cost target selection for no-target spell ${cardName}`);
            return;
          }
        }

        // No additional cost (or optional cost skipped) ΓÇö go directly to payment.
        socket.emit("paymentRequired", {
          gameId,
          cardId,
          cardName,
          manaCost,
          effectId,
          imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          costReduction: costReduction.messages.length > 0 ? costReduction : undefined,
          convokeOptions: convokeOptions.availableCreatures.length > 0 ? convokeOptions : undefined,
        });
        debug(2, `[requestCastSpell] No targets needed, emitted paymentRequired for ${cardName}`);
        if (costReduction.messages.length > 0) {
          debug(1, `[requestCastSpell] Cost reductions: ${costReduction.messages.join(', ')}`);
        }
        if (convokeOptions.availableCreatures.length > 0) {
          debug(2, `[requestCastSpell] Convoke available: ${convokeOptions.availableCreatures.length} creatures`);
        }
        debug(2, `[requestCastSpell] ======== REQUEST END (waiting for payment) ========`);
      }
    } catch (err: any) {
      debugError(1, `[requestCastSpell] Error:`, err);
      socket.emit("error", {
        code: "REQUEST_CAST_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // =====================================================================
  // CAST SPELL FROM HAND - Core spell casting handler
  // Defined as a named function so it can be called directly from completeCastSpell
  // =====================================================================
  const handleCastSpellFromHand = async ({ gameId, cardId, targets, payment, skipInteractivePrompts, xValue, alternateCostId, convokeTappedCreatures }: { 
    gameId: string; 
    cardId: string; 
    targets?: any[]; 
    payment?: PaymentItem[];
    skipInteractivePrompts?: boolean; // NEW: Flag to skip target/payment requests when completing a previous cast
    xValue?: number;
    alternateCostId?: string;
    convokeTappedCreatures?: string[];
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const { isSpellCastingProhibitedByChosenName } = await import('../state/modules/chosen-name-restrictions.js');

      // DEBUG: Log incoming parameters to trace targeting loop
      debug(2, `[handleCastSpellFromHand] ======== DEBUG START ========`);
      debug(2, `[handleCastSpellFromHand] cardId: ${cardId}`);
      debug(2, `[handleCastSpellFromHand] targets: ${targets ? JSON.stringify(targets) : 'undefined'}`);
      debug(2, `[handleCastSpellFromHand] payment: ${payment ? JSON.stringify(payment) : 'undefined'}`);
      debug(2, `[handleCastSpellFromHand] skipInteractivePrompts: ${skipInteractivePrompts}`);
      debug(2, `[handleCastSpellFromHand] playerId: ${playerId}`);
      if (alternateCostId) debug(2, `[handleCastSpellFromHand] alternateCostId: ${alternateCostId}`);
      if (convokeTappedCreatures && convokeTappedCreatures.length > 0) {
        debug(2, `[handleCastSpellFromHand] convokeTappedCreatures: ${JSON.stringify(convokeTappedCreatures)}`);
      }
      debug(2, `[handleCastSpellFromHand] priority: ${game.state.priority}`);

      // Check if we're in PRE_GAME phase - spells cannot be cast during pre-game
      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      if (phaseStr === "" || phaseStr === "PRE_GAME") {
        socket.emit("error", {
          code: "PREGAME_NO_CAST",
          message: "Cannot cast spells during pre-game. Start the game first by claiming turn and advancing to main phase.",
        });
        return;
      }

      // Check priority - only player with priority can cast spells
      if (game.state.priority !== playerId) {
        socket.emit("error", {
          code: "NO_PRIORITY",
          message: "You don't have priority",
        });
        return;
      }

      // Split Second: players can't cast spells while a split-second spell is on the stack.
      const splitSecondLockActive = Array.isArray((game.state as any)?.stack) && (game.state as any).stack.some((item: any) => {
        const c = item?.card ?? item?.spell?.card ?? item?.sourceCard ?? item?.source?.card;
        const keywords = Array.isArray(c?.keywords) ? c.keywords : [];
        const ot = String(c?.oracle_text || '').toLowerCase();
        return keywords.some((k: any) => String(k).toLowerCase() === 'split second') || ot.includes('split second');
      });
      if (splitSecondLockActive) {
        socket.emit('error', {
          code: 'SPLIT_SECOND_LOCK',
          message: "Can't cast spells while a spell with split second is on the stack.",
        });
        return;
      }

      // Find the card in player's hand
      const zones = game.state.zones?.[playerId];
      if (!zones || !Array.isArray(zones.hand)) {
        socket.emit("error", {
          code: "NO_HAND",
          message: "Hand not found",
        });
        return;
      }

      const cardInHand = (zones.hand as any[]).find((c: any) => c && c.id === cardId);
      if (!cardInHand) {
        socket.emit("error", {
          code: "CARD_NOT_IN_HAND",
          message: "Card not found in hand",
        });
        return;
      }

      // Validate card is castable (not a land)
      const typeLine = (cardInHand.type_line || "").toLowerCase();
      if (typeLine.includes("land")) {
        socket.emit("error", {
          code: "CANNOT_CAST_LAND",
          message: "Lands cannot be cast as spells. Use playLand instead.",
        });
        return;
      }

      // Chosen-name cast restrictions (e.g., Meddling Mage / Nevermore)
      const castRestriction = isSpellCastingProhibitedByChosenName(game.state, playerId, cardInHand.name || '');
      if (castRestriction.prohibited) {
        const blocker = castRestriction.by?.sourceName || 'an effect';
        socket.emit('error', {
          code: 'CANNOT_CAST_CHOSEN_NAME',
          message: `Spells named "${cardInHand.name || 'that card'}" can't be cast (${blocker} chose that name).`,
        });
        return;
      }
      
      // =============================================================================
      // CRITICAL FIX: Skip all interactive prompts when completing a previous cast
      // =============================================================================
      // When skipInteractivePrompts=true (from completeCastSpell), we're completing 
      // a cast that already went through target/payment selection. Jump directly to 
      // the actual casting logic to prevent infinite targeting loops.
      const shouldSkipAllPrompts = skipInteractivePrompts === true;
      
      // Check timing restrictions for sorcery-speed spells
      const oracleText = (cardInHand.oracle_text || "").toLowerCase();

      // Carry over additional-cost payment state from requestCastSpell -> completeCastSpell.
      // Many resolution paths check this flag on the card object.
      (cardInHand as any).additionalCostPaid = (targets as any)?.additionalCostPaid === true;
      (cardInHand as any).additionalCostMethod = (targets as any)?.additionalCostMethod;

      // =====================================================================
      // FORCE OF WILL / FORCE OF NEGATION STYLE ALTERNATE COST
      // =====================================================================
      // This alternate cost is a special interaction (exile a blue card; sometimes pay 1 life)
      // and must be handled even when skipInteractivePrompts=true (completeCastSpell path).
      // We enqueue a Resolution Queue prompt and resume the cast once the cost is paid.
      const isForceAltCostRequested = alternateCostId === 'force_of_will';
      const forceAltAlreadyPaid = (cardInHand as any).forceAltCostPaid === true;
      if (isForceAltCostRequested && !forceAltAlreadyPaid) {
        const { getForceOfWillAlternateCost } = await import('../state/modules/alternate-costs.js');
        const forceInfo = getForceOfWillAlternateCost(
          { state: game.state, bumpSeq: () => {}, rng: Math.random } as any,
          playerId as any,
          cardInHand as any
        );

        if (!forceInfo?.available) {
          socket.emit('error', {
            code: 'CANNOT_PAY_COST',
            message: `Cannot cast ${cardInHand.name} for its alternate cost.`,
          });
          return;
        }

        const handCards = Array.isArray((zones as any).hand) ? ((zones as any).hand as any[]) : [];
        const blueCards = handCards
          .filter((c: any) => c && c.id !== cardId)
          .filter((c: any) => Array.isArray(c.colors) && c.colors.includes('U'))
          .map((c: any) => ({
            id: String(c.id),
            label: `Exile ${c.name || 'Blue card'}`,
            imageUrl: c.image_uris?.small || c.image_uris?.normal,
          }));

        if (blueCards.length === 0) {
          socket.emit('error', {
            code: 'CANNOT_PAY_COST',
            message: `Cannot cast ${cardInHand.name}: no other blue card in hand to exile.`,
          });
          return;
        }

        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.OPTION_CHOICE && (s as any)?.forceOfWillExileChoice === true && String(s.sourceId || '') === String(cardId));

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: forceInfo.requiresLifePayment
              ? `To cast ${cardInHand.name} for its alternate cost, exile a blue card from your hand and pay 1 life.`
              : `To cast ${cardInHand.name} for its alternate cost, exile a blue card from your hand.`,
            mandatory: true,
            options: [
              ...blueCards,
            ],
            minSelections: 1,
            maxSelections: 1,

            forceOfWillExileChoice: true,
            forceSpellCardId: cardId,
            forceSpellName: cardInHand.name,
            forceRequiresLifePayment: forceInfo.requiresLifePayment === true,
            forceLifePaymentAmount: forceInfo.requiresLifePayment === true ? 1 : 0,
            forceAlternateCostId: alternateCostId,
            // Continuation args are server-only; the Resolution handler will emit castSpellFromHandContinue.
            forceCastArgs: {
              cardId,
              targets,
              payment,
              xValue,
              alternateCostId,
              convokeTappedCreatures,
              // Ensure we don't re-run prompts after paying the alternate cost.
              skipInteractivePrompts: true,
            },
          } as any);
        }

        debug(2, `[castSpellFromHand] Queued Force-of-Will alternate-cost prompt for ${cardInHand.name}`);
        return;
      }

      let hasFlash = oracleText.includes("flash");
      const isInstant = typeLine.includes("instant");
      const isInstantOrSorcery = isInstant || typeLine.includes("sorcery");

      // Check for "flash grant" effects from battlefield permanents
      // Yeva, Nature's Herald: "You may cast green creature cards as though they had flash."
      // Vedalken Orrery: "You may cast spells as though they had flash."
      // Leyline of Anticipation: "You may cast spells as though they had flash."
      // Vivien, Champion of the Wilds: "You may cast creature spells as though they had flash."
      // Emergence Zone: "You may cast spells this turn as though they had flash."
      if (!hasFlash && !isInstant) {
        const battlefield = game.state?.battlefield || [];
        const cardColors = (cardInHand.colors || cardInHand.color_identity || []).map((c: string) => c.toLowerCase());
        const isGreenCard = cardColors.includes('g') || cardColors.includes('green');
        const isCreature = typeLine.includes('creature');
        
        for (const perm of battlefield) {
          if ((perm as any).controller !== playerId) continue;
          
          const permName = ((perm as any).card?.name || '').toLowerCase();
          const permOracle = ((perm as any).card?.oracle_text || '').toLowerCase();
          
          // Yeva, Nature's Herald - green creature cards have flash
          // Use exact match to avoid false positives
          if ((permName === 'yeva, nature\'s herald' || permName.startsWith('yeva, nature')) && isGreenCard && isCreature) {
            hasFlash = true;
            debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via Yeva, Nature's Herald`);
            break;
          }
          
          // Vivien, Champion of the Wilds - creature spells have flash
          if ((permName === 'vivien, champion of the wilds' || permName.startsWith('vivien, champion')) && isCreature) {
            hasFlash = true;
            debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via Vivien, Champion of the Wilds`);
            break;
          }
          
          // Vedalken Orrery, Leyline of Anticipation - all spells have flash
          if (permName === 'vedalken orrery' || permName === 'leyline of anticipation') {
            hasFlash = true;
            debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
            break;
          }
          
          // Emergence Zone (activated ability, check if active this turn)
          if (permName.includes('emergence zone') && (perm as any).flashGrantedThisTurn) {
            hasFlash = true;
            debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via Emergence Zone`);
            break;
          }
          
          // Generic detection: "cast ... as though they had flash"
          if (permOracle.includes('as though') && permOracle.includes('had flash')) {
            // Check if it applies to this card type
            if (permOracle.includes('creature') && isCreature) {
              hasFlash = true;
              debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
              break;
            }
            if (permOracle.includes('green') && isGreenCard && isCreature) {
              hasFlash = true;
              debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
              break;
            }
            if (permOracle.includes('spells') && !permOracle.includes('creature')) {
              // "You may cast spells as though they had flash" - applies to all
              hasFlash = true;
              debug(2, `[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
              break;
            }
          }
        }
      }
      
      const isSorcerySpeed = !isInstant && !hasFlash;
      
      if (isSorcerySpeed) {
        // Sorcery-speed spells can only be cast during your main phase
        // when you have priority and the stack is empty
        const stepStr = String(game.state?.step || "").toUpperCase().trim();
        const isMainPhase = phaseStr.includes("MAIN") || stepStr.includes("MAIN");
        const isYourTurn = game.state.turnPlayer === playerId;
        const stackEmpty = !game.state.stack || game.state.stack.length === 0;
        
        if (!isMainPhase) {
          socket.emit("error", {
            code: "SORCERY_TIMING",
            message: "This spell can only be cast during a main phase (it doesn't have flash).",
          });
          return;
        }
        
        if (!isYourTurn) {
          socket.emit("error", {
            code: "SORCERY_TIMING",
            message: "This spell can only be cast during your turn (it doesn't have flash).",
          });
          return;
        }
        
        if (!stackEmpty) {
          socket.emit("error", {
            code: "SORCERY_TIMING",
            message: "This spell can only be cast when the stack is empty (it doesn't have flash).",
          });
          return;
        }
      }
      
      // Check for Abundant Harvest type spells (Choose land or nonland, then reveal until finding one)
      // Pattern: "Choose land or nonland. Reveal cards from the top of your library until you reveal a card of the chosen kind."
      const abundantHarvestMatch = oracleText.match(/choose\s+land\s+or\s+nonland/i);
      const abundantChoiceSelected = (cardInHand as any).abundantChoice || (targets as any)?.abundantChoice;
      
      if (!shouldSkipAllPrompts && abundantHarvestMatch && !abundantChoiceSelected) {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.modeSelectionPurpose || '') === 'abundantChoice');

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MODE_SELECTION,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            // Keep this short; detailed oracle text is still available via oracleContext.
            description: `Choose type for ${cardInHand.name}`,
            mandatory: true,
            modes: [
              {
                id: 'land',
                label: 'Land',
                description: 'Reveal cards until you reveal a land card, then put that card into your hand and the rest on the bottom of your library.',
              },
              {
                id: 'nonland',
                label: 'Nonland',
                description: 'Reveal cards until you reveal a nonland card, then put that card into your hand and the rest on the bottom of your library.',
              },
            ],
            minModes: 1,
            maxModes: 1,
            allowDuplicates: false,
            modeSelectionPurpose: 'abundantChoice',
            castSpellFromHandArgs: {
              cardId,
              payment,
              targets,
              xValue,
              alternateCostId,
              convokeTappedCreatures,
            },
          } as any);
        }

        debug(2, `[castSpellFromHand] Queued land/nonland choice for ${cardInHand.name} (Abundant Harvest style)`);
        return; // Wait for choice selection via Resolution Queue
      }
      
      // Check if this spell is a modal spell (Choose one/two/three - e.g., Austere Command, Cryptic Command)
      // Pattern: "Choose two ΓÇö" or "Choose one ΓÇö" followed by bullet points
      // IMPORTANT: Only apply to INSTANTS and SORCERIES, not to permanents with triggered abilities
      // Permanents like Glorious Sunrise have "At the beginning of combat on your turn, choose one ΓÇö" which is a TRIGGER, not a modal spell
      const modalSpellMatch = isInstantOrSorcery ? oracleText.match(/choose\s+(one|two|three|four|any number)\s*(?:ΓÇö|[-])/i) : null;
      const modesAlreadySelected = (cardInHand as any).selectedModes || (targets as any)?.selectedModes;
      
      // Check for Spree cards (new mechanic from Outlaws of Thunder Junction)
      // Pattern: "Spree (Choose one or more additional costs.)" followed by "+ {cost} ΓÇö Effect"
      const isSpreeCard = oracleText.includes('spree');
      const spreeModesSelected = (cardInHand as any).selectedSpreeModes || (targets as any)?.selectedSpreeModes;
      
      if (!shouldSkipAllPrompts && isSpreeCard && !spreeModesSelected) {
        // Parse spree costs and effects
        // Pattern: "+ {cost} ΓÇö Effect text"
        const spreePattern = /\+\s*(\{[^}]+\})\s*[ΓÇö-]\s*([^+]+?)(?=\+\s*\{|$)/gi;
        const spreeModes: { id: string; name: string; description: string; cost: string }[] = [];
        let match;
        let index = 0;
        
        const originalOracleText = cardInHand.oracle_text || "";
        while ((match = spreePattern.exec(originalOracleText)) !== null) {
          const cost = match[1];
          const effect = match[2].trim().replace(/\n/g, ' ');
          spreeModes.push({
            id: `spree_${index}`,
            name: `Pay ${cost}`,
            description: effect,
            cost: cost,
          });
          index++;
        }
        
        if (spreeModes.length > 0) {
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.modeSelectionPurpose || '') === 'spree');

          if (!existing) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.MODE_SELECTION,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: originalOracleText,
              mandatory: true,
              modes: spreeModes.map((m: any) => ({
                id: m.id,
                label: m.name,
                description: `${m.description}${m.cost ? ` (${m.cost})` : ''}`,
              })),
              minModes: 1,
              maxModes: -1,
              allowDuplicates: false,
              modeSelectionPurpose: 'spree',
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);
          }

          debug(2, `[castSpellFromHand] Queued Spree mode selection for ${cardInHand.name}`);
          return; // Wait for mode selection via Resolution Queue
        }
      }
      
      if (!shouldSkipAllPrompts && modalSpellMatch && !modesAlreadySelected) {
        const modeCount = modalSpellMatch[1].toLowerCase();
        const modeCountMap: Record<string, number> = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'any number': -1 };
        const numModes = modeCountMap[modeCount] ?? -1;
        
        // Extract the mode options (bullet points after "Choose X ΓÇö")
        // Pattern: "ΓÇó Mode text" repeated
        const modeOptionsMatch = oracleText.match(/(?:choose\s+(?:one|two|three|four|any number)\s*(?:ΓÇö|[-]))\s*((?:ΓÇó[^ΓÇó]+)+)/i);
        const modeOptions: { id: string; name: string; description: string }[] = [];
        
        if (modeOptionsMatch) {
          const optionsText = modeOptionsMatch[1];
          const bullets = optionsText.split('ΓÇó').filter(s => s.trim().length > 0);
          
          for (let i = 0; i < bullets.length; i++) {
            const modeText = bullets[i].trim();
            modeOptions.push({
              id: `mode_${i + 1}`,
              name: `Mode ${i + 1}`,
              description: modeText,
            });
          }
        }
        
        // Modal spells need at least 1 mode option (for "choose one") or 2+ (for "choose two" etc.)
        if (modeOptions.length >= numModes || (numModes === -1 && modeOptions.length > 0)) {
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.modeSelectionPurpose || '') === 'modalSpell');

          if (!existing) {
            const minModes = numModes === -1 ? 1 : Math.max(1, numModes);
            const maxModes = numModes;

            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.MODE_SELECTION,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: oracleText,
              mandatory: true,
              modes: modeOptions.map((m: any) => ({
                id: m.id,
                label: m.name,
                description: m.description,
              })),
              minModes,
              maxModes,
              allowDuplicates: false,
              modeSelectionPurpose: 'modalSpell',
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);
          }

          debug(2, `[castSpellFromHand] Queued modal selection (choose ${modeCount}) for ${cardInHand.name}`);
          return; // Wait for mode selection via Resolution Queue
        }
      }
      
      // Check if this spell has overload (e.g., Cyclonic Rift)
      // If it does, and player hasn't specified which mode to use, prompt for mode selection
      const hasOverload = oracleText.includes('overload');
      const overloadMatch = oracleText.match(/overload\s*\{([^}]+)\}/i);
      const overloadCost = overloadMatch ? `{${overloadMatch[1]}}` : null;
      
      // Check if overload mode was specified in the cast request
      const castWithOverload = (payment as any[])?.some((p: any) => p.overload === true) || 
                               (targets as any)?.overload === true ||
                               (cardInHand as any).castWithOverload === true;
      
      if (hasOverload && overloadCost && !castWithOverload && !((payment as any)?.modeSelected)) {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.MODE_SELECTION && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.modeSelectionPurpose || '') === 'overload');

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.MODE_SELECTION,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: `Choose casting mode for ${cardInHand.name}`,
            mandatory: true,
            modes: [
              {
                id: 'normal',
                label: 'Normal',
                description: `Cast ${cardInHand.name} normally.`,
              },
              {
                id: 'overload',
                label: 'Overload',
                description: `Cast ${cardInHand.name} with Overload (replaces "target" with "each").`,
              },
            ],
            minModes: 1,
            maxModes: 1,
            allowDuplicates: false,
            modeSelectionPurpose: 'overload',
            castSpellFromHandArgs: {
              cardId,
              payment,
              targets,
              xValue,
              alternateCostId,
              convokeTappedCreatures,
            },
          } as any);
        }

        debug(2, `[castSpellFromHand] Queued overload mode selection for ${cardInHand.name}`);
        return; // Wait for mode selection via Resolution Queue
      }

      // Check if this spell requires paying X life (Toxic Deluge, Hatred, etc.)
      // If the player hasn't specified the life payment amount, prompt for it
      // Skip this check for permanents (creatures, artifacts, enchantments) - they have activated abilities, not cast costs
      const cardNameLower = (cardInHand.name || '').toLowerCase();
      const cardTypeLine = (cardInHand.type_line || '').toLowerCase();
      const isPermanent = cardTypeLine.includes('creature') || cardTypeLine.includes('artifact') || 
                         cardTypeLine.includes('enchantment') || cardTypeLine.includes('planeswalker') || 
                         cardTypeLine.includes('land');
      const payXLifeInfo = PAY_X_LIFE_CARDS[cardNameLower];
      const lifePaymentProvided = (payment as any[])?.some((p: any) => typeof p.lifePayment === 'number') ||
                                   (targets as any)?.lifePayment !== undefined;
      
      if (payXLifeInfo && !lifePaymentProvided && !isPermanent) {
        // Get the player's current life to determine max payment
        const startingLife = game.state.startingLife || 40;
        const currentLife = game.state.life?.[playerId] ?? startingLife;
        const maxPayable = getMaxPayableLife(currentLife);
        const minPayment = payXLifeInfo.minX || 0;
        
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => s?.type === ResolutionStepType.LIFE_PAYMENT && String((s as any)?.cardId || '') === String(cardId));

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.LIFE_PAYMENT,
            playerId: playerId as any,
            sourceId: cardId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: payXLifeInfo.effect,
            mandatory: true,
            cardId,
            cardName: cardInHand.name,
            currentLife,
            minPayment,
            maxPayment: maxPayable,
          } as any);
        }

        debug(2, `[castSpellFromHand] Queued life payment (${minPayment}-${maxPayable}) for ${cardInHand.name}`);
        return; // Wait for life payment selection via Resolution Queue
      }
      
      // If life payment was provided, validate it
      if (payXLifeInfo && lifePaymentProvided) {
        const lifePayment = (payment as any[])?.find((p: any) => typeof p.lifePayment === 'number')?.lifePayment ||
                            (targets as any)?.lifePayment || 0;
        const startingLife = game.state.startingLife || 40;
        const currentLife = game.state.life?.[playerId] ?? startingLife;
        
        const validationError = validateLifePayment(currentLife, lifePayment, cardInHand.name);
        if (validationError) {
          socket.emit("error", {
            code: "INVALID_LIFE_PAYMENT",
            message: validationError,
          });
          return;
        }
        
        // Store the life payment on the card for later resolution
        (cardInHand as any).lifePaymentAmount = lifePayment;
        debug(2, `[castSpellFromHand] Life payment of ${lifePayment} validated for ${cardInHand.name}`);
      }
      
      // Check for additional costs (discard a card, sacrifice, etc.)
      // This handles cards like Seize the Spoils, Faithless Looting, etc.
      const additionalCost = detectAdditionalCost(oracleText);
      const additionalCostPaid = (payment as any[])?.some((p: any) => p && p.additionalCostPaid === true) ||
                                  (targets as any)?.additionalCostPaid === true;

      // Bargain (WOE): optional additional cost while casting.
      // We treat this as a replay-stable, explicit player choice: either they sacrificed (wasBargained=true)
      // or they declined / had no legal targets (wasBargained=false). If untracked, keep it null.
      const hasBargain = /\bbargain\b/i.test(String(oracleText || ''));
      const bargainMarker = (payment as any[])?.find((p: any) =>
        p &&
        (p.bargainResolved === true ||
          p.wasBargained === true ||
          p.wasBargained === false ||
          p.bargained === true ||
          p.bargained === false)
      );
      let bargainResolved =
        bargainMarker?.bargainResolved === true ||
        (targets as any)?.bargainResolved === true ||
        (cardInHand as any)?.bargainResolved === true;
      const rawWasBargained =
        bargainMarker?.wasBargained ??
        bargainMarker?.bargained ??
        (targets as any)?.wasBargained ??
        (targets as any)?.bargained ??
        (cardInHand as any)?.wasBargained ??
        (cardInHand as any)?.bargained;
      let wasBargained = typeof rawWasBargained === 'boolean' ? rawWasBargained : null;

      // Collect-evidence additional cost markers (optional costs must avoid re-prompt loops).
      const collectEvidenceMarker = (payment as any[])?.find((p: any) =>
        p && (p.collectEvidenceResolved === true || p.evidenceCollected === true || p.evidenceWasCollected === true || p.collectedEvidence === true)
      );
      const collectEvidenceResolved =
        collectEvidenceMarker?.collectEvidenceResolved === true ||
        (targets as any)?.collectEvidenceResolved === true ||
        (cardInHand as any)?.collectEvidenceResolved === true;
      const evidenceCollected =
        collectEvidenceMarker?.evidenceCollected === true ||
        collectEvidenceMarker?.evidenceWasCollected === true ||
        collectEvidenceMarker?.collectedEvidence === true ||
        (targets as any)?.evidenceCollected === true ||
        (targets as any)?.evidenceWasCollected === true ||
        (targets as any)?.collectedEvidence === true ||
        (cardInHand as any)?.evidenceCollected === true ||
        (cardInHand as any)?.evidenceWasCollected === true ||
        (cardInHand as any)?.collectedEvidence === true;

      if (!shouldSkipAllPrompts && hasBargain && !bargainResolved) {
        const battlefield = game.state?.battlefield || [];
        const validBargainTargets = battlefield.filter((p: any) => {
          if (!p) return false;
          if (p.controller !== playerId) return false;
          if (p.isToken === true) return true;
          const tl = String(p.card?.type_line || '').toLowerCase();
          return tl.includes('artifact') || tl.includes('enchantment');
        });

        // If there are no legal permanents to sacrifice, Bargain is deterministically not paid.
        if (validBargainTargets.length === 0) {
          (targets as any) = (targets as any) || {};
          (targets as any).bargainResolved = true;
          (targets as any).wasBargained = false;
          bargainResolved = true;
          wasBargained = false;
        } else {
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) =>
              s?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT &&
              String((s as any)?.sourceId || '') === String(cardId) &&
              String((s as any)?.costType || '') === 'sacrifice' &&
              String((s as any)?.additionalCostKeyword || '').toLowerCase().trim() === 'bargain'
            );

          if (!existing) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `Bargain (optional): You may sacrifice an artifact, enchantment, or token as you cast ${cardInHand.name}. Submit with 0 selections to decline.`,
              mandatory: false,
              cardId,
              cardName: cardInHand.name,
              costType: 'sacrifice',
              amount: 1,
              additionalCostKeyword: 'bargain',
              title: `Bargain (optional) — ${cardInHand.name}`,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              availableTargets: validBargainTargets.map((p: any) => ({
                id: p.id,
                name: p.card?.name || 'Unknown',
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                typeLine: p.card?.type_line,
              })),
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);
          }

          debug(2, `[castSpellFromHand] Queued Bargain (optional) prompt for ${cardInHand.name}`);
          return; // Wait for Bargain selection via Resolution Queue
        }
      }
      
      if (!shouldSkipAllPrompts && additionalCost?.type === 'collect_evidence' && !collectEvidenceResolved) {
        const required = Number((additionalCost as any).collectEvidenceValue || 0);
        const optional = Boolean((additionalCost as any).collectEvidenceIsOptional);

        if (!Number.isFinite(required) || required <= 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_ADDITIONAL_COST',
            message: `Additional cost "Collect evidence" is not supported yet for ${cardInHand.name}.`,
          });
          return;
        }

        const gy = Array.isArray(zones.graveyard) ? zones.graveyard : [];
        const validTargets = gy.map((c: any) => ({
          id: String(c?.id || ''),
          name: String(c?.name || c?.id || 'Card'),
          typeLine: c?.type_line,
          manaCost: c?.mana_cost,
          imageUrl: c?.image_uris?.small || c?.image_uris?.normal,
        })).filter((t: any) => Boolean(t.id));

        const effectId = cardId;
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => (s as any)?.type === ResolutionStepType.GRAVEYARD_SELECTION && String((s as any)?.effectId || '') === String(effectId));

        if (!existing) {
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.GRAVEYARD_SELECTION,
            playerId: playerId as any,
            sourceId: effectId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: optional
              ? `You may collect evidence ${required} for ${cardInHand.name} by exiling cards from your graveyard (total mana value ${required} or more). Submit with 0 selections to decline.`
              : `Collect evidence ${required} for ${cardInHand.name} by exiling cards from your graveyard (total mana value ${required} or more).`,
            mandatory: !optional,
            effectId,
            cardName: cardInHand.name,
            title: `Collect evidence ${required} (${cardInHand.name})`,
            targetPlayerId: playerId,
            minTargets: optional ? 0 : 1,
            maxTargets: Math.max(optional ? 0 : 1, validTargets.length),
            destination: 'exile',
            purpose: 'collectEvidence',
            collectEvidenceMinManaValue: required,
            validTargets,
            castSpellFromHandArgs: {
              cardId,
              payment,
              targets,
              xValue,
              alternateCostId,
              convokeTappedCreatures,
            },
          } as any);
        }

        debug(2, `[castSpellFromHand] Queued collect evidence ${required} prompt for ${cardInHand.name}`);
        return; // Wait for graveyard selection via Resolution Queue
      }

      if (!shouldSkipAllPrompts && additionalCost && !additionalCostPaid) {
        // Need to prompt for additional cost payment
        if (additionalCost.type === 'discard') {
          // Check if player has enough cards to discard
          const handCards = zones.hand.filter((c: any) => c.id !== cardId); // Exclude the card being cast
          if (handCards.length < additionalCost.amount) {
            socket.emit("error", {
              code: "CANNOT_PAY_COST",
              message: `Cannot cast ${cardInHand.name}: You need to discard ${additionalCost.amount} card(s) but only have ${handCards.length} other card(s) in hand.`,
            });
            return;
          }
          
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => s?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.costType || '') === 'discard');

          if (!existing) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `As an additional cost to cast ${cardInHand.name}, discard ${additionalCost.amount} card${additionalCost.amount > 1 ? 's' : ''}.`,
              mandatory: true,
              cardId,
              cardName: cardInHand.name,
              costType: 'discard',
              amount: additionalCost.amount,
              title: `Discard ${additionalCost.amount} card${additionalCost.amount > 1 ? 's' : ''} to cast ${cardInHand.name}`,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              availableCards: handCards.map((c: any) => ({
                id: c.id,
                name: c.name,
                imageUrl: c.image_uris?.small || c.image_uris?.normal,
                typeLine: c.type_line,
              })),
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);
          }

          debug(2, `[castSpellFromHand] Queued discard of ${additionalCost.amount} card(s) for ${cardInHand.name}`);
          return; // Wait for discard selection via Resolution Queue
        } else if (additionalCost.type === 'sacrifice') {
          // Find valid sacrifice targets
          const battlefield = game.state?.battlefield || [];
          const validSacrificeTargets = battlefield.filter((p: any) => {
            if (p.controller !== playerId) return false;
            const tl = (p.card?.type_line || '').toLowerCase();
            if (!additionalCost.filter) return true;
            return tl.includes(additionalCost.filter.toLowerCase());
          });
          
          if (validSacrificeTargets.length < additionalCost.amount) {
            socket.emit("error", {
              code: "CANNOT_PAY_COST",
              message: `Cannot cast ${cardInHand.name}: You need to sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}(s) but don't control enough.`,
            });
            return;
          }
          
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => s?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.costType || '') === 'sacrifice');

          if (!existing) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `As an additional cost to cast ${cardInHand.name}, sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}${additionalCost.amount > 1 ? 's' : ''}.`,
              mandatory: true,
              cardId,
              cardName: cardInHand.name,
              costType: 'sacrifice',
              amount: additionalCost.amount,
              filter: additionalCost.filter,
              title: `Sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}${additionalCost.amount > 1 ? 's' : ''} to cast ${cardInHand.name}`,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              availableTargets: validSacrificeTargets.map((p: any) => ({
                id: p.id,
                name: p.card?.name || 'Unknown',
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                typeLine: p.card?.type_line,
              })),
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);
          }

          debug(2, `[castSpellFromHand] Queued sacrifice of ${additionalCost.amount} ${additionalCost.filter || 'permanent'}(s) for ${cardInHand.name}`);
          return; // Wait for sacrifice selection via Resolution Queue
        } else if (additionalCost.type === 'pay_life') {
          // Pay X life as an additional cost (Vampiric Tutor, etc.)
          const startingLife = game.state.startingLife || 40;
          const currentLife = game.state.life?.[playerId] ?? startingLife;
          
          // Validate that player can pay the life
          if (currentLife < additionalCost.amount) {
            socket.emit("error", {
              code: "CANNOT_PAY_COST",
              message: `Cannot cast ${cardInHand.name}: You need to pay ${additionalCost.amount} life but only have ${currentLife} life.`,
            });
            return;
          }
          
          // Pay the life immediately
          game.state.life = game.state.life || {};
          game.state.life[playerId] = currentLife - additionalCost.amount;

          // Track life lost this turn.
          try {
            (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
            (game.state as any).lifeLostThisTurn[String(playerId)] =
              ((game.state as any).lifeLostThisTurn[String(playerId)] || 0) + Number(additionalCost.amount || 0);
          } catch {}
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, playerId)} pays ${additionalCost.amount} life to cast ${cardInHand.name}. (${currentLife} ΓåÆ ${game.state.life[playerId]})`,
            ts: Date.now(),
          });
          
          debug(2, `[castSpellFromHand] Player paid ${additionalCost.amount} life for ${cardInHand.name}`);
          
          // Mark additional cost as paid
          (targets as any) = (targets as any) || {};
          (targets as any).additionalCostPaid = true;
        } else if (additionalCost.type === 'squad') {
          // Squad: "As an additional cost to cast this spell, you may pay {cost} any number of times"
          // Prompt the player to choose how many times to pay the squad cost
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => s?.type === ResolutionStepType.SQUAD_COST_PAYMENT && String((s as any)?.sourceId || '') === String(cardId));

          if (!existing) {
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.SQUAD_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `Choose how many times to pay Squad for ${cardInHand.name}.`,
              mandatory: true,
              cardId,
              cardName: cardInHand.name,
              squadCost: additionalCost.cost,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);
          }

          debug(2, `[castSpellFromHand] Queued squad payment for ${cardInHand.name} (cost: ${additionalCost.cost})`);
          return; // Wait for squad payment selection via Resolution Queue
        }
      }

      // Check if this spell requires targets (oracleText is already defined above)
      // IMPORTANT: Only check for targeting if:
      // 1. The spell is an instant/sorcery, OR
      // 2. The spell is an Aura enchantment (Auras target when cast)
      // Non-Aura permanents (creatures, artifacts, regular enchantments, planeswalkers) don't require 
      // targets when cast, even if they have activated/triggered abilities with "target" in the text.
      // This includes Equipment (which are artifacts) - they enter unattached and equipping is a separate ability.
      // An Aura is an enchantment with "Aura" in the type line AND "Enchant" at the start of its oracle text
      const isAura = typeLine.includes('aura') && /^enchant\s+/i.test(oracleText);
      // Use the isInstantOrSorcery already declared above (line 2101)
      const requiresTargetingCheck = isInstantOrSorcery || isAura;
      
      // For Auras, determine valid targets based on "Enchant X" text
      // Common patterns: "Enchant creature", "Enchant player", "Enchant opponent", "Enchant permanent"
      // Also handles: "Enchant creature you control", "Enchant creature an opponent controls", etc.
      let auraTargetType: 'creature' | 'player' | 'opponent' | 'permanent' | 'artifact' | 'land' | null = null;
      let auraControllerRestriction: 'you_control' | 'opponent_controls' | 'any' = 'any';
      if (isAura) {
        const enchantMatch = oracleText.match(/enchant\s+(creature|player|opponent|permanent|artifact|land|enchantment)(?:\s+(you control|an opponent controls))?/i);
        if (enchantMatch) {
          auraTargetType = enchantMatch[1].toLowerCase() as typeof auraTargetType;
          // Check for controller restriction
          if (enchantMatch[2]) {
            const restriction = enchantMatch[2].toLowerCase();
            if (restriction === 'you control') {
              auraControllerRestriction = 'you_control';
            } else if (restriction === 'an opponent controls') {
              auraControllerRestriction = 'opponent_controls';
            }
          }
        }
      }
      
      // Use comprehensive targeting detection for instants/sorceries
      // This catches ALL spells with "target" in their text, not just specific patterns
      const spellSpec = (requiresTargetingCheck && !isAura) ? categorizeSpell(cardInHand.name || '', oracleText) : null;
      
      // If categorizeSpell didn't find a pattern but the spell has "target" in text,
      // use the comprehensive detection
      const targetReqs = (isInstantOrSorcery && !isAura) ? parseTargetRequirements(oracleText) : null;
      
      // Only request target selection if:
      // 1. The spell requires targets (minTargets > 0 OR needsTargets)
      // 2. AND no targets have been provided yet
      // This prevents double-targeting when completeCastSpell is called with targets already set
      const needsTargetSelection = (spellSpec && spellSpec.minTargets > 0 && (!targets || targets.length === 0)) || 
                                   (targetReqs && targetReqs.needsTargets && (!targets || targets.length === 0));
      
      // DEBUG: Log targeting logic to debug infinite loop
      debug(2, `[handleCastSpellFromHand] ${cardInHand.name}: spellSpec=${!!spellSpec}, targetReqs=${!!targetReqs}, needsTargetSelection=${needsTargetSelection}, hasTargets=${!!(targets && targets.length > 0)}`);
      
      // Handle Aura targeting separately from spell targeting
      // CRITICAL FIX: Skip Aura target request if we're completing a previous cast
      if (!skipInteractivePrompts && isAura && auraTargetType && (!targets || targets.length === 0)) {
        // Build valid targets based on Aura's enchant type
        let validTargets: { id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string }[] = [];
        
        if (auraTargetType === 'player') {
          // Enchant player - can target any player
          validTargets = (game.state.players || []).map((p: any) => ({
            id: p.id,
            kind: 'player',
            name: p.name || p.id,
            isOpponent: p.id !== playerId,
          }));
        } else if (auraTargetType === 'opponent') {
          // Enchant opponent - can only target opponents (Curses typically)
          validTargets = (game.state.players || [])
            .filter((p: any) => p.id !== playerId)
            .map((p: any) => ({
              id: p.id,
              kind: 'player',
              name: p.name || p.id,
              isOpponent: true,
            }));
        } else if (auraTargetType === 'creature') {
          // Enchant creature - target creatures on battlefield
          // Apply controller restriction if present ("you control" or "an opponent controls")
          validTargets = (game.state.battlefield || [])
            .filter((p: any) => {
              const tl = (p.card?.type_line || '').toLowerCase();
              if (!tl.includes('creature')) return false;
              
              // Apply controller restriction
              if (auraControllerRestriction === 'you_control' && p.controller !== playerId) return false;
              if (auraControllerRestriction === 'opponent_controls' && p.controller === playerId) return false;
              
              return true;
            })
            .map((p: any) => ({
              id: p.id,
              kind: 'permanent',
              name: p.card?.name || 'Unknown',
              controller: p.controller,
              isOpponent: p.controller !== playerId,
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));
        } else if (auraTargetType === 'permanent') {
          // Enchant permanent - any permanent
          validTargets = (game.state.battlefield || []).map((p: any) => ({
            id: p.id,
            kind: 'permanent',
            name: p.card?.name || 'Unknown',
            controller: p.controller,
            isOpponent: p.controller !== playerId,
            imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
          }));
        } else if (auraTargetType === 'artifact') {
          validTargets = (game.state.battlefield || [])
            .filter((p: any) => (p.card?.type_line || '').toLowerCase().includes('artifact'))
            .map((p: any) => ({
              id: p.id,
              kind: 'permanent',
              name: p.card?.name || 'Unknown',
              controller: p.controller,
              isOpponent: p.controller !== playerId,
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));
        } else if (auraTargetType === 'land') {
          validTargets = (game.state.battlefield || [])
            .filter((p: any) => (p.card?.type_line || '').toLowerCase().includes('land'))
            .map((p: any) => ({
              id: p.id,
              kind: 'permanent',
              name: p.card?.name || 'Unknown',
              controller: p.controller,
              isOpponent: p.controller !== playerId,
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            }));
        }
        
        if (validTargets.length === 0) {
          socket.emit("error", {
            code: "NO_VALID_TARGETS",
            message: `No valid targets for ${cardInHand.name} (Enchant ${auraTargetType})`,
          });
          return;
        }
        
        // Generate effectId for tracking this cast through the workflow
        const effectId = `cast_${cardId}_${Date.now()}`;
        
        // Store pending cast info for after targets are selected (like requestCastSpell does)
        // This ensures target selection response can find the pending spell and request payment
        // IMPORTANT: Copy the full card object to prevent issues where card info is deleted
        // before it can be read during the target > pay workflow (fixes loop issue)
        (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
        (game.state as any).pendingSpellCasts[effectId] = {
          cardId,
          cardName: cardInHand.name,
          manaCost: cardInHand.mana_cost || "",
          playerId,
          validTargetIds: validTargets.map((t: any) => t.id),
          card: { ...cardInHand }, // Copy full card object to preserve oracle text, type line, etc.
        };
        
        // Use Resolution Queue for Aura target selection
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: playerId as PlayerID,
          description: `Choose target for ${cardInHand.name}`,
          mandatory: true,
          sourceId: effectId,
          sourceName: cardInHand.name,
          sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          validTargets: validTargets.map((t: any) => ({
            id: t.id,
            label: t.name,
            description: t.kind,
            imageUrl: t.imageUrl,
          })),
          targetTypes: ['aura_target'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: `Enchant ${auraTargetType}`,
          // Store spell casting context for payment request after targets selected
          spellCastContext: {
            cardId,
            cardName: cardInHand.name,
            manaCost: cardInHand.mana_cost || "",
            playerId,
            effectId,
            oracleText: cardInHand.oracle_text || '',
            imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          },
        });
        
        debug(2, `[castSpellFromHand] Added TARGET_SELECTION step for Aura target (enchant ${auraTargetType}) for ${cardInHand.name}`);
        return; // Wait for target selection via Resolution Queue
      }
      
      // Handle targeting for instants/sorceries
      // Use BOTH spellSpec (for known patterns) and targetReqs (for any "target" text)
      if (needsTargetSelection) {
        // This spell requires targets - check if we have them already
        const requiredMinTargets = spellSpec?.minTargets || targetReqs?.minTargets || 1;
        const requiredMaxTargets = spellSpec?.maxTargets || targetReqs?.maxTargets || 1;
        
        // CRITICAL: Check if there's already a pending cast for this card to prevent infinite loop
        // If a pending cast exists, it means we've already requested targets before
        const existingPendingCast = (game.state as any).pendingSpellCasts ? 
          Object.values((game.state as any).pendingSpellCasts).find((pc: any) => pc.cardId === cardId) : null;
        
        if (existingPendingCast) {
          debugError(1, `[castSpellFromHand] LOOP PREVENTION: Pending cast already exists for ${cardInHand.name}. This should not happen!`);
          socket.emit("error", {
            code: "TARGETING_LOOP_DETECTED",
            message: `Targeting error for ${cardInHand.name}. Please try casting again.`,
          });
          return;
        }
        
        // CRITICAL FIX: Skip target request if we're completing a previous cast (prevents infinite loop)
        debug(2, `[handleCastSpellFromHand] Checking if need to request targets: skipInteractivePrompts=${skipInteractivePrompts}, hasTargets=${!!(targets && targets.length > 0)}, minRequired=${requiredMinTargets}`);
        
        if (!skipInteractivePrompts && (!targets || targets.length < requiredMinTargets)) {
          debug(2, `[handleCastSpellFromHand] Requesting targets for ${cardInHand.name} (minTargets: ${requiredMinTargets}, maxTargets: ${requiredMaxTargets})`);
          // Need to request targets from the player
          // Build valid targets based on what the spell can target
          let validTargetList: { id: string; kind: string; name: string; isOpponent?: boolean; controller?: string; imageUrl?: string; typeLine?: string }[] = [];
          
          // Use evaluateTargeting if we have a spellSpec
          if (spellSpec) {
            const validRefs = evaluateTargeting(game.state as any, playerId, spellSpec);
            validTargetList = validRefs.map((t: any) => {
              if (t.kind === 'permanent') {
                const perm = (game.state.battlefield || []).find((p: any) => p.id === t.id);
                return {
                  id: t.id,
                  kind: t.kind,
                  name: perm?.card?.name || 'Unknown',
                  imageUrl: perm?.card?.image_uris?.small || perm?.card?.image_uris?.normal,
                  controller: perm?.controller,
                  isOpponent: perm?.controller !== playerId,
                };
              } else if (t.kind === 'stack') {
                const stackItem = (game.state.stack || []).find((s: any) => s.id === t.id);
                return {
                  id: t.id,
                  kind: t.kind,
                  name: stackItem?.card?.name || 'Unknown Spell',
                  imageUrl: stackItem?.card?.image_uris?.small || stackItem?.card?.image_uris?.normal,
                  controller: stackItem?.controller,
                  isOpponent: stackItem?.controller !== playerId,
                  typeLine: stackItem?.card?.type_line,
                };
              } else {
                const player = (game.state.players || []).find((p: any) => p.id === t.id);
                return {
                  id: t.id,
                  kind: t.kind,
                  name: player?.name || t.id,
                  isOpponent: t.id !== playerId,
                };
              }
            });
          } else if (targetReqs) {
            // Build targets based on parsed requirements
            for (const targetType of targetReqs.targetTypes) {
              const targetTypeLower = targetType.toLowerCase();
              if (targetTypeLower === 'creature' || targetTypeLower === 'permanent' || targetTypeLower === 'artifact' || 
                  targetTypeLower === 'enchantment' || targetTypeLower === 'land' || targetTypeLower === 'planeswalker' ||
                  targetTypeLower.includes('nonland') || targetTypeLower.includes('noncreature')) {
                // Add battlefield permanents matching the type
                const perms = (game.state.battlefield || []).filter((p: any) => {
                  const tl = (p.card?.type_line || '').toLowerCase();
                  if (targetTypeLower === 'permanent') return true;
                  if (targetTypeLower.includes('nonland')) return !tl.includes('land');
                  if (targetTypeLower.includes('noncreature')) return !tl.includes('creature');
                  return tl.includes(targetTypeLower);
                });
                for (const perm of perms) {
                  validTargetList.push({
                    id: perm.id,
                    kind: 'permanent',
                    name: perm.card?.name || 'Unknown',
                    imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
                    controller: perm.controller,
                    isOpponent: perm.controller !== playerId,
                  });
                }
              } else if (targetType === 'player' || targetType === 'opponent' || targetType === 'any') {
                // Add players
                const players = (game.state.players || []).filter((p: any) => {
                  if (targetType === 'opponent') return p.id !== playerId;
                  return true;
                });
                for (const p of players) {
                  validTargetList.push({
                    id: p.id,
                    kind: 'player',
                    name: p.name || p.id,
                    isOpponent: p.id !== playerId,
                  });
                }
                // If "any target", also add creatures and planeswalkers
                if (targetType === 'any') {
                  const perms = (game.state.battlefield || []).filter((p: any) => {
                    const tl = (p.card?.type_line || '').toLowerCase();
                    return tl.includes('creature') || tl.includes('planeswalker');
                  });
                  for (const perm of perms) {
                    validTargetList.push({
                      id: perm.id,
                      kind: 'permanent',
                      name: perm.card?.name || 'Unknown',
                      imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
                      controller: perm.controller,
                      isOpponent: perm.controller !== playerId,
                    });
                  }
                }
              } else if (targetType === 'spell') {
                // Add spells on the stack
                const stackItems = (game.state.stack || []).filter((s: any) => s.controller !== playerId);
                for (const item of stackItems) {
                  validTargetList.push({
                    id: item.id,
                    kind: 'stack',
                    name: item.card?.name || 'Unknown Spell',
                    imageUrl: item.card?.image_uris?.small || item.card?.image_uris?.normal,
                    controller: item.controller,
                    isOpponent: item.controller !== playerId,
                    typeLine: item.card?.type_line,
                  });
                }
              }
            }
          }
          
          if (validTargetList.length === 0) {
            socket.emit("error", {
              code: "NO_VALID_TARGETS",
              message: `No valid targets for ${cardInHand.name}`,
            });
            return;
          }
          
          // Emit target selection request
          const targetDescription = targetReqs?.targetDescription || spellSpec?.targetDescription || 'target';
          const effectId = `cast_${cardId}_${Date.now()}`;
          
          // Store pending cast info for after targets are selected (like requestCastSpell does)
          // This ensures target selection response can find the pending spell and request payment
          // IMPORTANT: Copy the full card object to prevent issues where card info is deleted
          // before it can be read during the target > pay workflow (fixes loop issue)
          (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
          (game.state as any).pendingSpellCasts[effectId] = {
            cardId,
            cardName: cardInHand.name,
            manaCost: cardInHand.mana_cost || "",
            playerId,
            validTargetIds: validTargetList.map((t: any) => t.id),
            card: { ...cardInHand }, // Copy full card object to preserve oracle text, type line, etc.
          };
          
          // Check for per-opponent targeting (e.g., Dismantling Wave)
          // For these spells, group targets by controller and let player select one per opponent
          if (targetReqs?.perOpponent) {
            const opponents = (game.state.players || []).filter((p: any) => p.id !== playerId);
            const targetsPerOpponent: Record<string, typeof validTargetList> = {};
            
            // Group valid targets by their controller (opponent)
            for (const target of validTargetList) {
              if (target.controller && target.controller !== playerId) {
                if (!targetsPerOpponent[target.controller]) {
                  targetsPerOpponent[target.controller] = [];
                }
                targetsPerOpponent[target.controller].push(target);
              }
            }
            
            // Use Resolution Queue for per-opponent target selection
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TARGET_SELECTION,
              playerId: playerId as PlayerID,
              description: `Choose targets for ${cardInHand.name}`,
              mandatory: true,
              sourceId: effectId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              validTargets: validTargetList.map((t: any) => ({
                id: t.id,
                label: t.name,
                description: t.kind,
                imageUrl: t.imageUrl,
                controller: t.controller,
              })),
              targetTypes: ['spell_target'],
              minTargets: requiredMinTargets * Object.keys(targetsPerOpponent).length, // Adjusted for per-opponent
              maxTargets: requiredMaxTargets * Object.keys(targetsPerOpponent).length,
              targetDescription,
              perOpponent: true,
              targetsPerOpponent: Object.fromEntries(
                Object.entries(targetsPerOpponent).map(([oppId, targets]) => [
                  oppId,
                  targets.map((t: any) => ({
                    id: t.id,
                    label: t.name,
                    description: t.kind,
                    imageUrl: t.imageUrl,
                  }))
                ])
              ),
              opponents: opponents.map((p: any) => ({ id: p.id, name: p.name || p.id })),
              minTargetsPerOpponent: requiredMinTargets,
              maxTargetsPerOpponent: requiredMaxTargets,
              spellCastContext: {
                cardId,
                cardName: cardInHand.name,
                manaCost: cardInHand.mana_cost || "",
                playerId,
                effectId,
                oracleText,
                imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              },
            });
            
            debug(2, `[castSpellFromHand] Added TARGET_SELECTION step for per-opponent targets for ${cardInHand.name} (${opponents.length} opponents, ${requiredMinTargets}-${requiredMaxTargets} targets each)`);
            return; // Wait for target selection via Resolution Queue
          }
          
          // Use Resolution Queue for target selection
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: playerId as PlayerID,
            description: `Choose ${targetDescription} for ${cardInHand.name}`,
            mandatory: true,
            sourceId: effectId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            validTargets: validTargetList.map((t: any) => ({
              id: t.id,
              label: t.name,
              description: t.kind,
              imageUrl: t.imageUrl,
            })),
            targetTypes: ['spell_target'],
            minTargets: requiredMinTargets,
            maxTargets: requiredMaxTargets,
            targetDescription,
            // Store spell casting context for payment request after targets selected
            spellCastContext: {
              cardId,
              cardName: cardInHand.name,
              manaCost: cardInHand.mana_cost || "",
              playerId,
              effectId,
              oracleText,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            },
          });
          
          debug(2, `[castSpellFromHand] Added TARGET_SELECTION step for ${requiredMinTargets}-${requiredMaxTargets} target(s) for ${cardInHand.name} (${targetDescription})`);
          return; // Wait for target selection via Resolution Queue
        } else {
          debug(2, `[handleCastSpellFromHand] Skipping target request - already have ${targets?.length || 0} target(s) or skipInteractivePrompts=${skipInteractivePrompts}`);
        }
        
        // Validate provided targets if we have a spellSpec
        if (spellSpec && targets && targets.length > 0) {
          debug(2, `[handleCastSpellFromHand] Validating ${targets.length} target(s) for ${cardInHand.name}`);
          const validRefs = evaluateTargeting(game.state as any, playerId, spellSpec);
          const validTargetIds = new Set(validRefs.map((t: any) => t.id));
          
          for (const target of targets) {
            const targetId = typeof target === 'string' ? target : target.id;
            if (!validTargetIds.has(targetId)) {
              debugError(1, `[handleCastSpellFromHand] INVALID TARGET: ${targetId} not in valid set`);
              socket.emit("error", {
                code: "INVALID_TARGET",
                message: `Invalid target for ${cardInHand.name}`,
              });
              return;
            }
          }
          debug(2, `[handleCastSpellFromHand] All targets validated successfully`);
        }
      } // Close if (needsTargetSelection)
      
      debug(2, `[handleCastSpellFromHand] ======== DEBUG END ========`);

      // If Force-style alternate cost was chosen and paid, the mana cost is treated as {0}.
      // We must not tap mana or consume floating mana.
      const isForceAltCostPaid = isForceAltCostRequested && (cardInHand as any).forceAltCostPaid === true;

      // Parse the mana cost to validate payment
      const manaCost = isForceAltCostPaid ? '' : (cardInHand.mana_cost || "");
      const parsedCost = parseManaCost(manaCost);
      
      // Calculate cost reduction from battlefield effects
      const costReduction = calculateCostReduction(game, playerId, cardInHand, false);
      
      // Apply cost reduction
      const reducedCost = applyCostReduction(parsedCost, costReduction);
      
      // Log cost reduction if any
      if (costReduction.messages.length > 0) {
        debug(1, `[castSpellFromHand] Cost reduction for ${cardInHand.name}: ${costReduction.messages.join(", ")}`);
        debug(2, `[castSpellFromHand] Original cost: ${manaCost}, Reduced generic: ${parsedCost.generic} -> ${reducedCost.generic}`);
      }
      
      // Calculate total mana cost for spell from hand (using reduced cost)
      const totalGeneric = reducedCost.generic;
      const totalColored = reducedCost.colors;
      
      // Get existing mana pool (floating mana from previous spells)
      const existingPool = getOrInitManaPool(game.state, playerId);
      
      // Calculate total available mana using calculateManaProduction to account for 
      // mana-increasing effects (Wild Growth, Mana Reflection, Caged Sun, etc.)
      const globalBattlefield = game.state?.battlefield || [];
      const totalAvailable: Record<string, number> = {
        white: existingPool.white || 0,
        blue: existingPool.blue || 0,
        black: existingPool.black || 0,
        red: existingPool.red || 0,
        green: existingPool.green || 0,
        colorless: existingPool.colorless || 0,
      };
      
      // Add mana from payment sources, using calculateManaProduction for accurate amounts
      if (payment && payment.length > 0) {
        for (const { permanentId, mana, count } of payment) {
          const permanent = globalBattlefield.find((p: any) => p?.id === permanentId && p?.controller === playerId);
          if (permanent && !(permanent as any).tapped) {
            // Calculate actual mana production with effects
            let manaAmount: number;
            if (count !== undefined && count !== null) {
              // Client provided explicit count, but we should still check for effects
              const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana);
              // Use the larger of client count or calculated production (effects may increase)
              manaAmount = Math.max(count, manaInfo.totalAmount);
            } else {
              const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana);
              manaAmount = manaInfo.totalAmount;
            }
            
            const colorKey = MANA_COLOR_NAMES[mana];
            if (colorKey && manaAmount > 0) {
              totalAvailable[colorKey] = (totalAvailable[colorKey] || 0) + manaAmount;
            }
          }
        }
      }
      
      // Log floating mana if any
      const floatingMana = Object.entries(existingPool).filter(([_, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ');
      if (floatingMana) {
        debug(2, `[castSpellFromHand] Floating mana available in pool: ${floatingMana}`);
      }
      
      // Calculate total required cost
      const coloredCostTotal = Object.values(totalColored).reduce((a: number, b: number) => a + b, 0);
      const totalCost = coloredCostTotal + totalGeneric;
      
      // Validate if total available mana can pay the cost
      if (totalCost > 0) {
        const validationError = validateManaPayment(totalAvailable, totalColored, totalGeneric);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Insufficient mana to cast this spell. ${validationError}`,
          });
          return;
        }
      }

      // ======================================================================
      // CONVOKE: Tap creatures to help pay for spell
      // ======================================================================
      if (!isForceAltCostPaid && convokeTappedCreatures && convokeTappedCreatures.length > 0) {
        debug(2, `[castSpellFromHand] Processing convoke: tapping ${convokeTappedCreatures.length} creature(s)`);
        
        const globalBattlefield = game.state?.battlefield || [];
        
        for (const creatureId of convokeTappedCreatures) {
          const creature = globalBattlefield.find((p: any) => p?.id === creatureId && p?.controller === playerId);
          
          if (!creature) {
            socket.emit("error", {
              code: "CONVOKE_CREATURE_NOT_FOUND",
              message: `Creature ${creatureId} not found on battlefield`,
            });
            return;
          }
          
          if ((creature as any).tapped) {
            socket.emit("error", {
              code: "CONVOKE_CREATURE_TAPPED",
              message: `${(creature as any).card?.name || 'Creature'} is already tapped`,
            });
            return;
          }
          
          const creatureCard = (creature as any).card || {};
          const creatureTypeLine = (creatureCard.type_line || "").toLowerCase();
          
          if (!creatureTypeLine.includes("creature")) {
            socket.emit("error", {
              code: "CONVOKE_NOT_CREATURE",
              message: `${creatureCard.name || 'Permanent'} is not a creature`,
            });
            return;
          }
          
          // Check summoning sickness
          const hasHaste = creatureHasHaste(creature, globalBattlefield, playerId);
          const enteredThisTurn = (creature as any).enteredThisTurn === true;
          
          if (!hasHaste && enteredThisTurn) {
            socket.emit("error", {
              code: "CONVOKE_SUMMONING_SICKNESS",
              message: `${creatureCard.name || 'Creature'} has summoning sickness`,
            });
            return;
          }
          
          // Tap the creature
          (creature as any).tapped = true;
          
          // Add mana to pool based on creature's colors
          // Each creature pays for {1} or one mana of its color
          const creatureColors = creatureCard.colors || [];
          
          // Initialize mana pool if needed
          if (!game.state.manaPool) game.state.manaPool = {};
          if (!game.state.manaPool[playerId]) {
            game.state.manaPool[playerId] = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
          }
          
          // Use creature's first color if it has one, otherwise colorless
          // This is a simple heuristic - in a full implementation, players would choose
          let manaAdded = 'colorless';
          if (creatureColors.length > 0) {
            const colorMap: Record<string, 'white' | 'blue' | 'black' | 'red' | 'green'> = {
              'W': 'white',
              'U': 'blue', 
              'B': 'black',
              'R': 'red',
              'G': 'green',
            };
            const firstColor = creatureColors[0];
            if (firstColor in colorMap) {
              const manaColor = colorMap[firstColor];
              game.state.manaPool[playerId][manaColor] += 1;
              manaAdded = manaColor;
            } else {
              game.state.manaPool[playerId].colorless += 1;
            }
          } else {
            game.state.manaPool[playerId].colorless += 1;
          }
          
          debug(1, `[castSpellFromHand] Convoke: tapped ${creatureCard.name} (colors: ${creatureColors.join(',') || 'none'}), added {1} ${manaAdded}`);
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} tapped ${convokeTappedCreatures.length} creature(s) for convoke`,
          ts: Date.now(),
        });
      }

      // ======================================================================
      // Handle mana payment: tap permanents to generate mana (adds to pool)
      // ======================================================================
      const poolBeforePayment = { ...getOrInitManaPool(game.state, playerId) } as any;
      const producedNonSnowByColor: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      const producedSnowByColor: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      const producedTreasureByColor: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      const producedNonTreasureByColor: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };

      if (!isForceAltCostPaid && payment && payment.length > 0) {
        debug(2, `[castSpellFromHand] Processing payment for ${cardInHand.name}:`, payment);
        
        // Get global battlefield (not zones.battlefield which may not exist)
        const globalBattlefield = game.state?.battlefield || [];
        
        // Process each payment item: tap the permanent and add mana to pool
        for (const { permanentId, mana, count } of payment) {
          const permanent = globalBattlefield.find((p: any) => p?.id === permanentId && p?.controller === playerId);
          
          if (!permanent) {
            socket.emit("error", {
              code: "PAYMENT_SOURCE_NOT_FOUND",
              message: `Permanent ${permanentId} not found on battlefield`,
            });
            return;
          }
          
          if ((permanent as any).tapped) {
            socket.emit("error", {
              code: "PAYMENT_SOURCE_TAPPED",
              message: `${(permanent as any).card?.name || 'Permanent'} is already tapped`,
            });
            return;
          }
          
          // Rule 302.6 / 702.10: Check summoning sickness for creatures with tap abilities
          // A creature can't use tap/untap abilities unless it has been continuously controlled
          // since the turn began OR it has haste (from any source)
          const permCard = (permanent as any).card || {};
          const permTypeLine = (permCard.type_line || "").toLowerCase();
          const permIsCreature = /\bcreature\b/.test(permTypeLine);
          
          // Check if creature has haste from any source (own text, granted abilities, or battlefield effects)
          const hasHaste = creatureHasHaste(permanent, globalBattlefield, playerId);
          
          // summoningSickness is set when creatures enter the battlefield
          // If a creature has summoning sickness and doesn't have haste, it can't use tap abilities
          if (permIsCreature && (permanent as any).summoningSickness && !hasHaste) {
            socket.emit("error", {
              code: "SUMMONING_SICKNESS",
              message: `${permCard.name || 'Creature'} has summoning sickness and cannot use tap abilities this turn`,
            });
            return;
          }
          
          // Tap the permanent
          (permanent as any).tapped = true;

          const typeLineLower = String(((permanent as any).card || {})?.type_line || '').toLowerCase();
          const isSnowSource = /\bsnow\b/.test(typeLineLower);
          const isTreasureSource = /\btreasure\b/.test(typeLineLower);
          
          // Add mana to player's mana pool (already initialized via getOrInitManaPool above)
          const manaColorMap: Record<string, string> = {
            'W': 'white',
            'U': 'blue',
            'B': 'black',
            'R': 'red',
            'G': 'green',
            'C': 'colorless',
          };
          
          // Calculate actual mana production considering:
          // - Fixed multi-mana (Sol Ring: {C}{C})
          // - Dynamic mana (Gaea's Cradle, Wirewood Channeler)
          // - Land enchantments (Wild Growth, Overgrowth)
          // - Global effects (Caged Sun, Mana Reflection, Mirari's Wake)
          let manaAmount: number;
          
          if (count !== undefined && count !== null) {
            // Client provided explicit count - use it
            manaAmount = count;
          } else {
            // Calculate dynamically based on game state
            const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana);
            manaAmount = manaInfo.totalAmount;
            
            // If there are bonus mana of different colors, add those too
            for (const bonus of manaInfo.bonusMana) {
              if (bonus.color !== mana && bonus.amount > 0) {
                const bonusPoolKey = manaColorMap[bonus.color];
                if (bonusPoolKey) {
                  (game.state.manaPool[playerId] as any)[bonusPoolKey] += bonus.amount;
                  // Snow-vs-non-snow tracking: treat bonus mana as produced by this source.
                  if (isSnowSource) {
                    producedSnowByColor[bonusPoolKey] = (producedSnowByColor[bonusPoolKey] || 0) + bonus.amount;
                  } else {
                    producedNonSnowByColor[bonusPoolKey] = (producedNonSnowByColor[bonusPoolKey] || 0) + bonus.amount;
                  }
                  // Treasure-vs-non-treasure tracking (for replay-stable "mana from a Treasure" checks).
                  if (isTreasureSource) {
                    producedTreasureByColor[bonusPoolKey] = (producedTreasureByColor[bonusPoolKey] || 0) + bonus.amount;
                  } else {
                    producedNonTreasureByColor[bonusPoolKey] = (producedNonTreasureByColor[bonusPoolKey] || 0) + bonus.amount;
                  }
                  debug(2, `[castSpellFromHand] Added ${bonus.amount} ${bonus.color} bonus mana from enchantments/effects`);
                }
              }
            }
          }
          
          const poolKey = manaColorMap[mana];
          if (poolKey && manaAmount > 0) {
            (game.state.manaPool[playerId] as any)[poolKey] += manaAmount;
            if (isSnowSource) {
              producedSnowByColor[poolKey] = (producedSnowByColor[poolKey] || 0) + manaAmount;
            } else {
              producedNonSnowByColor[poolKey] = (producedNonSnowByColor[poolKey] || 0) + manaAmount;
            }
            if (isTreasureSource) {
              producedTreasureByColor[poolKey] = (producedTreasureByColor[poolKey] || 0) + manaAmount;
            } else {
              producedNonTreasureByColor[poolKey] = (producedNonTreasureByColor[poolKey] || 0) + manaAmount;
            }
            debug(2, `[castSpellFromHand] Added ${manaAmount} ${mana} mana to ${playerId}'s pool from ${(permanent as any).card?.name || permanentId}`);
          }
        }
      }
      
      // Consume mana from pool to pay for the spell
      // This uses both floating mana and newly tapped mana, leaving unspent mana for subsequent spells
      const pool = getOrInitManaPool(game.state, playerId);
      const manaConsumption = isForceAltCostPaid
        ? { consumed: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } }
        : consumeManaFromPool(pool, totalColored, totalGeneric, '[castSpellFromHand]');

      const manaSpentTotal = Object.values(manaConsumption.consumed).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
      
      // Calculate converge value (number of different mana colors spent)
      // This is used by cards like Bring to Light, Radiant Flames, etc.
      const convergeValue = Object.entries(manaConsumption.consumed)
        .filter(([color, amount]) => color !== 'colorless' && amount > 0)
        .length;
      
      if (convergeValue > 0) {
        debug(2, `[castSpellFromHand] Converge: ${convergeValue} different color(s) spent for ${cardInHand.name}`);
      }

      // Intervening-if support: "if mana from a Treasure was spent to cast it".
      // Be conservative: only record positive evidence when we can directly see a Treasure used as a payment source.
      // (Do NOT set false, because floating mana in the pool may have been produced by a Treasure earlier.)
      let manaFromTreasureSpent: true | undefined;
      let manaFromTreasureSpentKnown: boolean | undefined;
      try {
        if (Array.isArray(payment) && payment.length > 0) {
          const battlefield = (game.state.battlefield || []) as any[];
          for (const pay of payment) {
            const perm = battlefield.find((p: any) => p?.id === pay?.permanentId && p?.controller === playerId);
            const typeLine = String(perm?.card?.type_line || '').toLowerCase();
            if (/\btreasure\b/.test(typeLine)) {
              manaFromTreasureSpent = true;
              break;
            }
          }
        }
      } catch {
        // best-effort only
      }

      // Derive replay-stable known/boolean for Treasure spend when possible.
      // - Deterministic true: treasure mana was required based on consumption and non-treasure availability.
      // - Deterministic false: all spent mana came from non-treasure production this cast, with no pre-existing pool used.
      try {
        const consumed = (manaConsumption as any)?.consumed;
        if (consumed && typeof consumed === 'object') {
          const keys: Array<'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'> = ['white', 'blue', 'black', 'red', 'green', 'colorless'];

          if (manaSpentTotal === 0) {
            manaFromTreasureSpentKnown = true;
          } else {
            let forcedTrue = false;
            let sawInconsistent = false;

            for (const k of keys) {
              const used = Number((consumed as any)[k] || 0);
              if (used <= 0) continue;

              const pre = Number((poolBeforePayment as any)?.[k] || 0);
              const nonTreasureNew = Number((producedNonTreasureByColor as any)?.[k] || 0);
              const treasureNew = Number((producedTreasureByColor as any)?.[k] || 0);
              const requiredTreasure = Math.max(0, used - pre - nonTreasureNew);
              if (requiredTreasure > 0) {
                if (treasureNew > 0) {
                  forcedTrue = true;
                  break;
                }
                sawInconsistent = true;
              }
            }

            if (forcedTrue) {
              manaFromTreasureSpentKnown = true;
              manaFromTreasureSpent = true;
            } else if (!sawInconsistent) {
              let sawSpend = false;
              let canProveNoTreasure = true;
              for (const k of keys) {
                const used = Number((consumed as any)[k] || 0);
                if (used <= 0) continue;
                sawSpend = true;

                const pre = Number((poolBeforePayment as any)?.[k] || 0);
                if (pre > 0) {
                  canProveNoTreasure = false;
                  break;
                }
                const treasureNew = Number((producedTreasureByColor as any)?.[k] || 0);
                if (treasureNew > 0) {
                  canProveNoTreasure = false;
                  break;
                }
                const nonTreasureNew = Number((producedNonTreasureByColor as any)?.[k] || 0);
                if (nonTreasureNew < used) {
                  canProveNoTreasure = false;
                  break;
                }
              }

              if (!sawSpend) {
                manaFromTreasureSpentKnown = true;
              } else if (canProveNoTreasure) {
                manaFromTreasureSpentKnown = true;
              }
            }
          }
        }
      } catch {
        // best-effort only
      }

      // Intervening-if support: snow mana spent.
      // We can only safely assert snow mana was spent when it was *forced* based on:
      // - deterministic consumption amounts, and
      // - non-snow mana availability (existing pool + non-snow produced this cast).
      // This yields a replay-stable lower bound that never creates false negatives.
      let snowManaSpentByColor: Record<string, number> | undefined;
      let snowManaColorsSpent: string[] | undefined;
      let snowManaSpentKnown: boolean | undefined;
      let snowManaSpent: boolean | undefined;
      let snowManaOfSpellColorsSpentKnown: boolean | undefined;
      let snowManaOfSpellColorsSpent: boolean | undefined;
      try {
        const consumed = (manaConsumption as any)?.consumed;
        if (consumed && typeof consumed === 'object') {
          const byColor: Record<string, number> = {};
          const colorCodes = new Set<string>();
          const keys: Array<'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'> = ['white', 'blue', 'black', 'red', 'green', 'colorless'];

          for (const k of keys) {
            const used = Number((consumed as any)[k] || 0);
            if (used <= 0) continue;
            const pre = Number((poolBeforePayment as any)?.[k] || 0);
            const nonSnowNew = Number((producedNonSnowByColor as any)?.[k] || 0);
            const requiredSnow = Math.max(0, used - pre - nonSnowNew);
            if (requiredSnow > 0) {
              byColor[k] = requiredSnow;
              if (k === 'white') colorCodes.add('W');
              else if (k === 'blue') colorCodes.add('U');
              else if (k === 'black') colorCodes.add('B');
              else if (k === 'red') colorCodes.add('R');
              else if (k === 'green') colorCodes.add('G');
            }
          }

          if (Object.keys(byColor).length > 0) {
            snowManaSpentByColor = byColor;
            snowManaColorsSpent = Array.from(colorCodes);
          }

          // Derive deterministic outcome for generic: "if {S} was spent to cast it" / "if snow mana was spent...".
          // We only set a boolean when we can prove it replay-stably.
          // - If our lower-bound computation proves snow was required, that's deterministically true.
          // - If no mana was spent, that's deterministically false.
          // - Otherwise, we can sometimes prove false when all spent mana was newly produced, non-snow, and
          //   there was no pre-existing floating mana for those colors.
          const lowerBoundTotal = Object.values(byColor).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
          if (lowerBoundTotal > 0) {
            snowManaSpentKnown = true;
            snowManaSpent = true;
          } else if (manaSpentTotal === 0) {
            snowManaSpentKnown = true;
            snowManaSpent = false;
          } else {
            let sawSpend = false;
            let canProveNoSnow = true;
            for (const k of keys) {
              const used = Number((consumed as any)[k] || 0);
              if (used <= 0) continue;
              sawSpend = true;

              const pre = Number((poolBeforePayment as any)?.[k] || 0);
              if (pre > 0) {
                canProveNoSnow = false;
                break;
              }

              const snowNew = Number((producedSnowByColor as any)?.[k] || 0);
              const nonSnowNew = Number((producedNonSnowByColor as any)?.[k] || 0);

              // If any snow mana was produced for a spent color, we can't deterministically prove it wasn't used.
              if (snowNew > 0) {
                canProveNoSnow = false;
                break;
              }

              // All spent mana for this key must be accounted for by non-snow produced during this cast.
              if (nonSnowNew < used) {
                canProveNoSnow = false;
                break;
              }
            }

            if (!sawSpend) {
              snowManaSpentKnown = true;
              snowManaSpent = false;
            } else if (canProveNoSnow) {
              snowManaSpentKnown = true;
              snowManaSpent = false;
            }
          }

          // Derive deterministic outcome for: "if {S} of any of that spell's colors was spent to cast it".
          // This can only be decided when snow provenance is replay-stable:
          // - the spent mana for each spell color did not come from pre-existing floating mana, and
          // - that color's newly-produced mana isn't a mix of snow and non-snow.
          const card = cardInHand as any;
          const rawColors: any[] = Array.isArray(card?.colors)
            ? card.colors
            : Array.isArray(card?.color_identity)
              ? card.color_identity
              : Array.isArray(card?.colorIdentity)
                ? card.colorIdentity
                : [];
          const spellColorCodes = new Set(
            rawColors.map((c: any) => String(c || '').toUpperCase()).filter((c: any) => ['W', 'U', 'B', 'R', 'G'].includes(c))
          );

          // Colorless spells are deterministically false for this clause.
          if (spellColorCodes.size === 0) {
            snowManaOfSpellColorsSpentKnown = true;
            snowManaOfSpellColorsSpent = false;
          } else {
            const codeToKey: Record<string, 'white' | 'blue' | 'black' | 'red' | 'green'> = {
              W: 'white',
              U: 'blue',
              B: 'black',
              R: 'red',
              G: 'green',
            };

            // If our lower-bound computation proves snow was required for any spell color, the clause is true.
            let forcedTrue = false;
            if (snowManaSpentByColor) {
              for (const code of Array.from(spellColorCodes)) {
                const k = codeToKey[code];
                const n = Number((snowManaSpentByColor as any)[k] || 0);
                if (n > 0) {
                  forcedTrue = true;
                  break;
                }
              }
            }
            if (forcedTrue) {
              snowManaOfSpellColorsSpentKnown = true;
              snowManaOfSpellColorsSpent = true;
            } else {
              let unknown = false;
              let anySnowForSpellColor = false;

              for (const code of Array.from(spellColorCodes)) {
                const k = codeToKey[code];
                const used = Number((consumed as any)[k] || 0);
                if (used <= 0) continue;

                const pre = Number((poolBeforePayment as any)?.[k] || 0);
                if (pre > 0) {
                  unknown = true;
                  continue;
                }

                const snowNew = Number((producedSnowByColor as any)?.[k] || 0);
                const nonSnowNew = Number((producedNonSnowByColor as any)?.[k] || 0);

                if (snowNew > 0 && nonSnowNew > 0) {
                  unknown = true;
                  continue;
                }
                if (snowNew > 0 && nonSnowNew <= 0) {
                  anySnowForSpellColor = true;
                  continue;
                }
                if (snowNew <= 0 && nonSnowNew > 0) {
                  // deterministically non-snow for this spell color
                  continue;
                }

                // Spent mana without any accounted production for this color.
                unknown = true;
              }

              if (!unknown) {
                snowManaOfSpellColorsSpentKnown = true;
                snowManaOfSpellColorsSpent = anySnowForSpellColor;
              }
            }
          }
        }
      } catch {
        // best-effort only
      }
      
      // Bump sequence to ensure state changes are visible
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      // Get RulesBridge for validation (optional - if not available, proceed with legacy logic)
      const bridge = (GameManager as any).getRulesBridge?.(gameId);
      if (bridge) {
        try {
          // Validate through rules engine
          const validation = bridge.validateAction({
            type: 'castSpell',
            playerId,
            cardId,
            cardName: cardInHand.name,
            manaCost: cardInHand.mana_cost,
            cardTypes: (cardInHand.type_line || '').split('ΓÇö').map((s: string) => s.trim()),
            targets: targets || [],
          });
          
          if (!validation.legal) {
            socket.emit("error", {
              code: "INVALID_ACTION",
              message: validation.reason || "Cannot cast spell",
            });
            return;
          }
          
          // Execute through rules engine (this will emit events)
          const result = bridge.executeAction({
            type: 'castSpell',
            playerId,
            cardId,
            cardName: cardInHand.name,
            manaCost: cardInHand.mana_cost,
            cardTypes: (cardInHand.type_line || '').split('ΓÇö').map((s: string) => s.trim()),
            targets: targets || [],
          });
          
          if (!result.success) {
            socket.emit("error", {
              code: "EXECUTION_ERROR",
              message: result.error || "Failed to cast spell",
            });
            return;
          }
          
          // RulesBridge validation passed - log it but still apply to real game state below
          // The RulesBridge only validates and updates its internal state copy, NOT the actual game.state
          // We MUST call applyEvent to update the real game state (remove from hand, add to stack)
          debug(2, `[castSpellFromHand] Player ${playerId} cast ${cardInHand.name} (${cardId}) - RulesBridge validated`);
        } catch (bridgeErr) {
          debugWarn(1, 'Rules engine validation failed, falling back to legacy:', bridgeErr);
          // Continue with legacy logic below
        }
      }
      
      // Always use applyEvent to properly route through state management system
      // This ensures ctx.state.zones is updated (which viewFor uses)
      // The RulesBridge above only validates - it does NOT modify the actual game state
      try {
          // Check stack length before attempting to cast
          const stackLengthBefore = game.state.stack?.length || 0;
          
          if (typeof game.applyEvent === 'function') {
            const castEv: any = {
              type: "castSpell",
              playerId,
              cardId,
              targets: targets || [],
              xValue,
              alternateCostId,
              // Provenance / replay-stable metadata for intervening-if templates.
              fromZone: 'hand',
              castFromHand: true,
              manaSpentTotal,
              manaSpentBreakdown: { ...manaConsumption.consumed },
              ...(manaFromTreasureSpentKnown === true
                ? {
                    manaFromTreasureSpentKnown: true,
                    manaFromTreasureSpent: manaFromTreasureSpent === true,
                  }
                : {}),
              ...(bargainResolved === true && typeof wasBargained === 'boolean'
                ? {
                    bargainResolved: true,
                    wasBargained,
                  }
                : {}),
              ...(snowManaSpentByColor
                ? {
                    snowManaSpentByColor: { ...snowManaSpentByColor },
                    ...(snowManaColorsSpent && snowManaColorsSpent.length > 0 ? { snowManaColorsSpent: snowManaColorsSpent.slice() } : {}),
                  }
                : {}),
              ...(snowManaSpentKnown === true && typeof snowManaSpent === 'boolean'
                ? {
                    snowManaSpentKnown: true,
                    snowManaSpent,
                  }
                : {}),
              ...(snowManaOfSpellColorsSpentKnown === true && typeof snowManaOfSpellColorsSpent === 'boolean'
                ? {
                    snowManaOfSpellColorsSpentKnown: true,
                    snowManaOfSpellColorsSpent,
                  }
                : {}),
              ...(convergeValue > 0
                ? {
                    convergeValue,
                    manaColorsSpent: Object.entries(manaConsumption.consumed)
                      .filter(([color, amount]) => color !== 'colorless' && amount > 0)
                      .map(([color]) => color),
                  }
                : {}),
              ...(Array.isArray(convokeTappedCreatures) && convokeTappedCreatures.length > 0
                ? {
                    convokeTappedCreatures: convokeTappedCreatures.slice(),
                    manaFromCreaturesSpent: convokeTappedCreatures.length,
                  }
                : {}),
              ...(additionalCost && typeof additionalCostPaid === 'boolean'
                ? {
                    additionalCostPaidKnown: true,
                    additionalCostPaid: additionalCostPaid === true,
                    ...(additionalCostPaid === true
                      ? {
                          additionalCostWasPaid: true,
                          paidAdditionalCost: true,
                        }
                      : {}),
                  }
                : additionalCostPaid === true
                  ? {
                      additionalCostWasPaid: true,
                      paidAdditionalCost: true,
                      additionalCostPaid: true,
                    }
                  : {}),
              ...(evidenceCollected === true
                ? {
                    evidenceCollected: true,
                    evidenceWasCollected: true,
                    collectedEvidence: true,
                  }
                : {}),
            };
            if (manaFromTreasureSpent === true) {
              // Preserve positive-only evidence when we don't have a replay-stable known/boolean.
              if (manaFromTreasureSpentKnown !== true) {
                castEv.manaFromTreasureSpent = true;
              }
            }
            game.applyEvent(castEv);
            
            // Verify the spell was actually added to the stack
            const stackLengthAfter = game.state.stack?.length || 0;
            if (stackLengthAfter <= stackLengthBefore) {
              // The spell wasn't added to the stack - something went wrong
              debugError(1, `[castSpellFromHand] applyEvent did not add spell to stack. Stack: ${stackLengthBefore} -> ${stackLengthAfter}`);
              socket.emit("error", {
                code: "CAST_FAILED",
                message: `Failed to cast ${cardInHand.name}. The card may have been removed or an internal error occurred.`,
              });
              return;
            }
            
            // Add converge value to the stack item (the top item is the one just added)
            if (convergeValue > 0 && game.state.stack && game.state.stack.length > 0) {
              const topStackItem = game.state.stack[game.state.stack.length - 1];
              (topStackItem as any).convergeValue = convergeValue;
              (topStackItem as any).manaColorsSpent = Object.entries(manaConsumption.consumed)
                .filter(([color, amount]) => color !== 'colorless' && amount > 0)
                .map(([color]) => color);
              (topStackItem as any).manaSpentTotal = manaSpentTotal;
              (topStackItem as any).manaSpentBreakdown = { ...manaConsumption.consumed };

              // Plumb chosen alternate-cost id onto the stack item so intervening-if clauses can evaluate.
              if (alternateCostId) {
                (topStackItem as any).alternateCostId = alternateCostId;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.alternateCostId = alternateCostId;
                }
              }

              // Convoke contribution (each tapped creature contributes {1}).
              if (Array.isArray(convokeTappedCreatures) && convokeTappedCreatures.length > 0) {
                (topStackItem as any).convokeTappedCreatures = convokeTappedCreatures.slice();
                (topStackItem as any).manaFromCreaturesSpent = convokeTappedCreatures.length;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.convokeTappedCreatures = convokeTappedCreatures.slice();
                  (topStackItem as any).card.manaFromCreaturesSpent = convokeTappedCreatures.length;
                }
              }

              // Best-effort boolean flags for common alternate cost templates.
              const altLower = alternateCostId ? String(alternateCostId).toLowerCase() : '';
              if (altLower) {
                (topStackItem as any).prowlCostWasPaid = altLower === 'prowl';
                (topStackItem as any).surgeCostWasPaid = altLower === 'surge';
                (topStackItem as any).madnessCostWasPaid = altLower === 'madness';
                (topStackItem as any).spectacleCostWasPaid = altLower === 'spectacle';
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.prowlCostWasPaid = (topStackItem as any).prowlCostWasPaid;
                  (topStackItem as any).card.surgeCostWasPaid = (topStackItem as any).surgeCostWasPaid;
                  (topStackItem as any).card.madnessCostWasPaid = (topStackItem as any).madnessCostWasPaid;
                  (topStackItem as any).card.spectacleCostWasPaid = (topStackItem as any).spectacleCostWasPaid;
                }
              }

              // Intervening-if support: "if mana from a Treasure was spent to cast it".
              if (manaFromTreasureSpentKnown === true) {
                (topStackItem as any).manaFromTreasureSpentKnown = true;
                (topStackItem as any).manaFromTreasureSpent = manaFromTreasureSpent === true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.manaFromTreasureSpentKnown = true;
                  (topStackItem as any).card.manaFromTreasureSpent = manaFromTreasureSpent === true;
                }
              } else if (manaFromTreasureSpent === true) {
                (topStackItem as any).manaFromTreasureSpent = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.manaFromTreasureSpent = true;
                }
              }

              // Intervening-if support: snow mana spent (positive-only lower bound).
              if (snowManaSpentByColor) {
                (topStackItem as any).snowManaSpentByColor = { ...snowManaSpentByColor };
                if (snowManaColorsSpent && snowManaColorsSpent.length > 0) {
                  (topStackItem as any).snowManaColorsSpent = snowManaColorsSpent.slice();
                }
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.snowManaSpentByColor = { ...snowManaSpentByColor };
                  if (snowManaColorsSpent && snowManaColorsSpent.length > 0) {
                    (topStackItem as any).card.snowManaColorsSpent = snowManaColorsSpent.slice();
                  }
                }
              }

              // Intervening-if support: deterministic outcome for "if {S} was spent ..." when known.
              if (snowManaSpentKnown === true && typeof snowManaSpent === 'boolean') {
                (topStackItem as any).snowManaSpentKnown = true;
                (topStackItem as any).snowManaSpent = snowManaSpent;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.snowManaSpentKnown = true;
                  (topStackItem as any).card.snowManaSpent = snowManaSpent;
                }
              }

              // Intervening-if support: deterministic outcome for "{S} of any of that spell's colors" when known.
              if (snowManaOfSpellColorsSpentKnown === true && typeof snowManaOfSpellColorsSpent === 'boolean') {
                (topStackItem as any).snowManaOfSpellColorsSpentKnown = true;
                (topStackItem as any).snowManaOfSpellColorsSpent = snowManaOfSpellColorsSpent;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.snowManaOfSpellColorsSpentKnown = true;
                  (topStackItem as any).card.snowManaOfSpellColorsSpent = snowManaOfSpellColorsSpent;
                }
              }

              // Intervening-if support: "if its additional cost was paid".
              // Deterministic when we know the spell had an additional cost.
              if (additionalCost && typeof additionalCostPaid === 'boolean') {
                (topStackItem as any).additionalCostPaidKnown = true;
                (topStackItem as any).additionalCostPaid = additionalCostPaid === true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.additionalCostPaidKnown = true;
                  (topStackItem as any).card.additionalCostPaid = additionalCostPaid === true;
                }
                if (additionalCostPaid === true) {
                  (topStackItem as any).additionalCostWasPaid = true;
                  (topStackItem as any).paidAdditionalCost = true;
                  if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                    (topStackItem as any).card.additionalCostWasPaid = true;
                    (topStackItem as any).card.paidAdditionalCost = true;
                  }
                }
              } else if (additionalCostPaid === true) {
                // Legacy positive-only evidence.
                (topStackItem as any).additionalCostWasPaid = true;
                (topStackItem as any).paidAdditionalCost = true;
                (topStackItem as any).additionalCostPaid = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.additionalCostWasPaid = true;
                  (topStackItem as any).card.paidAdditionalCost = true;
                  (topStackItem as any).card.additionalCostPaid = true;
                }
              }

              // Intervening-if support: "if it was bargained".
              if (bargainResolved === true && typeof wasBargained === 'boolean') {
                (topStackItem as any).bargainResolved = true;
                (topStackItem as any).wasBargained = wasBargained;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.bargainResolved = true;
                  (topStackItem as any).card.wasBargained = wasBargained;
                }
              }

              // Intervening-if support: "if evidence was collected" (Collect evidence additional cost).
              // Be conservative: only set `true` on positive evidence.
              if (evidenceCollected === true) {
                (topStackItem as any).evidenceCollected = true;
                (topStackItem as any).evidenceWasCollected = true;
                (topStackItem as any).collectedEvidence = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.evidenceCollected = true;
                  (topStackItem as any).card.evidenceWasCollected = true;
                  (topStackItem as any).card.collectedEvidence = true;
                }
              }
              debug(1, `[castSpellFromHand] Added converge data to stack item: ${convergeValue} colors (${(topStackItem as any).manaColorsSpent.join(', ')})`);
            } else if (game.state.stack && game.state.stack.length > 0) {
              // Still attach total-mana info for other intervening-if templates.
              const topStackItem = game.state.stack[game.state.stack.length - 1];
              (topStackItem as any).manaSpentTotal = manaSpentTotal;
              (topStackItem as any).manaSpentBreakdown = { ...manaConsumption.consumed };

              // Plumb chosen alternate-cost id onto the stack item so intervening-if clauses can evaluate.
              if (alternateCostId) {
                (topStackItem as any).alternateCostId = alternateCostId;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.alternateCostId = alternateCostId;
                }
              }

              // Convoke contribution (each tapped creature contributes {1}).
              if (Array.isArray(convokeTappedCreatures) && convokeTappedCreatures.length > 0) {
                (topStackItem as any).convokeTappedCreatures = convokeTappedCreatures.slice();
                (topStackItem as any).manaFromCreaturesSpent = convokeTappedCreatures.length;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.convokeTappedCreatures = convokeTappedCreatures.slice();
                  (topStackItem as any).card.manaFromCreaturesSpent = convokeTappedCreatures.length;
                }
              }

              // Best-effort boolean flags for common alternate cost templates.
              const altLower = alternateCostId ? String(alternateCostId).toLowerCase() : '';
              if (altLower) {
                (topStackItem as any).prowlCostWasPaid = altLower === 'prowl';
                (topStackItem as any).surgeCostWasPaid = altLower === 'surge';
                (topStackItem as any).madnessCostWasPaid = altLower === 'madness';
                (topStackItem as any).spectacleCostWasPaid = altLower === 'spectacle';
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.prowlCostWasPaid = (topStackItem as any).prowlCostWasPaid;
                  (topStackItem as any).card.surgeCostWasPaid = (topStackItem as any).surgeCostWasPaid;
                  (topStackItem as any).card.madnessCostWasPaid = (topStackItem as any).madnessCostWasPaid;
                  (topStackItem as any).card.spectacleCostWasPaid = (topStackItem as any).spectacleCostWasPaid;
                }
              }

              // Intervening-if support: "if mana from a Treasure was spent to cast it".
              if (manaFromTreasureSpent === true) {
                (topStackItem as any).manaFromTreasureSpent = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.manaFromTreasureSpent = true;
                }
              }

              // Intervening-if support: "if its additional cost was paid".
              // Deterministic when we know the spell had an additional cost.
              if (additionalCost && typeof additionalCostPaid === 'boolean') {
                (topStackItem as any).additionalCostPaidKnown = true;
                (topStackItem as any).additionalCostPaid = additionalCostPaid === true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.additionalCostPaidKnown = true;
                  (topStackItem as any).card.additionalCostPaid = additionalCostPaid === true;
                }
                if (additionalCostPaid === true) {
                  (topStackItem as any).additionalCostWasPaid = true;
                  (topStackItem as any).paidAdditionalCost = true;
                  if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                    (topStackItem as any).card.additionalCostWasPaid = true;
                    (topStackItem as any).card.paidAdditionalCost = true;
                  }
                }
              } else if (additionalCostPaid === true) {
                // Legacy positive-only evidence.
                (topStackItem as any).additionalCostWasPaid = true;
                (topStackItem as any).paidAdditionalCost = true;
                (topStackItem as any).additionalCostPaid = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.additionalCostWasPaid = true;
                  (topStackItem as any).card.paidAdditionalCost = true;
                  (topStackItem as any).card.additionalCostPaid = true;
                }
              }

              // Intervening-if support: "if it was bargained".
              if (bargainResolved === true && typeof wasBargained === 'boolean') {
                (topStackItem as any).bargainResolved = true;
                (topStackItem as any).wasBargained = wasBargained;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.bargainResolved = true;
                  (topStackItem as any).card.wasBargained = wasBargained;
                }
              }

              // Intervening-if support: "if evidence was collected" (Collect evidence additional cost).
              // Be conservative: only set `true` on positive evidence.
              if (evidenceCollected === true) {
                (topStackItem as any).evidenceCollected = true;
                (topStackItem as any).evidenceWasCollected = true;
                (topStackItem as any).collectedEvidence = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.evidenceCollected = true;
                  (topStackItem as any).card.evidenceWasCollected = true;
                  (topStackItem as any).card.collectedEvidence = true;
                }
              }
            }

            // Track per-turn "cast from hand" (best-effort)
            game.state.spellsCastFromHandThisTurn = game.state.spellsCastFromHandThisTurn || {};
            game.state.spellsCastFromHandThisTurn[playerId] = (game.state.spellsCastFromHandThisTurn[playerId] || 0) + 1;
            
            debug(2, `[castSpellFromHand] Player ${playerId} cast ${cardInHand.name} (${cardId}) via applyEvent`);
          } else {
          // Fallback for legacy game instances without applyEvent
          // Remove from hand
          const handCards = zones.hand as any[];
          const idx = handCards.findIndex((c: any) => c && c.id === cardId);
          if (idx !== -1) {
            const [removedCard] = handCards.splice(idx, 1);
            zones.handCount = handCards.length;
            
            // Build target details for display
            const targetDetails: Array<{ id: string; type: 'permanent' | 'player'; name?: string; controllerId?: string; controllerName?: string }> = [];
            if (targets && targets.length > 0) {
              for (const target of targets) {
                const targetId = typeof target === 'string' ? target : target.id;
                const targetKind = typeof target === 'object' ? target.kind : undefined;
                
                if (targetKind === 'player') {
                  // Find player name
                  const player = (game.state.players || []).find((p: any) => p.id === targetId);
                  targetDetails.push({
                    id: targetId,
                    type: 'player',
                    name: player?.name || targetId,
                  });
                } else {
                  // Find permanent name and controller
                  const perm = (game.state.battlefield || []).find((p: any) => p.id === targetId);
                  // Try to get name from multiple sources (card.name, card_faces[0].name for DFCs)
                  let permName = perm?.card?.name;
                  if (!permName && (perm?.card as any)?.card_faces?.[0]?.name) {
                    permName = (perm.card as any).card_faces[0].name;
                  }
                  // Don't use ID as fallback name - leave it undefined so client can try to look up
                  const controllerId = perm?.controller;
                  const controllerPlayer = controllerId ? (game.state.players || []).find((p: any) => p.id === controllerId) : undefined;
                  targetDetails.push({
                    id: targetId,
                    type: 'permanent',
                    name: permName,
                    controllerId: controllerId,
                    controllerName: controllerPlayer?.name,
                  });
                }
              }
            }
            
            // Add to stack
            const stackItem = {
              id: `stack_${Date.now()}_${cardId}`,
              controller: playerId,
              card: { ...removedCard, zone: "stack", ...(manaFromTreasureSpent === true ? { manaFromTreasureSpent: true } : {}) },
              targets: targets || [],
              targetDetails: targetDetails.length > 0 ? targetDetails : undefined,
              xValue,
              ...(manaFromTreasureSpent === true ? { manaFromTreasureSpent: true } : {}),
              ...(additionalCost && typeof additionalCostPaid === 'boolean'
                ? {
                    additionalCostPaidKnown: true,
                    additionalCostPaid: additionalCostPaid === true,
                    ...(additionalCostPaid === true
                      ? {
                          additionalCostWasPaid: true,
                          paidAdditionalCost: true,
                        }
                      : {}),
                  }
                : additionalCostPaid === true
                  ? {
                      additionalCostWasPaid: true,
                      paidAdditionalCost: true,
                      additionalCostPaid: true,
                    }
                  : {}),
              ...(evidenceCollected === true
                ? {
                    evidenceCollected: true,
                    evidenceWasCollected: true,
                    collectedEvidence: true,
                  }
                : {}),
              // Converge tracking for cards like Bring to Light
              convergeValue: convergeValue > 0 ? convergeValue : undefined,
              manaColorsSpent: convergeValue > 0 ? Object.entries(manaConsumption.consumed)
                .filter(([color, amount]) => color !== 'colorless' && amount > 0)
                .map(([color]) => color) : undefined,
              manaSpentTotal,
              manaSpentBreakdown: { ...manaConsumption.consumed },
              // Mark if this is an adventure spell (face index 1 is adventure for adventure cards)
              // For adventure cards: faceIndex 1 = adventure side (instant/sorcery), faceIndex 0 or undefined = creature/enchantment side
              // Note: faceIndex is not available in this fallback path
              castAsAdventure: removedCard.layout === 'adventure' ? false : undefined,
              // Track source zone for rebound and other "cast from hand" effects
              castFromHand: true,
              source: 'hand',
            };
            
            if (typeof game.pushStack === 'function') {
              game.pushStack(stackItem);
            } else {
              // Fallback: manually add to stack
              game.state.stack = game.state.stack || [];
              game.state.stack.push(stackItem as any);
            }
            
            // Bump sequence
            if (typeof game.bumpSeq === 'function') {
              game.bumpSeq();
            }
            
            debug(2, `[castSpellFromHand] Player ${playerId} cast ${removedCard.name} (${cardId}) via fallback`);

            // Track per-turn "cast from hand" (best-effort)
            game.state.spellsCastFromHandThisTurn = game.state.spellsCastFromHandThisTurn || {};
            game.state.spellsCastFromHandThisTurn[playerId] = (game.state.spellsCastFromHandThisTurn[playerId] || 0) + 1;
          }
        }
      } catch (e) {
        debugError(1, 'Failed to cast spell:', e);
        socket.emit("error", {
          code: "CAST_FAILED",
          message: String(e),
        });
        return;
      }
      
      // Persist the event to DB with full card data for reliable replay after server restart
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "castSpell", { 
          playerId, 
          cardId, 
          targets,
          // Include full card data for replay to work correctly after server restart
          card: cardInHand,
          xValue,
          alternateCostId,
          fromZone: 'hand',
          castFromHand: true,
          // Persist mana/payment metadata for deterministic replay / intervening-if.
          manaSpentTotal,
          manaSpentBreakdown: { ...manaConsumption.consumed },
          ...(bargainResolved === true && typeof wasBargained === 'boolean'
            ? {
                bargainResolved: true,
                wasBargained,
              }
            : {}),
          ...(convergeValue > 0
            ? {
                convergeValue,
                manaColorsSpent: Object.entries(manaConsumption.consumed)
                  .filter(([color, amount]) => color !== 'colorless' && amount > 0)
                  .map(([color]) => color),
              }
            : {}),
          ...(Array.isArray(convokeTappedCreatures) && convokeTappedCreatures.length > 0
            ? {
                convokeTappedCreatures: convokeTappedCreatures.slice(),
                manaFromCreaturesSpent: convokeTappedCreatures.length,
              }
            : {}),
          ...(additionalCost && typeof additionalCostPaid === 'boolean'
            ? {
                additionalCostPaidKnown: true,
                additionalCostPaid: additionalCostPaid === true,
                ...(additionalCostPaid === true
                  ? {
                      additionalCostWasPaid: true,
                      paidAdditionalCost: true,
                    }
                  : {}),
              }
            : additionalCostPaid === true
              ? {
                  additionalCostWasPaid: true,
                  paidAdditionalCost: true,
                  additionalCostPaid: true,
                }
              : {}),
          ...(evidenceCollected === true
            ? {
                evidenceCollected: true,
                evidenceWasCollected: true,
                collectedEvidence: true,
              }
            : {}),
          ...(manaFromTreasureSpent === true ? { manaFromTreasureSpent: true } : {}),
        });
      } catch (e) {
        debugWarn(1, 'appendEvent(castSpell) failed:', e);
      }
      
      // Check for "When you cast this spell" triggers on the spell itself (Kozilek, Ulamog, etc.)
      try {
        const eldraziEffect = detectEldraziEffect(cardInHand, { id: cardId, controller: playerId });
        if (eldraziEffect && eldraziEffect.castTrigger) {
          debug(2, `[castSpellFromHand] On-cast trigger: ${cardInHand.name} - ${eldraziEffect.castTrigger}`);
          
          const triggerLower = eldraziEffect.castTrigger.toLowerCase();
          
          // Kozilek, Butcher of Truth: "When you cast this spell, draw four cards"
          if (triggerLower.includes('draw four cards') || triggerLower.includes('draw 4 cards')) {
            if (typeof game.drawCards === 'function') {
              const drawn = game.drawCards(playerId, 4);
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `${cardInHand.name}: ${getPlayerName(game, playerId)} draws 4 cards.`,
                ts: Date.now(),
              });
              debug(1, `[castSpellFromHand] ${cardInHand.name} on-cast trigger: ${getPlayerName(game, playerId)} drew 4 cards`);
            }
          }
          
          // Ulamog, the Infinite Gyre: "When you cast this spell, destroy target permanent"
          // Ulamog, the Ceaseless Hunger: "When you cast this spell, exile two target permanents"
          // These require targets, which should be handled via resolution queue
          // For now, just log them
          if (triggerLower.includes('destroy target permanent') || 
              triggerLower.includes('exile two target permanents') ||
              triggerLower.includes('exile target opponent')) {
            debug(2, `[castSpellFromHand] ${cardInHand.name} has targeting on-cast trigger: ${eldraziEffect.castTrigger}`);
            // TODO: Add these triggers to the resolution queue for target selection
          }
          
          // Emrakul, the Aeons Torn: "Take an extra turn after this one"
          if (triggerLower.includes('extra turn')) {
            // Mark that an extra turn should be taken
            (game.state as any).pendingExtraTurns = (game.state as any).pendingExtraTurns || [];
            (game.state as any).pendingExtraTurns.push({
              playerId: playerId,
              source: cardInHand.name,
            });
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${cardInHand.name}: ${getPlayerName(game, playerId)} will take an extra turn after this one.`,
              ts: Date.now(),
            });
            debug(1, `[castSpellFromHand] ${cardInHand.name} on-cast trigger: extra turn queued for ${playerId}`);
          }
        }
      } catch (err) {
        debugWarn(1, '[castSpellFromHand] Failed to process on-cast triggers:', err);
      }
      
      // Check for spell-cast triggers (Jeskai Ascendancy, Beast Whisperer, etc.)
      try {
        // Track spells cast this turn (for Storm and other "cast this turn" checks)
        try {
          game.state.spellsCastThisTurn = game.state.spellsCastThisTurn || [];
          game.state.spellsCastThisTurn.push({
            id: cardId,
            name: cardInHand?.name,
            casterId: playerId,
            ts: Date.now(),
            // Store minimal card metadata so intervening-if templates can evaluate
            // spell characteristics (e.g., creature vs noncreature, spell colors).
            card: {
              id: cardInHand?.id,
              name: cardInHand?.name,
              type_line: cardInHand?.type_line,
              colors: (cardInHand as any)?.colors,
              color_identity: (cardInHand as any)?.color_identity,
            },
          });
        } catch (err) {
          debugWarn(2, '[castSpellFromHand] Failed to track spellsCastThisTurn:', err);
        }

        // Track: "no opponent cast a spell since your last turn ended" (best-effort)
        // Only flips `false -> true` for already-known opponent entries to avoid guessing in team games.
        try {
          const stateAny = game.state as any;
          const map = stateAny?.opponentCastSpellSinceYourLastTurnEnded;
          if (map && typeof map === 'object') {
            // Per-player nested shape
            for (const [, inner] of Object.entries(map)) {
              if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
              if (typeof (inner as any)[playerId] === 'boolean') (inner as any)[playerId] = true;
            }
            // Legacy flat shape (kept for backward compatibility)
            if (typeof (map as any)[playerId] === 'boolean') (map as any)[playerId] = true;
          }
        } catch (err) {
          debugWarn(2, '[castSpellFromHand] Failed to update opponentCastSpellSinceYourLastTurnEnded:', err);
        }

        const ctxForInterveningIf = { state: game.state } as any;
        const stackArr: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
        let triggeringStackItem: any = null;
        for (let i = stackArr.length - 1; i >= 0; i--) {
          const it = stackArr[i];
          if (!it || String(it.controller || '') !== String(playerId)) continue;
          const cid = String(it?.card?.id || '');
          if (cid && cid === String(cardId)) {
            triggeringStackItem = it;
            break;
          }
        }
        const triggeringStackItemId = triggeringStackItem ? String(triggeringStackItem.id || '') : undefined;

        const spellCastTriggers = getSpellCastTriggersForCard(game, playerId, cardInHand);
        for (const trigger of spellCastTriggers) {
          // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
          const raw = String(trigger.description || trigger.effect || "").trim();
          let triggerText = raw;
          if (triggerText && !/^(?:when|whenever|at)\b/i.test(triggerText)) {
            triggerText = `Whenever you cast a spell, ${triggerText}`;
          }
          const sourcePerm = (game.state?.battlefield || []).find((p: any) => p && p.id === (trigger as any).permanentId);
          const needsThatPlayerRef = /\bthat player\b/i.test(triggerText);
          const baseRefs: any = {
            triggeringStackItemId,
            stackItem: triggeringStackItem || undefined,
          };
          const ok = isInterveningIfSatisfied(
            ctxForInterveningIf,
            String(trigger.controllerId || playerId),
            triggerText,
            sourcePerm,
            needsThatPlayerRef
              ? {
                  ...baseRefs,
                  thatPlayerId: String(playerId),
                  referencedPlayerId: String(playerId),
                  theirPlayerId: String(playerId),
                }
              : baseRefs
          );
          if (ok === false) {
            debug(2, `[castSpellFromHand] Skipping spell-cast trigger due to unmet intervening-if: ${trigger.cardName} - ${triggerText}`);
            continue;
          }

          debug(2, `[castSpellFromHand] Triggered: ${trigger.cardName} - ${trigger.description}`);
          
          // Handle different trigger effects
          const effectLower = trigger.effect.toLowerCase();
          if (effectLower.includes('draw a card') || 
              effectLower.includes('draw cards') ||
              effectLower.includes('draws a card')) {
            // Draw a card effect (Beast Whisperer, Archmage Emeritus)
            if (typeof game.drawCards === 'function') {
              const drawn = game.drawCards(playerId, 1);
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `${trigger.cardName}: ${getPlayerName(game, playerId)} draws a card.`,
                ts: Date.now(),
              });
            }
          }
          
          if (effectLower.includes('untap')) {
            // Untap effect (Jeskai Ascendancy)
            applySpellCastUntapTrigger(game, playerId);
          }
          
          // Consuming Aberration - mill each opponent until land, boost handled via graveyard counts
          if (trigger.cardName.toLowerCase().includes('consuming aberration') ||
              effectLower.includes('until they reveal a land card')) {
            const opponents = (game.state.players || []).filter((p: any) => p.id !== playerId);
            for (const opp of opponents) {
              const millResult = millUntilLand(game, opp.id);
              if (millResult.milled.length > 0) {
                io.to(gameId).emit("chat", {
                  id: `m_${Date.now()}`,
                  gameId,
                  from: "system",
                  message: `${trigger.cardName}: ${getPlayerName(game, opp.id)} mills ${millResult.milled.length} card(s)${millResult.landHit ? ` (stopped at ${millResult.landHit.name})` : ''}.`,
                  ts: Date.now(),
                });
              }
            }
          }
          
          // Token creation handled separately
          if (trigger.createsToken && trigger.tokenDetails) {
            // Create the token (Deeproot Waters, Murmuring Mystic, Oketra's Monument)
            const tokenId = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            
            // Build oracle text from abilities if present
            let oracleText = '';
            const abilitiesText = trigger.tokenDetails.abilities 
              ? trigger.tokenDetails.abilities.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')
              : '';
            if (abilitiesText) {
              oracleText = abilitiesText;
            }
            
            const token = {
              id: tokenId,
              controller: playerId,
              owner: playerId,
              tapped: false,
              counters: {},
              basePower: trigger.tokenDetails.power,
              baseToughness: trigger.tokenDetails.toughness,
              summoningSickness: true,
              isToken: true,
              card: {
                id: tokenId,
                name: trigger.tokenDetails.name,
                type_line: trigger.tokenDetails.types,
                power: String(trigger.tokenDetails.power),
                toughness: String(trigger.tokenDetails.toughness),
                oracle_text: oracleText,
                zone: "battlefield",
              },
            };
            game.state.battlefield = game.state.battlefield || [];
            game.state.battlefield.push(token as any);
            
            const abilitiesDisplay = abilitiesText ? ` with ${abilitiesText}` : '';
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${trigger.cardName}: ${getPlayerName(game, playerId)} creates a ${trigger.tokenDetails.power}/${trigger.tokenDetails.toughness} ${trigger.tokenDetails.name}${abilitiesDisplay}.`,
              ts: Date.now(),
            });
          }
          
          // Loyalty counter effect (Ral, Crackling Wit and similar planeswalkers)
          if (trigger.addsLoyaltyCounters && trigger.addsLoyaltyCounters > 0) {
            // Find the planeswalker permanent on the battlefield
            const battlefield = game.state?.battlefield || [];
            const planeswalker = battlefield.find((perm: any) => 
              perm.id === trigger.permanentId && 
              perm.controller === playerId
            );
            
            if (planeswalker) {
              planeswalker.counters = planeswalker.counters || {};
              const currentLoyalty = parseInt(String(planeswalker.counters.loyalty || planeswalker.card?.loyalty || 0), 10) || 0;
              const newLoyalty = currentLoyalty + trigger.addsLoyaltyCounters;
              // Cast to any to bypass readonly restriction
              (planeswalker.counters as any).loyalty = newLoyalty;
              
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `${trigger.cardName}: ${getPlayerName(game, playerId)} adds ${trigger.addsLoyaltyCounters} loyalty counter${trigger.addsLoyaltyCounters > 1 ? 's' : ''} (now ${newLoyalty}).`,
                ts: Date.now(),
              });
              
              debug(2, `[castSpellFromHand] ${trigger.cardName}: Added ${trigger.addsLoyaltyCounters} loyalty counter(s), now at ${newLoyalty}`);
            }
          }
          
          // Tap/Untap target permanent effect (Merrow Reejerey, Stonybrook Schoolmaster, etc.)
          // These are "may" abilities that require target selection - push to stack for targeting
          if (trigger.requiresTarget && 
              (effectLower.includes('tap or untap target') || 
               effectLower.includes('untap target') ||
               effectLower.includes('tap target'))) {
            // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
            const raw = String(trigger.description || trigger.effect || "").trim();
            let triggerText = raw;
            if (triggerText && !/^(?:when|whenever|at)\b/i.test(triggerText)) {
              triggerText = `Whenever you cast a spell, ${triggerText}`;
            }
            const sourcePerm = (game.state?.battlefield || []).find((p: any) => p && p.id === (trigger as any).permanentId);
            const needsThatPlayerRef = /\bthat player\b/i.test(triggerText);
            const ok = isInterveningIfSatisfied(
              ctxForInterveningIf,
              String(playerId),
              triggerText,
              sourcePerm,
              needsThatPlayerRef
                ? {
                    thatPlayerId: String(playerId),
                    referencedPlayerId: String(playerId),
                    theirPlayerId: String(playerId),
                  }
                : undefined
            );
            if (ok === false) {
              debug(2, `[castSpellFromHand] Skipping targeted spell-cast trigger due to unmet intervening-if: ${trigger.cardName} - ${triggerText}`);
              continue;
            }

            // Push to stack for target selection
            game.state.stack = game.state.stack || [];
            const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            
            game.state.stack.push({
              id: triggerId,
              type: 'triggered_ability',
              controller: playerId,
              source: trigger.permanentId,
              sourceName: trigger.cardName,
              description: trigger.description,
              triggerType: 'cast_creature_type',
              effect: trigger.effect,
              mandatory: trigger.mandatory,
              requiresTarget: true,
              targetType: trigger.targetType || 'permanent',
            } as any);
            
            debug(2, `[castSpellFromHand] Pushed ${trigger.cardName} trigger to stack for target selection`);
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${trigger.cardName} triggers: ${getPlayerName(game, playerId)} may tap or untap target permanent.`,
              ts: Date.now(),
            });
          }
        }
      } catch (err) {
        debugWarn(1, '[castSpellFromHand] Failed to process spell-cast triggers:', err);
      }
      
      // Check for heroic triggers on targeted creatures
      // Heroic: "Whenever you cast a spell that targets this creature..."
      try {
        if (targets && targets.length > 0) {
          const targetIds = targets.map((t: any) => typeof t === 'string' ? t : t.id);
          const heroicTriggers = getHeroicTriggers(game, playerId, targetIds);
          for (const trigger of heroicTriggers) {
            debug(2, `[castSpellFromHand] Heroic triggered: ${trigger.cardName} - ${trigger.description}`);
            applyHeroicTrigger(game, trigger, io, gameId);
          }
        }
      } catch (err) {
        debugWarn(1, '[castSpellFromHand] Failed to process heroic triggers:', err);
      }
      
      // ========================================================================
      // OPPONENT SPELL CAST TRIGGERS (Esper Sentinel, Rhystic Study, Mystic Remora)
      // These trigger when OPPONENTS cast spells, not the caster themselves
      // ========================================================================
      try {
        const allPlayerIds = (game.state?.players || []).map((p: any) => p.id);
        const battlefield = game.state?.battlefield || [];
        const ctxForInterveningIf = { state: game.state } as any;
        
        // Track if this is the first noncreature spell the caster has cast this turn
        const spellTypeLine = (cardInHand?.type_line || '').toLowerCase();
        const isNoncreatureSpell = !spellTypeLine.includes('creature');
        
        // Check noncreature spells cast this turn by this player
        const noncreatureSpellsThisTurn = (game.state?.noncreatureSpellsCastThisTurn || {})[playerId] || 0;
        const isFirstNoncreatureThisTurn = isNoncreatureSpell && noncreatureSpellsThisTurn === 0;
        
        // Increment counter if this is a noncreature spell
        if (isNoncreatureSpell) {
          game.state.noncreatureSpellsCastThisTurn = game.state.noncreatureSpellsCastThisTurn || {};
          game.state.noncreatureSpellsCastThisTurn[playerId] = noncreatureSpellsThisTurn + 1;
        }
        
        const opponentTriggers = getOpponentSpellCastTriggers(
          battlefield,
          playerId, // The caster (opponent to the trigger controllers)
          cardInHand,
          allPlayerIds,
          isFirstNoncreatureThisTurn
        );
        
        for (const trigger of opponentTriggers) {
          // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
          const raw = String(trigger.description || (trigger as any).effect || "").trim();
          let triggerText = raw;
          if (triggerText && !/^(?:when|whenever|at)\b/i.test(triggerText)) {
            triggerText = `Whenever an opponent casts a spell, ${triggerText}`;
          }
          const casterId = String((trigger as any).casterId || playerId || '').trim();
          const sourcePerm = (game.state?.battlefield || []).find((p: any) => p && p.id === (trigger as any).permanentId);
          const needsThatPlayerRef = /\bthat player\b/i.test(triggerText);
          const ok = isInterveningIfSatisfied(
            ctxForInterveningIf,
            String(trigger.controllerId),
            triggerText,
            sourcePerm,
            needsThatPlayerRef && casterId
              ? {
                  thatPlayerId: casterId,
                  referencedPlayerId: casterId,
                  theirPlayerId: casterId,
                }
              : undefined
          );
          if (ok === false) {
            debug(2, `[castSpellFromHand] Skipping opponent spell trigger due to unmet intervening-if: ${trigger.cardName} - ${triggerText}`);
            continue;
          }

          debug(2, `[castSpellFromHand] Opponent spell trigger: ${trigger.cardName} - ${trigger.description}`);
          
          // Push the trigger to the stack for resolution
          // The trigger's controller can choose to draw a card unless the caster pays
          game.state.stack = game.state.stack || [];
          const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          
          const stackItem: any = {
            id: triggerId,
            type: 'triggered_ability',
            controller: trigger.controllerId, // The Esper Sentinel/Rhystic Study controller
            source: trigger.permanentId,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
            // Context for resolution-time checks and pronoun binding (e.g., "that player")
            targetPlayer: String((trigger as any).casterId || playerId || ''),
            triggeringPlayer: String((trigger as any).casterId || playerId || ''),
            effectData: {
              casterId: trigger.casterId,
              paymentCost: trigger.paymentCost,
              paymentAmount: trigger.paymentAmount,
              benefitIfNotPaid: trigger.benefitIfNotPaid,
            },
          };
          game.state.stack.push(stackItem);
          
          // Emit trigger notification
          io.to(gameId).emit("triggeredAbility", {
            gameId,
            triggerId,
            playerId: trigger.controllerId,
            sourcePermanentId: trigger.permanentId,
            sourceName: trigger.cardName,
            triggerType: trigger.triggerType,
            description: trigger.description,
            mandatory: trigger.mandatory,
          });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `ΓÜí ${trigger.cardName}'s triggered ability: ${trigger.description}`,
            ts: Date.now(),
          });
        }
      } catch (err) {
        debugWarn(1, '[castSpellFromHand] Failed to process opponent spell triggers:', err);
      }
      
      // Foretell cast cleanup: once the spell is successfully cast, clear any pending-restore marker.
      if ((cardInHand as any)?.castFromForetell === true) {
        const pendingForetell = (game.state as any)?.pendingForetellCasts;
        if (pendingForetell?.[cardId]) {
          delete pendingForetell[cardId];
        }
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} cast ${cardInHand.name}.`,
        ts: Date.now(),
      });
      
      // Process any cascade triggers
      await processPendingCascades(io, game, gameId);
      
      // Process any pending scry effects
      processPendingScry(io, game, gameId);
      
      // Process any pending ponder effects
      processPendingPonder(io, game, gameId);
      
      // Process any pending proliferate effects
      processPendingProliferate(io, game, gameId);
      
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `castSpell error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CAST_SPELL_ERROR",
        message: err?.message ?? String(err),
      });
    }
  };
  
  // =====================================================================
  // COMPLETE CAST SPELL - Final step after targets selected and payment made
  // Called after both target selection and payment are complete
  // =====================================================================
  socket.on("completeCastSpell", async ({ gameId, cardId, targets, payment, effectId, xValue, alternateCostId, convokeTappedCreatures }: { 
    gameId: string; 
    cardId: string; 
    targets?: any[]; 
    payment?: PaymentItem[];
    effectId?: string;
    xValue?: number;
    alternateCostId?: string;
    convokeTappedCreatures?: string[];
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // DEBUG: Log incoming parameters
      debug(2, `[completeCastSpell] DEBUG START ========================================`);
      debug(2, `[completeCastSpell] cardId: ${cardId}, effectId: ${effectId}`);
      debug(2, `[completeCastSpell] targets from client: ${targets ? JSON.stringify(targets) : 'undefined'}`);
      debug(2, `[completeCastSpell] payment from client: ${payment ? JSON.stringify(payment) : 'undefined'}`);
      if (convokeTappedCreatures && convokeTappedCreatures.length > 0) {
        debug(2, `[completeCastSpell] convokeTappedCreatures:`, convokeTappedCreatures);
      }
      
      // Retrieve targets from pending cast data before cleaning up
      // This ensures Aura targets (stored in targetSelectionConfirm) are preserved
      let finalTargets = targets;
      if (effectId && (game.state as any).pendingSpellCasts?.[effectId]) {
        const pendingCast = (game.state as any).pendingSpellCasts[effectId];
        debug(2, `[completeCastSpell] Found pendingCast:`, JSON.stringify(pendingCast, null, 2));

        // Mutate metadata is stored on pendingCast; copy it to the actual card object in hand before casting.
        if (String(pendingCast?.forcedAlternateCostId || '') === 'mutate') {
          try {
            const zones = (game.state as any)?.zones?.[playerId];
            const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
            const cardObj = hand.find((c: any) => c && String(c.id) === String(cardId));
            if (cardObj) {
              (cardObj as any).isMutating = true;
              (cardObj as any).mutateTarget = String(pendingCast?.mutateTarget || (pendingCast?.targets?.[0] ?? ''));
              (cardObj as any).mutateOnTop = Boolean(pendingCast?.mutateOnTop);
              (cardObj as any).mutateCost = String(pendingCast?.mutateCost || pendingCast?.manaCost || '');
            }
          } catch (e) {
            debugWarn(1, '[completeCastSpell] Failed to apply mutate metadata:', e);
          }
        }
        
        // CRITICAL FIX: Always prefer pending targets over client-sent targets
        // This prevents the infinite targeting loop when client doesn't send targets back
        if (pendingCast.targets && pendingCast.targets.length > 0) {
          finalTargets = pendingCast.targets;
          debug(1, `[completeCastSpell] Using pending targets from server: ${finalTargets.join(',')}`);
        } else if (!finalTargets || finalTargets.length === 0) {
          // Fallback: use client-sent targets if no pending targets
          finalTargets = targets || [];
          debug(1, `[completeCastSpell] Using client-sent targets: ${finalTargets?.join(',') || 'none'}`);
        }

        // Preserve additional-cost payment flag from requestCastSpell flow.
        if (finalTargets) {
          (finalTargets as any).additionalCostPaid = pendingCast.additionalCostPaid === true;
          (finalTargets as any).additionalCostMethod = pendingCast.additionalCostMethod;
        }
        
        // CRITICAL FIX: Validate that spell has required targets before allowing cast
        // Check if this spell requires targets based on validTargetIds
        const requiredTargets = pendingCast.validTargetIds && pendingCast.validTargetIds.length > 0;
        if (requiredTargets && (!finalTargets || finalTargets.length === 0)) {
          debugError(1, `[completeCastSpell] ERROR: Spell ${pendingCast.cardName} requires targets but none provided!`);
          debugError(1, `[completeCastSpell] validTargetIds: ${JSON.stringify(pendingCast.validTargetIds)}`);
          debugError(1, `[completeCastSpell] pendingCast.targets: ${JSON.stringify(pendingCast.targets)}`);
          debugError(1, `[completeCastSpell] client targets: ${JSON.stringify(targets)}`);
          
          // Clean up the pending cast
          delete (game.state as any).pendingSpellCasts[effectId];
          
          socket.emit("error", {
            code: "MISSING_TARGETS",
            message: `${pendingCast.cardName} requires a target but none was provided. Please try casting again.`,
          });
          return;
        }
        
        delete (game.state as any).pendingSpellCasts[effectId];
      } else {
        debug(2, `[completeCastSpell] No pendingCast found for effectId: ${effectId}`);
      }
      
      // CRITICAL FIX: Clean up pendingTargets to prevent game from being blocked
      // pendingTargets is set by targetSelectionConfirm but never cleaned up
      if (effectId && game.state.pendingTargets?.[effectId]) {
        debug(2, `[completeCastSpell] Cleaning up pendingTargets for effectId: ${effectId}`);
        delete game.state.pendingTargets[effectId];
      }

      debug(1, `[completeCastSpell] Final targets to use: ${finalTargets?.join(',') || 'none'}`);
      debug(2, `[completeCastSpell] Calling handleCastSpellFromHand with skipInteractivePrompts=true`);
      debug(2, `[completeCastSpell] DEBUG END ==========================================`);

      // CRITICAL FIX: Pass skipInteractivePrompts=true to prevent infinite targeting loop
      // This tells handleCastSpellFromHand to skip all target/payment requests since we're completing a previous cast
      handleCastSpellFromHand({ gameId, cardId, targets: finalTargets, payment, skipInteractivePrompts: true, xValue, alternateCostId, convokeTappedCreatures });
      
    } catch (err: any) {
      debugError(1, `[completeCastSpell] Error:`, err);
      socket.emit("error", {
        code: "COMPLETE_CAST_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Cast spell from hand - registers the socket event handler
  socket.on("castSpellFromHand", handleCastSpellFromHand);

  // Pass priority
  socket.on("passPriority", async ({ gameId, isAutoPass }: { gameId: string; isAutoPass?: boolean }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const { changed, resolvedNow, advanceStep } = (game as any).passPriority(playerId, isAutoPass);
      if (!changed) return;

      appendGameEvent(game, gameId, "passPriority", { by: playerId });

      if (resolvedNow) {
        // Capture the top spell before it resolves (for tutor effect handling)
        const stackBefore = game.state?.stack || [];
        const topItem = stackBefore.length > 0 ? stackBefore[stackBefore.length - 1] : null;
        const resolvedCard = topItem?.card;
        const resolvedController = topItem?.controller;
        
        // Check for Mox Diamond replacement effect BEFORE resolving
        // "If Mox Diamond would enter the battlefield, you may discard a land card instead."
        const isMoxDiamondCard = (resolvedCard?.name || '').toLowerCase().trim() === 'mox diamond';
        if (resolvedCard && resolvedController && isMoxDiamondCard) {
          const zones = game.state?.zones?.[resolvedController];
          const hand = Array.isArray(zones?.hand) ? zones.hand : [];
          const landCardsInHand = hand
            .filter((c: any) => c && /\bland\b/i.test(c.type_line || ''))
            .map((c: any) => ({
              id: c.id,
              label: `Discard ${c.name || 'Land'}`,
              imageUrl: c.image_uris?.small || c.image_uris?.normal,
            }));

          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, resolvedController as any)
            .find((s: any) => (s as any)?.moxDiamondChoice === true && String((s as any)?.stackItemId || '') === String(topItem.id));
          if (existing) {
            debug(2, `[passPriority] Mox Diamond replacement effect: step already exists for ${resolvedController}`);
            if (typeof game.bumpSeq === 'function') game.bumpSeq();
            broadcastGame(io, game, gameId);
            return;
          }
          
          ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: resolvedController as PlayerID,
            description: 'Mox Diamond ΓÇö Discard a land to put it onto the battlefield, or decline to put it into the graveyard',
            mandatory: true,
            sourceId: topItem.id,
            sourceName: resolvedCard.name || 'Mox Diamond',
            options: [
              ...landCardsInHand,
              { id: 'decline_mox_diamond', label: 'DonΓÇÖt discard (put Mox Diamond into graveyard)' },
            ],
            minSelections: 1,
            maxSelections: 1,
            moxDiamondChoice: true,
            stackItemId: topItem.id,
          } as any);
          
          debug(2, `[passPriority] Mox Diamond replacement effect: queued option choice for ${resolvedController}`);
          
          if (typeof game.bumpSeq === 'function') {
            game.bumpSeq();
          }
          broadcastGame(io, game, gameId);
          return;
        }
        
        
        // Directly call resolveTopOfStack to ensure the spell resolves
        // (appendGameEvent may fail silently if applyEvent has issues)
        if (typeof (game as any).resolveTopOfStack === 'function') {
          (game as any).resolveTopOfStack();
          debug(2, `[passPriority] Stack resolved for game ${gameId}`);
          
          // Check for creature type selection requirements on newly entered permanents
          // (e.g., Morophon, Cavern of Souls, Kindred Discovery)
          checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
          
          // Check for color choice requirements on newly entered permanents
          // (e.g., Caged Sun, Gauntlet of Power)
          checkColorChoiceForNewPermanents(io, game, gameId);
          
          // Check for player selection requirements on newly entered permanents
          // (e.g., Stuffy Doll, Vislor Turlough, Xantcha)
          checkPlayerSelectionForNewPermanents(io, game, gameId);
          
          // Check for enchantment ETB triggers (e.g., Growing Rites of Itlimoc)
          checkEnchantmentETBTriggers(io, game, gameId);
          
          // Check if the resolved spell has a tutor effect (search library)
          if (resolvedCard && resolvedController) {
            const oracleText = resolvedCard.oracle_text || '';
            const typeLine = (resolvedCard.type_line || '').toLowerCase();
            const isInstantOrSorcery = typeLine.includes('instant') || typeLine.includes('sorcery');
            
            if (isInstantOrSorcery && oracleText.toLowerCase().includes('search your library')) {
              // Use the comprehensive tutor detection function
              const tutorInfo = detectTutorEffect(oracleText);
              
              if (tutorInfo.isTutor) {
                const cardName = resolvedCard.name || 'Spell';
                
                // Parse search criteria for filter
                const filter = parseSearchCriteria(tutorInfo.searchCriteria || '');
                
                // Get library for the spell's controller
                const library = typeof game.searchLibrary === 'function' 
                  ? game.searchLibrary(resolvedController, "", 1000) 
                  : [];
                
                // Find the socket for the controller and send library search request
                for (const s of io.sockets.sockets.values()) {
                  if (s.data?.playerId === resolvedController && !s.data?.spectator) {
                    // Queue library search via Resolution Queue
                    const isSplit = tutorInfo.splitDestination === true;
                    const destination: any = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
                      : (tutorInfo.destination === 'exile') ? 'exile'
                      : 'hand';
                    ResolutionQueueManager.addStep(gameId, {
                      type: ResolutionStepType.LIBRARY_SEARCH,
                      playerId: resolvedController as PlayerID,
                      sourceName: cardName,
                      description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
                      searchCriteria: tutorInfo.searchCriteria || 'any card',
                      minSelections: 0,
                      maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
                      mandatory: false,
                      destination,
                      reveal: false,
                      shuffleAfter: true,
                      availableCards: library,
                      filter,
                      splitDestination: isSplit,
                      toBattlefield: tutorInfo.toBattlefield || 1,
                      toHand: tutorInfo.toHand || 1,
                      entersTapped: tutorInfo.entersTapped || false,
                    } as any);
                    break;
                  }
                }
                
                debug(2, `[passPriority] Triggered library search for ${cardName} by ${resolvedController} (destination: ${tutorInfo.splitDestination ? 'split' : tutorInfo.destination})`);
              }
            }
          }
        }
        appendGameEvent(game, gameId, "resolveTopOfStack");
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: "Top of stack resolved.",
          ts: Date.now(),
        });
        
        // Process any cascade triggers
        await processPendingCascades(io, game, gameId);
        
        // Process any pending scry effects
        processPendingScry(io, game, gameId);
        
        // Process any pending ponder effects
        processPendingPonder(io, game, gameId);
        
        // Process any pending proliferate effects
        processPendingProliferate(io, game, gameId);
        
        // ========================================================================
        // CRITICAL: Check if there's a pending phase skip that was interrupted
        // by combat triggers. If stack is now empty and all triggers are resolved,
        // automatically continue to the originally requested phase.
        // ========================================================================
        const pendingSkip = (game.state as any).pendingPhaseSkip;
        if (pendingSkip && game.state.stack && game.state.stack.length === 0) {
          const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
          const noPendingResolutionSteps = !queueSummary.hasPending;
          const noPendingOrdering = !(game.state as any).pendingTriggerOrdering || 
                                    Object.keys((game.state as any).pendingTriggerOrdering).length === 0;
          
          if (noPendingResolutionSteps && noPendingOrdering) {
            debug(2, `[passPriority] Continuing pending phase skip from BEGIN_COMBAT to ${pendingSkip.targetStep}`);
            
            // Update phase and step to the originally requested target
            (game.state as any).phase = pendingSkip.targetPhase;
            (game.state as any).step = pendingSkip.targetStep;
            
            // Clear the pending skip
            delete (game.state as any).pendingPhaseSkip;
            
            // Append event to track this automatic continuation
            try {
              appendEvent(gameId, (game as any).seq || 0, "skipToPhase", {
                playerId: pendingSkip.requestedBy,
                from: 'BEGIN_COMBAT',
                to: pendingSkip.targetStep,
                auto: true,
                reason: 'combat_triggers_resolved',
              });
            } catch (e) {
              debugWarn(1, "appendEvent(skipToPhase auto) failed:", e);
            }
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `Combat triggers resolved. Continuing to ${pendingSkip.targetStep}.`,
              ts: Date.now(),
            });
            
            // Bump sequence to reflect phase change
            if (typeof game.bumpSeq === 'function') {
              game.bumpSeq();
            }
          }
        }
      }

      // If all players passed priority with empty stack, advance to next step
      if (advanceStep) {
        if (typeof (game as any).nextStep === 'function') {
          (game as any).nextStep();
          debug(2, `[passPriority] All players passed priority - advanced to next step for game ${gameId}`);
          
          appendGameEvent(game, gameId, "nextStep", { reason: 'allPlayersPassed' });
          
          const newStep = (game.state as any)?.step || 'unknown';
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Step advanced to ${newStep}.`,
            ts: Date.now(),
          });
        }
      }

      broadcastGame(io, game, gameId);
      
      // Check for pending damage triggers (Brash Taunter, Boros Reckoner, etc.)
      // These are queued during combat damage or spell resolution
      checkAndEmitDamageTriggers(io, game, gameId);
    } catch (err: any) {
      debugError(1, `passPriority error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "PASS_PRIORITY_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });
  
  /**
   * Check for pending damage triggers and emit them to the appropriate players.
   * Damage triggers are queued in game.state.pendingDamageTriggers during:
   * - Combat damage (turn.ts dealCombatDamage)
   * - Fight resolution (interaction.ts)
   * - Spell damage effects
   */
  function checkAndEmitDamageTriggers(io: Server, game: InMemoryGame, gameId: string) {
    emitPendingDamageTriggers(io, game, gameId);
  }

  /**
   * Batch resolve all triggered abilities on the stack.
   * This is a convenience feature that resolves all triggers without pausing for priority
   * between each one. Only works when:
   * 1. The player has priority
   * 2. All stack items are triggered abilities controlled by the player
   */
  socket.on("resolveAllTriggers", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const state = game.state;
      if (!state || state.priority !== playerId) {
        socket.emit("error", { code: "NOT_PRIORITY", message: "You don't have priority" });
        return;
      }

      const stack = state.stack || [];
      if (stack.length === 0) {
        socket.emit("error", { code: "EMPTY_STACK", message: "Stack is empty" });
        return;
      }

      // Verify all items are triggered abilities controlled by this player
      const allMyTriggers = stack.every((item: any) => 
        item.type === 'triggered_ability' && item.controller === playerId
      );

      if (!allMyTriggers) {
        socket.emit("error", { 
          code: "MIXED_STACK", 
          message: "Cannot batch resolve - stack contains items not controlled by you or non-triggers" 
        });
        return;
      }

      debug(2, `[resolveAllTriggers] Batch resolving ${stack.length} triggers for ${playerId}`);

      // Track which sources we're resolving for client count updates
      const resolvedSources: Map<string, { sourceName: string; count: number; effect: string; imageUrl?: string }> = new Map();
      for (const item of stack) {
        const sourceKey = (item as any).source || (item as any).sourceId || (item as any).sourceName;
        const sourceName = (item as any).sourceName || 'Unknown';
        const effect = (item as any).description || '';
        const imageUrl = (item as any).card?.image_uris?.small;
        
        const existing = resolvedSources.get(sourceKey);
        if (existing) {
          existing.count++;
        } else {
          resolvedSources.set(sourceKey, { sourceName, count: 1, effect, imageUrl });
        }
      }

      // Resolve all triggers in sequence (top to bottom)
      let resolvedCount = 0;
      while (state.stack && state.stack.length > 0) {
        if (typeof (game as any).resolveTopOfStack === 'function') {
          (game as any).resolveTopOfStack();
          resolvedCount++;
        } else {
          break;
        }
      }

      // Log the batch resolution
      appendGameEvent(game, gameId, "resolveAllTriggers", { 
        by: playerId, 
        count: resolvedCount 
      });

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} resolved ${resolvedCount} triggered abilities.`,
        ts: Date.now(),
      });

      // Emit summary of resolved sources so client can update auto-resolve counts
      const resolvedSourcesArray = Array.from(resolvedSources.entries()).map(([key, value]) => ({
        sourceKey: key,
        ...value,
      }));
      socket.emit("triggersResolved", {
        gameId,
        playerId,
        totalCount: resolvedCount,
        sources: resolvedSourcesArray,
      });

      // After batch resolution, priority goes back to the active player
      state.priority = state.turnPlayer as PlayerID;
      
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `resolveAllTriggers error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "RESOLVE_ALL_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Claim turn (pre-game only) - set yourself as active player when pre-game and turnPlayer is unset.
  socket.on("claimMyTurn", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      const pregame =
        phaseStr === "" ||
        phaseStr === "PRE_GAME" ||
        phaseStr.includes("BEGIN");

      if (!pregame) {
        socket.emit("error", {
          code: "CLAIM_TURN_NOT_PREGAME",
          message: "Claiming turn only allowed in pre-game.",
        });
        return;
      }

      if (game.state.turnPlayer) {
        socket.emit("error", {
          code: "CLAIM_TURN_EXISTS",
          message: "Active player already set.",
        });
        return;
      }

      // Set as active player
      try {
        game.state.turnPlayer = playerId;
        // Track starting player for intervening-if templates like "if you weren't the starting player".
        // Best-effort: only set if missing so reconnects/duplicate actions don't overwrite.
        if (!(game.state as any).startingPlayerId) {
          (game.state as any).startingPlayerId = playerId;
          // Legacy alias for intervening-if fallbacks.
          (game.state as any).startingPlayer = (game.state as any).startingPlayerId;
        }
        appendGameEvent(game, gameId, "claimTurn", { by: playerId });
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} claimed first turn.`,
          ts: Date.now(),
        });
        broadcastGame(io, game, gameId);
      } catch (e) {
        debugError(1, "claimMyTurn: failed to set turnPlayer", e);
        socket.emit("error", {
          code: "CLAIM_TURN_FAILED",
          message: String(e),
        });
      }
    } catch (err) {
      debugError(1, "claimMyTurn handler failed:", err);
    }
  });

  // Randomize starting player
  socket.on("randomizeStartingPlayer", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      const isPreGame =
        phaseStr === "" || phaseStr === "PRE_GAME" || phaseStr.includes("PRE");

      if (!isPreGame) {
        socket.emit("error", {
          code: "RANDOMIZE_NOT_PREGAME",
          message: "Randomizing starting player only allowed in pre-game.",
        });
        return;
      }

      const players = (game.state?.players || []).filter((p: any) => p && !p.spectator);
      if (players.length === 0) {
        socket.emit("error", {
          code: "RANDOMIZE_NO_PLAYERS",
          message: "No players to randomize.",
        });
        return;
      }

      // Pick a random player
      const randomIndex = Math.floor(Math.random() * players.length);
      const randomPlayer = players[randomIndex];
      
      // Set as active player
      try {
        game.state.turnPlayer = randomPlayer.id;
        // Track starting player for intervening-if templates like "if you weren't the starting player".
        (game.state as any).startingPlayerId = randomPlayer.id;
        // Legacy alias for intervening-if fallbacks.
        (game.state as any).startingPlayer = (game.state as any).startingPlayerId;
        appendGameEvent(game, gameId, "randomizeStartingPlayer", { 
          selectedPlayerId: randomPlayer.id,
          by: playerId
        });
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `≡ƒÄ▓ ${getPlayerName(game, randomPlayer.id)} was randomly selected to go first!`,
          ts: Date.now(),
        });
        broadcastGame(io, game, gameId);
      } catch (e) {
        debugError(1, "randomizeStartingPlayer: failed to set turnPlayer", e);
        socket.emit("error", {
          code: "RANDOMIZE_FAILED",
          message: String(e),
        });
      }
    } catch (err) {
      debugError(1, "randomizeStartingPlayer handler failed:", err);
    }
  });

  // Next turn
  socket.on("nextTurn", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Debug logging
      try {
        debug(1, 
          `[nextTurn] request from player=${playerId} game=${gameId} turnPlayer=${
            game.state?.turnPlayer
          } stack=${(game.state?.stack || []).length} phase=${String(
            game.state?.phase
          )}`
        );
      } catch {
        /* ignore */
      }

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      const pregame =
        phaseStr === "" ||
        phaseStr === "PRE_GAME" ||
        phaseStr.includes("BEGIN");

      // During pre-game, check that all players have imported their decks
      if (pregame) {
        const { allHaveDecks, waitingPlayers: deckWaiters } = checkAllPlayersHaveDecks(game);
        if (!allHaveDecks && deckWaiters.length > 0) {
          socket.emit("error", {
            code: "PREGAME_DECKS_NOT_LOADED",
            message: `Waiting for player(s) to import their deck: ${deckWaiters.join(", ")}`,
          });
          debug(1, 
            `[nextTurn] rejected - not all players have decks (waiting: ${deckWaiters.join(", ")})`
          );
          return;
        }

        // Check that all players have kept their hands before allowing transition
        const { allKept, waitingPlayers } = checkAllPlayersKeptHands(game);
        if (!allKept && waitingPlayers.length > 0) {
          socket.emit("error", {
            code: "PREGAME_HANDS_NOT_KEPT",
            message: `Waiting for player(s) to keep their hand: ${waitingPlayers.join(", ")}`,
          });
          debug(1, 
            `[nextTurn] rejected - not all players kept hands (waiting: ${waitingPlayers.join(", ")})`
          );
          return;
        }
      }

      const playersArr: any[] =
        game.state && Array.isArray(game.state.players)
          ? game.state.players
          : [];

      // Only active player may advance if set
      if (game.state.turnPlayer) {
        if (game.state.turnPlayer !== playerId) {
          socket.emit("error", {
            code: "NEXT_TURN",
            message: "Only the active player can advance the turn.",
          });
          debug(1, 
            `[nextTurn] rejected - not active player (player=${playerId} turnPlayer=${game.state.turnPlayer})`
          );
          return;
        }
      } else {
        // No turnPlayer set
        if (playersArr.length <= 1) {
          try {
            game.state.turnPlayer = playerId;
            appendGameEvent(game, gameId, "autoAssignTurn", { playerId });
            debug(1, 
              `[nextTurn] auto-assigned turnPlayer to single player ${playerId}`
            );
          } catch (e) {
            debugWarn(1, "nextTurn: auto-assign failed", e);
          }
        } else {
          if (!pregame) {
            socket.emit("error", {
              code: "NEXT_TURN",
              message: "No active player set; cannot advance turn.",
            });
            debug(1, 
              `[nextTurn] rejected - no turnPlayer and not pregame (phase=${phaseStr})`
            );
            return;
          } else {
            if (!game.state.turnPlayer) {
              socket.emit("error", {
                code: "NEXT_TURN_NO_CLAIM",
                message:
                  "No active player set. Use 'Claim Turn' to set first player.",
              });
              debug(1, 
                `[nextTurn] rejected - no turnPlayer; ask user to claim (player=${playerId})`
              );
              return;
            }
          }
        }
      }

      if (game.state.stack && game.state.stack.length > 0) {
        socket.emit("error", {
          code: "NEXT_TURN",
          message: "Cannot advance turn while the stack is not empty.",
        });
        debug(1, 
          `[nextTurn] rejected - stack not empty (len=${game.state.stack.length})`
        );
        return;
      }

      // Invoke underlying implementation
      try {
        if (typeof (game as any).nextTurn === "function") {
          await (game as any).nextTurn();
          debug(2, 
            `[nextTurn] Successfully advanced turn for game ${gameId}`
          );
        } else {
          debugError(1, 
            `[nextTurn] CRITICAL: game.nextTurn not available on game ${gameId} - this should not happen with full engine`
          );
          socket.emit("error", {
            code: "NEXT_TURN_IMPL_MISSING",
            message:
              "Server error: game engine not properly initialized. Please contact support.",
          });
          return;
        }
      } catch (e) {
        debugError(1, "nextTurn: game.nextTurn invocation failed:", e);
        socket.emit("error", {
          code: "NEXT_TURN_IMPL_ERROR",
          message: String(e),
        });
        return;
      }

      // Handle conceded player cleanup when their turn would start
      // If the new turn player has conceded, clean up their field and skip to next player
      const newTurnPlayer = game.state.turnPlayer;
      const players = game.state.players || [];
      const concededPlayer = players.find((p: any) => 
        p.id === newTurnPlayer && p.conceded && !p.eliminated
      );
      
      if (concededPlayer) {
        const concededPlayerName = concededPlayer.name || newTurnPlayer;
        
        // Clean up conceded player's permanents (exile them)
        const battlefield = game.state.battlefield || [];
        const concededPermanents = battlefield.filter((p: any) => p.controller === newTurnPlayer);
        
        if (concededPermanents.length > 0) {
          // Move all their permanents to exile
          const zones = (game.state as any).zones = (game.state as any).zones || {};
          const playerZones = zones[newTurnPlayer] = zones[newTurnPlayer] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          (playerZones as any).exile = (playerZones as any).exile || [];
          
          for (const perm of concededPermanents) {
            (playerZones as any).exile.push({
              id: perm.id,
              ...perm.card,
              zone: 'exile',
            });
          }
          
          // Remove from battlefield
          game.state.battlefield = battlefield.filter((p: any) => p.controller !== newTurnPlayer);
          
          debug(2, `[nextTurn] Removed ${concededPermanents.length} permanents from conceded player ${concededPlayerName}`);
        }
        
        // Mark player as fully eliminated now
        (concededPlayer as any).hasLost = true;
        (concededPlayer as any).eliminated = true;
        (concededPlayer as any).lossReason = "Conceded";
        
        // Emit that their field was cleaned up
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `≡ƒÅ│∩╕Å ${concededPlayerName}'s permanents have been removed from the game.`,
          ts: Date.now(),
        });
        
        // Skip to next player's turn
        if (typeof (game as any).nextTurn === "function") {
          await (game as any).nextTurn();
          debug(2, `[nextTurn] Skipped conceded player ${concededPlayerName}, advancing to next player`);
        }
      }

      // Persist event without re-applying it in-memory (avoid double-advance)
      try {
        appendEvent(
          gameId,
          (game as any).seq || 0,
          "nextTurn",
          { by: playerId }
        );
      } catch (e) {
        debugWarn(1, "appendEvent(nextTurn) failed", e);
      }

      // Optional: bump seq if your ctx.bumpSeq isn't already doing it inside nextTurn
      if (typeof (game as any).bumpSeq === "function") {
        try {
          (game as any).bumpSeq();
        } catch {
          /* ignore */
        }
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `Turn advanced. Active player: ${getPlayerName(game, game.state.turnPlayer)}`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `nextTurn error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "NEXT_TURN_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Next step handler
  // Per MTG rules, "next step" should pass priority. The step only advances
  // when ALL players pass priority in succession with an empty stack.
  socket.on("nextStep", async ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Debug logging
      try {
        debug(1, 
          `[nextStep] request from player=${playerId} game=${gameId} turnPlayer=${
            game.state?.turnPlayer
          } step=${String(game.state?.step)} stack=${
            (game.state?.stack || []).length
          } phase=${String(game.state?.phase)}`
        );
      } catch {
        /* ignore */
      }

      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      const pregame =
        phaseStr === "" ||
        phaseStr === "PRE_GAME" ||
        phaseStr.includes("BEGIN");

      // During pre-game, check that all players have imported their decks
      if (pregame) {
        const { allHaveDecks, waitingPlayers: deckWaiters } = checkAllPlayersHaveDecks(game);
        if (!allHaveDecks && deckWaiters.length > 0) {
          socket.emit("error", {
            code: "PREGAME_DECKS_NOT_LOADED",
            message: `Waiting for player(s) to import their deck: ${deckWaiters.join(", ")}`,
          });
          debug(1, 
            `[nextStep] rejected - not all players have decks (waiting: ${deckWaiters.join(", ")})`
          );
          return;
        }

        // Check that all players have kept their hands before allowing transition
        const { allKept, waitingPlayers } = checkAllPlayersKeptHands(game);
        if (!allKept && waitingPlayers.length > 0) {
          socket.emit("error", {
            code: "PREGAME_HANDS_NOT_KEPT",
            message: `Waiting for player(s) to keep their hand: ${waitingPlayers.join(", ")}`,
          });
          debug(1, 
            `[nextStep] rejected - not all players kept hands (waiting: ${waitingPlayers.join(", ")})`
          );
          return;
        }
        
        // During pre-game, directly advance to start the game
        // (no priority passing needed during pre-game setup)
        try {
          if (typeof (game as any).nextStep === "function") {
            await (game as any).nextStep();
            debug(2, 
              `[nextStep] Pre-game: advanced step for game ${gameId}`
            );
          }
        } catch (e) {
          debugError(1, "nextStep: game.nextStep invocation failed:", e);
          socket.emit("error", {
            code: "NEXT_STEP_IMPL_ERROR",
            message: String(e),
          });
          return;
        }
        
        try {
          appendEvent(
            gameId,
            (game as any).seq || 0,
            "nextStep",
            { by: playerId, pregame: true }
          );
        } catch (e) {
          debugWarn(1, "appendEvent(nextStep) failed", e);
        }
        
        broadcastGame(io, game, gameId);
        return;
      }

      const playersArr: any[] =
        game.state && Array.isArray(game.state.players)
          ? game.state.players
          : [];

      // For single-player games, directly advance
      if (playersArr.length <= 1) {
        if (!game.state.turnPlayer) {
          game.state.turnPlayer = playerId;
        }
        
        // Check for empty stack
        if (game.state.stack && game.state.stack.length > 0) {
          socket.emit("error", {
            code: "NEXT_STEP",
            message: "Cannot advance step while the stack is not empty.",
          });
          return;
        }
        
        try {
          if (typeof (game as any).nextStep === "function") {
            await (game as any).nextStep();
            debug(2, 
              `[nextStep] Single-player: advanced step for game ${gameId}`
            );
          }
        } catch (e) {
          debugError(1, "nextStep: game.nextStep invocation failed:", e);
          return;
        }
        
        try {
          appendEvent(gameId, (game as any).seq || 0, "nextStep", { by: playerId });
        } catch (e) {
          debugWarn(1, "appendEvent(nextStep) failed", e);
        }
        
        broadcastGame(io, game, gameId);
        return;
      }

      // Multi-player: "Next Step" should pass priority
      // The step will advance when all players pass in succession
      
      // Check if player has priority
      if (game.state.priority !== playerId) {
        socket.emit("error", {
          code: "NOT_YOUR_PRIORITY",
          message: "You don't have priority. Wait for your turn to pass.",
        });
        debug(1, 
          `[nextStep] rejected - not player's priority (player=${playerId} priority=${game.state.priority})`
        );
        return;
      }

      // Pass priority (this handles step advancement when all pass)
      const { changed, resolvedNow, advanceStep } = game.passPriority(playerId);
      if (!changed) return;

      appendGameEvent(game, gameId, "passPriority", { by: playerId, viaNextStep: true });

      if (resolvedNow) {
        // Capture the top spell before it resolves
        const stackBefore = game.state?.stack || [];
        const topItem = stackBefore.length > 0 ? stackBefore[stackBefore.length - 1] : null;
        
        if (typeof (game as any).resolveTopOfStack === 'function') {
          (game as any).resolveTopOfStack();
          debug(2, `[nextStep] Stack resolved for game ${gameId}`);
          
          checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
          checkColorChoiceForNewPermanents(io, game, gameId);
          checkPlayerSelectionForNewPermanents(io, game, gameId);
          checkEnchantmentETBTriggers(io, game, gameId);
        }
        appendGameEvent(game, gameId, "resolveTopOfStack");
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: "Top of stack resolved.",
          ts: Date.now(),
        });
        
        // Process any cascade triggers
        await processPendingCascades(io, game, gameId);
        
        // Process any pending scry effects
        processPendingScry(io, game, gameId);
        
        // Process any pending proliferate effects
        processPendingProliferate(io, game, gameId);
        
        // Process any pending ponder effects
        processPendingPonder(io, game, gameId);
      }

      // If all players passed priority with empty stack, advance to next step
      if (advanceStep) {
        if (typeof (game as any).nextStep === 'function') {
          (game as any).nextStep();
          debug(2, `[nextStep] All players passed priority - advanced to next step for game ${gameId}`);
          
          appendGameEvent(game, gameId, "nextStep", { reason: 'allPlayersPassed' });
          
          const newStep = (game.state as any)?.step || 'unknown';
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `Step advanced to ${newStep}.`,
            ts: Date.now(),
          });
          
          // Check if the new step triggered auto-pass that wants to advance again
          // This handles the case where entering a step grants priority, but all players auto-pass
          let autoPassLoopCount = 0;
          const MAX_AUTO_PASS_LOOPS = 20; // Safety limit to prevent infinite loops
          
          while (autoPassLoopCount < MAX_AUTO_PASS_LOOPS) {
            const autoPassResult = (game.state as any)?._autoPassResult;
            
            if (autoPassResult?.allPassed && autoPassResult?.advanceStep) {
              debug(2, `[nextStep] Auto-pass detected after step advancement (iteration ${autoPassLoopCount + 1}), advancing again`);
              
              // Clear the flag before calling nextStep
              delete (game.state as any)._autoPassResult;
              
              // Advance to the next step
              (game as any).nextStep();
              
              const newStep2 = (game.state as any)?.step || 'unknown';
              debug(2, `[nextStep] Auto-advanced to ${newStep2}`);
              
              autoPassLoopCount++;
            } else {
              // No more auto-pass, break the loop
              break;
            }
          }
          
          if (autoPassLoopCount >= MAX_AUTO_PASS_LOOPS) {
            debugWarn(2, `[nextStep] Auto-pass loop limit reached (${MAX_AUTO_PASS_LOOPS}), stopping to prevent infinite loop`);
          }
          
          // Clear any remaining auto-pass flag
          delete (game.state as any)._autoPassResult;
        }
      }

      broadcastGame(io, game, gameId);
      
      // Check for pending damage triggers
      checkAndEmitDamageTriggers(io, game, gameId);
    } catch (err: any) {
      debugError(1, `nextStep error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "NEXT_STEP_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Skip to a specific phase (used when player wants to skip combat entirely)
  // This allows jumping from pre-combat to post-combat without going through combat steps
  // IMPORTANT: This also handles turn-based actions when skipping phases:
  // - Untapping when skipping from UNTAP
  // - Drawing a card when skipping from before DRAW to MAIN1 or later
  socket.on("skipToPhase", async ({ gameId, targetPhase, targetStep }: { 
    gameId: string; 
    targetPhase: string;
    targetStep: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const currentPhase = String(game.state?.phase || "").toLowerCase();
      const currentStep = String(game.state?.step || "").toUpperCase();
      const turnPlayer = game.state.turnPlayer;

      // Debug logging
      try {
        debug(1, 
          `[skipToPhase] request from player=${playerId} game=${gameId} turnPlayer=${turnPlayer} currentPhase=${currentPhase} currentStep=${currentStep} targetPhase=${targetPhase} targetStep=${targetStep}`
        );
      } catch {
        /* ignore */
      }

      // Only active player may skip phases
      if (turnPlayer && turnPlayer !== playerId) {
        socket.emit("error", {
          code: "SKIP_TO_PHASE",
          message: "Only the active player can skip to a phase.",
        });
        return;
      }

      // Ensure stack is empty
      if (game.state.stack && game.state.stack.length > 0) {
        socket.emit("error", {
          code: "SKIP_TO_PHASE",
          message: "Cannot skip phases while the stack is not empty.",
        });
        return;
      }

      // Ensure there are no pending Resolution Queue interactions that need to be resolved
      const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
      if (queueSummary.hasPending) {
        socket.emit("error", {
          code: "SKIP_TO_PHASE",
          message: "Cannot skip phases while there are pending interactions. Resolve them first.",
        });
        return;
      }

      // ========================================================================
      // CRITICAL FIX: Check if we're skipping through phases with triggers.
      // We must stop at each phase that has triggers, fire them in the correct
      // phase, and wait for them to resolve before continuing.
      // This applies to: UPKEEP, BEGIN_COMBAT, and END_STEP
      // ========================================================================
      const currentPhaseOrder = ['untap', 'upkeep', 'draw', 'main1', 'begin_combat', 'declare_attackers', 
                                 'declare_blockers', 'combat_damage', 'end_combat', 'main2', 'end_step', 'cleanup'];
      const currentStepNormalized = currentStep.toLowerCase().replace(/_/g, '');
      const targetStepNormalized = targetStep.toLowerCase().replace(/_/g, '');
      const currentIdx = currentPhaseOrder.indexOf(currentStepNormalized);
      const targetIdx = currentPhaseOrder.indexOf(targetStepNormalized);
      
      // Helper function to stop at a specific phase and process triggers
      const stopAtPhaseForTriggers = (
        stopPhase: string,
        stopStep: string,
        triggers: any[],
        triggerType: string
      ) => {
        const ctxForInterveningIf = { state: game.state } as any;
        const battlefield = (game.state as any)?.battlefield || [];

        // Defensive: filter triggers by intervening-if at trigger time BEFORE we decide to stop.
        // If upstream trigger detection already filtered, this is a no-op.
        const filteredTriggers = (triggers || []).filter((t: any) => {
          try {
            const controller = String(t?.controllerId || turnPlayer || playerId || '').trim();
            const raw = String(t?.description || t?.effect || '').trim();
            let text = raw;
            if (text && !/^(?:when|whenever|at)\b/i.test(text)) {
              const tt = String(t?.triggerType || triggerType || stopStep || '').toLowerCase();
              if (tt.includes('upkeep')) {
                text = `At the beginning of upkeep, ${text}`;
              } else if (tt.includes('draw')) {
                text = `At the beginning of draw step, ${text}`;
              } else if (tt.includes('begin_combat') || tt.includes('begincombat') || stopStep === 'begin_combat') {
                text = `At the beginning of combat, ${text}`;
              } else if (tt.includes('end_step') || tt.includes('endstep') || stopStep === 'end_step') {
                text = `At the beginning of end step, ${text}`;
              }
            }
            const sourcePerm = battlefield.find((p: any) => p?.id === t?.permanentId);
            const thatPlayerId = String(turnPlayer || playerId || '').trim();
            const needsThatPlayerRef = /\bthat player\b/i.test(text);
            const ok = isInterveningIfSatisfied(
              ctxForInterveningIf,
              controller,
              text,
              sourcePerm,
              needsThatPlayerRef && thatPlayerId
                ? {
                    thatPlayerId,
                    referencedPlayerId: thatPlayerId,
                    theirPlayerId: thatPlayerId,
                  }
                : undefined
            );
            return ok !== false;
          } catch {
            // Conservative fallback: keep the trigger if evaluation fails.
            return true;
          }
        });

        if (filteredTriggers.length === 0) return;

        debug(2, `[skipToPhase] STOPPING at ${stopStep}: Found ${filteredTriggers.length} trigger(s) that must resolve first`);
        
        // Stop at this phase instead of going directly to target
        (game.state as any).phase = stopPhase;
        (game.state as any).step = stopStep;
        
        // Store the intended target so we can continue after triggers resolve
        (game.state as any).pendingPhaseSkip = {
          targetPhase,
          targetStep,
          requestedBy: playerId,
        };
        
        // Process the triggers
        (game.state as any).stack = (game.state as any).stack || [];
        
        // Group triggers by controller for APNAP ordering
        const triggersByController = new Map<string, typeof triggers>();
        for (const trigger of filteredTriggers) {
          const controller = trigger.controllerId || turnPlayer;
          const existing = triggersByController.get(controller) || [];
          existing.push(trigger);
          triggersByController.set(controller, existing);
        }
        
        // Get player order for APNAP
        const players = Array.isArray((game.state as any).players) 
          ? (game.state as any).players.map((p: any) => p.id) 
          : [];
        const orderedPlayers = [turnPlayer, ...players.filter((p: string) => p !== turnPlayer)];
        
        // Process triggers in APNAP order
        for (const playerId of orderedPlayers) {
          if (!playerId) continue;

          const playerTriggers = triggersByController.get(playerId) || [];
          if (playerTriggers.length === 0) continue;
          
          // If multiple triggers, use Resolution Queue for ordering
          if (playerTriggers.length > 1) {
            const triggerItems = playerTriggers.map((trigger: any) => {
              const triggerId = uid(`${triggerType}_trigger`);
              return {
                id: triggerId,
                sourceId: trigger.permanentId,
                sourceName: trigger.cardName,
                effect: trigger.description || trigger.effect,
                triggerType: triggerType,
                mandatory: trigger.mandatory !== false,
                imageUrl: trigger.imageUrl,
              };
            });
            
            // Add all triggers to the stack first
            for (const item of triggerItems) {
              (game.state as any).stack.push({
                id: item.id,
                type: 'triggered_ability',
                controller: playerId,
                source: item.sourceId,
                sourceName: item.sourceName,
                description: item.effect,
                triggerType,
                mandatory: item.mandatory,
                effect: item.effect,
              });
            }
            
            // Add Resolution Queue step for trigger ordering
            ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.TRIGGER_ORDER,
              playerId: playerId as PlayerID,
              description: `Choose the order to put ${triggerItems.length} triggered abilities on the stack`,
              mandatory: true,
              triggers: triggerItems.map((item: any) => ({
                id: item.id,
                sourceName: item.sourceName,
                effect: item.effect,
                imageUrl: item.imageUrl,
              })),
              requireAll: true,
            });
            
            debug(2, `[skipToPhase] Added TRIGGER_ORDER step for ${playerId} with ${triggerItems.length} triggers`);
          } else {
            // Single trigger - push directly to stack
            const trigger = playerTriggers[0];
            const triggerId = uid(`${triggerType}_trigger`);
            (game.state as any).stack.push({
              id: triggerId,
              type: 'triggered_ability',
              controller: playerId,
              source: trigger.permanentId,
              sourceName: trigger.cardName,
              description: trigger.description || trigger.effect,
              triggerType: triggerType,
              mandatory: trigger.mandatory !== false,
              effect: trigger.effect,
            });
          }
        }
        
        // Give priority to active player
        (game.state as any).priority = turnPlayer;
        
        debug(2, `[skipToPhase] Set phase to ${stopStep} with ${filteredTriggers.length} trigger(s). Will continue to ${targetStep} after resolution.`);
        
        // Broadcast the updated game state
        broadcastGame(io, game, gameId);
        
        // Append skipToPhase event
        try {
          appendEvent(gameId, (game as any).seq || 0, "skipToPhase", {
            playerId,
            from: currentStep,
            to: stopStep,
            finalTarget: targetStep,
          });
        } catch (e) {
          debugWarn(1, "appendEvent(skipToPhase) failed:", e);
        }
      };
      
      // Check UPKEEP triggers if we're skipping through upkeep
      const upkeepIdx = currentPhaseOrder.indexOf('upkeep');
      const isBeforeUpkeep = currentIdx < upkeepIdx || currentStepNormalized === '';
      const isTargetAfterUpkeep = targetIdx > upkeepIdx;
      const isSkippingThroughUpkeep = isBeforeUpkeep && isTargetAfterUpkeep && targetStepNormalized !== 'upkeep';
      
      if (isSkippingThroughUpkeep && turnPlayer) {
        try {
          // Auto-process cumulative upkeep mana effects (Braid of Fire, etc.) FIRST
          const processedMana = autoProcessCumulativeUpkeepMana(game as any, turnPlayer);
          if (processedMana.length > 0) {
            for (const item of processedMana) {
              const manaStr = Object.entries(item.manaAdded)
                .map(([type, amount]) => `${amount} ${type}`)
                .join(', ');
              io.to(gameId).emit('chat', {
                id: `m_${Date.now()}_${item.permanentId}`,
                gameId,
                from: 'system',
                message: `${item.cardName}: Added ${manaStr} to ${getPlayerName(game, turnPlayer)}'s mana pool (${item.ageCounters} age counters)`,
                ts: Date.now(),
              });
            }
          }
          
          const upkeepTriggers = getUpkeepTriggersForPlayer(game as any, turnPlayer);
          if (upkeepTriggers && upkeepTriggers.length > 0) {
            stopAtPhaseForTriggers('beginning', 'UPKEEP', upkeepTriggers, 'upkeep');
            return; // Exit early - triggers must be resolved before continuing
          }
        } catch (err) {
          debugWarn(1, `[skipToPhase] Failed to check upkeep triggers:`, err);
        }
      }
      
      // Check BEGIN_COMBAT triggers if we're skipping through combat
      const beginCombatIdx = currentPhaseOrder.indexOf('begin_combat');
      const isBeforeCombat = currentIdx < beginCombatIdx || currentStepNormalized === '';
      const isTargetCombatOrLater = targetIdx >= beginCombatIdx;
      const isSkippingThroughCombat = isBeforeCombat && isTargetCombatOrLater && targetStepNormalized !== 'begincombat';
      
      if (isSkippingThroughCombat && turnPlayer) {
        try {
          const combatTriggers = getBeginningOfCombatTriggers(game as any, turnPlayer);
          if (combatTriggers && combatTriggers.length > 0) {
            stopAtPhaseForTriggers('combat', 'BEGIN_COMBAT', combatTriggers, 'begin_combat');
            return; // Exit early - triggers must be resolved before continuing
          }
        } catch (err) {
          debugWarn(1, `[skipToPhase] Failed to check combat triggers:`, err);
        }
      }
      
      // =======================================================================
      // GOAD ENFORCEMENT (Rule 701.15b): Cannot skip past declare attackers
      // if the player has goaded creatures that must attack.
      // Goaded creatures MUST attack if able - the player cannot skip combat.
      // =======================================================================
      const declareAttackersIdx = currentPhaseOrder.indexOf('declare_attackers');
      const isBeforeDeclareAttackers = currentIdx < declareAttackersIdx;
      const isTargetAfterDeclareAttackers = targetIdx > declareAttackersIdx;
      const isSkippingPastCombat = isBeforeDeclareAttackers && isTargetAfterDeclareAttackers;
      
      if (isSkippingPastCombat && turnPlayer) {
        try {
          // Check for goaded creatures that must attack
          const battlefield = (game.state as any)?.battlefield || [];
          const currentTurn = (game.state as any).turn;
          
          for (const permanent of battlefield) {
            if (!permanent || permanent.controller !== turnPlayer) continue;
            
            const typeLine = (permanent.card?.type_line || "").toLowerCase();
            if (!typeLine.includes("creature")) continue;
            
            // Check if creature is goaded
            const goadedBy = permanent.goadedBy;
            if (!goadedBy || !Array.isArray(goadedBy) || goadedBy.length === 0) continue;
            
            // Check if goad is still active
            const goadedUntil = permanent.goadedUntil || {};
            const isGoaded = goadedBy.some((goaderId: string) => {
              const expiryTurn = goadedUntil[goaderId];
              return expiryTurn === undefined || expiryTurn > currentTurn;
            });
            
            if (!isGoaded) continue;
            
            // Can't attack if tapped
            if (permanent.tapped) continue;
            
            // Can't attack with summoning sickness (unless haste)
            const enteredThisTurn = permanent.enteredThisTurn === true;
            if (enteredThisTurn) {
              const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
              const grantedAbilities = permanent.grantedAbilities || [];
              const hasHaste = oracleText.includes("haste") || 
                              grantedAbilities.some((a: string) => a && a.toLowerCase().includes("haste"));
              if (!hasHaste) continue;
            }
            
            // Check for "can't attack" effects
            const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
            const grantedAbilities = permanent.grantedAbilities || [];
            
            if (oracleText.includes("can't attack") || oracleText.includes("cannot attack")) continue;
            
            const hasCantAttack = grantedAbilities.some((a: string) => {
              const abilityText = (a || "").toLowerCase();
              return abilityText.includes("can't attack") || abilityText.includes("cannot attack");
            });
            if (hasCantAttack) continue;
            
            // Found a goaded creature that CAN and MUST attack
            const creatureName = permanent.card?.name || "A creature";
            debug(2, `[skipToPhase] BLOCKED: ${creatureName} is goaded and must attack (Rule 701.15b)`);
            socket.emit("error", {
              code: "SKIP_TO_PHASE",
              message: `${creatureName} is goaded and must attack this combat. You cannot skip past the declare attackers step.`,
            });
            return; // Exit early - cannot skip past combat with goaded creatures
          }
        } catch (err) {
          debugWarn(1, `[skipToPhase] Failed to check goaded creatures:`, err);
        }
      }
      
      // Check END_STEP triggers if we're skipping to end step
      const endStepIdx = currentPhaseOrder.indexOf('end_step');
      const isBeforeEndStep = currentIdx < endStepIdx;
      const isTargetEndStepOrLater = targetIdx >= endStepIdx;
      const isSkippingToEndStep = isBeforeEndStep && (targetStepNormalized === 'endstep' || targetStepNormalized === 'end');
      
      if (isSkippingToEndStep && turnPlayer) {
        try {
          const endTriggers = getEndStepTriggers(game as any, turnPlayer);
          if (endTriggers && endTriggers.length > 0) {
            stopAtPhaseForTriggers('ending', 'END_STEP', endTriggers, 'end_step');
            return; // Exit early - triggers must be resolved before continuing
          }
        } catch (err) {
          debugWarn(1, `[skipToPhase] Failed to check end step triggers:`, err);
        }
      }

      // If we reach here, either we're not skipping through combat, or there were no triggers
      // Update phase and step directly to target
      (game.state as any).phase = targetPhase;
      (game.state as any).step = targetStep;
      
      // Clear any pending skip since we've reached the target
      delete (game.state as any).pendingPhaseSkip;
			// Mark that we just arrived here via skipToPhase so automation/auto-pass
			// can give the active player one full priority window at this step
		try {
			(game.state as any).justSkippedToPhase = {
			playerId: playerId,
			phase: targetPhase,
			step: targetStep,
			};
			} catch {
			// best-effort; don't fail skipToPhase if this metadata write fails
			}
      // Determine if we need to execute turn-based actions when skipping phases
      // This ensures that skipping from early phases to main phases still triggers
      // the appropriate untap and draw actions
      const targetStepUpper = targetStep.toUpperCase();
      const targetPhaseLower = targetPhase.toLowerCase();
      
      // Check if we're in the beginning phase and skipping to a main phase
      const wasBeginningPhase = currentPhase === "beginning" || currentPhase === "pre_game" || currentPhase === "";
      const isTargetMainPhase = targetPhaseLower.includes("main") || targetStepUpper === "MAIN1" || targetStepUpper === "MAIN2";
      
      // Determine what actions need to be executed based on what we're skipping over
      const needsUntap = wasBeginningPhase && 
        (currentStep === "" || currentStep === "UNTAP") && 
        (targetStepUpper !== "UNTAP");
      
      const needsDraw = wasBeginningPhase && 
        (currentStep === "" || currentStep === "UNTAP" || currentStep === "UPKEEP") && 
        (isTargetMainPhase || targetStepUpper === "BEGIN_COMBAT" || targetStepUpper === "DECLARE_ATTACKERS");

      // Execute untap if needed
      if (needsUntap && turnPlayer) {
        try {
          // Untap all permanents controlled by the turn player
          const battlefield = (game.state as any)?.battlefield || [];
          let untappedCount = 0;
          for (const permanent of battlefield) {
            if (permanent && permanent.controller === turnPlayer && permanent.tapped) {
              // Check for "doesn't untap" effects
              if (!permanent.doesntUntap) {
                permanent.tapped = false;
                untappedCount++;
              }
            }
          }
          if (untappedCount > 0) {
            debug(2, `[skipToPhase] Untapped ${untappedCount} permanent(s) for ${turnPlayer}`);
          }
        } catch (err) {
          debugWarn(1, `[skipToPhase] Failed to untap permanents:`, err);
        }
      }

      // Execute draw if needed
      if (needsDraw && turnPlayer) {
        try {
          if (typeof (game as any).drawCards === "function") {
            // Recalculate player effects to ensure additional draws from Howling Mine, etc. are counted
            // This is important when skipping phases because the effects may not have been calculated yet
            try {
              recalculatePlayerEffects(game as any, turnPlayer);
            } catch (recalcErr) {
              debugWarn(1, `[skipToPhase] Failed to recalculate player effects:`, recalcErr);
            }
            
            // Calculate total cards to draw: 1 (base) + any additional draws from effects
            const additionalDraws = (game as any).additionalDrawsPerTurn?.[turnPlayer] || 0;
            const totalDraws = 1 + additionalDraws;
            
            const drawn = (game as any).drawCards(turnPlayer, totalDraws);
            debug(2, 
              `[skipToPhase] Drew ${drawn?.length || totalDraws} card(s) for ${turnPlayer} (skipped from ${currentStep} to ${targetStep}, additional: ${additionalDraws})`
            );
            
            // Check for miracle on the first drawn card
            if (Array.isArray(drawn) && drawn.length > 0) {
              checkAndPromptMiracle(io, game, gameId, turnPlayer, drawn);
            }
            
            // Persist the draw event
            try {
              appendEvent(gameId, (game as any).seq || 0, "drawCards", { 
                playerId: turnPlayer, 
                count: totalDraws,
                reason: "skipToPhase"
              });
            } catch (e) {
              debugWarn(1, "appendEvent(drawCards) failed:", e);
            }
          }
        } catch (err) {
          debugWarn(1, `[skipToPhase] Failed to draw card:`, err);
        }
      }

      // ========================================================================
      // CRITICAL: Process triggers for phases we're skipping through
      // NOTE: UPKEEP, BEGIN_COMBAT, and END_STEP triggers are now handled EARLIER
      // in the skipToPhase flow (before the phase is updated) to ensure they fire
      // in the correct phase rather than the target phase.
      // See lines ~4100-4230 for the new trigger handling that stops at each phase.
      // ========================================================================

      // Clear any combat state since we're skipping combat
      try {
        // Set combat to undefined rather than deleting for better performance
        (game.state as any).combat = undefined;
        
        // Clear attacking/blocking states from permanents
        const battlefield = (game.state as any)?.battlefield;
        if (Array.isArray(battlefield)) {
          for (const permanent of battlefield) {
            if (!permanent) continue;
            // Set to undefined instead of deleting for better performance
            if (permanent.attacking !== undefined) permanent.attacking = undefined;
            if (permanent.blocking !== undefined) permanent.blocking = undefined;
            if (permanent.blockedBy !== undefined) permanent.blockedBy = undefined;
          }
        }
      } catch (err) {
        debugWarn(1, `[skipToPhase] Failed to clear combat state:`, err);
      }

      // CRITICAL: Reset priority tracking after skipping to a new phase
      // This prevents the auto-pass cascade where:
      // 1. Player uses skipToPhase to go to a specific step
      // 2. Client has auto-pass enabled, sees priority, sends passPriority immediately
      // 3. Server (single-player mode) auto-advances to next step
      // 4. Repeat until end of turn
      // 
      // By resetting priorityPassedBy and ensuring priority is with the active player,
      // we give the player a chance to act before any auto-advancement occurs.
      try {
        // Reset the priority tracking set
        (game.state as any).priorityPassedBy = new Set<string>();
        
        // Ensure priority is with the turn player after skipping
        if (turnPlayer) {
          (game.state as any).priority = turnPlayer;
        }
        
        debug(2, `[skipToPhase] Reset priority tracking, priority set to ${turnPlayer}`);
      } catch (err) {
        debugWarn(1, `[skipToPhase] Failed to reset priority tracking:`, err);
      }

      // Handle CLEANUP phase specially - need to check for discard and auto-advance to next turn
      const isCleanupPhase = targetStepUpper === "CLEANUP";
      let queuedCleanupDiscard = false;

      if (isCleanupPhase && turnPlayer) {
        // Rule 514.1: Check if the active player needs to discard to maximum hand size
        try {
          const zones = game.state?.zones?.[turnPlayer];
          const hand = Array.isArray(zones?.hand) ? zones.hand : [];
          // Use getMaxHandSizeForPlayer to properly check for "no maximum hand size" effects
          // like Reliquary Tower, Thought Vessel, Spellbook, etc.
          const maxHandSize = getMaxHandSizeForPlayer(game.state, turnPlayer);
          
          // If max hand size is Infinity, no discard needed
          if (maxHandSize === Infinity) {
            debug(2, `[skipToPhase] Player ${turnPlayer} has no maximum hand size effect`);
          } else {
            const discardCount = Math.max(0, hand.length - maxHandSize);

            if (discardCount > 0) {
              const handOptions = hand
                .filter((c: any) => c && c.id)
                .map((c: any) => ({
                  id: String(c.id),
                  label: String(c.name || 'Unknown'),
                  imageUrl: c.imageUrl || c.image_url || c.image_uris?.normal,
                }));

              if (handOptions.length > 0) {
                ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.DISCARD_SELECTION,
                  playerId: turnPlayer as any,
                  sourceName: 'Cleanup Step',
                  description: `Cleanup: discard ${discardCount} card(s) to maximum hand size (${maxHandSize}).`,
                  mandatory: true,
                  hand: handOptions,
                  discardCount,
                  currentHandSize: handOptions.length,
                  maxHandSize,
                  reason: 'cleanup',
                  priority: -10,
                } as any);
                queuedCleanupDiscard = true;
                debug(2, `[skipToPhase] Queued cleanup discard step for ${turnPlayer}: discard ${discardCount}`);
              } else {
                debugWarn(1, `[skipToPhase] Cannot queue cleanup discard step - hand is empty/unknown for ${turnPlayer}`);
              }
            }
          }
        } catch (err) {
          debugWarn(1, `[skipToPhase] Failed to check discard during cleanup:`, err);
        }

        // If no discard needed, clear damage from permanents and advance via normal nextStep logic
        if (!queuedCleanupDiscard) {
          try {
            // Rule 514.2: Clear damage from all permanents
            const battlefield = (game.state as any)?.battlefield;
            if (Array.isArray(battlefield)) {
              for (const permanent of battlefield) {
                if (permanent && typeof permanent.damage === 'number' && permanent.damage > 0) {
                  permanent.damage = 0;
                }
              }
            }
            debug(2, `[skipToPhase] Cleared damage from permanents during cleanup`);
          } catch (err) {
            debugWarn(1, `[skipToPhase] Failed to clear damage during cleanup:`, err);
          }

          // Auto-advance through cleanup using the canonical turn logic (handles EOT cleanup and Sundial pause)
          try {
            if (typeof (game as any).nextStep === "function") {
              (game as any).nextStep();
              debug(2, `[skipToPhase] Cleanup complete, advanced via nextStep for game ${gameId}`);
            }
          } catch (err) {
            debugWarn(1, `[skipToPhase] Failed to advance after cleanup:`, err);
          }
        }
      }

      // Bump sequence
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      // Persist event
      try {
        appendEvent(
          gameId,
          (game as any).seq || 0,
          "skipToPhase",
          { by: playerId, targetPhase, targetStep }
        );
      } catch (e) {
        debugWarn(1, "appendEvent(skipToPhase) failed", e);
      }

      debug(2, 
        `[skipToPhase] Skipped to phase=${targetPhase}, step=${targetStep} for game ${gameId}`
      );

      // Different message based on whether we're going to cleanup or regular phase
      const chatMessage = isCleanupPhase 
        ? (queuedCleanupDiscard 
            ? `${getPlayerName(game, playerId)} moved to cleanup. Discard to hand size.`
            : `${getPlayerName(game, playerId)} ended their turn.`)
        : `${getPlayerName(game, playerId)} skipped to ${targetPhase} phase.`;

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: chatMessage,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `skipToPhase error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "SKIP_TO_PHASE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Shuffle player's hand (server-authoritative) ΓÇö randomize order of cards in hand.
  socket.on("shuffleHand", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      const spectator = socket.data.spectator;
      if (!game || !playerId || spectator) return;

      try {
        // Use the engine's shuffleHand method
        if (typeof (game as any).shuffleHand === "function") {
          (game as any).shuffleHand(playerId);
          debug(2, 
            `[shuffleHand] Shuffled hand for player ${playerId} in game ${gameId}`
          );
        } else {
          // Fallback to direct manipulation if engine method not available
          debugWarn(1, 
            `[shuffleHand] game.shuffleHand not available, using fallback for game ${gameId}`
          );
          game.state = (game.state || {}) as any;
          game.state.zones = game.state.zones || {};
          const zones = game.state.zones[playerId] || null;
          if (!zones || !Array.isArray(zones.hand)) {
            socket.emit("error", {
              code: "SHUFFLE_HAND_NO_HAND",
              message: "No hand to shuffle.",
            });
            return;
          }

          // Fisher-Yates shuffle of the hand array
          const arr = zones.hand;
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
          }
          // Ensure handCount remains accurate
          zones.handCount = Array.isArray(zones.hand)
            ? zones.hand.length
            : zones.handCount || 0;
        }

        appendGameEvent(game, gameId, "shuffleHand", { playerId });

        // Ensure sequence is bumped before broadcasting to trigger client re-renders
        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }

        broadcastGame(io, game, gameId);
      } catch (e) {
        debugError(1, "shuffleHand failed:", e);
        socket.emit("error", {
          code: "SHUFFLE_HAND_ERROR",
          message: String(e),
        });
      }
    } catch (err) {
      debugError(1, "shuffleHand handler error:", err);
    }
  });

  // Reorder player's hand based on drag-and-drop
  socket.on(
    "reorderHand",
    ({ gameId, order }: { gameId: string; order: string[] }) => {
      try {
        const game = ensureGame(gameId);
        const playerId = socket.data.playerId;
        const spectator = socket.data.spectator;
        if (!game || !playerId || spectator) return;

        debug(1, 
          "[reorderHand] Received request for game",
          gameId,
          ", order length:",
          order.length
        );
        debug(1, 
          "[reorderHand] playerId:",
          playerId,
          ", spectator:",
          spectator,
          ", game exists:",
          !!game
        );

        if (!Array.isArray(order) || order.length === 0) {
          socket.emit("error", {
            code: "REORDER_HAND_BAD_ORDER",
            message: "Invalid hand order payload.",
          });
          return;
        }

        // Prefer engine viewFor, fall back to raw state zones
        let view: any;
        try {
          view =
            typeof (game as any).viewFor === "function"
              ? (game as any).viewFor(playerId, false)
              : (game as any).state;
        } catch {
          view = (game as any).state;
        }

        const zonesFromView = view?.zones || {};
        const zView = zonesFromView[playerId];
        let hand: any[] = Array.isArray(zView?.hand) ? zView.hand : [];

        // Fallback: if view hand is empty but state.zones has a hand, use that
        if (!hand.length) {
          try {
            (game as any).state = (game as any).state || {};
            (game as any).state.zones = (game as any).state.zones || {};
            const zState = (game as any).state.zones[playerId];
            if (zState && Array.isArray(zState.hand) && zState.hand.length) {
              hand = zState.hand;
              debug(1, 
                "[reorderHand] Fallback to state.zones hand, length:",
                hand.length
              );
            }
          } catch {
            // ignore fallback errors
          }
        }

        debug(1, 
          "[reorderHand] Current hand length:",
          hand.length,
          ", order length:",
          order.length
        );

        if (!hand.length) {
          debugWarn(2, "[reorderHand] No hand found for player", playerId);
          socket.emit("error", {
            code: "REORDER_HAND_NO_HAND",
            message: "No hand to reorder.",
          });
          return;
        }

        // Map IDs to indices in current hand
        const idToIndex = new Map<string, number>();
        hand.forEach((c, idx) => {
          if (c && c.id) idToIndex.set(c.id, idx);
        });

        const indexOrder: number[] = [];
        for (const id of order) {
          const idx = idToIndex.get(id);
          if (idx === undefined) {
            debugWarn(1, 
              "[reorderHand] ID from client not found in hand:",
              id
            );
            socket.emit("error", {
              code: "REORDER_HAND_BAD_ORDER",
              message:
                "Supplied hand order does not match current hand contents.",
            });
            return;
          }
          indexOrder.push(idx);
        }

        if (typeof (game as any).reorderHand === "function") {
          (game as any).reorderHand(playerId, indexOrder);
        } else {
          // Fallback: reorder a shadow hand in game.state.zones if needed
          try {
            (game as any).state = (game as any).state || {};
            (game as any).state.zones = (game as any).state.zones || {};
            const zState = (game as any).state.zones[playerId];
            if (zState && Array.isArray(zState.hand)) {
              const oldHand = zState.hand.slice();
              const newHand: any[] = [];
              indexOrder.forEach((oldIdx) => {
                if (oldIdx >= 0 && oldIdx < oldHand.length) {
                  newHand.push(oldHand[oldIdx]);
                }
              });
              if (newHand.length === oldHand.length) {
                zState.hand = newHand;
                zState.handCount = newHand.length;
              }
            }
          } catch (e) {
            debugWarn(1, 
              "[reorderHand] fallback reorder in state.zones failed",
              e
            );
          }
        }

        appendGameEvent(game, gameId, "reorderHand", {
          playerId,
          orderIndices: indexOrder,
        });
        broadcastGame(io, game, gameId);
      } catch (err: any) {
        debugError(1, "reorderHand handler error:", err);
        socket.emit("error", {
          code: "REORDER_HAND_ERROR",
          message: err?.message ?? String(err),
        });
      }
    }
  );

  // Set turn direction (+1 or -1)
  socket.on(
    "setTurnDirection",
    ({ gameId, direction }: { gameId: string; direction: 1 | -1 }) => {
      try {
        const game = ensureGame(gameId);
        game.setTurnDirection(direction);
        appendGameEvent(game, gameId, "setTurnDirection", { direction });
        broadcastGame(io, game, gameId);
      } catch (err: any) {
        socket.emit("error", {
          code: "TURN_DIRECTION_ERROR",
          message: err?.message ?? String(err),
        });
      }
    }
  );

  // Restart (keep roster/players)
  socket.on("restartGame", ({ gameId }) => {
    try {
      const game = ensureGame(gameId);
      game.reset(true);
      // Make restarted games start in PRE_GAME to be consistent
      try {
        game.state = (game.state || {}) as any;
        (game.state as any).phase = "pre_game";
      } catch {
        /* best effort */
      }
      appendEvent(gameId, game.seq, "restart", { preservePlayers: true });
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      socket.emit("error", {
        code: "RESTART_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Restart (clear roster/players)
  socket.on("restartGameClear", ({ gameId }) => {
    try {
      const game = ensureGame(gameId);
      game.reset(false);
      // Ensure cleared restart is PRE_GAME as well
      try {
        game.state = (game.state || {}) as any;
        (game.state as any).phase = "pre_game";
      } catch {
        /* best effort */
      }
      appendEvent(gameId, game.seq, "restart", { preservePlayers: false });
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      socket.emit("error", {
        code: "RESTART_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // ============================================================================
  // Mulligan Actions (Pre-Game Phase)
  // ============================================================================

  // Keep hand - player accepts their current hand
  // If mulligans were taken, this triggers the London Mulligan bottom selection
  socket.on("keepHand", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Allow keeping hand even if we've moved past PRE_GAME
      // This is needed because players might need to keep their hand after the game advances
      // (e.g., if the game moves to UNTAP before all hands are kept)
      const mulliganState = (game.state as any).mulliganState?.[playerId];
      
      // Check if player has already kept their hand
      if (mulliganState?.hasKeptHand) {
        socket.emit("error", {
          code: "ALREADY_KEPT",
          message: "You have already kept your hand",
        });
        return;
      }

      // If we already asked the player to put cards on bottom, avoid creating duplicate steps
      if (mulliganState?.pendingBottomCount && mulliganState.pendingBottomCount > 0) {
        socket.emit("error", {
          code: "PENDING_BOTTOM_SELECTION",
          message: "You must finish choosing cards to put on the bottom",
        });
        return;
      }

      // Get current mulligan count
      const mulligansTaken = mulliganState?.mulligansTaken || 0;
      
      // Calculate effective mulligan count based on house rules
      // This accounts for free first mulligan in multiplayer, group mulligan discount, etc.
      const effectiveMulliganCount = calculateEffectiveMulliganCount(mulligansTaken, game, playerId);

      // Track mulligan state - mark as pending bottom selection if mulligans were taken
      game.state = (game.state || {}) as any;
      (game.state as any).mulliganState = (game.state as any).mulliganState || {};
      
      if (effectiveMulliganCount > 0) {
        // London Mulligan: player must put back cards equal to effective number of mulligans
        // (after applying house rule discounts like free first mulligan or group mulligan)
        const zones = (game.state as any)?.zones?.[playerId];
        const hand = Array.isArray(zones?.hand) ? zones.hand : [];

        const resolutionStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.HAND_TO_BOTTOM,
          playerId,
          description: `London Mulligan: Put ${effectiveMulliganCount} card${effectiveMulliganCount > 1 ? 's' : ''} on the bottom of your library (random order).`,
          mandatory: true,
          cardsToBottom: effectiveMulliganCount,
          hand,
          reason: 'mulligan',
        });

        (game.state as any).mulliganState[playerId] = {
          hasKeptHand: false, // Not fully kept yet - need to put cards back
          mulligansTaken,
          pendingBottomCount: effectiveMulliganCount, // Cards to put to bottom after house rule discounts
          pendingBottomStepId: resolutionStep.id,
        };

        // Bump sequence
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }

        // Build message with house rule info
        let message = `${getPlayerName(game, playerId)} is choosing ${effectiveMulliganCount} card${effectiveMulliganCount > 1 ? 's' : ''} to put on the bottom of their library`;
        if (effectiveMulliganCount < mulligansTaken) {
          message += ` (${mulligansTaken - effectiveMulliganCount} free mulligan${mulligansTaken - effectiveMulliganCount > 1 ? 's' : ''})`;
        }
        message += '.';

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message,
          ts: Date.now(),
        });

        broadcastGame(io, game, gameId);
      } else {
        // No cards to put back (either no mulligans or all were free)
        (game.state as any).mulliganState[playerId] = {
          hasKeptHand: true,
          mulligansTaken,
        };

        // Bump sequence
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }

        // Persist the event
        try {
          appendEvent(gameId, (game as any).seq ?? 0, "keepHand", { playerId });
        } catch (e) {
          debugWarn(1, "appendEvent(keepHand) failed:", e);
        }

        let message = `${getPlayerName(game, playerId)} keeps their hand`;
        if (mulligansTaken > 0 && effectiveMulliganCount === 0) {
          message += ` (${mulligansTaken} free mulligan${mulligansTaken > 1 ? 's' : ''})`;
        }
        message += '.';

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message,
          ts: Date.now(),
        });

        // Check for opening hand actions (Leylines) and prompt if any exist
        checkAndPromptOpeningHandActions(io, game, gameId, playerId);

        broadcastGame(io, game, gameId);
      }
    } catch (err: any) {
      debugError(1, `keepHand error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "KEEP_HAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Mulligan - player shuffles hand back and draws a new hand (minus one card)
  socket.on("mulligan", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Check if we're in PRE_GAME phase
      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      if (phaseStr !== "" && phaseStr !== "PRE_GAME") {
        socket.emit("error", {
          code: "NOT_PREGAME",
          message: "Can only mulligan during pre-game",
        });
        return;
      }

      // Check if player has already kept their hand
      const mulliganState = (game.state as any).mulliganState?.[playerId];
      if (mulliganState?.hasKeptHand) {
        socket.emit("error", {
          code: "ALREADY_KEPT",
          message: "You have already kept your hand",
        });
        return;
      }

      // Get current mulligan count
      const currentMulligans = mulliganState?.mulligansTaken || 0;
      
      // Check if player can still mulligan (max 7 mulligans = 0 cards)
      if (currentMulligans >= 6) {
        socket.emit("error", {
          code: "MAX_MULLIGANS",
          message: "Cannot mulligan further - you would have 0 cards",
        });
        return;
      }

      // Check if this mulligan is free due to "no lands or all lands" house rule
      const isFreeNoLandsAllLands = shouldMulliganBeFree(game, playerId);
      
      // Track mulligan state
      game.state = (game.state || {}) as any;
      (game.state as any).mulliganState = (game.state as any).mulliganState || {};
      
      // If this mulligan is free due to no lands/all lands, don't increment the count
      const newMulliganCount = isFreeNoLandsAllLands ? currentMulligans : currentMulligans + 1;
      
      (game.state as any).mulliganState[playerId] = {
        hasKeptHand: false,
        mulligansTaken: newMulliganCount,
        // Track if the last mulligan was free (for display purposes)
        lastMulliganWasFree: isFreeNoLandsAllLands,
      };

      // Shuffle hand back into library and draw new hand
      try {
        // Move hand to library
        if (typeof game.moveHandToLibrary === "function") {
          game.moveHandToLibrary(playerId);
        }

        // Shuffle library
        if (typeof game.shuffleLibrary === "function") {
          game.shuffleLibrary(playerId);
        }

        // Draw new hand (7 cards - Commander format has free mulligan, then London mulligan)
        // For simplicity, always draw 7 and put back cards at keep
        const cardsToDraw = 7;
        if (typeof game.drawCards === "function") {
          game.drawCards(playerId, cardsToDraw);
        }
      } catch (e) {
        debugError(1, "Mulligan hand manipulation failed:", e);
        socket.emit("error", {
          code: "MULLIGAN_FAILED",
          message: "Failed to process mulligan",
        });
        return;
      }

      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "mulligan", { 
          playerId, 
          mulliganNumber: newMulliganCount,
          wasFree: isFreeNoLandsAllLands,
        });
      } catch (e) {
        debugWarn(1, "appendEvent(mulligan) failed:", e);
      }

      // Build the mulligan message
      let mulliganMessage = `${getPlayerName(game, playerId)} mulligans`;
      if (isFreeNoLandsAllLands) {
        mulliganMessage += ` (FREE - no lands/all lands hand)`;
      } else {
        mulliganMessage += ` (mulligan #${newMulliganCount})`;
      }
      mulliganMessage += '.';

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: mulliganMessage,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `mulligan error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "MULLIGAN_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // ============================================================================
  // Life Total Adjustment
  // ============================================================================

  /**
   * Adjust a player's life total by a delta (positive for gain, negative for loss)
   */
  socket.on("adjustLife", async ({ gameId, delta, targetPlayerId }: { 
    gameId: string; 
    delta: number; 
    targetPlayerId?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId || socket.data.spectator) return;

      // Target player defaults to the acting player
      const targetPid = targetPlayerId || playerId;

      // Ensure life object exists
      if (!game.state.life) {
        game.state.life = {};
      }

      // Get current life (default to starting life)
      const startingLife = (game.state as any).startingLife ?? 40;
      const currentLife = (game.state.life as any)[targetPid] ?? startingLife;
      const newLife = currentLife + delta;

      // Update life total
      (game.state.life as any)[targetPid] = newLife;

      // Also update the ctx.life if it exists (for compatibility with modules)
      if ((game as any).life) {
        (game as any).life[targetPid] = newLife;
      }

      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "adjustLife", { 
          playerId: targetPid, 
          delta,
          oldLife: currentLife,
          newLife,
          by: playerId,
        });
      } catch (e) {
        debugWarn(1, "appendEvent(adjustLife) failed:", e);
      }

      // Emit chat message
      const actionType = delta > 0 ? "gained" : "lost";
      const actionAmount = Math.abs(delta);
      const targetName = getPlayerName(game, targetPid);
      const isOwnLife = targetPid === playerId;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${targetName} ${actionType} ${actionAmount} life. (${currentLife} ΓåÆ ${newLife})`,
        ts: Date.now(),
      });

      debug(2, `[adjustLife] ${targetName} ${actionType} ${actionAmount} life (${currentLife} ΓåÆ ${newLife}) in game ${gameId}`);

      // Check for lifegain triggers (Ratchet, Ajani's Pridemate, etc.)
      if (delta > 0) {
        try {
          const { detectLifegainTriggers } = await import("../state/modules/triggers/lifegain.js");
          const lifegainTriggers = detectLifegainTriggers(game as any, targetPid, delta);
          
          if (lifegainTriggers.length > 0) {
            // Add triggers to pending triggers queue
            const state = game.state as any;
            if (!state.pendingTriggers) {
              state.pendingTriggers = [];
            }
            
            for (const trigger of lifegainTriggers) {
              state.pendingTriggers.push({
                id: `lifegain_${trigger.permanentId}_${Date.now()}`,
                type: 'lifegain',
                controllerId: trigger.controllerId,
                sourceId: trigger.permanentId,
                sourceName: trigger.cardName,
                effect: trigger.effect,
                effectType: trigger.effectType,
                isMayAbility: trigger.isMayAbility,
                lifeGained: delta,
                maxArtifactMV: trigger.maxArtifactMV,
              });
              
              // Emit trigger notification
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}_trigger`,
                gameId,
                from: "system",
                message: `≡ƒÄ» Lifegain trigger: ${trigger.cardName} - ${trigger.effect}`,
                ts: Date.now(),
              });
            }
          }
        } catch (triggerErr) {
          debugWarn(1, "Error detecting lifegain triggers:", triggerErr);
        }
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `adjustLife error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "ADJUST_LIFE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Set a player's life total to a specific value
   */
  socket.on("setLife", ({ gameId, life, targetPlayerId }: { 
    gameId: string; 
    life: number; 
    targetPlayerId?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId || socket.data.spectator) return;

      // Target player defaults to the acting player
      const targetPid = targetPlayerId || playerId;

      // Ensure life object exists
      if (!game.state.life) {
        game.state.life = {};
      }

      // Get current life
      const startingLife = (game.state as any).startingLife ?? 40;
      const currentLife = (game.state.life as any)[targetPid] ?? startingLife;

      // Set new life total
      (game.state.life as any)[targetPid] = life;

      // Also update the ctx.life if it exists (for compatibility with modules)
      if ((game as any).life) {
        (game as any).life[targetPid] = life;
      }

      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "setLife", { 
          playerId: targetPid, 
          oldLife: currentLife,
          newLife: life,
          by: playerId,
        });
      } catch (e) {
        debugWarn(1, "appendEvent(setLife) failed:", e);
      }

      // Emit chat message
      const targetName = getPlayerName(game, targetPid);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${targetName}'s life total set to ${life}. (was ${currentLife})`,
        ts: Date.now(),
      });

      debug(2, `[setLife] ${targetName}'s life set to ${life} (was ${currentLife}) in game ${gameId}`);

      // Check for player defeat (life <= 0)
      if (life <= 0) {
        const players = game.state.players || [];
        const activePlayers = players.filter((p: any) => !p.hasLost && !p.eliminated);
        
        // Mark player as eliminated
        const targetPlayer = players.find((p: any) => p.id === targetPid) as any;
        if (targetPlayer) {
          targetPlayer.hasLost = true;
          targetPlayer.eliminated = true;
          targetPlayer.lossReason = "Life total is 0 or less";
        }
        
        // Emit elimination event
        io.to(gameId).emit("playerEliminated", {
          gameId,
          playerId: targetPid,
          playerName: targetName,
          reason: "Life total is 0 or less",
        });
        
        // Check if game is over (only 1 or 0 players remaining)
        const remainingPlayers = activePlayers.filter((p: any) => p.id !== targetPid);
        
        if (remainingPlayers.length === 1) {
          // One player left - they win!
          const winner = remainingPlayers[0];
          const winnerName = getPlayerName(game, winner.id);
          
          io.to(gameId).emit("gameOver", {
            gameId,
            type: 'victory',
            winnerId: winner.id,
            winnerName,
            loserId: targetPid,
            loserName: targetName,
            message: "You've Won!",
          });
          
          // Mark game as over
          (game.state as any).gameOver = true;
          (game.state as any).winner = winner.id;
        } else if (remainingPlayers.length === 0) {
          // No players left - draw
          io.to(gameId).emit("gameOver", {
            gameId,
            type: 'draw',
            message: "Draw!",
          });
          
          (game.state as any).gameOver = true;
        }
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `setLife error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "SET_LIFE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // ============================================================================
  // Mill (put cards from library to graveyard)
  // ============================================================================

  /**
   * Mill a number of cards from a player's library to their graveyard
   * Rule 701.17: For a player to mill a number of cards, that player puts that
   * many cards from the top of their library into their graveyard.
   */
  socket.on("mill", ({ gameId, count, targetPlayerId }: { 
    gameId: string; 
    count: number; 
    targetPlayerId?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId || socket.data.spectator) return;

      // Target player defaults to the acting player
      const targetPid = targetPlayerId || playerId;

      // Get the target player's zones
      const zones = game.state?.zones?.[targetPid];
      if (!zones) {
        socket.emit("error", {
          code: "ZONES_NOT_FOUND",
          message: "Player zones not found",
        });
        return;
      }

      // Get the library (may be stored differently in different game state formats)
      let library: any[] = [];
      if (typeof (game as any).getLibrary === "function") {
        library = (game as any).getLibrary(targetPid) || [];
      } else if (Array.isArray((zones as any).library)) {
        library = (zones as any).library;
      }

      // Rule 701.17b: Can't mill more than library size
      const actualCount = Math.min(count, library.length);
      if (actualCount <= 0) {
        socket.emit("error", {
          code: "NOTHING_TO_MILL",
          message: "No cards to mill",
        });
        return;
      }

      // Get the top N cards from library
      const milledCards: any[] = [];
      for (let i = 0; i < actualCount; i++) {
        const card = library.shift(); // Remove from top of library
        if (card) {
          card.zone = "graveyard";
          milledCards.push(card);
        }
      }

      // Update library count
      zones.libraryCount = library.length;

      // Add milled cards to graveyard
      zones.graveyard = zones.graveyard || [];
      for (const card of milledCards) {
        zones.graveyard.push(card);
      }
      zones.graveyardCount = zones.graveyard.length;

      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "mill", { 
          playerId: targetPid, 
          count: actualCount,
          cardIds: milledCards.map((c: any) => c.id),
          by: playerId,
        });
      } catch (e) {
        debugWarn(1, "appendEvent(mill) failed:", e);
      }

      // Emit chat message with milled card names
      const targetName = getPlayerName(game, targetPid);
      const cardNames = milledCards
        .filter((c: any) => c?.name)
        .map((c: any) => c.name)
        .slice(0, 5); // Show up to 5 card names
      const moreCount = milledCards.length - cardNames.length;
      
      let millMessage = `${targetName} milled ${actualCount} card${actualCount !== 1 ? 's' : ''}`;
      if (cardNames.length > 0) {
        millMessage += `: ${cardNames.join(', ')}`;
        if (moreCount > 0) {
          millMessage += ` and ${moreCount} more`;
        }
      }
      millMessage += '.';
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: millMessage,
        ts: Date.now(),
      });

      debug(2, `[mill] ${targetName} milled ${actualCount} cards in game ${gameId}`);

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `mill error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "MILL_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // ============================================================================
  // House Rules Configuration (Pre-Game)
  // ============================================================================

  /**
   * Set house rules for a game during pre-game phase.
   * House rules can only be set before the game starts.
   */
  socket.on("setHouseRules", ({ gameId, houseRules }: { 
    gameId: string; 
    houseRules: {
      freeFirstMulligan?: boolean;
      freeMulliganNoLandsOrAllLands?: boolean;
      anyCommanderDamageCountsAsCommanderDamage?: boolean;
      groupMulliganDiscount?: boolean;
      enableArchenemy?: boolean;
      enablePlanechase?: boolean;
    };
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId || socket.data.spectator) return;

      // Check if we're in PRE_GAME phase
      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      if (phaseStr !== "" && phaseStr !== "PRE_GAME") {
        socket.emit("error", {
          code: "NOT_PREGAME",
          message: "House rules can only be set during pre-game",
        });
        return;
      }

      // Set house rules on the game state
      game.state = (game.state || {}) as any;
      (game.state as any).houseRules = {
        ...(game.state as any).houseRules,
        ...houseRules,
      };

      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "setHouseRules", { 
          playerId, 
          houseRules,
          rules: houseRules,
        });
      } catch (e) {
        debugWarn(1, "appendEvent(setHouseRules) failed:", e);
      }

      // Build a description of enabled rules
      const enabledRules: string[] = [];
      if (houseRules.freeFirstMulligan) enabledRules.push("Free First Mulligan");
      if (houseRules.freeMulliganNoLandsOrAllLands) enabledRules.push("Free Mulligan (No Lands/All Lands)");
      if (houseRules.anyCommanderDamageCountsAsCommanderDamage) enabledRules.push("Any Commander Damage Counts");
      if (houseRules.groupMulliganDiscount) enabledRules.push("Group Mulligan Discount");
      if (houseRules.enableArchenemy) enabledRules.push("Archenemy (NYI)");
      if (houseRules.enablePlanechase) enabledRules.push("Planechase (NYI)");

      const rulesMessage = enabledRules.length > 0
        ? `House rules enabled: ${enabledRules.join(", ")}`
        : "All house rules disabled.";

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `≡ƒÅá ${getPlayerName(game, playerId)} updated house rules. ${rulesMessage}`,
        ts: Date.now(),
      });

      debug(2, `[setHouseRules] ${playerId} set house rules for game ${gameId}:`, houseRules);

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `setHouseRules error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "SET_HOUSE_RULES_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Legacy Miracle socket handlers removed — Miracle is handled via the Resolution Queue.

  // Legacy modeSelectionConfirm handler removed - now handled via Resolution Queue (mode_selection).

  // Legacy modalSpellConfirm/abundantChoiceConfirm/additionalCostConfirm/squadCostConfirm handlers removed.
  // These prompts are now handled via Resolution Queue steps:
  // - mode_selection (purpose: modalSpell/spree/overload/abundantChoice)
  // - additional_cost_payment
  // - squad_cost_payment

  // Legacy MDFC face selection confirm handler removed - now handled via Resolution Queue (resolutionStepPrompt).

  /**
   * Get cost reduction information for cards in hand.
   * This allows the UI to display modified casting costs when Banneret-type effects are active.
   * 
   * Emits: costReductionInfo with { cardId: { reducedManaCost: string, reduction: number, sources: string[] } }
   */
  socket.on("getCostReductions", async ({ gameId }: { gameId: string }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) return;

      const game = ensureGame(gameId);
      if (!game) return;

      const zones = game.state?.zones?.[playerId];
      if (!zones) return;

      const hand = zones.hand || [];
      const costInfo: Record<string, {
        originalCost: string;
        reducedCost: string;
        genericReduction: number;
        colorReduction: Record<string, number>;
        sources: string[];
      }> = {};

      for (const card of hand) {
        // Type guard: hand can contain strings (card IDs) or KnownCardRef objects
        if (!card || typeof card === 'string') continue;
        if (!card.id) continue;

        const cardManaCost = (card as any).mana_cost || "";
        if (!cardManaCost) continue;

        const reduction = calculateCostReduction(game, playerId, card, false);
        
        if (reduction.generic > 0 || Object.values(reduction.colors).some(v => v > 0)) {
          // Calculate reduced mana cost string
          const parsed = parseManaCost(cardManaCost);
          const reducedGeneric = Math.max(0, parsed.generic - reduction.generic);
          
          // Build the reduced cost string
          let reducedCostStr = "";
          
          // Add colored mana symbols
          for (const [color, count] of Object.entries(parsed.colors)) {
            const colorReduction = reduction.colors[color] || 0;
            const remaining = Math.max(0, count - colorReduction);
            for (let i = 0; i < remaining; i++) {
              reducedCostStr += `{${color.charAt(0).toUpperCase()}}`;
            }
          }
          
          // Add generic mana if any
          if (reducedGeneric > 0 || reducedCostStr === "") {
            reducedCostStr = `{${reducedGeneric}}` + reducedCostStr;
          }

          costInfo[card.id] = {
            originalCost: cardManaCost,
            reducedCost: reducedCostStr,
            genericReduction: reduction.generic,
            colorReduction: reduction.colors,
            sources: reduction.messages,
          };
        }
      }

      // Also check commanders in command zone (via game state, not game.commanders)
      const commanderState = (game as any).state?.commandZone?.[playerId];
      if (commanderState?.cards) {
        const inCommandZone = commanderState.inZone || [];
        for (const cmdCard of commanderState.cards) {
          if (!cmdCard?.id || !inCommandZone.includes(cmdCard.id)) continue;

          const cardManaCost = cmdCard.mana_cost || "";
          if (!cardManaCost) continue;

          const reduction = calculateCostReduction(game, playerId, cmdCard, false);
          
          if (reduction.generic > 0 || Object.values(reduction.colors).some(v => v > 0)) {
            const parsed = parseManaCost(cardManaCost);
            const reducedGeneric = Math.max(0, parsed.generic - reduction.generic);
            
            let reducedCostStr = "";
            for (const [color, count] of Object.entries(parsed.colors)) {
              const colorReduction = reduction.colors[color] || 0;
              const remaining = Math.max(0, count - colorReduction);
              for (let i = 0; i < remaining; i++) {
                reducedCostStr += `{${color.charAt(0).toUpperCase()}}`;
              }
            }
            if (reducedGeneric > 0 || reducedCostStr === "") {
              reducedCostStr = `{${reducedGeneric}}` + reducedCostStr;
            }

            costInfo[cmdCard.id] = {
              originalCost: cardManaCost,
              reducedCost: reducedCostStr,
              genericReduction: reduction.generic,
              colorReduction: reduction.colors,
              sources: reduction.messages,
            };
          }
        }
      }

      socket.emit("costReductionInfo", { gameId, costInfo });
    } catch (err: any) {
      debugError(1, `getCostReductions error for game ${gameId}:`, err);
    }
  });

  // Handle equip ability - prompts player to select creature to attach equipment to
  // Flow: selectTarget -> promptManaPayment -> confirmPayment -> attach
  socket.on("equipAbility", ({ gameId, equipmentId, targetCreatureId, paymentConfirmed }: { 
    gameId: string; 
    equipmentId: string; 
    targetCreatureId?: string;
    paymentConfirmed?: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const battlefield = game.state?.battlefield || [];
      const equipment = battlefield.find((p: any) => p.id === equipmentId);
      
      if (!equipment) {
        socket.emit("error", { code: "NOT_FOUND", message: "Equipment not found" });
        return;
      }

      // Check if player controls the equipment
      if (equipment.controller !== playerId) {
        socket.emit("error", { code: "NOT_CONTROLLER", message: "You do not control this equipment" });
        return;
      }

      const oracleText = (equipment.card?.oracle_text || "").toLowerCase();
      const typeLine = (equipment.card?.type_line || "").toLowerCase();
      
      // Check if its actually equipment
      if (!typeLine.includes("equipment")) {
        socket.emit("error", { code: "NOT_EQUIPMENT", message: "This permanent is not equipment" });
        return;
      }

      // Detect special attach abilities (like Bloodthirsty Blade) that target opponent creatures
      // Pattern: "{X}: Attach ~ to target creature an opponent controls"
      const specialAttachMatch = oracleText.match(/\{([^}]+)\}:\s*attach[^.]*(?:creature\s+an?\s+opponent|opponent[^.]*creature)/i);
      const targetsOpponentCreatures = !!specialAttachMatch;
      
      // Parse equip cost from oracle text
      // First check for special attach ability, then fall back to standard equip
      let equipCost: string;
      if (specialAttachMatch) {
        equipCost = `{${specialAttachMatch[1]}}`;
        debug(2, `[equipAbility] Detected special attach ability targeting opponent creatures: ${equipCost}`);
      } else {
        // Supports patterns like: "Equip {2}", "Equip {1}{W}", "EquipΓÇöPay 3 life"
        const equipCostMatch = oracleText.match(/equip\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        equipCost = equipCostMatch ? equipCostMatch[1] : "{0}";
      }
      
      // Check for Puresteel Paladin metalcraft effect (equip costs {0})
      // Use centralized hasMetalcraft from game-state-effects
      // Note: Metalcraft only applies to standard equip, not special attach abilities
      const hasMetalcraftEquipReduction = !targetsOpponentCreatures && battlefield.some((p: any) => {
        if (p.controller !== playerId) return false;
        const pOracle = (p.card?.oracle_text || '').toLowerCase();
        // Puresteel Paladin: "Metalcraft ΓÇö Equipment you control have equip {0}"
        return pOracle.includes('metalcraft') && 
               pOracle.includes('equipment') && 
               pOracle.includes('equip') && 
               pOracle.includes('{0}');
      });
      
      if (hasMetalcraftEquipReduction) {
        // Check if metalcraft is active using centralized function
        if (hasMetalcraft(game as any, playerId)) {
          equipCost = '{0}';
          debug(2, `[equipAbility] Metalcraft active (${countArtifacts(game as any, playerId)} artifacts) - equip cost reduced to {0}`);
        }
      }

      if (!targetCreatureId) {
        // No target specified - send list of valid targets
        const validTargets = battlefield.filter((p: any) => {
          // For special attach abilities (like Bloodthirsty Blade), target opponent creatures
          // For standard equip, target own creatures
          if (targetsOpponentCreatures) {
            if (p.controller === playerId) return false; // Must be opponent's creature
          } else {
            if (p.controller !== playerId) return false; // Must be own creature
          }
          const pTypeLine = (p.card?.type_line || "").toLowerCase();
          return pTypeLine.includes("creature");
        });

        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId,
          prompt: `Choose a creature to equip with ${equipment.card?.name || 'Equipment'}.`,
          validTargets: validTargets.map((c: any) => ({
            id: c.id,
            type: 'permanent' as const,
            name: c.card?.name || 'Creature',
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
            typeLine: c.card?.type_line,
          })),
          minTargets: 1,
          maxTargets: 1,
          equipAbility: true,
          equipmentId,
          equipCost,
          equipType: targetsOpponentCreatures ? 'opponent' : 'standard',
        } as any);

        debug(2, `[equipAbility] Enqueued Resolution Queue target selection for ${equipment.card?.name || "Equipment"}`);
        return;
      }

      // Target specified - check if we need to prompt for payment
      const targetCreature = battlefield.find((p: any) => p.id === targetCreatureId);
      if (!targetCreature) {
        socket.emit("error", { code: "TARGET_NOT_FOUND", message: "Target creature not found" });
        return;
      }

      // Check target validity based on whether this is a special attach ability or standard equip
      if (targetsOpponentCreatures) {
        // For special attach abilities (like Bloodthirsty Blade), target must be opponent's creature
        if (targetCreature.controller === playerId) {
          socket.emit("error", { code: "INVALID_TARGET", message: "This ability can only target opponent creatures" });
          return;
        }
      } else {
        // For standard equip, target must be player's own creature
        if (targetCreature.controller !== playerId) {
          socket.emit("error", { code: "NOT_YOUR_CREATURE", message: "You can only equip to creatures you control" });
          return;
        }
      }

      const targetTypeLine = (targetCreature.card?.type_line || "").toLowerCase();
      if (!targetTypeLine.includes("creature")) {
        socket.emit("error", { code: "NOT_CREATURE", message: "Target is not a creature" });
        return;
      }

      // Check if payment is required
      const parsedCost = parseManaCost(equipCost);
      const totalManaCost = parsedCost.generic + Object.values(parsedCost.colors).reduce((a: number, b: number) => a + b, 0);
      
      if (totalManaCost > 0) {
        // Validate and pay the equip cost
        const pool = getOrInitManaPool(game.state, playerId);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        
        // Validate payment
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
          return;
        }
        
        // Consume mana
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[equipAbility]');
        
        debug(2, `[equipAbility] ${playerId} paid ${equipCost} to equip ${equipment.card?.name} to ${targetCreature.card?.name}`);
      }

      // Proceed with equipping
      // Detach from previous creature if attached
      if (equipment.attachedTo) {
        const prevCreature = battlefield.find((p: any) => p.id === equipment.attachedTo);
        if (prevCreature) {
          (prevCreature as any).attachedEquipment = ((prevCreature as any).attachedEquipment || []).filter((id: string) => id !== equipmentId);
        }
      }

      // Attach to new creature
      equipment.attachedTo = targetCreatureId;
      (targetCreature as any).attachedEquipment = (targetCreature as any).attachedEquipment || [];
      if (!(targetCreature as any).attachedEquipment.includes(equipmentId)) {
        (targetCreature as any).attachedEquipment.push(equipmentId);
      }

      debug(2, `[equipAbility] ${equipment.card?.name} equipped to ${targetCreature.card?.name} by ${playerId}`);

      // Persist event for replay
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "equipPermanent", {
          playerId,
          equipmentId,
          targetCreatureId,
          equipmentName: equipment.card?.name,
          targetCreatureName: targetCreature.card?.name,
          previouslyAttachedTo: equipment.attachedTo, // for proper undo tracking
        });
      } catch (e) {
        debugWarn(1, 'appendEvent(equipPermanent) failed:', e);
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: totalManaCost > 0 
          ? `ΓÜö∩╕Å ${getPlayerName(game, playerId)} pays ${equipCost} and equips ${equipment.card?.name || "Equipment"} to ${targetCreature.card?.name || "Creature"}`
          : `ΓÜö∩╕Å ${getPlayerName(game, playerId)} equips ${equipment.card?.name || "Equipment"} to ${targetCreature.card?.name || "Creature"}`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `equipAbility error for game ${gameId}:`, err);
      socket.emit("error", { code: "EQUIP_ERROR", message: err?.message ?? String(err) });
    }
  });
  
  // Handle equip payment confirmation - player has paid the mana cost
  // Legacy confirmEquipPayment flow removed (equip now resolves via Resolution Queue target selection).

  // ==========================================================================
  // FORETELL SUPPORT
  // ==========================================================================
  
  /**
   * Handle foretelling a card from hand (exile face-down for {2})
   * Foretell: Exile this card from your hand face-down for {2}. 
   * You may cast it later for its foretell cost.
   */
  socket.on("foretellCard", ({ gameId, cardId }: {
    gameId: string;
    cardId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const zones = game.state.zones?.[playerId];
      if (!zones || !Array.isArray(zones.hand)) {
        socket.emit("error", { code: "NO_HAND", message: "Hand not found" });
        return;
      }

      // Find the card in hand
      const cardIndex = (zones.hand as any[]).findIndex((c: any) => c?.id === cardId);
      if (cardIndex === -1) {
        socket.emit("error", { code: "CARD_NOT_FOUND", message: "Card not found in hand" });
        return;
      }

      const card = zones.hand[cardIndex] as any;
      const oracleText = (card.oracle_text || '').toLowerCase();
      
      // Check if card has foretell (use word boundary to avoid false matches)
      if (!/\bforetell\b/i.test(oracleText)) {
        socket.emit("error", { code: "NO_FORETELL", message: "This card doesn't have foretell" });
        return;
      }

      // Parse foretell cost from oracle text
      const foretellCostMatch = (card.oracle_text || '').match(/\bforetell\b\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      const foretellCost = foretellCostMatch ? foretellCostMatch[1] : '{2}';

      // Remove from hand
      (zones.hand as any[]).splice(cardIndex, 1);
      zones.handCount = (zones.hand as any[]).length;

      // Add to exile face-down with foretell marker
      zones.exile = zones.exile || [];
      const foretoldCard = {
        ...card,
        zone: 'exile',
        foretold: true,
        foretellCost: foretellCost,
        foretoldBy: playerId,
        foretoldAt: Date.now(),
        faceDown: true,
      };
      (zones.exile as any[]).push(foretoldCard);
      (zones as any).exileCount = (zones.exile as any[]).length;

      debug(2, `[foretellCard] ${playerId} foretold ${card.name} (foretell cost: ${foretellCost})`);

      // Persist event for replay
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "foretellCard", {
          playerId,
          cardId,
          cardName: card.name,
          foretellCost,
          card: foretoldCard, // Include full card data for reliable replay
        });
      } catch (e) {
        debugWarn(1, 'appendEvent(foretellCard) failed:', e);
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `≡ƒö« ${getPlayerName(game, playerId)} foretells a card.`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `foretellCard error for game ${gameId}:`, err);
      socket.emit("error", { code: "FORETELL_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Handle casting a foretold card from exile
   */
  socket.on("castForetold", ({ gameId, cardId }: {
    gameId: string;
    cardId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const zones = game.state.zones?.[playerId];
      if (!zones || !Array.isArray(zones.exile)) {
        socket.emit("error", { code: "NO_EXILE", message: "Exile zone not found" });
        return;
      }

      // Find the foretold card in exile
      const cardIndex = (zones.exile as any[]).findIndex((c: any) => c?.id === cardId && c?.foretold);
      if (cardIndex === -1) {
        socket.emit("error", { code: "CARD_NOT_FOUND", message: "Foretold card not found in exile" });
        return;
      }

      const card = zones.exile[cardIndex] as any;

      if (card.foretoldBy && String(card.foretoldBy) !== String(playerId)) {
        socket.emit("error", { code: "NOT_YOUR_FORETOLD_CARD", message: "You can only cast cards you foretold." });
        return;
      }

      // Move the card into hand temporarily and reuse the normal cast pipeline.
      // This avoids a bespoke client prompt and ensures targeting/payment flows stay consistent.
      const originalCard = { ...card };
      (zones.exile as any[]).splice(cardIndex, 1);
      (zones as any).exileCount = (zones.exile as any[]).length;

      zones.hand = Array.isArray((zones as any).hand) ? (zones as any).hand : [];

      const foretellCost = String(card.foretellCost || '{2}');
      const handCard = {
        ...card,
        zone: 'hand',
        faceDown: false,
        mana_cost: foretellCost,
        castFromForetell: true,
        originalManaCost: card.mana_cost,
      };
      (zones.hand as any[]).push(handCard);
      zones.handCount = (zones.hand as any[]).length;

      (game.state as any).pendingForetellCasts = (game.state as any).pendingForetellCasts || {};
      (game.state as any).pendingForetellCasts[cardId] = {
        playerId,
        originalCard,
        foretellCost,
        movedAt: Date.now(),
      };

      debug(2, `[castForetold] ${playerId} starting cast for foretold ${card.name} (cost ${foretellCost})`);

      // Start the normal spell cast flow (will request targets via Resolution Queue, then payment).
      handleCastSpellFromHand({ gameId, cardId });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `castForetold error for game ${gameId}:`, err);
      socket.emit("error", { code: "CAST_FORETOLD_ERROR", message: err?.message ?? String(err) });
    }
  });

  // Payment/targeting cancel from client casting UI.
  // Used as a best-effort cleanup hook, especially for foretell casts (which temporarily move a card into hand).
  socket.on('targetSelectionCancel', ({ gameId, cardId, effectId }: { gameId: string; cardId: string; effectId?: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Clean pending spell-cast state when present.
      if (effectId && (game.state as any).pendingSpellCasts?.[effectId]) {
        delete (game.state as any).pendingSpellCasts[effectId];
      }
      if (effectId && (game.state as any).pendingTargets?.[effectId]) {
        delete (game.state as any).pendingTargets[effectId];
      }

      const pendingForetell = (game.state as any).pendingForetellCasts?.[cardId];
      if (pendingForetell && pendingForetell.playerId === playerId) {
        const zones = game.state.zones?.[playerId];
        if (zones && Array.isArray(zones.hand)) {
          const handIdx = (zones.hand as any[]).findIndex((c: any) => c?.id === cardId);
          if (handIdx !== -1) {
            (zones.hand as any[]).splice(handIdx, 1);
            zones.handCount = (zones.hand as any[]).length;
          }
        }

        if (zones) {
          zones.exile = Array.isArray((zones as any).exile) ? (zones as any).exile : [];
          (zones.exile as any[]).push({ ...(pendingForetell.originalCard as any), zone: 'exile', faceDown: true, foretold: true });
          (zones as any).exileCount = (zones.exile as any[]).length;
        }

        delete (game.state as any).pendingForetellCasts[cardId];
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `targetSelectionCancel error for game ${gameId}:`, err);
      socket.emit('error', { code: 'TARGET_SELECTION_CANCEL_ERROR', message: err?.message ?? String(err) });
    }
  });

  // ==========================================================================
  // PHASE OUT SUPPORT
  // ==========================================================================
  
  /**
   * Handle phase out effect (Clever Concealment, Teferi's Protection, etc.)
   */
  socket.on("phaseOutPermanents", ({ gameId, permanentIds }: {
    gameId: string;
    permanentIds: string[];
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const battlefield = game.state?.battlefield || [];
      const phasedOut: string[] = [];

      for (const permId of permanentIds) {
        const permanent = battlefield.find((p: any) => p?.id === permId);
        if (permanent && permanent.controller === playerId && !permanent.phasedOut) {
          permanent.phasedOut = true;
          permanent.phaseOutController = playerId;
          phasedOut.push(permanent.card?.name || permId);
        }
      }

      if (phasedOut.length > 0) {
        debug(1, `[phaseOutPermanents] ${playerId} phased out: ${phasedOut.join(', ')}`);

        // Persist event for replay
        try {
          appendEvent(gameId, (game as any).seq ?? 0, "phaseOutPermanents", {
            playerId,
            permanentIds,
            phasedOutNames: phasedOut,
          });
        } catch (e) {
          debugWarn(1, 'appendEvent(phaseOutPermanents) failed:', e);
        }

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Γ£¿ ${getPlayerName(game, playerId)}'s permanents phase out: ${phasedOut.join(', ')}`,
          ts: Date.now(),
        });

        broadcastGame(io, game, gameId);
      }
    } catch (err: any) {
      debugError(1, `phaseOutPermanents error for game ${gameId}:`, err);
      socket.emit("error", { code: "PHASE_OUT_ERROR", message: err?.message ?? String(err) });
    }
  });

  // ==========================================================================
  // GRAVEYARD TARGET SELECTION (Resolution Queue)
  // ==========================================================================

  /**
   * Legacy entrypoint: Request graveyard card selection.
   * This previously emitted a bespoke `graveyardTargetsResponse` and expected a
   * bespoke `confirmGraveyardTargets` follow-up. It now enqueues a Resolution Queue
   * step so the unified interaction UI can handle it.
   */
  socket.on("requestGraveyardTargets", ({ gameId, effectId, cardName, filter, minTargets, maxTargets, targetPlayerId, destination, title, description }: {
    gameId: string;
    effectId: string;
    cardName: string;
    filter: { types?: string[]; subtypes?: string[]; excludeTypes?: string[] };
    minTargets: number;
    maxTargets: number;
    targetPlayerId?: string; // Whose graveyard to search (defaults to self)
    destination?: 'hand' | 'battlefield' | 'library_top' | 'library_bottom' | 'exile';
    title?: string;
    description?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const searchPlayerId = targetPlayerId || playerId;
      const zones = game.state.zones?.[searchPlayerId];
      const gy = zones && Array.isArray((zones as any).graveyard) ? ((zones as any).graveyard as any[]) : [];

      const filterObj = filter || {};
      const validTargets = gy.filter((card: any) => {
        if (!card) return false;
        const typeLine = String(card.type_line || '').toLowerCase();

        if (filterObj.types && filterObj.types.length > 0) {
          if (!filterObj.types.some(t => typeLine.includes(String(t).toLowerCase()))) return false;
        }

        if (filterObj.subtypes && filterObj.subtypes.length > 0) {
          if (!filterObj.subtypes.some(st => typeLine.includes(String(st).toLowerCase()))) return false;
        }

        if (filterObj.excludeTypes && filterObj.excludeTypes.length > 0) {
          if (filterObj.excludeTypes.some(et => typeLine.includes(String(et).toLowerCase()))) return false;
        }

        return true;
      }).map((card: any) => ({
        id: String(card.id),
        name: String(card.name || card.id),
        typeLine: card.type_line,
        manaCost: card.mana_cost,
        imageUrl: card.image_uris?.small || card.image_uris?.normal,
      }));

      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId as any)
        .find((s: any) => (s as any)?.type === ResolutionStepType.GRAVEYARD_SELECTION && String((s as any)?.effectId || '') === String(effectId));

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.GRAVEYARD_SELECTION,
          playerId: playerId as any,
          sourceName: cardName,
          sourceId: effectId,
          description: String(description || `Select card(s) from ${getPlayerName(game, searchPlayerId)}'s graveyard.`),
          mandatory: Number(minTargets || 0) > 0,
          effectId,
          cardName,
          title: String(title || cardName || 'Select from Graveyard'),
          targetPlayerId: searchPlayerId,
          filter: filterObj,
          minTargets: Number(minTargets || 0),
          maxTargets: Number(maxTargets || 1),
          destination: destination || 'hand',
          validTargets,
          imageUrl: undefined,
        } as any);
      }

      debug(2, `[requestGraveyardTargets] (Resolution Queue) ${playerId} selecting from ${searchPlayerId}'s graveyard for ${cardName} (${validTargets.length} candidate(s))`);
    } catch (err: any) {
      debugError(1, `requestGraveyardTargets error for game ${gameId}:`, err);
      socket.emit("error", { code: "GRAVEYARD_TARGETS_ERROR", message: err?.message ?? String(err) });
    }
  });

  // ==========================================================================
  // OPPONENT SELECTION (Secret Rendezvous, etc.)
  // ==========================================================================
  
  /**
   * Request opponent selection for effects like Secret Rendezvous
   */
  socket.on("requestOpponentSelection", ({ gameId, effectId, cardName, description, minOpponents, maxOpponents }: {
    gameId: string;
    effectId: string;
    cardName: string;
    description: string;
    minOpponents: number;
    maxOpponents: number;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const players = game.state?.players || [];
      const opponents = players.filter((p: any) => p && p.id !== playerId).map((p: any) => ({
        id: p.id,
        name: p.name || p.id,
        life: game.state.life?.[p.id] ?? 40,
        libraryCount: game.state.zones?.[p.id]?.libraryCount ?? 0,
        isOpponent: true,
      }));

      // Unified Resolution Queue prompt
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, playerId as any)
        .find((s: any) => (s as any)?.opponentSelection === true && String((s as any)?.effectId || (s as any)?.sourceId || '') === String(effectId));

      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: playerId as any,
          sourceName: cardName,
          sourceId: effectId,
          description,
          mandatory: minOpponents > 0,
          validTargets: opponents.map((o: any) => ({
            id: o.id,
            label: o.name,
            // Client target selection modal infers target kind from `type` or well-known `description`.
            // Use `player` so opponent selections render as player targets.
            type: 'player',
            description: 'player',
          })),
          targetTypes: ['player'],
          minTargets: Math.max(0, minOpponents),
          maxTargets: Math.max(0, maxOpponents),
          targetDescription: 'opponent',
          opponentSelection: true,
          effectId,
          cardName,
        } as any);
      }

      debug(2, `[requestOpponentSelection] Requesting opponent selection for ${cardName}`);
    } catch (err: any) {
      debugError(1, `requestOpponentSelection error for game ${gameId}:`, err);
      socket.emit("error", { code: "OPPONENT_SELECTION_ERROR", message: err?.message ?? String(err) });
    }
  });

  // ==========================================================================
  // SACRIFICE SELECTION FOR EDICT EFFECTS (Grave Pact, Dictate of Erebos, etc.)
  // ==========================================================================
  
  /**
   * Request sacrifice selection from a player due to an edict effect
   */
  socket.on("requestSacrificeSelection", async ({ gameId, effectId, sourceName, targetPlayerId, permanentType, count }: {
    gameId: string;
    effectId: string;
    sourceName: string;
    targetPlayerId: string;
    permanentType: 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent';
    count: number;
  }) => {
    try {
      const game = ensureGame(gameId);
      if (!game) return;

      // Common edict case (Grave Pact / Dictate of Erebos): sacrifice 1 creature.
      // Use Resolution Queue so the unified interaction UI handles it.
      if (permanentType === 'creature' && count === 1) {
        enqueueEdictCreatureSacrificeStep(io as any, game as any, gameId, targetPlayerId, {
          sourceName,
          sourceControllerId: socket.data.playerId,
          reason: `${sourceName} requires you to sacrifice ${count} ${permanentType}(s)`,
          sourceId: effectId,
        });

        debug(2, `[requestSacrificeSelection] (Resolution Queue) ${targetPlayerId} must sacrifice ${count} ${permanentType}(s) due to ${sourceName}`);
        return;
      }

      const battlefield = game.state?.battlefield || [];
      
      // Find valid permanents to sacrifice for target player
      const eligiblePermanents = battlefield.filter((p: any) => {
        if (!p || p.controller !== targetPlayerId) return false;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        
        if (permanentType === 'permanent') return true;
        return typeLine.includes(permanentType);
      }).map((p: any) => ({
        id: p.id,
        name: p.card?.name || p.id,
        typeLine: p.card?.type_line || '',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        power: p.basePower,
        toughness: p.baseToughness,
      }));

      // Unified Resolution Queue prompt for all remaining sacrifice-selection cases.
      const requiredCount = Math.max(0, Number(count || 0));
      const reason = `${sourceName} requires you to sacrifice ${requiredCount} ${permanentType}(s)`;

      if (eligiblePermanents.length === 0 || requiredCount <= 0) {
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${getPlayerName(game, targetPlayerId)} has no ${permanentType === 'permanent' ? 'permanents' : `${permanentType}s`} to sacrifice.`,
          ts: Date.now(),
        });
        return;
      }

      // If there's no choice (must sacrifice all available), auto-apply.
      if (eligiblePermanents.length <= requiredCount) {
        const ctx = {
          state: game.state,
          libraries: (game as any).libraries,
          bumpSeq: () => {
            if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
          },
          rng: (game as any).rng,
          gameId,
        } as any;

        const { movePermanentToGraveyard } = await import('../state/modules/counters_tokens.js');
        const sacrificed: string[] = [];

        for (const p of eligiblePermanents) {
          const perm = (game.state?.battlefield || []).find((bp: any) => bp && bp.id === p.id);
          const nm = String(perm?.card?.name || p.name || 'permanent');
          const ok = movePermanentToGraveyard(ctx, p.id, true);
          if (ok) sacrificed.push(nm);
        }

        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${getPlayerName(game, targetPlayerId)} sacrifices ${sacrificed.join(', ') || 'permanents'} (${sourceName}).`,
          ts: Date.now(),
        });
        broadcastGame(io, game, gameId);
        return;
      }

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: targetPlayerId as any,
        sourceName,
        sourceId: effectId,
        description: reason,
        mandatory: true,
        validTargets: eligiblePermanents.map((p: any) => ({
          id: p.id,
          label: p.name,
          description: 'permanent',
          imageUrl: p.imageUrl,
          typeLine: p.typeLine,
        })),
        targetTypes: ['permanent'],
        minTargets: requiredCount,
        maxTargets: requiredCount,
        targetDescription: `permanent to sacrifice`,

        sacrificeSelection: true,
        sacrificePermanentType: permanentType,
        sacrificeCount: requiredCount,
        sacrificeReason: reason,
        sacrificeSourceName: sourceName,
        sacrificeEffectId: effectId,
      } as any);

      debug(2, `[requestSacrificeSelection] (Resolution Queue) ${targetPlayerId} must sacrifice ${requiredCount} ${permanentType}(s) due to ${sourceName}`);
    } catch (err: any) {
      debugError(1, `requestSacrificeSelection error for game ${gameId}:`, err);
      socket.emit("error", { code: "SACRIFICE_REQUEST_ERROR", message: err?.message ?? String(err) });
    }
  });

  // ==========================================================================
  // CONTROL CHANGE (Humble Defector, Act of Treason, etc.)
  // ==========================================================================
  
  /**
   * Change control of a permanent from one player to another.
   * Used by effects like Humble Defector, Act of Treason, Dominate, etc.
   */
  socket.on("changePermanentControl", ({ gameId, permanentId, newController, duration }: {
    gameId: string;
    permanentId: string;
    newController: string;
    duration?: 'permanent' | 'eot' | 'turn';
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const battlefield = game.state?.battlefield || [];
      const permanent = battlefield.find((p: any) => p && p.id === permanentId);
      
      if (!permanent) {
        socket.emit("error", { code: "PERMANENT_NOT_FOUND", message: "Permanent not found" });
        return;
      }

      const oldController = permanent.controller;
      
      // Change control
      permanent.controller = newController;
      
      // Track control change for end-of-turn cleanup if temporary
      if (duration === 'eot' || duration === 'turn') {
        game.state.controlChangeEffects = game.state.controlChangeEffects || [];
        game.state.controlChangeEffects.push({
          permanentId,
          originalController: oldController,
          newController,
          duration,
          appliedAt: Date.now(),
        });
      }

      const cardName = permanent.card?.name || 'a permanent';
      const oldControllerName = getPlayerName(game, oldController);
      const newControllerName = getPlayerName(game, newController);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `≡ƒöä Control of ${cardName} changed from ${oldControllerName} to ${newControllerName}${duration === 'eot' ? ' until end of turn' : ''}.`,
        ts: Date.now(),
      });

      debug(2, `[changePermanentControl] ${cardName} control changed from ${oldController} to ${newController}`);

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      debugError(1, `changePermanentControl error for game ${gameId}:`, err);
      socket.emit("error", { code: "CONTROL_CHANGE_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Handle player conceding the game.
   * 
   * When a player concedes:
   * 1. They are marked as eliminated/conceded immediately
   * 2. Their permanents remain on the battlefield until their next turn would begin
   * 3. On their next turn, all their permanents are exiled and their turn is skipped
   * 4. If only one player remains, that player wins
   */
  socket.on("concede", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const players = game.state?.players || [];
      const player = players.find((p: any) => p.id === playerId);
      
      if (!player) {
        socket.emit("error", { code: "CONCEDE_ERROR", message: "Player not found" });
        return;
      }

      // Check if player already conceded or is eliminated
      if ((player as any).hasLost || (player as any).eliminated) {
        socket.emit("error", { code: "CONCEDE_ERROR", message: "You have already left the game" });
        return;
      }

      const playerName = player.name || playerId;

      // Mark player as conceded - field cleanup happens on their next turn
      (player as any).conceded = true;
      (player as any).concededAt = Date.now();
      // Note: We do NOT set hasLost or eliminated yet - that happens when their turn would start
      // This allows their permanents to remain on the field for other players to interact with

      // Emit concede event
      io.to(gameId).emit("playerConceded", {
        gameId,
        playerId,
        playerName,
        message: `${playerName} has conceded the game. Their permanents will be removed at the start of their next turn.`,
      });

      // Notify via chat
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `≡ƒÅ│∩╕Å ${playerName} has conceded the game.`,
        ts: Date.now(),
      });

      // Check the remaining player count (excluding conceded players)
      const activePlayers = players.filter((p: any) => 
        !p.hasLost && !p.eliminated && !p.conceded && !p.isSpectator
      );

      // If the conceding player currently has priority, pass it to the next player
      if (game.state.priority === playerId) {
        const turnOrder = game.state.turnOrder || players.filter((p: any) => !p.isSpectator).map((p: any) => p.id);
        const currentIndex = turnOrder.indexOf(playerId);
        
        // Find next active player in turn order
        for (let i = 1; i < turnOrder.length; i++) {
          const nextIndex = (currentIndex + i) % turnOrder.length;
          const nextPlayerId = turnOrder[nextIndex];
          const nextPlayer = players.find((p: any) => p.id === nextPlayerId);
          if (nextPlayer && !(nextPlayer as any).hasLost && !(nextPlayer as any).eliminated && !(nextPlayer as any).conceded && !(nextPlayer as any).isSpectator) {
            game.state.priority = nextPlayerId;
            break;
          }
        }
      }

      // If only one active player remains, they win
      if (activePlayers.length === 1) {
        const winner = activePlayers[0];
        const winnerName = winner.name || winner.id;

        io.to(gameId).emit("gameOver", {
          gameId,
          type: 'victory',
          winnerId: winner.id,
          winnerName,
          loserId: playerId,
          loserName: playerName,
          message: `${winnerName} wins! All opponents have conceded.`,
        });

        (game.state as any).gameOver = true;
        (game.state as any).winner = winner.id;
      } else if (activePlayers.length === 0) {
        // All players conceded - draw
        io.to(gameId).emit("gameOver", {
          gameId,
          type: 'draw',
          message: "All players have conceded. The game is a draw.",
        });

        (game.state as any).gameOver = true;
      }

      // Persist the concede event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "concede", { playerId, playerName });
      } catch (e) {
        debugWarn(1, "appendEvent(concede) failed:", e);
      }

      broadcastGame(io, game, gameId);

      debug(2, `[concede] Player ${playerName} (${playerId}) conceded in game ${gameId}`);
    } catch (err: any) {
      debugError(1, `concede error for game ${gameId}:`, err);
      socket.emit("error", { code: "CONCEDE_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Set a trigger shortcut preference for a player.
   * This allows players to set automatic responses for "may" triggers
   * and "opponent may pay" triggers like Smothering Tithe.
   */
  socket.on("setTriggerShortcut", async ({
    gameId,
    cardName,
    preference,
    triggerDescription,
  }: {
    gameId: string;
    cardName: string;
    preference: 'always_pay' | 'never_pay' | 'always_yes' | 'always_no' | 'ask_each_time';
    triggerDescription?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;

      if (!game || !playerId) {
        socket.emit("error", {
          code: "SET_TRIGGER_SHORTCUT_ERROR",
          message: "Game not found or player not identified",
        });
        return;
      }

      // Initialize trigger shortcuts if needed
      game.state.triggerShortcuts = game.state.triggerShortcuts || {};
      game.state.triggerShortcuts[playerId] = game.state.triggerShortcuts[playerId] || [];

      // Normalize card name for matching
      const normalizedCardName = cardName.toLowerCase().trim();

      // Find existing shortcut for this card
      const existingIndex = game.state.triggerShortcuts[playerId].findIndex(
        (s: TriggerShortcut) => s.cardName === normalizedCardName && 
                    (!triggerDescription || s.triggerDescription === triggerDescription)
      );

      if (preference === 'ask_each_time') {
        // Remove the shortcut if setting to default
        if (existingIndex >= 0) {
          game.state.triggerShortcuts[playerId].splice(existingIndex, 1);
        }
      } else {
        // Add or update the shortcut
        const shortcut = {
          cardName: normalizedCardName,
          playerId,
          preference,
          triggerDescription,
        };

        if (existingIndex >= 0) {
          game.state.triggerShortcuts[playerId][existingIndex] = shortcut;
        } else {
          game.state.triggerShortcuts[playerId].push(shortcut);
        }
      }

      // Notify the player
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} set shortcut for ${cardName}: ${preference.replace(/_/g, ' ')}`,
        ts: Date.now(),
      });

      // Persist the event
      try {
        await appendEvent(gameId, (game as any).seq || 0, "setTriggerShortcut", {
          playerId,
          cardName: normalizedCardName,
          preference,
          triggerDescription,
        });
      } catch (e) {
        debugWarn(1, "[game-actions] Failed to persist setTriggerShortcut event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);

      debug(2, `[setTriggerShortcut] Player ${playerId} set ${cardName} preference to ${preference}`);

    } catch (err: any) {
      debugError(1, `setTriggerShortcut error for game ${gameId}:`, err);
      socket.emit("error", { code: "SET_TRIGGER_SHORTCUT_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Get a player's trigger shortcut for a specific card.
   * Returns null if no shortcut is set (use default behavior).
   */
  socket.on("getTriggerShortcut", ({
    gameId,
    cardName,
    triggerDescription,
  }: {
    gameId: string;
    cardName: string;
    triggerDescription?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;

      if (!game || !playerId) {
        socket.emit("triggerShortcutResponse", { shortcut: null });
        return;
      }

      const shortcuts = game.state.triggerShortcuts?.[playerId] || [];
      const normalizedCardName = cardName.toLowerCase().trim();

      const shortcut = shortcuts.find(
        (s: any) => s.cardName === normalizedCardName &&
                    (!triggerDescription || s.triggerDescription === triggerDescription)
      );

      socket.emit("triggerShortcutResponse", { 
        shortcut: shortcut || null,
        cardName: normalizedCardName 
      });

    } catch (err: any) {
      debugError(1, `getTriggerShortcut error:`, err);
      socket.emit("triggerShortcutResponse", { shortcut: null });
    }
  });

  // Legacy bespoke mutate socket handlers removed.
  // Mutate cast mode + target selection are handled via the Resolution Queue.
}
