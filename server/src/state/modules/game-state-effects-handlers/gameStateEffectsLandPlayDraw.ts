// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: additional land-play / draw detect, calculateMaxLandsPerTurn,
// temporary land bonuses (oracle-only; TEMPORARY_LAND_PLAY_SPELLS deleted), calculateAdditionalDraws.
// Public entry symbols: calculateMaxLandsPerTurn, applyTemporaryLandBonus,
// clearTemporaryLandBonuses, detectSpellLandBonus, calculateAdditionalDraws.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import { landPlayProhibitionSource } from "../playerActionProhibitions.js"; // B34
import type { GameContext } from "../../context.js";
import { isStationPermanentTypeLine } from "../../../../../rules-engine/src/stationPermanentUtils.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { getActiveStationAbilities, parseStationAbilities } from "../../../utils/stationParser.js";
import { getActivePermanents } from "./gameStateEffectsBattlefieldQueries.js";

/**
 * Parse oracle text to detect additional land play effects.
 *
 * Key distinction:
 * - "You may play" - affects only the controller of the permanent
 * - "Each player may play" / "player may play" - affects ALL players (Ghirapur Orrery, Rites of Flourishing)
 *
 * Detects patterns like:
 * - "You may play an additional land on each of your turns" (Exploration)
 * - "You may play two additional lands on each of your turns" (Azusa)
 * - "You may play any number of lands on each of your turns" (Fastbond)
 * - "Each player may play an additional land on each of their turns" (Ghirapur Orrery)
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

    const oracleText = (perm.card?.oracle_text || "");
    const typeLine = String(perm.card?.type_line || '');
    const isStationPermanent = isStationPermanentTypeLine(typeLine);
    const isController = perm.controller === playerId;

    const oracleForLandDetection = isStationPermanent
      ? getActiveStationAbilities(
          Number((perm as any).counters?.charge ?? (perm as any).counters?.['charge'] ?? 0),
          parseStationAbilities(oracleText),
        ).join('\n')
      : oracleText;
    const dynamicResult = detectAdditionalLandPlayFromOracle(oracleForLandDetection);
    if (dynamicResult.lands > 0 && (isController || dynamicResult.affectsAll)) {
      maxLands = Number.isFinite(dynamicResult.lands)
        ? maxLands + dynamicResult.lands
        : Number.POSITIVE_INFINITY;
      checkedPermanentIds.add(perm.id);
      debug(3, `[calculateMaxLandsPerTurn] Detected ${Number.isFinite(dynamicResult.lands) ? `+${dynamicResult.lands}` : 'unlimited'} lands from ${perm.card?.name} via oracle text (controller: ${perm.controller}, affectsAll: ${dynamicResult.affectsAll})`);
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
  
  const b34LandBan = landPlayProhibitionSource(battlefield as any[], playerId); // B34
  if (b34LandBan) return 0;
  debug(3, `[calculateMaxLandsPerTurn] Final result for ${playerId}: ${maxLands} lands per turn`);
  return maxLands;
}

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
  const lowerText = (oracleText || "").toLowerCase();

  const wordToNum: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'an': 1, 'a': 1
  };

  // Pattern 1: "You may play up to X additional lands this turn"
  const upToThisTurnMatch = lowerText.match(/play\s+up\s+to\s+(\w+)\s+additional\s+lands?\s+this\s+turn/i);
  if (upToThisTurnMatch) {
    const countWord = upToThisTurnMatch[1].toLowerCase();
    const lands = wordToNum[countWord] || parseInt(countWord, 10) || 1;
    debug(2, `[detectSpellLandBonus] Dynamically detected "${cardName}" with oracle text matching "play up to ${countWord} additional lands this turn": ${lands} land(s)`);
    return lands;
  }

  // Pattern 2: "You may play X additional land(s) this turn"
  const thisTurnMatch = lowerText.match(/play\s+(\w+)\s+additional\s+lands?\s+this\s+turn/i);
  if (thisTurnMatch) {
    const countWord = thisTurnMatch[1].toLowerCase();
    const lands = wordToNum[countWord] || 1;
    debug(2, `[detectSpellLandBonus] Dynamically detected "${cardName}" with oracle text matching "play ${countWord} additional land(s) this turn": ${lands} land(s)`);
    return lands;
  }

  // Pattern 3: "You may play up to X additional lands" (without "this turn")
  const upToMatch = lowerText.match(/play\s+up\s+to\s+(\w+)\s+additional\s+lands?/i);
  if (upToMatch) {
    const countWord = upToMatch[1].toLowerCase();
    const lands = wordToNum[countWord] || parseInt(countWord, 10) || 1;
    debug(2, `[detectSpellLandBonus] Dynamically detected "${cardName}" with oracle text matching "play up to ${countWord} additional land(s)": ${lands} land(s)`);
    return lands;
  }

  if (lowerText.includes('additional land')) {
    debugWarn(1, `[detectSpellLandBonus] Card "${cardName}" has "additional land" in oracle text but didn't match patterns. Oracle text: "${lowerText.substring(0, 200)}"`);
  }

  return 0;
}

/**
 * Mandatory draw-step extra-card clauses from oracle (Howling Mine / Font of Mythos).
 * Optional "you may" extra draws and compound "then …" clauses stay on the stack.
 */
