// server/src/state/modules/zones.ts
// Zones module: handles libraries/hands/graveyards/exile, search/select, scry/surveil,
// shuffles/draws, hand reorder, and the server-authoritative applyPreGameReset helper.
//
// Exports a complete set of named helpers used throughout the server state surface.

import type { PlayerID, KnownCardRef } from "../../../../shared/src/types.js";
import type { GameContext } from "../context.js";
import { uid } from "../utils.js";
import { checkEmptyLibraryDraw, hasDrawWinReplacement, hasCantLoseEffect } from "./game-state-effects.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { ResolutionQueueManager } from "../resolution/index.js";
import { ResolutionStepType } from "../resolution/types.js";
import { recordCardPutIntoGraveyardThisTurn, recordPermanentPutIntoHandFromBattlefieldThisTurn } from "./turn-tracking.js";

/* ===== core zone operations ===== */

/**
 * importDeckResolved
 * Populate ctx.libraries[playerId] with resolved KnownCardRef objects.
 * Clears all existing zones (hand, graveyard, exile, commander zone) for a clean import.
 */
export function importDeckResolved(
  ctx: GameContext,
  playerId: PlayerID,
  cards: Array<
    Pick<
      KnownCardRef,
      "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness" | "card_faces" | "layout" | "loyalty"
    > & { color_identity?: string[] }
  >
) {
  const { libraries, state, bumpSeq } = ctx as any;
  const zones = state.zones = state.zones || {};
  
  debug(2, `[importDeckResolved] Importing ${cards.length} cards for player ${playerId}`);
  
  // Clear all existing zones for this player to ensure clean deck import
  // This prevents issues with loading a new deck over an existing one
  zones[playerId] = {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
  
  // Clear commander zone if it exists
  if (state.commandZone && state.commandZone[playerId]) {
    state.commandZone[playerId] = {
      commanderIds: [],
      commanderCards: [],
    };
  }
  
  // Clear battlefield of player's permanents
  if (Array.isArray(state.battlefield)) {
    state.battlefield = state.battlefield.filter((p: any) => 
      p.controller !== playerId && p.owner !== playerId
    );
  }
  
  // Now import the new deck
  const mappedCards = cards.map((c) => ({
    id: c.id,
    name: c.name,
    type_line: c.type_line,
    oracle_text: c.oracle_text,
    image_uris: c.image_uris,
    mana_cost: (c as any).mana_cost,
    cmc: (c as any).cmc, // Converted mana cost - needed for cost calculations
    power: (c as any).power,
    toughness: (c as any).toughness,
    loyalty: (c as any).loyalty, // Planeswalker starting loyalty - CRITICAL for planeswalkers
    card_faces: (c as any).card_faces,
    layout: (c as any).layout,
    color_identity: (c as any).color_identity,
    colors: (c as any).colors, // Card colors - needed for color detection
    zone: "library",
  }));
  
  debug(2, `[importDeckResolved] Mapped ${mappedCards.length} cards. First card: ${mappedCards[0]?.name} (${mappedCards[0]?.id})`);
  
  libraries.set(playerId, mappedCards);
  const libLen = libraries.get(playerId)?.length ?? 0;
  zones[playerId]!.libraryCount = libLen;
  
  debug(2, `[importDeckResolved] Library set for player ${playerId}. Final library size: ${libLen}`);
  
  bumpSeq();
}

/**
 * shuffleLibrary
 */
export function shuffleLibrary(ctx: GameContext, playerId: PlayerID) {
  const lib = ctx.libraries.get(playerId) || [];
  for (let i = lib.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [lib[i], lib[j]] = [lib[j], lib[i]];
  }
  ctx.libraries.set(playerId, lib);
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  ctx.bumpSeq();
}

/**
 * drawCards
 * 
 * Draws cards from the library into the player's hand.
 * Also tracks first draw of the turn for miracle abilities and triggers draw effects.
 * Handles empty library draw according to Rule 704.5b:
 * - If a player attempts to draw from an empty library, they lose the game
 * - Unless they have Laboratory Maniac/Jace (win instead) or Platinum Angel (can't lose)
 * 
 * @param ctx Game context
 * @param playerId Player drawing the cards
 * @param count Number of cards to draw
 * @returns Object with drawn cards and any win/loss result
 */
export interface DrawResult {
  cards: KnownCardRef[];
  emptyLibraryAttempt: boolean;
  playerWins: boolean;
  playerLoses: boolean;
  reason?: string;
}

export function drawCards(ctx: GameContext, playerId: PlayerID, count: number): KnownCardRef[] {
  const lib = ctx.libraries.get(playerId) || [];
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  const drawn: KnownCardRef[] = [];
  
  // Track draws this turn for miracle abilities (Rule 702.94)
  (ctx.state as any).cardsDrawnThisTurn = (ctx.state as any).cardsDrawnThisTurn || {};
  const previousDrawCount = (ctx.state as any).cardsDrawnThisTurn[playerId] || 0;
  
  // Track if player attempted to draw from empty library
  let attemptedEmptyDraw = false;
  
  for (let i = 0; i < count; i++) {
    if (lib.length > 0) {
      const c = lib.shift()!;
      
      // Check if this is the first card drawn this turn (for miracle)
      const drawNumber = previousDrawCount + i + 1;
      if (drawNumber === 1) {
        // Mark this card as the first card drawn this turn
        (c as any).isFirstDrawnThisTurn = true;
        (c as any).drawnAt = Date.now();
      }
      
      (z.hand as any[]).push(c);
      drawn.push(c);
    } else {
      // Attempted to draw from empty library (Rule 704.5b)
      attemptedEmptyDraw = true;
      debug(2, `[drawCards] Player ${playerId} attempted to draw from empty library`);
      break; // Stop trying to draw more cards
    }
  }
  
  // Update draw count for this turn
  (ctx.state as any).cardsDrawnThisTurn[playerId] = previousDrawCount + drawn.length;
  
  ctx.libraries.set(playerId, lib);
  z.handCount = (z.hand as any[]).length;
  z.libraryCount = lib.length;
  
  // Process draw triggers (Psychosis Crawler, etc.)
  if (drawn.length > 0) {
    processDrawTriggers(ctx, playerId, drawn.length);
  }
  
  // Handle empty library draw (Rule 704.5b)
  if (attemptedEmptyDraw) {
    // Check for win/lose replacement effects
    const result = checkEmptyLibraryDraw(ctx, playerId);
    
    if (result.wins) {
      debug(2, `[drawCards] Player ${playerId} WINS: ${result.reason}`);
      
      // Mark the game as won
      (ctx.state as any).gameOver = true;
      (ctx.state as any).winner = playerId;
      (ctx.state as any).winReason = result.reason;
    } else if (result.loses) {
      debug(2, `[drawCards] Player ${playerId} LOSES: ${result.reason}`);
      
      // Track that this player attempted to draw from empty library
      // State-based actions will check this
      (ctx.state as any).attemptedEmptyLibraryDraw = (ctx.state as any).attemptedEmptyLibraryDraw || {};
      (ctx.state as any).attemptedEmptyLibraryDraw[playerId] = true;
    } else {
      // Can't lose the game (Platinum Angel, etc.)
      debug(2, `[drawCards] Player ${playerId} attempted empty library draw but can't lose: ${result.reason}`);
    }
  }
  
  ctx.bumpSeq();
  return drawn;
}

/**
 * Process draw triggers - called when a player draws cards
 * Handles:
 * - Psychosis Crawler: "Whenever you draw a card, each opponent loses 1 life"
 * - Niv-Mizzet: "Whenever you draw a card, deal 1 damage to any target"
 */
function processDrawTriggers(ctx: GameContext, drawingPlayerId: PlayerID, cardsDrawn: number) {
  const battlefield = ctx.state.battlefield || [];
  const players = (ctx.state as any).players || [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const permName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // Psychosis Crawler: "Whenever you draw a card, each opponent loses 1 life"
    if ((permName.includes('psychosis crawler') || 
         (oracleText.includes('whenever you draw a card') && oracleText.includes('each opponent loses'))) &&
        perm.controller === drawingPlayerId) {
      for (const player of players) {
        if (player.id !== drawingPlayerId && (ctx as any).life) {
          (ctx as any).life[player.id] = ((ctx as any).life[player.id] ?? 40) - cardsDrawn;

          // Track life lost this turn.
          try {
            (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
            (ctx.state as any).lifeLostThisTurn[player.id] = ((ctx.state as any).lifeLostThisTurn[player.id] || 0) + cardsDrawn;
          } catch {}

          debug(1, `[drawTrigger] Psychosis Crawler: ${player.name || player.id} lost ${cardsDrawn} life`);
        }
      }
    }
    
    // Niv-Mizzet: triggers for damage (would need stack implementation for targeting)
    if (permName.includes('niv-mizzet') && 
        oracleText.includes('whenever you draw') && 
        perm.controller === drawingPlayerId) {
      debug(2, `[drawTrigger] Niv-Mizzet: ${cardsDrawn} damage trigger(s)`);
    }
  }
}

/**
 * moveHandToLibrary: Move the player's whole hand onto top of library
 */
export function moveHandToLibrary(ctx: GameContext, playerId: PlayerID) {
  const zones = ctx.state.zones || {};
  const z = zones[playerId];
  if (!z) return 0;
  const hand = (z.hand as any[]) || [];
  const lib = ctx.libraries.get(playerId) || [];
  while (hand.length) {
    const c = hand.shift()!;
    lib.unshift(c);
  }
  ctx.libraries.set(playerId, lib);
  z.hand = [];
  z.handCount = 0;
  z.libraryCount = lib.length;
  ctx.bumpSeq();
  return z.handCount;
}

/**
 * shuffleHand
 */
export function shuffleHand(ctx: GameContext, playerId: PlayerID) {
  const zones = ctx.state.zones || {};
  const z = zones[playerId];
  if (!z) return;
  const hand = (z.hand as any[]) || [];
  for (let i = hand.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [hand[i], hand[j]] = [hand[j], hand[i]];
  }
  z.hand = hand as any;
  z.handCount = hand.length;
  ctx.bumpSeq();
}

/**
 * peekTopN: non-mutating snapshot of top N of library
 */
export function peekTopN(ctx: GameContext, playerId: PlayerID, n: number) {
  const lib = ctx.libraries.get(playerId) || [];
  return lib.slice(0, Math.max(0, n | 0)).map((c) => ({
    id: c.id,
    name: c.name,
    type_line: c.type_line,
    oracle_text: c.oracle_text,
    image_uris: (c as any).image_uris,
    card_faces: (c as any).card_faces,
    layout: (c as any).layout,
  }));
}

/* ===== selection / movement helpers ===== */

/**
 * selectFromLibrary
 *
 * Remove card(s) with given ids from player's library and move them to a zone.
 * - moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield'
 * Returns array of moved KnownCardRef objects (for non-battlefield) or ids moved.
 */
export function selectFromLibrary(ctx: GameContext, playerId: PlayerID, cardIds: string[], moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield') {
  const lib = ctx.libraries.get(playerId) || [];
  if (!Array.isArray(cardIds)) cardIds = [];

  const byId = new Map<string, KnownCardRef>();
  // extract matching cards from library
  for (let i = lib.length - 1; i >= 0; i--) {
    const c = lib[i] as any;
    if (cardIds.includes(c?.id)) {
      const [removed] = lib.splice(i, 1);
      byId.set(removed.id, removed);
    }
  }

  ctx.libraries.set(playerId, lib);

  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  const moved: KnownCardRef[] = [];

  for (const id of cardIds) {
    const c = byId.get(id);
    if (!c) continue;
    if (moveTo === 'hand') {
      (z.hand as any[]).push({ ...c, zone: 'hand' });
      moved.push(c);
    } else if (moveTo === 'graveyard') {
      (z as any).graveyard = (z as any).graveyard || [];
      (z as any).graveyard.push({ ...c, zone: 'graveyard', faceDown: false });
      recordCardPutIntoGraveyardThisTurn(ctx, String(playerId), c, { fromBattlefield: false });
      moved.push(c);
    } else if (moveTo === 'exile') {
      (z as any).exile = (z as any).exile || [];
      (z as any).exile.push({ ...c, zone: 'exile', faceDown: false });
      moved.push(c);
    } else if (moveTo === 'battlefield') {
      // caller should convert these to permanents; return minimal objects
      moved.push({ id: c.id, name: c.name } as any);
    }
  }

  // update counts
  z.handCount = (z.hand as any[]).length;
  (z as any).graveyardCount = ((z as any).graveyard || []).length;
  (z as any).libraryCount = lib.length;

  ctx.bumpSeq();

  return moved;
}

/**
 * reorderHand: reorder the player's hand according to index array
 */
export function reorderHand(ctx: GameContext, playerId: PlayerID, order: number[]) {
  const zones = ctx.state.zones || {};
  const z = zones[playerId];
  if (!z) return false;
  const hand = (z.hand as any[]) || [];
  const n = hand.length;
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Set<number>();
  for (const v of order) {
    if (typeof v !== "number" || v < 0 || v >= n || seen.has(v)) return false;
    seen.add(v);
  }
  const next: any[] = new Array(n);
  for (let i = 0; i < n; i++) next[i] = hand[order[i]];
  z.hand = next as any;
  z.handCount = next.length;
  ctx.bumpSeq();
  return true;
}

/* ===== scry / surveil helpers ===== */

export function applyScry(ctx: GameContext, playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) {
  const lib = ctx.libraries.get(playerId) || [];
  if (!Array.isArray(keepTopOrder)) keepTopOrder = [];
  if (!Array.isArray(bottomOrder)) bottomOrder = [];
  if (keepTopOrder.length + bottomOrder.length === 0) return;
  const byId = new Map<string, any>();
  for (const id of [...keepTopOrder, ...bottomOrder]) {
    const idx = lib.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const [c] = lib.splice(idx, 1);
      byId.set(id, c);
    }
  }
  for (const id of bottomOrder) {
    const c = byId.get(id);
    if (c) lib.push({ ...c, zone: "library" });
  }
  for (let i = keepTopOrder.length - 1; i >= 0; i--) {
    const id = keepTopOrder[i];
    const c = byId.get(id);
    if (c) lib.unshift({ ...c, zone: "library" });
  }
  const zones = ctx.state.zones = ctx.state.zones || {};
  zones[playerId] = zones[playerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  } as any;
  zones[playerId]!.libraryCount = lib.length;
  ctx.libraries.set(playerId, lib);
  ctx.bumpSeq();
}

export function applySurveil(ctx: GameContext, playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) {
  const lib = ctx.libraries.get(playerId) || [];
  if (!Array.isArray(toGraveyard)) toGraveyard = [];
  if (!Array.isArray(keepTopOrder)) keepTopOrder = [];
  if (toGraveyard.length + keepTopOrder.length === 0) return;
  const byId = new Map<string, any>();
  for (const id of [...toGraveyard, ...keepTopOrder]) {
    const idx = lib.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const [c] = lib.splice(idx, 1);
      byId.set(id, c);
    }
  }
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z =
    zones[playerId] ||
    (zones[playerId] = {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
    } as any);
  (z as any).graveyard = (z as any).graveyard || [];
  for (const id of toGraveyard) {
    const c = byId.get(id);
    if (c) {
      (z as any).graveyard.push({ ...c, zone: "graveyard", faceDown: false });
      recordCardPutIntoGraveyardThisTurn(ctx, String(playerId), c, { fromBattlefield: false });
    }
  }
  (z as any).graveyardCount = ((z as any).graveyard || []).length;
  for (let i = keepTopOrder.length - 1; i >= 0; i--) {
    const id = keepTopOrder[i];
    const c = byId.get(id);
    if (c) lib.unshift({ ...c, zone: "library" });
  }
  (z as any).libraryCount = lib.length;
  ctx.libraries.set(playerId, lib);
  ctx.bumpSeq();
}

