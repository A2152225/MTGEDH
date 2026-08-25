// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: ADDITIONAL_LAND_PLAY_CARDS / ADDITIONAL_DRAW_CARDS,
// calculateMaxLandsPerTurn, temporary land bonuses, detectSpellLandBonus,
// calculateAdditionalDraws.
// Public entry symbols: calculateMaxLandsPerTurn, applyTemporaryLandBonus,
// clearTemporaryLandBonuses, detectSpellLandBonus, calculateAdditionalDraws.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { isStationPermanentTypeLine } from "../../../../../rules-engine/src/stationPermanentUtils.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { getActiveStationAbilities, parseStationAbilities } from "../../../utils/stationParser.js";
import { getActivePermanents } from "./gameStateEffectsBattlefieldQueries.js";

/**
 * Cards that grant additional land plays per turn
 * Key: lowercase card name (partial match), Value: number of additional land drops
 */
const ADDITIONAL_LAND_PLAY_CARDS: Record<string, { lands: number; affectsAll?: boolean }> = {
  "exploration": { lands: 1 },
  "burgeoning": { lands: 0 }, // Special: play lands on opponents' turns, not extra per turn
  "azusa, lost but seeking": { lands: 2 },
  "oracle of mul daya": { lands: 1 },
  "dryad of the ilysian grove": { lands: 1 },
  "wayward swordtooth": { lands: 1 },
  "mina and denn, wildborn": { lands: 1 },
  "rites of flourishing": { lands: 1, affectsAll: true },
  "ghirapur orrery": { lands: 1, affectsAll: true },
  "horn of greed": { lands: 0 }, // Draws when playing lands, not extra land drops
  "walking atlas": { lands: 0 }, // Activated ability, not continuous
  "sakura-tribe scout": { lands: 0 }, // Activated ability
  "llanowar scout": { lands: 0 }, // Activated ability
  "skyshroud ranger": { lands: 0 }, // Activated ability
  "fastbond": { lands: 99 }, // Unlimited land drops (pay 1 life each)
  "courser of kruphix": { lands: 0 }, // Play from top of library, not extra
  "crucible of worlds": { lands: 0 }, // Play from graveyard, not extra
  "ramunap excavator": { lands: 0 }, // Play from graveyard, not extra
  // New additions for Loot and similar effects
  "loot, exuberant explorer": { lands: 1 },
  "loot": { lands: 1 }, // Partial match for alternate names
  "exuberant explorer": { lands: 1 }, // Partial match
  "ancient greenwarden": { lands: 0 }, // Play from graveyard, not extra
  "budoka gardener": { lands: 1 }, // When flipped, lets you play extra
  "cultivate": { lands: 0 }, // One-shot spell, not continuous
  "herald of the pantheon": { lands: 0 }, // Enchantment cost reduction, not lands
  "storm the festival": { lands: 0 }, // One-shot spell
  "the gitrog monster": { lands: 1 }, // You may play an additional land on each of your turns
  "patron of the moon": { lands: 0 }, // Activated ability to put lands onto battlefield
  "summer bloom": { lands: 3 }, // Play 3 additional lands this turn (sorcery, handled differently)
  "journey of discovery": { lands: 2 }, // Entwined: search + play 2 extra lands (sorcery)
  "future sight": { lands: 0 }, // Play from top, not extra land drops
  "garruk's horde": { lands: 0 }, // Play creatures from top, not lands
  "karametra, god of harvests": { lands: 0 }, // Search and put on battlefield, not extra land drop
  "tatyova, benthic druid": { lands: 0 }, // Landfall trigger, not extra land drops
  "moraug, fury of akoum": { lands: 0 }, // Landfall for extra combat, not extra land drops
  "radha, heart of keld": { lands: 0 }, // Look at/play from top, not extra land drops
  "yasharn, implacable earth": { lands: 0 }, // Search on ETB, not extra land drops
  "aesi, tyrant of gyre strait": { lands: 1 }, // You may play an additional land on each of your turns
  "kynaios and tiro of meletis": { lands: 0 }, // End step ability, not extra land drops during turn
  "case of the locked hothouse": { lands: 1 }, // You may play an additional land on each of your turns
};

