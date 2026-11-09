// server/src/state/modules/gyTopTextCopyStatic.ts
// B61: Volrath's Shapeshifter ? "As long as the top card of your graveyard is a creature card,
// this creature has the full text of that card and has the text "{2}: Discard a card.""
// Overlay helper for characteristics/text. Continuous-effect wiring applies the overlay when
// reading effective oracle / P/T for matching permanents.
// Public entry symbols: oracleHasGyTopCreatureTextCopy, getGyTopCreatureCard, applyGyTopTextCopyOverlay.

const COPY_RE =
  /as long as the top card of your graveyard is a creature card, (?:this creature|~) has the full text of that card and has the text ["']\{2\}: discard a card\.?["']/i;

const DISCARD_ABILITY = '{2}: Discard a card.';

export function oracleHasGyTopCreatureTextCopy(oracle: string): boolean {
  return COPY_RE.test(String(oracle || '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"'));
}

export function getGyTopCreatureCard(state: any, playerId: string): any | null {
  const gy = state?.zones?.[String(playerId || '')]?.graveyard;
  if (!Array.isArray(gy) || gy.length === 0) return null;
  const top = gy[gy.length - 1];
  if (!top) return null;
  const tl = String(top.type_line || top.card?.type_line || '').toLowerCase();
  return /\bcreature\b/.test(tl) ? top : null;
}

/**
 * Returns a shallow card overlay copying the GY-top creature's characteristics, always retaining
 * the "{2}: Discard a card." activated ability. Returns the original card when the CDA is inactive.
 */
export function applyGyTopTextCopyOverlay(permanent: any, state: any): any {
  if (!permanent?.card) return permanent?.card;
  const card = permanent.card;
  if (!oracleHasGyTopCreatureTextCopy(String(card.oracle_text || ''))) return card;
  const top = getGyTopCreatureCard(state, String(permanent.controller || ''));
  if (!top) return card;
  const topOracle = String(top.oracle_text || top.card?.oracle_text || '').trim();
  const mergedOracle = topOracle
    ? (topOracle.includes(DISCARD_ABILITY) ? topOracle : `${topOracle}\n${DISCARD_ABILITY}`)
    : DISCARD_ABILITY;
  return {
    ...card,
    name: String(top.name || top.card?.name || card.name),
    mana_cost: top.mana_cost ?? top.card?.mana_cost ?? card.mana_cost,
    manaCost: top.manaCost ?? top.card?.manaCost ?? card.manaCost,
    cmc: top.cmc ?? top.card?.cmc ?? card.cmc,
    type_line: String(top.type_line || top.card?.type_line || card.type_line),
    oracle_text: mergedOracle,
    power: top.power ?? top.card?.power ?? card.power,
    toughness: top.toughness ?? top.card?.toughness ?? card.toughness,
    colors: top.colors ?? top.card?.colors ?? card.colors,
    color_identity: top.color_identity ?? top.card?.color_identity ?? card.color_identity,
    keywords: top.keywords ?? top.card?.keywords ?? card.keywords,
    _gyTopTextCopyFrom: String(top.name || top.card?.name || ''),
  };
}
