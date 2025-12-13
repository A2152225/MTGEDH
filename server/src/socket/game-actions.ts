import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent, parseManaCost, getManaColorName, MANA_COLORS, MANA_COLOR_NAMES, consumeManaFromPool, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, getPlayerName, emitToPlayer, calculateManaProduction, handlePendingLibrarySearch, handlePendingJoinForces, handlePendingTemptingOffer, handlePendingPonder, broadcastManaPoolUpdate, handlePendingCascade, millUntilLand } from "./util";
import { appendEvent } from "../db";
import { GameManager } from "../GameManager";
import type { PaymentItem, TriggerShortcut, PlayerID } from "../../../shared/src";
import { requiresCreatureTypeSelection, requestCreatureTypeSelection } from "./creature-type";
import { requiresColorChoice, requestColorChoice } from "./color-choice";
import { checkAndPromptOpeningHandActions } from "./opening-hand";
import { emitSacrificeUnlessPayPrompt } from "./triggers";
import { detectSpellCastTriggers, getBeginningOfCombatTriggers, getEndStepTriggers, getLandfallTriggers, type SpellCastTrigger } from "../state/modules/triggered-abilities";
import { getUpkeepTriggersForPlayer, autoProcessCumulativeUpkeepMana } from "../state/modules/upkeep-triggers";
import { categorizeSpell, evaluateTargeting, requiresTargeting, parseTargetRequirements } from "../rules-engine/targeting";
import { recalculatePlayerEffects, hasMetalcraft, countArtifacts } from "../state/modules/game-state-effects";
import { PAY_X_LIFE_CARDS, getMaxPayableLife, validateLifePayment, uid } from "../state/utils";
import { detectTutorEffect, parseSearchCriteria, type TutorInfo } from "./interaction";

// Import land-related helpers from modularized module
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
    
    // Check player-specific overrides first (set by spells like Praetor's Counsel)
    // Praetor's Counsel: "You have no maximum hand size for the rest of the game."
    const playerMaxHandSize = gameState.maxHandSize?.[playerId];
    if (playerMaxHandSize === Infinity || playerMaxHandSize === Number.POSITIVE_INFINITY) {
      return Infinity;
    }
    
    // Check for "no maximum hand size" flags set by resolved spells
    // This handles Praetor's Counsel and similar effects
    const noMaxHandSize = gameState.noMaximumHandSize?.[playerId];
    if (noMaxHandSize === true) {
      return Infinity;
    }
    
    // Check player effects array for hand size modifications
    const playerEffects = gameState.playerEffects?.[playerId] || [];
    for (const effect of playerEffects) {
      if (effect && (effect.type === 'no_maximum_hand_size' || 
                     effect.effect === 'no_maximum_hand_size')) {
        return Infinity;
      }
    }
    
    // Check for battlefield permanents that grant "no maximum hand size"
    // Examples: Reliquary Tower, Thought Vessel, Spellbook, Venser's Journal, Library of Leng
    const battlefield = gameState.battlefield || [];
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const oracle = (perm.card?.oracle_text || "").toLowerCase();
        // Check for "no maximum hand size" text
        if (oracle.includes("you have no maximum hand size") || 
            oracle.includes("no maximum hand size")) {
          return Infinity;
        }
      }
    }
    
    // Check emblems controlled by the player
    const emblems = gameState.emblems || [];
    for (const emblem of emblems) {
      if (emblem && emblem.controller === playerId) {
        const effect = (emblem.effect || emblem.text || "").toLowerCase();
        if (effect.includes("no maximum hand size")) {
          return Infinity;
        }
      }
    }
    
    // Check for a numeric override (e.g., effects that set a specific hand size)
    if (typeof playerMaxHandSize === "number" && playerMaxHandSize > 0) {
      return playerMaxHandSize;
    }
    
    // Default maximum hand size
    return 7;
  } catch (err) {
    console.warn("[getMaxHandSizeForPlayer] Error:", err);
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
    const typeLine = (card.type_line || '').toLowerCase();
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
      p && !p.spectator && !p.isAI && p.id && !p.id.startsWith('ai_')
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
    console.warn("checkAllHumanPlayersMulliganed failed:", err);
    return false;
  }
}

/**
 * Calculate the effective mulligan count for a player based on game rules.
 * This determines how many cards they need to put back when keeping their hand.
 * 
 * In multiplayer games (3+ players), the first mulligan is always free per 
 * official Commander/multiplayer rules (rule 103.5a). This is now baseline behavior.
 * 
 * @param actualMulligans - The actual number of mulligans taken
 * @param game - The game state
 * @param playerId - The player ID
 * @returns The effective mulligan count (cards to put back)
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
  // This is now BASELINE behavior for multiplayer games - always enabled
  // The house rule flag is kept for backward compatibility but is no longer required
  if (isMultiplayer && actualMulligans >= 1) {
    effectiveCount = Math.max(0, actualMulligans - 1);
    console.log(`[mulligan] Free first mulligan applied for ${playerId} (multiplayer baseline): ${actualMulligans} -> ${effectiveCount}`);
  }
  
  // Group mulligan discount: if enabled and all human players mulliganed, reduce by 1
  if (houseRules.groupMulliganDiscount && checkAllHumanPlayersMulliganed(game)) {
    effectiveCount = Math.max(0, effectiveCount - 1);
    console.log(`[mulligan] Group mulligan discount applied for ${playerId}: effective count now ${effectiveCount}`);
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
    console.warn("checkAllPlayersKeptHands failed:", err);
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
    console.warn("checkAllPlayersHaveDecks failed:", err);
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
      
      // Request creature type selection from the controller
      requestCreatureTypeSelection(
        io,
        gameId,
        controller,
        permanentId,
        cardName,
        reason
      );
      
      console.log(`[game-actions] Requesting creature type selection for ${cardName} (${permanentId}) from ${controller}`);
    }
  }
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
      
      // Request color choice from the controller
      requestColorChoice(
        io,
        gameId,
        controller,
        cardName,
        reason,
        permanentId
      );
      
      console.log(`[game-actions] Requesting color choice for ${cardName} (${permanentId}) from ${controller}`);
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
        
        // Emit library search request to show top 4, filter for creatures
        emitToPlayer(io, controller, "librarySearchRequest", {
          gameId,
          cards: topCards,
          title: "Growing Rites of Itlimoc",
          description: "Look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.",
          filter: { type: "creature" },
          maxSelections: 1,
          moveTo: "hand",
          shuffleAfter: false,
          revealSelection: true,
          putRestOnBottom: true,
        });
        
        console.log(`[game-actions] Growing Rites of Itlimoc ETB trigger for ${controller}`);
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
        
        // Emit library search request for Forest
        emitToPlayer(io, controller, "librarySearchRequest", {
          gameId,
          cards: zones.library,
          title: "Casal, Lurkwood Pathfinder",
          description: "Search your library for a Forest card, put it onto the battlefield tapped, then shuffle.",
          filter: { subtype: "Forest" },
          maxSelections: 1,
          moveTo: "battlefield_tapped",
          shuffleAfter: true,
        });
        
        console.log(`[game-actions] Casal, Lurkwood Pathfinder ETB trigger for ${controller}`);
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
    
    // Determine card characteristics
    const isCreature = cardTypeLine.includes("creature");
    const isInstant = cardTypeLine.includes("instant");
    const isSorcery = cardTypeLine.includes("sorcery");
    const isArtifact = cardTypeLine.includes("artifact");
    const isEnchantment = cardTypeLine.includes("enchantment");
    const isPlaneswalker = cardTypeLine.includes("planeswalker");
    
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
      if (permName.includes("ruby medallion") && cardColors.includes("R")) {
        reduction.generic += 1;
        reduction.messages.push(`Ruby Medallion: -{1} (red)`);
      }
      
      // Sapphire Medallion: Blue spells cost {1} less
      if (permName.includes("sapphire medallion") && cardColors.includes("U")) {
        reduction.generic += 1;
        reduction.messages.push(`Sapphire Medallion: -{1} (blue)`);
      }
      
      // Jet Medallion: Black spells cost {1} less
      if (permName.includes("jet medallion") && cardColors.includes("B")) {
        reduction.generic += 1;
        reduction.messages.push(`Jet Medallion: -{1} (black)`);
      }
      
      // Pearl Medallion: White spells cost {1} less
      if (permName.includes("pearl medallion") && cardColors.includes("W")) {
        reduction.generic += 1;
        reduction.messages.push(`Pearl Medallion: -{1} (white)`);
      }
      
      // Emerald Medallion: Green spells cost {1} less
      if (permName.includes("emerald medallion") && cardColors.includes("G")) {
        reduction.generic += 1;
        reduction.messages.push(`Emerald Medallion: -{1} (green)`);
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
      if (cardOracleText.includes("affinity for artifacts")) {
        const artifactCount = battlefield.filter((p: any) => 
          p && p.controller === playerId && 
          (p.card?.type_line || "").toLowerCase().includes("artifact")
        ).length;
        if (artifactCount > 0) {
          reduction.generic += artifactCount;
          reduction.messages.push(`Affinity: -{${artifactCount}} (${artifactCount} artifacts)`);
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
        reduction.messages.push(`${cardName}: -{${totalReduction}} (${creatureCount} creatures × {${reductionPerCreature}})`);
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
        reduction.messages.push(`${cardName}: -{${totalReduction}} (${artifactCount} artifacts × {${reductionPerArtifact}})`);
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
      console.log(`[costReduction] ${cardName}: ${reduction.messages.join(", ")}`);
    }
    
  } catch (err) {
    console.warn("[costReduction] Error calculating cost reduction:", err);
  }
  
  return reduction;
}

/**
 * Extract creature types from a type line
 */
export function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lower = typeLine.toLowerCase();
  
  // Check for creature types after "—" or "-"
  const dashIndex = lower.indexOf("—") !== -1 ? lower.indexOf("—") : lower.indexOf("-");
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
    
    // Check for heroic pattern: "Heroic — Whenever you cast a spell that targets ~"
    // Must match the specific keyword ability format with em-dash or colon
    // Also check for non-keyworded heroic: "Whenever you cast a spell that targets this creature"
    const heroicKeywordMatch = /heroic\s*[—:\-]/i.test(oracleText);
    const hasTargetTrigger = lowerOracle.includes('whenever you cast a spell that targets') && 
                             (lowerOracle.includes('this creature') || lowerOracle.includes('~'));
    
    if (heroicKeywordMatch || hasTargetTrigger) {
      // Extract the effect text - handle multi-sentence effects by capturing until end of ability
      let effectText = '';
      
      // Try to match heroic pattern with em-dash/colon - capture everything after the trigger condition
      // Use a more permissive pattern that captures until newline or end of text
      const heroicMatch = oracleText.match(/heroic\s*[—:\-]\s*whenever you cast a spell that targets [^,\n]+,?\s*(.+?)(?:\n|$)/i);
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
          description: `Heroic — Whenever you cast a spell that targets ${permanent.card.name}, ${effectText}`,
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
      }
      
      // Check for effects that grant haste to all creatures (both players)
      if (grantorOracle.includes('all creatures have haste') ||
          grantorOracle.includes('each creature has haste')) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn('[creatureHasHaste] Error checking haste:', err);
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
      }
      
      // Check for effects that grant to all creatures (both players)
      if (grantorOracle.includes(`all creatures have ${lowerKeyword}`) ||
          grantorOracle.includes(`each creature has ${lowerKeyword}`)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn(`[permanentHasKeyword] Error checking ${keyword}:`, err);
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
  
  // Extract miracle cost - pattern: "Miracle {cost}" or "miracle—{cost}"
  // Handles regular mana symbols, X costs, hybrid mana like {w/u}, and Phyrexian mana like {w/p}
  const miracleMatch = oracleText.match(/miracle[—–\s]*(\{[^}]+\}(?:\{[^}]+\})*)/i);
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
  
  console.log(`[miracle] ${cardName} was drawn as first card this turn - prompting for miracle cost ${miracleCost}`);
  
  emitToPlayer(io, playerId, "miraclePrompt", {
    gameId,
    cardId: firstCard.id,
    cardName,
    imageUrl: cardImageUrl,
    miracleCost: miracleCost || "Miracle cost",
    normalCost: firstCard.mana_cost || "",
  });
}

