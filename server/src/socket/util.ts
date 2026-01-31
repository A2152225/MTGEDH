// server/src/socket/util.ts
// Socket helper utilities used by server socket handlers.
// Provides: ensureGame (create/replay), broadcastGame, appendGameEvent,
// priority timer scheduling (schedulePriorityTimeout + doAutoPass),
// clearPriorityTimer, parseManaCost helper, and transformDbEventsForReplay.
//
// This is a full-file authoritative implementation (no truncation).
//
// NOTE: Small, safe additions: normalizeViewForEmit + ensureStateZonesForPlayers
// and env-gated verbose logging when DEBUG_STATE=1.

import type { Server } from "socket.io";
import { games, priorityTimers, PRIORITY_TIMEOUT_MS } from "./socket.js";
import { appendEvent, createGameIfNotExists, getEvents, gameExistsInDb } from "../db/index.js";
import { createInitialGameState } from "../state/index.js";
import type { InMemoryGame } from "../state/types.js";
import { GameManager } from "../GameManager.js";
import type { GameID, PlayerID, ManaPool, RestrictedManaEntry, ManaRestrictionType } from "../../../shared/src/index.js";
import { getActualPowerToughness, uid, cardManaValue } from "../state/utils.js";
import { getDevotionManaAmount, getCreatureCountManaAmount } from "../state/modules/mana-abilities.js";
import { canRespond, canAct, getCostAdjustmentInfo, isTransformBackFace } from "../state/modules/can-respond.js";
import { parseManaCost as parseManaFromString, canPayManaCost, getManaPoolFromState, getAvailableMana, getTotalManaFromPool } from "../state/modules/mana-check.js";
import { hasPayableAlternateCost } from "../state/modules/alternate-costs.js";
import { calculateCostReduction, applyCostReduction } from "./game-actions.js";
import { checkSpellTimingRestriction, hasValidTargetsForSpell } from "../../../rules-engine/src/castingRestrictions.js";
import { applyStaticAbilitiesToBattlefield } from "../../../rules-engine/src/staticAbilities.js";
import { calculateMaxLandsPerTurn } from "../state/modules/game-state-effects.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { ResolutionQueueManager } from "../state/resolution/ResolutionQueueManager.js";
import { isSpellCastingProhibitedByChosenName } from "../state/modules/chosen-name-restrictions.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Delay in milliseconds before auto-passing priority for human players.
 * This gives them a brief moment to evaluate board state and claim priority.
 * AI players and "Auto-Pass Rest of Turn" skip this delay for faster gameplay.
 */
const AUTO_PASS_DELAY_MS = 150;

/**
 * Timeout for clearing the priority restoration flag.
 * This prevents recursive broadcasts when restoring stuck priority.
 */
const PRIORITY_RESTORE_FLAG_TIMEOUT_MS = 100;

// ============================================================================
// Pre-compiled RegExp patterns for mana color matching in devotion calculations
// Optimization: Created once at module load instead of inside loops
// ============================================================================
const DEVOTION_COLOR_PATTERNS: Record<string, RegExp> = {
  W: /\{W\}/gi,
  U: /\{U\}/gi,
  B: /\{B\}/gi,
  R: /\{R\}/gi,
  G: /\{G\}/gi,
};

/**
 * Mana color keys used in ManaPool interface
 * Extracted as constant to ensure consistency across mana pool operations
 */
const MANA_COLOR_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;
type ManaColorKey = typeof MANA_COLOR_KEYS[number];

// ============================================================================
// Helper function for timestamps in debug logging
// ============================================================================
function ts() {
  return new Date().toISOString();
}

/* ------------------- Event transformation helpers ------------------- */

/**
 * Transform events from DB format { type, payload } to replay format { type, ...payload }
 * This is used when replaying events after a server restart or during undo.
 * 
 * DB format: { type: 'playLand', payload: { playerId: 'p1', cardId: 'c1' } }
 * Replay format: { type: 'playLand', playerId: 'p1', cardId: 'c1' }
 */
export function transformDbEventsForReplay(events: Array<{ type: string; payload?: any }>): any[] {
  return events.map((e: any) =>
    e && e.type
      ? e.payload && typeof e.payload === "object"
        ? { type: e.type, ...(e.payload as any) }
        : { type: e.type }
      : e
  );
}

/* ------------------- Defensive normalization helpers ------------------- */

/** canonical minimal zone shape for a player */
function defaultPlayerZones() {
  return {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };
}

/**
 * Ensure authoritative in-memory game.state.zones has entries for all players.
 */
function ensureStateZonesForPlayers(game: any) {
  try {
    if (!game) return;
    game.state = (game.state || {}) as any;
    game.state.players = game.state.players || [];
    game.state.zones = game.state.zones || {};
    for (const p of game.state.players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      if (!game.state.zones[pid]) game.state.zones[pid] = defaultPlayerZones();
      else {
        const z = game.state.zones[pid];
        z.hand = Array.isArray(z.hand) ? z.hand : [];
        z.handCount =
          typeof z.handCount === "number"
            ? z.handCount
            : Array.isArray(z.hand)
            ? z.hand.length
            : 0;
        z.library = Array.isArray(z.library) ? z.library : [];
        z.libraryCount =
          typeof z.libraryCount === "number"
            ? z.libraryCount
            : Array.isArray(z.library)
            ? z.library.length
            : 0;
        z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
        z.graveyardCount =
          typeof z.graveyardCount === "number"
            ? z.graveyardCount
            : Array.isArray(z.graveyard)
            ? z.graveyard.length
            : 0;
      }
    }

    // Intervening-if baseline trackers: make per-player entries exist early
    // so templates can return deterministic false/0 instead of null before the first turn transition.
    const stateAny = game.state as any;
    stateAny.tookCombatDamageSinceLastTurn = stateAny.tookCombatDamageSinceLastTurn || {};
    stateAny.combatDamageDealtToPlayerSinceLastTurn = stateAny.combatDamageDealtToPlayerSinceLastTurn || {};
    stateAny.descendedThisTurn = stateAny.descendedThisTurn || {};
    stateAny.permanentLeftBattlefieldThisTurn = stateAny.permanentLeftBattlefieldThisTurn || {};
    stateAny.attackedPlayersThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer || {};

    stateAny.attackedPlayersLastTurnByPlayer = stateAny.attackedPlayersLastTurnByPlayer || {};
    stateAny.attackedYouLastTurnByPlayer = stateAny.attackedYouLastTurnByPlayer || {};
    stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts = stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts || {};
    stateAny.creaturesEnteredBattlefieldLastTurnByController = stateAny.creaturesEnteredBattlefieldLastTurnByController || {};
    if (typeof stateAny.spellsCastLastTurnCount !== 'number') stateAny.spellsCastLastTurnCount = 0;
    if (stateAny.spellsCastLastTurnByPlayerCounts === undefined) stateAny.spellsCastLastTurnByPlayerCounts = {};

    for (const p of stateAny.players as any[]) {
      const pid = String(p?.id ?? p?.playerId ?? '').trim();
      if (!pid) continue;

      if (typeof stateAny.tookCombatDamageSinceLastTurn[pid] !== 'boolean') stateAny.tookCombatDamageSinceLastTurn[pid] = false;
      if (typeof stateAny.combatDamageDealtToPlayerSinceLastTurn[pid] !== 'boolean') stateAny.combatDamageDealtToPlayerSinceLastTurn[pid] = false;
      if (typeof stateAny.descendedThisTurn[pid] !== 'boolean') stateAny.descendedThisTurn[pid] = false;
      if (typeof stateAny.permanentLeftBattlefieldThisTurn[pid] !== 'boolean') stateAny.permanentLeftBattlefieldThisTurn[pid] = false;
      if (!Array.isArray(stateAny.attackedPlayersThisTurnByPlayer[pid])) stateAny.attackedPlayersThisTurnByPlayer[pid] = [];

      if (!Array.isArray(stateAny.attackedPlayersLastTurnByPlayer[pid])) stateAny.attackedPlayersLastTurnByPlayer[pid] = [];
      if (!stateAny.attackedYouLastTurnByPlayer[pid] || typeof stateAny.attackedYouLastTurnByPlayer[pid] !== 'object') {
        stateAny.attackedYouLastTurnByPlayer[pid] = {};
      }
      if (typeof stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts[pid] !== 'number') stateAny.landsEnteredBattlefieldLastTurnByPlayerCounts[pid] = 0;
      if (typeof stateAny.creaturesEnteredBattlefieldLastTurnByController[pid] !== 'number') stateAny.creaturesEnteredBattlefieldLastTurnByController[pid] = 0;
      if (stateAny.spellsCastLastTurnByPlayerCounts && typeof stateAny.spellsCastLastTurnByPlayerCounts === 'object') {
        if (typeof stateAny.spellsCastLastTurnByPlayerCounts[pid] !== 'number') stateAny.spellsCastLastTurnByPlayerCounts[pid] = 0;
      }
    }
  } catch (e) {
    debugWarn(1, "ensureStateZonesForPlayers failed:", e);
  }
}

/**
 * Mill cards from the top of a player's library until a land is revealed.
 * Moves all revealed cards to the graveyard and returns the milled cards.
 */
export function millUntilLand(
  game: any,
  targetPlayerId: string
): { milled: any[]; landHit?: any } {
  const result = { milled: [] as any[], landHit: undefined as any };
  try {
    const zones = game.state?.zones?.[targetPlayerId];
    if (!zones || !Array.isArray(zones.library)) return result;
    
    zones.graveyard = zones.graveyard || [];
    
    while (zones.library.length > 0) {
      const card = zones.library.shift();
      if (!card) break;
      result.milled.push(card);
      const isLand = (card.type_line || "").toLowerCase().includes("land");
      zones.graveyard.push(card);
      if (isLand) {
        result.landHit = card;
        break;
      }
    }
    
    zones.libraryCount = zones.library?.length ?? zones.libraryCount;
    zones.graveyardCount = zones.graveyard?.length ?? zones.graveyardCount;
  } catch (err) {
    if (process.env.DEBUG_STATE) {
      debugWarn(1, "[millUntilLand] Error milling:", err);
    }
  }
  return result;
}

/**
 * Add commander tax to a mana cost string
 * @param manaCost Original mana cost like "{2}{R}{R}"
 * @param tax Commander tax amount (increases by 2 each time)
 * @returns New mana cost with tax added like "{4}{R}{R}"
 */
function addTaxToManaCost(manaCost: string, tax: number): string {
  if (!tax || tax === 0) return manaCost;
  
  // Parse the original mana cost
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];
  
  // Extract generic mana (colorless/numeric symbols)
  let genericMana = 0;
  const coloredSymbols: string[] = [];
  
  for (const symbol of symbols) {
    const innerSymbol = symbol.slice(1, -1); // Remove { and }
    const numericValue = parseInt(innerSymbol, 10);
    
    if (!isNaN(numericValue)) {
      // It's a generic/numeric mana symbol
      genericMana += numericValue;
    } else {
      // It's a colored or special symbol (W, U, B, R, G, C, X, etc.)
      coloredSymbols.push(symbol);
    }
  }
  
  // Add tax to generic mana
  genericMana += tax;
  
  // Reconstruct the mana cost
  const genericSymbol = genericMana > 0 ? `{${genericMana}}` : '';
  return genericSymbol + coloredSymbols.join('');
}

/**
 * Get IDs of cards/permanents that the player can currently play or activate
 * This is used for UI highlighting to show players their available options
 * Includes: cards in hand, battlefield abilities, foretell cards in exile, 
 * playable cards from graveyard/exile/top deck, etc.
 * 
 * NOTE: Checks both affordability AND timing to ensure automation works correctly.
 */
