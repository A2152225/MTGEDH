// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: top-of-library look/play/cast (oracle-only; TOP_OF_LIBRARY_CARDS deleted),
// hand-reveal Telepathy (oracle-only; HAND_REVEAL_CARDS deleted), recalculatePlayerEffects.
// Public entry symbols: canLookAtTopOfLibrary, canPlayLandsFromTop, canCastFromTop,
// getLibraryTopCardFromState, libraryTopCardHasType, getTopCardForPlayer,
// recalculatePlayerEffects.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import { zoneCastProhibitionReason } from "../batch31CastLocks.js"; // B31
import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/index.js";
import { grantTelepathyForPlayer } from "../telepathy.js";
import { getDurableLibraryPermissionForCard } from "../durable-permissions.js";
import { debug } from "../../../utils/debug.js";
import { cardHasCreatureType } from "../../creatureTypeNow.js";
import { getActivePermanents } from "./gameStateEffectsBattlefieldQueries.js";
import { hasCoven } from "./gameStateEffectsAbilityConditions.js";
import { calculateMaxLandsPerTurn, calculateAdditionalDraws } from "./gameStateEffectsLandPlayDraw.js";

// =============================================================================
// TOP OF LIBRARY EFFECTS
// =============================================================================
// Cards that let you look at and/or play cards from the top of your library

type TopOfLibraryCardInput = string | {
  type_line?: string;
  typeLine?: string;
  colors?: string[];
  color_identity?: string[];
};

function getTopLibraryTypeLine(card: TopOfLibraryCardInput | undefined): string {
  if (typeof card === 'string') return card.toLowerCase();
  return String(card?.type_line || card?.typeLine || '').toLowerCase();
}

function isTopLibraryCardColorless(card: TopOfLibraryCardInput | undefined): boolean {
  if (!card || typeof card === 'string') return false;
  const colors = Array.isArray(card.colors)
    ? card.colors
    : (Array.isArray(card.color_identity) ? card.color_identity : []);
  return colors.length === 0;
}

function hasGenericTopLibraryLandPermissionText(oracleText: string): boolean {
  return oracleText.includes('play lands from the top of your library')
    || oracleText.includes('play lands and cast spells from the top of your library')
    || oracleText.includes('you may play the top card of your library');
}

function hasGenericTopLibraryLookPermissionText(oracleText: string): boolean {
  return oracleText.includes('look at the top card of your library any time')
    || oracleText.includes('play with the top card of your library revealed');
}

function hasGenericTopLibrarySpellPermissionText(oracleText: string): boolean {
  return oracleText.includes('you may cast the top card of your library')
    || oracleText.includes('you may cast spells from the top of your library')
    || oracleText.includes('cast spells from the top of your library')
    || oracleText.includes('you may play the top card of your library');
}

type ParsedTopLibraryCastRestriction = {
  castTypes?: string[];
  noncreatureOnly?: boolean;
  creatureTypeFilter?: string;
  tribalSpellFilter?: string;
  unrestricted?: boolean;
  allowColorlessNonland?: boolean;
  requiresCoven?: boolean;
  grantsFlash?: boolean;
};

