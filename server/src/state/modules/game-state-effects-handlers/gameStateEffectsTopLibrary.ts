// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: TOP_OF_LIBRARY_CARDS, canLookAtTopOfLibrary / canPlayLandsFromTop /
// canCastFromTop, library-top accessors, hand-reveal Telepathy, recalculatePlayerEffects.
// Public entry symbols: canLookAtTopOfLibrary, canPlayLandsFromTop, canCastFromTop,
// getLibraryTopCardFromState, libraryTopCardHasType, getTopCardForPlayer,
// recalculatePlayerEffects.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

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

/**
 * Configuration for cards that reveal/play from top of library
 */
interface TopOfLibraryEffect {
  lookAtTop: boolean;           // Can look at top card at any time
  playLandsFromTop?: boolean;   // Can play lands from top of library
  castFromTop?: boolean;        // Can cast spells from top of library
  castTypes?: string[];         // Only these types can be cast (e.g., ['creature'])
  noncreatureOnly?: boolean;    // Only noncreature spells can be cast
  allowColorlessNonland?: boolean; // Can also cast colorless nonland cards
  creatureTypeFilter?: string;  // Only creatures of this type (e.g., 'Goblin')
  tribalSpellFilter?: string;   // Any spell whose type line includes tribe (e.g., 'Merfolk')
  chosenTypeCastFromTop?: boolean; // Creature spells of permanent.chosenCreatureType (Realmwalker)
  conditionCheck?: string;      // Condition to cast (e.g., 'coven' for Augur of Autumn)
  grantsFlash?: boolean;        // Matching spells can be cast as though they had flash
}

/**
 * Cards that grant top of library effects
 * Key: lowercase card name (partial match)
 */
const TOP_OF_LIBRARY_CARDS: Record<string, TopOfLibraryEffect> = {
  // Oracle of Mul Daya - "You may play lands from the top of your library" + reveal top
  "oracle of mul daya": {
    lookAtTop: true,
    playLandsFromTop: true,
  },
  // Courser of Kruphix - "Play lands from the top of your library" + reveal top
  "courser of kruphix": {
    lookAtTop: true,
    playLandsFromTop: true,
  },
  // Future Sight - "You may play the top card of your library"
  "future sight": {
    lookAtTop: true,
    castFromTop: true,
    playLandsFromTop: true,
  },
  // Experimental Frenzy - "You may play the top card of your library" (can't play from hand)
  "experimental frenzy": {
    lookAtTop: true,
    castFromTop: true,
    playLandsFromTop: true,
  },
  // Augur of Autumn - "You may look at the top card of your library" + "You may play lands from the top"
  // With coven: "You may cast creature spells from the top of your library"
  "augur of autumn": {
    lookAtTop: true,
    playLandsFromTop: true,
    castFromTop: true,
    castTypes: ['creature'],
    conditionCheck: 'coven',
  },
  // Conspicuous Snoop - "You may look at the top card of your library any time"
  // + "You may cast Goblin spells from the top of your library"
  "conspicuous snoop": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
    creatureTypeFilter: 'goblin',
  },
  // Eladamri, Korvecdal - "Look at the top card of your library any time"
  // + "You may cast creature spells from the top of your library"
  "eladamri, korvecdal": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
  },
  // Radha, Heart of Keld - "You may look at the top card of your library any time"
  // + "You may play lands from the top of your library"
  "radha, heart of keld": {
    lookAtTop: true,
    playLandsFromTop: true,
  },
  // Vizier of the Menagerie - "You may look at the top card of your library any time"
  // + "You may cast creature spells from the top of your library"
  "vizier of the menagerie": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
  },
  // Garruk's Horde - "You may look at the top card of your library any time"
  // + "You may cast creature spells from the top of your library"
  "garruk's horde": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
  },
  // Melek, Izzet Paragon - "You may look at the top card of your library any time"
  // + "You may cast instant and sorcery spells from the top of your library"
  "melek, izzet paragon": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['instant', 'sorcery'],
  },
  // Bolas's Citadel - "You may look at the top card of your library any time"
  // + "You may play the top card of your library" (pay life equal to CMC)
  "bolas's citadel": {
    lookAtTop: true,
    castFromTop: true,
    playLandsFromTop: true,
  },
  // Mystic Forge - "You may look at the top card of your library any time"
  // + "You may cast the top card of your library if it's an artifact card or a colorless nonland card"
  "mystic forge": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['artifact'],
    allowColorlessNonland: true,
  },
  // Magus of the Future - Same as Future Sight
  "magus of the future": {
    lookAtTop: true,
    castFromTop: true,
    playLandsFromTop: true,
  },
  // Vance's Blasting Cannons - "At the beginning of your upkeep, exile the top card of your library. If it's a nonland card, you may cast it this turn"
  // Different mechanic - not continuous, so not included
  
  // The Gitrog Monster - Doesn't reveal top, but can play lands from graveyard
  // Different mechanic - not included
  
  // Elsha of the Infinite - "You may look at the top card of your library any time"
  // + "You may cast noncreature spells from the top of your library"
  "elsha of the infinite": {
    lookAtTop: true,
    castFromTop: true,
    noncreatureOnly: true,
    grantsFlash: true,
  },
  // Elven Chorus - look at top any time; cast creature spells from top
  "elven chorus": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
  },
  // Emperor Mihail II - look at top; cast Merfolk spells from top
  "emperor mihail ii": {
    lookAtTop: true,
    castFromTop: true,
    tribalSpellFilter: 'merfolk',
  },
  // Realmwalker - look at top; cast creature spells of the chosen type from top
  "realmwalker": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
    chosenTypeCastFromTop: true,
  },
  // Ulvenwald Channelers - play with top revealed (visibility handled in view.ts)
  "ulvenwald channelers": {
    lookAtTop: true,
  },
};

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
    || oracleText.includes('you may play the top card of your library');
}

