// Characteristics of a double-faced card as it is put onto the battlefield.
// Rule 712.14/712.11: a transforming or modal double-faced card put onto the battlefield
// enters with its front face up unless an effect (e.g. playing a modal DFC's back land face)
// chose another face, so the permanent must not keep the combined "Front // Back" type line.
// Off the battlefield the card has its combined characteristics again (rule 712.8a), so a\n// bounced Boggart Trawler can still be played as Boggart Bog.\n// Public entry symbols: applyDoubleFacedEntryFace, restoreDoubleFacedCombinedCharacteristics.

const DFC_LAYOUTS = new Set(['modal_dfc', 'transform']);

export function applyDoubleFacedEntryFace(card: any): any {
  if (!card || typeof card !== 'object') return card;
  const faces = Array.isArray(card.card_faces) ? card.card_faces : [];
  if (faces.length < 2 || !DFC_LAYOUTS.has(String(card.layout || '').toLowerCase())) return card;
  if (!String(card.type_line || '').includes('//')) return card; // a face was already applied
  const chosen = Number.isInteger(card.selectedMDFCFace) ? Number(card.selectedMDFCFace) : 0;
  const face = faces[chosen] || faces[0];
  if (!face) return card;
  const next: any = { ...card, name: face.name ?? card.name, type_line: face.type_line ?? '', oracle_text: face.oracle_text ?? '' };
  next.mana_cost = face.mana_cost ?? '';
  if (face.power !== undefined) next.power = face.power; else delete next.power;
  if (face.toughness !== undefined) next.toughness = face.toughness; else delete next.toughness;
  if (face.loyalty !== undefined) next.loyalty = face.loyalty; else delete next.loyalty;
  if (face.image_uris) next.image_uris = face.image_uris;
  if (String(card.layout).toLowerCase() === 'modal_dfc') next.selectedMDFCFace = chosen;
  return next;
}

export function restoreDoubleFacedCombinedCharacteristics(card: any): any {
  if (!card || typeof card !== 'object') return card;
  const faces = Array.isArray(card.card_faces) ? card.card_faces : [];
  if (faces.length < 2 || !DFC_LAYOUTS.has(String(card.layout || '').toLowerCase())) return card;
  if (String(card.type_line || '').includes('//') && card.selectedMDFCFace === undefined && !card.transformed) return card;
  const next: any = {
    ...card,
    name: faces.map((f: any) => f?.name).filter(Boolean).join(' // ') || card.name,
    type_line: faces.map((f: any) => f?.type_line || '').join(' // '),
    oracle_text: faces.map((f: any) => f?.oracle_text || '').join('\n//\n'),
    mana_cost: faces[0]?.mana_cost ?? '',
  };
  for (const key of ['power', 'toughness', 'loyalty', 'selectedMDFCFace', 'transformed', 'image_uris'] as const) delete next[key];
  return next;
}