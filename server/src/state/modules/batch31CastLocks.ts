// server/src/state/modules/batch31CastLocks.ts
// Batch 31: absolute cast prohibitions read from battlefield oracle text.
//   "Players can't cast spells from graveyards or libraries." (Grafdigger's Cage, Weathered Runestone)
//   "During your turn, your opponents can't cast spells or activate abilities of ..." (Grand Abolisher, Myrel)
// B73: "Nonland permanent cards in graveyards and libraries can't enter the battlefield." (Weathered Runestone)
// Origin parent: cast gates in gameActionsRequestCastSpellModes / ForceFlash / graveyard cast execution / top-library.
// Public entry symbols: zoneCastProhibitionReason, opponentTurnCastProhibitionReason, zoneEnterProhibitionReason.

const ZONE_RE = /^(players|your opponents|each opponent) can't cast spells from (graveyards or libraries|libraries or graveyards|graveyards|libraries)\b/;
const TURN_RE = /^during your turn, (?:your opponents|each opponent) can't cast spells\b/;
const ENTER_RE = /^(nonland permanent cards|permanent cards|creature cards) in (graveyards and libraries|libraries and graveyards|graveyards|libraries) can(?:not|'t) enter the battlefield\b/;
/** B84: Worms of the Earth — "Lands can't enter the battlefield." */
const LAND_ENTER_RE = /^lands can(?:not|'t) enter the battlefield\b/;

function oracleLines(perm: any): string[] {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '')
    .replace(/\u2019/g, "'").toLowerCase().split(/\n+/).map((l) => l.trim());
}
function sourceName(perm: any): string {
  return String(perm?.card?.name || perm?.name || 'A permanent');
}

/** Reason string when this player can't cast spells from the given zone, else null. */
export function zoneCastProhibitionReason(state: any, playerId: string, zone: 'graveyard' | 'library'): string | null {
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    for (const line of oracleLines(perm)) {
      const m = line.match(ZONE_RE);
      if (!m) continue;
      if (m[1] !== 'players' && String(perm?.controller || '') === String(playerId)) continue;
      if (!m[2].includes(zone === 'graveyard' ? 'graveyard' : 'librar')) continue;
      return `${sourceName(perm)} prevents casting spells from ${zone === 'graveyard' ? 'graveyards' : 'libraries'}.`;
    }
  }
  return null;
}

/**
 * B73: Weathered Runestone / Grafdigger's Cage enter lock.
 * Returns a reason when a card of the given type line can't enter from zone.
 */
export function zoneEnterProhibitionReason(
  state: any,
  zone: 'graveyard' | 'library',
  typeLine: string,
): string | null {
  const tl = String(typeLine || '').toLowerCase();
  const isLand = /\bland\b/.test(tl);
  const isCreature = /\bcreature\b/.test(tl);
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    for (const line of oracleLines(perm)) {
      if (LAND_ENTER_RE.test(line) && isLand) {
        return `${sourceName(perm)} prevents lands from entering the battlefield.`;
      }
      const m = line.match(ENTER_RE);
      if (!m) continue;
      if (!m[2].includes(zone === 'graveyard' ? 'graveyard' : 'librar')) continue;
      const subject = m[1];
      if (subject === 'nonland permanent cards' && isLand) continue;
      if (subject === 'creature cards' && !isCreature) continue;
      return `${sourceName(perm)} prevents cards from entering the battlefield from ${zone === 'graveyard' ? 'graveyards' : 'libraries'}.`;
    }
  }
  return null;
}

/** Reason string when an opponent's "during your turn, your opponents can't cast spells" applies, else null. */
export function opponentTurnCastProhibitionReason(state: any, playerId: string): string | null {
  const turnPlayer = String(state?.turnPlayer ?? state?.activePlayer ?? '');
  if (!turnPlayer || turnPlayer === String(playerId)) return null;
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (String(perm?.controller || '') !== turnPlayer) continue;
    if (oracleLines(perm).some((line) => TURN_RE.test(line))) {
      return `${sourceName(perm)} prevents you from casting spells during its controller's turn.`;
    }
  }
  return null;
}
