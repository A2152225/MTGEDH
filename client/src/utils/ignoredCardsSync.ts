export type IgnoredCardRailItem = {
  permanentId: string;
  cardId: string;
  cardName: string;
  imageUrl?: string;
  zone?: string;
};

export type IgnoredCardsUpdatedPayload = {
  gameId?: string;
  playerId?: string;
  ignoredCards?: IgnoredCardRailItem[];
};

export type IgnoredCardViewEntry = {
  cardName?: string;
  cardId?: string;
  permanentId?: string;
  imageUrl?: string;
  zone?: string;
  ignoredAt?: number;
};

/** Same array shape as server buildIgnoredCardsList / ignoredCardsUpdated. */
export function ignoredCardsFromViewMap(
  ignoredCards: Record<string, IgnoredCardViewEntry> | null | undefined,
): IgnoredCardRailItem[] {
  const entries =
    ignoredCards && typeof ignoredCards === "object" ? Object.entries(ignoredCards) : [];
  return entries.map(([id, data]) => ({
    permanentId: data?.permanentId || id,
    cardId: data?.cardId || id,
    cardName: data?.cardName || id,
    imageUrl: data?.imageUrl,
    zone: data?.zone || "battlefield",
  }));
}

export function payloadMatchesViewer(
  payload: IgnoredCardsUpdatedPayload | null | undefined,
  gameId: string | null | undefined,
  playerId: string | null | undefined,
): boolean {
  return Boolean(
    payload &&
      gameId &&
      playerId &&
      payload.gameId === gameId &&
      payload.playerId === playerId,
  );
}

export function stashIgnoredCardsPayload(
  stash: { current: IgnoredCardsUpdatedPayload | null },
  payload: IgnoredCardsUpdatedPayload | null | undefined,
): IgnoredCardsUpdatedPayload | null {
  if (!payload || typeof payload !== "object") return null;
  stash.current = payload;
  return payload;
}

/** Apply a stashed join/rejoin emit once you + safeView.id exist. */
export function applyStashedIgnoredCardsIfMatch(
  stash: { current: IgnoredCardsUpdatedPayload | null },
  gameId: string | null | undefined,
  playerId: string | null | undefined,
): IgnoredCardRailItem[] | null {
  const payload = stash.current;
  if (!payloadMatchesViewer(payload, gameId, playerId) || !payload) return null;
  return payload.ignoredCards || [];
}

/** Seed the rail from viewFor leftover map only when no newer live emit won. */
export function shouldSeedIgnoredCardsFromView(args: {
  gameId: string | null | undefined;
  playerId: string | null | undefined;
  railEmpty: boolean;
  appliedLiveForGameId: string | null | undefined;
  viewMap: Record<string, IgnoredCardViewEntry> | null | undefined;
}): IgnoredCardRailItem[] | null {
  const { gameId, playerId, railEmpty, appliedLiveForGameId, viewMap } = args;
  if (!gameId || !playerId) return null;
  if (appliedLiveForGameId === gameId) return null;
  if (!railEmpty) return null;
  const seeded = ignoredCardsFromViewMap(viewMap);
  return seeded.length > 0 ? seeded : null;
}