function getPlayableCardIds(game: InMemoryGame, playerId: PlayerID): string[] {
  const playableIds: string[] = [];
  
  try {
    const state = game.state;
    if (!state) {
      debug(2, `[getPlayableCardIds] No state for player ${playerId}`);
      return playableIds;
    }
    
    const zones = state.zones?.[playerId];
    if (!zones) {
      debug(2, `[getPlayableCardIds] No zones for player ${playerId}`);
      return playableIds;
    }
    
    // Create a minimal context object for functions that need GameContext
    // This provides the required state property for calculating game effects
    const ctx = { state } as { state: typeof state };
    
    const pool = getManaPoolFromState(state, playerId);
    // Also calculate available mana (including potential from untapped sources)
    // This is used to highlight cards that COULD be cast if mana sources are tapped
    const availableMana = getAvailableMana(state, playerId);
    const isMainPhase = isInMainPhase(state);
    const stackIsEmpty = !state.stack || state.stack.length === 0;
    const turnPlayer = state.turnPlayer;
    const isMyTurn = turnPlayer === playerId;
    
    debug(2, `[getPlayableCardIds] Player ${playerId}: step=${state.step}, isMainPhase=${isMainPhase}, stackIsEmpty=${stackIsEmpty}, isMyTurn=${isMyTurn}`);
    debug(2, `[getPlayableCardIds] manaPool=`, pool);
    debug(2, `[getPlayableCardIds] availableMana=`, availableMana);
    debug(2, `[getPlayableCardIds] Total available mana:`, getTotalManaFromPool(availableMana));
    
    // Check hand for castable spells
    if (Array.isArray(zones.hand)) {
      debug(2, `[getPlayableCardIds] Checking ${zones.hand.length} cards in hand`);
      for (const card of zones.hand) {
        if (!card || typeof card === "string") continue;

        // Chosen-name cast restrictions (e.g., Meddling Mage / Nevermore)
        if (isSpellCastingProhibitedByChosenName(state, playerId, (card as any).name || '').prohibited) {
          continue;
        }
        
        // For transform cards, check if this represents the back face
        // Transform cards from Scryfall have layout="transform" and card_faces array
        // The back face has "(Transforms from [Name])" in its oracle text
        const layout = (card as any).layout;
        const cardFaces = (card as any).card_faces;
        
        if (layout === 'transform' && cardFaces && cardFaces.length >= 2) {
          // Check if the card's oracle_text matches the back face
          // or if the card's name contains " // " indicating it's the combined card
          const cardOracleText = (card.oracle_text || "").toLowerCase();
          const backFaceOracle = (cardFaces[1]?.oracle_text || "").toLowerCase();
          
          // If the card's oracle text is from the back face, skip it
          if (cardOracleText && backFaceOracle && cardOracleText.includes("(transforms from")) {
            debug(2, `[getPlayableCardIds] Skipping transform back face: ${card.name}`);
            continue;
          }
          
          // For transform cards in hand, Scryfall returns the combined name
          // but NO top-level oracle_text or mana_cost - these are in card_faces
          // We should NOT skip these - they are castable front faces
          // Continue to use card_faces[0] data below for cost checking
        }
        
        // For modal DFCs and other DFC types, check similarly
        if ((layout === 'modal_dfc' || layout === 'double_faced_token') && cardFaces && cardFaces.length >= 2) {
          // Modal DFCs can be cast as either face - don't skip them here
          // The player will be prompted to choose which face to cast
        }
        
        const typeLine = (card.type_line || "").toLowerCase();
        const oracleText = (card.oracle_text || "").toLowerCase();
        
        // Skip lands - they're checked separately
        if (typeLine.includes("land")) continue;
        
        // Check for special casting timing restrictions
        // Example: Delirium - "Cast this spell only during an opponent's turn"
        const turnPlayer = state.turnPlayer;
        const timingRestriction = checkSpellTimingRestriction(
          card.oracle_text || "",
          playerId,
          turnPlayer,
          state as any
        );
        
        if (!timingRestriction.canCast) {
          debug(2, `[getPlayableCardIds] Card ${card.name} blocked by timing restriction: ${timingRestriction.reason}`);
          continue;
        }
        
        // Check for target availability
        // Example: Delirium requires a creature controlled by the opponent whose turn it is
        const targetCheck = hasValidTargetsForSpell(
          card.oracle_text || "",
          state as any,
          playerId
        );
        
        if (!targetCheck.hasTargets) {
          debug(2, `[getPlayableCardIds] Card ${card.name} blocked - no valid targets: ${targetCheck.reason}`);
          continue;
        }
        
        // Check if it's instant-speed (instant or flash)
        const isInstantSpeed = typeLine.includes("instant") || oracleText.includes("flash");
        
        // Check if it's sorcery-speed and we're in the right timing
        const isSorcerySpeed = 
          typeLine.includes("creature") ||
          typeLine.includes("sorcery") ||
          typeLine.includes("artifact") ||
          typeLine.includes("enchantment") ||
          typeLine.includes("planeswalker") ||
          typeLine.includes("battle");
        
        const canCastNow = isInstantSpeed || (isSorcerySpeed && isMainPhase && stackIsEmpty && isMyTurn);
        
        if (canCastNow) {
          // Calculate cost reduction for this spell
          const reduction = calculateCostReduction(game as any, playerId, card, false);
          
          // For transform/modal DFC cards, get mana cost from the front face
          let manaCost = card.mana_cost || "";
          if (!manaCost && cardFaces && cardFaces.length > 0) {
            manaCost = cardFaces[0].mana_cost || "";
          }
          
          const parsedCost = parseManaFromString(manaCost);
          
          // Apply cost reduction to get the actual cost
          const reducedCost = applyCostReduction(parsedCost, reduction);
          const actualCost = { ...reducedCost, hasX: (reducedCost as any).hasX ?? (parsedCost as any).hasX ?? false };
          
          if (canPayManaCost(availableMana, actualCost) || hasPayableAlternateCost(game as any, playerId, card)) {
            if (reduction.messages && reduction.messages.length > 0) {
              debug(1, `[getPlayableCardIds] Card ${card.name} (${card.id}) is playable with cost reduction: ${reduction.messages.join(', ')}`);
            } else {
              debug(2, `[getPlayableCardIds] Card ${card.name} (${card.id}) is playable`);
            }
            playableIds.push(card.id);
          } else {
            debug(2, `[getPlayableCardIds] Card ${card.name} not playable - cannot pay cost ${manaCost} (after reduction: ${JSON.stringify(actualCost)})`);
          }
        }
      }
    }
    
    // Check for playable lands in hand (during main phase with empty stack)
    if (isMainPhase && stackIsEmpty && isMyTurn) {
      const landsPlayedThisTurn = (state.landsPlayedThisTurn as any)?.[playerId] ?? 0;
      // Calculate max lands per turn dynamically from battlefield effects
      // This accounts for Exploration, Azusa, Rites of Flourishing, etc.
      const maxLandsPerTurn = calculateMaxLandsPerTurn(ctx as any, playerId);
      
      debug(2, `[getPlayableCardIds] Checking lands: landsPlayed=${landsPlayedThisTurn}, max=${maxLandsPerTurn}`);
      
      if (landsPlayedThisTurn < maxLandsPerTurn && Array.isArray(zones.hand)) {
        for (const card of zones.hand) {
          if (!card || typeof card === "string") continue;
          
          const typeLine = (card.type_line || "").toLowerCase();
          if (typeLine.includes("land")) {
            debug(2, `[getPlayableCardIds] Land ${card.name} (${card.id}) is playable`);
            playableIds.push(card.id);
          }
        }
      } else if (landsPlayedThisTurn >= maxLandsPerTurn) {
        debug(2, `[getPlayableCardIds] Already played max lands this turn (${landsPlayedThisTurn}/${maxLandsPerTurn})`);
      }
    } else {
      debug(2, `[getPlayableCardIds] Not checking lands: isMainPhase=${isMainPhase}, stackIsEmpty=${stackIsEmpty}, isMyTurn=${isMyTurn}`);
    }
    
    // Check for castable commanders from command zone
    // Partner commanders and backgrounds should be tracked independently in inCommandZone
    // Each commander can be cast separately while the other remains in the command zone
    const commandZone = (state as any).commandZone?.[playerId];
    if (commandZone) {
      const inCommandZone = (commandZone as any).inCommandZone as string[] || [];
      const commanderCards = (commandZone as any).commanderCards as any[] || [];
      // Fix: Use taxById (the actual field name) instead of commanderTax
      const taxById = (commandZone as any).taxById || {};
      
      if (inCommandZone.length > 0 && commanderCards.length > 0) {
        debug(2, `[getPlayableCardIds] Checking ${inCommandZone.length} commanders in command zone`);
        
        for (const commanderId of inCommandZone) {
          const commander = commanderCards.find((c: any) => c.id === commanderId || c.name === commanderId);
          if (!commander) continue;
          
          const manaCost = commander.mana_cost || "";
          // Fix: Use taxById with the correct commanderId key
          const tax = taxById[commanderId] || 0;
          const totalCost = addTaxToManaCost(manaCost, tax);
          const parsedCost = parseManaFromString(totalCost);
          
          const typeLine = (commander.type_line || "").toLowerCase();
          const oracleText = (commander.oracle_text || "").toLowerCase();
          
          // Check timing
          const isInstantSpeed = typeLine.includes("instant") || oracleText.includes("flash");
          const canCastNow = isInstantSpeed || (isMainPhase && stackIsEmpty && isMyTurn);
          
          // Check if player can pay the cost (normal or alternate like WUBRG/Omniscience)
          if (canCastNow && (canPayManaCost(availableMana, parsedCost) || hasPayableAlternateCost(game as any, playerId, commander))) {
            debug(2, `[getPlayableCardIds] Commander ${commander.name} (${commanderId}) is playable with cost ${totalCost}`);
            playableIds.push(commanderId);
          } else {
            debug(2, `[getPlayableCardIds] Commander ${commander.name} not playable - canCastNow=${canCastNow}, canPay=${canPayManaCost(availableMana, parsedCost)}`);
          }
        }
      }
    }
    
    // Check exile zone for foretell cards and other playable cards
    const exileZone = (state as any).exile?.[playerId];
    if (Array.isArray(exileZone)) {
      for (const card of exileZone) {
        if (!card || typeof card === "string") continue;
        
        const oracleText = (card.oracle_text || "").toLowerCase();
        const typeLine = (card.type_line || "").toLowerCase();
        
        // Check for foretell cards - can cast from exile for foretell cost
        if (oracleText.includes("foretell")) {
          const foretellMatch = oracleText.match(/foretell\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
          if (foretellMatch) {
            const foretellCost = foretellMatch[1];
            const parsedCost = parseManaFromString(foretellCost);
            
            // Check timing for foretell
            const isInstantSpeed = typeLine.includes("instant");
            const canCastNow = isInstantSpeed || (isMainPhase && stackIsEmpty);
            
            if (canCastNow && canPayManaCost(availableMana, parsedCost)) {
              playableIds.push(card.id);
            }
          }
        }
        
        // Check if marked as playable from exile (impulse draw effects, etc.)
        const playableFromExile = (state as any).playableFromExile?.[playerId];
        if (playableFromExile) {
          const isPlayable = Array.isArray(playableFromExile) 
            ? playableFromExile.includes(card.id)
            : playableFromExile[card.id];
          
          if (isPlayable) {
            const manaCost = card.mana_cost || "";
            const parsedCost = parseManaFromString(manaCost);
            
            // Check timing
            const isInstantSpeed = typeLine.includes("instant") || oracleText.includes("flash");
            const canCastNow = isInstantSpeed || (isMainPhase && stackIsEmpty);
            
            // Check if player can pay the cost (normal or alternate)
            if (canCastNow && (canPayManaCost(availableMana, parsedCost) || hasPayableAlternateCost(game as any, playerId, card))) {
              playableIds.push(card.id);
            }
          }
        }
      }
    }
    
    // Check graveyard for cards that can be played from graveyard
    if (Array.isArray(zones.graveyard)) {
      const battlefield = state.battlefield || [];
      const hasPlayFromGraveyardEffect = battlefield.some((perm: any) => {
        if (perm.controller !== playerId) return false;
        const oracle = (perm.card?.oracle_text || "").toLowerCase();
        return (oracle.includes("you may play") || oracle.includes("you may cast")) && 
               oracle.includes("graveyard");
      });
      
      if (hasPlayFromGraveyardEffect) {
        for (const card of zones.graveyard) {
          if (!card || typeof card === "string") continue;
          
          const typeLine = (card.type_line || "").toLowerCase();
          const oracleText = (card.oracle_text || "").toLowerCase();
          const manaCost = card.mana_cost || "";
          const parsedCost = parseManaFromString(manaCost);
          
          // Check timing
          const isInstantSpeed = typeLine.includes("instant") || oracleText.includes("flash");
          const canCastNow = isInstantSpeed || (isMainPhase && stackIsEmpty);
          
          // Check if player can pay the cost (normal or alternate)
          if (canCastNow && (canPayManaCost(availableMana, parsedCost) || hasPayableAlternateCost(game as any, playerId, card))) {
            playableIds.push(card.id);
          }
        }
      }
      
      // Check graveyard for cards with activated abilities that can be used from there
      // Examples: Magma Phoenix "{3}{R}{R}: Return this card from your graveyard to your hand."
      // IMPORTANT: Only highlight cards that are ACTUALLY in the graveyard, not on battlefield
      for (const card of zones.graveyard) {
        if (!card || typeof card === "string") continue;
        
        // Skip this card if it's also on the battlefield
        // This prevents highlighting abilities like Magma Phoenix's graveyard return when it's on battlefield
        const isOnBattlefield = battlefield.some((perm: any) => 
          perm.card?.id === card.id || perm.card?.name === card.name
        );
        
        if (isOnBattlefield) {
          continue; // Card is on battlefield, don't allow graveyard abilities
        }
        
        const oracleText = card.oracle_text || "";
        
        // Look for activated abilities that mention graveyard in the effect
        // Pattern: "{Cost}: [Effect mentions graveyard]"
        const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:\s*(.+?)(?:\.|$)/gi;
        const matches = [...oracleText.matchAll(activatedAbilityPattern)];
        
        let hasGraveyardAbility = false;
        for (const match of matches) {
          const costPart = match[1];
          const effectPart = match[2];
          
          // Check if the effect mentions "from your graveyard" or "from a graveyard"
          if (effectPart.toLowerCase().includes("graveyard")) {
            const parsedCost = parseManaFromString(costPart);
            if (canPayManaCost(availableMana, parsedCost)) {
              hasGraveyardAbility = true;
              break;
            }
          }
        }
        
        if (hasGraveyardAbility) {
          playableIds.push(card.id);
        }
      }
    }
    
    // Check top of library if player can play from top
    const libraries = (game as any).libraries;
    if (libraries && typeof libraries.get === 'function') {
      const library = libraries.get(playerId);
      const battlefield = state.battlefield || [];
      
      const hasPlayFromTopEffect = battlefield.some((perm: any) => {
        if (perm.controller !== playerId) return false;
        const oracle = (perm.card?.oracle_text || "").toLowerCase();
        return (oracle.includes("you may play") || oracle.includes("you may cast")) && 
               (oracle.includes("top") || oracle.includes("off the top")) &&
               (oracle.includes("library") || oracle.includes("your library"));
      });
      
      if (hasPlayFromTopEffect && Array.isArray(library) && library.length > 0) {
        const topCard = library[library.length - 1]; // Top is last element
        if (topCard && typeof topCard !== "string") {
          const typeLine = (topCard.type_line || "").toLowerCase();
          const oracleText = (topCard.oracle_text || "").toLowerCase();
          
          // For lands from top of library
          if (typeLine.includes("land")) {
            if (isMainPhase && stackIsEmpty) {
              const landsPlayedThisTurn = (state.landsPlayedThisTurn as any)?.[playerId] ?? 0;
              const maxLandsPerTurn = calculateMaxLandsPerTurn(ctx as any, playerId);
              if (landsPlayedThisTurn < maxLandsPerTurn) {
                // Highlight the library zone instead of the individual card
                playableIds.push(`library-${playerId}`);
              }
            }
          } else {
            // For spells from top of library - check timing and cost
            const manaCost = topCard.mana_cost || "";
            const parsedCost = parseManaFromString(manaCost);
            
            // Check timing (example: creature with flash from top of library)
            const isInstantSpeed = typeLine.includes("instant") || oracleText.includes("flash");
            const canCastNow = isInstantSpeed || (isMainPhase && stackIsEmpty);
            
            if (canCastNow && canPayManaCost(availableMana, parsedCost)) {
              // Highlight the library zone instead of the individual card
              playableIds.push(`library-${playerId}`);
            }
          }
        }
      }
    }
    
    // Check battlefield for activatable abilities
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      
      const oracleText = perm.card?.oracle_text || "";
      let hasActivatableAbility = false;
      
      // Check for tap abilities
      if (/\{T\}:/.test(oracleText) && !perm.tapped) {
        const abilityMatch = oracleText.match(/\{T\}(?:,\s*([^:]+))?:\s*(.+)/i);
        if (abilityMatch) {
          const effect = abilityMatch[2] || "";
          const effectLower = effect.toLowerCase();
          
          // Skip pure mana abilities (they don't require priority)
          const isPureManaAbility = /add\s+(?:\{[wubrgc]\}|\{[^}]+\}\{[^}]+\}|one mana|mana)/i.test(effectLower) &&
                                    !/target/i.test(effect);
          
          if (!isPureManaAbility) {
            hasActivatableAbility = true;
          }
        }
      }
      
      // Check for other activated abilities with costs
      const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*:\s*(.+)/gi;
      const matches = [...oracleText.matchAll(activatedAbilityPattern)];
      
      for (const match of matches) {
        const costPart = match[1];
        const effectPart = match[2];
        
        // Skip if already checked (tap ability)
        if (costPart.includes("{T}")) continue;
        
        // Skip pure mana abilities
        const effectLower = effectPart.toLowerCase();
        const isPureManaAbility = /add\s+(?:\{[wubrgc]\}|\{[^}]+\}\{[^}]+\}|one mana|mana)/i.test(effectLower) &&
                                  !/target/i.test(effectPart);
        
        if (isPureManaAbility) continue;
        
        // Check for sorcery-speed-only abilities (equip, reconfigure, etc.)
        if (effectLower.includes("equip") || effectLower.includes("reconfigure")) {
          if (isMainPhase && stackIsEmpty) {
            const parsedCost = parseManaFromString(costPart);
            if (canPayManaCost(availableMana, parsedCost)) {
              hasActivatableAbility = true;
            }
          }
          continue;
        }
        
        // Check for explicit sorcery-speed restriction
        if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText)) {
          if (isMainPhase && stackIsEmpty) {
            const parsedCost = parseManaFromString(costPart);
            if (canPayManaCost(availableMana, parsedCost)) {
              hasActivatableAbility = true;
            }
          }
          continue;
        }
        
        // Instant-speed abilities - check if we can pay the cost
        const parsedCost = parseManaFromString(costPart);
        if (canPayManaCost(availableMana, parsedCost)) {
          hasActivatableAbility = true;
          break;
        }
      }
      
      // Add permanent once if it has any activatable abilities
      if (hasActivatableAbility) {
        playableIds.push(perm.id);
      }
    }
    
  } catch (err) {
    debugWarn(1, "[getPlayableCardIds] Error:", err);
  }
  
  debug(2, `[getPlayableCardIds] Returning ${playableIds.length} playable card(s):`, playableIds);
  return playableIds;
}

/**
 * Check if game is in main phase
 */
function isInMainPhase(state: any): boolean {
  try {
    const step = state.step;
    if (!step) return false;
    const stepStr = String(step).toUpperCase();
    // Check for main phase steps (with or without underscore for compatibility)
    return stepStr === 'MAIN1' || stepStr === 'MAIN2' || 
           stepStr === 'MAIN_1' || stepStr === 'MAIN_2' || 
           stepStr === 'MAIN' || stepStr.includes('MAIN');
  } catch {
    return false;
  }
}