/**
 * applyExplore
 * Rule 701.44: A permanent explores. Reveal top card of library.
 * - If land: put in hand
 * - If not land: put +1/+1 counter on the exploring permanent, 
 *   and you may put the revealed card into graveyard (else leave on top)
 */
export function applyExplore(
  ctx: GameContext,
  playerId: PlayerID,
  permanentId: string,
  revealedCardId: string,
  isLand: boolean,
  toGraveyard: boolean
): void {
  const lib = ctx.libraries.get(playerId) || [];
  if (lib.length === 0) return;
  
  // Find the revealed card at top of library
  const topCard = lib[0];
  if (!topCard || topCard.id !== revealedCardId) {
    // Card mismatch - state has changed, ignore
    return;
  }
  
  // Remove from top of library
  lib.shift();
  
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  } as any);
  
  if (isLand) {
    // Land goes to hand
    (z as any).hand = (z as any).hand || [];
    (z as any).hand.push({ ...topCard, zone: "hand", faceDown: false });
    (z as any).handCount = ((z as any).hand || []).length;
  } else {
    // Not a land - add +1/+1 counter to exploring permanent
    const battlefield = ctx.state.battlefield || [];
    const perm = battlefield.find((p: any) => p.id === permanentId && p.controller === playerId);
    if (perm) {
      // Create a mutable copy of counters to avoid modifying readonly object
      const newCounters = { ...(perm.counters || {}) };
      newCounters["+1/+1"] = (newCounters["+1/+1"] || 0) + 1;
      (perm as any).counters = newCounters;
    }
    
    if (toGraveyard) {
      // Put revealed card in graveyard
      (z as any).graveyard = (z as any).graveyard || [];
      (z as any).graveyard.push({ ...topCard, zone: "graveyard", faceDown: false });
      recordCardPutIntoGraveyardThisTurn(ctx, String(playerId), topCard, { fromBattlefield: false });
      (z as any).graveyardCount = ((z as any).graveyard || []).length;
    }
    // If not toGraveyard, card is already removed from library top and we just
    // don't add it back - wait, that's wrong. It should stay on top if not to graveyard.
    // Let me fix this: if not toGraveyard, put it back on top
    if (!toGraveyard) {
      lib.unshift({ ...topCard, zone: "library" });
    }
  }
  
  (z as any).libraryCount = lib.length;
  ctx.libraries.set(playerId, lib);
  ctx.bumpSeq();
}

