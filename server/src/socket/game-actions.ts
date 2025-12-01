import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, appendGameEvent, parseManaCost, getManaColorName, MANA_COLORS, MANA_COLOR_NAMES, consumeManaFromPool, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, getPlayerName, emitToPlayer, calculateManaProduction, handlePendingLibrarySearch, handlePendingJoinForces } from "./util";
import { appendEvent } from "../db";
import { GameManager } from "../GameManager";
import type { PaymentItem } from "../../../shared/src";
import { requiresCreatureTypeSelection, requestCreatureTypeSelection } from "./creature-type";
import { checkAndPromptOpeningHandActions } from "./opening-hand";
import { emitSacrificeUnlessPayPrompt } from "./triggers";
import { detectSpellCastTriggers, type SpellCastTrigger } from "../state/modules/triggered-abilities";
import { categorizeSpell, evaluateTargeting } from "../rules-engine/targeting";
import { recalculatePlayerEffects } from "../state/modules/game-state-effects";

/** Shock lands and similar "pay life or enter tapped" lands */
const SHOCK_LANDS = new Set([
  "blood crypt",
  "breeding pool",
  "godless shrine",
  "hallowed fountain",
  "overgrown tomb",
  "sacred foundry",
  "steam vents",
  "stomping ground",
  "temple garden",
  "watery grave",
]);

/** Check if a card name is a shock land */
function isShockLand(cardName: string): boolean {
  return SHOCK_LANDS.has((cardName || "").toLowerCase().trim());
}

/**
 * List of bounce lands (karoo lands / aqueducts) that return a land to hand
 * These tap for 2 mana of different colors and enter tapped
 */
const BOUNCE_LANDS = new Set([
  // Ravnica bounce lands
  "azorius chancery", "boros garrison", "dimir aqueduct", "golgari rot farm",
  "gruul turf", "izzet boilerworks", "orzhov basilica", "rakdos carnarium",
  "selesnya sanctuary", "simic growth chamber",
  // Commander/other bounce lands
  "coral atoll", "dormant volcano", "everglades", "jungle basin", "karoo",
  // Guildless commons
  "guildless commons"
]);

/** Check if a card name is a bounce land */
function isBounceLand(cardName: string): boolean {
  return BOUNCE_LANDS.has((cardName || "").toLowerCase().trim());
}

/**
 * Check if a land has "sacrifice unless you pay" ETB trigger
 * Returns the mana cost to pay, or null if not applicable
 * 
 * This detection is purely oracle-text-based, no hardcoded card names.
 * Pattern: "When ~ enters the battlefield, sacrifice it unless you pay {X}"
 */
