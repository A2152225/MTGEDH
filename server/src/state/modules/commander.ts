import type { PlayerID, KnownCardRef } from "../types";
import type { GameContext } from "../context";

export function setCommander(
  ctx: GameContext,
  playerId: PlayerID,
  commanderNames: string[],
  commanderIds: string[],
  colorIdentity?: ("W"|"U"|"B"|"R"|"G")[]
) {
  const { commandZone, libraries, zones, pendingInitialDraw, bumpSeq } = ctx;
  const info = commandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {} };
  info.commanderIds = commanderIds.slice();
  (info as any).commanderNames = commanderNames.slice();
  (info as any).colorIdentity = Array.isArray(colorIdentity) ? Array.from(new Set(colorIdentity)) : (info as any).colorIdentity;
  const prev = info.taxById ?? {};
  const next: Record<string, number> = {};
  for (const id of commanderIds) next[id] = (prev as any)[id] ?? 0;
  info.taxById = next;
  info.tax = Object.values(info.taxById).reduce((a, b) => a + b, 0);
  commandZone[playerId] = info;

  const lib = libraries.get(playerId);
  if (lib && lib.length) {
    let changed = false;
    for (const cid of commanderIds) {
      const idx = lib.findIndex(c => c.id === cid);
      if (idx >= 0) { lib.splice(idx, 1); changed = true; }
    }
    if (changed) {
      zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
      zones[playerId]!.libraryCount = lib.length;
    }
  }

  if (pendingInitialDraw.has(playerId)) {
    // shuffle + draw logic delegated to deck modules externally
    pendingInitialDraw.delete(playerId);
  }

  (commandZone[playerId] as any).commanderCards = (info.commanderIds || []).map(cid => {
    const prevCards = (info as any).commanderCards as any[] | undefined;
    const fromPrev = prevCards?.find(pc => pc?.id === cid);
    const fromLib = (libraries.get(playerId) || []).find(c => c.id === cid);
    const fromBF = ctx.state.battlefield.find(b => (b.card as any)?.id === cid)?.card as any;
    const src = fromPrev || fromLib || fromBF;
    return src ? {
      id: src.id,
      name: src.name,
      type_line: src.type_line,
      oracle_text: (src as any).oracle_text,
      image_uris: (src as any).image_uris
    } : null;
  }).filter(Boolean);

  bumpSeq();
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