/* ===== search helper ===== */

/**
 * searchLibrary
 * Simple substring search by card name within the player's library. Case-insensitive.
 * Returns up to `limit` simplified KnownCardRef-like objects.
 */
export function searchLibrary(ctx: GameContext, playerId: PlayerID, query: string, limit = 20) {
  const lib = ctx.libraries.get(playerId) || [];
  if (!query || typeof query !== "string") {
    return lib.slice(0, Math.max(0, limit)).map(c => ({ 
      id: c.id, 
      name: c.name, 
      type_line: c.type_line, 
      oracle_text: c.oracle_text, 
      image_uris: (c as any).image_uris, 
      card_faces: (c as any).card_faces, 
      layout: (c as any).layout,
      mana_cost: (c as any).mana_cost,
      cmc: (c as any).cmc,
      colors: (c as any).colors,
      power: (c as any).power,
      toughness: (c as any).toughness,
      loyalty: (c as any).loyalty,
      color_identity: (c as any).color_identity,
    }));
  }
  const q = query.trim().toLowerCase();
  const res: any[] = [];
  for (const c of lib) {
    if (res.length >= limit) break;
    const name = (c.name || "").toLowerCase();
    if (name.includes(q)) {
      res.push({ 
        id: c.id, 
        name: c.name, 
        type_line: c.type_line, 
        oracle_text: c.oracle_text, 
        image_uris: (c as any).image_uris, 
        card_faces: (c as any).card_faces, 
        layout: (c as any).layout,
        mana_cost: (c as any).mana_cost,
        cmc: (c as any).cmc,
        colors: (c as any).colors,
        power: (c as any).power,
        toughness: (c as any).toughness,
        loyalty: (c as any).loyalty,
        color_identity: (c as any).color_identity,
      });
    }
  }
  return res;
}

