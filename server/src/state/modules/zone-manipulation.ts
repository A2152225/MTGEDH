/**
 * zone-manipulation.ts
 * 
 * Utilities for complex zone manipulation operations.
 * Provides scalable, dynamic solutions for cards that move cards between zones.
 * 
 * This module handles:
 * - Graveyard to library shuffles (Elixir of Immortality, Eldrazi titans)
 * - Exile to library shuffles
 * - Library manipulation with proper shuffling
 * - Self-replacement (card shuffling itself into library)
 */

import type { GameContext } from "../context.js";
import { debug } from "../../utils/debug.js";

/**
 * Shuffle cards from one zone into library.
 * Handles the common pattern of "shuffle [zone] into [owner's] library".
 * 
 * @param ctx Game context
 * @param playerId Player whose library to shuffle into
 * @param sourceZone Which zone to take cards from ('graveyard', 'exile', 'hand', etc.)
 * @param filter Optional filter function to select which cards to shuffle (default: all cards)
 * @param includeSelf Optional card ID to include from battlefield (for self-replacement like Elixir)
 * @returns Number of cards shuffled
 */
export function shuffleZoneIntoLibrary(
  ctx: GameContext,
  playerId: string,
  sourceZone: 'graveyard' | 'exile' | 'hand',
  filter?: (card: any) => boolean,
  includeSelf?: string
): number {
  const state = (ctx as any).state;
  const zones = state.zones?.[playerId];
  
  if (!zones || !ctx.libraries) {
    debug(2, `[shuffleZoneIntoLibrary] No zones or libraries for player ${playerId}`);
    return 0;
  }
  
  const library = ctx.libraries.get(playerId) || [];
  const cardsToShuffle: any[] = [];
  
  // Get cards from the source zone
  const sourceCards = zones[sourceZone] || [];
  const filteredCards = filter ? sourceCards.filter(filter) : sourceCards;
  
  // Add filtered cards to shuffle list
  for (const card of filteredCards) {
    cardsToShuffle.push({ ...card, zone: 'library' });
  }
  
  // Handle self-replacement (card on battlefield shuffling itself)
  if (includeSelf) {
    const battlefield = state.battlefield || [];
    const selfPerm = battlefield.find((p: any) => p.id === includeSelf);
    
    if (selfPerm && selfPerm.card) {
      cardsToShuffle.push({ ...selfPerm.card, zone: 'library' });
      
      // Remove from battlefield
      const selfIndex = battlefield.findIndex((p: any) => p.id === includeSelf);
      if (selfIndex >= 0) {
        battlefield.splice(selfIndex, 1);
        debug(2, `[shuffleZoneIntoLibrary] Removed ${selfPerm.card.name} from battlefield`);
      }
    }
  }
  
  if (cardsToShuffle.length === 0) {
    debug(2, `[shuffleZoneIntoLibrary] No cards to shuffle from ${sourceZone} for ${playerId}`);
    return 0;
  }
  
  // Remove cards from source zone
  if (filter) {
    // Only remove the filtered cards
    zones[sourceZone] = sourceCards.filter((card: any) => !filter(card));
  } else {
    // Remove all cards
    zones[sourceZone] = [];
  }
  
  // Update zone count
  const zoneCountField = `${sourceZone}Count` as 'graveyardCount' | 'exileCount';
  if (zones[zoneCountField] !== undefined) {
    zones[zoneCountField] = zones[sourceZone].length;
  }
  
  // Add cards to library
  const newLibrary = [...library, ...cardsToShuffle];
  
  // Shuffle using RNG (use ctx.rng for determinism if available)
  const rng = (ctx.rng && typeof ctx.rng === 'function') ? ctx.rng : Math.random;
  for (let i = newLibrary.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [newLibrary[i], newLibrary[j]] = [newLibrary[j], newLibrary[i]];
  }
  
  // Update library
  ctx.libraries.set(playerId, newLibrary);
  zones.libraryCount = newLibrary.length;
  
  debug(1, `[shuffleZoneIntoLibrary] Shuffled ${cardsToShuffle.length} cards from ${sourceZone} into ${playerId}'s library (new library size: ${newLibrary.length})`);
  
  return cardsToShuffle.length;
}