/**
 * Parse oracle text to detect additional land play effects dynamically
 * This handles cards not in the known list
 * 
 * Key distinction:
 * - "You may play" - affects only the controller of the permanent
 * - "Each player may play" / "player may play" - affects ALL players (Ghirapur Orrery, Rites of Flourishing)
 * 
 * Detects patterns like:
 * - "You may play an additional land on each of your turns" (Exploration, Azusa)
 * - "You may play two additional lands on each of your turns" (Azusa)
 * - "Each player may play an additional land on each of their turns" (Ghirapur Orrery)
 * - "Each player may play an additional land during each of their turns" (Rites of Flourishing)
 */
function detectAdditionalLandPlayFromOracle(oracleText: string): { lands: number; affectsAll: boolean } {
  const lowerText = (oracleText || "").toLowerCase();
  
  // Check for "each player" or "player may play" patterns (Ghirapur Orrery, Rites of Flourishing)
  // These affect ALL players, not just the controller
  const affectsAll = lowerText.includes("each player may play") || 
                     lowerText.includes("each player can play") ||
                     lowerText.includes("player may play an additional land") ||
                     lowerText.includes("players may play an additional land");

  // "You may play any number of lands" / "Each player may play any number of lands"
  if (lowerText.includes('play any number of lands')) {
    debug(2, `[detectAdditionalLandPlayFromOracle] Found "play any number of lands" pattern (affectsAll: ${affectsAll})`);
    return { lands: Number.POSITIVE_INFINITY, affectsAll };
  }
  
  // Check for additional land patterns
  // "play an additional land" / "play one additional land"
  // This matches cards like "You may play an additional land on each of your turns" (Case of the Locked Hothouse)
  if (lowerText.includes("play an additional land") || 
      lowerText.includes("play one additional land")) {
    // Check if it's "two additional lands"
    if (lowerText.includes("two additional land")) {
      return { lands: 2, affectsAll };
    }
    // Check if it's "three additional lands"
    if (lowerText.includes("three additional land")) {
      return { lands: 3, affectsAll };
    }
    debug(2, `[detectAdditionalLandPlayFromOracle] Found "play an additional land" pattern, granting +1 land (affectsAll: ${affectsAll})`);
    return { lands: 1, affectsAll };
  }
  
  // "You may play X additional lands each turn"
  const multiLandMatch = lowerText.match(/play\s+(\w+)\s+additional\s+land/i);
  if (multiLandMatch) {
    const countWord = multiLandMatch[1].toLowerCase();
    const wordToNum: Record<string, number> = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'an': 1, 'a': 1
    };
    const lands = wordToNum[countWord] || 1;
    debug(2, `[detectAdditionalLandPlayFromOracle] Found multi-land pattern: "${countWord}" -> ${lands} lands (affectsAll: ${affectsAll})`);
    return { lands, affectsAll };
  }
  
  return { lands: 0, affectsAll: false };
}

/**
 * Cards that grant additional draws per draw step
 * Key: lowercase card name (partial match), Value: number of additional cards to draw
 * Note: requiresUntapped means the permanent must be untapped to provide the effect (e.g., Howling Mine)
 */
const ADDITIONAL_DRAW_CARDS: Record<string, { draws: number; affectsAll?: boolean; affectsOpponents?: boolean; requiresUntapped?: boolean }> = {
  "rites of flourishing": { draws: 1, affectsAll: true },
  "font of mythos": { draws: 2, affectsAll: true },
  "howling mine": { draws: 1, affectsAll: true, requiresUntapped: true }, // Only works when untapped
  "temple bell": { draws: 0 }, // Activated ability, not automatic
  "dictate of kruphix": { draws: 1, affectsAll: true },
  "kami of the crescent moon": { draws: 1, affectsAll: true },
  "seizan, perverter of truth": { draws: 2, affectsOpponents: true }, // Opponents draw 2, lose 2 life
  "nekusar, the mindrazer": { draws: 0 }, // Deals damage on draw, doesn't grant extra
  "consecrated sphinx": { draws: 0 }, // Triggered ability on opponent draw
  "sylvan library": { draws: 2 }, // Controller draws 2 extra, may put back or pay life
  "rhystic study": { draws: 0 }, // Triggered ability when opponent casts
  "mystic remora": { draws: 0 }, // Triggered ability when opponent casts
  "braids, conjurer adept": { draws: 0 }, // ETB from hand effect
  "wedding ring": { draws: 0 }, // Triggered on opponent draw
  "anvil of bogardan": { draws: 1, affectsAll: true }, // +1 draw, discard a card
  "well of ideas": { draws: 2 }, // Controller draws 2 extra on draw step
  "master of the feast": { draws: 1, affectsOpponents: true }, // Each opponent draws 1
  "horn of greed": { draws: 0 }, // Triggered on land play, not draw step
  "jace beleren": { draws: 0 }, // Planeswalker ability, not automatic
};