function parseTopLibraryCastRestrictionFromOracle(oracleText: string): ParsedTopLibraryCastRestriction | null {
  const text = String(oracleText || '').toLowerCase();
  if (!text) return null;
  const grantsFlash = /as though (?:it|they) had flash/.test(text);
  const withFlash = (restriction: ParsedTopLibraryCastRestriction): ParsedTopLibraryCastRestriction => (
    grantsFlash ? { ...restriction, grantsFlash: true } : restriction
  );

  if (
    text.includes('cast artifact spells and colorless spells from the top of your library')
    || text.includes('artifact card or a colorless nonland')
  ) {
    return withFlash({ castTypes: ['artifact'], allowColorlessNonland: true });
  }
  if (text.includes('cast creature spells of the chosen type from the top of your library')) {
    return null;
  }
  if (text.includes('cast creature spells from the top of your library')) {
    return withFlash({
      castTypes: ['creature'],
      requiresCoven: /coven[\s\S]*?cast creature spells from the top of your library/.test(text),
    });
  }
  if (text.includes('cast instant and sorcery spells from the top of your library')) {
    return withFlash({ castTypes: ['instant', 'sorcery'] });
  }
  if (text.includes('cast noncreature spells from the top of your library')) {
    return withFlash({ noncreatureOnly: true });
  }

  const tribalMatch = text.match(/cast ([a-z]+) spells from the top of your library/);
  if (tribalMatch) {
    const tribe = String(tribalMatch[1] || '').trim().toLowerCase();
    const knownTypes = new Set([
      'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle',
    ]);
    if (tribe && !knownTypes.has(tribe)) {
      return withFlash({ tribalSpellFilter: tribe });
    }
  }

  if (hasGenericTopLibrarySpellPermissionText(text)) {
    return withFlash({ unrestricted: true });
  }

  return null;
}

function topLibraryCastRestrictionMatchesCard(
  restriction: ParsedTopLibraryCastRestriction,
  typeLine: string,
  card: TopOfLibraryCardInput | undefined,
  sourceName: string,
  restrictions: string[],
  isColorlessNonland: boolean,
): boolean {
  const hasCardContext = Boolean(card);
  if (!hasCardContext) return true;

  if (restriction.unrestricted) {
    return true;
  }

  if (restriction.tribalSpellFilter) {
    if (!typeLine.includes(restriction.tribalSpellFilter)) {
      restrictions.push(`${sourceName} only allows ${restriction.tribalSpellFilter} spells`);
      return false;
    }
    return true;
  }

  if (restriction.noncreatureOnly) {
    if (typeLine.includes('creature')) {
      restrictions.push(`${sourceName} only allows noncreature spells`);
      return false;
    }
    return true;
  }

  if (restriction.castTypes && restriction.castTypes.length > 0) {
    const typeMatches = restriction.castTypes.some((entry) => typeLine.includes(entry));
    if (!typeMatches && !(restriction.allowColorlessNonland && isColorlessNonland)) {
      restrictions.push(`${sourceName} only allows: ${restriction.castTypes.join(', ')}`);
      return false;
    }
  } else if (restriction.allowColorlessNonland) {
    if (!isColorlessNonland) {
      restrictions.push(`${sourceName} only allows colorless nonland cards`);
      return false;
    }
  }

  if (restriction.creatureTypeFilter && typeLine.includes('creature')) {
    if (!typeLine.includes(restriction.creatureTypeFilter)) {
      restrictions.push(`${sourceName} only allows ${restriction.creatureTypeFilter} creatures`);
      return false;
    }
  }

  return true;
}

/**
 * Check if a player can look at the top card of their library
 * Returns the source permanent if they can
 */
export function canLookAtTopOfLibrary(ctx: GameContext, playerId: string): { canLook: boolean; sources: string[] } {
  const sources: string[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    const oracleText = String(perm.card?.oracle_text || '').toLowerCase();
    if (hasGenericTopLibraryLookPermissionText(oracleText)) {
      sources.push(perm.card?.name || 'Top-of-library effect');
    }
  }
  
  return { canLook: sources.length > 0, sources };
}

/**
 * Check if a player can play lands from the top of their library
 */
export function canPlayLandsFromTop(ctx: GameContext, playerId: string, card?: TopOfLibraryCardInput): { canPlay: boolean; sources: string[] } {
  const sources: string[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    const oracleText = String(perm.card?.oracle_text || '').toLowerCase();
    if (hasGenericTopLibraryLandPermissionText(oracleText)) {
      sources.push(perm.card?.name || 'Top-of-library effect');
    }
  }

  const durablePermission = getDurableLibraryPermissionForCard(ctx.state, playerId as PlayerID, card, 'play');
  if (durablePermission) {
    sources.push(durablePermission.sourceName || 'Top-of-library permission');
  }
  
  return { canPlay: sources.length > 0, sources };
}

