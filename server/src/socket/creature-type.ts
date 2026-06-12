import type { Server } from "socket.io";
import { broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";
import { extractCreatureTypes, CREATURE_TYPES } from "../../../shared/src/creatureTypes";
import { debug, debugWarn } from "../utils/debug.js";

/**
 * Creature type selection handlers
 * 
 * Used for cards that require choosing a creature type as they enter the battlefield:
 * - Morophon, the Boundless
 * - Kindred Discovery
 * - Coat of Arms (for effects)
 * - Cavern of Souls
 * etc.
 */

/** Default creature type fallback for AI when no dominant type is found */
const DEFAULT_AI_CREATURE_TYPE = 'Shapeshifter';

/**
 * Determine the most common creature type in a player's deck/library.
 * Used for AI to make intelligent creature type choices.
 * 
 * Analyzes the player's library, hand, battlefield, and graveyard to find
 * the creature type that appears most frequently.
 */
export function getDominantCreatureType(game: any, playerId: string): string {
  const creatureTypeCounts: Record<string, number> = {};
  
  // Helper to count creature types from a card
  const countTypesFromCard = (card: any) => {
    if (!card?.type_line) return;
    const typeLine = card.type_line.toLowerCase();
    // Only count creature cards (not all cards)
    if (!typeLine.includes('creature')) return;
    
    const types = extractCreatureTypes(card.type_line, card.oracle_text);
    
    // Skip if it's a changeling (has ALL types, not useful for counting)
    // Changelings return all creature types from extractCreatureTypes
    const oracleText = (card.oracle_text || '').toLowerCase();
    const isChangeling = oracleText.includes('changeling') || 
                         typeLine.includes('changeling') ||
                         types.length >= CREATURE_TYPES.length;
    if (isChangeling) return;
    
    for (const type of types) {
      creatureTypeCounts[type] = (creatureTypeCounts[type] || 0) + 1;
    }
  };
  
  // Count from library
  const zones = game.state?.zones?.[playerId];
  if (zones?.library && Array.isArray(zones.library)) {
    for (const card of zones.library) {
      countTypesFromCard(card);
    }
  }
  
  // Count from hand
  if (zones?.hand && Array.isArray(zones.hand)) {
    for (const card of zones.hand) {
      countTypesFromCard(card);
    }
  }
  
  // Count from battlefield (weighted more since these are cards in play)
  const battlefield = game.state?.battlefield || [];
  for (const permanent of battlefield) {
    if (permanent.controller !== playerId) continue;
    countTypesFromCard(permanent.card);
  }
  
  // Count from graveyard
  if (zones?.graveyard && Array.isArray(zones.graveyard)) {
    for (const card of zones.graveyard) {
      countTypesFromCard(card);
    }
  }
  
  // Find the most common type
  let dominantType = DEFAULT_AI_CREATURE_TYPE;
  let maxCount = 0;
  
  for (const [type, count] of Object.entries(creatureTypeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantType = type;
    }
  }
  
  debug(2, `[creatureType] AI dominant creature type analysis for ${playerId}:`, {
    topTypes: Object.entries(creatureTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => `${type}(${count})`),
    chosen: dominantType,
  });
  
  return dominantType;
}

/**
 * Check if a player is an AI player
 */
export function isAIPlayer(game: any, playerId: string): boolean {
  const players = game.state?.players || [];
  const player = players.find((p: any) => p?.id === playerId);
  return player?.isAI === true;
}

/**
 * Handle AI creature type selection automatically
 */
export function applyCreatureTypeSelection(
  io: Server | null,
  game: any,
  gameId: string,
  playerId: string,
  permanentId: string,
  cardName: string,
  chosenTypeValue: string,
  isAI: boolean,
  promptMetadata: { resolvedStepId?: string; resolvedStepType?: string } = {},
): void {
  const chosenType = chosenTypeValue;
  
  debug(2, `[creatureType] Applying creature type ${chosenType} for ${cardName} (player ${playerId})`);
  
  // Apply the selection to the permanent
  const battlefield = game.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent) {
    permanent.chosenCreatureType = chosenType;
    if (permanent.card && typeof permanent.card === 'object') {
      permanent.card.chosenCreatureType = chosenType;
    }

    // For Morophon, also apply cost reduction tracking
    const permCardName = (permanent.card?.name || "").toLowerCase();
    if (permCardName.includes("morophon")) {
      const morophonChosenType = (game.state.morophonChosenType || {}) as Record<string, string>;
      morophonChosenType[permanentId] = chosenType;
      game.state.morophonChosenType = morophonChosenType;
    }
  }
  
  // Persist the event
  try {
    appendEvent(gameId, (game as any).seq ?? 0, "creatureTypeSelected", {
      playerId,
      resolvedStepId: String(promptMetadata.resolvedStepId || ''),
      resolvedStepType: String(promptMetadata.resolvedStepType || ''),
      permanentId,
      creatureType: chosenType,
      cardName,
      isAI,
    });
  } catch (e) {
    debugWarn(1, "appendEvent(creatureTypeSelected) failed:", e);
  }
  
  // Bump sequence
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
  
  if (io) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)}${isAI ? " (AI)" : ""} chose ${chosenType} for ${cardName}.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  }
}

import {
  isCastCreatureTypeChoiceOracle,
  isEtbCreatureTypeChoiceOracle,
  parseEtbOfferedCreatureTypes,
} from '../state/modules/chosen-creature-type.js';