/**
 * Calculate the maximum number of lands a player can play this turn
 * based on battlefield permanents AND temporary spell effects
 * 
 * This handles:
 * - Cards that affect only their controller ("You may play")
 * - Cards that affect all players ("Each player may play") like Ghirapur Orrery
 */
export function calculateMaxLandsPerTurn(ctx: GameContext, playerId: string): number {
  let maxLands = 1; // Base: 1 land per turn
  
  const battlefield = getActivePermanents(ctx);
  const checkedPermanentIds = new Set<string>(); // Avoid double-counting
  
  debug(3, `[calculateMaxLandsPerTurn] Calculating for player ${playerId}, battlefield has ${battlefield.length} permanents`);
  
  for (const perm of battlefield) {
    if (checkedPermanentIds.has(perm.id)) continue;
    
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = (perm.card?.oracle_text || "");
    const typeLine = String(perm.card?.type_line || '');
    const isStationPermanent = isStationPermanentTypeLine(typeLine);
    const isController = perm.controller === playerId;
    let foundInKnownList = false;
    
    // First check known cards list (skip partial-name matches for Station permanents — e.g. Exploration Broodship)
    if (!isStationPermanent) {
      for (const [knownName, effect] of Object.entries(ADDITIONAL_LAND_PLAY_CARDS)) {
      if (cardName.includes(knownName) && effect.lands > 0) {
        // Check if this effect applies to this player
        // Effect applies if: player controls it OR effect affects all players
        if (isController || effect.affectsAll) {
          maxLands += effect.lands;
          checkedPermanentIds.add(perm.id);
          foundInKnownList = true;
          debug(3, `[calculateMaxLandsPerTurn] ${perm.card?.name} grants +${effect.lands} lands to ${playerId} (controller: ${perm.controller}, affectsAll: ${effect.affectsAll})`);
          break; // Only count once per permanent
        }
      }
    }
    }
    
    // If not in known list, try dynamic oracle text parsing
    // This handles both controller-only and all-player effects dynamically
    if (!foundInKnownList) {
      const oracleForLandDetection = isStationPermanent
        ? getActiveStationAbilities(
            Number((perm as any).counters?.charge ?? (perm as any).counters?.['charge'] ?? 0),
            parseStationAbilities(oracleText),
          ).join('\n')
        : oracleText;
      const dynamicResult = detectAdditionalLandPlayFromOracle(oracleForLandDetection);
      if (dynamicResult.lands > 0) {
        // Apply if: player controls it OR effect affects all players
        if (isController || dynamicResult.affectsAll) {
          maxLands += dynamicResult.lands;
          checkedPermanentIds.add(perm.id);
          debug(3, `[calculateMaxLandsPerTurn] Detected +${dynamicResult.lands} lands from ${perm.card?.name} via oracle text (controller: ${perm.controller}, affectsAll: ${dynamicResult.affectsAll})`);
        }
      }
    }
  }

  const activePlane = (ctx.state as any)?.activePlane || (ctx.state as any)?.currentPlane;
  if (activePlane) {
    const planeText = String(activePlane.text || activePlane.oracle_text || activePlane.effect || '');
    const planeName = String(activePlane.name || 'Active plane');
    const planeController = String(activePlane.controller || '').trim();
    const dynamicResult = detectAdditionalLandPlayFromOracle(planeText);
    const planeAppliesToPlayer = dynamicResult.affectsAll || !planeController || planeController === playerId;

    if (dynamicResult.lands > 0 && planeAppliesToPlayer) {
      maxLands = Number.isFinite(dynamicResult.lands)
        ? maxLands + dynamicResult.lands
        : Number.POSITIVE_INFINITY;
      debug(3, `[calculateMaxLandsPerTurn] ${planeName} grants ${Number.isFinite(dynamicResult.lands) ? `+${dynamicResult.lands}` : 'unlimited'} lands to ${playerId}`);
    }
  }
  
  // Add temporary bonus from spells like Summer Bloom
  // These are stored in game state as additionalLandsThisTurn[playerId]
  const temporaryBonus = (ctx.state as any)?.additionalLandsThisTurn?.[playerId] || 0;
  if (temporaryBonus > 0) {
    maxLands += temporaryBonus;
    debug(3, `[calculateMaxLandsPerTurn] Added +${temporaryBonus} temporary lands for ${playerId} (spell effect)`);
  }
  
  debug(3, `[calculateMaxLandsPerTurn] Final result for ${playerId}: ${maxLands} lands per turn`);
  return maxLands;
}