function normalizeViewForEmit(rawView: any, game: any) {
  try {
    const view = rawView || {};
    view.zones = view.zones || {};
    const players =
      Array.isArray(view.players)
        ? view.players
        : game &&
          game.state &&
          Array.isArray(game.state.players)
        ? game.state.players
        : [];
    for (const p of players) {
      const pid = p?.id ?? p?.playerId;
      if (!pid) continue;
      view.zones[pid] = view.zones[pid] ?? defaultPlayerZones();
    }

    // Mirror minimal shape back into authoritative game.state.zones to avoid other server modules observing undefined.
    try {
      if (game && game.state) {
        game.state.zones = game.state.zones || {};
        for (const pid of Object.keys(view.zones)) {
          if (!game.state.zones[pid]) game.state.zones[pid] = view.zones[pid];
          else {
            const src = view.zones[pid];
            const dst = game.state.zones[pid];
            dst.hand = Array.isArray(dst.hand)
              ? dst.hand
              : Array.isArray(src.hand)
              ? src.hand
              : [];
            dst.handCount =
              typeof dst.handCount === "number"
                ? dst.handCount
                : Array.isArray(dst.hand)
                ? dst.hand.length
                : 0;
            dst.library = Array.isArray(dst.library)
              ? dst.library
              : Array.isArray(src.library)
              ? src.library
              : [];
            dst.libraryCount =
              typeof dst.libraryCount === "number"
                ? dst.libraryCount
                : Array.isArray(dst.library)
                ? dst.library.length
                : 0;
            dst.graveyard = Array.isArray(dst.graveyard)
              ? dst.graveyard
              : Array.isArray(src.graveyard)
              ? src.graveyard
              : [];
            dst.graveyardCount =
              typeof dst.graveyardCount === "number"
                ? dst.graveyardCount
                : Array.isArray(dst.graveyard)
                ? dst.graveyard.length
                : 0;
          }
        }
      }
    } catch {
      // non-fatal
    }

    // Apply static abilities to battlefield (P/T calculations, static goad from Baeloth, etc.)
    // This ensures all battlefield permanents have correct effectivePower/effectiveToughness
    // and isStaticallyGoaded flags before being sent to the client
    try {
      if (view.battlefield && Array.isArray(view.battlefield) && view.battlefield.length > 0) {
        const updatedBattlefield = applyStaticAbilitiesToBattlefield(view.battlefield);
        view.battlefield = updatedBattlefield;
        
        // Also update game.state.battlefield to keep it in sync
        if (game && game.state && Array.isArray(game.state.battlefield)) {
          game.state.battlefield = updatedBattlefield;
        }
      }
    } catch (e) {
      // non-fatal - don't break the whole view if static ability calculation fails
      debugWarn(1, "Failed to apply static abilities to battlefield:", e);
    }

    // ========================================================================
    // TOKEN GROUPING OPTIMIZATION
    // Group identical tokens to reduce network payload for games with many tokens.
    // Tokens are grouped if they share: name, controller, power, toughness, tap state,
    // colors, counter state, and no unique modifiers (like individual damage marks).
    // The client receives grouped tokens with a 'tokenCount' field.
    // 
    // The 10% threshold (MIN_GROUPING_REDUCTION_RATIO = 0.9) ensures we only apply
    // grouping when it provides meaningful network savings. Small reductions aren't
    // worth the additional client-side processing complexity.
    // ========================================================================
    const MIN_GROUPING_REDUCTION_RATIO = 0.9; // Only apply if reduced to 90% or less of original
    try {
      if (view.battlefield && Array.isArray(view.battlefield)) {
        const tokenGroups = new Map<string, { prototype: any; ids: string[] }>();
        const nonTokenPermanents: any[] = [];
        
        for (const perm of view.battlefield) {
          if (!perm) continue;
          
          // Only group tokens that are simple and identical
          // Tokens with any of the following are NOT groupable (they're unique):
          const hasEquipment = perm.attachedEquipment?.length > 0 || perm.isEquipped;
          const hasAuras = perm.attachments?.length > 0;
          const isAttachedToSomething = !!perm.attachedTo;
          const hasDamage = (perm.damageTaken || 0) > 0 || (perm.damageMarked || 0) > 0;
          const isInCombat = perm.isBlocking || perm.isAttacking || perm.blocking?.length > 0;
          
          // Check for ANY temporary modifications that would make this token unique:
          // - modifiers: Array of P/T modifiers from Giant Growth, battle cry, anthems, etc.
          // - temporaryEffects: Array of temporary effects like "exile if dies this turn"
          // - tempPTMod: Legacy field for some temporary P/T changes
          // - temporaryProtection: Array of temporary protection effects (e.g., Brave the Elements)
          const hasModifiers = perm.modifiers?.length > 0;
          const hasTemporaryEffects = perm.temporaryEffects?.length > 0;
          const hasTempPTMod = !!perm.tempPTMod;
          const hasTemporaryProtection = perm.temporaryProtection?.length > 0;
          const hasTempMods = hasModifiers || hasTemporaryEffects || hasTempPTMod || hasTemporaryProtection;
          
          const isGroupableToken = 
            perm.isToken === true &&
            !hasEquipment &&      // No equipment attached
            !hasAuras &&          // No auras/enchantments attached
            !isAttachedToSomething && // Not attached to anything
            !hasDamage &&         // No damage taken
            !isInCombat &&        // Not in combat
            !hasTempMods;         // No temporary modifications (Giant Growth, etc.)
          
          if (isGroupableToken) {
            // Create a deterministic grouping key based on relevant properties
            // Using manual string construction for reliability (JSON.stringify ordering is not guaranteed)
            const card = perm.card || {};
            const countersStr = Object.entries(perm.counters || {})
              .filter(([, v]) => (v as number) > 0)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => `${k}:${v}`)
              .join(',');
            
            // Granted abilities (from equipment, auras, anthem effects, etc.)
            const grantedAbilitiesStr = (perm.grantedAbilities || [])
              .slice()
              .sort()
              .join('|');
            
            // Static/inherent abilities from the token's oracle text (flying, lifelink, etc.)
            // These are abilities the token was created with
            const oracleText = (card.oracle_text || '').toLowerCase();
            const staticAbilities: string[] = [];
            
            // Detect common keyword abilities from oracle text
            const keywordPatterns = [
              'flying', 'first strike', 'double strike', 'deathtouch', 'lifelink',
              'vigilance', 'trample', 'haste', 'hexproof', 'indestructible',
              'menace', 'reach', 'defender', 'flash', 'shroud', 'protection',
              'infect', 'wither', 'persist', 'undying', 'annihilator',
              'intimidate', 'skulk', 'prowess', 'afflict', 'afterlife',
            ];
            for (const keyword of keywordPatterns) {
              if (oracleText.includes(keyword)) {
                staticAbilities.push(keyword);
              }
            }
            
            // Also check for special token abilities like "This creature's power and toughness are each equal to..."
            // These create tokens with variable P/T based on game state
            if (oracleText.includes('power and toughness are each equal to')) {
              staticAbilities.push('variable_pt');
            }
            
            const staticAbilitiesStr = staticAbilities.sort().join('|');
            const colorsStr = (card.colors || []).slice().sort().join('');
            
            // Build deterministic key with all grouping-relevant properties
            const key = [
              `ctrl:${perm.controller}`,
              `name:${card.name || ''}`,
              `p:${perm.effectivePower ?? perm.basePower ?? card.power ?? 0}`,
              `t:${perm.effectiveToughness ?? perm.baseToughness ?? card.toughness ?? 0}`,
              `tap:${perm.tapped ? 1 : 0}`,
              `sick:${perm.summoningSickness ? 1 : 0}`,
              `cnt:${countersStr}`,
              `grantedAbil:${grantedAbilitiesStr}`,
              `staticAbil:${staticAbilitiesStr}`,
              `col:${colorsStr}`,
            ].join('|');
            
            const existing = tokenGroups.get(key);
            if (existing) {
              // Add to existing group
              existing.ids.push(perm.id);
            } else {
              // Create new group with this token as prototype
              tokenGroups.set(key, { prototype: perm, ids: [perm.id] });
            }
          } else {
            // Keep non-groupable permanents as-is (includes equipped/enchanted tokens)
            nonTokenPermanents.push(perm);
          }
        }
        
        // Build the optimized battlefield array
        const optimizedBattlefield = [...nonTokenPermanents];
        
        // Track whether any tokens were actually grouped
        let hasGroupedTokens = false;
        
        for (const [, group] of tokenGroups) {
          if (group.ids.length === 1) {
            // Single token - keep as-is but still mark it as a token for consistency
            const singleToken = {
              ...group.prototype,
              isToken: true,
            };
            optimizedBattlefield.push(singleToken);
          } else {
            // Multiple identical tokens - create grouped entry
            hasGroupedTokens = true;
            const groupedToken = {
              ...group.prototype,
              // Add grouping metadata
              tokenCount: group.ids.length,
              groupedTokenIds: group.ids,
              isGroupedTokens: true,
              isToken: true,
              // The ID represents the group (client uses groupedTokenIds for individual operations)
              id: `group_${group.ids[0]}`, // Use first ID as group identifier
              originalId: group.ids[0], // Keep track of first real ID
            };
            optimizedBattlefield.push(groupedToken);
          }
        }
        
        // Apply optimization if:
        // 1. We have any grouped tokens (for badge display), OR
        // 2. We reduced the count significantly (for network optimization)
        const originalCount = view.battlefield.length;
        const optimizedCount = optimizedBattlefield.length;
        
        // IMPORTANT: Always apply grouping when there are grouped tokens, even if the
        // total count reduction is minimal. This ensures the client receives tokenCount
        // and isGroupedTokens properties for UI badge display (e.g., "24x" token count).
        // Without this, the badge wouldn't appear if only a few tokens are grouped.
        if (hasGroupedTokens || optimizedCount < originalCount * MIN_GROUPING_REDUCTION_RATIO) {
          view.battlefield = optimizedBattlefield;
          view.tokenGroupingApplied = true;
          view.originalBattlefieldCount = originalCount;
          if (hasGroupedTokens) {
            debug(2, `[TokenOptimization] Applied grouping: ${originalCount} → ${optimizedCount} entries, has grouped tokens with counts`);
          } else {
            debug(2, `[TokenOptimization] Reduced battlefield from ${originalCount} to ${optimizedCount} entries (${Math.round((1 - optimizedCount/originalCount) * 100)}% reduction)`);
          }
        }
      }
    } catch (e) {
      // Non-fatal - if grouping fails, we just send the full battlefield
      debugWarn(1, "Token grouping optimization failed:", e);
    }

    // Augment battlefield permanents with mana production amounts for special abilities
    // This allows the payment picker to show the correct amount (e.g., "7x{G}" for Priest of Titania)
    try {
      if (view.battlefield && Array.isArray(view.battlefield) && game && game.state) {
        for (const perm of view.battlefield) {
          if (!perm || perm.tapped) continue;
          
          const controller = perm.controller;
          if (!controller) continue;
          
          // Check for devotion-based mana (Karametra's Acolyte, etc.)
          const devotionMana = getDevotionManaAmount(game.state, perm, controller);
          if (devotionMana && devotionMana.amount > 0) {
            perm.manaAmount = devotionMana.amount;
            perm.manaColor = devotionMana.color;
          }
          
          // Check for creature-count-based mana (Priest of Titania, Bighorn Rancher, etc.)
          // Note: Only set if devotion mana wasn't already set, since a card typically has one or the other
          const creatureCountMana = getCreatureCountManaAmount(game.state, perm, controller);
          if (creatureCountMana && creatureCountMana.amount > 0 && !perm.manaAmount) {
            perm.manaAmount = creatureCountMana.amount;
            perm.manaColor = creatureCountMana.color;
          }
        }
      }
    } catch (e) {
      // non-fatal - don't break the whole view if mana calculation fails
      debugWarn(1, "Failed to augment mana amounts:", e);
    }
    
    // Add playable cards highlighting for the current priority player
    // This helps players see which cards/permanents they can play/activate
    try {
      if (game && game.state && view.viewer) {
        const priority = game.state.priority;
        const viewerId = view.viewer;
        
        debug(2, `[normalizeViewForEmit] Checking playable cards: priority=${priority}, viewerId=${viewerId}, match=${priority === viewerId}`);
        
        // Only add playable cards for the current priority holder viewing their own game
        if (priority === viewerId) {
          const playableCardIds = getPlayableCardIds(game, viewerId);
          debug(2, `[normalizeViewForEmit] getPlayableCardIds returned ${playableCardIds?.length || 0} cards`);
          
          if (playableCardIds && playableCardIds.length > 0) {
            view.playableCards = playableCardIds;
            debug(2, `[normalizeViewForEmit] Set view.playableCards with ${playableCardIds.length} cards`);
          } else {
            debug(2, `[normalizeViewForEmit] Not setting view.playableCards - no playable cards found`);
          }
          
          // Add canAct and canRespond flags to the view
          // These are calculated server-side to ensure consistency with game rules
          try {
            view.canAct = canAct(game as any, viewerId);
            view.canRespond = canRespond(game as any, viewerId);
            debug(2, `[normalizeViewForEmit] Set canAct=${view.canAct}, canRespond=${view.canRespond}`);
          } catch (err) {
            debugWarn(1, "Failed to calculate canAct/canRespond:", err);
            // Fallback: use playableCards as indicator
            view.canAct = playableCardIds && playableCardIds.length > 0;
            view.canRespond = view.canAct; // Conservative fallback
          }
        } else {
          debug(2, `[normalizeViewForEmit] Skipping playable cards - viewer doesn't have priority`);
        }
      } else {
        debug(2, `[normalizeViewForEmit] Skipping playable cards - missing game/state/viewer`);
      }
    } catch (e) {
      // non-fatal - don't break the whole view if playable calculation fails
      debugWarn(1, "Failed to calculate playable cards:", e);
    }
    
    // Add cost adjustment info for cards in hand
    // This shows players when their spells cost more or less due to battlefield effects
    try {
      if (game && game.state && view.viewer) {
        const viewerId = view.viewer;
        const zones = game.state.zones?.[viewerId];
        
        if (zones?.hand && Array.isArray(zones.hand)) {
          const costAdjustments: Record<string, any> = {};
          
          for (const card of zones.hand) {
            if (!card || typeof card === 'string' || !card.id) continue;
            
            const adjustmentInfo = getCostAdjustmentInfo(game.state, viewerId, card);
            if (adjustmentInfo) {
              costAdjustments[card.id] = {
                originalCost: adjustmentInfo.originalCost,
                adjustedCost: adjustmentInfo.adjustedCost,
                adjustment: adjustmentInfo.adjustment,
                genericAdjustment: adjustmentInfo.genericAdjustment,
                sources: adjustmentInfo.sources.map(s => s.name),
                isIncrease: adjustmentInfo.adjustment > 0,
              };
            }
          }
          
          if (Object.keys(costAdjustments).length > 0) {
            view.costAdjustments = costAdjustments;
          }
        }
      }
    } catch (e) {
      // non-fatal - don't break the whole view if cost adjustment calculation fails
      debugWarn(1, "Failed to calculate cost adjustments:", e);
    }

    return view;
  } catch (e) {
    debugWarn(1, "normalizeViewForEmit failed:", e);
    return rawView || {};
  }
}

/* --- Debug logging helper (env-gated) --- */
function logStateDebug(prefix: string, gameId: string, view: any) {
  try {
    const enabled = process.env.DEBUG_STATE === "1";
    if (!enabled) return;

    const playerIds = Array.isArray(view?.players)
      ? view.players.map((p: any) => p?.id ?? p?.playerId)
      : [];
    const zoneKeys = view?.zones ? Object.keys(view.zones) : [];

    // Pick the first player (if any) and derive a compact summary
    const firstPid = playerIds[0];
    const z = firstPid && view?.zones ? view.zones[firstPid] : null;
    const lib = z && Array.isArray(z.library) ? z.library : [];
    const firstLib = lib[0];
    const lastLib =
      lib.length > 1 ? lib[lib.length - 1] : lib.length === 1 ? lib[0] : null;

    debug(1,
      `[STATE_DEBUG] ${prefix} gameId=${gameId} players=[${playerIds.join(
        ","
      )}] zones=[${zoneKeys.join(
        ","
      )}] handCount=${z?.handCount ?? 0} libraryCount=${z?.libraryCount ?? 0}`
    );

    // Compact library sample instead of full JSON dump
    debug(2, `[STATE_DEBUG] ${prefix} librarySample gameId=${gameId}`, {
      firstLibraryCard: firstLib
        ? {
            id: firstLib.id,
            name: firstLib.name,
            type_line: firstLib.type_line,
          }
        : null,
      lastLibraryCard: lastLib
        ? {
            id: lastLib.id,
            name: lastLib.name,
            type_line: lastLib.type_line,
          }
        : null,
    });
  } catch (e) {
    // non-fatal
  }
}

/**
 * Get player name from player ID.
 * Falls back to the ID if name is not found.
 */
export function getPlayerName(game: any, playerId: PlayerID): string {
  if (!game || !playerId) return playerId || 'Unknown';
  try {
    const players = game.state?.players || [];
    const player = players.find((p: any) => p?.id === playerId);
    return player?.name || playerId;
  } catch (e) {
    return playerId || 'Unknown';
  }
}

/* ------------------- Core exported utilities (based on original file) ------------------- */

/**
 * Options for ensureGame when creating a new game with creator tracking.
 */
export interface EnsureGameOptions {
  createdBySocketId?: string;
  createdByPlayerId?: string;
}

/**
 * Ensures that the specified game exists in both database and memory, creating it if necessary.
 * Prefer using the centralized GameManager to ensure consistent factory/reset behavior.
 * Falls back to the local create/replay flow if GameManager is not available or fails.
 *
 * Returns an InMemoryGame wrapper with a fully-initialized runtime state.
 */
export function ensureGame(gameId: string, options?: EnsureGameOptions): InMemoryGame | undefined {
  // Defensive validation: reject invalid/falsy gameId early to prevent creating games with no id.
  if (!gameId || typeof gameId !== "string" || gameId.trim() === "") {
    const msg = `ensureGame called with invalid gameId: ${String(gameId)}`;
    debugError(1, "[ensureGame] " + msg);
    throw new Error(msg);
  }

  // Prefer GameManager to keep a single source of truth for game creation/reset, if it's exposing helper methods.
  try {
    if (GameManager && typeof (GameManager as any).getGame === "function") {
      try {
        const gmGame =
          (GameManager as any).getGame(gameId) ||
          (GameManager as any).ensureGame?.(gameId);
        if (gmGame) {
          try {
            games.set(gameId, gmGame);
          } catch {
            /* best-effort */
          }
          try {
            ensureStateZonesForPlayers(gmGame);
          } catch {
            /* ignore */
          }
          return gmGame as InMemoryGame;
        }
        // GameManager.ensureGame returned undefined - game doesn't exist in DB (was deleted)
        // Don't fall through to local recreation
        return undefined;
      } catch (err) {
        debugWarn(2,
          "ensureGame: GameManager.getGame/ensureGame failed, falling back to local recreation:",
          err
        );
      }
    }
  } catch (err) {
    debugWarn(2, "ensureGame: GameManager not usable, falling back:", err);
  }

  // Original fallback behavior - but first check if the game exists in the database
  let game = games.get(gameId) as InMemoryGame | undefined;

  if (!game) {
    // IMPORTANT: Check if the game exists in the database before recreating it.
    // This prevents re-creating games that were previously deleted.
    if (!gameExistsInDb(gameId)) {
      debug(1, 
        `[ensureGame] game ${gameId} does not exist in database, not recreating (may have been deleted)`
      );
      return undefined;
    }

    game = createInitialGameState(gameId) as InMemoryGame;

    // No need to call createGameIfNotExists since we already verified the game exists in DB
    // The game data is already persisted, we're just restoring the in-memory state

    try {
      const persisted = getEvents(gameId) || [];
      const replayEvents = persisted.map((ev: any) => ({
        type: ev.type,
        ...(ev.payload || {}),
      }));
      if (typeof (game as any).replay === "function") {
        (game as any).replay(replayEvents);
      } else if (typeof (game as any).applyEvent === "function") {
        for (const e of replayEvents) {
          (game as any).applyEvent(e);
        }
      }
    } catch (err) {
      debugWarn(1, 
        "ensureGame: replay persisted events failed, continuing with fresh state:",
        err
      );
    }

    try {
      ensureStateZonesForPlayers(game);
    } catch {
      /* ignore */
    }

    // Re-register AI players after replay (done asynchronously to keep function synchronous)
    if (game.state && Array.isArray(game.state.players)) {
      // Dynamically import AI module to avoid circular dependencies
      import('./ai.js').then(aiModule => {
        // Also import AIStrategy enum from rules-engine to get proper strategy values
        return Promise.all([
          aiModule,
          import('../../../rules-engine/src/AIEngine.js')
        ]);
      }).then(([aiModule, engineModule]) => {
        if (aiModule && aiModule.registerAIPlayer) {
          const AIStrategy = engineModule.AIStrategy;
          const strategies = AIStrategy ? [
            AIStrategy.BASIC,
            AIStrategy.AGGRESSIVE,
            AIStrategy.DEFENSIVE,
            AIStrategy.CONTROL
          ] : ['basic', 'aggressive', 'defensive', 'control'];
          
          for (const player of game.state.players) {
            if (player && (player as any).isAI) {
              // Use saved strategy if available, otherwise use basic as safe default
              // Strategy should always be saved when AI is created, but fallback to basic for safety
              let strategy = (player as any).strategy || AIStrategy.BASIC;
              const difficulty = (player as any).difficulty ?? 0.5;
              aiModule.registerAIPlayer(gameId, player.id as any, player.name || 'AI Opponent', strategy as any, difficulty);
              debug(1, '[ensureGame] Re-registered AI player after replay:', { gameId, playerId: player.id, name: player.name, strategy, difficulty });
            }
          }
        }
      }).catch(err => {
        debugWarn(1, '[ensureGame] Error re-registering AI players:', err);
      });
    }

    games.set(gameId, game);
  }

  return game;
}

/**
 * Emit a full, normalized state snapshot directly to a specific socketId for a given game,
 * using the same normalization semantics as other emitters.
 */
export function emitStateToSocket(
  io: Server,
  gameId: GameID,
  socketId: string,
  playerId?: PlayerID
) {
  try {
    const game = games.get(gameId);
    if (!game) return;

    let rawView: any;
    try {
      if (typeof (game as any).viewFor === "function" && playerId) {
        rawView = (game as any).viewFor(playerId, false);
      } else if (typeof (game as any).viewFor === "function") {
        const statePlayers: any[] = (game as any).state?.players || [];
        const firstId: string | undefined = statePlayers[0]?.id;
        rawView = firstId
          ? (game as any).viewFor(firstId, false)
          : (game as any).state;
      } else {
        rawView = (game as any).state;
      }
    } catch {
      rawView = (game as any).state;
    }

    const view = normalizeViewForEmit(rawView, game);
    try {
      io.to(socketId).emit("state", {
        gameId,
        view,
        seq: (game as any).seq || 0,
      });
    } catch (e) {
      debugWarn(1, 
        "emitStateToSocket: failed to emit state to socket",
        socketId,
        e
      );
    }
  } catch (e) {
    debugWarn(1, "emitStateToSocket: failed to build or emit view", e);
  }
}

/**
 * Broadcasts the full state of a game to all participants.
 * Uses the game's participants() method if available, otherwise falls back to participantsList.
 *
 * This version normalizes view and mirrors minimal zone shapes back into game.state so clients
 * and other server code never observe missing per-player zones.
 * 
 * After broadcasting, checks if the current priority holder is an AI player
 * and triggers AI handling if needed.
 */
export function broadcastGame(
  io: Server,
  game: InMemoryGame,
  gameId: string
) {
  let participants:
    | Array<{
        socketId: string;
        playerId: string;
        spectator: boolean;
      }>
    | null = null;

  try {
    if (typeof (game as any).participants === "function") {
      participants = (game as any).participants();
    } else if (
      (game as any).participantsList &&
      Array.isArray((game as any).participantsList)
    ) {
      participants = (game as any).participantsList.slice();
    } else {
      participants = [];
    }
  } catch (err) {
    debugWarn(1, "broadcastGame: failed to obtain participants:", err);
    participants = [];
  }

  let anySent = false;

  if (participants && participants.length) {
    for (const p of participants) {
      try {
        let rawView;
        try {
          rawView =
            typeof (game as any).viewFor === "function"
              ? (game as any).viewFor(p.playerId, !!p.spectator)
              : (game as any).state;
        } catch {
          rawView = (game as any).state;
        }

        const view = normalizeViewForEmit(rawView, game);

        logStateDebug("BROADCAST_STATE", gameId, view);

        if (p.socketId) {
          io.to(p.socketId).emit("state", {
            gameId,
            view,
            seq: (game as any).seq,
          });
          anySent = true;
        }
      } catch (err) {
        debugWarn(1, 
          "broadcastGame: failed to send state to",
          p.socketId,
          err
        );
      }
    }
  }

  // Fallback: if we had no participants or failed to send to anyone,
  // emit to the entire game room so rejoined sockets still receive updates.
  if (!anySent) {
    try {
      let rawView: any;
      try {
        if (typeof (game as any).viewFor === "function") {
          const statePlayers: any[] = (game as any).state?.players || [];
          const firstId: string | undefined = statePlayers[0]?.id;
          rawView = firstId
            ? (game as any).viewFor(firstId, false)
            : (game as any).state;
        } else {
          rawView = (game as any).state;
        }
      } catch {
        rawView = (game as any).state;
      }

      const view = normalizeViewForEmit(rawView, game);
      logStateDebug("BROADCAST_STATE", gameId, view);
      io.to(gameId).emit("state", {
        gameId,
        view,
        seq: (game as any).seq,
      });
    } catch (err) {
      debugWarn(1, 
        "broadcastGame: fallback emit to room failed for gameId",
        gameId,
        err
      );
    }
  }
  
  // After broadcasting, check if the current priority holder is an AI player
  // This ensures AI responds to game state changes
  checkAndTriggerAI(io, game, gameId);
  
  // Check if the current priority holder should auto-pass
  // This ensures human players with auto-pass enabled don't get stuck with priority
  checkAndTriggerAutoPass(io, game, gameId);
  
  // Check for pending Kynaios and Tiro style choices (play land or draw)
  checkAndEmitKynaiosChoicePrompts(io, game, gameId);
  
  // Legacy checkAndEmitProliferatePrompts call removed - now handled by processPendingProliferate()
  // in resolution queue after stack resolution
  
  // Check for newly eliminated players (commander damage, life loss, etc.)
  checkAndEmitPlayerElimination(io, game, gameId);
}

