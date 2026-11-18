/**
 * Fuse / split-card fused-spell face building (CR 702.102 / 709.4).
 * Used by cast face selection and hand cast-evaluation candidates.
 * Public entry: cardHasFuseKeyword, buildFusedSpellCard, stripFuseReminderText.
 */

const FUSE_REMINDER_RE =
  /\n?Fuse\s*\([^)]*\)\.?/gi;

export function cardHasFuseKeyword(card: any): boolean {
  const keywords = Array.isArray(card?.keywords)
    ? card.keywords.map((k: any) => String(k || '').toLowerCase())
    : [];
  if (keywords.some((k: string) => k === 'fuse')) return true;

  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const texts = [
    String(card?.oracle_text || card?.oracleText || ''),
    ...faces.map((face: any) => String(face?.oracle_text || face?.oracleText || '')),
  ];
  return texts.some((text) => /\bfuse\b/i.test(text));
}

export function stripFuseReminderText(oracleText: string): string {
  return String(oracleText || '')
    .replace(FUSE_REMINDER_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function combineManaCostStrings(left: string, right: string): string {
  return `${String(left || '').trim()}${String(right || '').trim()}`;
}

function combineTypeLines(left: string, right: string): string {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  return `${a} // ${b}`;
}

function combineColors(left: any, right: any, fallback: any): string[] | undefined {
  const merged = new Set<string>();
  for (const source of [left, right, fallback]) {
    if (!Array.isArray(source)) continue;
    for (const color of source) {
      const normalized = String(color || '').trim().toUpperCase();
      if (normalized) merged.add(normalized);
    }
  }
  return merged.size > 0 ? Array.from(merged) : undefined;
}

/**
 * Build the on-stack characteristics for a fused split spell (both halves).
 * Only legal from hand; caller must enforce zone.
 */
export function buildFusedSpellCard(card: any): any | null {
  if (!card || typeof card === 'string') return null;
  const layout = String(card?.layout || '').toLowerCase();
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  if (layout !== 'split' || faces.length < 2 || !cardHasFuseKeyword(card)) {
    return null;
  }

  const left = faces[0];
  const right = faces[1];
  const leftName = String(left?.name || 'Left').trim() || 'Left';
  const rightName = String(right?.name || 'Right').trim() || 'Right';
  const leftCost = String(left?.mana_cost ?? left?.manaCost ?? '').trim();
  const rightCost = String(right?.mana_cost ?? right?.manaCost ?? '').trim();
  const manaCost = combineManaCostStrings(leftCost, rightCost);
  const leftOracle = stripFuseReminderText(String(left?.oracle_text || left?.oracleText || ''));
  const rightOracle = stripFuseReminderText(String(right?.oracle_text || right?.oracleText || ''));
  const oracleText = [leftOracle, rightOracle].filter(Boolean).join('\n');
  const typeLine = combineTypeLines(
    String(left?.type_line || left?.typeLine || ''),
    String(right?.type_line || right?.typeLine || ''),
  );
  const colors = combineColors(left?.colors, right?.colors, card?.colors);

  return {
    ...card,
    name: `${leftName} // ${rightName}`,
    type_line: typeLine || card?.type_line,
    oracle_text: oracleText || card?.oracle_text,
    mana_cost: manaCost || card?.mana_cost,
    manaCost: manaCost || card?.manaCost,
    ...(colors ? { colors } : {}),
    castAsFused: true,
    faceIndex: undefined,
  };
}
