/**
 * Continuous oracle-text rewrites (Swirl the Mists / Mind Bend style).
 * Overlays are applied when reading rules text — printed oracle is not mutated.
 */

const COLOR_WORDS = ['white', 'blue', 'black', 'red', 'green'] as const;

export type TextRewriteOverlay = {
  /** Replace all color words with this word (Swirl the Mists). */
  replaceAllColorWordsWith?: string;
  /** Targeted replacements (Mind Bend). */
  replacements?: ReadonlyArray<{ from: string; to: string }>;
};

function normalizeColorWord(raw: string | undefined): string | null {
  const key = String(raw || '').trim().toLowerCase();
  return (COLOR_WORDS as readonly string[]).includes(key) ? key : null;
}

/**
 * Collect active rewrite overlays from the battlefield.
 */
export function collectOracleTextRewriteOverlays(state: unknown): TextRewriteOverlay[] {
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const overlays: TextRewriteOverlay[] = [];

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const oracle = String(permanent.card.oracle_text || '').toLowerCase();
    const chosenWord = normalizeColorWord(
      permanent.chosenColorWord || permanent.card?.chosenColorWord || permanent.chosenColor || permanent.card?.chosenColor,
    );

    if (
      chosenWord
      && /all instances of color words in the text of spells and permanents are changed to the chosen color word/i.test(oracle)
    ) {
      overlays.push({ replaceAllColorWordsWith: chosenWord });
    }

    const objectRewrites = Array.isArray((permanent as any).textRewrites)
      ? (permanent as any).textRewrites as Array<{ from?: string; to?: string }>
      : [];
    for (const rewrite of objectRewrites) {
      const from = normalizeColorWord(rewrite?.from);
      const to = normalizeColorWord(rewrite?.to);
      if (from && to && from !== to) {
        overlays.push({ replacements: [{ from, to }] });
      }
    }
  }

  return overlays;
}

/**
 * Apply rewrite overlays to oracle text for rules evaluation.
 */
export function applyOracleTextRewriteOverlays(
  oracleText: string,
  overlays: readonly TextRewriteOverlay[],
): string {
  let text = String(oracleText || '');
  if (!text || overlays.length === 0) return text;

  for (const overlay of overlays) {
    if (overlay.replaceAllColorWordsWith) {
      const target = overlay.replaceAllColorWordsWith;
      text = text.replace(/\b(white|blue|black|red|green)\b/gi, target);
    }
    if (Array.isArray(overlay.replacements)) {
      for (const { from, to } of overlay.replacements) {
        if (!from || !to) continue;
        text = text.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
      }
    }
  }
  return text;
}

export function getEffectiveOracleText(
  cardOrPermanent: { oracle_text?: string; card?: { oracle_text?: string } } | null | undefined,
  state?: unknown,
): string {
  const printed = String(
    (cardOrPermanent as any)?.oracle_text
    || (cardOrPermanent as any)?.card?.oracle_text
    || '',
  );
  if (!state) return printed;
  // Every overlay only rewrites color words; skip the battlefield scan (O(board) per call,
  // called per permanent by continuous-effect passes) when there is nothing to rewrite.
  if (!/\b(?:white|blue|black|red|green)\b/i.test(printed)) return printed;
  const overlays = collectOracleTextRewriteOverlays(state);
  return applyOracleTextRewriteOverlays(printed, overlays);
}