/** AI reaction delay - matches timing in ai.ts */
const AI_REACTION_DELAY_MS = 300;

/**
 * DEPRECATED: Legacy Kynaios choice prompt checker
 * 
 * Kynaios and Tiro choices are now handled by the Resolution Queue system.
 * This function only cleans up any legacy pendingKynaiosChoice state if found.
 */
function checkAndEmitKynaiosChoicePrompts(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const gameState = (game as any).state;
    if (!gameState) return;
    
    const pendingKynaiosChoice = gameState.pendingKynaiosChoice;
    if (!pendingKynaiosChoice || Object.keys(pendingKynaiosChoice).length === 0) return;
    
    // Legacy state found - clean it up as this should not be used anymore
    debugWarn(1, `[util] DEPRECATED: Found legacy pendingKynaiosChoice state. This should use Resolution Queue. Cleaning up.`);
    delete gameState.pendingKynaiosChoice;
    delete gameState._kynaiosChoicePromptedPlayers;
    
  } catch (e) {
    debugWarn(1, '[util] checkAndEmitKynaiosChoicePrompts error:', e);
  }
}

/**
 * Check if any player needs to order multiple simultaneous triggers
 * and emit the appropriate prompts
 */
/**
 * Legacy proliferate prompt function removed
 * Proliferate is now handled through processPendingProliferate() in resolution queue
 */

/**
 * Check for newly eliminated players and emit appropriate notifications
 * This handles commander damage wins, life loss, poison counters, etc.
 */
function checkAndEmitPlayerElimination(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const gameState = (game as any).state;
    if (!gameState) return;
    
    const players = gameState.players || [];
    
    // Track if we've already notified about this player
    // Store this on the game state to avoid duplicate notifications
    if (!(gameState as any).eliminationNotifications) {
      (gameState as any).eliminationNotifications = new Set<string>();
    }
    const notifiedPlayers = (gameState as any).eliminationNotifications;
    
    // Check each player for elimination
    for (const player of players) {
      if (!player || !player.id) continue;
      
      // Skip if we've already notified about this player
      if (notifiedPlayers.has(player.id)) continue;
      
      // Check if player has been marked as eliminated
      if (player.hasLost || player.eliminated) {
        const playerName = player.name || player.id;
        const reason = player.lossReason || "Unknown reason";
        
        // Mark as notified to avoid duplicate emissions
        notifiedPlayers.add(player.id);
        
        // Emit player elimination event
        io.to(gameId).emit("playerEliminated", {
          gameId,
          playerId: player.id,
          playerName,
          reason,
        });
        
        debug(1, `[checkAndEmitPlayerElimination] Player ${playerName} eliminated: ${reason}`);
        
        // Check if game is over (only 1 or 0 active players remaining)
        const activePlayers = players.filter((p: any) => 
          p && p.id && !p.hasLost && !p.eliminated && !p.conceded && !p.isSpectator
        );
        
        if (activePlayers.length === 1) {
          // One player left - they win!
          const winner = activePlayers[0];
          const winnerName = winner.name || winner.id;
          
          io.to(gameId).emit("gameOver", {
            gameId,
            type: 'victory',
            winnerId: winner.id,
            winnerName,
            loserId: player.id,
            loserName: playerName,
            message: `${winnerName} Wins!`,
          });
          
          // Mark game as over
          gameState.gameOver = true;
          gameState.winner = winner.id;
          
          debug(1, `[checkAndEmitPlayerElimination] Game over! ${winnerName} wins.`);
        } else if (activePlayers.length === 0) {
          // No players left - draw
          io.to(gameId).emit("gameOver", {
            gameId,
            type: 'draw',
            message: "Draw!",
          });
          
          gameState.gameOver = true;
          
          debug(1, `[checkAndEmitPlayerElimination] Game over! Draw.`);
        }
      }
    }
  } catch (err) {
    debugWarn(1, `[checkAndEmitPlayerElimination] Error:`, err);
  }
}

/**
 * Check if the current priority holder is an AI and trigger their turn
 * This is called after broadcasting to ensure AI reacts to state changes
 */
function checkAndTriggerAI(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const priority = (game.state as any)?.priority;
    const currentStep = (game.state as any)?.step;
    const turnPlayer = (game.state as any)?.turnPlayer;
    const players = (game.state as any)?.players || [];
    
    // Special case: Kynaios and Tiro style choices
    // These can affect any player (not just the one with priority)
    // Check if any AI player needs to make a Kynaios choice
    const pendingKynaiosChoice = (game.state as any).pendingKynaiosChoice;
    if (pendingKynaiosChoice) {
      for (const [controllerId, choiceData] of Object.entries(pendingKynaiosChoice)) {
        const choice = choiceData as any;
        if (!choice.active) continue;
        
        const playersWhoMayPlayLand = choice.playersWhoMayPlayLand || [];
        const playersWhoPlayedLand = choice.playersWhoPlayedLand || [];
        const playersWhoDeclined = choice.playersWhoDeclined || [];
        
        // Find AI players who need to make a choice
        for (const playerId of playersWhoMayPlayLand) {
          if (playersWhoPlayedLand.includes(playerId) || playersWhoDeclined.includes(playerId)) {
            continue; // Already made choice
          }
          
          const playerObj = players.find((p: any) => p?.id === playerId);
          if (playerObj && playerObj.isAI) {
            // Trigger AI to handle Kynaios choice
            setTimeout(async () => {
              try {
                const aiModule = await import('./ai.js');
                if (typeof aiModule.handleAIGameFlow === 'function') {
                  await aiModule.handleAIGameFlow(io, gameId, playerId);
                }
              } catch (e) {
                debugError(1, '[util] Failed to trigger AI handler for Kynaios choice:', { gameId, playerId, error: e });
              }
            }, AI_REACTION_DELAY_MS);
            return; // Exit - handle one AI at a time
          }
        }
      }
    }
    
    if (!priority) return;
    
    // Check if the current priority holder is an AI player
    const priorityPlayer = players.find((p: any) => p?.id === priority);
    
    if (priorityPlayer && priorityPlayer.isAI) {
      // Dynamically import AI handler to avoid circular deps
      setTimeout(async () => {
        try {
          const aiModule = await import('./ai.js');
          if (typeof aiModule.handleAIGameFlow === 'function') {
            await aiModule.handleAIGameFlow(io, gameId, priority);
          } else if (typeof aiModule.handleAIPriority === 'function') {
            await aiModule.handleAIPriority(io, gameId, priority);
          }
        } catch (e) {
          debugError(1, '[util] Failed to trigger AI handler:', { gameId, playerId: priority, error: e });
        }
      }, AI_REACTION_DELAY_MS);
    }
  } catch (e) {
    debugError(1, '[util] checkAndTriggerAI error:', { gameId, error: e });
  }
}

/**
 * Check if the current priority holder should auto-pass and trigger it if needed
 * This ensures human players with auto-pass enabled don't get stuck with priority
 * when they have no legal actions available.
 * 
 * For human players, a small delay is added before auto-passing to give them a chance
 * to evaluate the board state and potentially claim priority if they want to act.
 */
function checkAndTriggerAutoPass(io: Server, game: InMemoryGame, gameId: string): void {
  try {
    const stateAny = game.state as any;
    const priority = stateAny?.priority;
    
    // ========================================================================
    // DEBUG: Track auto-pass calls to diagnose skip issues
    // ========================================================================
    const debugCallId = `autopass_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    debug(2, `${ts()} [checkAndTriggerAutoPass] ========== CALLED (ID: ${debugCallId}) ==========`);
    debug(2, `${ts()} [checkAndTriggerAutoPass] Priority: ${priority}, Phase: ${stateAny?.phase}, Step: ${stateAny?.step}`);
    // ========================================================================
    
    if (!priority) {
      // CRITICAL FIX: If priority is null, check if we're stuck in resolution mode
      // Priority should only be null during:
      // 1. UNTAP step (Rule 502.1)
      // 2. CLEANUP step (Rule 514.1)
      // 3. Active resolution of a spell/ability (Rule 608.2)
      // If priority is null in any other phase/step and there are no pending resolution steps,
      // the game is stuck and we need to restore priority.
      
      const phase = String(stateAny?.phase || '').toLowerCase();
      const step = String(stateAny?.step || '').toUpperCase();
      const stepsThatDontGrantPriority = ['UNTAP', 'CLEANUP'];
      
      // Check if this is a phase/step that should have priority
      const shouldHavePriority = !stepsThatDontGrantPriority.includes(step);
      
      if (shouldHavePriority) {
        // Check if there are actually pending resolution steps
        const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);
        
        if (!pendingSummary.hasPending) {
          // STUCK STATE DETECTED: Priority is null but there are no pending steps
          // and we're in a phase that should have priority
          debugWarn(1, `${ts()} [checkAndTriggerAutoPass] STUCK STATE DETECTED: Priority is null in ${phase}/${step} with no pending resolution steps!`);
          debugWarn(1, `${ts()} [checkAndTriggerAutoPass] Restoring priority to turn player to fix stuck game (ID: ${debugCallId})`);
          
          // Restore priority to turn player
          const turnPlayer = stateAny.turnPlayer;
          if (turnPlayer) {
            stateAny.priority = turnPlayer;
            debug(1, `${ts()} [checkAndTriggerAutoPass] Priority restored to ${turnPlayer}`);
            
            // Mark that we just restored priority to prevent recursive broadcast
            stateAny._priorityJustRestored = true;
            
            // Bump sequence to trigger state update
            if (typeof (game as any).bumpSeq === "function") {
              (game as any).bumpSeq();
            }
            
            // Clear the flag after a brief delay (enough for one broadcast cycle)
            setTimeout(() => {
              delete stateAny._priorityJustRestored;
            }, PRIORITY_RESTORE_FLAG_TIMEOUT_MS);
            
            // Don't call broadcastGame here to avoid recursion - the caller will handle it
            // Now continue with normal auto-pass logic (don't return early)
          } else {
            debugError(1, `${ts()} [checkAndTriggerAutoPass] Cannot restore priority - no turn player found!`);
            return;
          }
        } else {
          // Priority is null because we're in resolution mode - this is correct
          debug(2, `${ts()} [checkAndTriggerAutoPass] Priority is null due to active resolution (${pendingSummary.pendingCount} pending steps), returning (ID: ${debugCallId})`);
          return;
        }
      } else {
        // Priority is null in UNTAP or CLEANUP - this is correct per MTG rules
        debug(2, `${ts()} [checkAndTriggerAutoPass] No priority holder (step ${step} doesn't grant priority), returning (ID: ${debugCallId})`);
        return;
      }
    }
    
    // IMPORTANT: Do not auto-pass during pre_game phase
    // During pre_game, players are selecting decks, commanders, and making mulligan decisions.
    // Auto-pass should not interfere with these setup steps.
    if (stateAny?.phase === 'pre_game' || stateAny?.phase === 'PRE_GAME') {
      debug(2, `${ts()} [checkAndTriggerAutoPass] In pre_game phase, auto-pass disabled (ID: ${debugCallId})`);
      return;
    }
    
    // Prevent re-entry while auto-passing is in progress
    // This avoids recursive calls that might advance steps incorrectly
    if (!stateAny._autoPassInProgress) {
      stateAny._autoPassInProgress = new Set<string>();
    }
    if (stateAny._autoPassInProgress.has(priority)) {
      debug(2, `[checkAndTriggerAutoPass] Already processing auto-pass for ${priority}, skipping re-entry (ID: ${debugCallId})`);
      return;
    }
    
    // Check if auto-pass is enabled for this player
    const autoPassPlayers = stateAny.autoPassPlayers || new Set();
    const autoPassForTurn = stateAny.autoPassForTurn?.[priority] || false;
    
    if (!autoPassPlayers.has(priority) && !autoPassForTurn) {
      // Auto-pass not enabled for this player
      debug(2, `${ts()} [checkAndTriggerAutoPass] Auto-pass not enabled for ${priority}, returning (ID: ${debugCallId})`);
      return;
    }
    
    // Check if the player is an AI (AI is handled separately in checkAndTriggerAI)
    const players = stateAny?.players || [];
    const priorityPlayer = players.find((p: any) => p?.id === priority);
    if (priorityPlayer && priorityPlayer.isAI) {
      // AI players are handled by checkAndTriggerAI, skip
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} is AI, handled separately (ID: ${debugCallId})`);
      return;
    }
    
    // Check if player has claimed priority (wants to take action)
    if (!stateAny.priorityClaimed) {
      stateAny.priorityClaimed = new Set<string>();
    }
    if (stateAny.priorityClaimed.has(priority)) {
      // Player has claimed priority, don't auto-pass
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} claimed priority, returning (ID: ${debugCallId})`);
      return;
    }
    
    // CRITICAL: If autoPassForTurn is enabled, skip the canAct check and auto-pass immediately
    // This fixes the bug where "Auto-Pass Rest of Turn" didn't work properly
    if (!autoPassForTurn) {
      // Only check if player can act when autoPassForTurn is NOT enabled
      // Use the imported canAct and canRespond functions
      // Create a minimal GameContext with required properties
      // CRITICAL: Use actual game data (libraries, mana pool) for accurate checks
      const ctx: any = {
        gameId,
        state: game.state,
        // Use actual libraries from game, not an empty map
        libraries: (game as any).libraries || new Map(),
        life: stateAny.life || {},
        poison: {},
        experience: {},
        commandZone: stateAny.commandZone || {},
        joinedBySocket: new Map(),
        participantsList: [],
        tokenToPlayer: new Map(),
        playerToToken: new Map(),
        grants: new Map(),
        inactive: new Set(),
        spectatorNames: new Map(),
        pendingInitialDraw: new Set(),
        handVisibilityGrants: new Map(),
        rngSeed: null,
        rng: () => 0,
        seq: { value: 0 },
        bumpSeq: () => {},
        passesInRow: { value: 0 },
        landsPlayedThisTurn: stateAny.landsPlayedThisTurn || {},
        maxLandsPerTurn: {},
        additionalDrawsPerTurn: {},
        // Use actual mana pool from game state
        manaPool: stateAny.manaPool || {},
      };
      
      const turnPlayer = stateAny.turnPlayer;
      const isActivePlayer = priority === turnPlayer;
      
      // Check if player can take any actions
      let playerCanAct = false;
      try {
        playerCanAct = isActivePlayer 
          ? canAct(ctx, priority)      // Active player: check all actions
          : canRespond(ctx, priority);  // Non-active: only check instant-speed responses
        
        debug(2, `${ts()} [checkAndTriggerAutoPass] canAct check: ${priority} isActive=${isActivePlayer} canAct=${playerCanAct} (ID: ${debugCallId})`);
      } catch (err) {
        debugWarn(1, `[checkAndTriggerAutoPass] Error checking if player ${priority} can act (ID: ${debugCallId}):`, err);
        // On error, don't auto-pass to be safe
        return;
      }
      
      // If player can act, don't auto-pass
      if (playerCanAct) {
        debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} CAN ACT - returning early, NO auto-pass (ID: ${debugCallId})`);
        return;
      }
      
      debug(2, `${ts()} [checkAndTriggerAutoPass] ${priority} CANNOT ACT - proceeding with auto-pass (ID: ${debugCallId})`);
    } else {
      debug(2, `[checkAndTriggerAutoPass] Auto-pass for rest of turn is enabled for ${priority} - bypassing canAct check`);
    }
    
    // For human players, add a small delay before auto-passing
    // This gives them a moment to see the board state and potentially claim priority
    // AI players and autoPassForTurn skip this delay for snappier gameplay
    const isHumanPlayer = priorityPlayer && !priorityPlayer.isAI;
    
    const executeAutoPass = () => {
      debug(2, `${ts()} [executeAutoPass] ========== EXECUTING for ${priority} (ID: ${debugCallId}) ==========`);
      debug(2, `${ts()} [executeAutoPass] Phase: ${(game.state as any)?.phase}, Step: ${(game.state as any)?.step}`);
      
      // Re-check conditions after delay (state might have changed)
      const currentState = game.state as any;
      const currentPriority = currentState?.priority;
      
      // Only proceed if priority hasn't changed
      if (currentPriority !== priority) {
        debug(2, `${ts()} [executeAutoPass] Priority changed from ${priority} to ${currentPriority}, aborting (ID: ${debugCallId})`);
        return;
      }
      
      // Check if player claimed priority during the delay
      if (currentState.priorityClaimed?.has(priority)) {
        debug(2, `${ts()} [executeAutoPass] ${priority} claimed priority during delay, aborting (ID: ${debugCallId})`);
        return;
      }
      
      // CRITICAL FIX: Re-check if player can act before auto-passing
      // This prevents auto-pass from advancing when a player gains the ability to act
      // (e.g., after step advancement gives them priority in their main phase)
      if (!autoPassForTurn) {
        // Recreate context for re-check
        // CRITICAL: Use actual game data (libraries, mana pool) for accurate checks
        const recheckCtx: any = {
          gameId,
          state: game.state,
          // Use actual libraries from game, not an empty map
          libraries: (game as any).libraries || new Map(),
          life: currentState.life || {},
          poison: {},
          experience: {},
          commandZone: currentState.commandZone || {},
          joinedBySocket: new Map(),
          participantsList: [],
          tokenToPlayer: new Map(),
          playerToToken: new Map(),
          grants: new Map(),
          inactive: new Set(),
          spectatorNames: new Map(),
          pendingInitialDraw: new Set(),
          handVisibilityGrants: new Map(),
          rngSeed: null,
          rng: () => 0,
          seq: { value: 0 },
          bumpSeq: () => {},
          passesInRow: { value: 0 },
          landsPlayedThisTurn: currentState.landsPlayedThisTurn || {},
          maxLandsPerTurn: {},
          additionalDrawsPerTurn: {},
          // Use actual mana pool from game state
          manaPool: currentState.manaPool || {},
        };
        
        const turnPlayer = currentState.turnPlayer;
        const isActivePlayer = priority === turnPlayer;
        
        // Re-check if player can take any actions
        try {
          const playerCanActNow = isActivePlayer 
            ? canAct(recheckCtx, priority)
            : canRespond(recheckCtx, priority);
          
          debug(2, `${ts()} [executeAutoPass] Re-check: ${priority} canAct=${playerCanActNow} (ID: ${debugCallId})`);
          
          if (playerCanActNow) {
            debug(2, `${ts()} [executeAutoPass] Player ${priority} CAN NOW ACT - canceling auto-pass (ID: ${debugCallId})`);
            return;
          }
        } catch (err) {
          debugWarn(1, `${ts()} [executeAutoPass] Error re-checking if player ${priority} can act (ID: ${debugCallId}):`, err);
          // On error, don't auto-pass to be safe
          return;
        }
      }
      
      // Player cannot act and has auto-pass enabled - auto-pass their priority
      debug(2, `${ts()} [executeAutoPass] Proceeding with auto-pass for ${priority} (ID: ${debugCallId})`);
      
      // Mark that we're processing auto-pass for this player
      stateAny._autoPassInProgress.add(priority);
      debug(2, `${ts()} [executeAutoPass] Set _autoPassInProgress flag for ${priority} (ID: ${debugCallId})`);
      
      // Call passPriority with isAutoPass flag
      if (typeof (game as any).passPriority === 'function') {
        try {
          const result = (game as any).passPriority(priority, true); // true = isAutoPass
          debug(2, `${ts()} [executeAutoPass] passPriority result: changed=${result.changed}, advanceStep=${result.advanceStep}, resolvedNow=${result.resolvedNow} (ID: ${debugCallId})`);
          
          if (result.changed) {
            // Priority was passed successfully
            appendGameEvent(game, gameId, "passPriority", { by: priority, auto: true });
            
            // Handle stack resolution or step advancement if needed
            if (result.resolvedNow) {
              debug(2, `[checkAndTriggerAutoPass] Stack resolved after auto-pass for ${priority}`);
              if (typeof (game as any).resolveTopOfStack === 'function') {
                (game as any).resolveTopOfStack();
              }
              appendGameEvent(game, gameId, "resolveTopOfStack", { auto: true });
            }
            
            if (result.advanceStep) {
              debug(2, `${ts()} [executeAutoPass] Advancing step after auto-pass for ${priority} (ID: ${debugCallId})`);
              if (typeof (game as any).nextStep === 'function') {
                (game as any).nextStep();
              }
              // Note: Don't call appendGameEvent here - nextStep() already handles event persistence
            }
            
            // Clear the in-progress flag before broadcasting
            // This allows the next player to be checked
            stateAny._autoPassInProgress.delete(priority);
            debug(2, `${ts()} [executeAutoPass] Cleared _autoPassInProgress flag for ${priority} (ID: ${debugCallId})`);
            
            // Broadcast updated state after auto-pass
            // Note: This will recursively call checkAndTriggerAutoPass for the next player
            debug(2, `${ts()} [executeAutoPass] Broadcasting state after auto-pass (ID: ${debugCallId})`);
            broadcastGame(io, game, gameId);
            debug(2, `${ts()} [executeAutoPass] Broadcast complete (ID: ${debugCallId})`);
          } else {
            // Priority pass didn't change state - clear flag
            debug(2, `${ts()} [executeAutoPass] Priority pass didn't change state (ID: ${debugCallId})`);
            stateAny._autoPassInProgress.delete(priority);
          }
        } catch (err) {
          debugError(1, `${ts()} [executeAutoPass] Error passing priority for ${priority} (ID: ${debugCallId}):`, err);
          // Clear flag on error
          stateAny._autoPassInProgress.delete(priority);
        }
      } else {
        // passPriority function not available - clear flag
        debug(2, `${ts()} [executeAutoPass] passPriority function not available (ID: ${debugCallId})`);
        stateAny._autoPassInProgress.delete(priority);
      }
    };
    
    // For human players without autoPassForTurn, add a small delay
    // This allows them to evaluate and claim priority if needed
    if (isHumanPlayer && !autoPassForTurn) {
      debug(2, `${ts()} [checkAndTriggerAutoPass] Scheduling auto-pass for ${priority} with ${AUTO_PASS_DELAY_MS}ms delay (ID: ${debugCallId})`);
      setTimeout(executeAutoPass, AUTO_PASS_DELAY_MS);
    } else {
      // AI players or autoPassForTurn: execute immediately
      debug(2, `${ts()} [checkAndTriggerAutoPass] Executing auto-pass for ${priority} IMMEDIATELY (isHuman=${isHumanPlayer}, autoPassForTurn=${autoPassForTurn}) (ID: ${debugCallId})`);
      executeAutoPass();
    }
  } catch (e) {
    debugError(1, '[util] checkAndTriggerAutoPass error:', { gameId, error: e });
  }
}

