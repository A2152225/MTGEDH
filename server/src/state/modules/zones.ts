import type { PlayerID, PlayerRef, KnownCardRef } from "../types";
import type { GameContext } from "../context";
import { uid } from "../utils";

/**
 * Deck import resolution and zone helpers.
 * These functions were migrated from the monolith and keep the same semantics.
 */

export function importDeckResolved(
  ctx: GameContext,
  playerId: PlayerID,
  cards: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness">>
) {
  const { libraries, zones, bumpSeq } = ctx;
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
  zones[playerId] = zones[playerId] ?? { hand: [], handCount: 0, libraryCount: libLen, graveyard: [], graveyardCount: 0 };
  zones[playerId]!.libraryCount = libLen;
  bumpSeq();
}

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

export function drawCards(ctx: GameContext, playerId: PlayerID, count: number) {
  const lib = ctx.libraries.get(playerId) || [];
  const drawCount = Math.max(0, count | 0);
  const drawn: string[] = [];
  for (let i = 0; i < drawCount && lib.length; i++) {
    const c = lib.shift()!;
    drawn.push(c.id);
    const z = ctx.zones[playerId] || (ctx.zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
    (z.hand as any[]).push(c);
    z.handCount = (z.hand as any[]).length;
  }
  ctx.libraries.set(playerId, lib);
  const z = ctx.zones[playerId] || (ctx.zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  ctx.bumpSeq();
  return drawn;
}

export function selectFromLibrary(ctx: GameContext, playerId: PlayerID, cardIds: string[], moveTo: "hand" | "graveyard" | "exile" | "battlefield") {
  const lib = ctx.libraries.get(playerId) || [];
  const moved: string[] = [];
  for (const cid of cardIds) {
    const idx = lib.findIndex((c) => c && (c.id === cid || String(c.name || "").trim().toLowerCase() === String(cid).trim().toLowerCase()));
    if (idx !== -1) {
      const [c] = lib.splice(idx, 1);
      moved.push(c.id);
      const z = ctx.zones[playerId] || (ctx.zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
      if (moveTo === "hand") {
        (z.hand as any[]).push(c);
        z.handCount = (z.hand as any[]).length;
      } else if (moveTo === "graveyard") {
        (z.graveyard as any[]).push(c);
        z.graveyardCount = (z.graveyard as any[]).length;
      } else if (moveTo === "battlefield") {
        // for battlefield movement, conversion handled by stack/stack.resolve or caller
      }
    }
  }
  ctx.libraries.set(playerId, lib);
  const z = ctx.zones[playerId] || (ctx.zones[playerId] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  ctx.bumpSeq();
  return moved;
}

export function moveHandToLibrary(ctx: GameContext, playerId: PlayerID) {
  const z = ctx.zones[playerId];
  if (!z) return 0;
  const hand = (z.hand as any[]) || [];
  const lib = ctx.libraries.get(playerId) || [];
  while (hand.length) {
    const c = hand.shift()!;
    lib.unshift(c); // move to top
  }
  ctx.libraries.set(playerId, lib);
  z.hand = [];
  z.handCount = 0;
  z.libraryCount = lib.length;
  ctx.bumpSeq();
  return z.handCount;
}

/* helpers (reorder/shuffle/peek/scry/surveil) also defined in replay module for event replay; duplicates kept minimal */

export function reorderHand(ctx: GameContext, playerId: PlayerID, order: number[]) {
  const z = ctx.zones?.[playerId];
  if (!z) return false;
  const hand = (z.hand as any[]) || [];
  const n = hand.length;
  if (order.length !== n) return false;
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

export function applyScry(ctx: GameContext, playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) {
  const lib = ctx.libraries.get(playerId) || [];
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