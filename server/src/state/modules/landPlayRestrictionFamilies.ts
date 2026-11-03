// server/src/state/modules/landPlayRestrictionFamilies.ts
// B48: land-play restrictions beyond the B34 flat ban (playerActionProhibitions.landPlayProhibitionSource).
// - "You can't play lands if ~ was cast this turn." (Rock Jockey): the source entered this turn from a cast.
// - "Players/Each player/You/Your opponents can't play more than one land each turn." -> cap 1.
// Origin parent: calculateMaxLandsPerTurn (game-state-effects-handlers/gameStateEffectsLandPlayDraw.ts).
// Public entry symbol: landPlayRestrictionCap.

function oracleText(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return [card.oracle_text || '', ...faces].join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function selfRef(text: string, name: string): string {
  const n = String(name || '').toLowerCase();
  let t = n ? text.split(n).join('~') : text;
  const short = n.split(',')[0].trim();
  if (short && short !== n) t = t.split(short).join('~');
  return t.replace(/this (?:creature|permanent)/g, '~');
}

const CAST_THIS_TURN_RE = /\byou can't play lands if (?:~ was cast|you cast (?:~|this spell)) this turn\b/;
const ONE_LAND_RE = /(?:^|\n|\. )(players|each player|you|your opponents|each opponent) can't play more than one land each turn\b/;

function appliesTo(who: string, controller: string, playerId: string): boolean {
  if (who === 'players' || who === 'each player') return true;
  if (who === 'you') return controller === playerId;
  return controller !== playerId;
}

function castThisTurn(perm: any): boolean {
  const cast = perm?.enteredFromCast === true || perm?.card?.enteredFromCast === true || perm?.wasCast === true;
  return cast && (perm?.enteredThisTurn === true || perm?.summoningSickness === true);
}

/** Returns the land-play cap (0 or 1) imposed on playerId, or null when no restriction applies. */
export function landPlayRestrictionCap(battlefield: readonly any[] | undefined, playerId: string): { cap: number; source: string } | null {
  const pid = String(playerId || '');
  let best: { cap: number; source: string } | null = null;
  for (const perm of Array.isArray(battlefield) ? battlefield : []) {
    if (!perm || perm.phasedOut) continue;
    const name = String(perm?.card?.name || 'A permanent');
    const text = selfRef(oracleText(perm), name);
    const controller = String(perm.controller || '');
    if (controller === pid && CAST_THIS_TURN_RE.test(text) && castThisTurn(perm)) return { cap: 0, source: name };
    const m = text.match(ONE_LAND_RE);
    if (m && appliesTo(m[1], controller, pid) && !best) best = { cap: 1, source: name };
  }
  return best;
}