/**
 * Known spells that grant temporary additional land plays for the turn
 */
const TEMPORARY_LAND_PLAY_SPELLS: Record<string, { lands: number }> = {
  "summer bloom": { lands: 3 },
  "journey of discovery": { lands: 2 }, // When entwined
  "explore": { lands: 1 }, // Draw a card, play an additional land
  "growth spiral": { lands: 1 }, // Actually puts land from hand, but similar
  "urban evolution": { lands: 1 },
  "wayward swordtooth": { lands: 1 }, // Actually a permanent, but included for reference
};

/**
 * Apply temporary additional land plays from a spell effect
 * Called when spells like Summer Bloom resolve
 */
export function applyTemporaryLandBonus(ctx: GameContext, playerId: string, additionalLands: number): void {
  (ctx.state as any).additionalLandsThisTurn = (ctx.state as any).additionalLandsThisTurn || {};
  const current = (ctx.state as any).additionalLandsThisTurn[playerId] || 0;
  (ctx.state as any).additionalLandsThisTurn[playerId] = current + additionalLands;
  
  debug(2, `[applyTemporaryLandBonus] ${playerId} can now play ${additionalLands} additional lands this turn (total bonus: ${current + additionalLands})`);
  
  // Also update maxLandsPerTurn immediately for the game state
  const newMax = calculateMaxLandsPerTurn(ctx, playerId);
  (ctx as any).maxLandsPerTurn = (ctx as any).maxLandsPerTurn || {};
  (ctx as any).maxLandsPerTurn[playerId] = newMax;
  
  if (ctx.state) {
    (ctx.state as any).maxLandsPerTurn = (ctx.state as any).maxLandsPerTurn || {};
    (ctx.state as any).maxLandsPerTurn[playerId] = newMax;
  }
}

/**
 * Clear temporary land bonuses at end of turn
 * Called during cleanup step
 */
export function clearTemporaryLandBonuses(ctx: GameContext): void {
  if ((ctx.state as any)?.additionalLandsThisTurn) {
    (ctx.state as any).additionalLandsThisTurn = {};
    debug(2, `[clearTemporaryLandBonuses] Cleared all temporary land bonuses`);
  }
}

/**
 * Check if a spell grants temporary additional land plays
 * Returns the number of additional lands, or 0 if not applicable
 */
