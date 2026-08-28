// server/src/state/modules/zones.ts
// Zones module: handles libraries/hands/graveyards/exile, search/select, scry/surveil,
// shuffles/draws, hand reorder, and the server-authoritative applyPreGameReset helper.
//
// Exports a complete set of named helpers used throughout the server state surface.

import type { PlayerID, KnownCardRef } from "../../../../shared/src/types.js";
import { buildZoneObjectWithRetainedCounters } from "../../../../shared/src/zoneRetainedCounters.js";
import type { GameContext } from "../context.js";
import { uid } from "../utils.js";
import { applyEmptyLibraryDrawConsequences } from "./game-state-effects.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager } from "../resolution/index.js";
import { ResolutionStepType } from "../resolution/types.js";
import { recordCardPutIntoGraveyardThisTurn, recordPermanentPutIntoHandFromBattlefieldThisTurn } from "./turn-tracking.js";
import { cleanupCardLeavingExile } from "./playable-from-exile.js";
import { clearPreparedPermanent } from "./prepared.js";
import { pushCardToGraveyardFromLibrary } from "./graveyardEntryUtils.js";
import { processLinkedExileReturns } from "./triggers/linked-exile.js";
import { queueExiledFromBattlefieldTriggers } from "./triggers/zone-change.js";
import {
  processLTBTriggers,
  processReturnedToHandTriggers,
} from "./triggerEmissionFamilyUtils.js";
import { getCardDrawTriggers } from "./triggers/card-draw.js";
import { getMillTriggers } from "./triggers/mill.js";
import { orderTriggersByAPNAP } from "./triggers/ordering.js";
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from "./triggers/target-metadata.js";
import { evaluateDrawReplacementEvent } from "./replacement-effects.js";
import { summarizeDrawAmountReplacements } from "./replacementEffectSpec.js";
import {
  applyLeaveBattlefieldReplacementLifeGain,
  tryApplyDeclarativeLeaveBattlefieldDestinationReplacement,
} from "./zone-manipulation.js";
import { updateCounters } from "./counters_tokens.js";
import { revertCopyPermanentToOriginal } from "./permanent-copy.js";
import { repairAllDualZoneGhosts } from "./stackReplayUtils.js";

import { clearPreparedStateOnBattlefieldExit } from "./zones-handlers/zonesClearPreparedOnBattlefieldExit.js";

export { moveRemovedPermanentToExile } from "./zones-handlers/zonesMoveRemovedPermanentToExile.js";


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

  // If this player currently has any cards in true exile, ensure impulse-style permissions/tags
  // are cleaned up before we wipe zones for a fresh deck import.
  try {
    const prevExile = Array.isArray(zones?.[playerId]?.exile) ? (zones[playerId] as any).exile : [];
    for (const c of prevExile) cleanupCardLeavingExile(state, c);
    state.playableFromExile = state.playableFromExile || {};
    state.playableFromExile[playerId] = {};
  } catch {
    // ignore
  }
  
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

import {
  getOpponentsForPlayer,
  queueZursWeirdingOpponentStep,
  queueZursWeirdingDrawReplacementStep,
} from "./zones-handlers/zonesDrawReplacementZursQueue.js";

export interface ZursWeirdingDrawReplacementResult {
  applied: boolean;
  reason?: string;
  revealedCard?: any;
  drawnCards?: any[];
  milledCard?: any;
}

