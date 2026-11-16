// server/src/state/modules/valgavothExilePlay.ts
// Valgavoth: during your turn, you may play cards exiled with it. If you
// cast a spell this way, pay life equal to its mana value rather than pay
// its mana cost. Public: mayPlayCardExiledWithValgavoth,
// getValgavothExileCastLifeCost, VALGAVOTH_EXILE_LIFE_COST_ID.

export const VALGAVOTH_EXILE_LIFE_COST_ID = 'valgavoth-exile-life';

const PLAY_EXILED_WITH_RE =
  /during your turn, you may play cards exiled with/i;

function cardManaValue(card: any): number {
  const raw = card?.mana_value ?? card?.cmc ?? card?.card?.mana_value ?? card?.card?.cmc;
  if (Number.isFinite(Number(raw))) return Math.max(0, Math.floor(Number(raw)));
  const cost = String(card?.mana_cost || card?.manaCost || card?.card?.mana_cost || '');
  const matches = cost.match(/\{([^}]+)\}/g) || [];
  let total = 0;
  for (const symbol of matches) {
    const inner = symbol.slice(1, -1);
    if (/^\d+$/.test(inner)) total += Number(inner);
    else if (/^x$/i.test(inner)) continue;
    else total += 1;
  }
  return total;
}

function isLandCard(card: any): boolean {
  const typeLine = String(card?.type_line || card?.typeLine || card?.card?.type_line || '').toLowerCase();
  return typeLine.includes('land') && !typeLine.includes('instant') && !typeLine.includes('sorcery');
}

export function listValgavothPlaySources(state: any, playerId: string): Array<{ id: string; name: string }> {
  const pid = String(playerId || '');
  if (String(state?.turnPlayer || state?.activePlayer || '') !== pid) return [];
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const out: Array<{ id: string; name: string }> = [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true || permanent.faceDown === true) continue;
    if (String(permanent.controller || '') !== pid) continue;
    const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '');
    if (!PLAY_EXILED_WITH_RE.test(oracle.replace(/\u2019/g, "'"))) continue;
    out.push({
      id: String(permanent.id || ''),
      name: String(permanent.card?.name || permanent.name || 'Valgavoth'),
    });
  }
  return out;
}

export function mayPlayCardExiledWithValgavoth(state: any, playerId: string, card: any): boolean {
  if (!card) return false;
  const sources = listValgavothPlaySources(state, playerId);
  if (sources.length === 0) return false;
  const stamped = String(card.exiledWith || card.exiledWithSourceId || card.exiledByPermanentId || '').trim();
  if (stamped && sources.some((source) => source.id === stamped)) return true;
  const stampedName = String(card.exiledBy || card.exiledWithName || '').trim().toLowerCase();
  if (stampedName && sources.some((source) => source.name.toLowerCase() === stampedName || stampedName.includes('valgavoth'))) {
    return true;
  }
  return false;
}

export function getValgavothExileCastLifeCost(state: any, playerId: string, card: any): number | null {
  if (!mayPlayCardExiledWithValgavoth(state, playerId, card)) return null;
  if (isLandCard(card)) return null;
  return cardManaValue(card);
}