/**
 * putCardsOnTopOfLibrary
 * Adds card objects to the top of the player's library.
 * Used for effects like "search your library, shuffle, then put the card on top"
 * (e.g., Vampiric Tutor, Mystical Tutor).
 * Also useful for Chaos Warp (shuffle permanent into library, then reveal top).
 * 
 * @param cards - Array of card objects to put on top (in order, first card will be on top)
 */
export function putCardsOnTopOfLibrary(ctx: GameContext, playerId: PlayerID, cards: any[]) {
  if (!Array.isArray(cards) || cards.length === 0) return;
  
  const lib = ctx.libraries.get(playerId) || [];
  
  // Add cards to the top of the library (first card in array = top of library)
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i];
    lib.unshift({ ...card, zone: 'library' });
  }
  
  ctx.libraries.set(playerId, lib);
  
  // Update library count
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  
  ctx.bumpSeq();
}

/**
 * putCardsOnBottomOfLibrary
 * Adds card objects to the bottom of the player's library.
 * Used for effects like Condemn (put attacking creature on bottom of owner's library).
 * 
 * @param cards - Array of card objects to put on bottom
 */
export function putCardsOnBottomOfLibrary(ctx: GameContext, playerId: PlayerID, cards: any[]) {
  if (!Array.isArray(cards) || cards.length === 0) return;
  
  const lib = ctx.libraries.get(playerId) || [];
  
  // Add cards to the bottom of the library
  for (const card of cards) {
    lib.push({ ...card, zone: 'library' });
  }
  
  ctx.libraries.set(playerId, lib);
  
  // Update library count
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  
  ctx.bumpSeq();
}