function hasGenericTopLibraryLookPermissionText(oracleText: string): boolean {
  return oracleText.includes('look at the top card of your library any time')
    || oracleText.includes('play with the top card of your library revealed');
}

function hasGenericTopLibrarySpellPermissionText(oracleText: string): boolean {
  return oracleText.includes('you may cast the top card of your library')
    || oracleText.includes('you may cast spells from the top of your library')
    || oracleText.includes('you may play the top card of your library');
}

type ParsedTopLibraryCastRestriction = {
  castTypes?: string[];
  noncreatureOnly?: boolean;
  creatureTypeFilter?: string;
  tribalSpellFilter?: string;
  unrestricted?: boolean;
};

function parseTopLibraryCastRestrictionFromOracle(oracleText: string): ParsedTopLibraryCastRestriction | null {
  const text = String(oracleText || '').toLowerCase();
  if (!text) return null;

  if (text.includes('cast creature spells from the top of your library')) {
    return { castTypes: ['creature'] };
  }
  if (text.includes('cast instant and sorcery spells from the top of your library')) {
    return { castTypes: ['instant', 'sorcery'] };
  }
  if (text.includes('cast noncreature spells from the top of your library')) {
    return { noncreatureOnly: true };
  }

  const tribalMatch = text.match(/cast ([a-z]+) spells from the top of your library/);
  if (tribalMatch) {
    const tribe = String(tribalMatch[1] || '').trim().toLowerCase();
    const knownTypes = new Set([
      'creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle',
    ]);
    if (tribe && !knownTypes.has(tribe)) {
      return { tribalSpellFilter: tribe };
    }
  }

  if (hasGenericTopLibrarySpellPermissionText(text)) {
    return { unrestricted: true };
  }

  return null;
}