/**
 * Check if a card requires creature type selection on ETB
 */
export function requiresCreatureTypeSelection(card: any): { required: boolean; reason: string } {
  if (!card) return { required: false, reason: "" };
  
  const name = (card.name || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Morophon, the Boundless - "As Morophon enters the battlefield, choose a creature type"
  if (name.includes("morophon")) {
    return { required: true, reason: "Choose a creature type for Morophon's cost reduction" };
  }
  
  // Kindred Discovery - "As Kindred Discovery enters the battlefield, choose a creature type"
  if (name.includes("kindred discovery")) {
    return { required: true, reason: "Choose a creature type to draw cards when entering or attacking" };
  }
  
  // Roaming Throne - "As Roaming Throne enters the battlefield, choose a creature type"
  if (name.includes("roaming throne")) {
    return { required: true, reason: "Choose a creature type for Roaming Throne's trigger doubling" };
  }
  
  // Cavern of Souls - "As Cavern of Souls enters the battlefield, choose a creature type"
  if (name.includes("cavern of souls")) {
    return { required: true, reason: "Choose a creature type for uncounterable casting" };
  }
  
  // Pillar of Origins - similar to Cavern
  if (name.includes("pillar of origins")) {
    return { required: true, reason: "Choose a creature type for mana ability" };
  }
  
  // Unclaimed Territory - "As Unclaimed Territory enters the battlefield, choose a creature type"
  if (name.includes("unclaimed territory")) {
    return { required: true, reason: "Choose a creature type for mana ability" };
  }
  
  // Urza's Incubator - "As Urza's Incubator enters the battlefield, choose a creature type"
  // Reduces cost of creature spells of chosen type by {2}
  if (name.includes("urza's incubator")) {
    return { required: true, reason: "Choose a creature type for Urza's Incubator cost reduction" };
  }
  
  // Herald's Horn - "As Herald's Horn enters the battlefield, choose a creature type"
  // Reduces cost by {1} and gives card advantage
  if (name.includes("herald's horn")) {
    return { required: true, reason: "Choose a creature type for Herald's Horn" };
  }
  
  // Icon of Ancestry - "As Icon of Ancestry enters the battlefield, choose a creature type"
  // Gives +1/+1 to creatures of that type
  if (name.includes("icon of ancestry")) {
    return { required: true, reason: "Choose a creature type for Icon of Ancestry" };
  }
  
  // Metallic Mimic - "As Metallic Mimic enters the battlefield, choose a creature type"
  if (name.includes("metallic mimic")) {
    return { required: true, reason: "Choose a creature type for Metallic Mimic" };
  }
  
  // Door of Destinies - "As Door of Destinies enters the battlefield, choose a creature type"
  if (name.includes("door of destinies")) {
    return { required: true, reason: "Choose a creature type for Door of Destinies" };
  }
  
  // Coat of Arms (doesn't need selection - affects all creature types)
  
  // Vanquisher's Banner - "As Vanquisher's Banner enters the battlefield, choose a creature type"
  if (name.includes("vanquisher's banner")) {
    return { required: true, reason: "Choose a creature type for Vanquisher's Banner" };
  }
  
  // Adaptive Automaton - "As Adaptive Automaton enters the battlefield, choose a creature type"
  if (name.includes("adaptive automaton")) {
    return { required: true, reason: "Choose a creature type for Adaptive Automaton" };
  }
  
  // Three Tree City - "As Three Tree City enters, choose a creature type"
  if (name.includes("three tree city")) {
    return { required: true, reason: "Choose a creature type for Three Tree City's mana ability" };
  }
  
  const offeredCreatureTypes = parseEtbOfferedCreatureTypes(card?.oracle_text || '');
  if (offeredCreatureTypes && offeredCreatureTypes.length > 0) {
    return {
      required: true,
      reason: `Choose one: ${offeredCreatureTypes.join(', ')}`,
    };
  }

  if (isEtbCreatureTypeChoiceOracle(card?.oracle_text || '')) {
    return { required: true, reason: "Choose a creature type" };
  }
  
  return { required: false, reason: "" };
}

export function getOfferedCreatureTypesForSelection(card: any): string[] | undefined {
  const offered = parseEtbOfferedCreatureTypes(card?.oracle_text || '');
  return offered && offered.length > 0 ? offered : undefined;
}

/**
 * Check if an instant/sorcery (or spell on stack) requires creature type selection when it resolves.
 */
export function requiresCreatureTypeSelectionOnCast(card: any): { required: boolean; reason: string } {
  if (!card) return { required: false, reason: '' };

  const name = String(card.name || '').toLowerCase();
  const oracleText = String(card.oracle_text || '');

  if (name.includes('kindred charge')) {
    return { required: true, reason: 'Choose a creature type for Kindred Charge' };
  }
  if (name.includes('kindred summons')) {
    return { required: true, reason: 'Choose a creature type for Kindred Summons' };
  }
  if (name.includes('kindred dominance')) {
    return { required: true, reason: 'Choose a creature type for Kindred Dominance' };
  }
  if (name.includes('distant melody')) {
    return { required: true, reason: 'Choose a creature type for Distant Melody' };
  }

  if (isCastCreatureTypeChoiceOracle(oracleText)) {
    return { required: true, reason: 'Choose a creature type' };
  }

  return { required: false, reason: '' };
}
