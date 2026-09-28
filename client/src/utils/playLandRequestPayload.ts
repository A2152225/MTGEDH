// client/src/utils/playLandRequestPayload.ts
// Single source of truth for the `playLand` socket payload the client sends.
// The server handler (server/src/socket/game-actions-handlers/gameActionsPlayLandRequest.ts)
// reads exactly these keys: gameId, cardId, selectedFace, fromZone.

export type PlayLandFromZone = 'hand' | 'graveyard' | 'exile' | 'library';

export type PlayLandRequestPayload = {
  gameId: string;
  cardId: string;
  selectedFace?: number;
  fromZone?: PlayLandFromZone;
};

const PLAY_LAND_ZONES: ReadonlySet<string> = new Set(['hand', 'graveyard', 'exile', 'library']);

export function buildPlayLandRequestPayload(args: {
  gameId: string;
  cardId: string;
  selectedFace?: number;
  fromZone?: string | null;
}): PlayLandRequestPayload {
  const payload: PlayLandRequestPayload = {
    gameId: String(args.gameId),
    cardId: String(args.cardId),
  };
  if (typeof args.selectedFace === 'number' && Number.isFinite(args.selectedFace)) {
    payload.selectedFace = args.selectedFace;
  }
  if (args.fromZone && PLAY_LAND_ZONES.has(args.fromZone)) {
    payload.fromZone = args.fromZone as PlayLandFromZone;
  }
  return payload;
}
