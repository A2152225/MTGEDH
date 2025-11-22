// server/src/state/modules/commander.ts
// setCommander with idempotent guard for pending opening draw.
// Full file replacement.

import type { PlayerID, KnownCardRef } from "../types";
import type { GameContext } from "../context";
import { shuffleLibrary, drawCards } from "./zones";

/**
 * Commander handling: snapshot commander metadata, remove from library,
 * update zones and perform pending opening draw if required.
 *
 * Important change: opening draw will only be performed if the player's hand
 * is currently empty (handCount === 0 or no hand array). This prevents double-draws
 * when multiple code paths might try to trigger the opening draw.
 */

export function setCommander(
  ctx: GameContext,
  playerId: PlayerID,
  commanderNames: string[],
  commanderIds: string[] = [],
  colorIdentity?: ("W" | "U" | "B" | "R" | "G")[]
) {
  const { commandZone, libraries, zones, pendingInitialDraw, bumpSeq } = ctx;
  const info = commandZone[playerId] ?? { commanderIds: [], commanderNames: [], tax: 0, taxById: {} };
  info.commanderIds = commanderIds.slice();
  info.commanderNames = commanderNames.slice();
  if (!info.taxById) info.taxById = {};
  info.tax = Object.values(info.taxById || {}).reduce((a, b) => a + b, 0);

  // Build commanderCards snapshot (prefer prior cached, then library entries, then battlefield)
  const built: Array<{ id: string; name: string; type_line?: string; oracle_text?: string; image_uris?: any }> = [];
  const prevCards = (info as any).commanderCards as any[] | undefined;

  // Snapshot before removing from library.
  const lib = libraries.get(playerId) || [];
  for (const cid of info.commanderIds || []) {
    let src =
      prevCards?.find((pc) => pc && pc.id === cid) ||
      lib.find((c: any) => c?.id === cid) ||
      (ctx.state.battlefield || []).find((b: any) => (b.card as any)?.id === cid)?.card;
    if (src) {
      built.push({
        id: src.id,
        name: src.name,
        type_line: (src as any).type_line,
        oracle_text: (src as any).oracle_text,
        image_uris: (src as any).image_uris,
      });
    } else {
      // placeholder minimal snapshot if we have only id
      built.push({ id: cid, name: commanderNames?.[0] ?? cid });
    }
  }

  // Remove commander cards from library if present
  if (lib && lib.length) {
    let changed = false;
    for (const cid of info.commanderIds || []) {
      const idx = lib.findIndex((c: any) => c && c.id === cid);
      if (idx >= 0) {
        lib.splice(idx, 1);
        changed = true;
      }
    }
    if (changed) {
      libraries.set(playerId, lib);
      zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 } as any;
      zones[playerId]!.libraryCount = lib.length;
    }
  }

  (info as any).commanderCards = built;
  commandZone[playerId] = info;

  // If player was marked for pending opening draw, do shuffle + draw(7) but only if hand is empty.
  if (pendingInitialDraw && pendingInitialDraw.has(playerId)) {
    try {
      const z = zones[playerId] || (ctx.state && (ctx.state as any).zones && (ctx.state as any).zones[playerId]) || null;
      const handCount = z ? (typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0)) : 0;

      // Idempotency: only perform opening draw if hand is empty (handCount === 0)
      if (handCount === 0) {
        // Shuffle then draw 7 using existing zone helpers
        shuffleLibrary(ctx, playerId);
        const drawn = drawCards(ctx, playerId, 7);
        // Clear pending flag
        pendingInitialDraw.delete(playerId);
        // bump seq to reflect visible changes
        bumpSeq();
      } else {
        // If hand already has cards, just clear pending flag (avoid double-draw)
        pendingInitialDraw.delete(playerId);
        bumpSeq();
      }
    } catch (err) {
      console.warn("setCommander: failed to perform opening draw for", playerId, err);
    }
  } else {
    bumpSeq();
  }
}

export function castCommander(ctx: GameContext, playerId: PlayerID, commanderId: string) {
  const { commandZone, bumpSeq } = ctx;
  const info = commandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {} };
  if (!info.taxById) info.taxById = {};
  info.taxById[commanderId] = (info.taxById[commanderId] ?? 0) + 2;
  info.tax = Object.values(info.taxById).reduce((a, b) => a + b, 0);
  commandZone[playerId] = info;
  bumpSeq();
}

export function moveCommanderToCZ(ctx: GameContext, _playerId: PlayerID, _commanderId: string) {
  ctx.bumpSeq();
}