export function applyZursWeirdingOpponentChoice(ctx: GameContext, event: {
  drawingPlayerId: string;
  decidingOpponentId: string;
  opponentIndex: number;
  choiceId?: string;
  remainingDrawCountAfterChoice?: number;
  opponents?: string[];
}): ZursWeirdingDrawReplacementResult {
  const drawingPlayerId = String(event?.drawingPlayerId || '').trim() as PlayerID;
  const decidingOpponentId = String(event?.decidingOpponentId || '').trim();
  const choiceId = String(event?.choiceId || '').trim().toLowerCase();
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  const opponents = Array.isArray(event?.opponents) ? event.opponents.map((id) => String(id || '').trim()).filter(Boolean) : getOpponentsForPlayer(ctx.state, drawingPlayerId);
  const opponentIndex = Math.max(0, Math.floor(Number(event?.opponentIndex || 0)));

  if (!drawingPlayerId) return { applied: false, reason: 'missing_drawing_player' };

  const library = ctx.libraries.get(drawingPlayerId) || [];
  if (library.length === 0) return { applied: false, reason: 'empty_library' };

  const pending = (ctx.state as any).zursWeirdingPendingDraw;
  const revealedCard = pending?.revealedCard || library[0];

  if (choiceId === 'pay_2_life' || choiceId === 'pay') {
    const currentLife = Number((ctx.state as any)?.life?.[decidingOpponentId] ?? (ctx.state as any)?.startingLife ?? 40);
    if (currentLife < 2) return { applied: false, reason: 'insufficient_life' };

    (ctx.state as any).life = (ctx.state as any).life || {};
    (ctx.state as any).life[decidingOpponentId] = currentLife - 2;
    const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];
    const player = players.find((entry: any) => String(entry?.id || '') === decidingOpponentId);
    if (player) (player as any).life = currentLife - 2;
    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
    (ctx.state as any).lifeLostThisTurn[decidingOpponentId] =
      Number((ctx.state as any).lifeLostThisTurn[decidingOpponentId] || 0) + 2;

    const [milledCard] = library.splice(0, 1);
    const zones = ctx.state.zones = ctx.state.zones || {};
    const z = zones[drawingPlayerId] || (zones[drawingPlayerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
    z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
    const graveyardCard = { ...milledCard, zone: 'graveyard' };
    (z.graveyard as any[]).push(graveyardCard);
    z.graveyardCount = (z.graveyard as any[]).length;
    z.libraryCount = library.length;
    ctx.libraries.set(drawingPlayerId, library);
    delete (ctx.state as any).zursWeirdingPendingDraw;

    recordCardPutIntoGraveyardThisTurn(ctx as any, drawingPlayerId, graveyardCard, { fromBattlefield: false });
    ctx.bumpSeq();

    if (remainingDrawCountAfterChoice > 0) {
      drawCards(ctx, drawingPlayerId, remainingDrawCountAfterChoice, { skipEventPersistence: true });
    }

    return { applied: true, revealedCard, milledCard: graveyardCard };
  }

  const nextOpponentIndex = opponentIndex + 1;
  if (nextOpponentIndex < opponents.length) {
    (ctx.state as any).zursWeirdingPendingDraw = {
      ...(pending || {}),
      nextOpponentIndex,
    };
    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId && gameId !== 'unknown' && !(ctx as any).isReplaying) {
      queueZursWeirdingOpponentStep(ctx, drawingPlayerId, library[0], remainingDrawCountAfterChoice, nextOpponentIndex);
    }
    return { applied: true, revealedCard, reason: 'queued_next_opponent' };
  }

  const previousSuppress = (ctx as any)._suppressZursWeirdingReplacement === true;
  (ctx as any)._suppressZursWeirdingReplacement = true;
  try {
    const drawnCards = drawCards(ctx, drawingPlayerId, 1, { skipEventPersistence: true });
    delete (ctx.state as any).zursWeirdingPendingDraw;
    if (remainingDrawCountAfterChoice > 0) {
      drawCards(ctx, drawingPlayerId, remainingDrawCountAfterChoice, { skipEventPersistence: true });
    }
    return { applied: true, revealedCard, drawnCards };
  } finally {
    if (previousSuppress) {
      (ctx as any)._suppressZursWeirdingReplacement = true;
    } else {
      delete (ctx as any)._suppressZursWeirdingReplacement;
    }
  }
}

import { queueDredgeDrawReplacementStep } from "./zones-handlers/zonesDrawReplacementDredgeQueue.js";

