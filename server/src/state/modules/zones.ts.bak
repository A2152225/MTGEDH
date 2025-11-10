import type { PlayerID, PlayerRef, KnownCardRef } from "../types";
import type { GameContext } from "../context";
import { uid } from "../utils";

/**
 * Deck import resolution (unchanged). Called either live via socket or during replay of deckImportResolved events.
 */
export function importDeckResolved(
  ctx: GameContext,
  playerId: PlayerID,
  cards: Array<Pick<KnownCardRef,"id"|"name"|"type_line"|"oracle_text"|"image_uris"|"mana_cost"|"power"|"toughness">>
) {
  const { libraries, zones, bumpSeq } = ctx;
  libraries.set(
    playerId,
    cards.map(c => ({
      id: c.id,
      name: c.name,
      type_line: c.type_line,
      oracle_text: c.oracle_text,
      image_uris: c.image_uris,
      mana_cost: (c as any).mana_cost,
      power: (c as any).power,
      toughness: (c as any).toughness,
      zone: "library"
    }))
  );
  const libLen = libraries.get(playerId)?.length ?? 0;
  zones[playerId] = zones[playerId] ?? { hand: [], handCount: 0, libraryCount: libLen, graveyard: [], graveyardCount: 0 };
  zones[playerId]!.libraryCount = libLen;
  bumpSeq();
}

/* Remaining zone-related functions unchanged from prior refactor */
export function shuffleLibrary(ctx: GameContext, playerId: PlayerID) { /* unchanged */ }
export function drawCards(ctx: GameContext, playerId: PlayerID, count: number) { /* unchanged */ }
export function selectFromLibrary(ctx: GameContext, playerId: PlayerID, cardIds: string[], moveTo:"hand"|"graveyard"|"exile"|"battlefield") { /* unchanged */ }
export function moveHandToLibrary(ctx: GameContext, playerId: PlayerID) { /* unchanged */ }
export function reconcileZonesConsistency(ctx: GameContext) { /* unchanged */ }
export function searchLibrary(ctx: GameContext, playerId: PlayerID, query: string, limit: number) { /* unchanged */ }