/**
 * Check if a player can cast a specific card type from the top of their library
 */
export function canCastFromTop(
  ctx: GameContext, 
  playerId: string, 
  card?: TopOfLibraryCardInput
): { canCast: boolean; sources: string[]; restrictions: string[]; grantsFlash: boolean; flashSources: string[]; costMode?: string; spendManaAsThoughAnyType?: boolean } {
  const sources: string[] = [];
  const restrictions: string[] = [];
  const flashSources: string[] = [];
  let costMode: string | undefined;
  let spendManaAsThoughAnyType = false;
  const battlefield = getActivePermanents(ctx);
  const step = String(ctx.state?.step || '').toUpperCase();
  const phase = String(ctx.state?.phase || '').toUpperCase();
  const isMainPhase = step === 'MAIN1' || step === 'MAIN2' || step === 'MAIN' || step === 'MAIN_1' || step === 'MAIN_2' || step.includes('MAIN') || phase.includes('MAIN');
  const isYourTurn = String((ctx.state as any)?.turnPlayer || '') === String(playerId || '');
  const stackEmpty = !ctx.state?.stack || ctx.state.stack.length === 0;
  
  const typeLine = getTopLibraryTypeLine(card);
  const hasCardContext = Boolean(card);
  const isColorlessNonland = hasCardContext && !typeLine.includes('land') && isTopLibraryCardColorless(card);
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;

    const oracleText = String(perm.card?.oracle_text || '').toLowerCase();
    const sourceName = perm.card?.name || 'Top-of-library effect';
    let matched = false;

    if (oracleText.includes('cast creature spells of the chosen type from the top of your library')) {
      const chosenType = String((perm as any).chosenCreatureType || '').trim().toLowerCase();
      if (!chosenType) {
        restrictions.push(`${sourceName}: no creature type chosen`);
      } else if (!hasCardContext) {
        sources.push(sourceName);
        matched = true;
      } else if (typeLine.includes('creature') && cardHasCreatureType(card, chosenType)) {
        sources.push(sourceName);
        matched = true;
      } else {
        restrictions.push(`${sourceName} only allows ${chosenType} creature spells from the top of your library`);
      }
    }

    if (!matched) {
      const parsedRestriction = parseTopLibraryCastRestrictionFromOracle(oracleText);
      if (parsedRestriction) {
        if (parsedRestriction.requiresCoven && !hasCoven(ctx, playerId)) {
          restrictions.push(`${sourceName} requires coven (3 creatures with different powers)`);
        } else if (topLibraryCastRestrictionMatchesCard(
          parsedRestriction,
          typeLine,
          card,
          sourceName,
          restrictions,
          isColorlessNonland,
        )) {
          sources.push(sourceName);
          if (parsedRestriction.grantsFlash) {
            flashSources.push(sourceName);
          }
        }
      }
    }
  }

  const durablePermission = getDurableLibraryPermissionForCard(ctx.state, playerId as PlayerID, card, 'cast');
  if (durablePermission) {
    const sourceName = durablePermission.sourceName || 'Top-of-library permission';
    const timingOverride = durablePermission.timingOverride || {};
    const grantsTimingFreedom = timingOverride.asThoughFlash === true || timingOverride.ignoreTiming === true;
    const timingRestrictedToYourTurn = timingOverride.duringYourTurnOnly === true && !isYourTurn;
    const timingRequiresSorcerySpeed = timingOverride.sorcerySpeedOnly === true && (!isYourTurn || !isMainPhase || !stackEmpty);

    if (!timingRestrictedToYourTurn && !timingRequiresSorcerySpeed) {
      sources.push(sourceName);
      costMode = String(durablePermission.costMode || '').trim() || undefined;
      spendManaAsThoughAnyType = (durablePermission.metadata as any)?.spendManaAsThoughAnyType === true;
      if (grantsTimingFreedom) {
        flashSources.push(sourceName);
      }
    } else if (timingRestrictedToYourTurn) {
      restrictions.push(`${sourceName} only allows casts during your turn`);
    } else if (timingRequiresSorcerySpeed) {
      restrictions.push(`${sourceName} only allows casts at sorcery speed`);
    }
  }
  
  const b31LibraryLock = zoneCastProhibitionReason(ctx.state, String(playerId), 'library');
  if (b31LibraryLock) {
    return { canCast: false, sources: [], restrictions: [...restrictions, b31LibraryLock], grantsFlash: false, flashSources: [] };
  }
  return {
    canCast: sources.length > 0,
    sources,
    restrictions,
    grantsFlash: flashSources.length > 0,
    flashSources,
    ...(costMode ? { costMode } : {}),
    ...(spendManaAsThoughAnyType ? { spendManaAsThoughAnyType: true } : {}),
  };
}

