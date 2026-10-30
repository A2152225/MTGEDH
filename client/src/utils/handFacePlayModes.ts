// client/src/utils/handFacePlayModes.ts
// Which hand actions a card offers, judged per face instead of the combined
// "Front // Back" type line. A transforming card is played as its front face only
// (Ojer Taq, Deepest Foundation // Temple of Civilization is cast, never played as a land);
// a modal DFC may offer both (Spikefield Hazard // Spikefield Cave).
// Public entry symbols: handFacePlayModes.

type FaceLike = { type_line?: string | null } | null | undefined;

const LAND_RE = /\bland\b/i;

export function handFacePlayModes(card: {
  type_line?: string | null;
  layout?: string | null;
  card_faces?: FaceLike[] | null;
} | null | undefined): { canPlayAsLand: boolean; canCastAsSpell: boolean } {
  const layout = String(card?.layout || '').toLowerCase();
  const faces = Array.isArray(card?.card_faces) ? card!.card_faces!.filter(Boolean) : [];
  const faceTypeLines = faces.map((face) => String(face?.type_line || '')).filter(Boolean);

  if (faceTypeLines.length > 0 && layout === 'modal_dfc') {
    return {
      canPlayAsLand: faceTypeLines.some((tl) => LAND_RE.test(tl)),
      canCastAsSpell: faceTypeLines.some((tl) => !LAND_RE.test(tl)),
    };
  }

  const isMultiFace = faceTypeLines.length > 0 && /\/\//.test(String(card?.type_line || ''));
  const typeLine = isMultiFace && layout !== 'split' && layout !== 'adventure'
    ? faceTypeLines[0]
    : String(card?.type_line || '');
  const isLand = LAND_RE.test(typeLine);
  return { canPlayAsLand: isLand, canCastAsSpell: !isLand };
}