/**
 * putCardAtPositionInLibrary
 * Inserts a card at a specific position in the player's library.
 * Used for effects like Approach of the Second Sun (put 7th from top when cast from hand).
 * 
 * @param card - Card object to insert
 * @param position - 0-indexed position from top (0 = top, 6 = 7th from top)
 */
export function putCardAtPositionInLibrary(ctx: GameContext, playerId: PlayerID, card: any, position: number) {
  if (!card) return;
  
  const lib = ctx.libraries.get(playerId) || [];
  
  // Clamp position to valid range
  const insertAt = Math.max(0, Math.min(position, lib.length));
  
  // Insert card at the specified position
  lib.splice(insertAt, 0, { ...card, zone: 'library' });
  
  ctx.libraries.set(playerId, lib);
  
  // Update library count
  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  
  ctx.bumpSeq();
}

/**
 * movePermanentToLibrary
 * Moves a permanent from battlefield to owner's library (top, bottom, or shuffled).
 * Handles Commander Replacement Effect (Rule 903.9a) - offers choice to put in command zone instead.
 * 
 * @param permanentId - ID of the permanent to move
 * @param position - 'top', 'bottom', or 'shuffle'
 * @returns true if moved (or deferred for commander choice), false if permanent not found
 */
export function movePermanentToLibrary(
  ctx: GameContext, 
  permanentId: string, 
  position: 'top' | 'bottom' | 'shuffle' = 'shuffle'
): boolean {
  const { state, bumpSeq, commandZone, libraries } = ctx;
  const battlefield = state.battlefield || [];
  
  const idx = battlefield.findIndex((p: any) => p.id === permanentId);
  if (idx < 0) return false;
  
  const perm = battlefield.splice(idx, 1)[0];
  const owner = perm.owner as PlayerID;
  const card = perm.card;

  // Revolt-style per-turn tracking: a permanent left the battlefield under its controller's control.
  try {
    const controllerAtLeave = String((perm as any)?.controller || owner || '').trim();
    if (controllerAtLeave) {
      (state as any).permanentLeftBattlefieldThisTurn = (state as any).permanentLeftBattlefieldThisTurn || {};
      (state as any).permanentLeftBattlefieldThisTurn[controllerAtLeave] = true;
    }
  } catch {
    // best-effort only
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into its owner's library from anywhere,
  // its owner may put it into the command zone instead.
  const commanderInfo = (commandZone as any)?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = (card?.id && commanderIds.includes(card.id)) || (perm as any).isCommander === true;
  
  if (isCommander && card) {
    // Cast card as any to access properties safely
    const cardAny = card as any;
    // Defer zone change - let player choose command zone or library via Resolution Queue
    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.COMMANDER_ZONE_CHOICE,
      playerId: owner,
      sourceId: permanentId,
      sourceName: cardAny.name || 'Unknown Commander',
      description: `Your commander ${cardAny.name || 'Unknown Commander'} would be put into your library (${position}). Move it to the command zone instead?`,
      mandatory: true,
      commanderId: cardAny.id,
      commanderName: cardAny.name || 'Unknown Commander',
      fromZone: 'library',
      libraryPosition: position,
      card: {
        id: cardAny.id,
        name: cardAny.name || 'Unknown Commander',
        type_line: cardAny.type_line,
        oracle_text: cardAny.oracle_text,
        image_uris: cardAny.image_uris,
        mana_cost: cardAny.mana_cost,
        power: cardAny.power,
        toughness: cardAny.toughness,
      } as any,
    } as any);
    debug(2, `[movePermanentToLibrary] Commander ${cardAny.name || 'Unknown'} would go to library (${position}) - queued commander zone choice step`);
    bumpSeq();
    return true;
  }
  
  // Non-commander - move directly to library
  const lib = libraries.get(owner) || [];
  const cardCopy = { ...(card as any), zone: 'library' };
  
  if (position === 'top') {
    lib.unshift(cardCopy);
  } else if (position === 'bottom') {
    lib.push(cardCopy);
  } else {
    // Shuffle into library using deterministic RNG
    lib.push(cardCopy);
    for (let i = lib.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      [lib[i], lib[j]] = [lib[j], lib[i]];
    }
  }
  
  libraries.set(owner, lib);
  
  // Update library count
  const zones = state.zones = state.zones || {};
  const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  
  debug(2, `[movePermanentToLibrary] ${(card as any)?.name || permanentId} put ${position} of ${owner}'s library`);
  bumpSeq();
  return true;
}

