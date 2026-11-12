/**
 * Build deterministic shuffleLibrary / opening-draw event payloads for undo/replay.
 * Opening flow is shuffle-then-draw-from-top; after that, hand + remaining library
 * reconstructs the post-shuffle order for shuffledLibraryIds.
 */

export function readLibraryCardIds(game: any, playerId: string): string[] {
  const fromMap =
    typeof game?.libraries?.get === 'function' ? game.libraries.get(playerId) : null;
  const fromZones = (game?.state as any)?.zones?.[playerId]?.library;
  const library = Array.isArray(fromMap) ? fromMap : Array.isArray(fromZones) ? fromZones : [];
  return library.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
}

export function readHandCardIds(game: any, playerId: string): string[] {
  const hand = (game?.state as any)?.zones?.[playerId]?.hand;
  if (!Array.isArray(hand)) return [];
  return hand.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
}

/** Post-shuffle library order when hand was drawn from the top after shuffling. */
export function buildShuffledLibraryIdsAfterOpeningDraw(game: any, playerId: string): string[] {
  return [...readHandCardIds(game, playerId), ...readLibraryCardIds(game, playerId)];
}

export function buildShuffleLibraryEventPayload(game: any, playerId: string): {
  playerId: string;
  shuffledLibraryIds: string[];
} {
  return {
    playerId,
    shuffledLibraryIds: readLibraryCardIds(game, playerId),
  };
}

export function buildOpeningDrawPersistPayloads(game: any, playerId: string): {
  shuffle: { playerId: string; shuffledLibraryIds: string[] };
  draw: { playerId: string; count: number; drawnCardIds: string[] };
} {
  const drawnCardIds = readHandCardIds(game, playerId);
  return {
    shuffle: {
      playerId,
      shuffledLibraryIds: buildShuffledLibraryIdsAfterOpeningDraw(game, playerId),
    },
    draw: {
      playerId,
      count: drawnCardIds.length || 7,
      drawnCardIds,
    },
  };
}