export function detectSpellLandBonus(cardName: string, oracleText: string): number {
  const lowerName = (cardName || "").toLowerCase();
  const lowerText = (oracleText || "").toLowerCase();
  
  // Check known spells
  for (const [knownName, effect] of Object.entries(TEMPORARY_LAND_PLAY_SPELLS)) {
    if (lowerName.includes(knownName)) {
      debug(2, `[detectSpellLandBonus] Found known spell "${cardName}" matching "${knownName}": ${effect.lands} land(s)`);
      return effect.lands;
    }
  }
  
  // Dynamic detection patterns for various additional land play effects
  // Word to number mapping for parsing text numbers
  const wordToNum: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'an': 1, 'a': 1
  };
  
  // Pattern 1: "You may play up to X additional lands this turn"
  // Examples: Summer Bloom (up to three), Journey of Discovery (up to two)
  const upToThisTurnMatch = lowerText.match(/play\s+up\s+to\s+(\w+)\s+additional\s+lands?\s+this\s+turn/i);
  if (upToThisTurnMatch) {
    const countWord = upToThisTurnMatch[1].toLowerCase();
    const lands = wordToNum[countWord] || parseInt(countWord, 10) || 1;
    debug(2, `[detectSpellLandBonus] Dynamically detected "${cardName}" with oracle text matching "play up to ${countWord} additional lands this turn": ${lands} land(s)`);
    return lands;
  }
  
  // Pattern 2: "You may play X additional land(s) this turn"
  // Examples: Urban Evolution (an additional land), Explore (an additional land)
  const thisTurnMatch = lowerText.match(/play\s+(\w+)\s+additional\s+lands?\s+this\s+turn/i);
  if (thisTurnMatch) {
    const countWord = thisTurnMatch[1].toLowerCase();
    const lands = wordToNum[countWord] || 1;
    debug(2, `[detectSpellLandBonus] Dynamically detected "${cardName}" with oracle text matching "play ${countWord} additional land(s) this turn": ${lands} land(s)`);
    return lands;
  }
  
  // Pattern 3: "You may play up to X additional lands" (without "this turn")
  // Fallback for variations
  const upToMatch = lowerText.match(/play\s+up\s+to\s+(\w+)\s+additional\s+lands?/i);
  if (upToMatch) {
    const countWord = upToMatch[1].toLowerCase();
    const lands = wordToNum[countWord] || parseInt(countWord, 10) || 1;
    debug(2, `[detectSpellLandBonus] Dynamically detected "${cardName}" with oracle text matching "play up to ${countWord} additional land(s)": ${lands} land(s)`);
    return lands;
  }
  
  // If we didn't find a match but the oracle text mentions "additional land", log it for debugging
  if (lowerText.includes('additional land')) {
    debugWarn(1, `[detectSpellLandBonus] Card "${cardName}" has "additional land" in oracle text but didn't match patterns. Oracle text: "${lowerText.substring(0, 200)}"`);
  }
  
  return 0;
}

/**
 * Calculate the number of additional cards to draw during draw step
 * based on battlefield permanents
 */
function parseAdditionalDrawFromOracle(oracleText: string): {
  draws: number;
  affectsAll: boolean;
  requiresUntapped: boolean;
} | null {
  const text = String(oracleText || '');
  if (!/at the beginning of (?:your|each player's) draw step/i.test(text)) return null;

  const additionalMatch = text.match(
    /at the beginning of (your|each player's) draw step,\s*(?:if\s+.+?\s+is\s+untapped,\s*)?(?:that player\s+)?draws?\s+(?:(an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?additional\s+cards?/i,
  );
  if (!additionalMatch) return null;

  const amountRaw = String(additionalMatch[2] || 'an').trim().toLowerCase();
  const wordToNum: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const draws = /^\d+$/.test(amountRaw)
    ? Number.parseInt(amountRaw, 10)
    : (wordToNum[amountRaw] ?? 1);
  if (!Number.isFinite(draws) || draws <= 0) return null;

  return {
    draws,
    affectsAll: /^each player's$/i.test(String(additionalMatch[1] || '')),
    requiresUntapped: /if\s+.+?\s+is\s+untapped/i.test(text),
  };
}

export function calculateAdditionalDraws(ctx: GameContext, playerId: string): number {
  let additionalDraws = 0;
  
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    let foundInKnownList = false;
    
    for (const [knownName, effect] of Object.entries(ADDITIONAL_DRAW_CARDS)) {
      if (cardName.includes(knownName) && effect.draws > 0) {
        // Check if this card requires being untapped (e.g., Howling Mine)
        // "At the beginning of each player's draw step, if Howling Mine is untapped, that player draws an additional card."
        if (effect.requiresUntapped && perm.tapped) {
          foundInKnownList = true;
          break;
        }
        
        const isController = perm.controller === playerId;
        const isOpponent = !isController;
        
        // Check if this effect applies to this player
        if (isController && !effect.affectsOpponents) {
          additionalDraws += effect.draws;
        } else if (effect.affectsAll) {
          additionalDraws += effect.draws;
        } else if (effect.affectsOpponents && isOpponent) {
          additionalDraws += effect.draws;
        }
        foundInKnownList = true;
        break;
      }
    }

    if (foundInKnownList) continue;

    const parsed = parseAdditionalDrawFromOracle(String(perm.card?.oracle_text || ''));
    if (!parsed) continue;
    if (parsed.requiresUntapped && perm.tapped) continue;

    const isController = perm.controller === playerId;
    if (parsed.affectsAll || isController) {
      additionalDraws += parsed.draws;
    }
  }
  
  return additionalDraws;
}