function detectSacrificeUnlessPayETB(cardName: string, oracleText: string): string | null {
  const lowerText = (oracleText || "").toLowerCase();
  
  // Check oracle text for the "sacrifice unless you pay" pattern
  // This handles Transguild Promenade, Gateway Plaza, Rupture Spire, and any future cards
  const patterns = [
    // "When ~ enters the battlefield, sacrifice it unless you pay {1}"
    /when\s+(?:~|this\s+\w+)\s+enters\s+(?:the\s+battlefield)?,?\s*sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+you\s+pay\s+(\{[^}]+\})/i,
    // "sacrifice ~ unless you pay {1}" (without the "when enters" prefix)
    /sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+you\s+pay\s+(\{[^}]+\})/i,
  ];
  
  for (const pattern of patterns) {
    const match = lowerText.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Check if a land should always enter tapped based on oracle text patterns.
 * This detects common ETB-tapped land patterns like:
 * - "enters the battlefield tapped"
 * - "comes into play tapped"
 * - Conditional ETB tapped (unless you control X, etc.)
 * 
 * Returns:
 * - 'always': Always enters tapped (e.g., Temples, Gain lands, Guildgates)
 * - 'conditional': Has conditional entry (shock lands handled separately)
 * - 'never': Normal entry
 */
function detectETBTappedPattern(oracleText: string): 'always' | 'conditional' | 'never' {
  const text = (oracleText || '').toLowerCase();
  
  // Check for "enters the battlefield tapped" or "comes into play tapped"
  const etbTappedMatch = 
    text.includes('enters the battlefield tapped') ||
    text.includes('enters tapped') ||
    text.includes('comes into play tapped');
  
  if (!etbTappedMatch) {
    return 'never';
  }
  
  // Check for conditional patterns (these need player choice or are already handled)
  const conditionalPatterns = [
    'unless you',           // "unless you control" / "unless you pay"
    'you may pay',          // Shock lands
    'if you control',       // Checklands
    'if you don\'t',        // Various conditionals
    'if an opponent',       // Fast lands (sort of)
  ];
  
  for (const pattern of conditionalPatterns) {
    if (text.includes(pattern)) {
      return 'conditional';
    }
  }
  
  // Unconditional ETB tapped
  return 'always';
}

/**
 * Get the maximum hand size for a player, considering:
 * 1. Permanent effects that grant "no maximum hand size" (Reliquary Tower, Thought Vessel, Spellbook)
 * 2. Spell effects that give "no maximum hand size for the rest of the game" (Praetor's Counsel)
 * 3. Emblem effects that modify hand size
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
 * Calculate the effective mulligan count for a player based on house rules.
 * This determines how many cards they need to put back when keeping their hand.
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
  if (houseRules.freeFirstMulligan && isMultiplayer && actualMulligans >= 1) {
    effectiveCount = Math.max(0, actualMulligans - 1);
    console.log(`[mulligan] Free first mulligan applied for ${playerId}: ${actualMulligans} -> ${effectiveCount}`);
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
    
    // 3. Check battlefield for permanents that grant haste
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
  socket.on("playLand", ({ gameId, cardId }: { gameId: string; cardId: string }) => {
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
        
        if (etbPattern === 'always') {
          // Find the permanent that was just played by its unique card ID (not by name)
          // This ensures we find the correct permanent when multiple copies of the same card exist
          const battlefield = game.state?.battlefield || [];
          const permanent = battlefield.find((p: any) => 
            p.card?.id === cardId && 
            p.controller === playerId &&
            !p.tapped // Only tap if not already tapped
          );
          
          if (permanent) {
            permanent.tapped = true;
            console.log(`[playLand] ${cardName} enters tapped (ETB-tapped pattern detected)`);
          }
        }
      }

      // Check for "sacrifice unless you pay" ETB triggers (Transguild Promenade, Gateway Plaza, etc.)
      const oracleText = (cardInHand as any)?.oracle_text || '';
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

      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`playLand error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "PLAY_LAND_ERROR",
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
      const hasFlash = oracleText.includes("flash");
      const isInstant = typeLine.includes("instant");
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

      // Check if this spell requires targets (oracleText is already defined above)
      // IMPORTANT: Only check for targeting if:
      // 1. The spell is an instant/sorcery, OR
      // 2. The spell is an Aura enchantment (Auras target when cast)
      // Non-Aura permanents (creatures, artifacts, regular enchantments, planeswalkers) don't require 
      // targets when cast, even if they have activated/triggered abilities with "target" in the text.
      // This includes Equipment (which are artifacts) - they enter unattached and equipping is a separate ability.
      const isAura = typeLine.includes('aura');
      const requiresTargetingCheck = isInstant || typeLine.includes('sorcery') || isAura;
      
      // For Auras, determine valid targets based on "Enchant X" text
      // Common patterns: "Enchant creature", "Enchant player", "Enchant opponent", "Enchant permanent"
      let auraTargetType: 'creature' | 'player' | 'opponent' | 'permanent' | 'artifact' | 'land' | null = null;
      if (isAura) {
        const enchantMatch = oracleText.match(/enchant\s+(creature|player|opponent|permanent|artifact|land|enchantment)/i);
        if (enchantMatch) {
          auraTargetType = enchantMatch[1].toLowerCase() as typeof auraTargetType;
        }
      }
      
      const spellSpec = (requiresTargetingCheck && !isAura) ? categorizeSpell(cardInHand.name || '', oracleText) : null;
      
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
          validTargets = (game.state.battlefield || [])
            .filter((p: any) => {
              const tl = (p.card?.type_line || '').toLowerCase();
              return tl.includes('creature');
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
      
      if (spellSpec && spellSpec.minTargets > 0) {
        // This spell requires targets (instant/sorcery)
        if (!targets || targets.length < spellSpec.minTargets) {
          // Need to request targets from the player
          // Use evaluateTargeting to find valid targets
          const validTargets = evaluateTargeting(game.state as any, playerId, spellSpec);
          
          if (validTargets.length === 0) {
            socket.emit("error", {
              code: "NO_VALID_TARGETS",
              message: `No valid targets for ${cardInHand.name}`,
            });
            return;
          }
          
          // Build target list with readable info for the client
          const targetOptions = validTargets.map((t: any) => {
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
              // Stack target (for counterspells)
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
          
          // Emit target selection request
          socket.emit("targetSelectionRequest", {
            gameId,
            cardId,
            cardName: cardInHand.name,
            source: cardInHand.name,
            title: `Choose target${spellSpec.maxTargets > 1 ? 's' : ''} for ${cardInHand.name}`,
            description: oracleText,
            targets: targetOptions,
            minTargets: spellSpec.minTargets,
            maxTargets: spellSpec.maxTargets,
            effectId: `cast_${cardId}_${Date.now()}`,
          });
          
          console.log(`[castSpellFromHand] Requesting ${spellSpec.minTargets}-${spellSpec.maxTargets} target(s) for ${cardInHand.name}`);
          return; // Wait for target selection
        }
        
        // Validate provided targets
        const validTargets = evaluateTargeting(game.state as any, playerId, spellSpec);
        const validTargetIds = new Set(validTargets.map((t: any) => t.id));
        
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
            const targetDetails: Array<{ id: string; type: 'permanent' | 'player'; name?: string }> = [];
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
                  // Find permanent name
                  const perm = (game.state.battlefield || []).find((p: any) => p.id === targetId);
                  targetDetails.push({
                    id: targetId,
                    type: 'permanent',
                    name: perm?.card?.name || targetId,
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
  socket.on("adjustLife", ({ gameId, delta, targetPlayerId }: { 
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
  socket.on("equipAbility", ({ gameId, equipmentId, targetCreatureId }: { 
    gameId: string; 
    equipmentId: string; 
    targetCreatureId?: string;
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
      const equipCostMatch = oracleText.match(/equip\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      const equipCost = equipCostMatch ? equipCostMatch[1] : "{0}";

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

      // Target specified - attach equipment
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
}
