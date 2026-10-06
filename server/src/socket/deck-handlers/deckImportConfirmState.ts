/**
 * Origin parent: server/src/socket/deck.ts
 *
 * Cluster moved: pending confirmation type/map, import-buffer card mapping,
 * confirm-id / room / owner-only saved-deck guards, and wipe-confirm RQ cancel.
 *
 * Public entry symbols: PendingConfirm, toImportBufferCard,
 * pendingImportConfirmations, makeImportConfirmId, isSocketInGameRoom,
 * canModifySavedDeck, cancelImportWipeConfirmResolutionSteps.
 */
import type { Socket } from "socket.io";
import type { KnownCardRef, PlayerID } from "../../../../shared/src";
import { ResolutionQueueManager } from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";

/* --- Pending confirmation state & helpers --- */
export type PendingConfirm = {
  gameId: string;
  initiator: PlayerID;
  resolvedCards: Array<
    Pick<
      KnownCardRef,
      "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness" | "card_faces" | "layout" | "loyalty"
    >
  >;
  parsedCount: number;
  deckName?: string;
  save?: boolean;
  // Logged-in account of the importing socket (used by the optional auto-save so the deck
  // is owned by the account, private, and only listed to people allowed to see it).
  saveOwner?: { userId: string; displayName?: string; isAdmin: boolean } | null;
  responses: Record<string, "pending" | "yes" | "no">;
  timeout?: NodeJS.Timeout | null;
  // snapshots to allow restore on cancel
  snapshotZones?: any;
  snapshotCommandZone?: any;
  snapshotPhase?: string | null;
  // PRE_GAME optimization: apply only for the importer (do not wipe/reset table)
  applyImporterOnly?: boolean;
};

export function getSaveOwnerFromSocket(socket: {
  data?: any;
}): { userId: string; displayName?: string; isAdmin: boolean } | null {
  const userId = socket?.data?.accountUserId;
  if (typeof userId !== "string" || !userId.trim()) return null;
  const displayName = socket.data?.accountDisplayName;
  return {
    userId,
    displayName: typeof displayName === "string" && displayName ? displayName : undefined,
    isAdmin: socket.data?.accountIsAdmin === true,
  };
}

export function toImportBufferCard(c: any) {
  return {
    id: c.id,
    name: c.name,
    type_line: c.type_line,
    oracle_text: c.oracle_text,
    image_uris: c.image_uris,
    mana_cost: (c as any).mana_cost,
    cmc: (c as any).cmc,
    power: (c as any).power,
    toughness: (c as any).toughness,
    loyalty: (c as any).loyalty,
    card_faces: (c as any).card_faces,
    layout: (c as any).layout,
    colors: (c as any).colors,
    color_identity: (c as any).color_identity,
  };
}

export const pendingImportConfirmations: Map<string, PendingConfirm> = new Map();

export function makeImportConfirmId(gameId: string): string {
  const safeGameId = String(gameId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
  return `imp_${safeGameId || "game"}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function isSocketInGameRoom(socket: Socket, gameId: string): boolean {
  try {
    const socketGameId = (socket.data as any)?.gameId;
    if (socketGameId && socketGameId !== gameId) return false;
    const rooms = (socket as any)?.rooms;
    return !!(rooms && typeof rooms.has === 'function' && rooms.has(gameId));
  } catch {
    return false;
  }
}

export function canModifySavedDeck(
  socket: Socket,
  deck: { created_by_id: string },
  playerId: PlayerID,
): boolean {
  if ((socket.data as any)?.accountIsAdmin === true) return true;
  const accountUserId = typeof (socket.data as any)?.accountUserId === 'string'
    ? String((socket.data as any).accountUserId)
    : '';
  return deck.created_by_id === playerId
    || (!!accountUserId && deck.created_by_id === accountUserId);
}

export function cancelImportWipeConfirmResolutionSteps(gameId: string, confirmId: string) {
  try {
    const queue = ResolutionQueueManager.getQueue(gameId);
    const ids = queue.steps
      .filter(s => (s as any)?.importWipeConfirm === true && String((s as any)?.confirmId || '') === String(confirmId))
      .map(s => s.id);
    for (const id of ids) {
      ResolutionQueueManager.cancelStep(gameId, id);
    }
  } catch (err) {
    debugWarn(1, 'cancelImportWipeConfirmResolutionSteps failed', err);
  }
}