/**
 * movePermanentToHand
 * Moves a permanent from battlefield to owner's hand (bounce effect).
 * Handles Commander Replacement Effect (Rule 903.9a) - offers choice to put in command zone instead.
 * 
 * @param permanentId - ID of the permanent to move
 * @returns true if moved (or deferred for commander choice), false if permanent not found
 */
export function movePermanentToHand(ctx: GameContext, permanentId: string): boolean {
  const { state, bumpSeq, commandZone } = ctx;
  const battlefield = state.battlefield || [];
  
  const idx = battlefield.findIndex((p: any) => p.id === permanentId);
  if (idx < 0) return false;
  
  const perm = battlefield.splice(idx, 1)[0];
  const owner = perm.owner as PlayerID;
  const card = perm.card;

  // Revolt-style per-turn tracking: a permanent left the battlefield under its controller's control.
  try {
    const controllerAtLeave = String((perm as any)?.controller || owner || '').trim();
    if (controllerAtLeave) {
      (state as any).permanentLeftBattlefieldThisTurn = (state as any).permanentLeftBattlefieldThisTurn || {};
      (state as any).permanentLeftBattlefieldThisTurn[controllerAtLeave] = true;
    }
  } catch {
    // best-effort only
  }

  // Tokens cease to exist when they leave the battlefield (Rule 111.7).
  if ((perm as any).isToken === true) {
    debug(2, `[movePermanentToHand] Token ${card?.name || permanentId} left battlefield -> ceased to exist (not moved to hand)`);
    bumpSeq();
    return true;
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into its owner's hand from anywhere,
  // its owner may put it into the command zone instead.
  const commanderInfo = (commandZone as any)?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = (card?.id && commanderIds.includes(card.id)) || (perm as any).isCommander === true;
  
  if (isCommander && card) {
    // Defer zone change - let player choose command zone or hand
    // Defer zone change - let player choose command zone or hand via Resolution Queue
    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.COMMANDER_ZONE_CHOICE,
      playerId: owner,
      sourceId: permanentId,
      sourceName: card.name,
      description: `Your commander ${card.name} would be returned to your hand. Move it to the command zone instead?`,
      mandatory: true,
      commanderId: card.id,
      commanderName: card.name,
      fromZone: 'hand',
      card: {
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        mana_cost: card.mana_cost,
        power: card.power,
        toughness: card.toughness,
      } as any,
    } as any);
    debug(2, `[movePermanentToHand] Commander ${card.name} would go to hand - queued commander zone choice step`);
    bumpSeq();
    return true;
  }
  
  // Non-commander - move directly to hand
  const zones = state.zones = state.zones || {};
  const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.hand = z.hand || [];
  z.hand.push({ ...card, zone: 'hand' });
  z.handCount = z.hand.length;

  recordPermanentPutIntoHandFromBattlefieldThisTurn(ctx, String(owner));
  
  debug(2, `[movePermanentToHand] ${card?.name || permanentId} returned to ${owner}'s hand`);
  bumpSeq();
  return true;
}