/**
 * Read the top card of a player's library from authoritative state stores.
 */
export function getLibraryTopCardFromState(state: any, playerId: string): any | null {
  const libraries = state?.libraries;
  if (libraries && typeof libraries.get === 'function') {
    const library = libraries.get(playerId);
    if (Array.isArray(library) && library.length > 0) {
      return library[0] ?? null;
    }
  }

  const zoneLibrary = state?.zones?.[playerId]?.library;
  if (Array.isArray(zoneLibrary) && zoneLibrary.length > 0) {
    return zoneLibrary[0] ?? null;
  }

  return null;
}

export function libraryTopCardHasType(state: any, playerId: string, cardType: string): boolean {
  const topCard = getLibraryTopCardFromState(state, playerId);
  const typeLine = String(topCard?.type_line || topCard?.typeLine || '').toLowerCase();
  return typeLine.includes(String(cardType || '').toLowerCase());
}

/**
 * Get the top card of a player's library (if they can see it)
 */
export function getTopCardForPlayer(ctx: GameContext, playerId: string): { 
  card: any | null; 
  canSee: boolean; 
  sources: string[];
} {
  const { canLook, sources } = canLookAtTopOfLibrary(ctx, playerId);
  
  if (!canLook) {
    return { card: null, canSee: false, sources: [] };
  }
  
  // Get the top card from the authoritative library store.
  const library = Array.isArray((ctx as any).libraries?.get?.(playerId))
    ? ((ctx as any).libraries.get(playerId) as any[])
    : [];
  
  if (library.length === 0) {
    return { card: null, canSee: true, sources };
  }
  
  const topCard = library[0];
  
  return { card: topCard, canSee: true, sources };
}

/**
 * Detect static hand-reveal effects from oracle (Telepathy / Revelation).
 * One-shot "look at target player's hand" activations are not ongoing grants.
 */
function detectHandRevealEffect(oracleText: string): { revealsOpponentsHands: boolean; revealsAllHands: boolean } {
  const lowerText = (oracleText || "").toLowerCase();
  
  // "Your opponents play with their hands revealed" - Telepathy
  if (lowerText.includes("your opponents play with their hands revealed") ||
      lowerText.includes("opponents play with their hands revealed")) {
    return { revealsOpponentsHands: true, revealsAllHands: false };
  }
  
  // "Each player plays with their hand revealed" - Revelation, Wandering Eye
  if (lowerText.includes("each player plays with their hand revealed") ||
      lowerText.includes("players play with their hands revealed")) {
    return { revealsOpponentsHands: true, revealsAllHands: true };
  }
  
  return { revealsOpponentsHands: false, revealsAllHands: false };
}

/**
 * Recalculate hand visibility grants based on battlefield permanents
 * This handles Telepathy and similar static effects that reveal hands
 * 
 * Note: This function clears and rebuilds all grants on each call.
 * This is simpler and more reliable than diff-based approaches, and
 * the performance impact is minimal since battlefield sizes are typically small.
 */
