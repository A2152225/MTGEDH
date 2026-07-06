import type { Server, Socket } from "socket.io";
import { emitToPlayer } from "./util.js";

export type IgnoredCardEntry = {
  cardName?: string;
  cardId?: string;
  permanentId?: string;
  imageUrl?: string;
  zone?: string;
  ignoredAt?: number;
};

export function getPlayerIgnoredCards(
  state: unknown,
  playerId: string,
): Record<string, IgnoredCardEntry> {
  const ignored = (state as any)?.ignoredCardsForAutoPass?.[playerId];
  return ignored && typeof ignored === "object" ? ignored : {};
}

export function buildIgnoredCardsList(
  ignoredCards: Record<string, IgnoredCardEntry> | undefined,
) {
  const entries =
    ignoredCards && typeof ignoredCards === "object"
      ? Object.entries(ignoredCards)
      : [];

  return entries.map(([id, data]) => ({
    permanentId: data?.permanentId || id,
    cardId: data?.cardId || id,
    cardName: data?.cardName || id,
    imageUrl: data?.imageUrl,
    zone: data?.zone || "battlefield",
  }));
}

export function emitIgnoredCardsUpdatedToSocket(
  socket: Socket,
  gameId: string,
  playerId: string,
  ignoredCards: Record<string, IgnoredCardEntry> | undefined,
): void {
  socket.emit("ignoredCardsUpdated" as any, {
    gameId,
    playerId,
    ignoredCards: buildIgnoredCardsList(ignoredCards),
  });
}

export function emitIgnoredCardsUpdatedToPlayer(
  io: Server,
  gameId: string,
  playerId: string,
  ignoredCards: Record<string, IgnoredCardEntry> | undefined,
): void {
  emitToPlayer(io, playerId, "ignoredCardsUpdated", {
    gameId,
    playerId,
    ignoredCards: buildIgnoredCardsList(ignoredCards),
  });
}
