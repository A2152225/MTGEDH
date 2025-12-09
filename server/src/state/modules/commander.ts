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
  const { commandZone, libraries, pendingInitialDraw, bumpSeq, state } = ctx;
  const zones = state.zones = state.zones || {};
  const info = commandZone[playerId] ?? { commanderIds: [], commanderNames: [], tax: 0, taxById: {}, inCommandZone: [] };
  info.commanderIds = commanderIds.slice();
  info.commanderNames = commanderNames.slice();
  // Initialize inCommandZone to all commander IDs (all start in the command zone)
  (info as any).inCommandZone = commanderIds.slice();
  if (!info.taxById) info.taxById = {};
  info.tax = Object.values(info.taxById || {}).reduce((a: number, b: number) => a + b, 0);

  // Build commanderCards snapshot (prefer prior cached, then library entries, then battlefield)
  const built: Array<{ id: string; name: string; type_line?: string; oracle_text?: string; image_uris?: any; mana_cost?: string; power?: string; toughness?: string }> = [];
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
        mana_cost: (src as any).mana_cost,
        power: (src as any).power,
        toughness: (src as any).toughness,
      });
    } else {
      // placeholder minimal snapshot if we have only id
      built.push({ id: cid, name: commanderNames?.[0] ?? cid });
    }
  }

  // Remove commander cards from library if present
  // Important: We collect all indices first, then remove from highest to lowest
  // to avoid index shifting issues when removing multiple commanders
  if (lib && lib.length) {
    let changed = false;
    const indicesToRemove: number[] = [];
    
    // Collect indices of all commanders in the library
    for (const cid of info.commanderIds || []) {
      const idx = lib.findIndex((c: any) => c && c.id === cid);
      if (idx >= 0) {
        console.log(`[setCommander] Found commander ${cid} in library at index ${idx}`);
        indicesToRemove.push(idx);
      } else {
        console.log(`[setCommander] Commander ${cid} not found in library (library size: ${lib.length})`);
      }
    }
    
    // Remove from highest index to lowest to prevent index shifting issues
    if (indicesToRemove.length > 0) {
      indicesToRemove.sort((a, b) => b - a); // Sort descending
      console.log(`[setCommander] Removing ${indicesToRemove.length} commander(s) from library at indices:`, indicesToRemove, `library size before: ${lib.length}`);
      
      for (const idx of indicesToRemove) {
        lib.splice(idx, 1);
        changed = true;
      }
      
      console.log(`[setCommander] Library size after removal: ${lib.length}`);
    }
    
    if (changed) {
      libraries.set(playerId, lib);
      zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 } as any;
      zones[playerId]!.libraryCount = lib.length;
      console.log(`[setCommander] Updated zones[${playerId}].libraryCount to ${lib.length}`);
    }
  } else {
    console.log(`[setCommander] Library is empty or null for player ${playerId}`);
  }

  (info as any).commanderCards = built;
  commandZone[playerId] = info;
  
  // Also update state.commandZone so it gets sent to clients via viewFor
  if (state && state.commandZone) {
    (state.commandZone as any)[playerId] = info;
  }

  // If player was marked for pending opening draw, do shuffle + draw(7) but only if hand is empty.
  if (pendingInitialDraw && pendingInitialDraw.has(playerId)) {
    try {
      const z = zones[playerId] || null;
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
  const { commandZone, bumpSeq, state } = ctx;
  const info = commandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {}, inCommandZone: [] };
  
  // Check if the commander is in the command zone
  const inCZ = (info as any).inCommandZone as string[] || [];
  if (!inCZ.includes(commanderId)) {
    console.warn(`[castCommander] Commander ${commanderId} is not in command zone for player ${playerId}`);
    return; // Don't allow casting if not in command zone
  }
  
  // Remove commander from inCommandZone
  (info as any).inCommandZone = inCZ.filter((id: string) => id !== commanderId);
  console.log(`[castCommander] Removed commander ${commanderId} from command zone. Remaining in CZ:`, (info as any).inCommandZone);
  
  if (!info.taxById) info.taxById = {};
  info.taxById[commanderId] = (info.taxById[commanderId] ?? 0) + 2;
  info.tax = Object.values(info.taxById).reduce((a: number, b: number) => a + b, 0);
  commandZone[playerId] = info;
  
  // Also update state.commandZone
  if (state && state.commandZone) {
    (state.commandZone as any)[playerId] = info;
  }
  
  bumpSeq();
}

export function moveCommanderToCZ(ctx: GameContext, playerId: PlayerID, commanderId: string) {
  const { commandZone, bumpSeq, state } = ctx;
  const info = commandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {}, inCommandZone: [] };
  
  // Only add if it's a valid commander for this player
  if (!info.commanderIds.includes(commanderId)) {
    console.warn(`[moveCommanderToCZ] ${commanderId} is not a commander for player ${playerId}`);
    return;
  }
  
  // Add commander back to inCommandZone if not already there
  const inCZ = (info as any).inCommandZone as string[] || [];
  if (!inCZ.includes(commanderId)) {
    inCZ.push(commanderId);
    (info as any).inCommandZone = inCZ;
    console.log(`[moveCommanderToCZ] Added commander ${commanderId} back to command zone for player ${playerId}`);
  }
  
  commandZone[playerId] = info;
  
  // Also update state.commandZone
  if (state && state.commandZone) {
    (state.commandZone as any)[playerId] = info;
  }
  
  ctx.bumpSeq();
}