function recalculateHandVisibility(ctx: GameContext): void {
  const battlefield = getActivePermanents(ctx);
  
  // Track which players have hand reveal effects active
  const playersWithHandReveal = new Set<PlayerID>();
  
  for (const perm of battlefield) {
    const oracleText = (perm.card?.oracle_text || "");
    const controller = perm.controller as PlayerID;
    const reveal = detectHandRevealEffect(oracleText);
    if (reveal.revealsOpponentsHands) {
      playersWithHandReveal.add(controller);
    }
  }
  
  // Initialize handVisibilityGrants if it doesn't exist
  if (!ctx.handVisibilityGrants) {
    ctx.handVisibilityGrants = new Map();
  }
  
  // Clear all existing hand visibility grants and rebuild from scratch
  // This ensures we don't have stale grants when permanents leave the battlefield
  ctx.handVisibilityGrants.clear();
  
  // Grant hand visibility for each player with a reveal effect
  for (const telepath of playersWithHandReveal) {
    grantTelepathyForPlayer(ctx, telepath);
  }
  
  debug(1, `[recalculateHandVisibility] Players with hand reveal effects: ${Array.from(playersWithHandReveal).join(', ') || 'none'}`);
}

/**
 * Update player's top-of-library effects based on battlefield state
 * This should be called after permanents ETB or leave the battlefield
 */
export function recalculatePlayerEffects(ctx: GameContext, playerId?: string): void {
  const players = (ctx.state?.players as any[]) || [];
  const targetPlayers = playerId ? [{ id: playerId }] : players;
  
  for (const p of targetPlayers) {
    const pid = p.id;
    
    // Calculate and set max lands per turn
    const maxLands = calculateMaxLandsPerTurn(ctx, pid);
    (ctx as any).maxLandsPerTurn = (ctx as any).maxLandsPerTurn || {};
    (ctx as any).maxLandsPerTurn[pid] = maxLands;
    
    // Also update ctx.state.maxLandsPerTurn for compatibility with game-actions.ts
    // which reads from game.state.maxLandsPerTurn
    if (ctx.state) {
      (ctx.state as any).maxLandsPerTurn = (ctx.state as any).maxLandsPerTurn || {};
      (ctx.state as any).maxLandsPerTurn[pid] = maxLands;
    }
    
    // Calculate and set additional draws per turn
    const additionalDraws = calculateAdditionalDraws(ctx, pid);
    (ctx as any).additionalDrawsPerTurn = (ctx as any).additionalDrawsPerTurn || {};
    (ctx as any).additionalDrawsPerTurn[pid] = additionalDraws;
    
    // Also update ctx.state.additionalDrawsPerTurn for compatibility
    if (ctx.state) {
      (ctx.state as any).additionalDrawsPerTurn = (ctx.state as any).additionalDrawsPerTurn || {};
      (ctx.state as any).additionalDrawsPerTurn[pid] = additionalDraws;
    }
    
    // Calculate and set top-of-library effects
    const topOfLibraryLook = canLookAtTopOfLibrary(ctx, pid);
    const topOfLibraryPlayLands = canPlayLandsFromTop(ctx, pid);
    const topOfLibraryCast = canCastFromTop(ctx, pid);
    
    if (ctx.state) {
      (ctx.state as any).topOfLibraryEffects = (ctx.state as any).topOfLibraryEffects || {};
      (ctx.state as any).topOfLibraryEffects[pid] = {
        canLook: topOfLibraryLook.canLook,
        lookSources: topOfLibraryLook.sources,
        canPlayLands: topOfLibraryPlayLands.canPlay,
        playLandSources: topOfLibraryPlayLands.sources,
        canCast: topOfLibraryCast.canCast,
        castSources: topOfLibraryCast.sources,
      };
    }
  }
  
  // After all per-player effects are calculated, update hand visibility grants
  // This handles Telepathy and similar effects that reveal opponents' hands
  recalculateHandVisibility(ctx);
}