/**
 * Appends a game event (both in-memory and persisted to the DB).
 * This attempts to call game.applyEvent and then persists via appendEvent.
 */
export function appendGameEvent(
  game: InMemoryGame,
  gameId: string,
  type: string,
  payload: Record<string, any> = {}
) {
  try {
    if (typeof (game as any).applyEvent === "function") {
      (game as any).applyEvent({ type, ...payload });
    } else if (typeof (game as any).apply === "function") {
      (game as any).apply(type, payload);
    } else {
      if ((game as any).state && typeof (game as any).state === "object") {
        // no-op; rely on persisted events for reconstruction
      }
    }
  } catch (err) {
    debugWarn(1, "appendGameEvent: in-memory apply failed:", err);
  }

  try {
    appendEvent(gameId, (game as any).seq, type, payload);
  } catch (err) {
    debugWarn(1, "appendGameEvent: DB appendEvent failed:", err);
  }
}

/**
 * Clears the priority timer for a given Game ID.
 */
export function clearPriorityTimer(gameId: string) {
  const existingTimeout = priorityTimers.get(gameId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    priorityTimers.delete(gameId);
  }
}

/**
 * Schedules a priority pass timeout, automatically passing after the configured delay.
 * If the game has only one active player and a non-empty stack, passes immediately.
 * If priority is null (no player has priority), auto-advance to next step.
 */
export function schedulePriorityTimeout(
  io: Server,
  game: InMemoryGame,
  gameId: string
) {
  clearPriorityTimer(gameId);

  try {
    if (!game.state || !game.state.active) return;
    
    // IMPORTANT: Do not auto-advance during pre_game phase
    // During pre_game, players are selecting decks, commanders, and making mulligan decisions.
    const currentPhase = String((game.state as any)?.phase || '').toLowerCase();
    if (currentPhase === 'pre_game') {
      debug(2, `[schedulePriorityTimeout] In pre_game phase, not scheduling timeout for game ${gameId}`);
      return;
    }
    
    // If priority is null (no player has priority), auto-advance to next step
    // This happens in steps like DRAW where there are no triggers - only turn-based actions
    if (!game.state.priority) {
      debug(2, `[schedulePriorityTimeout] Priority is null, auto-advancing step for game ${gameId}`);
      // Schedule immediate step advancement
      priorityTimers.set(
        gameId,
        setTimeout(() => {
          // Auto-advance to next step
          if (typeof (game as any).nextStep === 'function') {
            (game as any).nextStep();
            appendGameEvent(game, gameId, "nextStep", { reason: 'noPriority' });
            broadcastGame(io, game, gameId);
            debug(2, `[schedulePriorityTimeout] Auto-advanced step (no priority) for game ${gameId}`);
          }
        }, 0)
      );
      return;
    }
  } catch {
    return;
  }

  const activePlayers = (game.state.players || []).filter(
    (p: any) => !p.inactive
  );
  if (
    activePlayers.length === 1 &&
    Array.isArray(game.state.stack) &&
    game.state.stack.length > 0
  ) {
    priorityTimers.set(
      gameId,
      setTimeout(() => {
        doAutoPass(io, game, gameId, "auto-pass (single player)");
      }, 0)
    );
    return;
  }

  const startSeq = (game as any).seq;
  const timeout = setTimeout(() => {
    priorityTimers.delete(gameId);
    const updatedGame = games.get(gameId);
    if (!updatedGame || (updatedGame as any).seq !== startSeq) return;
    doAutoPass(io, updatedGame, gameId, "auto-pass (timeout)");
  }, PRIORITY_TIMEOUT_MS);

  priorityTimers.set(gameId, timeout);
}

/**
 * Automatically passes the priority during a timeout.
 * For AI players: Always auto-pass.
 * For human players: Only auto-pass if they have no valid responses available.
 */
function doAutoPass(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  reason: string
) {
  try {
    const playerId = game.state.priority;
    if (!playerId) return;
    
    // Check if priority player exists
    const players = (game.state as any)?.players || [];
    const priorityPlayer = players.find((p: any) => p?.id === playerId);
    
    if (!priorityPlayer) {
      debugWarn(2, `[doAutoPass] Priority player ${playerId} not found in game ${gameId}`);
      return;
    }
    
    // Get turn player and current step for checks below
    const turnPlayer = game.state.turnPlayer;
    const currentStep = (game.state.step || '').toString().toUpperCase();
    
    // In multiplayer, defending player is anyone being attacked, not just "not the turn player"
    // Check if this player has creatures attacking them
    const battlefield = game.state?.battlefield || [];
    const isBeingAttacked = battlefield.some((perm: any) => perm?.attacking === playerId);
    
    // Check if player has potential blockers (untapped creatures)
    const hasPotentialBlockers = battlefield.some((perm: any) => {
      if (!perm || perm.controller !== playerId) return false;
      if (perm.tapped) return false;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature');
    });
    
    const isDefendingPlayer = isBeingAttacked && hasPotentialBlockers;
    
    // For human players, only auto-pass if they have NO valid responses
    if (!priorityPlayer.isAI) {
      // For the active player (turn player), check BOTH canAct and canRespond
      // They need to be able to hold priority to cast instants on their own turn
      // For non-active players, only check canRespond (instant-speed responses)
      const isActivePlayer = playerId === turnPlayer;
      const hasActions = isActivePlayer 
        ? (canAct(game as any, playerId) || canRespond(game as any, playerId))
        : canRespond(game as any, playerId);
      
      if (hasActions) {
        debug(2, `[doAutoPass] Skipping auto-pass for human player ${playerId} (${isActivePlayer ? 'active' : 'non-active'}) - they have valid actions available`);
        return; // Player has options, don't auto-pass
      }
      
      debug(2, `[doAutoPass] Auto-passing for human player ${playerId} (${isActivePlayer ? 'active' : 'non-active'}) - no valid actions available`);
      // Fall through to auto-pass since player has no valid responses
    }
    
    // IMPORTANT: Don't auto-pass during DECLARE_BLOCKERS step for defending players
    // Per Rule 509, the defending player must be given the opportunity to declare blockers
    // This is a turn-based action that doesn't use the stack
    // Only prevent auto-pass if player is being attacked AND has untapped creatures to block with
    
    if ((currentStep === 'DECLARE_BLOCKERS' || currentStep.includes('BLOCKERS')) && isDefendingPlayer) {
      debug(2, `[doAutoPass] Skipping auto-pass for ${playerId} during DECLARE_BLOCKERS step - player has potential blockers`);
      return;
    }

    // game.passPriority may not exist on some wrappers; call defensively
    let res: any = null;
    if (typeof (game as any).passPriority === "function") {
      res = (game as any).passPriority(playerId, true); // true = isAutoPass
    } else if (typeof (game as any).nextPass === "function") {
      res = (game as any).nextPass(playerId);
    } else {
      debugWarn(1, 
        "doAutoPass: game.passPriority not implemented for this game wrapper"
      );
      return;
    }

    const changed = Boolean(res && (res.changed ?? true));
    const resolvedNow = Boolean(res && (res.resolvedNow ?? false));
    if (!changed) return;

    appendGameEvent(game, gameId, "passPriority", { by: playerId, reason });

    if (resolvedNow) {
      // Directly call resolveTopOfStack to ensure the spell resolves
      if (typeof (game as any).resolveTopOfStack === "function") {
        (game as any).resolveTopOfStack();
        debug(2, `[doAutoPass] Stack resolved for game ${gameId}`);
      }
      appendGameEvent(game, gameId, "resolveTopOfStack");
      try {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: "Top of stack resolved automatically.",
          ts: Date.now(),
        });
      } catch (err) {
        debugWarn(1, "doAutoPass: failed to emit chat", err);
      }
    }

    broadcastGame(io, game, gameId);
  } catch (err) {
    debugWarn(1, "doAutoPass: unexpected error", err);
  }
}

// ============================================================================
// Library Search Restriction Handling (Aven Mindcensor, Stranglehold, etc.)
// ============================================================================

/** Known cards that prevent or restrict library searching */
const SEARCH_PREVENTION_CARDS: Record<string, { affectsOpponents: boolean; affectsSelf: boolean }> = {
  "stranglehold": { affectsOpponents: true, affectsSelf: false },
  "ashiok, dream render": { affectsOpponents: true, affectsSelf: false },
  "mindlock orb": { affectsOpponents: true, affectsSelf: true },
  "shadow of doubt": { affectsOpponents: true, affectsSelf: true },
  "leonin arbiter": { affectsOpponents: true, affectsSelf: true }, // Can pay {2}
};

/** Known cards that limit library searching to top N cards */
const SEARCH_LIMIT_CARDS: Record<string, { limit: number; affectsOpponents: boolean }> = {
  "aven mindcensor": { limit: 4, affectsOpponents: true },
};

/** Known cards that trigger when opponents search */
const SEARCH_TRIGGER_CARDS: Record<string, { effect: string; affectsOpponents: boolean }> = {
  "ob nixilis, unshackled": { effect: "Sacrifice a creature and lose 10 life", affectsOpponents: true },
};

/** Known cards that give control during opponent's search */
const SEARCH_CONTROL_CARDS = new Set(["opposition agent"]);

/**
 * Check for search restrictions affecting a player
 */
export function checkLibrarySearchRestrictions(
  game: any,
  searchingPlayerId: string
): {
  canSearch: boolean;
  limitToTop?: number;
  triggerEffects: { cardName: string; effect: string; controllerId: string }[];
  controlledBy?: string;
  reason?: string;
  paymentRequired?: { cardName: string; amount: string };
} {
  const battlefield = game.state?.battlefield || [];
  const triggerEffects: { cardName: string; effect: string; controllerId: string }[] = [];
  let canSearch = true;
  let limitToTop: number | undefined;
  let controlledBy: string | undefined;
  let reason: string | undefined;
  let paymentRequired: { cardName: string; amount: string } | undefined;
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const cardName = (perm.card.name || "").toLowerCase();
    const controllerId = perm.controller;
    const isOpponent = controllerId !== searchingPlayerId;
    
    // Check prevention cards
    for (const [name, info] of Object.entries(SEARCH_PREVENTION_CARDS)) {
      if (cardName.includes(name)) {
        const applies = (isOpponent && info.affectsOpponents) || (!isOpponent && info.affectsSelf);
        if (applies) {
          // Special case: Leonin Arbiter allows payment
          if (name === "leonin arbiter") {
            paymentRequired = { cardName: perm.card.name, amount: "{2}" };
          } else {
            canSearch = false;
            reason = `${perm.card.name} prevents library searching`;
          }
        }
      }
    }
    
    // Check limit cards (Aven Mindcensor)
    for (const [name, info] of Object.entries(SEARCH_LIMIT_CARDS)) {
      if (cardName.includes(name)) {
        if (isOpponent && info.affectsOpponents) {
          if (limitToTop === undefined || info.limit < limitToTop) {
            limitToTop = info.limit;
          }
        }
      }
    }
    
    // Check trigger cards (Ob Nixilis)
    for (const [name, info] of Object.entries(SEARCH_TRIGGER_CARDS)) {
      if (cardName.includes(name)) {
        if (isOpponent && info.affectsOpponents) {
          triggerEffects.push({
            cardName: perm.card.name,
            effect: info.effect,
            controllerId,
          });
        }
      }
    }
    
    // Check control cards (Opposition Agent)
    if (SEARCH_CONTROL_CARDS.has(cardName)) {
      if (isOpponent) {
        controlledBy = controllerId;
      }
    }
  }
  
  return {
    canSearch,
    limitToTop,
    triggerEffects,
    controlledBy,
    reason,
    paymentRequired,
  };
}



/**
 * Parse search criteria string into a filter object for library search.
 * E.g., "basic land card" -> { types: ['land'], supertypes: ['basic'] }
 * E.g., "planeswalker card" -> { types: ['planeswalker'] }
 * 
 * The filter format must match LibrarySearchModalProps['filter']:
 * - types: string[] (e.g., ['creature', 'planeswalker'])
 * - subtypes: string[] (e.g., ['forest', 'equipment'])
 * - supertypes: string[] (e.g., ['basic', 'legendary'])
 * - maxCmc: number
 */
function parseSearchFilter(criteria: string): { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } {
  if (!criteria) return {};
  
  const filter: { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } = {};
  const text = criteria.toLowerCase();
  
  // Card types - must be in types array for client filter to work
  const types: string[] = [];
  if (text.includes('creature')) types.push('creature');
  if (text.includes('instant')) types.push('instant');
  if (text.includes('sorcery')) types.push('sorcery');
  if (text.includes('artifact')) types.push('artifact');
  if (text.includes('enchantment')) types.push('enchantment');
  if (text.includes('planeswalker')) types.push('planeswalker');
  if (text.includes('land')) types.push('land');
  if (text.includes('tribal') || text.includes('kindred')) types.push('tribal');
  if (text.includes('battle')) types.push('battle');
  
  // Special composite types (these are handled specially by client matchesFilter)
  if (text.includes('historic')) types.push('historic');
  if (text.includes('permanent')) types.push('permanent');
  if (text.includes('noncreature')) types.push('noncreature');
  if (text.includes('nonland')) types.push('nonland');
  if (text.includes('nonartifact')) types.push('nonartifact');
  
  if (types.length > 0) {
    filter.types = types;
  }
  
  // Supertypes (Basic, Legendary, Snow, World, Ongoing)
  // Note: 'host' is included for consistency with existing code, though per MTG rules it's a creature type
  const supertypes: string[] = [];
  if (text.includes('basic')) supertypes.push('basic');
  if (text.includes('legendary')) supertypes.push('legendary');
  if (text.includes('snow')) supertypes.push('snow');
  if (text.includes('world')) supertypes.push('world');
  if (text.includes('ongoing')) supertypes.push('ongoing');
  if (text.includes('host')) supertypes.push('host');
  
  if (supertypes.length > 0) {
    filter.supertypes = supertypes;
  }
  
  // Subtypes (land types, creature types, etc.)
  const subtypes: string[] = [];
  if (text.includes('forest')) subtypes.push('forest');
  if (text.includes('plains')) subtypes.push('plains');
  if (text.includes('island')) subtypes.push('island');
  if (text.includes('swamp')) subtypes.push('swamp');
  if (text.includes('mountain')) subtypes.push('mountain');
  if (text.includes('equipment')) subtypes.push('equipment');
  if (text.includes('aura')) subtypes.push('aura');
  if (text.includes('vehicle')) subtypes.push('vehicle');
  
  if (subtypes.length > 0) {
    filter.subtypes = subtypes;
  }
  
  // CMC restrictions
  const cmcMatch = text.match(/mana value (\d+) or less/);
  if (cmcMatch) {
    filter.maxCmc = parseInt(cmcMatch[1], 10);
  }
  
  return filter;
}






/**
 * Maps mana color symbols to their human-readable names.
 */
export const MANA_COLOR_NAMES: Record<string, string> = {
  'W': 'white',
  'U': 'blue',
  'B': 'black',
  'R': 'red',
  'G': 'green',
  'C': 'colorless',
};

/**
 * Standard mana color symbols in WUBRG order plus colorless.
 */
export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type ManaColorSymbol = typeof MANA_COLORS[number];

/**
 * Gets the human-readable name for a mana color symbol.
 */
export function getManaColorName(symbol: string): string {
  return MANA_COLOR_NAMES[symbol] || symbol.toLowerCase();
}

/**
 * Parses a string mana cost into its individual components (color distribution, generic mana, etc.).
 * Handles Phyrexian mana symbols like {W/P} (can be paid with W or 2 life)
 */
