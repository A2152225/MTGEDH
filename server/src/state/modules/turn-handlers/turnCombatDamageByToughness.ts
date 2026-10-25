// server/src/state/modules/turn-handlers/turnCombatDamageByToughness.ts
// CR 510.1a: "assigns combat damage equal to its toughness rather than its
// power" - Doran (each creature), Assault Formation / High Alert / Huatli
// (each creature you control), Ghalta-style "with toughness greater than its
// power", Arcades "with defender", and self "~ assigns ...".
// Public entry symbols: assignsCombatDamageByToughness, combatDamageAssignmentAmount.

const CORE = 'assigns? combat damage equal to (?:its|their) toughness rather than (?:its|their) power';
const EACH_RE = new RegExp(`\\beach creature( you control)?( with defender| with toughness greater than its power)? ${CORE}`);
const SELF_RE = new RegExp(`(?:\\bthis creature|~) ${CORE}`);

function lowerOracle(perm: any): string {
  return String(perm?.card?.oracle_text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function hasDefender(perm: any): boolean {
  const keywords = Array.isArray(perm?.card?.keywords) ? perm.card.keywords : [];
  if (keywords.some((k: unknown) => String(k).toLowerCase() === 'defender')) return true;
  const granted = Array.isArray(perm?.grantedAbilities) ? perm.grantedAbilities : [];
  if (granted.some((k: unknown) => String(k).toLowerCase() === 'defender')) return true;
  return /^defender\b/m.test(lowerOracle(perm));
}

export function assignsCombatDamageByToughness(
  perm: any,
  battlefield: readonly any[],
  stats?: { power: number; toughness: number },
): boolean {
  if (!perm) return false;
  if (perm.assignsDamageByToughness === true) return true;
  const name = String(perm?.card?.name || '').toLowerCase();
  const own = name ? lowerOracle(perm).split(name).join('~') : lowerOracle(perm);
  if (SELF_RE.test(own)) return true;
  for (const source of battlefield || []) {
    const text = lowerOracle(source);
    if (!text.includes('toughness rather than')) continue;
    const m = text.match(EACH_RE);
    if (!m) continue;
    if (m[1] && String(source?.controller || '') !== String(perm?.controller || '')) continue;
    if (m[2] === ' with defender' && !hasDefender(perm)) continue;
    if (m[2] && m[2] !== ' with defender') {
      if (!stats || !(stats.toughness > stats.power)) continue;
    }
    return true;
  }
  return false;
}

export function combatDamageAssignmentAmount(
  ctx: any,
  perm: any,
  stats: { power: number; toughness: number },
): number {
  const battlefield = Array.isArray(ctx?.state?.battlefield) ? ctx.state.battlefield : [];
  if (assignsCombatDamageByToughness(perm, battlefield, stats)) return Math.max(0, Number(stats.toughness) || 0);
  return stats.power;
}