/* ===== consistency helper (exported) ===== */

export function reconcileZonesConsistency(ctx: GameContext, playerId?: PlayerID) {
  const players: PlayerID[] =
    typeof playerId !== "undefined"
      ? [playerId]
      : ((ctx.state.players as any as { id: PlayerID }[]) || []).map((p) => p.id);

  const zones = ctx.state.zones = ctx.state.zones || {};
  
  for (const pid of players) {
    try {
      if (!zones[pid]) {
        zones[pid] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any;
      }
      const z = zones[pid] as any;

      if (!ctx.libraries.has(pid)) ctx.libraries.set(pid, []);
      const lib = ctx.libraries.get(pid) || [];

      // normalize library entries
      for (let i = 0; i < lib.length; i++) {
        const entry = lib[i] as any;
        if (!entry || typeof entry !== "object") {
          lib[i] = { id: String(entry ?? uid("c")), zone: "library" } as any;
        } else {
          if (!("id" in entry)) entry.id = uid("c");
          if (!("zone" in entry)) entry.zone = "library";
        }
      }

      z.hand = z.hand || [];
      z.graveyard = z.graveyard || [];
      z.exile = z.exile || [];

      z.handCount = (z.hand as any[]).length;
      z.graveyardCount = (z.graveyard as any[]).length;
      z.libraryCount = lib.length;

      ctx.libraries.set(pid, lib);
      // Do not bump seq automatically for silent repairs to avoid noisy diffs; callers may bump if they need visible change.
    } catch (err) {
      debugWarn(1, "reconcileZonesConsistency failed for player", pid, err);
    }
  }
}