export function parseManaCost(
  manaCost?: string
): {
  colors: Record<string, number>;
  generic: number;
  hybrids: Array<Array<string>>;
  hasX: boolean;
} {
  const PHYREXIAN_LIFE_COST = 2;
  const result = {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: 0,
    hybrids: [] as Array<Array<string>>,
    hasX: false,
  };

  if (!manaCost) return result;

  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const token of tokens) {
    const clean = token.replace(/[{}]/g, "").toUpperCase();
    if (clean === "X") {
      result.hasX = true;
    } else if (/^\d+$/.test(clean)) {
      result.generic += parseInt(clean, 10);
    } else if (clean.includes("/")) {
      const parts = clean.split("/");
      
      // Handle Phyrexian mana {W/P}, {U/P}, {B/P}, {R/P}, {G/P}
      if (parts[1] === "P") {
        // Phyrexian mana can be paid with the color OR 2 life
        const firstColor = parts[0];
        if (firstColor.length === 1 && (result.colors as any).hasOwnProperty(firstColor)) {
          result.hybrids.push([firstColor, `LIFE:${PHYREXIAN_LIFE_COST}`]);
        }
      } else if (/^\d+$/.test(parts[0])) {
        // Hybrid generic/color: {2/W}, {3/U}, etc.
        // Can be paid with either N generic OR 1 colored mana
        result.hybrids.push([`GENERIC:${parts[0]}`, parts[1]]);
      } else {
        // Regular hybrid: {W/U}, {B/R}, etc.
        result.hybrids.push(parts);
      }
    } else if (clean.length === 1 && (result.colors as any).hasOwnProperty(clean)) {
      (result.colors as any)[clean] =
        ((result.colors as any)[clean] || 0) + 1;
    } else {
      // unknown symbol -> ignore for now
      result.generic += 0;
    }
  }

  return result;
}


/**
 * Consumes mana from a player's mana pool to pay for a spell cost.
 * Returns the remaining mana in the pool after payment.
 * 
 * This function first consumes colored mana requirements, then uses remaining mana
 * (preferring colorless) to pay for generic costs. Any unspent mana remains in the pool
 * for subsequent spells.
 * 
 * @param pool - The player's mana pool (will be modified in place)
 * @param coloredCost - The colored mana requirements (e.g., { W: 1, U: 1, ... })
 * @param genericCost - The amount of generic mana required
 * @param logPrefix - Optional prefix for debug logging
 * @returns The mana consumed and remaining in pool
 */
export function consumeManaFromPool(
  pool: ManaPool | Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number,
  logPrefix?: string
): { consumed: Record<string, number>; remaining: Record<string, number> } {
  const consumed: Record<string, number> = {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  
  // First, consume colored mana requirements
  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = coloredCost[color] || 0;
    if (needed > 0 && colorKey && pool[colorKey] >= needed) {
      pool[colorKey] -= needed;
      consumed[colorKey] = (consumed[colorKey] || 0) + needed;
      if (logPrefix) {
        debug(2, `${logPrefix} Consumed ${needed} ${color} mana from pool`);
      }
    }
  }
  
  // Then, consume generic mana (use any available mana, preferring colorless first)
  let genericLeft = genericCost;
  
  // First use colorless
  if (genericLeft > 0 && pool.colorless > 0) {
    const useColorless = Math.min(pool.colorless, genericLeft);
    pool.colorless -= useColorless;
    consumed.colorless = (consumed.colorless || 0) + useColorless;
    genericLeft -= useColorless;
    if (logPrefix) {
      debug(2, `${logPrefix} Consumed ${useColorless} colorless mana for generic cost`);
    }
  }
  
  // Then use other colors
  for (const color of MANA_COLORS) {
    if (genericLeft <= 0) break;
    const colorKey = MANA_COLOR_NAMES[color];
    if (colorKey && pool[colorKey] > 0) {
      const useColor = Math.min(pool[colorKey], genericLeft);
      pool[colorKey] -= useColor;
      consumed[colorKey] = (consumed[colorKey] || 0) + useColor;
      genericLeft -= useColor;
      if (logPrefix) {
        debug(2, `${logPrefix} Consumed ${useColor} ${color} mana for generic cost`);
      }
    }
  }
  
  // Log remaining mana in pool
  if (logPrefix) {
    const remainingMana = Object.entries(pool).filter(([_, v]) => typeof v === 'number' && v > 0).map(([k, v]) => `${v} ${k}`).join(', ');
    if (remainingMana) {
      debug(2, `${logPrefix} Unspent mana remaining in pool: ${remainingMana}`);
    }
  }
  
  // Return only the mana color properties for the remaining pool
  const remaining: Record<string, number> = {};
  for (const key of MANA_COLOR_KEYS) {
    remaining[key] = pool[key] || 0;
  }
  
  return { consumed, remaining };
}

/**
 * Gets the current mana pool for a player, initializing it if needed.
 * Returns the enhanced ManaPool interface with support for restricted mana.
 */
export function getOrInitManaPool(
  gameState: any,
  playerId: string
): ManaPool {
  gameState.manaPool = gameState.manaPool || {};
  gameState.manaPool[playerId] = gameState.manaPool[playerId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  return gameState.manaPool[playerId];
}

/**
 * Gets the "doesn't empty" mana pool for a player (mana that persists until end of turn).
 * Used by cards like Grand Warlord Radha, Savage Ventmaw, Neheb, Omnath, etc.
 */
export function getOrInitPersistentManaPool(
  gameState: any,
  playerId: string
): Record<string, number> {
  gameState.persistentManaPool = gameState.persistentManaPool || {};
  gameState.persistentManaPool[playerId] = gameState.persistentManaPool[playerId] || {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
  };
  return gameState.persistentManaPool[playerId];
}

/**
 * Mana retention effects from permanents on the battlefield.
 * 
 * Types of effects:
 * - "doesn't empty" - specific color(s) don't empty (Omnath, Leyline Tyrant)
 * - "becomes colorless" - unspent mana becomes colorless instead of emptying (Kruphix, Horizon Stone)
 * - "all mana doesn't empty" - no mana empties (Upwelling)
 */
export interface ManaRetentionEffect {
  permanentId: string;
  cardName: string;
  type: 'doesnt_empty' | 'becomes_colorless' | 'all_doesnt_empty';
  colors?: string[]; // Which colors are affected (undefined = all)
}

/**
 * Detect mana retention effects from battlefield permanents
 */
export function detectManaRetentionEffects(
  gameState: any,
  playerId: string
): ManaRetentionEffect[] {
  const effects: ManaRetentionEffect[] = [];
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // Omnath, Locus of Mana - Green mana doesn't empty
    if (cardName.includes("omnath, locus of mana") || 
        (oracleText.includes("green mana") && oracleText.includes("doesn't empty"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Omnath",
        type: 'doesnt_empty',
        colors: ['green'],
      });
    }
    
    // Leyline Tyrant - Red mana doesn't empty
    // Electro, Assaulting Battery - Red mana doesn't empty
    if (cardName.includes("leyline tyrant") || cardName.includes("electro") ||
        (oracleText.includes("red mana") && oracleText.includes("don't lose")) ||
        (oracleText.includes("don't lose unspent red mana"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Leyline Tyrant",
        type: 'doesnt_empty',
        colors: ['red'],
      });
    }
    
    // Omnath, Locus of All - Mana becomes black instead of emptying
    if (cardName.includes("omnath, locus of all") ||
        (oracleText.includes("mana becomes") && oracleText.includes("instead of emptying"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Omnath, Locus of All",
        type: 'becomes_colorless', // Will be handled specially as 'becomes black'
        colors: ['black'], // Tag to convert to black
      });
    }
    
    // Kruphix, God of Horizons / Horizon Stone - Unspent mana becomes colorless
    if (cardName.includes("kruphix") || cardName.includes("horizon stone") ||
        oracleText.includes("mana becomes colorless instead")) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Horizon Stone",
        type: 'becomes_colorless',
      });
    }
    
    // Upwelling / Eladamri's Vineyard style - All mana doesn't empty
    if (cardName.includes("upwelling") ||
        (oracleText.includes("mana pools") && oracleText.includes("don't empty"))) {
      effects.push({
        permanentId: permanent.id,
        cardName: permanent.card?.name || "Upwelling",
        type: 'all_doesnt_empty',
      });
    }
    
    // Omnath, Locus of the Roil / Omnath, Locus of Creation - Landfall mana
    // (These add mana that doesn't need special retention handling)
    
    // Savage Ventmaw - Adds mana that doesn't empty until end of turn
    if (cardName.includes("savage ventmaw")) {
      // This is handled by combat triggers, not retention effects
    }
    
    // Grand Warlord Radha - Adds mana that doesn't empty until end of turn
    if (cardName.includes("grand warlord radha")) {
      // This is handled by attack triggers, not retention effects
    }
  }
  
  return effects;
}

/**
 * Add mana to persistent pool (doesn't empty until end of turn).
 * Sources: Grand Warlord Radha, Savage Ventmaw, Neheb, Omnath, etc.
 */
export function addPersistentMana(
  gameState: any,
  playerId: string,
  mana: { white?: number; blue?: number; black?: number; red?: number; green?: number; colorless?: number }
): void {
  const pool = getOrInitPersistentManaPool(gameState, playerId);
  for (const [color, amount] of Object.entries(mana)) {
    if (amount && amount > 0) {
      pool[color] = (pool[color] || 0) + amount;
    }
  }
}

/**
 * Process mana pool emptying at phase/step end, respecting retention effects.
 * 
 * This is the main function to call when steps/phases end.
 */
