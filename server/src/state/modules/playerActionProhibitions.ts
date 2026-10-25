// server/src/state/modules/playerActionProhibitions.ts
// Batch 34: static player prohibitions read straight from battlefield oracle text.
// - "Players can't play lands." / "You can't play lands." / "Your opponents can't play lands."
//   (Worms of the Earth, Territorial Dispute) -> land plays per turn become 0.
// - "You can't cast noncreature spells." / "You can't cast spells." (Nullhide Ferox, Nikya of the Old Ways).
// Origin parents: calculateMaxLandsPerTurn (gameStateEffectsLandPlayDraw.ts) and
// findOracleCastingLimitViolation (staticCastingRestrictionsOracleExtras.ts).
// Public entry symbols: landPlayProhibitionSource, selfCastProhibitionReason.

function oracleText(perm: any): string {
  const card = perm?.card || {};
  const faces = Array.isArray(card.card_faces) ? card.card_faces.map((f: any) => f?.oracle_text || '') : [];
  return [card.oracle_text || '', ...faces].join('\n').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

const LAND_BAN_RE = /(?:^|\n|\. )(players|each player|you|your opponents|each opponent) can't play lands\b/;
const SELF_CAST_RE = /(?:^|\n|\. )(you|players|each player) can't cast (noncreature )?spells(?=\.|$|\n)/;

function appliesTo(who: string, controller: string, playerId: string): boolean {
  if (who === 'players' || who === 'each player') return true;
  if (who === 'you') return controller === playerId;
  return controller !== playerId;
}

export function landPlayProhibitionSource(battlefield: readonly any[] | undefined, playerId: string): string | null {
  const pid = String(playerId || '');
  for (const perm of Array.isArray(battlefield) ? battlefield : []) {
    if (!perm || perm.phasedOut) continue;
    const m = oracleText(perm).match(LAND_BAN_RE);
    if (!m) continue;
    if (appliesTo(m[1], String(perm.controller || ''), pid)) return String(perm?.card?.name || 'A permanent');
  }
  return null;
}

export function selfCastProhibitionReason(battlefield: readonly any[] | undefined, playerId: string, spell: any): string | null {
  const pid = String(playerId || '');
  const typeLine = String(spell?.type_line ?? spell?.card?.type_line ?? spell?.typeLine ?? '');
  const isCreature = /\bcreature\b/i.test(typeLine);
  for (const perm of Array.isArray(battlefield) ? battlefield : []) {
    if (!perm || perm.phasedOut) continue;
    const m = oracleText(perm).match(SELF_CAST_RE);
    if (!m) continue;
    if (!appliesTo(m[1], String(perm.controller || ''), pid)) continue;
    if (m[2] && isCreature) continue;
    const name = String(perm?.card?.name || 'A permanent');
    return m[2] ? `${name} prevents casting noncreature spells.` : `${name} prevents casting spells.`;
  }
  return null;
}
