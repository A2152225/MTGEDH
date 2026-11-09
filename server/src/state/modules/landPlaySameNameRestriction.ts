// server/src/state/modules/landPlaySameNameRestriction.ts
// B61: Cornered Market ? "Players can't play nonbasic lands with the same name as a nontoken permanent."
// Public entry symbols: landPlaySameNameAsNontokenViolation.

function normName(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function oracleOf(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return [card.oracle_text || '', ...faces].join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function isBasicLandCard(card: any): boolean {
  return /\bbasic\b/i.test(String(card?.type_line || ''));
}

const LAND_LINE_RE = /players can't play nonbasic lands with the same name as a nontoken permanent/;

/** Returns a human reason when the land play is banned, else null. */
export function landPlaySameNameAsNontokenViolation(
  battlefield: readonly any[] | undefined,
  landCard: any,
): string | null {
  if (!landCard || isBasicLandCard(landCard)) return null;
  const landName = normName(landCard?.name);
  if (!landName) return null;
  const board = Array.isArray(battlefield) ? battlefield : [];
  const clash = board.some((p: any) => {
    if (!p || p.phasedOut) return false;
    if (p.isToken === true || p.card?.isToken === true) return false;
    return normName(p.card?.name || p.name) === landName;
  });
  if (!clash) return null;
  for (const perm of board) {
    if (!perm || perm.phasedOut) continue;
    if (!LAND_LINE_RE.test(oracleOf(perm))) continue;
    const src = String(perm.card?.name || 'A permanent');
    return `${src} prevents playing nonbasic lands with the same name as a nontoken permanent.`;
  }
  return null;
}