function findDredgeAmount(card: any): number {
  const match = String(card?.oracle_text || '').match(/\bdredge\s+(\d+)\b/i);
  const amount = match ? parseInt(match[1], 10) : 0;
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export interface DredgeDrawReplacementResult {
  applied: boolean;
  declined?: boolean;
  reason?: string;
  dredgeCard?: any;
  milledCards?: any[];
  drawnCards?: any[];
}

export function applyDredgeDrawReplacementChoice(ctx: GameContext, event: {
  playerId: PlayerID | string;
  choiceId?: string;
  dredgeCardId?: string;
  dredgeAmount?: number;
  remainingDrawCountAfterChoice?: number;
}): DredgeDrawReplacementResult {
  const playerId = String(event?.playerId || '').trim() as PlayerID;
  if (!playerId) return { applied: false, reason: 'missing_player' };

  const choiceId = String(event?.choiceId || '').trim().toLowerCase();
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));

  if (!choiceId || choiceId === 'draw' || choiceId === 'decline') {
    const previousSuppress = (ctx as any)._suppressDredgeReplacement === true;
    (ctx as any)._suppressDredgeReplacement = true;
    try {
      const drawnCards = drawCards(ctx, playerId, 1, { skipEventPersistence: true });
      if (!previousSuppress) delete (ctx as any)._suppressDredgeReplacement;
      if (remainingDrawCountAfterChoice > 0) {
        drawCards(ctx, playerId, remainingDrawCountAfterChoice, { skipEventPersistence: true });
      }
      return { applied: true, declined: true, drawnCards };
    } finally {
      if (previousSuppress) {
        (ctx as any)._suppressDredgeReplacement = true;
      } else {
        delete (ctx as any)._suppressDredgeReplacement;
      }
    }
  }

  const dredgeCardId = String(event?.dredgeCardId || choiceId.replace(/^dredge:/, '')).trim();
  if (!dredgeCardId) return { applied: false, reason: 'missing_dredge_card' };

  const zones = ctx.state.zones = ctx.state.zones || {};
  const z = zones[playerId] || (zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.hand = Array.isArray(z.hand) ? z.hand : [];
  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

  const graveyard = z.graveyard as any[];
  const dredgeIndex = graveyard.findIndex((card: any) => String(card?.id || '').trim() === dredgeCardId);
  if (dredgeIndex < 0) return { applied: false, reason: 'dredge_card_not_in_graveyard' };

  const dredgeCard = graveyard[dredgeIndex];
  const dredgeAmount = Math.max(0, Math.floor(Number(event?.dredgeAmount || findDredgeAmount(dredgeCard))));
  if (dredgeAmount <= 0) return { applied: false, reason: 'invalid_dredge_amount' };

  const library = ctx.libraries.get(playerId) || [];
  if (library.length < dredgeAmount) return { applied: false, reason: 'insufficient_library' };

  const milledCards = library.splice(0, dredgeAmount).map((card: any) => ({ ...card, zone: 'graveyard' }));
  for (const milledCard of milledCards) {
    pushCardToGraveyardFromLibrary(ctx, String(playerId), milledCard, graveyard);
  }

  const [returnedCard] = graveyard.splice(dredgeIndex, 1);
  const returnedToHand = { ...returnedCard, zone: 'hand' };
  (z.hand as any[]).push(returnedToHand);
  ctx.libraries.set(playerId, library);
  z.handCount = (z.hand as any[]).length;
  z.libraryCount = library.length;
  z.graveyardCount = graveyard.length;

  processMillTriggers(ctx, playerId, milledCards, playerId);
  ctx.bumpSeq();

  if (remainingDrawCountAfterChoice > 0) {
    drawCards(ctx, playerId, remainingDrawCountAfterChoice, { skipEventPersistence: true });
  }

  return { applied: true, dredgeCard: returnedToHand, milledCards };
}

import {
  persistDrawCardsEvent,
  drawCards,
  drawCardsByIds,
  processDrawTriggers,
} from "./zones-handlers/zonesDrawCards.js";
export type { DrawCardsOptions } from "./zones-handlers/zonesDrawCards.js";
export {
  persistDrawCardsEvent,
  drawCards,
  drawCardsByIds,
  processDrawTriggers,
};
export { applySkipDrawReplacementChoice } from "./zones-handlers/zonesDrawReplacementSkipDrawApply.js";

import { processMillTriggers } from "./zones-handlers/zonesProcessMillTriggers.js";
export { processMillTriggers };


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
      if (pushCardToGraveyardFromLibrary(ctx, String(playerId), c, (z as any).graveyard)) {
        moved.push(c);
      }
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
      pushCardToGraveyardFromLibrary(ctx, String(playerId), c, (z as any).graveyard, {
        extraFields: { faceDown: false },
      });
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
    // Not a land - add +1/+1 counter to exploring permanent (Branching Evolution, etc.)
    const battlefield = ctx.state.battlefield || [];
    const perm = battlefield.find((p: any) => p.id === permanentId && p.controller === playerId);
    if (perm) {
      updateCounters(ctx, permanentId, { '+1/+1': 1 });
    }
    
    if (toGraveyard) {
      (z as any).graveyard = (z as any).graveyard || [];
      pushCardToGraveyardFromLibrary(ctx, String(playerId), topCard, (z as any).graveyard, {
        extraFields: { faceDown: false },
      });
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

export { movePermanentToLibrary } from "./zones-handlers/zonesMovePermanentToLibrary.js";


export { movePermanentToHand } from "./zones-handlers/zonesMovePermanentToHand.js";


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

  try {
    const repaired = repairAllDualZoneGhosts(ctx);
    if (repaired > 0) {
      debug(1, `reconcileZonesConsistency: removed ${repaired} dual-zone ghost card entr${repaired === 1 ? 'y' : 'ies'}`);
    }
  } catch (err) {
    debugWarn(1, "reconcileZonesConsistency dual-zone repair failed", err);
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

  // If this player currently has any cards in true exile, clean up impulse permissions/tags
  // so they can't leak across a wipe/reset.
  try {
    const prevExile = Array.isArray(zones?.[playerId]?.exile) ? (zones[playerId] as any).exile : [];
    for (const c of prevExile) cleanupCardLeavingExile(state, c);
    state.playableFromExile = state.playableFromExile || {};
    state.playableFromExile[playerId] = {};
  } catch {
    // ignore
  }

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
