import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent, parseManaCost, getManaColorName, MANA_COLORS, MANA_COLOR_NAMES, consumeManaFromPool, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, getPlayerName, emitToPlayer, calculateManaProduction, handlePendingLibrarySearch, handlePendingJoinForces, handlePendingTemptingOffer, handlePendingPonder, broadcastManaPoolUpdate } from "./util";
import { appendEvent } from "../db";
import { GameManager } from "../GameManager";
import type { PaymentItem, TriggerShortcut, PlayerID } from "../../../shared/src";
import { requiresCreatureTypeSelection, requestCreatureTypeSelection } from "./creature-type";
import { checkAndPromptOpeningHandActions } from "./opening-hand";
import { emitSacrificeUnlessPayPrompt } from "./triggers";
import { detectSpellCastTriggers, getBeginningOfCombatTriggers, getEndStepTriggers, getLandfallTriggers, type SpellCastTrigger } from "../state/modules/triggered-abilities";
import { getUpkeepTriggersForPlayer } from "../state/modules/upkeep-triggers";
import { categorizeSpell, evaluateTargeting, requiresTargeting, parseTargetRequirements } from "../rules-engine/targeting";
import { recalculatePlayerEffects, hasMetalcraft, countArtifacts } from "../state/modules/game-state-effects";
import { PAY_X_LIFE_CARDS, getMaxPayableLife, validateLifePayment } from "../state/utils";

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
function calculateCostReduction(
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
function extractCreatureTypes(typeLine: string): string[] {
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
 * Apply cost reduction to a parsed mana cost
 */
function applyCostReduction(
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
 */
function creatureHasHaste(permanent: any, battlefield: any[], controller: string): boolean {
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
              playerHand
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
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

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
      const isAura = typeLine.includes("enchantment") && oracleText.includes("enchant");
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
          socket.emit("error", {
            code: "NO_VALID_TARGETS",
            message: `No valid targets for ${cardName}`,
          });
          return;
        }

        // Store pending cast info for after targets are selected
        // IMPORTANT: Store valid target IDs for server-side validation (Rule 601.2c compliance)
        (game.state as any).pendingSpellCasts = (game.state as any).pendingSpellCasts || {};
        (game.state as any).pendingSpellCasts[effectId] = {
          cardId,
          cardName,
          manaCost,
          playerId,
          faceIndex,
          validTargetIds: validTargetList.map((t: any) => t.id), // Store for validation
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
        
        console.log(`[requestCastSpell] Requesting targets for ${cardName} (effectId: ${effectId})`);
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
        
        console.log(`[requestCastSpell] No targets needed, requesting payment for ${cardName}`);
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
  // COMPLETE CAST SPELL - Final step after targets selected and payment made
  // Called after both target selection and payment are complete
  // =====================================================================
  socket.on("completeCastSpell", ({ gameId, cardId, targets, payment, effectId }: { 
    gameId: string; 
    cardId: string; 
    targets?: string[]; 
    payment?: PaymentItem[];
    effectId?: string;
  }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      // Clean up pending cast data
      if (effectId && (game.state as any).pendingSpellCasts?.[effectId]) {
        delete (game.state as any).pendingSpellCasts[effectId];
      }

      console.log(`[completeCastSpell] Completing cast for ${cardId} with targets: ${targets?.join(',') || 'none'}`);

      // Re-use the castSpellFromHand logic by emitting internally
      // This avoids duplicating all the validation/payment/casting logic
      socket.emit("castSpellFromHand", { gameId, cardId, targets, payment });
      
    } catch (err: any) {
      console.error(`[completeCastSpell] Error:`, err);
      socket.emit("error", {
        code: "COMPLETE_CAST_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Cast spell from hand
  socket.on("castSpellFromHand", ({ gameId, cardId, targets, payment }: { gameId: string; cardId: string; targets?: any[]; payment?: PaymentItem[] }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

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
      
      // Check timing restrictions for sorcery-speed spells
      const oracleText = (cardInHand.oracle_text || "").toLowerCase();
      let hasFlash = oracleText.includes("flash");
      const isInstant = typeLine.includes("instant");
      
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
      
      if (abundantHarvestMatch && !abundantChoiceSelected) {
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
      const modalSpellMatch = oracleText.match(/choose\s+(one|two|three|four|any number)\s*(?:—|[-])/i);
      const modesAlreadySelected = (cardInHand as any).selectedModes || (targets as any)?.selectedModes;
      
      // Check for Spree cards (new mechanic from Outlaws of Thunder Junction)
      // Pattern: "Spree (Choose one or more additional costs.)" followed by "+ {cost} — Effect"
      const isSpreeCard = oracleText.includes('spree');
      const spreeModesSelected = (cardInHand as any).selectedSpreeModes || (targets as any)?.selectedSpreeModes;
      
      if (isSpreeCard && !spreeModesSelected) {
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
      
      if (modalSpellMatch && !modesAlreadySelected) {
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
      
      if (additionalCost && !additionalCostPaid) {
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
        }
      }

      // Check if this spell requires targets (oracleText is already defined above)
      // IMPORTANT: Only check for targeting if:
      // 1. The spell is an instant/sorcery, OR
      // 2. The spell is an Aura enchantment (Auras target when cast)
      // Non-Aura permanents (creatures, artifacts, regular enchantments, planeswalkers) don't require 
      // targets when cast, even if they have activated/triggered abilities with "target" in the text.
      // This includes Equipment (which are artifacts) - they enter unattached and equipping is a separate ability.
      const isAura = typeLine.includes('aura');
      const isInstantOrSorcery = isInstant || typeLine.includes('sorcery');
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
      const needsTargetSelection = (spellSpec && spellSpec.minTargets > 0) || 
                                   (targetReqs && targetReqs.needsTargets && (!targets || targets.length === 0));
      
      // Handle Aura targeting separately from spell targeting
      if (isAura && auraTargetType && (!targets || targets.length === 0)) {
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
          effectId: `cast_${cardId}_${Date.now()}`,
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
        
        if (!targets || targets.length < requiredMinTargets) {
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
            effectId: `cast_${cardId}_${Date.now()}`,
          });
          
          console.log(`[castSpellFromHand] Requesting ${requiredMinTargets}-${requiredMaxTargets} target(s) for ${cardInHand.name} (${targetDescription})`);
          return; // Wait for target selection
        }
        
        // Validate provided targets if we have a spellSpec
        if (spellSpec) {
          const validRefs = evaluateTargeting(game.state as any, playerId, spellSpec);
          const validTargetIds = new Set(validRefs.map((t: any) => t.id));
          
          for (const target of targets) {
            const targetId = typeof target === 'string' ? target : target.id;
            if (!validTargetIds.has(targetId)) {
              socket.emit("error", {
                code: "INVALID_TARGET",
                message: `Invalid target for ${cardInHand.name}`,
              });
              return;
            }
          }
        }
      }

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
            game.applyEvent({ type: "castSpell", playerId, cardId, targets: targets || [] });
            
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
          card: cardInHand
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
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} cast ${cardInHand.name}.`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`castSpell error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CAST_SPELL_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Pass priority
  socket.on("passPriority", ({ gameId }: { gameId: string }) => {
    try {
      const game = ensureGame(gameId);
      const playerId = socket.data.playerId;
      if (!game || !playerId) return;

      const { changed, resolvedNow, advanceStep } = game.passPriority(playerId);
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
          
          // Check if the resolved spell has a tutor effect (search library)
          if (resolvedCard && resolvedController) {
            const oracleText = (resolvedCard.oracle_text || '').toLowerCase();
            const typeLine = (resolvedCard.type_line || '').toLowerCase();
            const isInstantOrSorcery = typeLine.includes('instant') || typeLine.includes('sorcery');
            
            if (isInstantOrSorcery && oracleText.includes('search your library')) {
              // This spell has a tutor effect - trigger library search
              const cardName = resolvedCard.name || 'Spell';
              
              // Parse what we're searching for
              let searchDescription = 'Search your library for a card';
              const forMatch = oracleText.match(/search your library for (?:a|an|up to \w+) ([^,\.]+)/i);
              if (forMatch) {
                searchDescription = `Search for: ${forMatch[1].trim()}`;
              }
              
              // Detect destination
              let moveTo = 'hand';
              if (oracleText.includes('put it onto the battlefield') || 
                  oracleText.includes('put that card onto the battlefield')) {
                moveTo = 'battlefield';
              } else if (oracleText.includes('put it on top of your library') || 
                         oracleText.includes('put that card on top')) {
                moveTo = 'top';
              }
              
              // Build filter for specific card types
              const filter: { types?: string[]; subtypes?: string[] } = {};
              const types: string[] = [];
              if (oracleText.includes('planeswalker')) types.push('planeswalker');
              if (oracleText.includes('creature')) types.push('creature');
              if (oracleText.includes('artifact')) types.push('artifact');
              if (oracleText.includes('enchantment')) types.push('enchantment');
              if (oracleText.includes('land')) types.push('land');
              if (types.length > 0) filter.types = types;
              
              // Get library for the spell's controller
              const library = typeof game.searchLibrary === 'function' 
                ? game.searchLibrary(resolvedController, "", 1000) 
                : [];
              
              // Find the socket for the controller and send library search request
              for (const s of io.sockets.sockets.values()) {
                if (s.data?.playerId === resolvedController && !s.data?.spectator) {
                  s.emit("librarySearchRequest", {
                    gameId,
                    cards: library,
                    title: cardName,
                    description: searchDescription,
                    filter,
                    maxSelections: 1,
                    moveTo,
                    shuffleAfter: true,
                  });
                  break;
                }
              }
              
              console.log(`[passPriority] Triggered library search for ${cardName} by ${resolvedController}`);
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

      // Debug logging
      try {
        console.info(
          `[skipToPhase] request from player=${playerId} game=${gameId} turnPlayer=${
            game.state?.turnPlayer
          } currentPhase=${currentPhase} currentStep=${currentStep} targetPhase=${targetPhase} targetStep=${targetStep}`
        );
      } catch {
        /* ignore */
      }

      // Only active player may skip phases
      if (game.state.turnPlayer && game.state.turnPlayer !== playerId) {
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

      // Update phase and step directly
      (game.state as any).phase = targetPhase;
      (game.state as any).step = targetStep;
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
      const turnPlayer = game.state.turnPlayer;
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
      // When using skipToPhase, we must still fire all triggers that would have
      // occurred during the skipped phases. Per MTG rules, triggers should always
      // go on the stack, and the active player gets priority to respond.
      // ========================================================================
      
      if (turnPlayer) {
        try {
          // Determine which phases we're skipping and process their triggers
          const currentPhaseOrder = ['untap', 'upkeep', 'draw', 'main1', 'begin_combat', 'declare_attackers', 
                                     'declare_blockers', 'combat_damage', 'end_combat', 'main2', 'end_step', 'cleanup'];
          const currentIdx = currentPhaseOrder.indexOf(currentStep.toLowerCase().replace('_', ''));
          const targetIdx = currentPhaseOrder.indexOf(targetStepUpper.toLowerCase().replace('_', ''));
          
          // Process UPKEEP triggers if we're skipping past upkeep
          const skipsPastUpkeep = (currentStep === '' || currentStep.toLowerCase() === 'untap') && 
                                   targetIdx > currentPhaseOrder.indexOf('upkeep');
          if (skipsPastUpkeep) {
            const upkeepTriggers = getUpkeepTriggersForPlayer(game as any, turnPlayer);
            if (upkeepTriggers.length > 0) {
              console.log(`[skipToPhase] Processing ${upkeepTriggers.length} upkeep trigger(s) that were skipped`);
              (game.state as any).stack = (game.state as any).stack || [];
              const battlefield = (game.state as any).battlefield || [];
              
              for (const trigger of upkeepTriggers) {
                if (trigger.mandatory) {
                  const triggerId = `upkeep_skip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  // Get controller from the permanent on the battlefield
                  const sourcePerm = battlefield.find((p: any) => p?.id === trigger.permanentId);
                  const controller = sourcePerm?.controller || turnPlayer;
                  (game.state as any).stack.push({
                    id: triggerId,
                    type: 'triggered_ability',
                    controller,
                    source: trigger.permanentId,
                    sourceName: trigger.cardName,
                    description: trigger.description,
                    triggerType: 'upkeep_effect',
                    mandatory: true,
                    effect: trigger.effect,
                  });
                  console.log(`[skipToPhase] ⚡ Pushed skipped upkeep trigger: ${trigger.cardName} - ${trigger.description}`);
                }
              }
            }
          }
          
          // Process BEGIN COMBAT triggers if we're entering or passing through combat
          const targetIsCombatOrLater = targetIdx >= currentPhaseOrder.indexOf('begin_combat') || 
                                         targetStepUpper === 'BEGIN_COMBAT';
          const wasBeforeCombat = currentIdx < currentPhaseOrder.indexOf('begin_combat');
          if (targetIsCombatOrLater && wasBeforeCombat) {
            const combatTriggers = getBeginningOfCombatTriggers(game as any, turnPlayer);
            if (combatTriggers.length > 0) {
              console.log(`[skipToPhase] Processing ${combatTriggers.length} beginning of combat trigger(s)`);
              (game.state as any).stack = (game.state as any).stack || [];
              
              for (const trigger of combatTriggers) {
                if (trigger.mandatory) {
                  const triggerId = `combat_skip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  const controller = trigger.controllerId || turnPlayer;
                  (game.state as any).stack.push({
                    id: triggerId,
                    type: 'triggered_ability',
                    controller,
                    source: trigger.permanentId,
                    sourceName: trigger.cardName,
                    description: trigger.description,
                    triggerType: 'begin_combat',
                    mandatory: true,
                    effect: trigger.effect,
                  });
                  console.log(`[skipToPhase] ⚡ Pushed beginning of combat trigger: ${trigger.cardName} - ${trigger.description}`);
                }
              }
            }
          }
          
          // Process END STEP triggers if we're entering end step
          if (targetStepUpper === 'END_STEP' || targetStepUpper === 'END') {
            const endTriggers = getEndStepTriggers(game as any, turnPlayer);
            if (endTriggers.length > 0) {
              console.log(`[skipToPhase] Processing ${endTriggers.length} end step trigger(s)`);
              (game.state as any).stack = (game.state as any).stack || [];
              
              for (const trigger of endTriggers) {
                if (trigger.mandatory) {
                  const triggerId = `end_skip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  const controller = trigger.controllerId || turnPlayer;
                  (game.state as any).stack.push({
                    id: triggerId,
                    type: 'triggered_ability',
                    controller,
                    source: trigger.permanentId,
                    sourceName: trigger.cardName,
                    description: trigger.description,
                    triggerType: 'end_step',
                    mandatory: true,
                    effect: trigger.effect,
                  });
                  console.log(`[skipToPhase] ⚡ Pushed end step trigger: ${trigger.cardName} - ${trigger.description}`);
                }
              }
            }
          }
          
          // If we added any triggers to the stack, ensure active player gets priority
          if ((game.state as any).stack && (game.state as any).stack.length > 0) {
            (game.state as any).priority = turnPlayer;
            console.log(`[skipToPhase] Stack has ${(game.state as any).stack.length} item(s), priority to active player ${turnPlayer}`);
          }
          
        } catch (err) {
          console.warn(`[skipToPhase] Failed to process skipped phase triggers:`, err);
        }
      }

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

      if (costType === 'discard') {
        // Discard the selected cards
        const discardedCards: string[] = [];
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
        const sacrificedNames: string[] = [];
        
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

        socket.emit("selectEquipTarget", {
          gameId,
          equipmentId,
          equipmentName: equipment.card?.name || "Equipment",
          equipCost,
          validTargets: validTargets.map((c: any) => ({
            id: c.id,
            name: c.card?.name || "Creature",
            power: c.card?.power || c.basePower || "0",
            toughness: c.card?.toughness || c.baseToughness || "0",
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
        });
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

      // Check if payment is required and not yet confirmed
      const parsedCost = parseManaCost(equipCost);
      const totalManaCost = parsedCost.generic + Object.values(parsedCost.colors).reduce((a: number, b: number) => a + b, 0);
      
      if (totalManaCost > 0 && !paymentConfirmed) {
        // Store pending equip action and prompt for mana payment
        (game.state as any).pendingEquipPayment = (game.state as any).pendingEquipPayment || {};
        (game.state as any).pendingEquipPayment[playerId] = {
          equipmentId,
          targetCreatureId,
          equipCost,
          equipmentName: equipment.card?.name || "Equipment",
          targetName: targetCreature.card?.name || "Creature",
        };
        
        // Emit payment prompt
        socket.emit("equipPaymentPrompt", {
          gameId,
          equipmentId,
          targetCreatureId,
          equipmentName: equipment.card?.name || "Equipment",
          targetName: targetCreature.card?.name || "Creature",
          equipCost,
          parsedCost,
        });
        
        console.log(`[equipAbility] Prompted ${playerId} to pay ${equipCost} to equip ${equipment.card?.name} to ${targetCreature.card?.name}`);
        return;
      }

      // Payment confirmed (or cost is 0) - proceed with equipping
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

      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚔️ ${getPlayerName(game, playerId)} equips ${equipment.card?.name || "Equipment"} to ${targetCreature.card?.name || "Creature"}`,
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
}