function topLibraryCastRestrictionMatchesCard(
  restriction: ParsedTopLibraryCastRestriction,
  typeLine: string,
  card: TopOfLibraryCardInput | undefined,
  sourceName: string,
  restrictions: string[],
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
    if (!typeMatches) {
      restrictions.push(`${sourceName} only allows: ${restriction.castTypes.join(', ')}`);
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
    
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = String(perm.card?.oracle_text || '').toLowerCase();
    let matched = false;
    
    for (const [knownName, effect] of Object.entries(TOP_OF_LIBRARY_CARDS)) {
      if (cardName.includes(knownName) && effect.lookAtTop) {
        sources.push(perm.card?.name || knownName);
        matched = true;
        break;
      }
    }

    if (!matched && hasGenericTopLibraryLookPermissionText(oracleText)) {
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
    
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = String(perm.card?.oracle_text || '').toLowerCase();
    let matched = false;
    
    for (const [knownName, effect] of Object.entries(TOP_OF_LIBRARY_CARDS)) {
      if (cardName.includes(knownName) && effect.playLandsFromTop) {
        sources.push(perm.card?.name || knownName);
        matched = true;
        break;
      }
    }

    if (!matched && hasGenericTopLibraryLandPermissionText(oracleText)) {
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
    
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = String(perm.card?.oracle_text || '').toLowerCase();
    let matched = false;
    
    for (const [knownName, effect] of Object.entries(TOP_OF_LIBRARY_CARDS)) {
      if (cardName.includes(knownName) && effect.castFromTop) {
        if (!hasCardContext) {
          sources.push(perm.card?.name || knownName);
          if (effect.grantsFlash) {
            flashSources.push(perm.card?.name || knownName);
          }
          matched = true;
          break;
        }

        let matchedRestriction = false;

        // Check type restrictions
        if (effect.castTypes && effect.castTypes.length > 0) {
          const typeMatches = effect.castTypes.some(t => typeLine.includes(t));
          if (typeMatches) {
            matchedRestriction = true;
          } else if (!(effect.allowColorlessNonland && isColorlessNonland)) {
            restrictions.push(`${perm.card?.name || knownName} only allows: ${effect.castTypes.join(', ')}`);
            continue;
          }
        }

        if (effect.allowColorlessNonland && isColorlessNonland) {
          matchedRestriction = true;
        }

        if (effect.noncreatureOnly) {
          if (typeLine.includes('creature')) {
            restrictions.push(`${perm.card?.name || knownName} only allows noncreature spells`);
            continue;
          }
          matchedRestriction = true;
        }

        if (!effect.castTypes?.length && !effect.noncreatureOnly && !effect.allowColorlessNonland) {
          matchedRestriction = true;
        }

        if (!matchedRestriction) {
          continue;
        }
        
        // Check creature type filter (e.g., Conspicuous Snoop for Goblins)
        if (effect.creatureTypeFilter && typeLine.includes('creature')) {
          if (!typeLine.includes(effect.creatureTypeFilter)) {
            restrictions.push(`${perm.card?.name || knownName} only allows ${effect.creatureTypeFilter} creatures`);
            continue;
          }
        }

        if (effect.tribalSpellFilter) {
          if (!typeLine.includes(effect.tribalSpellFilter)) {
            restrictions.push(`${perm.card?.name || knownName} only allows ${effect.tribalSpellFilter} spells`);
            continue;
          }
        }

        if (effect.chosenTypeCastFromTop) {
          const chosenType = String((perm as any).chosenCreatureType || '').trim().toLowerCase();
          if (!chosenType) {
            restrictions.push(`${perm.card?.name || knownName}: no creature type chosen`);
            continue;
          }
          if (hasCardContext && (!typeLine.includes('creature') || !cardHasCreatureType(card, chosenType))) {
            restrictions.push(`${perm.card?.name || knownName} only allows ${chosenType} creature spells from the top of your library`);
            continue;
          }
        }
        
        // Check condition (e.g., coven for Augur of Autumn)
        if (effect.conditionCheck === 'coven') {
          if (!hasCoven(ctx, playerId)) {
            restrictions.push(`${perm.card?.name || knownName} requires coven (3 creatures with different powers)`);
            continue;
          }
        }
        
        sources.push(perm.card?.name || knownName);
        if (effect.grantsFlash) {
          flashSources.push(perm.card?.name || knownName);
        }
        matched = true;
        break;
      }
    }

    if (!matched && oracleText.includes('cast creature spells of the chosen type from the top of your library')) {
      const chosenType = String((perm as any).chosenCreatureType || '').trim().toLowerCase();
      const sourceName = perm.card?.name || 'Permanent';
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
        const sourceName = perm.card?.name || 'Top-of-library effect';
        if (topLibraryCastRestrictionMatchesCard(parsedRestriction, typeLine, card, sourceName, restrictions)) {
          sources.push(sourceName);
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
 * Known cards that reveal opponents' hands (static effects only)
 * Key: lowercase card name (partial match)
 * These cards have permanent effects like "Your opponents play with their hands revealed"
 * 
 * NOTE: One-shot effects (Thoughtseize, Duress, etc.) are NOT included here
 * as they don't provide ongoing hand visibility.
 */
const HAND_REVEAL_CARDS: string[] = [
  "telepathy",                    // "Your opponents play with their hands revealed."
  "glasses of urza",             // "Target player plays with their hand revealed"
  "revelation",                  // "Each player plays with their hand revealed."
  "zur's weirding",              // "Players play with their hands revealed."
  "wandering eye",               // "Each player plays with their hand revealed."
  "seer's vision",               // "Enchanted player plays with their hand revealed."
];

/**
 * Detect if a permanent grants hand visibility to its controller (sees opponents' hands)
 * Returns true if the permanent has a static effect that reveals opponents' hands
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
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = (perm.card?.oracle_text || "");
    const controller = perm.controller as PlayerID;
    
    // Check known cards first
    let hasRevealEffect = false;
    for (const knownName of HAND_REVEAL_CARDS) {
      if (cardName.includes(knownName)) {
        // Check if this is a static effect (not one-shot spells)
        const reveal = detectHandRevealEffect(oracleText);
        if (reveal.revealsOpponentsHands) {
          playersWithHandReveal.add(controller);
          hasRevealEffect = true;
          break;
        }
      }
    }
    
    // If not in known list, try dynamic detection
    if (!hasRevealEffect) {
      const reveal = detectHandRevealEffect(oracleText);
      if (reveal.revealsOpponentsHands) {
        playersWithHandReveal.add(controller);
      }
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