function parseAdditionalDrawClausesFromOracle(oracleText: string): Array<{
  draws: number;
  affectsAll: boolean;
  affectsOpponents: boolean;
  requiresUntapped: boolean;
}> {
  const text = String(oracleText || '');
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
  const clauseRe =
    /at the beginning of (your|each player's|each other player's|each opponent's|each of your) draw steps?,?\s*(if\s+.+?\s+is\s+untapped,\s*)?(you may\s+)?(?:that player\s+)?draws?\s+(?:(an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?additional\s+cards?([^.]*)/gi;
  const clauses: Array<{
    draws: number;
    affectsAll: boolean;
    affectsOpponents: boolean;
    requiresUntapped: boolean;
  }> = [];

  for (const match of text.matchAll(clauseRe)) {
    // Optional extra draws (Sylvan Library) stay a stack choice.
    if (String(match[3] || '').trim()) continue;
    // Compound "then …" clauses (Anvil of Bogardan) stay on the stack as one trigger.
    if (/\bthen\b/i.test(String(match[5] || ''))) continue;

    const amountRaw = String(match[4] || 'an').trim().toLowerCase();
    const draws = /^\d+$/.test(amountRaw)
      ? Number.parseInt(amountRaw, 10)
      : (wordToNum[amountRaw] ?? 1);
    if (!Number.isFinite(draws) || draws <= 0) continue;

    const whose = String(match[1] || '').toLowerCase();
    clauses.push({
      draws,
      affectsAll: whose === "each player's",
      affectsOpponents: whose === "each other player's" || whose === "each opponent's",
      requiresUntapped: Boolean(match[2]),
    });
  }

  return clauses;
}

export function calculateAdditionalDraws(ctx: GameContext, playerId: string): number {
  let additionalDraws = 0;

  const battlefield = getActivePermanents(ctx);

  for (const perm of battlefield) {
    const clauses = parseAdditionalDrawClausesFromOracle(String(perm.card?.oracle_text || ''));
    const isController = perm.controller === playerId;
    for (const parsed of clauses) {
      if (parsed.requiresUntapped && perm.tapped) continue;
      if (parsed.affectsAll) {
        additionalDraws += parsed.draws;
      } else if (parsed.affectsOpponents && !isController) {
        additionalDraws += parsed.draws;
      } else if (!parsed.affectsAll && !parsed.affectsOpponents && isController) {
        additionalDraws += parsed.draws;
      }
    }
  }

  return additionalDraws;
}