/* ===== NEW: apply per-player PRE_GAME reset (wipe + reset defaults) ===== */

/**
 * applyPreGameReset(ctx, playerId)
 *
 * Authoritative server-side routine to wipe a player's current in-game assets and
 * reset to pre-game defaults, preserving the player's resolved library (import buffer)
 * that was placed by importDeckResolved or stored in _lastImportedDecks.
 */
export function applyPreGameReset(ctx: GameContext, playerId: PlayerID) {
  const { state, libraries, bumpSeq, life, poison, experience, commandZone } = ctx as any;
  const zones = state.zones = state.zones || {};

  // If libraries map doesn't contain the imported deck but an import buffer exists, use it.
  try {
    const hasLib = libraries && (typeof libraries.get === "function") && Array.isArray(libraries.get(playerId)) && (libraries.get(playerId).length > 0);
    if (!hasLib && (ctx as any)._lastImportedDecks && typeof (ctx as any)._lastImportedDecks.get === "function") {
      const buf = (ctx as any)._lastImportedDecks.get(playerId);
      if (Array.isArray(buf) && buf.length > 0) {
        // populate libraries with a shallow copy to avoid aliasing buffers
        libraries.set(playerId, buf.map((c: any) => ({ ...c, zone: "library" })));
      }
    }
  } catch (err) {
    // ignore; proceed with whatever libraries currently hold
  }

  // Remove battlefield permanents controlled by playerId
  if (Array.isArray(state.battlefield)) {
    state.battlefield = state.battlefield.filter((p: any) => p.controller !== playerId);
  }

  // Reset zones: clear hand, graveyard, exile; library is preserved (importDeckResolved or buffer set it)
  const lib = libraries.get(playerId) || [];
  zones[playerId] = {
    hand: [],
    handCount: 0,
    libraryCount: lib.length,
    graveyard: [],
    graveyardCount: 0,
    exile: []
  } as any;

  // Reset life and counters to defaults
  const starting = state.startingLife ?? 40;
  life[playerId] = starting;
  poison[playerId] = 0;
  experience[playerId] = 0;
  
  // Reset energy counters
  const energy = (ctx as any).energy = (ctx as any).energy || {};
  energy[playerId] = 0;

  // Ensure commandZone entry exists (create an empty holder instead of deleting)
  if (!commandZone) (ctx as any).commandZone = {};
  commandZone[playerId] = {
    commanderIds: (commandZone[playerId] && commandZone[playerId].commanderIds) || [],
    commanderCards: (commandZone[playerId] && commandZone[playerId].commanderCards) || null,
  };

  // Reset any lands played this turn / mana pools if stored on ctx (conservative)
  if ((ctx as any).landsPlayedThisTurn) {
    (ctx as any).landsPlayedThisTurn[playerId] = 0;
  }
  if ((ctx as any).manaPool && (ctx as any).manaPool[playerId]) {
    (ctx as any).manaPool[playerId] = { white:0, blue:0, black:0, red:0, green:0, colorless:0, generic:0 };
  }

  // Set global phase to pre_game (authoritative)
  (state as any).phase = "pre_game";

  // ensure consistency and bump sequence
  reconcileZonesConsistency(ctx, playerId);
  bumpSeq();
}

/* Export default convenience object for legacy callers */
export default {
  importDeckResolved,
  moveHandToLibrary,
  shuffleLibrary,
  drawCards,
  shuffleHand,
  peekTopN,
  selectFromLibrary,
  reorderHand,
  applyScry,
  applySurveil,
  applyExplore,
  searchLibrary,
  putCardsOnTopOfLibrary,
  putCardsOnBottomOfLibrary,
  putCardAtPositionInLibrary,
  reconcileZonesConsistency,
  applyPreGameReset
};