export function processManaDrain(gameState: any, playerId: string): {
  drained: Record<string, number>;
  retained: Record<string, number>;
  converted: Record<string, number>; // Colored mana that became colorless
} {
  const pool = getOrInitManaPool(gameState, playerId);
  const effects = detectManaRetentionEffects(gameState, playerId);
  
  const result = {
    drained: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    retained: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    converted: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  
  // Check for "all mana doesn't empty" effect
  const hasUpwellingEffect = effects.some(e => e.type === 'all_doesnt_empty');
  if (hasUpwellingEffect) {
    // All mana is retained
    for (const color of Object.keys(pool)) {
      result.retained[color] = pool[color] || 0;
    }
    return result;
  }
  
  // Check for "becomes colorless" effect (Kruphix, Horizon Stone)
  const hasBecomesColorless = effects.some(e => e.type === 'becomes_colorless' && !e.colors);
  
  // Check for "becomes black" effect (Omnath, Locus of All)
  const hasBecomesBlack = effects.some(e => e.type === 'becomes_colorless' && e.colors?.includes('black'));
  
  // Check which colors don't empty
  const colorsDoNotEmpty = new Set<string>();
  for (const effect of effects) {
    if (effect.type === 'doesnt_empty' && effect.colors) {
      for (const color of effect.colors) {
        colorsDoNotEmpty.add(color);
      }
    }
  }
  
  // Process each color
  for (const color of ['white', 'blue', 'black', 'red', 'green', 'colorless']) {
    const amount = pool[color] || 0;
    if (amount === 0) continue;
    
    if (colorsDoNotEmpty.has(color)) {
      // This color doesn't empty
      result.retained[color] = amount;
    } else if (hasBecomesBlack && color !== 'colorless' && color !== 'black') {
      // Colored mana becomes black (Omnath, Locus of All)
      result.converted[color] = amount;
      pool.black = (pool.black || 0) + amount;
      pool[color] = 0;
      result.retained.black = (result.retained.black || 0) + amount;
    } else if (hasBecomesColorless && color !== 'colorless') {
      // Colored mana becomes colorless (Kruphix, Horizon Stone)
      result.converted[color] = amount;
      pool.colorless = (pool.colorless || 0) + amount;
      pool[color] = 0;
      result.retained.colorless = (result.retained.colorless || 0) + amount;
    } else {
      // Mana empties normally
      result.drained[color] = amount;
      pool[color] = 0;
    }
  }
  
  return result;
}

/**
 * Clear normal mana pool (at phase/step end).
 * Use processManaDrain() instead for proper handling of retention effects.
 */
export function clearManaPool(gameState: any, playerId: string): void {
  if (gameState.manaPool?.[playerId]) {
    gameState.manaPool[playerId] = {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
  }
}

/**
 * Clear persistent mana pool (at end of turn only).
 */
export function clearPersistentManaPool(gameState: any, playerId: string): void {
  if (gameState.persistentManaPool?.[playerId]) {
    gameState.persistentManaPool[playerId] = {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
    };
  }
}

/**
 * Clear all mana pools at end of turn.
 */
export function clearAllManaPools(gameState: any, playerId: string): void {
  clearManaPool(gameState, playerId);
  clearPersistentManaPool(gameState, playerId);
}

/**
 * Get total available mana (normal pool + persistent pool).
 */
export function getTotalManaPool(
  gameState: any,
  playerId: string
): Record<string, number> {
  const normal = getOrInitManaPool(gameState, playerId);
  const persistent = getOrInitPersistentManaPool(gameState, playerId);
  
  return {
    white: (normal.white || 0) + (persistent.white || 0),
    blue: (normal.blue || 0) + (persistent.blue || 0),
    black: (normal.black || 0) + (persistent.black || 0),
    red: (normal.red || 0) + (persistent.red || 0),
    green: (normal.green || 0) + (persistent.green || 0),
    colorless: (normal.colorless || 0) + (persistent.colorless || 0),
  };
}

/**
 * Calculates the total available mana by combining existing pool with new payment.
 * Returns the combined pool in the same format as the mana pool (using color names as keys).
 */
export function calculateTotalAvailableMana(
  existingPool: ManaPool | Record<string, number>,
  newPayment: Array<{ mana: string; count?: number }> | undefined
): Record<string, number> {
  // Start with a copy of the existing pool
  const total: Record<string, number> = {
    white: existingPool.white || 0,
    blue: existingPool.blue || 0,
    black: existingPool.black || 0,
    red: existingPool.red || 0,
    green: existingPool.green || 0,
    colorless: existingPool.colorless || 0,
  };
  
  // Add new payment - use count field for multi-mana sources like Sol Ring
  if (newPayment && newPayment.length > 0) {
    for (const p of newPayment) {
      const colorKey = MANA_COLOR_NAMES[p.mana];
      if (colorKey) {
        // Use count if provided (e.g., Sol Ring produces 2), default to 1
        const manaAmount = p.count ?? 1;
        total[colorKey] = (total[colorKey] || 0) + manaAmount;
      }
    }
  }
  
  return total;
}

/**
 * Validates if the total available mana (existing pool + new payment) can pay for a spell.
 * Returns null if payment is sufficient, or an error message describing what's missing.
 */
export function validateManaPayment(
  totalAvailable: ManaPool | Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number
): string | null {
  const pool = { ...totalAvailable };
  const missingColors: string[] = [];
  
  // Check colored requirements
  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = coloredCost[color] || 0;
    const available = pool[colorKey] || 0;
    
    if (available < needed) {
      missingColors.push(`${needed - available} ${getManaColorName(color)}`);
    } else {
      // Reserve this mana for the colored cost
      pool[colorKey] -= needed;
    }
  }
  
  // Check generic requirement with remaining mana
  // Only sum numeric color values from the known mana color keys
  const remainingTotal = MANA_COLOR_KEYS.reduce((sum, key) => sum + (pool[key] || 0), 0);
  const missingGeneric = Math.max(0, genericCost - remainingTotal);
  
  if (missingColors.length > 0 || missingGeneric > 0) {
    let errorMsg = "Insufficient mana.";
    if (missingColors.length > 0) {
      errorMsg += ` Missing: ${missingColors.join(', ')}.`;
    }
    if (missingGeneric > 0) {
      errorMsg += ` Missing ${missingGeneric} generic mana.`;
    }
    return errorMsg;
  }
  
  return null;
}

/**
 * Mana production info for a permanent
 */
export interface ManaProductionInfo {
  /** Base colors this permanent can produce */
  colors: string[];
  /** Single color for creature-count mana (like any_combination for color choice) */
  color?: string;
  /** Base amount of mana produced per tap (before multipliers) */
  baseAmount: number;
  /** Whether the amount is dynamic (depends on game state) */
  isDynamic: boolean;
  /** Description of how mana is calculated (for dynamic sources) */
  dynamicDescription?: string;
  /** Extra mana from enchantments/effects on this permanent */
  bonusMana: { color: string; amount: number }[];
  /** Multiplier from global effects (Mana Reflection, Nyxbloom Ancient) */
  multiplier: number;
  /** Total mana produced (baseAmount * multiplier + bonuses) */
  totalAmount: number;
  /** Activation cost (for abilities like Three Tree City that require mana to activate) */
  activationCost?: string;
  /** Whether this ability requires a color choice prompt */
  requiresColorChoice?: boolean;
}

/**
 * Calculate the actual mana produced when a permanent is tapped.
 * 
 * This considers:
 * - Fixed multi-mana (Sol Ring: {C}{C})
 * - Dynamic mana (Gaea's Cradle: {G} per creature)
 * - Land enchantments (Wild Growth, Utopia Sprawl, Overgrowth)
 * - Global effects (Caged Sun, Mana Reflection, Mirari's Wake, Nyxbloom Ancient)
 * 
 * @param gameState - Current game state
 * @param permanent - The permanent being tapped for mana
 * @param playerId - Controller of the permanent
 * @param chosenColor - For "any color" abilities, which color was chosen
 * @returns ManaProductionInfo with calculated mana amounts
 */
export function calculateManaProduction(
  gameState: any,
  permanent: any,
  playerId: string,
  chosenColor?: string
): ManaProductionInfo {
  const card = permanent?.card || {};
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();
  const battlefield = gameState?.battlefield || [];
  
  const result: ManaProductionInfo = {
    colors: [],
    baseAmount: 1,
    isDynamic: false,
    bonusMana: [],
    multiplier: 1,
    totalAmount: 1,
  };
  
  // ===== STEP 1: Determine base mana production from the card itself =====
  
  // Check for standard mana ability patterns: "{T}: Add {X}" or "{T}: Add {X}{X}"
  // This MUST match the TAP SYMBOL followed by colon followed by Add to identify a mana ability
  // This avoids matching triggered abilities or reminder text like "firebending" which mentions adding mana
  // Pattern: \{t\}(?:[,\s]*[^:]*)?:\s*add\s+((?:\{[wubrgc]\})+)
  // This matches: {T}: Add {R}, or {1}, {T}: Add {R}{R}, etc.
  const manaAbilityMatch = oracleText.match(/\{t\}(?:[,\s]*[^:]*)?:\s*add\s+((?:\{[wubrgc]\})+)/gi);
  
  if (manaAbilityMatch && manaAbilityMatch.length > 0) {
    // Use ONLY the first mana ability found (the basic tap-for-mana ability)
    const firstManaAbility = manaAbilityMatch[0];
    const symbols = firstManaAbility.match(/\{[wubrgc]\}/gi) || [];
    if (symbols.length > 0) {
      result.baseAmount = symbols.length;
      // Get the color(s) from the first mana ability only
      for (const sym of symbols) {
        const color = sym.replace(/[{}]/g, '').toUpperCase();
        if (!result.colors.includes(color)) {
          result.colors.push(color);
        }
      }
    }
  } else {
    // Fallback: Check for simpler fixed mana patterns without tap requirement
    // (for special cases like artifacts that have different activation patterns)
    const fixedManaMatch = oracleText.match(/add\s+((?:\{[wubrgc]\})+)/gi);
    if (fixedManaMatch && result.colors.length === 0) {
      // Only use first match to avoid picking up reminder text
      const firstMatch = fixedManaMatch[0];
      const symbols = firstMatch.match(/\{[wubrgc]\}/gi) || [];
      if (symbols.length > 0) {
        result.baseAmount = symbols.length;
        for (const sym of symbols) {
          const color = sym.replace(/[{}]/g, '').toUpperCase();
          if (!result.colors.includes(color)) {
            result.colors.push(color);
          }
        }
      }
    }
  }
  
  // Check for "any color" patterns
  if (oracleText.includes('any color') || oracleText.includes('mana of any color')) {
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor && result.colors.includes(chosenColor)) {
      result.colors = [chosenColor];
    }
  }
  
  // Handle basic land types
  if (typeLine.includes('plains') && !result.colors.includes('W')) result.colors.push('W');
  if (typeLine.includes('island') && !result.colors.includes('U')) result.colors.push('U');
  if (typeLine.includes('swamp') && !result.colors.includes('B')) result.colors.push('B');
  if (typeLine.includes('mountain') && !result.colors.includes('R')) result.colors.push('R');
  if (typeLine.includes('forest') && !result.colors.includes('G')) result.colors.push('G');
  
  // ===== STEP 2: Check for dynamic mana production =====
  
  // Gaea's Cradle - "Add {G} for each creature you control"
  if (cardName.includes("gaea's cradle") || 
      (oracleText.includes('add {g}') && oracleText.includes('for each creature'))) {
    const creatureCount = battlefield.filter((p: any) => 
      p && p.controller === playerId && 
      (p.card?.type_line || '').toLowerCase().includes('creature')
    ).length;
    result.isDynamic = true;
    result.baseAmount = creatureCount;
    result.dynamicDescription = `{G} for each creature you control (${creatureCount})`;
    result.colors = ['G'];
  }
  
  // Serra's Sanctum - "Add {W} for each enchantment you control"
  if (cardName.includes("serra's sanctum") ||
      (oracleText.includes('add {w}') && oracleText.includes('for each enchantment'))) {
    const enchantmentCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('enchantment')
    ).length;
    result.isDynamic = true;
    result.baseAmount = enchantmentCount;
    result.dynamicDescription = `{W} for each enchantment you control (${enchantmentCount})`;
    result.colors = ['W'];
  }
  
  // Tolarian Academy - "Add {U} for each artifact you control"
  if (cardName.includes("tolarian academy") ||
      (oracleText.includes('add {u}') && oracleText.includes('for each artifact'))) {
    const artifactCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('artifact')
    ).length;
    result.isDynamic = true;
    result.baseAmount = artifactCount;
    result.dynamicDescription = `{U} for each artifact you control (${artifactCount})`;
    result.colors = ['U'];
  }
  
  // Three Tree City - Has two abilities:
  // 1. {T}: Add {C}
  // 2. {2}, {T}: Choose a color. Add an amount of mana of that color equal to creatures of the chosen type.
  // The chosen creature type is stored on the permanent
  if (cardName.includes("three tree city")) {
    // Get the chosen creature type from the permanent
    const chosenCreatureType = (permanent?.chosenCreatureType || '').toLowerCase();
    
    if (chosenCreatureType) {
      // Count creatures of the chosen type
      const creatureCount = battlefield.filter((p: any) => {
        if (!p || p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) return false;
        // Check if the creature has the chosen type
        return typeLine.includes(chosenCreatureType);
      }).length;
      
      result.isDynamic = true;
      result.baseAmount = creatureCount;
      result.dynamicDescription = `Choose a color. Add ${creatureCount} mana of that color (one for each ${chosenCreatureType} you control)`;
      // Mark as "any_combination" to trigger color choice prompt
      result.color = 'any_combination';
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      // Mark that this ability requires paying {2}
      result.activationCost = '{2}';
      result.requiresColorChoice = true;
    } else {
      // No creature type chosen yet, just produces {C}
      result.baseAmount = 1;
      result.colors = ['C'];
    }
  }
  
  // Karametra's Acolyte - "Add an amount of {G} equal to your devotion to green"
  // This is a key devotion-based mana ability that needs proper support
  if (cardName.includes("karametra's acolyte") || 
      (oracleText.includes('devotion to green') && oracleText.includes('add'))) {
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Count {G} symbols using pre-compiled pattern
        const pattern = DEVOTION_COLOR_PATTERNS['G'];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        // Also count hybrid mana that includes green
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes('G')) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{G} for devotion to green (${devotion})`;
    result.colors = ['G'];
  }
  
  // Elvish Archdruid - "Add {G} for each Elf you control"
  if (cardName.includes('elvish archdruid')) {
    const elfCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('elf')
    ).length;
    result.isDynamic = true;
    result.baseAmount = elfCount;
    result.dynamicDescription = `{G} for each Elf you control (${elfCount})`;
    result.colors = ['G'];
  }
  
  // Joraga Treespeaker - Leveler card (Rule 702.87)
  // Level 0: No mana ability
  // Level 1-4: {T}: Add {G}{G}
  // Level 5+: {T}: Add {G}{G} AND other Elves you control have this ability
  if (cardName.includes('joraga treespeaker')) {
    const levelCounters = permanent?.counters?.level || 0;
    if (levelCounters >= 1) {
      // At level 1+, produces {G}{G}
      result.baseAmount = 2;
      result.colors = ['G'];
      result.dynamicDescription = `{G}{G} (Level ${levelCounters})`;
    } else {
      // Level 0: no mana ability (card just taps for nothing or has no mana ability)
      result.baseAmount = 0;
      result.colors = [];
      result.dynamicDescription = `No mana (Level 0 - needs 1+ level counters)`;
    }
  }
  
  // Check if this elf is affected by a level 5+ Joraga Treespeaker
  // At level 5+, Joraga Treespeaker grants "{T}: Add {G}{G}" to all Elves you control
  if (typeLine.includes('elf') && !cardName.includes('joraga treespeaker')) {
    // Check if player controls a Joraga Treespeaker with 5+ level counters
    const joragaLevel5Plus = battlefield.find((p: any) =>
      p && p.controller === playerId &&
      (p.card?.name || '').toLowerCase().includes('joraga treespeaker') &&
      (p.counters?.level || 0) >= 5
    );
    
    if (joragaLevel5Plus) {
      // This Elf gains "{T}: Add {G}{G}" from the level 5+ Joraga Treespeaker
      // Override existing mana production if this gives more
      if (result.baseAmount < 2 || !result.colors.includes('G')) {
        result.baseAmount = 2;
        result.colors = ['G'];
        result.dynamicDescription = `{G}{G} from Joraga Treespeaker (level 5+)`;
      }
    }
  }
  
  // Generic leveler card support - check for level-dependent mana abilities
  // Pattern: "LEVEL N1-N2" ... "{T}: Add {X}" or "LEVEL N3+" ... "{T}: Add {X}"
  if (oracleText.includes('level up') || oracleText.includes('level ')) {
    const levelCounters = permanent?.counters?.level || 0;
    
    // Look for level ability patterns with mana production
    // Pattern: LEVEL N-M ... {T}: Add {mana} or LEVEL N+ ... {T}: Add {mana}
    // Note: Using matchAll for safe iteration of global matches
    const levelRangePattern = /level\s+(\d+)-(\d+)[^{]*\{t\}:\s*add\s+((?:\{[wubrgc]\})+)/gi;
    const levelPlusPattern = /level\s+(\d+)\+[^{]*\{t\}:\s*add\s+((?:\{[wubrgc]\})+)/gi;
    
    let foundLevelAbility = false;
    
    // Check range patterns first (LEVEL N-M)
    for (const match of oracleText.matchAll(levelRangePattern)) {
      const minLevel = parseInt(match[1], 10);
      const maxLevel = parseInt(match[2], 10);
      const manaSymbols = match[3].match(/\{[wubrgc]\}/gi) || [];
      
      if (levelCounters >= minLevel && levelCounters <= maxLevel) {
        result.baseAmount = manaSymbols.length;
        result.colors = manaSymbols.map((s: string) => s.replace(/[{}]/g, '').toUpperCase());
        result.dynamicDescription = `${manaSymbols.join('')} (Level ${levelCounters}, range ${minLevel}-${maxLevel})`;
        foundLevelAbility = true;
        break;
      }
    }
    
    // If no range matched, check plus patterns (LEVEL N+)
    if (!foundLevelAbility) {
      for (const match of oracleText.matchAll(levelPlusPattern)) {
        const minLevel = parseInt(match[1], 10);
        const manaSymbols = match[2].match(/\{[wubrgc]\}/gi) || [];
        
        if (levelCounters >= minLevel) {
          result.baseAmount = manaSymbols.length;
          result.colors = manaSymbols.map((s: string) => s.replace(/[{}]/g, '').toUpperCase());
          result.dynamicDescription = `${manaSymbols.join('')} (Level ${levelCounters}, ${minLevel}+)`;
          foundLevelAbility = true;
          break;
        }
      }
    }
  }
  
  // Wirewood Channeler, Priest of Titania style - "Add {G} for each Elf"
  if (oracleText.includes('for each elf') || 
      (cardName.includes('priest of titania')) ||
      (cardName.includes('wirewood channeler'))) {
    const elfCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('elf')
    ).length;
    result.isDynamic = true;
    result.baseAmount = elfCount;
    result.dynamicDescription = `Mana for each Elf you control (${elfCount})`;
    if (cardName.includes('wirewood channeler')) {
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.colors = ['G'];
    }
  }
  
  // Everflowing Chalice - "Add {C} for each charge counter on Everflowing Chalice"
  if (cardName.includes('everflowing chalice') ||
      (oracleText.includes('for each charge counter') && oracleText.includes('add'))) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `{C} for each charge counter (${chargeCounters})`;
    result.colors = ['C'];
  }
  
  // Astral Cornucopia - "Add one mana of any color for each charge counter"
  if (cardName.includes('astral cornucopia') ||
      (oracleText.includes('for each charge counter') && oracleText.includes('any color'))) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `Mana for each charge counter (${chargeCounters})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Gemstone Array - Based on charge counters (can remove to add mana)
  if (cardName.includes('gemstone array')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.baseAmount = 1; // Removes one counter for one mana
      result.dynamicDescription = `Remove charge counter for mana (${chargeCounters} available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    }
  }
  
  // Empowered Autogenerator - "Add X mana of any one color, where X is the number of charge counters"
  if (cardName.includes('empowered autogenerator')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters;
    result.dynamicDescription = `Mana equal to charge counters (${chargeCounters})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Nykthos, Shrine to Nyx - "Add X mana of any one color, where X is your devotion to that color"
  // Devotion = count of mana symbols of that color in mana costs of permanents you control
  if (cardName.includes('nykthos') || 
      (oracleText.includes('devotion') && oracleText.includes('add'))) {
    // Calculate devotion for the chosen color
    const devotionColor = chosenColor || 'W'; // Default to white if no color chosen
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Count occurrences of the color symbol using pre-compiled pattern
        const pattern = DEVOTION_COLOR_PATTERNS[devotionColor];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        // Also count hybrid mana that includes this color (e.g., {W/U} counts for both W and U)
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes(devotionColor)) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{${devotionColor}} for devotion (${devotion})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Cabal Coffers - "Add {B} for each Swamp you control"
  if (cardName.includes('cabal coffers') ||
      (oracleText.includes('add {b}') && oracleText.includes('for each swamp'))) {
    const swampCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    ).length;
    result.isDynamic = true;
    result.baseAmount = swampCount;
    result.dynamicDescription = `{B} for each Swamp you control (${swampCount})`;
    result.colors = ['B'];
  }
  
  // Cabal Stronghold - Similar to Cabal Coffers but only basic Swamps
  if (cardName.includes('cabal stronghold')) {
    const basicSwampCount = battlefield.filter((p: any) =>
      p && p.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('basic') &&
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    ).length;
    result.isDynamic = true;
    result.baseAmount = basicSwampCount;
    result.dynamicDescription = `{B} for each basic Swamp (${basicSwampCount})`;
    result.colors = ['B'];
  }
  
  // Nyx Lotus - "Add X mana of any one color, where X is your devotion to that color"
  if (cardName.includes('nyx lotus')) {
    const devotionColor = chosenColor || 'W';
    let devotion = 0;
    
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const manaCost = (perm.card?.mana_cost || '').toUpperCase();
        // Use pre-compiled pattern for devotion color matching
        const pattern = DEVOTION_COLOR_PATTERNS[devotionColor];
        if (pattern) {
          const matches = manaCost.match(pattern) || [];
          devotion += matches.length;
        }
        
        const hybridMatches = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi) || [];
        for (const hybrid of hybridMatches) {
          if (hybrid.toUpperCase().includes(devotionColor)) {
            devotion += 1;
          }
        }
      }
    }
    
    result.isDynamic = true;
    result.baseAmount = devotion;
    result.dynamicDescription = `{${devotionColor}} for devotion (${devotion})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // ===== POWER-BASED MANA ABILITIES =====
  
  // Selvala, Heart of the Wilds - "Add mana equal to the greatest power among creatures you control"
  if (cardName.includes('selvala, heart of the wilds') ||
      (oracleText.includes('greatest power') && oracleText.includes('among creatures'))) {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      // Use canonical power calculation
      const { power } = getActualPowerToughness(perm, gameState);
      if (power > greatestPower) greatestPower = power;
    }
    result.isDynamic = true;
    result.baseAmount = greatestPower;
    result.dynamicDescription = `Mana equal to greatest power (${greatestPower})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Generic pattern: "Add {G} equal to [this creature's / ~'s] power"
  // Catches: Marwyn, Viridian Joiner, Cradle Clearcutter, Gyre Sage, etc.
  if (oracleText.includes("equal to") && oracleText.includes("power") && 
      (oracleText.includes("{g}") || oracleText.includes("green")) &&
      !oracleText.includes("greatest") && !oracleText.includes("among")) {
    const { power } = getActualPowerToughness(permanent, gameState);
    result.isDynamic = true;
    result.baseAmount = Math.max(0, power);
    result.dynamicDescription = `{G} equal to this creature's power (${power})`;
    result.colors = ['G'];
  }
  
  // Bighorn Rancher and similar - "Add {G} equal to the greatest power among creatures you control"
  if ((oracleText.includes("greatest power") && oracleText.includes("among creatures")) ||
      cardName.includes('bighorn rancher') || cardName.includes('bighorner rancher')) {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      const { power } = getActualPowerToughness(perm, gameState);
      if (power > greatestPower) greatestPower = power;
    }
    debug(2, `[calculateManaProduction] ${cardName}: Greatest power among creatures is ${greatestPower}`);
    result.isDynamic = true;
    result.baseAmount = greatestPower;
    result.dynamicDescription = `{G} equal to greatest power (${greatestPower})`;
    result.colors = ['G'];
  }
  
  // White Lotus Tile - "Add X mana of any one color, where X is the greatest number of creatures you control that have a creature type in common."
  // This counts the maximum number of creatures sharing ANY creature type
  if (cardName.includes('white lotus tile') || 
      (oracleText.includes('creature type in common') && oracleText.includes('greatest number'))) {
    // Build a map of creature types to count
    const creatureTypeCounts: Record<string, number> = {};
    
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      // Extract creature types from type line (after the em-dash)
      // Format: "Creature — Human Soldier" or "Legendary Creature — Elf Druid"
      const typeLineParts = permTypeLine.split(/[—-]/);
      if (typeLineParts.length > 1) {
        const subtypes = typeLineParts[1].trim().split(/\s+/);
        for (const subtype of subtypes) {
          if (subtype && subtype.length > 0) {
            creatureTypeCounts[subtype] = (creatureTypeCounts[subtype] || 0) + 1;
          }
        }
      }
    }
    
    // Find the greatest count
    let greatestCount = 0;
    let bestType = '';
    for (const [creatureType, count] of Object.entries(creatureTypeCounts)) {
      if (count > greatestCount) {
        greatestCount = count;
        bestType = creatureType;
      }
    }
    
    debug(2, `[calculateManaProduction] ${cardName}: Greatest creature type in common: ${bestType} (${greatestCount})`);
    result.isDynamic = true;
    result.baseAmount = greatestCount;
    result.dynamicDescription = `Add ${greatestCount} mana of any color (${bestType}s: ${greatestCount})`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Tanuki Transplanter - "Add an amount of {G} equal to equipped creature's power"
  if (cardName.includes('tanuki transplanter')) {
    const attachedTo = (permanent as any).attachedTo;
    let power = 0;
    if (attachedTo) {
      const equippedCreature = battlefield.find((p: any) => p.id === attachedTo);
      if (equippedCreature) {
        const actualPT = getActualPowerToughness(equippedCreature, gameState);
        power = actualPT.power;
      }
    }
    result.isDynamic = true;
    result.baseAmount = Math.max(0, power);
    result.dynamicDescription = `{G} equal to equipped creature's power (${power})`;
    result.colors = ['G'];
  }
  
  // Vhal, Candlekeep Researcher - "Add an amount of {U} equal to Vhal's toughness"
  if (cardName.includes('vhal')) {
    let toughness = (permanent.baseToughness ?? parseInt(card.toughness, 10)) || 0;
    if (permanent.counters) {
      toughness += (permanent.counters['+1/+1'] || 0) + (permanent.counters['p1p1'] || 0);
      toughness -= (permanent.counters['-1/-1'] || 0) + (permanent.counters['m1m1'] || 0);
    }
    result.isDynamic = true;
    result.baseAmount = Math.max(0, toughness);
    result.dynamicDescription = `{U} equal to toughness (${toughness})`;
    result.colors = ['U'];
  }
  
  // ===== STORAGE COUNTER BASED MANA ABILITIES =====
  
  // Mage-Ring Network, Rushwood Grove, etc. - Storage lands
  // "Remove any number of storage counters from ~: Add {C} for each storage counter removed this way"
  if (oracleText.includes('storage counter') && oracleText.includes('remove')) {
    const storageCounters = permanent?.counters?.storage || permanent?.counters?.['storage'] || 0;
    result.isDynamic = true;
    result.baseAmount = storageCounters;
    result.dynamicDescription = `{C} for each storage counter removed (${storageCounters} available)`;
    result.colors = ['C'];
    // If the card produces colored mana, detect it
    if (oracleText.includes('add {g}') || cardName.includes('rushwood grove')) {
      result.colors = ['G'];
    } else if (oracleText.includes('add {w}') || cardName.includes('saprazzan cove')) {
      result.colors = ['W'];
    } else if (oracleText.includes('add {u}') || cardName.includes('fountain of cho')) {
      result.colors = ['U'];
    } else if (oracleText.includes('add {b}') || cardName.includes('subterranean hangar')) {
      result.colors = ['B'];
    } else if (oracleText.includes('add {r}') || cardName.includes('mercadian bazaar')) {
      result.colors = ['R'];
    }
  }
  
  // Kyren Toy - "Remove X charge counters: Add X mana plus one"
  if (cardName.includes('kyren toy')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.isDynamic = true;
    result.baseAmount = chargeCounters + 1; // X plus one
    result.dynamicDescription = `{C} = charge counters + 1 (${chargeCounters + 1})`;
    result.colors = ['C'];
  }
  
  // Gemstone Caverns - Has a luck counter when starting in hand
  if (cardName.includes('gemstone caverns')) {
    const hasLuckCounter = (permanent?.counters?.luck || 0) > 0;
    if (hasLuckCounter) {
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    } else {
      result.colors = ['C'];
    }
    result.baseAmount = 1;
  }
  
  // Crystalline Crawler - Uses +1/+1 counters for mana
  // "Remove a +1/+1 counter from Crystalline Crawler: Add one mana of any color"
  if (cardName.includes('crystalline crawler')) {
    const p1p1Counters = (permanent?.counters?.['+1/+1'] || 0) + (permanent?.counters?.p1p1 || 0);
    result.isDynamic = true;
    result.baseAmount = 1; // Removes one at a time
    result.dynamicDescription = `Any color mana (${p1p1Counters} +1/+1 counters available)`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Gemstone Array - Based on charge counters
  // "{2}, Remove a charge counter: Add one mana of any color"
  if (cardName.includes('gemstone array')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters available)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    }
  }
  
  // Coalition Relic - Uses charge counters for mana
  if (cardName.includes('coalition relic')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    // At the beginning of precombat main phase, remove all charge counters and add that much mana
    result.baseAmount = 1 + chargeCounters;
    if (chargeCounters > 0) {
      result.isDynamic = true;
      result.dynamicDescription = `Any color + charge counters (${chargeCounters})`;
    }
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Mana Bloom - Uses charge counters
  if (cardName.includes('mana bloom')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    if (chargeCounters > 0) {
      result.baseAmount = 1;
      result.dynamicDescription = `Any color (${chargeCounters} charge counters remain)`;
      result.colors = ['W', 'U', 'B', 'R', 'G'];
      if (chosenColor) result.colors = [chosenColor];
    }
  }
  
  // Pentad Prism - Sunburst with charge counters
  // "Remove a charge counter: Add one mana of any color"
  if (cardName.includes('pentad prism')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.baseAmount = 1;
    result.dynamicDescription = `Any color (${chargeCounters} charge counters available)`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }
  
  // Sphere of the Suns - Uses charge counters
  if (cardName.includes('sphere of the suns')) {
    const chargeCounters = permanent?.counters?.charge || 0;
    result.baseAmount = 1;
    result.dynamicDescription = `Any color (${chargeCounters} charge counters remain)`;
    result.colors = ['W', 'U', 'B', 'R', 'G'];
    if (chosenColor) result.colors = [chosenColor];
  }

  // ===== STEP 3: Check for aura enchantments on this permanent (Wild Growth, etc.) =====
  
  // Find auras attached to this permanent
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const permTypeLine = (perm.card?.type_line || '').toLowerCase();
    const permOracleText = (perm.card?.oracle_text || '').toLowerCase();
    const permName = (perm.card?.name || '').toLowerCase();
    
    // Check if this is an aura enchanting our permanent
    const isAura = permTypeLine.includes('enchantment') && permTypeLine.includes('aura');
    const isAttachedToUs = (perm as any).attachedTo === permanent.id || 
                           (perm as any).enchanting === permanent.id;
    
    if (isAura && isAttachedToUs) {
      // Wild Growth - "Whenever enchanted land is tapped for mana, add an additional {G}"
      if (permName.includes('wild growth') || 
          (permOracleText.includes('additional {g}') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'G', amount: 1 });
      }
      
      // Fertile Ground - "Whenever enchanted land is tapped for mana, add an additional mana of any color"
      if (permName.includes('fertile ground') ||
          (permOracleText.includes('additional') && permOracleText.includes('any color'))) {
        result.bonusMana.push({ color: chosenColor || 'C', amount: 1 });
      }
      
      // Overgrowth - "Whenever enchanted land is tapped for mana, add {G}{G}"
      if (permName.includes('overgrowth') ||
          (permOracleText.includes('add {g}{g}') && permOracleText.includes('tapped for mana'))) {
        result.bonusMana.push({ color: 'G', amount: 2 });
      }
      
      // Utopia Sprawl - "Whenever enchanted Forest is tapped for mana, add one mana of the chosen color"
      if (permName.includes('utopia sprawl')) {
        const chosenAuraColor = (perm as any).chosenColor || chosenColor || 'G';
        result.bonusMana.push({ color: chosenAuraColor, amount: 1 });
      }
      
      // Dawn's Reflection - "Whenever enchanted land is tapped for mana, add two mana of any one color"
      if (permName.includes("dawn's reflection")) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 2 });
      }
      
      // Market Festival - "Whenever enchanted land is tapped for mana, add two mana of any one color"
      if (permName.includes('market festival')) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 2 });
      }
      
      // Weirding Wood - "Whenever enchanted land is tapped for mana, add an additional mana of any color"
      if (permName.includes('weirding wood')) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 1 });
      }
      
      // Trace of Abundance - "Whenever enchanted land is tapped for mana, add one mana of any color"
      if (permName.includes('trace of abundance')) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 1 });
      }
      
      // Sheltered Aerie - "Whenever enchanted land is tapped for mana, add one mana of any color"
      if (permName.includes('sheltered aerie')) {
        result.bonusMana.push({ color: chosenColor || 'G', amount: 1 });
      }
    }
  }
  
  // ===== STEP 4: Check for global mana-boosting effects =====
  
  const isLand = typeLine.includes('land');
  const cardColors = (card.colors || []).map((c: string) => c.toUpperCase());
  
  for (const perm of battlefield) {
    if (!perm) continue;
    
    const permOracleText = (perm.card?.oracle_text || '').toLowerCase();
    const permName = (perm.card?.name || '').toLowerCase();
    const permController = perm.controller;
    
    // Only apply effects from our own permanents or global effects
    const isOurs = permController === playerId;
    
    // Caged Sun - "Whenever a land you control is tapped for mana of the chosen color, add one additional mana of that color"
    if (permName.includes('caged sun') && isOurs && isLand) {
      const chosenSunColor = (perm as any).chosenColor || 'C';
      if (result.colors.includes(chosenSunColor) || (chosenColor && chosenSunColor === chosenColor)) {
        result.bonusMana.push({ color: chosenSunColor, amount: 1 });
      }
    }
    
    // Gauntlet of Power - "Whenever a basic land is tapped for mana of the chosen color, add one additional mana of that color"
    if (permName.includes('gauntlet of power') && isOurs && typeLine.includes('basic')) {
      const chosenGauntletColor = (perm as any).chosenColor || 'C';
      if (result.colors.includes(chosenGauntletColor) || (chosenColor && chosenGauntletColor === chosenColor)) {
        result.bonusMana.push({ color: chosenGauntletColor, amount: 1 });
      }
    }
    
    // Mirari's Wake - "Whenever you tap a land for mana, add one mana of any type that land produced"
    if (permName.includes("mirari's wake") && isOurs && isLand) {
      // Adds one of the same type
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Zendikar Resurgent - "Whenever you tap a land for mana, add one mana of any type that land produced"
    if (permName.includes('zendikar resurgent') && isOurs && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Mana Reflection - "If you tap a permanent for mana, it produces double"
    if (permName.includes('mana reflection') && isOurs) {
      result.multiplier *= 2;
    }
    
    // Nyxbloom Ancient - "If you tap a permanent for mana, it produces three times as much"
    if (permName.includes('nyxbloom ancient') && isOurs) {
      result.multiplier *= 3;
    }
    
    // Mana Flare - "Whenever a player taps a land for mana, that land produces an additional mana"
    if (permName.includes('mana flare') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Dictate of Karametra - "Whenever a player taps a land for mana, that land produces an additional mana"
    if (permName.includes('dictate of karametra') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Heartbeat of Spring - Same as Mana Flare
    if (permName.includes('heartbeat of spring') && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
    
    // Vorinclex, Voice of Hunger - "Whenever you tap a land for mana, add one mana of any type that land could produce"
    if (permName.includes('vorinclex') && permName.includes('voice of hunger') && isOurs && isLand) {
      const producedColor = chosenColor || result.colors[0] || 'C';
      result.bonusMana.push({ color: producedColor, amount: 1 });
    }
  }
  
  // ===== STEP 5: Calculate total mana =====
  
  // Base amount * multiplier
  let total = result.baseAmount * result.multiplier;
  
  // Add bonus mana (bonuses are NOT multiplied in most cases, but for simplicity we add them after)
  for (const bonus of result.bonusMana) {
    total += bonus.amount;
  }
  
  result.totalAmount = Math.max(0, total);
  
  // If no colors determined, default to colorless
  if (result.colors.length === 0) {
    result.colors = ['C'];
  }
  
  return result;
}

/**
 * Calculate a creature's effective power including:
 * - Base power (from card data or basePower property)
 * - +1/+1 and -1/-1 counters
 * - Other P/T modifying counters (+1/+0, +2/+2, etc.)
 * - Equipment, auras, anthem effects, and other modifiers
 * 
 * @param permanent - The creature permanent to calculate power for
 * @returns The effective power value
 */
export function getEffectivePower(permanent: any): number {
  // Use pre-calculated effectivePower if available (from view.ts)
  if (typeof permanent.effectivePower === 'number') {
    return permanent.effectivePower;
  }
  
  const card = permanent.card;
  let basePower = permanent.basePower ?? (parseInt(String(card?.power ?? '0'), 10) || 0);
  
  // Handle star (*) power - variable power creatures like Tarmogoyf, Morophon
  if (typeof card?.power === 'string' && card.power.includes('*')) {
    // If basePower is set, use that as it should have been calculated already
    if (typeof permanent.basePower === 'number') {
      basePower = permanent.basePower;
    }
  }
  
  // Add +1/+1 counters
  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  // Subtract -1/-1 counters
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  const counterDelta = plusCounters - minusCounters;
  
  // Check for other counter types that affect power
  // Examples: +1/+0, +2/+2, +1/+2, etc.
  let otherCounterPower = 0;
  if (permanent.counters) {
    for (const [counterType, count] of Object.entries(permanent.counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      // Parse counter types like "+1/+0", "+2/+2", etc.
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        const pMod = parseInt(counterMatch[1], 10);
        otherCounterPower += pMod * (count as number);
      }
    }
  }
  
  // Add modifiers from equipment, auras, anthems, lords, etc.
  let modifierPower = 0;
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        modifierPower += mod.power || 0;
      }
    }
  }
  
  return Math.max(0, basePower + counterDelta + otherCounterPower + modifierPower);
}

/**
 * Calculate a creature's effective toughness including counters and modifiers
 * 
 * @param permanent - The creature permanent to calculate toughness for
 * @returns The effective toughness value
 */
export function getEffectiveToughness(permanent: any): number {
  // Use pre-calculated effectiveToughness if available (from view.ts)
  if (typeof permanent.effectiveToughness === 'number') {
    return permanent.effectiveToughness;
  }
  
  const card = permanent.card;
  let baseToughness = permanent.baseToughness ?? (parseInt(String(card?.toughness ?? '0'), 10) || 0);
  
  // Handle star (*) toughness
  if (typeof card?.toughness === 'string' && card.toughness.includes('*')) {
    if (typeof permanent.baseToughness === 'number') {
      baseToughness = permanent.baseToughness;
    }
  }
  
  // Add counters
  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  const counterDelta = plusCounters - minusCounters;
  
  // Check for other counter types
  let otherCounterToughness = 0;
  if (permanent.counters) {
    for (const [counterType, count] of Object.entries(permanent.counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        const tMod = parseInt(counterMatch[2], 10);
        otherCounterToughness += tMod * (count as number);
      }
    }
  }
  
  // Add modifiers
  let modifierToughness = 0;
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        modifierToughness += mod.toughness || 0;
      }
    }
  }
  
  return Math.max(0, baseToughness + counterDelta + otherCounterToughness + modifierToughness);
}

