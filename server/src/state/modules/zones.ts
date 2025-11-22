// server/src/state/modules/zones.ts
// Zones module: handles libraries/hands/graveyards/exile, search/select, scry/surveil,
// shuffles/draws, hand reorder, and the server-authoritative applyPreGameReset helper.
//
// Exports a complete set of named helpers used throughout the server state surface.

import type { PlayerID, KnownCardRef } from "../../shared/src/types";
import type { GameContext } from "../state/context";
import { uid } from "../utils";

/* ===== core zone operations ===== */

/**
 * importDeckResolved
 * Populate ctx.libraries[playerId] with resolved KnownCardRef objects.
 */
export function importDeckResolved(
  ctx: GameContext,
  playerId: PlayerID,
  cards: Array<
    Pick<
      KnownCardRef,
      "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness"
    >
  >
) {
  const { libraries, zones, bumpSeq } = ctx as any;
  libraries.set(
    playerId,
    cards.map((c) => ({
      id: c.id,
      name: c.name,
      type_line: c.type_line,
      oracle_text: c.oracle_text,
      image_uris: c.image_uris,
      mana_cost: (c as any).mana_cost,
      power: (c as any).power,
      toughness: (c as any).toughness,
      zone: "library",
    }))
  );
  const libLen = libraries.get(playerId)?.length ?? 0;
  zones[playerId] = zones[playerId] ?? { hand: [], handCount: 0, libraryCount: libLen, graveyard: [], graveyardCount: 0 } as any;
  zones[playerId]!.libraryCount = libLen;
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
  const z = ctx.zones[playerId] || (ctx.zones[playerId] = { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  ctx.bumpSeq();
}

/**
 * drawCards
 */
export function drawCards(ctx: GameContext, playerId: PlayerID, count: number) {
  const lib = ctx.libraries.get(playerId) || [];
  const z = ctx.zones[playerId] || (ctx.zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  const drawn: KnownCardRef[] = [];
  for (let i = 0; i < count && lib.length > 0; i++) {
    const c = lib.shift()!;
    (z.hand as any[]).push(c);
    drawn.push(c);
  }
  ctx.libraries.set(playerId, lib);
  z.handCount = (z.hand as any[]).length;
  z.libraryCount = lib.length;
  ctx.bumpSeq();
  return drawn;
}

/**
 * moveHandToLibrary: Move the player's whole hand onto top of library
 */
export function moveHandToLibrary(ctx: GameContext, playerId: PlayerID) {
  const z = ctx.zones[playerId];
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
  const z = ctx.zones?.[playerId];
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

  const z = ctx.zones[playerId] || (ctx.zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
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
  const z = ctx.zones?.[playerId];
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
  ctx.zones[playerId] = ctx.zones[playerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  } as any;
  ctx.zones[playerId]!.libraryCount = lib.length;
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
  const z =
    ctx.zones[playerId] ||
    (ctx.zones[playerId] = {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
    } as any);
  (z as any).graveyard = (z as any).graveyard || [];
  for (const id of toGraveyard) {
    const c = byId.get(id);
    if (c) (z as any).graveyard.push({ ...c, zone: "graveyard", faceDown: false });
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

/* ===== search helper ===== */

/**
 * searchLibrary
 * Simple substring search by card name within the player's library. Case-insensitive.
 * Returns up to `limit` simplified KnownCardRef-like objects.
 */
export function searchLibrary(ctx: GameContext, playerId: PlayerID, query: string, limit = 20) {
  const lib = ctx.libraries.get(playerId) || [];
  if (!query || typeof query !== "string") {
    return lib.slice(0, Math.max(0, limit)).map(c => ({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, image_uris: (c as any).image_uris }));
  }
  const q = query.trim().toLowerCase();
  const res: any[] = [];
  for (const c of lib) {
    if (res.length >= limit) break;
    const name = (c.name || "").toLowerCase();
    if (name.includes(q)) {
      res.push({ id: c.id, name: c.name, type_line: c.type_line, oracle_text: c.oracle_text, image_uris: (c as any).image_uris });
    }
  }
  return res;
}

/* ===== consistency helper (exported) ===== */

export function reconcileZonesConsistency(ctx: GameContext, playerId?: PlayerID) {
  const players: PlayerID[] =
    typeof playerId !== "undefined"
      ? [playerId]
      : ((ctx.state.players as any as { id: PlayerID }[]) || []).map((p) => p.id);

  for (const pid of players) {
    try {
      if (!ctx.zones[pid]) {
        ctx.zones[pid] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any;
      }
      const z = ctx.zones[pid] as any;

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
      console.warn("reconcileZonesConsistency failed for player", pid, err);
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
  const { state, libraries, zones, bumpSeq, life, poison, experience, commandZone } = ctx as any;

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

  // Set global phase to PRE_GAME (authoritative)
  (state as any).phase = "PRE_GAME";

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
  searchLibrary,
  reconcileZonesConsistency,
  applyPreGameReset
};