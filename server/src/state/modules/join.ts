import type { PlayerID, PlayerRef } from "../types";
import type { GameContext } from "../context";
import { uid } from "../utils";

export function addPlayerIfMissing(ctx: GameContext, id: PlayerID, name: string, desiredSeat?: number): number {
  const { state, life, poison, experience, commandZone, bumpSeq, libraries } = ctx;
  const zones = state.zones = state.zones || {};
  const existing = (state.players as any as PlayerRef[]).find(p => p.id === id);
  if (existing) return existing.seat;
  const seat = (typeof desiredSeat === "number" ? desiredSeat : (state.players as any as PlayerRef[]).length) as PlayerRef["seat"];
  const ref: PlayerRef = { id, name, seat };
  (state.players as any as PlayerRef[]).push(ref);
  life[id] = state.startingLife;
  poison[id] = 0;
  experience[id] = 0;
  
  // Initialize energy counters
  const energy = (ctx as any).energy = (ctx as any).energy || {};
  energy[id] = 0;

  // Defensive: libraries may be undefined or not a Map during some fallback flows.
  // Compute libraryCount safely.
  let libraryCount = 0;
  try {
    if (libraries && typeof libraries.get === "function") {
      const lib = libraries.get(id);
      if (Array.isArray(lib)) libraryCount = lib.length;
      else if (lib && typeof (lib as any).length === "number") libraryCount = (lib as any).length;
    }
  } catch {
    libraryCount = 0;
  }

  zones[id] = zones[id] ?? { hand: [], handCount: 0, libraryCount, graveyard: [], graveyardCount: 0 };
  commandZone[id] = commandZone[id] ?? { commanderIds: [], tax: 0, taxById: {} };
  state.landsPlayedThisTurn![id] = state.landsPlayedThisTurn![id] ?? 0;
  if (!state.turnPlayer) state.turnPlayer = id;
  if (!state.priority) state.priority = id;
  bumpSeq();
  return seat;
}

export function join(
  ctx: GameContext,
  socketId: string,
  playerName: string,
  spectator: boolean,
  fixedPlayerId?: PlayerID,
  seatTokenFromClient?: string
) {
  const { joinedBySocket, playerToToken, tokenToPlayer, spectatorNames, state, commandZone, poison, experience, libraries } = ctx;
  const zones = state.zones = state.zones || {};
  const existing = joinedBySocket.get(socketId);
  if (existing) return { playerId: existing.playerId, added: false, seatToken: playerToToken.get(existing.playerId) };

  const normalizedName = playerName.trim();
  let playerId = fixedPlayerId ?? ("" as PlayerID);
  let added = false;
  let seat: number | undefined;
  let seatToken = seatTokenFromClient;

  if (!spectator) {
    if (seatToken && tokenToPlayer.has(seatToken)) {
      const claimedId = tokenToPlayer.get(seatToken)!;
      const p = (state.players as any as PlayerRef[]).find(x => x.id === claimedId);
      if (p && p.name.trim().toLowerCase() === normalizedName.toLowerCase()) {
        playerId = claimedId;
        seat = addPlayerIfMissing(ctx, playerId, normalizedName);
        if (!playerToToken.get(playerId)) playerToToken.set(playerId, seatToken);
      } else seatToken = undefined;
    }
    if (!playerId) {
      const byName = (state.players as any as PlayerRef[]).find(p => p.name.trim().toLowerCase() === normalizedName.toLowerCase());
      if (byName) playerId = byName.id as PlayerID;
    }
    if (playerId) {
      const existingToken = playerToToken.get(playerId);
      if (existingToken) seatToken = existingToken;
      else {
        seatToken = seatToken || uid("t");
        tokenToPlayer.set(seatToken, playerId);
        playerToToken.set(playerId, seatToken);
      }
      zones[playerId] = zones[playerId] ?? { hand: [], handCount: 0, libraryCount: (libraries && typeof libraries.get === "function" && Array.isArray(libraries.get(playerId)) ? libraries.get(playerId)!.length : 0), graveyard: [], graveyardCount: 0 };
      commandZone[playerId] = commandZone[playerId] ?? { commanderIds: [], tax: 0, taxById: {} };
      state.landsPlayedThisTurn![playerId] = state.landsPlayedThisTurn![playerId] ?? 0;
      if (!(playerId in poison)) poison[playerId] = 0;
      if (!(playerId in experience)) experience[playerId] = 0;
    }
    if (!playerId) {
      playerId = uid("p") as PlayerID;
      seat = addPlayerIfMissing(ctx, playerId, normalizedName);
      added = true;
      seatToken = uid("t");
      tokenToPlayer.set(seatToken, playerId);
      playerToToken.set(playerId, seatToken);
    }
  } else {
    if (!playerId) playerId = uid("s") as PlayerID;
    spectatorNames.set(playerId, normalizedName || "Spectator");
  }

  const participant = { socketId, playerId, spectator };
  joinedBySocket.set(socketId, participant);
  ctx.participantsList.push(participant);
  return { playerId, added, seatToken, seat };
}

export function leave(ctx: GameContext, playerId?: PlayerID): boolean {
  const { state, life, poison, experience, commandZone, libraries, inactive, playerToToken, tokenToPlayer, grants, participantsList, spectatorNames, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  if (!playerId) return false;
  const idx = (state.players as any as PlayerRef[]).findIndex(p => p.id === playerId);
  if (idx >= 0) {
    (state.players as any as PlayerRef[]).splice(idx, 1);
    delete life[playerId];
    delete poison[playerId];
    delete experience[playerId];
    delete (commandZone as any)[playerId];
    delete zones[playerId];
    libraries.delete(playerId);
    inactive.delete(playerId);
    if (state.turnPlayer === playerId) state.turnPlayer = ((state.players as any as PlayerRef[])[0]?.id ?? "") as PlayerID;
    if (state.priority === playerId) state.priority = ((state.players as any as PlayerRef[])[0]?.id ?? "") as PlayerID;
    const token = playerToToken.get(playerId);
    if (token) {
      playerToToken.delete(playerId);
      tokenToPlayer.delete(token);
    }
    grants.delete(playerId);
    bumpSeq();
    return true;
  }
  for (let i = participantsList.length - 1; i >= 0; i--) {
    if (participantsList[i].playerId === playerId) participantsList.splice(i, 1);
  }
  spectatorNames.delete(playerId);
  return false;
}

export function disconnect(ctx: GameContext, socketId: string) {
  const { joinedBySocket, participantsList } = ctx;
  const p = joinedBySocket.get(socketId);
  if (!p) return;
  joinedBySocket.delete(socketId);
  for (let i = participantsList.length - 1; i >= 0; i--) {
    if (participantsList[i].socketId === socketId) participantsList.splice(i, 1);
  }
}

export function participants(ctx: GameContext) {
  return ctx.participantsList.slice();
}