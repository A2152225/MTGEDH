/**
 * Planechase / Archenemy cards carried by an MTGJSON deck file.
 *
 * MTGJSON keeps them OUTSIDE the playable deck: `planes` (planes AND phenomena share
 * layout "planar") and `schemes`. The precon bake used to drop both. This module is pure
 * (no I/O) so the bake script, store and tests can share one classifier.
 *
 * Public: extractMtgJsonVariantCards, classifyPlanarType, classifySchemeType.
 *
 * Commander note: a deck's commanders come from the file's `commander` array, never from
 * `leadershipSkills.commander`. That flag only means "legal as a commander" (e.g. The Dalek
 * Emperor sits in Masters of Evil's 99 while Davros is the only commander).
 */

export type VariantCardKind = 'plane' | 'phenomenon' | 'scheme' | 'ongoing_scheme';

export type VariantCard = {
  name: string;
  kind: VariantCardKind;
  count: number;
  /** Scryfall oracle id when the MTGJSON card carries one (stable lookup key). */
  scryfallOracleId: string | null;
};

export type MtgJsonVariantCardInput = {
  name?: string;
  type?: string;
  count?: number;
  identifiers?: { scryfallOracleId?: string };
};

export type MtgJsonVariantDeckInput = {
  planes?: MtgJsonVariantCardInput[];
  schemes?: MtgJsonVariantCardInput[];
};

/** `planes` mixes planes and phenomena; split on the type line, not on layout. */
export function classifyPlanarType(typeLine: unknown): 'plane' | 'phenomenon' {
  return /\bphenomenon\b/i.test(String(typeLine || '')) ? 'phenomenon' : 'plane';
}

export function classifySchemeType(typeLine: unknown): 'scheme' | 'ongoing_scheme' {
  return /\bongoing\b/i.test(String(typeLine || '')) ? 'ongoing_scheme' : 'scheme';
}

function toVariantCards(
  cards: MtgJsonVariantCardInput[] | undefined,
  classify: (typeLine: unknown) => VariantCardKind,
): VariantCard[] {
  if (!Array.isArray(cards)) return [];
  const merged = new Map<string, VariantCard>();
  for (const card of cards) {
    const name = String(card?.name || '').trim();
    if (!name) continue;
    const kind = classify(card?.type);
    const key = `${kind}:${name.toLowerCase()}`;
    const count = Math.max(1, Number(card?.count) || 1);
    const existing = merged.get(key);
    if (existing) {
      existing.count += count;
      continue;
    }
    const oracleId = String(card?.identifiers?.scryfallOracleId || '').trim();
    merged.set(key, { name, kind, count, scryfallOracleId: oracleId || null });
  }
  return [...merged.values()];
}

/** Planar deck (planes + phenomena) first, then scheme deck, each in file order. */
export function extractMtgJsonVariantCards(deck: MtgJsonVariantDeckInput | null | undefined): {
  planar: VariantCard[];
  schemes: VariantCard[];
} {
  return {
    planar: toVariantCards(deck?.planes, classifyPlanarType),
    schemes: toVariantCards(deck?.schemes, classifySchemeType),
  };
}
