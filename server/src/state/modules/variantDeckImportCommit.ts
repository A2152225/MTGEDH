/**
 * Origin parent: variantDeckSeeding.ts and deckApplyConfirmedImport.ts.
 *
 * Cluster moved: split a resolved deck into library cards vs planar/scheme cards, seed the
 * variant decks, and build the player-facing chat lines. Human import and AI deck-text import
 * both call this so planes and schemes never enter the library.
 *
 * Public: splitResolvedDeckVariants, variantSeedPlayerMessages, commitImportedVariantDecks.
 */
import {
  seedVariantDecks,
  partitionVariantCards,
  type VariantSeedResult,
} from './variantDeckSeeding.js';

type TypeLineCard = { type_line?: unknown; typeLine?: unknown; card_faces?: any[] };

export function splitResolvedDeckVariants<T extends TypeLineCard>(
  resolvedCards: readonly T[] | null | undefined,
  extra?: { planar?: readonly T[] | null; schemes?: readonly T[] | null } | null,
): { playable: T[]; planar: T[]; schemes: T[] } {
  const split = partitionVariantCards(resolvedCards);
  return {
    playable: split.playable,
    planar: [...split.planar, ...((extra?.planar ?? []) as T[])],
    schemes: [...split.schemes, ...((extra?.schemes ?? []) as T[])],
  };
}

/** Chat lines for a seed result. `state` is read after seeding so the deck totals are current. */
export function variantSeedPlayerMessages(state: any, seeded: VariantSeedResult): string[] {
  const messages = [...(seeded?.notes ?? [])];
  if ((seeded?.planarSeeded ?? 0) > 0) {
    const total = (state?.planarDeckFaceDown?.length ?? 0) + (state?.currentPlane ? 1 : 0);
    messages.push(
      `Planechase: added ${seeded.planarSeeded} planar card(s). The shared planar deck has ${total} card(s)` +
        (seeded.startingPlane?.name ? `; ${seeded.startingPlane.name} is face up.` : '.'),
    );
  }
  if ((seeded?.schemesSeeded ?? 0) > 0) {
    messages.push(
      `Archenemy: scheme deck seeded with ${seeded.schemesSeeded} scheme(s). The archenemy starts at 40 life ` +
        `and takes the first turn (CR 904.5, 904.6).`,
    );
  }
  return messages;
}

/**
 * Seed planar / scheme cards from an import and return the chat lines. No-op when there is
 * nothing to seed. Persistence stays in seedVariantDecks (`importVariantDecks`).
 */
export function commitImportedVariantDecks(
  game: any,
  playerId: string,
  variants: { planar: any[]; schemes: any[] },
  options: { gameId?: string; random?: () => number } = {},
): { seeded: VariantSeedResult; messages: string[] } {
  const planar = Array.isArray(variants?.planar) ? variants.planar : [];
  const schemes = Array.isArray(variants?.schemes) ? variants.schemes : [];
  if (planar.length === 0 && schemes.length === 0) {
    const seeded: VariantSeedResult = { planarSeeded: 0, schemesSeeded: 0, notes: [], startingPlane: null };
    return { seeded, messages: [] };
  }
  const seeded = seedVariantDecks(game, playerId, { planar, schemes }, options);
  return { seeded, messages: variantSeedPlayerMessages(game?.state, seeded) };
}