/**
 * Emit an event to a specific player's connected sockets.
 * Iterates through all connected sockets and emits to those with matching playerId.
 */
export function emitToPlayer(
  io: Server,
  playerId: string,
  event: string,
  payload: any
): void {
  try {
    for (const socket of io.sockets.sockets.values()) {
      try {
        if ((socket.data as any)?.playerId === playerId && !(socket.data as any)?.spectator) {
          socket.emit(event, payload);
        }
      } catch {
        // ignore per-socket errors
      }
    }
  } catch (err) {
    debugWarn(1, `[util] emitToPlayer failed for ${event}:`, err);
  }
}

// ============================================================================
// ENHANCED MANA POOL FUNCTIONS - Support for restricted mana
// ============================================================================

/**
 * Helper function to get the color from a restricted mana entry
 * Uses the 'type' field as the primary source
 */
export function getManaEntryColor(entry: RestrictedManaEntry): 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless' {
  return entry.type;
}

/**
 * Add restricted mana to a player's mana pool
 */
export function addRestrictedManaToPool(
  gameState: any,
  playerId: string,
  color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless',
  amount: number,
  restriction: ManaRestrictionType,
  restrictedTo?: string,
  sourceId?: string,
  sourceName?: string
): void {
  const pool = getOrInitManaPool(gameState, playerId);
  // NOTE: ManaPool interface marks properties as readonly for immutability guarantees.
  // However, server-side code needs to mutate the pool. We use `as any` here because:
  // 1. We own the game state and control all mutations
  // 2. The readonly is for client-side type safety, not server-side enforcement
  // 3. Alternative solutions (separate mutable type) would duplicate the interface
  const mutablePool = pool as any;
  const restricted = (mutablePool.restricted as RestrictedManaEntry[] | undefined) || [];
  mutablePool.restricted = restricted;
  
  // Check if there's already an entry with the same attributes (check both type and color for compatibility)
  const existingIndex = restricted.findIndex(
    entry => getManaEntryColor(entry) === color && 
             entry.restriction === restriction && 
             entry.sourceId === sourceId &&
             entry.restrictedTo === restrictedTo
  );
  
  if (existingIndex >= 0) {
    // Add to existing entry
    restricted[existingIndex].amount += amount;
  } else {
    // Create new entry
    restricted.push({
      type: color,
      amount,
      restriction,
      restrictedTo,
      sourceId,
      sourceName,
    });
  }
}

/**
 * Remove restricted mana from pool
 */
export function removeRestrictedManaFromPool(
  gameState: any,
  playerId: string,
  restrictedIndex: number,
  amount: number = 1
): boolean {
  const pool = getOrInitManaPool(gameState, playerId);
  const restricted = pool.restricted as RestrictedManaEntry[] | undefined;
  if (!restricted || restrictedIndex >= restricted.length) {
    return false;
  }
  
  const entry = restricted[restrictedIndex];
  if (entry.amount < amount) {
    return false;
  }
  
  if (entry.amount === amount) {
    // Remove the entry entirely
    restricted.splice(restrictedIndex, 1);
    if (restricted.length === 0) {
      delete (pool as any).restricted;
    }
  } else {
    entry.amount -= amount;
  }
  
  return true;
}

/**
 * Set the "doesn't empty" flag on a player's mana pool
 * Used by effects like Horizon Stone, Omnath, Kruphix, Ozai
 * 
 * @param convertsTo - Target color to convert mana to (e.g., 'colorless', 'black', 'red')
 * @param convertsToColorless - @deprecated Use convertsTo: 'colorless' instead
 */
export function setManaPoolDoesNotEmpty(
  gameState: any,
  playerId: string,
  sourceId: string,
  convertsTo?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless',
  convertsToColorless: boolean = false
): void {
  const pool = getOrInitManaPool(gameState, playerId);
  // Cast to allow modification of readonly properties
  const mutablePool = pool as any;
  mutablePool.doesNotEmpty = true;
  
  // Support both new convertsTo and deprecated convertsToColorless
  if (convertsTo) {
    mutablePool.convertsTo = convertsTo;
  } else if (convertsToColorless) {
    mutablePool.convertsTo = 'colorless';
    mutablePool.convertsToColorless = true;
  }
  
  mutablePool.noEmptySourceIds = mutablePool.noEmptySourceIds || [];
  
  if (!mutablePool.noEmptySourceIds.includes(sourceId)) {
    mutablePool.noEmptySourceIds.push(sourceId);
  }
}

/**
 * Remove the "doesn't empty" effect from a specific source
 * Called when the source permanent leaves the battlefield
 */
export function removeManaPoolDoesNotEmpty(
  gameState: any,
  playerId: string,
  sourceId: string
): void {
  const pool = getOrInitManaPool(gameState, playerId);
  const mutablePool = pool as any;
  
  if (!mutablePool.noEmptySourceIds) return;
  
  mutablePool.noEmptySourceIds = mutablePool.noEmptySourceIds.filter((id: string) => id !== sourceId);
  
  if (mutablePool.noEmptySourceIds.length === 0) {
    delete mutablePool.doesNotEmpty;
    delete mutablePool.convertsTo;
    delete mutablePool.convertsToColorless;
    delete mutablePool.noEmptySourceIds;
  }
}

/**
 * Calculate total mana in pool (including restricted)
 */
export function getTotalManaInPool(
  gameState: any,
  playerId: string
): number {
  const pool = getOrInitManaPool(gameState, playerId);
  const regularMana = (pool.white || 0) + (pool.blue || 0) + (pool.black || 0) +
                      (pool.red || 0) + (pool.green || 0) + (pool.colorless || 0);
  const restrictedMana = pool.restricted?.reduce((sum, entry) => sum + entry.amount, 0) || 0;
  return regularMana + restrictedMana;
}

/**
 * Calculate total mana of a specific color in pool (including restricted)
 * Useful for cards like Omnath, Locus of Mana which get +1/+1 for each green mana
 */
export function getTotalManaOfColorInPool(
  gameState: any,
  playerId: string,
  color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'
): number {
  const pool = getOrInitManaPool(gameState, playerId);
  const regularMana = pool[color] || 0;
  const restrictedMana = pool.restricted
    ?.filter(entry => getManaEntryColor(entry) === color)
    .reduce((sum, entry) => sum + entry.amount, 0) || 0;
  return regularMana + restrictedMana;
}

/**
 * Check if restricted mana can be used for a specific purpose
 */
export function canUseRestrictedMana(
  entry: RestrictedManaEntry,
  purpose: {
    isCreature?: boolean;
    isAbility?: boolean;
    isColorless?: boolean;
    isArtifact?: boolean;
    isLegendary?: boolean;
    isMulticolored?: boolean;
    isCommander?: boolean;
    isActivatedAbility?: boolean;
    isInstantOrSorcery?: boolean;
    cardId?: string;
  }
): boolean {
  switch (entry.restriction) {
    case 'creatures':
      return purpose.isCreature === true;
    case 'abilities':
      return purpose.isAbility === true;
    case 'colorless_spells':
      return purpose.isColorless === true;
    case 'artifacts':
      return purpose.isArtifact === true;
    case 'legendary':
      return purpose.isLegendary === true;
    case 'multicolored':
      return purpose.isMulticolored === true;
    case 'commander':
      return purpose.isCommander === true;
    case 'activated_abilities':
      return purpose.isActivatedAbility === true;
    case 'instant_sorcery':
      return purpose.isInstantOrSorcery === true;
    case 'specific_card':
      return entry.restrictedTo === purpose.cardId;
    default:
      return false;
  }
}

/**
 * Broadcast mana pool update to all clients
 * Also broadcasts full game state to update any P/T that depends on mana pool (e.g., Omnath)
 */
export function broadcastManaPoolUpdate(
  io: Server,
  gameId: string,
  playerId: string,
  manaPool: ManaPool,
  reason?: string,
  game?: any
): void {
  try {
    const totalMana = getTotalManaInPool({ manaPool: { [playerId]: manaPool } }, playerId);
    
    io.to(gameId).emit('manaPoolUpdate', {
      gameId,
      playerId,
      manaPool: {
        white: manaPool.white || 0,
        blue: manaPool.blue || 0,
        black: manaPool.black || 0,
        red: manaPool.red || 0,
        green: manaPool.green || 0,
        colorless: manaPool.colorless || 0,
        restricted: manaPool.restricted,
        doesNotEmpty: manaPool.doesNotEmpty,
        convertsToColorless: manaPool.convertsToColorless,
        noEmptySourceIds: manaPool.noEmptySourceIds,
      },
      totalMana,
      reason,
    });
    
    // Also broadcast full game state to update P/T of creatures that depend on mana pool
    // (e.g., Omnath, Locus of Mana gets +1/+1 for each green mana)
    if (game) {
      broadcastGame(io, game, gameId);
    }
  } catch (err) {
    debugWarn(1, `[util] broadcastManaPoolUpdate failed:`, err);
  }
}



