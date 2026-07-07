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

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from "../context.js";
import {
  evaluateReplacementEvent,
  type ReplacementEffectResult,
  type ReplacementZone,
} from './replacement-effects.js';
import { matchesSelfShuffleIntoLibraryReplacementOracle } from './replacementEffectSpec.js';
import { processLifeChange } from './game-state-effects.js';
import { moveRemovedPermanentToExile } from './zones.js';
import { debug } from "../../utils/debug.js";
import { recordCardLeftGraveyardThisTurn } from "./turn-tracking.js";
import { movePermanentToLibrary } from "./zones.js";
import { triggerLifeGainEffects } from '../utils.js';

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
  
  if (cardsToShuffle.length === 0 && !includeSelf) {
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
  const zoneCountField = `${sourceZone}Count` as 'graveyardCount' | 'exileCount' | 'handCount';
  if (zones[zoneCountField] !== undefined) {
    zones[zoneCountField] = zones[sourceZone].length;
  }
  
  let shuffledFromSourceCount = 0;
  if (cardsToShuffle.length > 0) {
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
    shuffledFromSourceCount = cardsToShuffle.length;
  }

  let shuffledSelfCount = 0;
  if (includeSelf) {
    const libraryBeforeSelfMove = (ctx.libraries.get(playerId) || []).length;
    if (movePermanentToLibrary(ctx, includeSelf, 'shuffle')) {
      const libraryAfterSelfMove = (ctx.libraries.get(playerId) || []).length;
      shuffledSelfCount = Math.max(0, libraryAfterSelfMove - libraryBeforeSelfMove);
      debug(2, `[shuffleZoneIntoLibrary] Processed battlefield self ${includeSelf} through library helper`);
    }
  }

  // Turn-tracking for intervening-if: a card left your graveyard this turn.
  if (sourceZone === 'graveyard') {
    // This operation is authoritative: cards were removed from graveyard.
    // Record both generic and creature-card evidence.
    try {
      recordCardLeftGraveyardThisTurn(ctx, String(playerId), cardsToShuffle.find((c: any) => String(c?.type_line || '').toLowerCase().includes('creature')));
      // Also record generic evidence even if there were no creature cards.
      recordCardLeftGraveyardThisTurn(ctx, String(playerId), cardsToShuffle[0]);
    } catch {}
  }
  
  const movedCount = shuffledFromSourceCount + shuffledSelfCount;
  const finalLibrarySize = (ctx.libraries.get(playerId) || []).length;
  if (movedCount === 0) {
    debug(2, `[shuffleZoneIntoLibrary] No cards to shuffle from ${sourceZone} for ${playerId}`);
    return 0;
  }

  debug(1, `[shuffleZoneIntoLibrary] Shuffled ${movedCount} cards from ${sourceZone} into ${playerId}'s library (new library size: ${finalLibrarySize})`);
  
  return movedCount;
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

  const oracleText = String(card.oracle_text || '').toLowerCase();

  if (
    oracleText
    && /(?:when|whenever)\b[^.]*\bis put into a graveyard from anywhere\b/.test(oracleText)
    && /shuffles? (?:their )?graveyard into (?:their )?library/.test(oracleText)
  ) {
    return true;
  }

  const name = String(card.name || '').toLowerCase();

  if (hasGraveyardSelfShuffleIntoLibraryReplacement(card)) {
    return false;
  }

  if (hasGraveyardMassShuffleIntoLibraryTrigger(card)) {
    return true;
  }

  // Known cards with graveyard shuffle triggers (non-oracle fallbacks)
  const knownShufflers = [
    'ulamog, the infinite gyre',
    'kozilek, butcher of truth',
    'emrakul, the aeons torn',
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

/** Eldrazi-style GY trigger: shuffle entire graveyard into library (not Blightsteel self-shuffle). */
export function hasGraveyardMassShuffleIntoLibraryTrigger(card: any): boolean {
  const oracleText = String(card?.oracle_text || card?.card?.oracle_text || '').toLowerCase();
  if (!oracleText) return false;
  return /shuffles? (?:their )?graveyard into (?:their )?library/.test(oracleText);
}

/**
 * Replacement-style self shuffle: "If X would be put into a graveyard from anywhere,
 * reveal X and shuffle it into its owner's library instead." (Blightsteel Colossus, Nexus of Fate)
 */
export function hasGraveyardSelfShuffleIntoLibraryReplacement(card: any): boolean {
  const oracleText = String(card?.oracle_text || card?.card?.oracle_text || '').trim();
  return matchesSelfShuffleIntoLibraryReplacementOracle(oracleText);
}

function shuffleCardCopyIntoOwnerLibrary(ctx: GameContext, card: any, ownerId: string): boolean {
  const owner = String(ownerId || '').trim();
  if (!owner || !card) return false;

  const state = (ctx as any).state;
  const libraries = ctx.libraries;
  if (!libraries) return false;

  const lib = libraries.get(owner) || [];
  const cardCopy = { ...(card as any), zone: 'library' };
  lib.push(cardCopy);

  const rng = (ctx.rng && typeof ctx.rng === 'function') ? ctx.rng : Math.random;
  for (let i = lib.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lib[i], lib[j]] = [lib[j], lib[i]];
  }

  libraries.set(owner, lib);

  const zones = state.zones = state.zones || {};
  const z = zones[owner] || (zones[owner] = {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  } as any);
  z.libraryCount = lib.length;

  debug(
    1,
    `[shuffleCardCopyIntoOwnerLibrary] ${String(cardCopy.name || 'Card')} shuffled into ${owner}'s library (self-shuffle replacement)`,
  );
  ctx.bumpSeq();
  return true;
}

export function shuffleRemovedPermanentIntoOwnerLibrary(
  ctx: GameContext,
  perm: any,
  ownerId: string,
): boolean {
  const zoneCard = ((perm as any)?.isFaceDown === true && (perm as any)?.faceUpCard)
    ? (perm as any).faceUpCard
    : ((perm as any)?.card || perm);
  const owner = String(ownerId || (perm as any)?.owner || (perm as any)?.controller || '').trim();
  return shuffleCardCopyIntoOwnerLibrary(ctx, zoneCard, owner);
}

function exileCardCopyForOwner(ctx: GameContext, card: any, ownerId: string): boolean {
  const owner = String(ownerId || '').trim();
  if (!owner || !card) return false;

  const state = (ctx as any).state;
  const zones = state.zones || {};
  const playerZones = { ...(zones[owner] || {}) };
  const exile = Array.isArray(playerZones.exile) ? [...playerZones.exile] : [];
  exile.push({ ...card, zone: 'exile' });
  playerZones.exile = exile;
  playerZones.exileCount = exile.length;
  state.zones = { ...zones, [owner]: playerZones };
  ctx.bumpSeq();
  return true;
}

export interface GraveyardDestinationReplacementOptions {
  sourceZone: ReplacementZone;
  controller?: string;
  owner?: string;
  objectId?: string;
  permanentId?: string;
  cause?: string;
}

export interface GraveyardDestinationReplacementOutcome {
  handled: boolean;
  effectId?: string;
  replacementDestination?: ReplacementZone;
  lifeGain?: number;
  ceasesToExist?: boolean;
}

export interface LeaveBattlefieldDestinationReplacementOptions {
  intendedDestination: ReplacementZone;
  controller?: string;
  owner?: string;
  objectId?: string;
  permanentId?: string;
  cause?: string;
}

export type {
  LeaveBattlefieldReplacementHint,
} from './leaveBattlefieldReplacementHint.js';
export {
  getDeclarativeLeaveBattlefieldReplacementHint,
} from './leaveBattlefieldReplacementHint.js';

function buildDeclarativeReplacementOutcome(
  result: ReplacementEffectResult,
): Pick<GraveyardDestinationReplacementOutcome, 'effectId' | 'lifeGain'> {
  return {
    effectId: result.effectId,
    lifeGain: typeof result.lifeGain === 'number' && result.lifeGain > 0 ? result.lifeGain : undefined,
  };
}

function applyDeclarativeZoneChangeReplacementOutcome(
  ctx: GameContext,
  object: any,
  ownerId: string,
  result: ReplacementEffectResult,
  options: { sourceZone: ReplacementZone; permanentId?: string },
): GraveyardDestinationReplacementOutcome {
  const owner = String(ownerId || '').trim();
  const baseOutcome = buildDeclarativeReplacementOutcome(result);

  if (result.metadata?.ceasesToExist === true) {
    return {
      handled: true,
      ...baseOutcome,
      ceasesToExist: true,
    };
  }

  const zoneCard = ((object as any)?.isFaceDown === true && (object as any)?.faceUpCard)
    ? (object as any).faceUpCard
    : ((object as any)?.card || object);

  if (
    result.replacementDestination === 'library'
    && result.metadata?.shuffleIntoOwnerLibrary === true
  ) {
    const shuffled = options.sourceZone === 'battlefield' && (object as any)?.card
      ? shuffleRemovedPermanentIntoOwnerLibrary(ctx, object, owner)
      : shuffleCardCopyIntoOwnerLibrary(ctx, zoneCard, owner);
    return shuffled
      ? {
          handled: true,
          ...baseOutcome,
          replacementDestination: result.replacementDestination,
        }
      : { handled: false };
  }

  if (result.replacementDestination === 'exile') {
    if (options.sourceZone === 'battlefield' && options.permanentId) {
      moveRemovedPermanentToExile(ctx, object, options.permanentId);
      return {
        handled: true,
        ...baseOutcome,
        replacementDestination: result.replacementDestination,
      };
    }
    const exiled = exileCardCopyForOwner(ctx, zoneCard, owner);
    return exiled
      ? {
          handled: true,
          ...baseOutcome,
          replacementDestination: result.replacementDestination,
        }
      : { handled: false };
  }

  return { handled: false };
}

/** Phase 5.2 leave-BF replacement choke point (exile instead, token cease-to-exist, self-shuffle). */
export function tryApplyDeclarativeLeaveBattlefieldDestinationReplacement(
  ctx: GameContext,
  object: any,
  ownerId: string,
  options: LeaveBattlefieldDestinationReplacementOptions,
): GraveyardDestinationReplacementOutcome {
  const owner = String(ownerId || options.owner || '').trim();
  if (!object || !owner) {
    return { handled: false };
  }

  const result = evaluateReplacementEvent({
    type: 'zone-change',
    state: (ctx as any).state,
    object,
    objectId: String(options.objectId || options.permanentId || object?.id || object?.card?.id || ''),
    sourceZone: 'battlefield',
    destinationZone: options.intendedDestination,
    controller: options.controller || owner,
    owner: options.owner || owner,
    cause: options.cause,
  });

  if (result.choiceRequired || !result.applied) {
    return { handled: false };
  }

  return applyDeclarativeZoneChangeReplacementOutcome(ctx, object, owner, result, {
    sourceZone: 'battlefield',
    permanentId: options.permanentId,
  });
}

export function applyLeaveBattlefieldReplacementLifeGain(
  ctx: GameContext,
  outcome: GraveyardDestinationReplacementOutcome,
  controllerId: string,
): void {
  const amount = Number(outcome.lifeGain || 0);
  if (amount <= 0 || outcome.effectId !== 'leave-battlefield-exile-instead') {
    return;
  }

  const playerId = String(controllerId || '').trim() as PlayerID;
  if (!playerId) return;

  const state = (ctx as any).state;
  const startingLife = state?.startingLife || 40;
  const currentLife = state?.life?.[playerId] ?? startingLife;
  const result = processLifeChange(ctx, playerId, amount, true);
  if (result.prevented || result.finalAmount === 0) {
    return;
  }

  if (!state.life) state.life = {};
  state.life[playerId] = currentLife + result.finalAmount;

  const player = Array.isArray(state.players)
    ? state.players.find((entry: any) => String(entry?.id || '') === String(playerId || ''))
    : undefined;
  if (player) {
    player.life = state.life[playerId];
  }

  try {
    if (result.finalAmount > 0) {
      (state as any).lifeGainedThisTurn = (state as any).lifeGainedThisTurn || {};
      (state as any).lifeGainedThisTurn[playerId] = ((state as any).lifeGainedThisTurn[playerId] || 0) + result.finalAmount;
      triggerLifeGainEffects(state, playerId, result.finalAmount);
    } else if (result.finalAmount < 0) {
      (state as any).lifeLostThisTurn = (state as any).lifeLostThisTurn || {};
      (state as any).lifeLostThisTurn[playerId] = ((state as any).lifeLostThisTurn[playerId] || 0) + Math.abs(result.finalAmount);
    }
  } catch {
    // best-effort tracking only
  }
}

export function tryApplyDeclarativeGraveyardDestinationReplacement(
  ctx: GameContext,
  object: any,
  ownerId: string,
  options: GraveyardDestinationReplacementOptions,
): GraveyardDestinationReplacementOutcome {
  const owner = String(ownerId || options.owner || '').trim();
  if (!object || !owner) {
    return { handled: false };
  }

  if (options.sourceZone === 'battlefield') {
    return tryApplyDeclarativeLeaveBattlefieldDestinationReplacement(ctx, object, owner, {
      intendedDestination: 'graveyard',
      controller: options.controller,
      owner: options.owner,
      objectId: options.objectId,
      permanentId: options.permanentId,
      cause: options.cause,
    });
  }

  const result = evaluateReplacementEvent({
    type: 'zone-change',
    state: (ctx as any).state,
    object,
    objectId: String(options.objectId || options.permanentId || object?.id || object?.card?.id || ''),
    sourceZone: options.sourceZone,
    destinationZone: 'graveyard',
    controller: options.controller || owner,
    owner: options.owner || owner,
    cause: options.cause,
  });

  if (result.choiceRequired || !result.applied) {
    return { handled: false };
  }

  return applyDeclarativeZoneChangeReplacementOutcome(ctx, object, owner, result, {
    sourceZone: options.sourceZone,
    permanentId: options.permanentId,
  });
}

export function tryApplyGraveyardSelfShuffleReplacementForCard(
  ctx: GameContext,
  card: any,
  ownerId: string,
): boolean {
  return tryApplyDeclarativeGraveyardDestinationReplacement(ctx, card, ownerId, {
    sourceZone: 'hand',
  }).handled;
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