/**
 * Handle "shuffle graveyard into library" pattern.
 * Common on Eldrazi titans and similar cards that trigger when put into graveyard.
 * 
 * @param ctx Game context
 * @param playerId Player whose graveyard to shuffle
 * @param includeSelf Whether to include the triggering card itself
 * @param cardId ID of the card that triggered this (for self-inclusion)
 * @returns Number of cards shuffled
 */
export function shuffleGraveyardIntoLibrary(
  ctx: GameContext,
  playerId: string,
  includeSelf: boolean = true,
  cardId?: string
): number {
  debug(2, `[shuffleGraveyardIntoLibrary] Player ${playerId}, includeSelf: ${includeSelf}, cardId: ${cardId}`);
  
  return shuffleZoneIntoLibrary(
    ctx,
    playerId,
    'graveyard',
    undefined, // No filter, take all cards
    includeSelf && cardId ? cardId : undefined
  );
}

/**
 * Handle Elixir of Immortality pattern: "Shuffle this artifact and your graveyard into their owner's library."
 * This is triggered from an activated ability, so the card is on battlefield when activated.
 * 
 * @param ctx Game context
 * @param controller Controller of the Elixir
 * @param elixirId Permanent ID of the Elixir
 * @returns Number of cards shuffled
 */
export function handleElixirShuffle(
  ctx: GameContext,
  controller: string,
  elixirId: string
): number {
  debug(1, `[handleElixirShuffle] Controller ${controller}, Elixir ID: ${elixirId}`);
  
  // Controller gains 5 life first (handled separately)
  // Then shuffle graveyard and the artifact into library
  
  return shuffleZoneIntoLibrary(
    ctx,
    controller,
    'graveyard',
    undefined, // Take all graveyard cards
    elixirId // Include the Elixir itself from battlefield
  );
}

/**
 * Handle Eldrazi titan pattern: "When this card is put into a graveyard from anywhere, 
 * shuffle your graveyard into your library."
 * 
 * This triggers after the card enters the graveyard, so it's already in the graveyard.
 * The graveyard should include the titan itself.
 * 
 * @param ctx Game context
 * @param ownerId Owner of the Eldrazi
 * @param titanCard The card object (already in graveyard)
 * @returns Number of cards shuffled
 */
export function handleEldraziShuffle(
  ctx: GameContext,
  ownerId: string,
  titanCard: any
): number {
  debug(1, `[handleEldraziShuffle] Owner ${ownerId}, Titan: ${titanCard?.name}`);
  
  // The titan is already in the graveyard, so we just shuffle everything
  // No need to include from battlefield
  return shuffleZoneIntoLibrary(
    ctx,
    ownerId,
    'graveyard',
    undefined // Take all cards including the titan
  );
}

/**
 * Detect if a card has the graveyard shuffle trigger.
 * Checks both known cards and dynamic pattern matching.
 * 
 * Patterns:
 * - "shuffle your graveyard into your library"
 * - "shuffle this card and your graveyard into their owner's library"
 * - Eldrazi titans: "when put into graveyard from anywhere"
 * 
 * @param card Card to check
 * @returns True if card has graveyard shuffle trigger
 */
export function hasGraveyardShuffleTrigger(card: any): boolean {
  if (!card) return false;
  
  const name = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Known cards with graveyard shuffle
  const knownShufflers = [
    'ulamog, the infinite gyre',
    'kozilek, butcher of truth',
    'emrakul, the aeons torn',
    'blightsteel colossus',
    'nexus of fate',
  ];
  
  if (knownShufflers.includes(name)) {
    return true;
  }
  
  // Pattern matching
  if (oracleText.includes('shuffle') && oracleText.includes('graveyard') && oracleText.includes('library')) {
    // Check it's a trigger, not just mentioning the effect
    if (oracleText.includes('when') || oracleText.includes('whenever')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if card is Elixir of Immortality or similar activated ability
 * that shuffles graveyard as part of its effect.
 * 
 * @param card Card to check
 * @returns True if card has activated shuffle ability
 */
export function hasActivatedShuffleAbility(card: any): boolean {
  if (!card) return false;
  
  const name = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Known cards
  if (name.includes('elixir of immortality')) {
    return true;
  }
  
  // Pattern: has activated ability ({cost}:) and shuffles graveyard
  const hasActivatedAbility = oracleText.match(/\{[^}]+\}:/);
  const shufflesGraveyard = oracleText.includes('shuffle') && 
                            oracleText.includes('graveyard') && 
                            oracleText.includes('library');
  
  return Boolean(hasActivatedAbility && shufflesGraveyard);
}