export function registerGameActions(io: Server, socket: Socket) {
  // Play land from hand
  socket.on("playLand", ({ gameId, cardId, selectedFace }: { gameId: string; cardId: string; selectedFace?: number }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Check land-per-turn limit (before rules engine validation)
      // Default max is 1, but effects like Exploration, Azusa, Rites of Flourishing can increase it
      const landsPlayed = (game.state?.landsPlayedThisTurn?.[playerId] || 0);
      const maxLands = ((game as any).maxLandsPerTurn?.[playerId] ?? (game.state as any)?.maxLandsPerTurn?.[playerId]) || 1;
      console.log(`[playLand] Player ${playerId} has played ${landsPlayed} lands this turn, max is ${maxLands}`);
      if (landsPlayed >= maxLands) {
        socket.emit("error", {
          code: "LAND_LIMIT_REACHED",
          message: maxLands > 1 
            ? `You have already played ${landsPlayed} land(s) this turn (max ${maxLands})`
            : "You have already played a land this turn",
        });
        return;
      }

      // Find the card in hand to get its info before playing
      const zones = game.state?.zones?.[playerId];
      const hand = Array.isArray(zones?.hand) ? zones.hand : [];
      const cardInHand = hand.find((c: any) => c?.id === cardId);
      const cardName = (cardInHand as any)?.name || "";
      const cardImageUrl = (cardInHand as any)?.image_uris?.small || (cardInHand as any)?.image_uris?.normal;
      if (!cardInHand) {
        console.warn(`[playLand] Card ${cardId} not found in hand for player ${playerId}`);
        socket.emit("error", {
          code: "CARD_NOT_IN_HAND",
          message: "Card not found in hand. It may have already been played or moved.",
        });
        return;
      }
      
      // Check if this is a Modal Double-Faced Card (MDFC) like Blightstep Pathway
      const layout = (cardInHand as any)?.layout;
      const cardFaces = (cardInHand as any)?.card_faces;
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
          (cardInHand as any).selectedMDFCFace = 0;
        } else if (!face0IsLand && face1IsLand) {
          // Use back face (it's a land)
          (cardInHand as any).selectedMDFCFace = 1;
        } else if (face0IsLand && face1IsLand) {
          // Both are lands - prompt user to choose
          socket.emit("mdfcFaceSelectionRequest", {
            gameId,
            cardId,
            cardName: cardName,
            title: `Choose which side to play`,
            description: `${cardName} is a Modal Double-Faced Card. Choose which land to play.`,
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
            effectId: `mdfc_${cardId}_${Date.now()}`,
          });
          
          console.log(`[playLand] Requesting MDFC face selection for ${cardName}`);
          return; // Wait for face selection
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
          (cardInHand as any).name = selectedCardFace.name;
          (cardInHand as any).type_line = selectedCardFace.type_line;
          (cardInHand as any).oracle_text = selectedCardFace.oracle_text;
          (cardInHand as any).mana_cost = selectedCardFace.mana_cost;
          if (selectedCardFace.image_uris) {
            (cardInHand as any).image_uris = selectedCardFace.image_uris;
          }
          (cardInHand as any).selectedMDFCFace = selectedFace;
          console.log(`[playLand] Playing MDFC ${cardName} as ${selectedCardFace.name} (face ${selectedFace})`);
        }
      }
      
      // Validate that the card is actually a land (check type_line)
      const typeLine = (cardInHand as any)?.type_line || "";
      const isLand = /\bland\b/i.test(typeLine);
      if (!isLand) {
        console.warn(`[playLand] Card ${cardName} (${cardId}) is not a land. Type line: ${typeLine}`);
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
        console.warn('Legacy playLand failed:', e);
      }
      
      // Persist the event to DB with full card data for reliable replay after server restart
      // Note: We store the full card object so that during replay the card can be placed on
      // the battlefield even if the hand state differs
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "playLand", { 
          playerId, 
          cardId,
          // Include full card data for replay to work correctly after server restart
          card: cardInHand
        });
      } catch (e) {
        console.warn('appendEvent(playLand) failed:', e);
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
          const currentLife = (game.state as any)?.life?.[playerId] || 
                             (game as any)?.life?.[playerId] || 40;
          
          // Emit shock land prompt to the player
          emitToPlayer(io, playerId as string, "shockLandPrompt", {
            gameId,
            permanentId: permanent.id,
            cardName,
            imageUrl: cardImageUrl,
            currentLife,
          });
        }
      }

      // Check if this is a bounce land and prompt the player to return a land
      if (isBounceLand(cardName)) {
        // Find the permanent that was just played by its unique card ID (not by name)
        // This ensures we find the correct permanent when multiple copies of the same card exist
        const battlefield = game.state?.battlefield || [];
        const bounceLandPerm = battlefield.find((p: any) => 
          p.card?.id === cardId && 
          p.controller === playerId
        );
        
        if (bounceLandPerm) {
          // Mark it as tapped (bounce lands always enter tapped)
          bounceLandPerm.tapped = true;
          
          // Find all lands the player controls, INCLUDING the bounce land itself.
          // Per MTG rules, the bounce land can return itself to hand.
          // This is important for turn 1 scenarios where it's the only land you control.
          const availableLands = battlefield.filter((p: any) => {
            if (p.controller !== playerId) return false;
            const typeLine = (p.card?.type_line || '').toLowerCase();
            return typeLine.includes('land');
          });
          
          if (availableLands.length > 0) {
            // Emit bounce land prompt to the player
            emitToPlayer(io, playerId as string, "bounceLandPrompt", {
              gameId,
              bounceLandId: bounceLandPerm.id,
              bounceLandName: cardName,
              imageUrl: cardImageUrl,
              landsToChoose: availableLands.map((p: any) => ({
                permanentId: p.id,
                cardName: p.card?.name || "Land",
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              })),
            });
          }
        }
      }

      // Check for other ETB-tapped lands (temples, gain lands, guildgates, etc.)
      // This detects lands that always enter tapped based on oracle text
      if (!isShockLand(cardName) && !isBounceLand(cardName)) {
        const oracleText = (cardInHand as any)?.oracle_text || '';
        const etbPattern = detectETBTappedPattern(oracleText);
        
        // Find the permanent that was just played
        const battlefield = game.state?.battlefield || [];
        const permanent = battlefield.find((p: any) => 
          p.card?.id === cardId && 
          p.controller === playerId
        );
        
        if (etbPattern === 'always' && permanent && !permanent.tapped) {
          permanent.tapped = true;
          console.log(`[playLand] ${cardName} enters tapped (ETB-tapped pattern detected)`);
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
          // A basic land has "Basic Land" in its type line (e.g., "Basic Land — Forest")
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
            evaluation = evaluateConditionalLandETB(
              oracleText,
              otherLandCount,
              controlledLandTypes,
              playerHand,
              basicLandCount,
              opponentCount
            );
          }
          
          console.log(`[playLand] ${cardName} conditional ETB: ${evaluation.reason}`);
          
          if (evaluation.requiresRevealPrompt && evaluation.canReveal) {
            // Land can be revealed - prompt the player
            emitToPlayer(io, playerId as string, "revealLandPrompt", {
              gameId,
              permanentId: permanent.id,
              cardName,
              imageUrl: cardImageUrl,
              revealTypes: evaluation.revealTypes,
              message: `You may reveal a ${evaluation.revealTypes?.join(' or ')} card from your hand. If you don't, ${cardName} enters tapped.`,
            });
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
      const oracleText = (cardInHand as any)?.oracle_text || '';
      const scryAmount = detectScryOnETB(oracleText);
      if (scryAmount && scryAmount > 0) {
        // Emit scry prompt to the player
        console.log(`[playLand] ${cardName} has "scry ${scryAmount}" ETB trigger`);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${cardName} enters the battlefield. ${getPlayerName(game, playerId)} scries ${scryAmount}.`,
          ts: Date.now(),
        });
        
        // Emit scry event to the player - triggers the scry UI
        emitToPlayer(io, playerId as string, "beginScryPrompt", {
          gameId,
          count: scryAmount,
          sourceName: cardName,
          sourceId: cardId,
        });
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
          // Emit sacrifice-unless-pay prompt to the player
          emitSacrificeUnlessPayPrompt(
            io,
            gameId,
            playerId as string,
            permanent.id,
            cardName,
            sacrificeCost,
            cardImageUrl
          );
          console.log(`[playLand] ${cardName} has "sacrifice unless you pay ${sacrificeCost}" ETB trigger`);
        }
      }

      // Check for creature type selection requirements (e.g., Cavern of Souls, Unclaimed Territory)
      checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
      
      // Check for color choice requirements (e.g., Caged Sun, Gauntlet of Power)
      checkColorChoiceForNewPermanents(io, game, gameId);
      
      // Check for enchantment ETB triggers (e.g., Growing Rites of Itlimoc)
      checkEnchantmentETBTriggers(io, game, gameId);

      // ========================================================================
      // LANDFALL TRIGGERS: Check for and process landfall triggers
      // This is CRITICAL - landfall triggers should fire when a land ETBs
      // ========================================================================
      try {
        const landfallTriggers = getLandfallTriggers(game as any, playerId as string);
        if (landfallTriggers.length > 0) {
          console.log(`[playLand] Found ${landfallTriggers.length} landfall trigger(s) for player ${playerId}`);
          
          // Initialize stack if needed
          (game.state as any).stack = (game.state as any).stack || [];
          
          // Push each landfall trigger onto the stack
          for (const trigger of landfallTriggers) {
            const triggerId = `landfall_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            (game.state as any).stack.push({
              id: triggerId,
              type: 'triggered_ability',
              controller: playerId,
              source: trigger.permanentId,
              sourceName: trigger.cardName,
              description: `Landfall - ${trigger.effect}`,
              triggerType: 'landfall',
              mandatory: trigger.mandatory,
              effect: trigger.effect,
              requiresChoice: trigger.requiresChoice,
            });
            console.log(`[playLand] ⚡ Pushed landfall trigger onto stack: ${trigger.cardName} - ${trigger.effect}`);
            
            // Emit chat message about the trigger
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${trigger.cardName}'s landfall ability triggers!`,
              ts: Date.now(),
            });
          }
          
          // Give priority to active player to respond to triggers
          if ((game.state as any).stack.length > 0) {
            (game.state as any).priority = (game.state as any).turnPlayer || playerId;
          }
        }
      } catch (err) {
        console.warn(`[playLand] Failed to process landfall triggers:`, err);
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`playLand error for game ${gameId}:`, err);
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
  socket.on("requestCastSpell", ({ gameId, cardId, faceIndex }: { gameId: string; cardId: string; faceIndex?: number }) => {
    try {
      console.log(`[requestCastSpell] ======== REQUEST START ========`);
      console.log(`[requestCastSpell] gameId: ${gameId}, cardId: ${cardId}, faceIndex: ${faceIndex}`);
      
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) {
        console.log(`[requestCastSpell] ERROR: game or playerId not found`);
        return;
      }
      
      console.log(`[requestCastSpell] playerId: ${playerId}, priority: ${game.state.priority}`);

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
      if (typeLine.includes("land")) {
        socket.emit("error", { code: "CANNOT_CAST_LAND", message: "Lands cannot be cast as spells." });
        return;
      }

      // Get oracle text (possibly from card face if split/adventure)
      let oracleText = (cardInHand.oracle_text || "").toLowerCase();
      let manaCost = cardInHand.mana_cost || "";
      let cardName = cardInHand.name || "Card";
      
      // Handle split/modal cards
      const cardFaces = cardInHand.card_faces;
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
        }
      }

      // Check if this spell requires targets
      const isInstantOrSorcery = typeLine.includes("instant") || typeLine.includes("sorcery");
      // An Aura is an enchantment with "Aura" in the type line AND "Enchant" at the start of its oracle text
      const isAura = typeLine.includes("aura") && /^enchant\s+/i.test(oracleText);
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
                isOpponent: perm?.controller !== playerId,
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

        // Request targets FIRST (per MTG Rule 601.2c)
        const targetDescription = spellSpec?.targetDescription || targetReqs?.targetDescription || 'target';
        const requiredMinTargets = spellSpec?.minTargets || targetReqs?.minTargets || 1;
        const requiredMaxTargets = spellSpec?.maxTargets || targetReqs?.maxTargets || 1;
        
        socket.emit("targetSelectionRequest", {
          gameId,
          cardId,
          cardName,
          source: cardName,
          title: `Choose ${targetDescription} for ${cardName}`,
          description: oracleText,
          targets: validTargetList,
          minTargets: requiredMinTargets,
          maxTargets: requiredMaxTargets,
          effectId,
        });
        
        console.log(`[requestCastSpell] Emitted targetSelectionRequest for ${cardName} (effectId: ${effectId}, ${validTargetList.length} valid targets)`);
        console.log(`[requestCastSpell] ======== REQUEST END (waiting for targets) ========`);
      } else {
        // No targets needed - go directly to payment
        socket.emit("paymentRequired", {
          gameId,
          cardId,
          cardName,
          manaCost,
          effectId,
          imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
        });
        
        console.log(`[requestCastSpell] No targets needed, emitted paymentRequired for ${cardName}`);
        console.log(`[requestCastSpell] ======== REQUEST END (waiting for payment) ========`);
      }
    } catch (err: any) {
      console.error(`[requestCastSpell] Error:`, err);
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
  const handleCastSpellFromHand = ({ gameId, cardId, targets, payment, skipInteractivePrompts, xValue, alternateCostId }: { 
    gameId: string; 
    cardId: string; 
    targets?: any[]; 
    payment?: PaymentItem[];
    skipInteractivePrompts?: boolean; // NEW: Flag to skip target/payment requests when completing a previous cast
    xValue?: number;
    alternateCostId?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // DEBUG: Log incoming parameters to trace targeting loop
      console.log(`[handleCastSpellFromHand] ======== DEBUG START ========`);
      console.log(`[handleCastSpellFromHand] cardId: ${cardId}`);
      console.log(`[handleCastSpellFromHand] targets: ${targets ? JSON.stringify(targets) : 'undefined'}`);
      console.log(`[handleCastSpellFromHand] payment: ${payment ? JSON.stringify(payment) : 'undefined'}`);
      console.log(`[handleCastSpellFromHand] skipInteractivePrompts: ${skipInteractivePrompts}`);
      console.log(`[handleCastSpellFromHand] playerId: ${playerId}`);
      if (alternateCostId) console.log(`[handleCastSpellFromHand] alternateCostId: ${alternateCostId}`);
      console.log(`[handleCastSpellFromHand] priority: ${game.state.priority}`);

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
      
      // =============================================================================
      // CRITICAL FIX: Skip all interactive prompts when completing a previous cast
      // =============================================================================
      // When skipInteractivePrompts=true (from completeCastSpell), we're completing 
      // a cast that already went through target/payment selection. Jump directly to 
      // the actual casting logic to prevent infinite targeting loops.
      const shouldSkipAllPrompts = skipInteractivePrompts === true;
      
      // Check timing restrictions for sorcery-speed spells
      const oracleText = (cardInHand.oracle_text || "").toLowerCase();
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
            console.log(`[castSpellFromHand] ${cardInHand.name} has flash via Yeva, Nature's Herald`);
            break;
          }
          
          // Vivien, Champion of the Wilds - creature spells have flash
          if ((permName === 'vivien, champion of the wilds' || permName.startsWith('vivien, champion')) && isCreature) {
            hasFlash = true;
            console.log(`[castSpellFromHand] ${cardInHand.name} has flash via Vivien, Champion of the Wilds`);
            break;
          }
          
          // Vedalken Orrery, Leyline of Anticipation - all spells have flash
          if (permName === 'vedalken orrery' || permName === 'leyline of anticipation') {
            hasFlash = true;
            console.log(`[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
            break;
          }
          
          // Emergence Zone (activated ability, check if active this turn)
          if (permName.includes('emergence zone') && (perm as any).flashGrantedThisTurn) {
            hasFlash = true;
            console.log(`[castSpellFromHand] ${cardInHand.name} has flash via Emergence Zone`);
            break;
          }
          
          // Generic detection: "cast ... as though they had flash"
          if (permOracle.includes('as though') && permOracle.includes('had flash')) {
            // Check if it applies to this card type
            if (permOracle.includes('creature') && isCreature) {
              hasFlash = true;
              console.log(`[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
              break;
            }
            if (permOracle.includes('green') && isGreenCard && isCreature) {
              hasFlash = true;
              console.log(`[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
              break;
            }
            if (permOracle.includes('spells') && !permOracle.includes('creature')) {
              // "You may cast spells as though they had flash" - applies to all
              hasFlash = true;
              console.log(`[castSpellFromHand] ${cardInHand.name} has flash via ${(perm as any).card?.name}`);
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
        // Prompt the player to choose land or nonland
        socket.emit("modeSelectionRequest", {
          gameId,
          cardId,
          cardName: cardInHand.name,
          source: cardInHand.name,
          title: `Choose type for ${cardInHand.name}`,
          description: cardInHand.oracle_text || oracleText,
          imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          modes: [
            {
              id: 'land',
              name: 'Land',
              description: 'Reveal cards until you reveal a land card, then put that card into your hand and the rest on the bottom of your library.',
              cost: null,
            },
            {
              id: 'nonland',
              name: 'Nonland',
              description: 'Reveal cards until you reveal a nonland card, then put that card into your hand and the rest on the bottom of your library.',
              cost: null,
            },
          ],
          effectId: `abundant_${cardId}_${Date.now()}`,
          selectionType: 'abundantChoice', // Custom type for handling
        });
        
        console.log(`[castSpellFromHand] Requesting land/nonland choice for ${cardInHand.name} (Abundant Harvest style)`);
        return; // Wait for choice selection
      }
      
      // Check if this spell is a modal spell (Choose one/two/three - e.g., Austere Command, Cryptic Command)
      // Pattern: "Choose two —" or "Choose one —" followed by bullet points
      // IMPORTANT: Only apply to INSTANTS and SORCERIES, not to permanents with triggered abilities
      // Permanents like Glorious Sunrise have "At the beginning of combat on your turn, choose one —" which is a TRIGGER, not a modal spell
      const modalSpellMatch = isInstantOrSorcery ? oracleText.match(/choose\s+(one|two|three|four|any number)\s*(?:—|[-])/i) : null;
      const modesAlreadySelected = (cardInHand as any).selectedModes || (targets as any)?.selectedModes;
      
      // Check for Spree cards (new mechanic from Outlaws of Thunder Junction)
      // Pattern: "Spree (Choose one or more additional costs.)" followed by "+ {cost} — Effect"
      const isSpreeCard = oracleText.includes('spree');
      const spreeModesSelected = (cardInHand as any).selectedSpreeModes || (targets as any)?.selectedSpreeModes;
      
      if (!shouldSkipAllPrompts && isSpreeCard && !spreeModesSelected) {
        // Parse spree costs and effects
        // Pattern: "+ {cost} — Effect text"
        const spreePattern = /\+\s*(\{[^}]+\})\s*[—-]\s*([^+]+?)(?=\+\s*\{|$)/gi;
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
          socket.emit("modalSpellRequest", {
            gameId,
            cardId,
            cardName: cardInHand.name,
            source: cardInHand.name,
            title: `Choose modes for ${cardInHand.name} (Spree)`,
            description: originalOracleText,
            imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            modeCount: -1, // Any number
            canChooseAny: true,
            minModes: 1, // Must choose at least one
            isSpree: true,
            modes: spreeModes,
            effectId: `spree_${cardId}_${Date.now()}`,
          });
          
          console.log(`[castSpellFromHand] Requesting Spree mode selection for ${cardInHand.name}`);
          return; // Wait for mode selection
        }
      }
      
      if (!shouldSkipAllPrompts && modalSpellMatch && !modesAlreadySelected) {
        const modeCount = modalSpellMatch[1].toLowerCase();
        const modeCountMap: Record<string, number> = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'any number': -1 };
        const numModes = modeCountMap[modeCount] ?? -1;
        
        // Extract the mode options (bullet points after "Choose X —")
        // Pattern: "• Mode text" repeated
        const modeOptionsMatch = oracleText.match(/(?:choose\s+(?:one|two|three|four|any number)\s*(?:—|[-]))\s*((?:•[^•]+)+)/i);
        const modeOptions: { id: string; name: string; description: string }[] = [];
        
        if (modeOptionsMatch) {
          const optionsText = modeOptionsMatch[1];
          const bullets = optionsText.split('•').filter(s => s.trim().length > 0);
          
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
          // Prompt for mode selection
          socket.emit("modalSpellRequest", {
            gameId,
            cardId,
            cardName: cardInHand.name,
            source: cardInHand.name,
            title: `Choose ${modeCount} for ${cardInHand.name}`,
            description: oracleText,
            imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            modeCount: numModes,
            canChooseAny: modeCount === 'any number',
            modes: modeOptions,
            effectId: `modal_${cardId}_${Date.now()}`,
          });
          
          console.log(`[castSpellFromHand] Requesting modal selection (choose ${modeCount}) for ${cardInHand.name}`);
          return; // Wait for mode selection
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
        // Prompt the player to choose between normal and overload casting
        socket.emit("modeSelectionRequest", {
          gameId,
          cardId,
          cardName: cardInHand.name,
          source: cardInHand.name,
          title: `Choose casting mode for ${cardInHand.name}`,
          description: cardInHand.oracle_text,
          imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          modes: [
            {
              id: 'normal',
              name: 'Normal',
              description: `Cast ${cardInHand.name} targeting a single permanent`,
              cost: cardInHand.mana_cost,
            },
            {
              id: 'overload',
              name: 'Overload',
              description: `Cast ${cardInHand.name} affecting ALL qualifying permanents (replaces "target" with "each")`,
              cost: overloadCost,
            },
          ],
          effectId: `mode_${cardId}_${Date.now()}`,
        });
        
        console.log(`[castSpellFromHand] Requesting overload mode selection for ${cardInHand.name}`);
        return; // Wait for mode selection
      }

      // Check if this spell requires paying X life (Toxic Deluge, Hatred, etc.)
      // If the player hasn't specified the life payment amount, prompt for it
      const cardNameLower = (cardInHand.name || '').toLowerCase();
      const payXLifeInfo = PAY_X_LIFE_CARDS[cardNameLower];
      const lifePaymentProvided = (payment as any[])?.some((p: any) => typeof p.lifePayment === 'number') ||
                                   (targets as any)?.lifePayment !== undefined;
      
      if (payXLifeInfo && !lifePaymentProvided) {
        // Get the player's current life to determine max payment
        const startingLife = game.state.startingLife || 40;
        const currentLife = game.state.life?.[playerId] ?? startingLife;
        const maxPayable = getMaxPayableLife(currentLife);
        const minPayment = payXLifeInfo.minX || 0;
        
        // Emit a life payment request to the player
        socket.emit("lifePaymentRequest", {
          gameId,
          cardId,
          cardName: cardInHand.name,
          source: cardInHand.name,
          title: `Choose life to pay for ${cardInHand.name}`,
          description: payXLifeInfo.effect,
          imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
          currentLife,
          minPayment,
          maxPayment: maxPayable,
          effectId: `lifepay_${cardId}_${Date.now()}`,
        });
        
        console.log(`[castSpellFromHand] Requesting life payment (${minPayment}-${maxPayable}) for ${cardInHand.name}`);
        return; // Wait for life payment selection
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
        console.log(`[castSpellFromHand] Life payment of ${lifePayment} validated for ${cardInHand.name}`);
      }
      
      // Check for additional costs (discard a card, sacrifice, etc.)
      // This handles cards like Seize the Spoils, Faithless Looting, etc.
      const additionalCost = detectAdditionalCost(oracleText);
      const additionalCostPaid = (payment as any[])?.some((p: any) => p.additionalCostPaid === true) ||
                                  (targets as any)?.additionalCostPaid === true;
      
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
          
          // Emit discard selection request
          socket.emit("additionalCostRequest", {
            gameId,
            cardId,
            cardName: cardInHand.name,
            costType: 'discard',
            amount: additionalCost.amount,
            title: `Discard ${additionalCost.amount} card${additionalCost.amount > 1 ? 's' : ''} to cast ${cardInHand.name}`,
            description: `As an additional cost to cast ${cardInHand.name}, discard ${additionalCost.amount} card${additionalCost.amount > 1 ? 's' : ''}.`,
            imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            availableCards: handCards.map((c: any) => ({
              id: c.id,
              name: c.name,
              imageUrl: c.image_uris?.small || c.image_uris?.normal,
            })),
            effectId: `addcost_${cardId}_${Date.now()}`,
          });
          
          console.log(`[castSpellFromHand] Requesting discard of ${additionalCost.amount} card(s) for ${cardInHand.name}`);
          return; // Wait for discard selection
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
          
          socket.emit("additionalCostRequest", {
            gameId,
            cardId,
            cardName: cardInHand.name,
            costType: 'sacrifice',
            amount: additionalCost.amount,
            filter: additionalCost.filter,
            title: `Sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}${additionalCost.amount > 1 ? 's' : ''} to cast ${cardInHand.name}`,
            description: `As an additional cost to cast ${cardInHand.name}, sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}${additionalCost.amount > 1 ? 's' : ''}.`,
            imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            availableTargets: validSacrificeTargets.map((p: any) => ({
              id: p.id,
              name: p.card?.name || 'Unknown',
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
            })),
            effectId: `addcost_${cardId}_${Date.now()}`,
          });
          
          console.log(`[castSpellFromHand] Requesting sacrifice of ${additionalCost.amount} ${additionalCost.filter || 'permanent'}(s) for ${cardInHand.name}`);
          return; // Wait for sacrifice selection
        } else if (additionalCost.type === 'squad') {
          // Squad: "As an additional cost to cast this spell, you may pay {cost} any number of times"
          // Prompt the player to choose how many times to pay the squad cost
          socket.emit("squadCostRequest", {
            gameId,
            cardId,
            cardName: cardInHand.name,
            squadCost: additionalCost.cost,
            imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            effectId: `squad_${cardId}_${Date.now()}`,
          });
          
          console.log(`[castSpellFromHand] Requesting squad payment for ${cardInHand.name} (cost: ${additionalCost.cost})`);
          return; // Wait for squad payment selection
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
      console.log(`[handleCastSpellFromHand] ${cardInHand.name}: spellSpec=${!!spellSpec}, targetReqs=${!!targetReqs}, needsTargetSelection=${needsTargetSelection}, hasTargets=${!!(targets && targets.length > 0)}`);
      
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
        // This ensures targetSelectionConfirm can find the pending spell and request payment
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
        
        // Emit target selection request for Aura
        socket.emit("targetSelectionRequest", {
          gameId,
          cardId,
          cardName: cardInHand.name,
          source: cardInHand.name,
          title: `Choose target for ${cardInHand.name}`,
          description: `Enchant ${auraTargetType}`,
          targets: validTargets,
          minTargets: 1,
          maxTargets: 1,
          effectId,
        });
        
        console.log(`[castSpellFromHand] Requesting Aura target (enchant ${auraTargetType}) for ${cardInHand.name}`);
        return; // Wait for target selection
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
          console.error(`[castSpellFromHand] LOOP PREVENTION: Pending cast already exists for ${cardInHand.name}. This should not happen!`);
          socket.emit("error", {
            code: "TARGETING_LOOP_DETECTED",
            message: `Targeting error for ${cardInHand.name}. Please try casting again.`,
          });
          return;
        }
        
        // CRITICAL FIX: Skip target request if we're completing a previous cast (prevents infinite loop)
        console.log(`[handleCastSpellFromHand] Checking if need to request targets: skipInteractivePrompts=${skipInteractivePrompts}, hasTargets=${!!(targets && targets.length > 0)}, minRequired=${requiredMinTargets}`);
        
        if (!skipInteractivePrompts && (!targets || targets.length < requiredMinTargets)) {
          console.log(`[handleCastSpellFromHand] Requesting targets for ${cardInHand.name} (minTargets: ${requiredMinTargets}, maxTargets: ${requiredMaxTargets})`);
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
          // This ensures targetSelectionConfirm can find the pending spell and request payment
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
          
          socket.emit("targetSelectionRequest", {
            gameId,
            cardId,
            cardName: cardInHand.name,
            source: cardInHand.name,
            title: `Choose ${targetDescription} for ${cardInHand.name}`,
            description: oracleText,
            targets: validTargetList,
            minTargets: requiredMinTargets,
            maxTargets: requiredMaxTargets,
            effectId,
          });
          
          console.log(`[castSpellFromHand] Requesting ${requiredMinTargets}-${requiredMaxTargets} target(s) for ${cardInHand.name} (${targetDescription})`);
          return; // Wait for target selection
        } else {
          console.log(`[handleCastSpellFromHand] Skipping target request - already have ${targets?.length || 0} target(s) or skipInteractivePrompts=${skipInteractivePrompts}`);
        }
        
        // Validate provided targets if we have a spellSpec
        if (spellSpec && targets && targets.length > 0) {
          console.log(`[handleCastSpellFromHand] Validating ${targets.length} target(s) for ${cardInHand.name}`);
          const validRefs = evaluateTargeting(game.state as any, playerId, spellSpec);
          const validTargetIds = new Set(validRefs.map((t: any) => t.id));
          
          for (const target of targets) {
            const targetId = typeof target === 'string' ? target : target.id;
            if (!validTargetIds.has(targetId)) {
              console.error(`[handleCastSpellFromHand] INVALID TARGET: ${targetId} not in valid set`);
              socket.emit("error", {
                code: "INVALID_TARGET",
                message: `Invalid target for ${cardInHand.name}`,
              });
              return;
            }
          }
          console.log(`[handleCastSpellFromHand] All targets validated successfully`);
        }
      } // Close if (needsTargetSelection)
      
      console.log(`[handleCastSpellFromHand] ======== DEBUG END ========`);

      // Parse the mana cost to validate payment
      const manaCost = cardInHand.mana_cost || "";
      const parsedCost = parseManaCost(manaCost);
      
      // Calculate cost reduction from battlefield effects
      const costReduction = calculateCostReduction(game, playerId, cardInHand, false);
      
      // Apply cost reduction
      const reducedCost = applyCostReduction(parsedCost, costReduction);
      
      // Log cost reduction if any
      if (costReduction.messages.length > 0) {
        console.log(`[castSpellFromHand] Cost reduction for ${cardInHand.name}: ${costReduction.messages.join(", ")}`);
        console.log(`[castSpellFromHand] Original cost: ${manaCost}, Reduced generic: ${parsedCost.generic} -> ${reducedCost.generic}`);
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
        console.log(`[castSpellFromHand] Floating mana available in pool: ${floatingMana}`);
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

      // Handle mana payment: tap permanents to generate mana (adds to pool)
      if (payment && payment.length > 0) {
        console.log(`[castSpellFromHand] Processing payment for ${cardInHand.name}:`, payment);
        
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
                  console.log(`[castSpellFromHand] Added ${bonus.amount} ${bonus.color} bonus mana from enchantments/effects`);
                }
              }
            }
          }
          
          const poolKey = manaColorMap[mana];
          if (poolKey && manaAmount > 0) {
            (game.state.manaPool[playerId] as any)[poolKey] += manaAmount;
            console.log(`[castSpellFromHand] Added ${manaAmount} ${mana} mana to ${playerId}'s pool from ${(permanent as any).card?.name || permanentId}`);
          }
        }
      }
      
      // Consume mana from pool to pay for the spell
      // This uses both floating mana and newly tapped mana, leaving unspent mana for subsequent spells
      const pool = getOrInitManaPool(game.state, playerId);
      consumeManaFromPool(pool, totalColored, totalGeneric, '[castSpellFromHand]');
      
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
            cardTypes: (cardInHand.type_line || '').split('—').map((s: string) => s.trim()),
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
            cardTypes: (cardInHand.type_line || '').split('—').map((s: string) => s.trim()),
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
          console.log(`[castSpellFromHand] Player ${playerId} cast ${cardInHand.name} (${cardId}) - RulesBridge validated`);
        } catch (bridgeErr) {
          console.warn('Rules engine validation failed, falling back to legacy:', bridgeErr);
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
            game.applyEvent({ type: "castSpell", playerId, cardId, targets: targets || [], xValue });
            
            // Verify the spell was actually added to the stack
            const stackLengthAfter = game.state.stack?.length || 0;
            if (stackLengthAfter <= stackLengthBefore) {
              // The spell wasn't added to the stack - something went wrong
              console.error(`[castSpellFromHand] applyEvent did not add spell to stack. Stack: ${stackLengthBefore} -> ${stackLengthAfter}`);
              socket.emit("error", {
                code: "CAST_FAILED",
                message: `Failed to cast ${cardInHand.name}. The card may have been removed or an internal error occurred.`,
              });
              return;
            }
            
            console.log(`[castSpellFromHand] Player ${playerId} cast ${cardInHand.name} (${cardId}) via applyEvent`);
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
              card: { ...removedCard, zone: "stack" },
              targets: targets || [],
              targetDetails: targetDetails.length > 0 ? targetDetails : undefined,
              xValue,
              // Mark if this is an adventure spell (face index 1 is adventure for adventure cards)
              // For adventure cards: faceIndex 1 = adventure side (instant/sorcery), faceIndex 0 or undefined = creature/enchantment side
              // Note: faceIndex is not available in this fallback path
              castAsAdventure: removedCard.layout === 'adventure' ? false : undefined,
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
            
            console.log(`[castSpellFromHand] Player ${playerId} cast ${removedCard.name} (${cardId}) via fallback`);
          }
        }
      } catch (e) {
        console.error('Failed to cast spell:', e);
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
        });
      } catch (e) {
        console.warn('appendEvent(castSpell) failed:', e);
      }
      
      // Check for spell-cast triggers (Jeskai Ascendancy, Beast Whisperer, etc.)
      try {
        const spellCastTriggers = getSpellCastTriggersForCard(game, playerId, cardInHand);
        for (const trigger of spellCastTriggers) {
          console.log(`[castSpellFromHand] Triggered: ${trigger.cardName} - ${trigger.description}`);
          
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
            // Create the token (Deeproot Waters, Murmuring Mystic)
            const tokenId = `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
                zone: "battlefield",
              },
            };
            game.state.battlefield = game.state.battlefield || [];
            game.state.battlefield.push(token as any);
            
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${trigger.cardName}: ${getPlayerName(game, playerId)} creates a ${trigger.tokenDetails.power}/${trigger.tokenDetails.toughness} ${trigger.tokenDetails.name}.`,
              ts: Date.now(),
            });
          }
        }
      } catch (err) {
        console.warn('[castSpellFromHand] Failed to process spell-cast triggers:', err);
      }
      
      // Check for heroic triggers on targeted creatures
      // Heroic: "Whenever you cast a spell that targets this creature..."
      try {
        if (targets && targets.length > 0) {
          const targetIds = targets.map((t: any) => typeof t === 'string' ? t : t.id);
          const heroicTriggers = getHeroicTriggers(game, playerId, targetIds);
          for (const trigger of heroicTriggers) {
            console.log(`[castSpellFromHand] Heroic triggered: ${trigger.cardName} - ${trigger.description}`);
            applyHeroicTrigger(game, trigger, io, gameId);
          }
        }
      } catch (err) {
        console.warn('[castSpellFromHand] Failed to process heroic triggers:', err);
      }
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} cast ${cardInHand.name}.`,
        ts: Date.now(),
      });
      
      handlePendingCascade(io, game, gameId);
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`castSpell error for game ${gameId}:`, err);
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
  socket.on("completeCastSpell", ({ gameId, cardId, targets, payment, effectId, xValue, alternateCostId }: { 
    gameId: string; 
    cardId: string; 
    targets?: any[]; 
    payment?: PaymentItem[];
    effectId?: string;
    xValue?: number;
    alternateCostId?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // DEBUG: Log incoming parameters
      console.log(`[completeCastSpell] DEBUG START ========================================`);
      console.log(`[completeCastSpell] cardId: ${cardId}, effectId: ${effectId}`);
      console.log(`[completeCastSpell] targets from client: ${targets ? JSON.stringify(targets) : 'undefined'}`);
      console.log(`[completeCastSpell] payment from client: ${payment ? JSON.stringify(payment) : 'undefined'}`);
      
      // Check if this is an equip payment completion
      if (effectId && effectId.startsWith('equip_payment_') && (game.state as any).pendingEquipPayments?.[effectId]) {
        const pendingEquip = (game.state as any).pendingEquipPayments[effectId];
        console.log(`[completeCastSpell] Handling equip payment for: ${pendingEquip.equipmentName}`);
        
        // Clean up pending state
        delete (game.state as any).pendingEquipPayments[effectId];
        
        // Re-emit equipTargetChosen with payment to complete the action
        socket.emit("equipTargetChosen", {
          gameId,
          equipmentId: pendingEquip.equipmentId,
          targetCreatureId: pendingEquip.targetCreatureId,
          payment,
          effectId: undefined, // Already cleaned up
        });
        
        // Manually trigger the equipTargetChosen handler logic
        // Actually, we can't re-emit to the same socket easily - let's handle it inline
        const battlefield = game.state?.battlefield || [];
        const equipment = battlefield.find((p: any) => p?.id === pendingEquip.equipmentId && p?.controller === playerId);
        const targetCreature = battlefield.find((p: any) => p?.id === pendingEquip.targetCreatureId && p?.controller === playerId);
        
        if (!equipment || !targetCreature) {
          socket.emit("error", {
            code: "EQUIP_FAILED",
            message: "Equipment or target creature no longer available",
          });
          return;
        }
        
        // Process payment and add mana to pool
        const pool = getOrInitManaPool(game.state, playerId);
        if (payment && payment.length > 0) {
          for (const p of payment) {
            const manaPerm = battlefield.find((perm: any) => perm?.id === p.permanentId);
            if (manaPerm && !manaPerm.tapped) {
              manaPerm.tapped = true;
              for (let i = 0; i < p.count; i++) {
                const manaColor = p.mana.toLowerCase();
                if (manaColor === 'w') pool.white += 1;
                else if (manaColor === 'u') pool.blue += 1;
                else if (manaColor === 'b') pool.black += 1;
                else if (manaColor === 'r') pool.red += 1;
                else if (manaColor === 'g') pool.green += 1;
                else pool.colorless += 1;
              }
            }
          }
        }
        
        // Parse and consume mana for equip cost
        const parsedCost = parseManaCost(pendingEquip.equipCost);
        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[completeCastSpell:equip]');
        
        // Put equip ability on stack
        const equipAbilityId = `equip_ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        game.state.stack = game.state.stack || [];
        game.state.stack.push({
          id: equipAbilityId,
          type: 'ability',
          controller: playerId,
          source: pendingEquip.equipmentId,
          sourceName: pendingEquip.equipmentName,
          description: `Equip ${pendingEquip.equipmentName} to ${pendingEquip.targetCreatureName}`,
          abilityType: 'equip',
          equipParams: {
            equipmentId: pendingEquip.equipmentId,
            targetCreatureId: pendingEquip.targetCreatureId,
            equipmentName: pendingEquip.equipmentName,
            targetCreatureName: pendingEquip.targetCreatureName,
          },
        } as any);
        
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} activated equip ability: ${pendingEquip.equipmentName} targeting ${pendingEquip.targetCreatureName}. Ability on the stack.`,
          ts: Date.now(),
        });
        
        console.log(`[completeCastSpell] Equip ability on stack: ${pendingEquip.equipmentName} → ${pendingEquip.targetCreatureName}`);
        broadcastGame(io, game, gameId);
        return;
      }
      
      // Retrieve targets from pending cast data before cleaning up
      // This ensures Aura targets (stored in targetSelectionConfirm) are preserved
      let finalTargets = targets;
      if (effectId && (game.state as any).pendingSpellCasts?.[effectId]) {
        const pendingCast = (game.state as any).pendingSpellCasts[effectId];
        console.log(`[completeCastSpell] Found pendingCast:`, JSON.stringify(pendingCast, null, 2));
        
        // CRITICAL FIX: Always prefer pending targets over client-sent targets
        // This prevents the infinite targeting loop when client doesn't send targets back
        if (pendingCast.targets && pendingCast.targets.length > 0) {
          finalTargets = pendingCast.targets;
          console.log(`[completeCastSpell] Using pending targets from server: ${finalTargets.join(',')}`);
        } else if (!finalTargets || finalTargets.length === 0) {
          // Fallback: use client-sent targets if no pending targets
          finalTargets = targets || [];
          console.log(`[completeCastSpell] Using client-sent targets: ${finalTargets?.join(',') || 'none'}`);
        }
        
        // CRITICAL FIX: Validate that spell has required targets before allowing cast
        // Check if this spell requires targets based on validTargetIds
        const requiredTargets = pendingCast.validTargetIds && pendingCast.validTargetIds.length > 0;
        if (requiredTargets && (!finalTargets || finalTargets.length === 0)) {
          console.error(`[completeCastSpell] ERROR: Spell ${pendingCast.cardName} requires targets but none provided!`);
          console.error(`[completeCastSpell] validTargetIds: ${JSON.stringify(pendingCast.validTargetIds)}`);
          console.error(`[completeCastSpell] pendingCast.targets: ${JSON.stringify(pendingCast.targets)}`);
          console.error(`[completeCastSpell] client targets: ${JSON.stringify(targets)}`);
          
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
        console.log(`[completeCastSpell] No pendingCast found for effectId: ${effectId}`);
      }
      
      // CRITICAL FIX: Clean up pendingTargets to prevent game from being blocked
      // pendingTargets is set by targetSelectionConfirm but never cleaned up
      if (effectId && game.state.pendingTargets?.[effectId]) {
        console.log(`[completeCastSpell] Cleaning up pendingTargets for effectId: ${effectId}`);
        delete game.state.pendingTargets[effectId];
      }

      console.log(`[completeCastSpell] Final targets to use: ${finalTargets?.join(',') || 'none'}`);
      console.log(`[completeCastSpell] Calling handleCastSpellFromHand with skipInteractivePrompts=true`);
      console.log(`[completeCastSpell] DEBUG END ==========================================`);

      // CRITICAL FIX: Pass skipInteractivePrompts=true to prevent infinite targeting loop
      // This tells handleCastSpellFromHand to skip all target/payment requests since we're completing a previous cast
      handleCastSpellFromHand({ gameId, cardId, targets: finalTargets, payment, skipInteractivePrompts: true, xValue, alternateCostId });
      
    } catch (err: any) {
      console.error(`[completeCastSpell] Error:`, err);
      socket.emit("error", {
        code: "COMPLETE_CAST_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Cast spell from hand - registers the socket event handler
  socket.on("castSpellFromHand", handleCastSpellFromHand);

  // Pass priority
  socket.on("passPriority", ({ gameId, isAutoPass }: { gameId: string; isAutoPass?: boolean }) => {
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
          // Don't resolve yet - prompt the player for their choice
          const zones = game.state?.zones?.[resolvedController];
          const hand = Array.isArray(zones?.hand) ? zones.hand : [];
          
          // Find land cards in hand (using land type check)
          const landCardsInHand = hand
            .filter((c: any) => c && /\bland\b/i.test(c.type_line || ''))
            .map((c: any) => ({
              id: c.id,
              name: c.name || 'Unknown Land',
              imageUrl: c.image_uris?.small || c.image_uris?.normal,
            }));
          
          // Emit prompt to the controller
          emitToPlayer(io, resolvedController as string, "moxDiamondPrompt", {
            gameId,
            stackItemId: topItem.id,
            cardImageUrl: resolvedCard.image_uris?.normal || resolvedCard.image_uris?.small,
            landCardsInHand,
          });
          
          console.log(`[passPriority] Mox Diamond replacement effect: prompting ${resolvedController} to discard a land or put in graveyard`);
          
          // Don't resolve the stack item yet - wait for moxDiamondChoice event
          // Bump sequence and broadcast to show updated state
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
          console.log(`[passPriority] Stack resolved for game ${gameId}`);
          
          // Check for creature type selection requirements on newly entered permanents
          // (e.g., Morophon, Cavern of Souls, Kindred Discovery)
          checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
          
          // Check for color choice requirements on newly entered permanents
          // (e.g., Caged Sun, Gauntlet of Power)
          checkColorChoiceForNewPermanents(io, game, gameId);
          
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
                    // Check if this is a split-destination effect (Cultivate, Kodama's Reach)
                    if (tutorInfo.splitDestination) {
                      s.emit("librarySearchRequest", {
                        gameId,
                        cards: library,
                        title: cardName,
                        description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
                        filter,
                        maxSelections: tutorInfo.maxSelections || 2,
                        moveTo: 'split',
                        splitDestination: true,
                        toBattlefield: tutorInfo.toBattlefield || 1,
                        toHand: tutorInfo.toHand || 1,
                        entersTapped: tutorInfo.entersTapped || false,
                        shuffleAfter: true,
                      });
                    } else {
                      // Regular tutor effect
                      s.emit("librarySearchRequest", {
                        gameId,
                        cards: library,
                        title: cardName,
                        description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
                        filter,
                        maxSelections: tutorInfo.maxSelections || 1,
                        moveTo: tutorInfo.destination || 'hand',
                        shuffleAfter: true,
                      });
                    }
                    break;
                  }
                }
                
                console.log(`[passPriority] Triggered library search for ${cardName} by ${resolvedController} (destination: ${tutorInfo.splitDestination ? 'split' : tutorInfo.destination})`);
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
        
        // Check for pending library search from resolved triggered abilities (e.g., Knight of the White Orchid)
        handlePendingLibrarySearch(io, game, gameId);
        
        // Check for pending Join Forces effects (Minds Aglow, Collective Voyage, etc.)
        handlePendingJoinForces(io, game, gameId);
        
        // Check for pending Tempting Offer effects (Tempt with Discovery, etc.)
        handlePendingTemptingOffer(io, game, gameId);
        
        // Check for pending Ponder-style effects (Ponder, Index, Telling Time, etc.)
        handlePendingPonder(io, game, gameId);
        
        // Check for pending Cascade prompts
        handlePendingCascade(io, game, gameId);
        
        // ========================================================================
        // CRITICAL: Check if there's a pending phase skip that was interrupted
        // by combat triggers. If stack is now empty and all triggers are resolved,
        // automatically continue to the originally requested phase.
        // ========================================================================
        const pendingSkip = (game.state as any).pendingPhaseSkip;
        if (pendingSkip && game.state.stack && game.state.stack.length === 0) {
          const noTriggerQueue = !(game.state as any).triggerQueue || (game.state as any).triggerQueue.length === 0;
          const noPendingOrdering = !(game.state as any).pendingTriggerOrdering || 
                                    Object.keys((game.state as any).pendingTriggerOrdering).length === 0;
          
          if (noTriggerQueue && noPendingOrdering) {
            console.log(`[passPriority] Continuing pending phase skip from BEGIN_COMBAT to ${pendingSkip.targetStep}`);
            
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
              console.warn("appendEvent(skipToPhase auto) failed:", e);
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
          console.log(`[passPriority] All players passed priority - advanced to next step for game ${gameId}`);
          
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
    } catch (err: any) {
      console.error(`passPriority error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "PASS_PRIORITY_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

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

      console.log(`[resolveAllTriggers] Batch resolving ${stack.length} triggers for ${playerId}`);

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

      // After batch resolution, priority goes back to the active player
      state.priority = state.turnPlayer as PlayerID;
      
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`resolveAllTriggers error for game ${gameId}:`, err);
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
        console.error("claimMyTurn: failed to set turnPlayer", e);
        socket.emit("error", {
          code: "CLAIM_TURN_FAILED",
          message: String(e),
        });
      }
    } catch (err) {
      console.error("claimMyTurn handler failed:", err);
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
        appendGameEvent(game, gameId, "randomizeStartingPlayer", { 
          selectedPlayerId: randomPlayer.id,
          by: playerId
        });
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `🎲 ${getPlayerName(game, randomPlayer.id)} was randomly selected to go first!`,
          ts: Date.now(),
        });
        broadcastGame(io, game, gameId);
      } catch (e) {
        console.error("randomizeStartingPlayer: failed to set turnPlayer", e);
        socket.emit("error", {
          code: "RANDOMIZE_FAILED",
          message: String(e),
        });
      }
    } catch (err) {
      console.error("randomizeStartingPlayer handler failed:", err);
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
        console.info(
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
          console.info(
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
          console.info(
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
          console.info(
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
            console.info(
              `[nextTurn] auto-assigned turnPlayer to single player ${playerId}`
            );
          } catch (e) {
            console.warn("nextTurn: auto-assign failed", e);
          }
        } else {
          if (!pregame) {
            socket.emit("error", {
              code: "NEXT_TURN",
              message: "No active player set; cannot advance turn.",
            });
            console.info(
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
              console.info(
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
        console.info(
          `[nextTurn] rejected - stack not empty (len=${game.state.stack.length})`
        );
        return;
      }

      // Invoke underlying implementation
      try {
        if (typeof (game as any).nextTurn === "function") {
          await (game as any).nextTurn();
          console.log(
            `[nextTurn] Successfully advanced turn for game ${gameId}`
          );
        } else {
          console.error(
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
        console.error("nextTurn: game.nextTurn invocation failed:", e);
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
          
          console.log(`[nextTurn] Removed ${concededPermanents.length} permanents from conceded player ${concededPlayerName}`);
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
          message: `🏳️ ${concededPlayerName}'s permanents have been removed from the game.`,
          ts: Date.now(),
        });
        
        // Skip to next player's turn
        if (typeof (game as any).nextTurn === "function") {
          await (game as any).nextTurn();
          console.log(`[nextTurn] Skipped conceded player ${concededPlayerName}, advancing to next player`);
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
        console.warn("appendEvent(nextTurn) failed", e);
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
      console.error(`nextTurn error for game ${gameId}:`, err);
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
        console.info(
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
          console.info(
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
          console.info(
            `[nextStep] rejected - not all players kept hands (waiting: ${waitingPlayers.join(", ")})`
          );
          return;
        }
        
        // During pre-game, directly advance to start the game
        // (no priority passing needed during pre-game setup)
        try {
          if (typeof (game as any).nextStep === "function") {
            await (game as any).nextStep();
            console.log(
              `[nextStep] Pre-game: advanced step for game ${gameId}`
            );
          }
        } catch (e) {
          console.error("nextStep: game.nextStep invocation failed:", e);
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
          console.warn("appendEvent(nextStep) failed", e);
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
            console.log(
              `[nextStep] Single-player: advanced step for game ${gameId}`
            );
          }
        } catch (e) {
          console.error("nextStep: game.nextStep invocation failed:", e);
          return;
        }
        
        try {
          appendEvent(gameId, (game as any).seq || 0, "nextStep", { by: playerId });
        } catch (e) {
          console.warn("appendEvent(nextStep) failed", e);
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
        console.info(
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
          console.log(`[nextStep] Stack resolved for game ${gameId}`);
          
          checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
          checkColorChoiceForNewPermanents(io, game, gameId);
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
      }

      // If all players passed priority with empty stack, advance to next step
      if (advanceStep) {
        if (typeof (game as any).nextStep === 'function') {
          (game as any).nextStep();
          console.log(`[nextStep] All players passed priority - advanced to next step for game ${gameId}`);
          
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
              console.log(`[nextStep] Auto-pass detected after step advancement (iteration ${autoPassLoopCount + 1}), advancing again`);
              
              // Clear the flag before calling nextStep
              delete (game.state as any)._autoPassResult;
              
              // Advance to the next step
              (game as any).nextStep();
              
              const newStep2 = (game.state as any)?.step || 'unknown';
              console.log(`[nextStep] Auto-advanced to ${newStep2}`);
              
              autoPassLoopCount++;
            } else {
              // No more auto-pass, break the loop
              break;
            }
          }
          
          if (autoPassLoopCount >= MAX_AUTO_PASS_LOOPS) {
            console.warn(`[nextStep] Auto-pass loop limit reached (${MAX_AUTO_PASS_LOOPS}), stopping to prevent infinite loop`);
          }
          
          // Clear any remaining auto-pass flag
          delete (game.state as any)._autoPassResult;
        }
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`nextStep error for game ${gameId}:`, err);
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
        console.info(
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
      
      // Ensure there are no pending triggers that need to be resolved
      if ((game.state as any).triggerQueue && (game.state as any).triggerQueue.length > 0) {
        socket.emit("error", {
          code: "SKIP_TO_PHASE",
          message: "Cannot skip phases while there are pending triggers. Resolve or order them first.",
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
        console.log(`[skipToPhase] STOPPING at ${stopStep}: Found ${triggers.length} trigger(s) that must resolve first`);
        
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
        for (const trigger of triggers) {
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
          const playerTriggers = triggersByController.get(playerId) || [];
          if (playerTriggers.length === 0) continue;
          
          // If multiple triggers, add to queue for ordering
          if (playerTriggers.length > 1) {
            (game.state as any).triggerQueue = (game.state as any).triggerQueue || [];
            
            for (const trigger of playerTriggers) {
              const triggerId = uid(`${triggerType}_trigger`);
              (game.state as any).triggerQueue.push({
                id: triggerId,
                sourceId: trigger.permanentId,
                sourceName: trigger.cardName,
                effect: trigger.description || trigger.effect,
                type: 'order',
                controllerId: playerId,
                triggerType: triggerType,
                mandatory: trigger.mandatory !== false,
              });
            }
            
            (game.state as any).pendingTriggerOrdering = (game.state as any).pendingTriggerOrdering || {};
            (game.state as any).pendingTriggerOrdering[playerId] = {
              timing: triggerType,
              count: playerTriggers.length,
            };
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
        
        console.log(`[skipToPhase] Set phase to ${stopStep} with ${triggers.length} trigger(s). Will continue to ${targetStep} after resolution.`);
        
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
          console.warn("appendEvent(skipToPhase) failed:", e);
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
          console.warn(`[skipToPhase] Failed to check upkeep triggers:`, err);
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
          console.warn(`[skipToPhase] Failed to check combat triggers:`, err);
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
          console.warn(`[skipToPhase] Failed to check end step triggers:`, err);
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
            console.log(`[skipToPhase] Untapped ${untappedCount} permanent(s) for ${turnPlayer}`);
          }
        } catch (err) {
          console.warn(`[skipToPhase] Failed to untap permanents:`, err);
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
              console.warn(`[skipToPhase] Failed to recalculate player effects:`, recalcErr);
            }
            
            // Calculate total cards to draw: 1 (base) + any additional draws from effects
            const additionalDraws = (game as any).additionalDrawsPerTurn?.[turnPlayer] || 0;
            const totalDraws = 1 + additionalDraws;
            
            const drawn = (game as any).drawCards(turnPlayer, totalDraws);
            console.log(
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
              console.warn("appendEvent(drawCards) failed:", e);
            }
          }
        } catch (err) {
          console.warn(`[skipToPhase] Failed to draw card:`, err);
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
        console.warn(`[skipToPhase] Failed to clear combat state:`, err);
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
        
        console.log(`[skipToPhase] Reset priority tracking, priority set to ${turnPlayer}`);
      } catch (err) {
        console.warn(`[skipToPhase] Failed to reset priority tracking:`, err);
      }

      // Handle CLEANUP phase specially - need to check for discard and auto-advance to next turn
      const isCleanupPhase = targetStepUpper === "CLEANUP";
      let needsDiscardSelection = false;

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
            console.log(`[skipToPhase] Player ${turnPlayer} has no maximum hand size effect`);
          } else {
            const discardCount = Math.max(0, hand.length - maxHandSize);

            if (discardCount > 0) {
              // Player needs to choose cards to discard - set pending state
              (game.state as any).pendingDiscardSelection = (game.state as any).pendingDiscardSelection || {};
              (game.state as any).pendingDiscardSelection[turnPlayer] = {
                count: discardCount,
                maxHandSize: maxHandSize,
              };
              needsDiscardSelection = true;
              console.log(`[skipToPhase] Player ${turnPlayer} needs to discard ${discardCount} cards during cleanup`);
            }
          }
        } catch (err) {
          console.warn(`[skipToPhase] Failed to check discard during cleanup:`, err);
        }

        // If no discard needed, clear damage from permanents and end temporary effects
        if (!needsDiscardSelection) {
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
            console.log(`[skipToPhase] Cleared damage from permanents during cleanup`);
          } catch (err) {
            console.warn(`[skipToPhase] Failed to clear damage during cleanup:`, err);
          }

          // Auto-advance to next turn since no discard is needed
          try {
            if (typeof (game as any).nextTurn === "function") {
              (game as any).nextTurn();
              console.log(`[skipToPhase] Cleanup complete, advanced to next turn for game ${gameId}`);
            }
          } catch (err) {
            console.warn(`[skipToPhase] Failed to advance to next turn after cleanup:`, err);
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
        console.warn("appendEvent(skipToPhase) failed", e);
      }

      console.log(
        `[skipToPhase] Skipped to phase=${targetPhase}, step=${targetStep} for game ${gameId}`
      );

      // Different message based on whether we're going to cleanup or regular phase
      const chatMessage = isCleanupPhase 
        ? (needsDiscardSelection 
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
      console.error(`skipToPhase error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "SKIP_TO_PHASE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Shuffle player's hand (server-authoritative) — randomize order of cards in hand.
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
          console.log(
            `[shuffleHand] Shuffled hand for player ${playerId} in game ${gameId}`
          );
        } else {
          // Fallback to direct manipulation if engine method not available
          console.warn(
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
        console.error("shuffleHand failed:", e);
        socket.emit("error", {
          code: "SHUFFLE_HAND_ERROR",
          message: String(e),
        });
      }
    } catch (err) {
      console.error("shuffleHand handler error:", err);
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

        console.info(
          "[reorderHand] Received request for game",
          gameId,
          ", order length:",
          order.length
        );
        console.info(
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
              console.info(
                "[reorderHand] Fallback to state.zones hand, length:",
                hand.length
              );
            }
          } catch {
            // ignore fallback errors
          }
        }

        console.info(
          "[reorderHand] Current hand length:",
          hand.length,
          ", order length:",
          order.length
        );

        if (!hand.length) {
          console.warn("[reorderHand] No hand found for player", playerId);
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
            console.warn(
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
            console.warn(
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
        console.error("reorderHand handler error:", err);
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
        (game.state as any).mulliganState[playerId] = {
          hasKeptHand: false, // Not fully kept yet - need to put cards back
          mulligansTaken,
          pendingBottomCount: effectiveMulliganCount, // Cards to put to bottom after house rule discounts
        };

        // Bump sequence
        if (typeof game.bumpSeq === "function") {
          game.bumpSeq();
        }

        // Emit the bottom selection prompt to the player
        emitToPlayer(io, playerId as string, "mulliganBottomPrompt", {
          gameId,
          cardsToBottom: effectiveMulliganCount,
        });

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
          console.warn("appendEvent(keepHand) failed:", e);
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
      console.error(`keepHand error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "KEEP_HAND_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Complete London Mulligan - put selected cards to bottom of library in random order
  socket.on("mulliganPutToBottom", ({ gameId, cardIds }: { gameId: string; cardIds: string[] }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Validate the mulligan state
      const mulliganState = (game.state as any).mulliganState?.[playerId];
      if (!mulliganState || mulliganState.hasKeptHand) {
        socket.emit("error", {
          code: "INVALID_STATE",
          message: "No pending mulligan bottom selection",
        });
        return;
      }

      const pendingBottomCount = mulliganState.pendingBottomCount || 0;
      if (!cardIds || cardIds.length !== pendingBottomCount) {
        socket.emit("error", {
          code: "INVALID_SELECTION",
          message: `Must select exactly ${pendingBottomCount} cards to put to bottom`,
        });
        return;
      }

      // Get the player's hand
      const zones = game.state?.zones?.[playerId];
      if (!zones || !Array.isArray(zones.hand)) {
        socket.emit("error", {
          code: "NO_HAND",
          message: "Hand not found",
        });
        return;
      }

      // Validate that all selected cards are in hand
      const hand = zones.hand as any[];
      const handIds = new Set(hand.map((c: any) => c?.id));
      for (const cardId of cardIds) {
        if (!handIds.has(cardId)) {
          socket.emit("error", {
            code: "CARD_NOT_IN_HAND",
            message: "Selected card not found in hand",
          });
          return;
        }
      }

      // Remove selected cards from hand
      const cardsToBottom: any[] = [];
      for (const cardId of cardIds) {
        const idx = hand.findIndex((c: any) => c?.id === cardId);
        if (idx !== -1) {
          const [card] = hand.splice(idx, 1);
          cardsToBottom.push(card);
        }
      }

      // Shuffle the cards before putting to bottom (random order as per rules)
      for (let i = cardsToBottom.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cardsToBottom[i], cardsToBottom[j]] = [cardsToBottom[j], cardsToBottom[i]];
      }

      // Get the library and add cards to the bottom
      const lib = typeof game.libraries?.get === "function" 
        ? game.libraries.get(playerId) || []
        : [];
      
      for (const card of cardsToBottom) {
        card.zone = "library";
        lib.push(card);
      }

      // Update library
      if (typeof game.libraries?.set === "function") {
        game.libraries.set(playerId, lib);
      }

      // Update zone counts
      zones.handCount = hand.length;
      zones.libraryCount = lib.length;

      // Mark mulligan as complete
      (game.state as any).mulliganState[playerId] = {
        hasKeptHand: true,
        mulligansTaken: mulliganState.mulligansTaken,
      };

      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "mulliganPutToBottom", { 
          playerId, 
          cardIds,
          mulligansTaken: mulliganState.mulligansTaken,
        });
      } catch (e) {
        console.warn("appendEvent(mulliganPutToBottom) failed:", e);
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} keeps their hand (${hand.length} cards, put ${cardsToBottom.length} to bottom).`,
        ts: Date.now(),
      });

      // Check for opening hand actions (Leylines) and prompt if any exist
      checkAndPromptOpeningHandActions(io, game, gameId, playerId);

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`mulliganPutToBottom error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "MULLIGAN_BOTTOM_ERROR",
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
        console.error("Mulligan hand manipulation failed:", e);
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
        console.warn("appendEvent(mulligan) failed:", e);
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
      console.error(`mulligan error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "MULLIGAN_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Cleanup step discard - player selects which cards to discard when over max hand size
  socket.on("cleanupDiscard", ({ gameId, cardIds }: { gameId: string; cardIds: string[] }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Validate the pending discard state
      const pendingDiscard = (game.state as any).pendingDiscardSelection?.[playerId];
      if (!pendingDiscard) {
        socket.emit("error", {
          code: "INVALID_STATE",
          message: "No pending discard selection",
        });
        return;
      }

      if (!cardIds || cardIds.length !== pendingDiscard.count) {
        socket.emit("error", {
          code: "INVALID_SELECTION",
          message: `Must select exactly ${pendingDiscard.count} cards to discard`,
        });
        return;
      }

      // Get the player's hand
      const zones = game.state?.zones?.[playerId];
      if (!zones || !Array.isArray(zones.hand)) {
        socket.emit("error", {
          code: "NO_HAND",
          message: "Hand not found",
        });
        return;
      }

      // Validate that all selected cards are in hand
      const hand = zones.hand as any[];
      const handIds = new Set(hand.map((c: any) => c?.id));
      for (const cardId of cardIds) {
        if (!handIds.has(cardId)) {
          socket.emit("error", {
            code: "CARD_NOT_IN_HAND",
            message: "Selected card not found in hand",
          });
          return;
        }
      }

      // Discard selected cards
      const discardedCards: any[] = [];
      for (const cardId of cardIds) {
        const idx = hand.findIndex((c: any) => c?.id === cardId);
        if (idx !== -1) {
          const [card] = hand.splice(idx, 1);
          discardedCards.push(card);
          
          // Move card to graveyard
          zones.graveyard = zones.graveyard || [];
          card.zone = "graveyard";
          zones.graveyard.push(card);
        }
      }

      // Update counts
      zones.handCount = hand.length;
      zones.graveyardCount = zones.graveyard.length;

      // Clear the pending discard state (with safe check)
      if ((game.state as any).pendingDiscardSelection) {
        delete (game.state as any).pendingDiscardSelection[playerId];
      }

      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "cleanupDiscard", { 
          playerId, 
          cardIds,
          discardCount: discardedCards.length,
        });
      } catch (e) {
        console.warn("appendEvent(cleanupDiscard) failed:", e);
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} discards ${discardedCards.length} card${discardedCards.length !== 1 ? 's' : ''} to maximum hand size.`,
        ts: Date.now(),
      });

      // Now continue to advance the turn since discard is complete
      try {
        if (typeof (game as any).nextTurn === "function") {
          (game as any).nextTurn();
          console.log(`[cleanupDiscard] Advanced to next turn for game ${gameId}`);
        }
      } catch (e) {
        console.warn("[cleanupDiscard] Failed to advance to next turn:", e);
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`cleanupDiscard error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CLEANUP_DISCARD_ERROR",
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
        console.warn("appendEvent(adjustLife) failed:", e);
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
        message: `${targetName} ${actionType} ${actionAmount} life. (${currentLife} → ${newLife})`,
        ts: Date.now(),
      });

      console.log(`[adjustLife] ${targetName} ${actionType} ${actionAmount} life (${currentLife} → ${newLife}) in game ${gameId}`);

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
                message: `🎯 Lifegain trigger: ${trigger.cardName} - ${trigger.effect}`,
                ts: Date.now(),
              });
            }
          }
        } catch (triggerErr) {
          console.warn("Error detecting lifegain triggers:", triggerErr);
        }
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`adjustLife error for game ${gameId}:`, err);
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
        console.warn("appendEvent(setLife) failed:", e);
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

      console.log(`[setLife] ${targetName}'s life set to ${life} (was ${currentLife}) in game ${gameId}`);

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
      console.error(`setLife error for game ${gameId}:`, err);
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
        console.warn("appendEvent(mill) failed:", e);
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

      console.log(`[mill] ${targetName} milled ${actualCount} cards in game ${gameId}`);

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`mill error for game ${gameId}:`, err);
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
        });
      } catch (e) {
        console.warn("appendEvent(setHouseRules) failed:", e);
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
        message: `🏠 ${getPlayerName(game, playerId)} updated house rules. ${rulesMessage}`,
        ts: Date.now(),
      });

      console.log(`[setHouseRules] ${playerId} set house rules for game ${gameId}:`, houseRules);

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`setHouseRules error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "SET_HOUSE_RULES_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // ============================================================================
  // Miracle Handling (Rule 702.94)
  // ============================================================================

  /**
   * Handle miracle cast - player chose to cast a spell for its miracle cost
   * This is called when a player decides to cast a spell for its miracle cost
   * after drawing it as the first card this turn.
   */
  socket.on("castMiracle", ({ gameId, cardId, payment }: {
    gameId: string;
    cardId: string;
    payment?: PaymentItem[];
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId || socket.data.spectator) return;

      // Find the card in hand
      const zones = game.state?.zones?.[playerId];
      if (!zones || !Array.isArray(zones.hand)) {
        socket.emit("error", {
          code: "NO_HAND",
          message: "Hand not found",
        });
        return;
      }

      const hand = zones.hand as any[];
      const cardInHand = hand.find((c: any) => c?.id === cardId);
      
      if (!cardInHand) {
        socket.emit("error", {
          code: "CARD_NOT_IN_HAND",
          message: "Card not found in hand",
        });
        return;
      }

      // Verify this card was the first drawn this turn
      if (!cardInHand.isFirstDrawnThisTurn) {
        socket.emit("error", {
          code: "NOT_FIRST_DRAWN",
          message: "Miracle can only be cast on the first card drawn this turn",
        });
        return;
      }

      // Verify the card has miracle
      const { hasMiracle, miracleCost } = checkMiracle(cardInHand);
      if (!hasMiracle) {
        socket.emit("error", {
          code: "NO_MIRACLE",
          message: "This card does not have miracle",
        });
        return;
      }

      // Process the miracle cost payment and cast
      // (Similar to castSpellFromHand but with miracle cost)
      const parsedCost = parseManaCost(miracleCost || '');
      
      // Handle mana payment (same as regular casting)
      if (payment && payment.length > 0) {
        const globalBattlefield = game.state?.battlefield || [];
        for (const { permanentId, mana, count } of payment) {
          const permanent = globalBattlefield.find((p: any) => p?.id === permanentId && p?.controller === playerId);
          if (!permanent) continue;
          if ((permanent as any).tapped) continue;
          
          (permanent as any).tapped = true;
          
          const manaColorMap: Record<string, string> = {
            'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green', 'C': 'colorless',
          };
          
          // Initialize mana pool
          game.state.manaPool = game.state.manaPool || {};
          (game.state.manaPool as any)[playerId] = (game.state.manaPool as any)[playerId] || {
            white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
          };
          
          const manaAmount = count || 1;
          const poolKey = manaColorMap[mana];
          if (poolKey && manaAmount > 0) {
            (game.state.manaPool[playerId] as any)[poolKey] += manaAmount;
          }
        }
      }

      // Consume mana from pool
      const pool = getOrInitManaPool(game.state, playerId);
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[castMiracle]');

      // Remove from hand and add to stack
      const idx = hand.findIndex((c: any) => c?.id === cardId);
      if (idx !== -1) {
        const [removedCard] = hand.splice(idx, 1);
        zones.handCount = hand.length;
        
        // Clear the first drawn flag
        delete removedCard.isFirstDrawnThisTurn;
        delete removedCard.drawnAt;
        
        // Add to stack
        game.state.stack = game.state.stack || [];
        const stackItem = {
          id: `stack_${Date.now()}_${cardId}`,
          controller: playerId,
          card: { ...removedCard, zone: "stack" },
          targets: [],
          castWithMiracle: true,
        };
        game.state.stack.push(stackItem as any);
      }

      // Bump sequence
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "castMiracle", {
          playerId,
          cardId,
          cardName: cardInHand.name,
          miracleCost,
        });
      } catch (e) {
        console.warn("appendEvent(castMiracle) failed:", e);
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `✨ ${getPlayerName(game, playerId)} cast ${cardInHand.name} for its miracle cost!`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`castMiracle error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CAST_MIRACLE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle declining miracle - player chose not to cast the spell for miracle cost
   * The card remains in hand as a normal card.
   */
  socket.on("declineMiracle", ({ gameId, cardId }: {
    gameId: string;
    cardId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId || socket.data.spectator) return;

      // Find the card in hand and clear the miracle flag
      const zones = game.state?.zones?.[playerId];
      if (!zones || !Array.isArray(zones.hand)) return;

      const hand = zones.hand as any[];
      const cardInHand = hand.find((c: any) => c?.id === cardId);
      
      if (cardInHand) {
        // Clear the first drawn flag - player declined miracle
        delete cardInHand.isFirstDrawnThisTurn;
        delete cardInHand.drawnAt;
        
        console.log(`[declineMiracle] ${playerId} declined miracle for ${cardInHand.name}`);
      }

      // Bump sequence
      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`declineMiracle error for game ${gameId}:`, err);
    }
  });

  /**
   * Handle mode selection for modal spells (overload, kicker, etc.)
   * After the player selects a mode, re-emit castSpellFromHand with the selected mode.
   */
  socket.on("modeSelectionConfirm", async ({ gameId, cardId, selectedMode, effectId }: {
    gameId: string;
    cardId: string;
    selectedMode: string;
    effectId?: string;
  }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) {
        socket.emit("error", { code: "NOT_JOINED", message: "You must join the game first" });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
        return;
      }

      // Find the card in hand
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

      console.log(`[modeSelectionConfirm] Player ${playerId} selected mode '${selectedMode}' for ${cardInHand.name}`);

      if (selectedMode === 'overload') {
        // Player wants to cast with overload
        // The overload version doesn't require targets - it affects ALL qualifying permanents
        
        // Extract overload cost from oracle text
        const oracleText = (cardInHand.oracle_text || "").toLowerCase();
        const overloadMatch = oracleText.match(/overload\s*\{([^}]+)\}/i);
        const overloadCost = overloadMatch ? `{${overloadMatch[1]}}` : null;
        
        if (!overloadCost) {
          socket.emit("error", { code: "NO_OVERLOAD_COST", message: "Could not determine overload cost" });
          return;
        }
        
        // Mark the card as being cast with overload
        (cardInHand as any).castWithOverload = true;
        (cardInHand as any).overloadCost = overloadCost;
        
        // Re-emit castSpellFromHand with overload flag
        // For overload, we don't need targets since it affects all permanents
        socket.emit("overloadCastRequest", {
          gameId,
          cardId,
          cardName: cardInHand.name,
          overloadCost,
          effectId: `overload_${cardId}_${Date.now()}`,
        });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} is casting ${cardInHand.name} with Overload!`,
          ts: Date.now(),
        });
        
        broadcastGame(io, game, gameId);
      } else {
        // Normal casting mode - proceed with regular targeting/casting flow
        // Remove any overload flag
        delete (cardInHand as any).castWithOverload;
        delete (cardInHand as any).overloadCost;
        
        // This will continue to the normal target selection flow
        // The spell already needs targets, so we let the normal flow handle it
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} is casting ${cardInHand.name} normally.`,
          ts: Date.now(),
        });
      }
      
    } catch (err: any) {
      console.error(`modeSelectionConfirm error:`, err);
      socket.emit("error", { code: "INTERNAL_ERROR", message: err.message || "Mode selection failed" });
    }
  });

  /**
   * Handle modal spell selection confirmation (Austere Command, Cryptic Command, etc.)
   * Player chooses one/two/three modes from the available options.
   */
  socket.on("modalSpellConfirm", async ({ gameId, cardId, selectedModes, effectId }: {
    gameId: string;
    cardId: string;
    selectedModes: string[];
    effectId?: string;
  }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) {
        socket.emit("error", { code: "NOT_JOINED", message: "You must join the game first" });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
        return;
      }

      // Find the card in hand
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

      console.log(`[modalSpellConfirm] Player ${playerId} selected modes [${selectedModes.join(', ')}] for ${cardInHand.name}`);

      // Store the selected modes on the card
      (cardInHand as any).selectedModes = selectedModes;

      // Format mode descriptions for chat message
      // Mode IDs are like "mode_1", "mode_2" - extract the descriptions from oracle text
      const oracleText = cardInHand.oracle_text || '';
      const modeDescriptions = selectedModes.map((modeId: string) => {
        const modeNum = parseInt(modeId.replace('mode_', ''), 10);
        // Try to extract the mode text from bullet points
        const modeOptionsMatch = oracleText.match(/(?:choose\s+(?:one|two|three|four|any number)\s*(?:—|[-]))\s*((?:•[^•]+)+)/i);
        if (modeOptionsMatch) {
          const bullets = modeOptionsMatch[1].split('•').filter((s: string) => s.trim().length > 0);
          if (bullets[modeNum - 1]) {
            return bullets[modeNum - 1].trim().substring(0, 50) + (bullets[modeNum - 1].trim().length > 50 ? '...' : '');
          }
        }
        return `Mode ${modeNum}`;
      });

      // Announce mode selection
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} chose modes for ${cardInHand.name}: ${modeDescriptions.join(' and ')}`,
        ts: Date.now(),
      });

      // Continue with normal spell casting flow
      // The selected modes will be processed when the spell resolves
      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`modalSpellConfirm error:`, err);
      socket.emit("error", { code: "INTERNAL_ERROR", message: err.message || "Modal spell selection failed" });
    }
  });

  /**
   * Handle Abundant Harvest choice confirmation
   * Player chooses "land" or "nonland", then we reveal cards until finding one
   */
  socket.on("abundantChoiceConfirm", async ({ gameId, cardId, choice, effectId }: {
    gameId: string;
    cardId: string;
    choice: 'land' | 'nonland';
    effectId?: string;
  }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) {
        socket.emit("error", { code: "NOT_JOINED", message: "You must join the game first" });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
        return;
      }

      // Find the card in hand
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

      console.log(`[abundantChoiceConfirm] Player ${playerId} chose "${choice}" for ${cardInHand.name}`);

      // Store the choice on the card
      (cardInHand as any).abundantChoice = choice;

      // Reveal cards from library until finding the chosen type
      const library = (zones as any).library as any[] || [];
      const revealed: any[] = [];
      let foundCard: any = null;

      for (const card of library) {
        revealed.push(card);
        const typeLine = (card.type_line || '').toLowerCase();
        const isLand = typeLine.includes('land');
        
        if ((choice === 'land' && isLand) || (choice === 'nonland' && !isLand)) {
          foundCard = card;
          break;
        }
      }

      // Announce the reveal
      const choiceText = choice === 'land' ? 'land' : 'nonland';
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} chose "${choiceText}" for ${cardInHand.name} and revealed ${revealed.length} card(s).`,
        ts: Date.now(),
      });

      if (foundCard) {
        // Move found card to hand
        (zones as any).library = library.filter((c: any) => c.id !== foundCard.id);
        zones.hand.push(foundCard);
        
        // Put rest on bottom of library in random order
        const rest = revealed.filter((c: any) => c.id !== foundCard.id);
        (zones as any).library = (zones as any).library.filter((c: any) => !rest.some((r: any) => r.id === c.id));
        (zones as any).library.push(...rest);

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} found and put ${foundCard.name} into their hand.`,
          ts: Date.now(),
        });
      } else {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} did not find a ${choiceText} card.`,
          ts: Date.now(),
        });
      }

      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`abundantChoiceConfirm error:`, err);
      socket.emit("error", { code: "INTERNAL_ERROR", message: err.message || "Abundant choice confirmation failed" });
    }
  });

  /**
   * Handle life payment confirmation for spells like Toxic Deluge, Hatred, etc.
   * Player chooses how much life to pay (X) as part of the spell's additional cost.
   */
  socket.on("lifePaymentConfirm", async ({ gameId, cardId, lifePayment, effectId }: {
    gameId: string;
    cardId: string;
    lifePayment: number;
    effectId?: string;
  }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) {
        socket.emit("error", { code: "NOT_JOINED", message: "You must join the game first" });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
        return;
      }

      // Validate the life payment
      const startingLife = game.state.startingLife || 40;
      const currentLife = game.state.life?.[playerId] ?? startingLife;
      
      const validationError = validateLifePayment(currentLife, lifePayment);
      if (validationError) {
        socket.emit("error", { code: "INVALID_LIFE_PAYMENT", message: validationError });
        return;
      }

      // Find the card in hand
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

      console.log(`[lifePaymentConfirm] Player ${playerId} paying ${lifePayment} life for ${cardInHand.name}`);

      // Store the life payment amount on the card for resolution
      (cardInHand as any).lifePaymentAmount = lifePayment;
      
      // Pay the life immediately (additional costs are paid when casting)
      game.state.life = game.state.life || {};
      game.state.life[playerId] = currentLife - lifePayment;
      
      // Sync to player object
      const player = (game.state.players || []).find((p: any) => p.id === playerId);
      if (player) {
        player.life = game.state.life[playerId];
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} pays ${lifePayment} life for ${cardInHand.name}. (${currentLife} → ${game.state.life[playerId]})`,
        ts: Date.now(),
      });

      // Continue with casting - emit an event to continue the cast with life payment info
      socket.emit("lifePaymentComplete", {
        gameId,
        cardId,
        lifePayment,
        effectId,
      });

      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      console.error(`lifePaymentConfirm error:`, err);
      socket.emit("error", { code: "INTERNAL_ERROR", message: err.message || "Life payment failed" });
    }
  });

  /**
   * Handle additional cost confirmation (discard, sacrifice, etc.)
   * This handles cards like Seize the Spoils, Faithless Looting, etc.
   */
  socket.on("additionalCostConfirm", async ({ gameId, cardId, costType, selectedCards, effectId }: {
    gameId: string;
    cardId: string;
    costType: 'discard' | 'sacrifice';
    selectedCards: string[]; // IDs of cards/permanents selected to pay the cost
    effectId?: string;
  }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) {
        socket.emit("error", { code: "NOT_JOINED", message: "You must join the game first" });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
        return;
      }

      const zones = game.state.zones?.[playerId];
      if (!zones) {
        socket.emit("error", { code: "NO_ZONES", message: "Player zones not found" });
        return;
      }

      const cardInHand = (zones.hand as any[]).find((c: any) => c && c.id === cardId);
      if (!cardInHand) {
        socket.emit("error", { code: "CARD_NOT_IN_HAND", message: "Card not found in hand" });
        return;
      }

      console.log(`[additionalCostConfirm] ${playerId} paying ${costType} cost for ${cardInHand.name} with ${selectedCards.length} selection(s)`);

      // Declare these at outer scope so they can be accessed in the event logging
      let discardedCards: string[] = [];
      let sacrificedNames: string[] = [];

      if (costType === 'discard') {
        // Discard the selected cards
        for (const discardId of selectedCards) {
          const discardIndex = (zones.hand as any[]).findIndex((c: any) => c && c.id === discardId);
          if (discardIndex !== -1) {
            const discarded = (zones.hand as any[]).splice(discardIndex, 1)[0];
            zones.graveyard = zones.graveyard || [];
            discarded.zone = 'graveyard';
            zones.graveyard.push(discarded);
            discardedCards.push(discarded.name || 'Unknown');
          }
        }
        zones.handCount = zones.hand.length;
        zones.graveyardCount = zones.graveyard.length;

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} discards ${discardedCards.join(', ')} as an additional cost.`,
          ts: Date.now(),
        });
      } else if (costType === 'sacrifice') {
        // Sacrifice the selected permanents
        const battlefield = game.state.battlefield || [];
        
        for (const permId of selectedCards) {
          const permIndex = battlefield.findIndex((p: any) => p && p.id === permId);
          if (permIndex !== -1) {
            const perm = battlefield[permIndex];
            battlefield.splice(permIndex, 1);
            
            // Move to graveyard
            zones.graveyard = zones.graveyard || [];
            if (perm.card) {
              perm.card.zone = 'graveyard';
              (zones.graveyard as any[]).push(perm.card);
            }
            sacrificedNames.push(perm.card?.name || 'Unknown');
          }
        }
        zones.graveyardCount = zones.graveyard.length;

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} sacrifices ${sacrificedNames.join(', ')} as an additional cost.`,
          ts: Date.now(),
        });
      }

      // Mark the additional cost as paid and continue casting
      (cardInHand as any).additionalCostPaid = true;
      
      // Persist event for replay
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "additionalCostConfirm", {
          playerId,
          cardId,
          costType,
          selectedCards,
          effectId,
          discardedCards: costType === 'discard' ? discardedCards : undefined,
          sacrificedNames: costType === 'sacrifice' ? sacrificedNames : undefined,
        });
      } catch (e) {
        console.warn('appendEvent(additionalCostConfirm) failed:', e);
      }

      // Emit event to continue the cast
      socket.emit("additionalCostComplete", {
        gameId,
        cardId,
        costType,
        effectId,
      });

      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);

    } catch (err: any) {
      console.error(`additionalCostConfirm error:`, err);
      socket.emit("error", { code: "INTERNAL_ERROR", message: err.message || "Additional cost payment failed" });
    }
  });

  /**
   * Handle squad cost confirmation - player selects how many times to pay the squad cost
   * Squad is a keyword ability that lets you pay an additional cost any number of times to create token copies
   */
  socket.on("squadCostConfirm", async ({ gameId, cardId, timesPaid, effectId }: {
    gameId: string;
    cardId: string;
    timesPaid: number; // How many times the player chose to pay the squad cost (0 or more)
    effectId?: string;
  }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) {
        socket.emit("error", { code: "NOT_JOINED", message: "You must join the game first" });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
        return;
      }

      const zones = game.state.zones?.[playerId];
      if (!zones) {
        socket.emit("error", { code: "NO_ZONES", message: "Player zones not found" });
        return;
      }

      const cardInHand = (zones.hand as any[]).find((c: any) => c && c.id === cardId);
      if (!cardInHand) {
        socket.emit("error", { code: "CARD_NOT_IN_HAND", message: "Card not found in hand" });
        return;
      }

      console.log(`[squadCostConfirm] ${playerId} chose to pay squad cost ${timesPaid} time(s) for ${cardInHand.name}`);

      // Store the squad payment on the card for use when it enters the battlefield
      // The token creation happens when the creature ETBs (handled in stack resolution)
      (cardInHand as any).squadTimesPaid = timesPaid;
      (cardInHand as any).additionalCostPaid = true; // Mark that additional cost was handled
      
      // Persist event for replay
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "squadCostConfirm", {
          playerId,
          cardId,
          timesPaid,
          effectId,
        });
      } catch (e) {
        console.warn('appendEvent(squadCostConfirm) failed:', e);
      }

      if (timesPaid > 0) {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} pays the squad cost ${timesPaid} time(s) for ${cardInHand.name}.`,
          ts: Date.now(),
        });
      }

      // Emit event to continue the cast
      socket.emit("additionalCostComplete", {
        gameId,
        cardId,
        costType: 'squad',
        timesPaid,
        effectId,
      });

      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      broadcastGame(io, game, gameId);

    } catch (err: any) {
      console.error(`squadCostConfirm error:`, err);
      socket.emit("error", { code: "INTERNAL_ERROR", message: err.message || "Squad cost payment failed" });
    }
  });

  /**
   * Handle MDFC (Modal Double-Faced Card) face selection for lands like Blightstep Pathway.
   * Player chooses which face of the card to play as a land.
   */
  socket.on("mdfcFaceSelectionConfirm", async ({ gameId, cardId, selectedFace, effectId }: {
    gameId: string;
    cardId: string;
    selectedFace: number;
    effectId?: string;
  }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) {
        socket.emit("error", { code: "NOT_JOINED", message: "You must join the game first" });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
        return;
      }

      // Find the card in hand
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

      // Validate the selected face
      const cardFaces = cardInHand.card_faces;
      if (!Array.isArray(cardFaces) || selectedFace < 0 || selectedFace >= cardFaces.length) {
        socket.emit("error", { code: "INVALID_FACE", message: "Invalid card face selection" });
        return;
      }

      const selectedCardFace = cardFaces[selectedFace];
      console.log(`[mdfcFaceSelectionConfirm] Player ${playerId} selected face ${selectedFace} (${selectedCardFace.name}) for ${cardInHand.name}`);

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} plays ${selectedCardFace.name} (from ${cardInHand.name}).`,
        ts: Date.now(),
      });

      // Continue playing the land with the selected face
      // Re-emit playLand with the selected face
      socket.emit("mdfcFaceSelectionComplete", {
        gameId,
        cardId,
        selectedFace,
        effectId,
      });

    } catch (err: any) {
      console.error(`mdfcFaceSelectionConfirm error:`, err);
      socket.emit("error", { code: "INTERNAL_ERROR", message: err.message || "MDFC face selection failed" });
    }
  });

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
      console.error(`getCostReductions error for game ${gameId}:`, err);
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

      // Parse equip cost from oracle text
      // Supports patterns like: "Equip {2}", "Equip {1}{W}", "Equip—Pay 3 life"
      const equipCostMatch = oracleText.match(/equip\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      let equipCost = equipCostMatch ? equipCostMatch[1] : "{0}";
      
      // Check for Puresteel Paladin metalcraft effect (equip costs {0})
      // Use centralized hasMetalcraft from game-state-effects
      const hasMetalcraftEquipReduction = battlefield.some((p: any) => {
        if (p.controller !== playerId) return false;
        const pOracle = (p.card?.oracle_text || '').toLowerCase();
        // Puresteel Paladin: "Metalcraft — Equipment you control have equip {0}"
        return pOracle.includes('metalcraft') && 
               pOracle.includes('equipment') && 
               pOracle.includes('equip') && 
               pOracle.includes('{0}');
      });
      
      if (hasMetalcraftEquipReduction) {
        // Check if metalcraft is active using centralized function
        if (hasMetalcraft(game as any, playerId)) {
          equipCost = '{0}';
          console.log(`[equipAbility] Metalcraft active (${countArtifacts(game as any, playerId)} artifacts) - equip cost reduced to {0}`);
        }
      }

      if (!targetCreatureId) {
        // No target specified - send list of valid targets
        const validTargets = battlefield.filter((p: any) => {
          if (p.controller !== playerId) return false;
          const pTypeLine = (p.card?.type_line || "").toLowerCase();
          return pTypeLine.includes("creature");
        });

        // Store pending equip activation for when target is chosen
        // IMPORTANT: Preserve equipment/card info to prevent issues during target > pay workflow
        const effectId = `equip_${equipmentId}_${Date.now()}`;
        (game.state as any).pendingEquipActivations = (game.state as any).pendingEquipActivations || {};
        (game.state as any).pendingEquipActivations[effectId] = {
          equipmentId,
          equipmentName: equipment.card?.name || "Equipment",
          equipCost,
          playerId,
          equipment: { ...equipment }, // Copy full equipment object
          validTargetIds: validTargets.map((c: any) => c.id),
        };

        socket.emit("selectEquipTarget", {
          gameId,
          equipmentId,
          equipmentName: equipment.card?.name || "Equipment",
          equipCost,
          effectId, // Include effectId for tracking
          validTargets: validTargets.map((c: any) => ({
            id: c.id,
            name: c.card?.name || "Creature",
            power: c.card?.power || c.basePower || "0",
            toughness: c.card?.toughness || c.baseToughness || "0",
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
        });
        
        console.log(`[equipAbility] Requesting target for ${equipment.card?.name || "Equipment"} (effectId: ${effectId})`);
        return;
      }

      // Target specified - check if we need to prompt for payment
      const targetCreature = battlefield.find((p: any) => p.id === targetCreatureId);
      if (!targetCreature) {
        socket.emit("error", { code: "TARGET_NOT_FOUND", message: "Target creature not found" });
        return;
      }

      // Check target is a creature the player controls
      if (targetCreature.controller !== playerId) {
        socket.emit("error", { code: "NOT_YOUR_CREATURE", message: "You can only equip to creatures you control" });
        return;
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
        
        console.log(`[equipAbility] ${playerId} paid ${equipCost} to equip ${equipment.card?.name} to ${targetCreature.card?.name}`);
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
      
      // Clear pending payment
      if ((game.state as any).pendingEquipPayment?.[playerId]) {
        delete (game.state as any).pendingEquipPayment[playerId];
      }

      console.log(`[equipAbility] ${equipment.card?.name} equipped to ${targetCreature.card?.name} by ${playerId}`);

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
        console.warn('appendEvent(equipPermanent) failed:', e);
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: totalManaCost > 0 
          ? `⚔️ ${getPlayerName(game, playerId)} pays ${equipCost} and equips ${equipment.card?.name || "Equipment"} to ${targetCreature.card?.name || "Creature"}`
          : `⚔️ ${getPlayerName(game, playerId)} equips ${equipment.card?.name || "Equipment"} to ${targetCreature.card?.name || "Creature"}`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`equipAbility error for game ${gameId}:`, err);
      socket.emit("error", { code: "EQUIP_ERROR", message: err?.message ?? String(err) });
    }
  });
  
  // Handle equip payment confirmation - player has paid the mana cost
  socket.on("confirmEquipPayment", ({ gameId, equipmentId, targetCreatureId }: {
    gameId: string;
    equipmentId: string;
    targetCreatureId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;
      
      const pending = (game.state as any).pendingEquipPayment?.[playerId];
      if (!pending || pending.equipmentId !== equipmentId || pending.targetCreatureId !== targetCreatureId) {
        socket.emit("error", { code: "NO_PENDING", message: "No pending equip payment found" });
        return;
      }
      
      // Parse the cost and consume mana from pool
      const parsedCost = parseManaCost(pending.equipCost);
      const pool = getOrInitManaPool(game.state, playerId);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      // Validate payment
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return;
      }
      
      // Consume mana
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[confirmEquipPayment]');
      
      // Now re-call equipAbility with paymentConfirmed
      // (We call the same handler logic inline to avoid event loop issues)
      const battlefield = game.state?.battlefield || [];
      const equipment = battlefield.find((p: any) => p.id === equipmentId);
      const targetCreature = battlefield.find((p: any) => p.id === targetCreatureId);
      
      if (!equipment || !targetCreature) {
        socket.emit("error", { code: "NOT_FOUND", message: "Equipment or target not found" });
        return;
      }
      
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
      
      // Clear pending payment
      delete (game.state as any).pendingEquipPayment[playerId];

      console.log(`[confirmEquipPayment] ${equipment.card?.name} equipped to ${targetCreature.card?.name} by ${playerId} (paid ${pending.equipCost})`);

      // Persist event for replay
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "equipPermanent", {
          playerId,
          equipmentId,
          targetCreatureId,
          equipmentName: equipment.card?.name,
          targetCreatureName: targetCreature.card?.name,
          equipCost: pending.equipCost,
        });
      } catch (e) {
        console.warn('appendEvent(equipPermanent) failed:', e);
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚔️ ${getPlayerName(game, playerId)} pays ${pending.equipCost} and equips ${equipment.card?.name || "Equipment"} to ${targetCreature.card?.name || "Creature"}`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`confirmEquipPayment error for game ${gameId}:`, err);
      socket.emit("error", { code: "EQUIP_PAYMENT_ERROR", message: err?.message ?? String(err) });
    }
  });

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

      console.log(`[foretellCard] ${playerId} foretold ${card.name} (foretell cost: ${foretellCost})`);

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
        console.warn('appendEvent(foretellCard) failed:', e);
      }

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🔮 ${getPlayerName(game, playerId)} foretells a card.`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`foretellCard error for game ${gameId}:`, err);
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
      
      // Emit cast request with foretell cost
      socket.emit("castForetoldRequest", {
        gameId,
        cardId,
        cardName: card.name,
        foretellCost: card.foretellCost,
        imageUrl: card.image_uris?.small || card.image_uris?.normal,
      });

      console.log(`[castForetold] ${playerId} attempting to cast foretold ${card.name} for ${card.foretellCost}`);
    } catch (err: any) {
      console.error(`castForetold error for game ${gameId}:`, err);
      socket.emit("error", { code: "CAST_FORETOLD_ERROR", message: err?.message ?? String(err) });
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
        console.log(`[phaseOutPermanents] ${playerId} phased out: ${phasedOut.join(', ')}`);

        // Persist event for replay
        try {
          appendEvent(gameId, (game as any).seq ?? 0, "phaseOutPermanents", {
            playerId,
            permanentIds,
            phasedOutNames: phasedOut,
          });
        } catch (e) {
          console.warn('appendEvent(phaseOutPermanents) failed:', e);
        }

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `✨ ${getPlayerName(game, playerId)}'s permanents phase out: ${phasedOut.join(', ')}`,
          ts: Date.now(),
        });

        broadcastGame(io, game, gameId);
      }
    } catch (err: any) {
      console.error(`phaseOutPermanents error for game ${gameId}:`, err);
      socket.emit("error", { code: "PHASE_OUT_ERROR", message: err?.message ?? String(err) });
    }
  });

  // ==========================================================================
  // GRAVEYARD TARGET SELECTION
  // ==========================================================================
  
  /**
   * Request graveyard target selection (Elena Turk, Red XIII, Unfinished Business)
   * Sends a list of valid graveyard targets to the client for selection.
   */
  socket.on("requestGraveyardTargets", ({ gameId, effectId, cardName, filter, minTargets, maxTargets, targetPlayerId }: {
    gameId: string;
    effectId: string;
    cardName: string;
    filter: { types?: string[]; subtypes?: string[]; excludeTypes?: string[] };
    minTargets: number;
    maxTargets: number;
    targetPlayerId?: string; // Whose graveyard to search (defaults to self)
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const searchPlayerId = targetPlayerId || playerId;
      const zones = game.state.zones?.[searchPlayerId];
      if (!zones || !Array.isArray(zones.graveyard)) {
        socket.emit("graveyardTargetsResponse", {
          gameId,
          effectId,
          cardName,
          validTargets: [],
          minTargets,
          maxTargets,
        });
        return;
      }

      // Filter graveyard cards based on criteria
      const validTargets = (zones.graveyard as any[]).filter((card: any) => {
        if (!card) return false;
        const typeLine = (card.type_line || '').toLowerCase();
        
        // Check type filter
        if (filter.types && filter.types.length > 0) {
          if (!filter.types.some(t => typeLine.includes(t.toLowerCase()))) {
            return false;
          }
        }
        
        // Check subtype filter
        if (filter.subtypes && filter.subtypes.length > 0) {
          if (!filter.subtypes.some(st => typeLine.includes(st.toLowerCase()))) {
            return false;
          }
        }
        
        // Check excluded types
        if (filter.excludeTypes && filter.excludeTypes.length > 0) {
          if (filter.excludeTypes.some(et => typeLine.includes(et.toLowerCase()))) {
            return false;
          }
        }
        
        return true;
      }).map((card: any) => ({
        id: card.id,
        name: card.name,
        typeLine: card.type_line,
        manaCost: card.mana_cost,
        imageUrl: card.image_uris?.small || card.image_uris?.normal,
      }));

      socket.emit("graveyardTargetsResponse", {
        gameId,
        effectId,
        cardName,
        validTargets,
        minTargets,
        maxTargets,
        targetPlayerId: searchPlayerId,
      });

      console.log(`[requestGraveyardTargets] Found ${validTargets.length} valid targets in ${searchPlayerId}'s graveyard for ${cardName}`);
    } catch (err: any) {
      console.error(`requestGraveyardTargets error for game ${gameId}:`, err);
      socket.emit("error", { code: "GRAVEYARD_TARGETS_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Handle graveyard target selection confirmation
   */
  socket.on("confirmGraveyardTargets", ({ gameId, effectId, selectedCardIds, destination }: {
    gameId: string;
    effectId: string;
    selectedCardIds: string[];
    destination: 'hand' | 'battlefield' | 'library_top' | 'library_bottom';
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const zones = game.state.zones?.[playerId];
      if (!zones || !Array.isArray(zones.graveyard)) {
        socket.emit("error", { code: "NO_GRAVEYARD", message: "Graveyard not found" });
        return;
      }

      const movedCards: string[] = [];

      for (const cardId of selectedCardIds) {
        const cardIndex = (zones.graveyard as any[]).findIndex((c: any) => c?.id === cardId);
        if (cardIndex === -1) continue;

        const card = zones.graveyard[cardIndex] as any;
        (zones.graveyard as any[]).splice(cardIndex, 1);
        movedCards.push(card.name || cardId);

        switch (destination) {
          case 'hand':
            zones.hand = zones.hand || [];
            (zones.hand as any[]).push({ ...(card as any), zone: 'hand' });
            zones.handCount = zones.hand.length;
            break;
          case 'battlefield':
            const battlefield = game.state.battlefield || [];
            const typeLine = ((card as any).type_line || '').toLowerCase();
            const isCreature = typeLine.includes('creature');
            battlefield.push({
              id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
              controller: playerId,
              owner: playerId,
              tapped: false,
              counters: {},
              basePower: isCreature ? parseInt((card as any).power || '0', 10) : undefined,
              baseToughness: isCreature ? parseInt((card as any).toughness || '0', 10) : undefined,
              summoningSickness: isCreature,
              card: { ...(card as any), zone: 'battlefield' },
            });
            break;
          case 'library_top':
            const lib = game.libraries?.get(playerId) || [];
            (lib as any[]).unshift({ ...(card as any), zone: 'library' });
            game.libraries?.set(playerId, lib);
            zones.libraryCount = lib.length;
            break;
          case 'library_bottom':
            const libBottom = game.libraries?.get(playerId) || [];
            (libBottom as any[]).push({ ...(card as any), zone: 'library' });
            game.libraries?.set(playerId, libBottom);
            zones.libraryCount = libBottom.length;
            break;
        }
      }

      zones.graveyardCount = zones.graveyard.length;

      // Persist event for replay
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "confirmGraveyardTargets", {
          playerId,
          effectId,
          selectedCardIds,
          destination,
          movedCards,
        });
      } catch (e) {
        console.warn('appendEvent(confirmGraveyardTargets) failed:', e);
      }

      if (movedCards.length > 0) {
        const destName = destination === 'hand' ? 'hand' : 
                        destination === 'battlefield' ? 'battlefield' :
                        destination === 'library_top' ? 'top of library' : 'bottom of library';
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `📜 ${getPlayerName(game, playerId)} returns ${movedCards.join(', ')} from graveyard to ${destName}.`,
          ts: Date.now(),
        });

        console.log(`[confirmGraveyardTargets] ${playerId} moved ${movedCards.join(', ')} to ${destName}`);
      }

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`confirmGraveyardTargets error for game ${gameId}:`, err);
      socket.emit("error", { code: "GRAVEYARD_CONFIRM_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Handle graveyard exile target selection (Keen-Eyed Curator, etc.)
   */
  socket.on("confirmGraveyardExile", ({ gameId, effectId, targetPlayerId, targetCardId }: {
    gameId: string;
    effectId: string;
    targetPlayerId: string;
    targetCardId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const pending = (game.state as any).pendingGraveyardExile?.[effectId];
      if (!pending) {
        socket.emit("error", { code: "NO_PENDING_EXILE", message: "No pending graveyard exile action found" });
        return;
      }

      const targetZones = game.state.zones?.[targetPlayerId];
      if (!targetZones || !Array.isArray(targetZones.graveyard)) {
        socket.emit("error", { code: "NO_GRAVEYARD", message: "Target graveyard not found" });
        return;
      }

      const cardIndex = targetZones.graveyard.findIndex((c: any) => c?.id === targetCardId);
      if (cardIndex === -1) {
        socket.emit("error", { code: "CARD_NOT_FOUND", message: "Card not found in graveyard" });
        return;
      }

      const card = targetZones.graveyard[cardIndex];
      targetZones.graveyard.splice(cardIndex, 1);
      targetZones.graveyardCount = targetZones.graveyard.length;

      // Find the permanent that activated this ability
      const battlefield = game.state.battlefield || [];
      const permanent = battlefield.find((p: any) => p.id === pending.permanentId);
      
      // Add the card to the permanent's exile zone (tracked on the permanent itself for Keen-Eyed Curator)
      if (permanent) {
        (permanent as any).exiledCards = (permanent as any).exiledCards || [];
        (permanent as any).exiledCards.push({ ...(card as any), zone: 'exile', exiledWith: pending.permanentId });
      }

      // Clean up pending action
      delete (game.state as any).pendingGraveyardExile[effectId];

      const cardName = (card as any)?.name || 'a card';
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🚫 ${getPlayerName(game, playerId)} exiled ${cardName} from ${getPlayerName(game, targetPlayerId)}'s graveyard with ${pending.cardName}.`,
        ts: Date.now(),
      });

      console.log(`[confirmGraveyardExile] ${playerId} exiled ${cardName} from ${targetPlayerId}'s graveyard with ${pending.cardName}`);

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`confirmGraveyardExile error for game ${gameId}:`, err);
      socket.emit("error", { code: "GRAVEYARD_EXILE_ERROR", message: err?.message ?? String(err) });
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

      socket.emit("opponentSelectionRequest", {
        gameId,
        effectId,
        cardName,
        description,
        opponents,
        minOpponents,
        maxOpponents,
      });

      console.log(`[requestOpponentSelection] Requesting opponent selection for ${cardName}`);
    } catch (err: any) {
      console.error(`requestOpponentSelection error for game ${gameId}:`, err);
      socket.emit("error", { code: "OPPONENT_SELECTION_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Handle opponent selection confirmation
   */
  socket.on("confirmOpponentSelection", ({ gameId, effectId, selectedOpponentIds }: {
    gameId: string;
    effectId: string;
    selectedOpponentIds: string[];
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Store the selection for effect resolution
      (game.state as any).pendingOpponentSelections = (game.state as any).pendingOpponentSelections || {};
      (game.state as any).pendingOpponentSelections[effectId] = {
        selectedOpponentIds,
        playerId,
        timestamp: Date.now(),
      };

      console.log(`[confirmOpponentSelection] ${playerId} selected opponents: ${selectedOpponentIds.join(', ')}`);

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`confirmOpponentSelection error for game ${gameId}:`, err);
      socket.emit("error", { code: "OPPONENT_CONFIRM_ERROR", message: err?.message ?? String(err) });
    }
  });

  // ==========================================================================
  // SACRIFICE SELECTION FOR EDICT EFFECTS (Grave Pact, Dictate of Erebos, etc.)
  // ==========================================================================
  
  /**
   * Request sacrifice selection from a player due to an edict effect
   */
  socket.on("requestSacrificeSelection", ({ gameId, effectId, sourceName, targetPlayerId, permanentType, count }: {
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

      // Emit to the target player
      emitToPlayer(io, targetPlayerId, "sacrificeSelectionRequest", {
        gameId,
        triggerId: effectId,
        sourceName,
        sourceController: socket.data.playerId,
        reason: `${sourceName} requires you to sacrifice ${count} ${permanentType}(s)`,
        creatures: eligiblePermanents,
        count,
        permanentType,
      });

      console.log(`[requestSacrificeSelection] ${targetPlayerId} must sacrifice ${count} ${permanentType}(s) due to ${sourceName}`);
    } catch (err: any) {
      console.error(`requestSacrificeSelection error for game ${gameId}:`, err);
      socket.emit("error", { code: "SACRIFICE_REQUEST_ERROR", message: err?.message ?? String(err) });
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
        message: `🏳️ ${playerName} has conceded the game.`,
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
        console.warn("appendEvent(concede) failed:", e);
      }

      broadcastGame(io, game, gameId);

      console.log(`[concede] Player ${playerName} (${playerId}) conceded in game ${gameId}`);
    } catch (err: any) {
      console.error(`concede error for game ${gameId}:`, err);
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
        console.warn("[game-actions] Failed to persist setTriggerShortcut event:", e);
      }

      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);

      console.log(`[setTriggerShortcut] Player ${playerId} set ${cardName} preference to ${preference}`);

    } catch (err: any) {
      console.error(`setTriggerShortcut error for game ${gameId}:`, err);
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
      console.error(`getTriggerShortcut error:`, err);
      socket.emit("triggerShortcutResponse", { shortcut: null });
    }
  });

  // ==========================================================================
  // MUTATE SUPPORT
  // ==========================================================================

  /**
   * Request mutate target selection for a creature spell being cast with mutate
   * This is called when a player chooses to cast a spell for its mutate cost
   */
  socket.on("requestMutateTargets", ({ gameId, cardId }: {
    gameId: string;
    cardId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;
      if (!game || !playerId) return;

      const zones = game.state.zones?.[playerId];
      if (!zones) return;

      // Find the card being cast
      let card: any = null;
      const hand = zones.hand as any[];
      if (hand) {
        card = hand.find((c: any) => c?.id === cardId);
      }

      if (!card) {
        socket.emit("error", { code: "CARD_NOT_FOUND", message: "Card not found" });
        return;
      }

      // Parse mutate cost from oracle text
      const oracleText = card.oracle_text || '';
      const mutateMatch = oracleText.match(/mutate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      const mutateCost = mutateMatch ? mutateMatch[1].trim() : undefined;

      if (!mutateCost) {
        socket.emit("error", { code: "NO_MUTATE", message: "Card does not have mutate" });
        return;
      }

      // Find valid mutate targets (non-Human creatures the player owns)
      const battlefield = game.state.battlefield || [];
      const validTargets = battlefield.filter((perm: any) => {
        if (!perm || perm.owner !== playerId) return false;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        return typeLine.includes('creature') && !typeLine.includes('human');
      }).map((perm: any) => ({
        id: perm.id,
        name: perm.card?.name || 'Unknown',
        typeLine: perm.card?.type_line || '',
        power: perm.card?.power,
        toughness: perm.card?.toughness,
        imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
        controller: perm.controller,
        owner: perm.owner,
        // Check if already mutated
        isAlreadyMutated: !!(perm as any).mutatedStack,
        mutationCount: (perm as any).mutatedStack?.length || 0,
      }));

      socket.emit("mutateTargetsResponse", {
        gameId,
        cardId,
        cardName: card.name,
        mutateCost,
        imageUrl: card.image_uris?.small || card.image_uris?.normal,
        validTargets,
      });

      console.log(`[requestMutateTargets] Found ${validTargets.length} valid mutate targets for ${card.name}`);
    } catch (err: any) {
      console.error(`requestMutateTargets error:`, err);
      socket.emit("error", { code: "MUTATE_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Confirm mutate target selection and cast the spell with mutate
   */
  socket.on("confirmMutateTarget", ({ gameId, cardId, targetPermanentId, onTop }: {
    gameId: string;
    cardId: string;
    targetPermanentId: string;
    onTop: boolean;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;
      if (!game || !playerId) return;

      const zones = game.state.zones?.[playerId];
      if (!zones) return;

      // Find the card being cast
      const hand = zones.hand as any[];
      const cardIndex = hand?.findIndex((c: any) => c?.id === cardId);
      if (cardIndex === -1 || !hand) {
        socket.emit("error", { code: "CARD_NOT_FOUND", message: "Card not found in hand" });
        return;
      }

      const card = hand[cardIndex];

      // Find the target permanent
      const battlefield = game.state.battlefield || [];
      const targetPerm = battlefield.find((p: any) => p?.id === targetPermanentId);
      if (!targetPerm) {
        socket.emit("error", { code: "TARGET_NOT_FOUND", message: "Target permanent not found" });
        return;
      }

      // Validate target is still valid
      if (targetPerm.owner !== playerId) {
        socket.emit("error", { code: "INVALID_TARGET", message: "Target must be a creature you own" });
        return;
      }

      const typeLine = (targetPerm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature') || typeLine.includes('human')) {
        socket.emit("error", { code: "INVALID_TARGET", message: "Target must be a non-Human creature" });
        return;
      }

      // Parse mutate cost
      const oracleText = card.oracle_text || '';
      const mutateMatch = oracleText.match(/mutate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      const mutateCost = mutateMatch ? mutateMatch[1].trim() : '{0}';

      // Store mutate information on the card for when it resolves
      (card as any).isMutating = true;
      (card as any).mutateTarget = targetPermanentId;
      (card as any).mutateOnTop = onTop;
      (card as any).mutateCost = mutateCost;

      // Put on stack as a mutating creature spell
      const stack = game.state.stack || [];
      const stackItem = {
        id: `stack_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        type: 'spell' as const,
        controller: playerId,
        card: { ...card, zone: 'stack' },
        targets: [targetPermanentId],
        targetDetails: [{
          id: targetPermanentId,
          type: 'permanent' as const,
          name: targetPerm.card?.name || 'Unknown',
          controllerId: targetPerm.controller,
        }],
        isMutating: true,
        mutateOnTop: onTop,
      };

      stack.push(stackItem);
      game.state.stack = stack;

      // Remove from hand
      hand.splice(cardIndex, 1);
      zones.handCount = hand.length;

      // Announce the mutate cast
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🧬 ${getPlayerName(game, playerId)} casts ${card.name} with mutate (${mutateCost}), targeting ${targetPerm.card?.name || 'a creature'} (${onTop ? 'on top' : 'on bottom'}).`,
        ts: Date.now(),
      });

      // Persist event for replay
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "castWithMutate", {
          playerId,
          cardId,
          cardName: card.name,
          targetPermanentId,
          targetName: targetPerm.card?.name,
          onTop,
          mutateCost,
        });
      } catch (e) {
        console.warn('appendEvent(castWithMutate) failed:', e);
      }

      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }

      broadcastGame(io, game, gameId);

      console.log(`[confirmMutateTarget] ${playerId} cast ${card.name} with mutate onto ${targetPerm.card?.name}`);
    } catch (err: any) {
      console.error(`confirmMutateTarget error:`, err);
      socket.emit("error", { code: "MUTATE_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Cancel mutate and cast the creature normally instead
   * This is used when the target becomes illegal (Rule 702.140b)
   */
  socket.on("castMutateNormally", ({ gameId, cardId }: {
    gameId: string;
    cardId: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;
      if (!game || !playerId) return;

      // Find the card on the stack that was being mutated
      const stack = game.state.stack || [];
      const stackItemIndex = stack.findIndex((item: any) => 
        item.card?.id === cardId && item.isMutating
      );

      if (stackItemIndex === -1) {
        socket.emit("error", { code: "NOT_FOUND", message: "Mutating spell not found on stack" });
        return;
      }

      // Remove mutate properties and let it resolve as normal creature
      const stackItem = stack[stackItemIndex] as any;
      delete stackItem.isMutating;
      delete stackItem.mutateOnTop;
      stackItem.targets = [];
      stackItem.targetDetails = [];

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `🧬 ${stackItem.card?.name || 'Creature'}'s mutate target is invalid. It will resolve as a normal creature.`,
        ts: Date.now(),
      });

      broadcastGame(io, game, gameId);

      console.log(`[castMutateNormally] Mutate target invalid, ${stackItem.card?.name} will enter normally`);
    } catch (err: any) {
      console.error(`castMutateNormally error:`, err);
      socket.emit("error", { code: "MUTATE_ERROR", message: err?.message ?? String(err) });
    }
  });

  // ==========================================================================
  // ALTERNATE COST SELECTION SUPPORT
  // ==========================================================================

  /**
   * Request available alternate costs for casting a spell
   * Returns all available options including mutate, WUBRG (Jodah/Fist of Suns), Omniscience, etc.
   */
  socket.on("requestAlternateCosts", ({ gameId, cardId, castFromZone }: {
    gameId: string;
    cardId: string;
    castFromZone?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;
      if (!game || !playerId) return;

      const zones = game.state.zones?.[playerId];
      if (!zones) return;

      // Find the card
      let card: any = null;
      const zone = castFromZone || 'hand';
      
      if (zone === 'hand') {
        const hand = zones.hand as any[];
        if (hand) {
          card = hand.find((c: any) => c?.id === cardId);
        }
      } else if (zone === 'graveyard') {
        const graveyard = zones.graveyard as any[];
        if (graveyard) {
          card = graveyard.find((c: any) => c?.id === cardId);
        }
      }

      if (!card) {
        socket.emit("error", { code: "CARD_NOT_FOUND", message: "Card not found" });
        return;
      }

      const oracleText = (card.oracle_text || '').toLowerCase();
      const options: any[] = [];

      // Always include normal cast option
      options.push({
        id: 'normal',
        name: 'Normal Cast',
        description: 'Pay the regular mana cost',
        manaCost: card.mana_cost,
        costType: 'normal',
      });

      // Check for mutate
      if (/\bmutate\b/.test(oracleText)) {
        const mutateMatch = oracleText.match(/mutate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        const mutateCost = mutateMatch ? mutateMatch[1].trim() : undefined;
        
        // Check if there are valid targets
        const battlefield = game.state.battlefield || [];
        const hasValidTarget = battlefield.some((perm: any) => {
          if (!perm || perm.owner !== playerId) return false;
          const typeLine = (perm.card?.type_line || '').toLowerCase();
          return typeLine.includes('creature') && !typeLine.includes('human');
        });

        if (hasValidTarget) {
          options.push({
            id: 'mutate',
            name: 'Mutate',
            description: 'Merge with a non-Human creature you own',
            manaCost: mutateCost,
            costType: 'mutate',
            requiresAdditionalInput: true,
            additionalEffects: [
              'Choose to put on top or bottom',
              'Combined creature has all abilities',
            ],
          });
        }
      }

      // Check for self-WUBRG (Bringers)
      if (oracleText.includes('{w}{u}{b}{r}{g}') && 
          oracleText.includes('rather than pay') &&
          oracleText.includes('this spell')) {
        options.push({
          id: 'wubrg_self',
          name: 'WUBRG Alternative',
          description: 'Pay {W}{U}{B}{R}{G} instead of mana cost',
          manaCost: '{W}{U}{B}{R}{G}',
          costType: 'wubrg',
        });
      }

      // Check for external WUBRG sources (Jodah, Fist of Suns)
      const battlefield = game.state.battlefield || [];
      for (const perm of battlefield) {
        if (!perm || perm.controller !== playerId) continue;
        
        const permName = (perm.card?.name || '').toLowerCase();
        const permOracle = (perm.card?.oracle_text || '').toLowerCase();
        
        if ((permName.includes('jodah') || permName.includes('fist of suns')) &&
            permOracle.includes('{w}{u}{b}{r}{g}') && 
            permOracle.includes('rather than pay') &&
            !permOracle.includes('this spell')) {
          options.push({
            id: `wubrg_${perm.id}`,
            name: 'WUBRG Alternative',
            description: `Pay {W}{U}{B}{R}{G} via ${perm.card?.name || 'external source'}`,
            manaCost: '{W}{U}{B}{R}{G}',
            costType: 'wubrg',
            sourceName: perm.card?.name,
            sourceId: perm.id,
          });
          break; // Only add once
        }
      }

      // Check for Omniscience (only from hand)
      if (zone === 'hand') {
        for (const perm of battlefield) {
          if (!perm || perm.controller !== playerId) continue;
          
          const permName = (perm.card?.name || '').toLowerCase();
          const permOracle = (perm.card?.oracle_text || '').toLowerCase();
          
          if (permName.includes('omniscience') ||
              (permOracle.includes('cast spells from your hand') && 
               permOracle.includes('without paying'))) {
            options.push({
              id: `free_${perm.id}`,
              name: 'Free Cast',
              description: `Cast without paying mana cost via ${perm.card?.name || 'Omniscience'}`,
              manaCost: undefined,
              costType: 'free',
              sourceName: perm.card?.name,
              sourceId: perm.id,
            });
            break;
          }
        }
      }

      // Check for Evoke
      if (oracleText.includes('evoke')) {
        const evokeMatch = oracleText.match(/evoke\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        if (evokeMatch) {
          options.push({
            id: 'evoke',
            name: 'Evoke',
            description: 'Cast for evoke cost, sacrifice when it enters',
            manaCost: evokeMatch[1].trim(),
            costType: 'evoke',
            additionalEffects: ['Sacrifice when it enters the battlefield'],
          });
        }
      }

      // Check for Overload
      if (oracleText.includes('overload')) {
        const overloadMatch = oracleText.match(/overload\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        if (overloadMatch) {
          options.push({
            id: 'overload',
            name: 'Overload',
            description: 'Replace "target" with "each" in the spell text',
            manaCost: overloadMatch[1].trim(),
            costType: 'overload',
            additionalEffects: ['Affects each applicable permanent instead of one target'],
          });
        }
      }

      // Send available options
      socket.emit("alternateCostsResponse", {
        gameId,
        cardId,
        cardName: card.name,
        imageUrl: card.image_uris?.small || card.image_uris?.normal,
        typeLine: card.type_line,
        normalCost: card.mana_cost,
        options,
      });

      console.log(`[requestAlternateCosts] Found ${options.length} casting options for ${card.name}`);
    } catch (err: any) {
      console.error(`requestAlternateCosts error:`, err);
      socket.emit("error", { code: "ALTERNATE_COSTS_ERROR", message: err?.message ?? String(err) });
    }
  });

  /**
   * Confirm selected alternate cost and proceed with casting
   */
  socket.on("confirmAlternateCost", ({ gameId, cardId, selectedCostId, castFromZone }: {
    gameId: string;
    cardId: string;
    selectedCostId: string;
    castFromZone?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId as string | undefined;
      if (!game || !playerId) return;

      console.log(`[confirmAlternateCost] Player ${playerId} selected cost ${selectedCostId} for card ${cardId}`);

      // Handle based on selected cost type
      if (selectedCostId === 'mutate') {
        // Redirect to mutate target selection
        socket.emit("requestMutateTargetSelection", { gameId, cardId });
      } else if (selectedCostId === 'normal') {
        // Normal cast - emit prompt for normal mana payment
        socket.emit("proceedWithNormalCast", { gameId, cardId, castFromZone });
      } else if (selectedCostId.startsWith('wubrg')) {
        // WUBRG alternate cost - emit prompt with {W}{U}{B}{R}{G} cost
        socket.emit("proceedWithAlternateCast", { 
          gameId, 
          cardId, 
          manaCost: '{W}{U}{B}{R}{G}',
          costType: 'wubrg',
          castFromZone,
        });
      } else if (selectedCostId.startsWith('free')) {
        // Free cast (Omniscience) - cast directly without mana
        socket.emit("proceedWithFreeCast", { gameId, cardId, castFromZone });
      } else if (selectedCostId === 'evoke') {
        // Evoke - emit with evoke flag
        socket.emit("proceedWithEvokeCast", { gameId, cardId, castFromZone });
      } else if (selectedCostId === 'overload') {
        // Overload - emit with overload flag
        socket.emit("proceedWithOverloadCast", { gameId, cardId, castFromZone });
      } else {
        // Unknown cost type
        socket.emit("error", { code: "UNKNOWN_COST", message: "Unknown alternate cost type" });
      }

    } catch (err: any) {
      console.error(`confirmAlternateCost error:`, err);
      socket.emit("error", { code: "ALTERNATE_COST_ERROR", message: err?.message ?? String(err) });
    }
  });
}
