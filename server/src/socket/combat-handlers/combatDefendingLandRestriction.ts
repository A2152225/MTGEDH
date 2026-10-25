// server/src/socket/combat-handlers/combatDefendingLandRestriction.ts
// Origin parent: combatDeclareAttackersSupport.ts (getOwnerAttackRestrictionReason).
// "This creature can't attack unless defending player controls an Island."
// Works for any land type word on the defender's lands (basic or nonbasic
// subtypes such as Desert / Gate / Cave, and "snow land"-style supertypes).
// Public entry symbols: getDefendingLandAttackRestrictionReason.

const DEFENDING_LAND_RE =
  /can(?:not|'t) attack unless defending player controls (an?) ((?:[a-z]+ )?[a-z]+)\b/i;

function landMatches(perm: any, words: string[]): boolean {
  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  if (!/\bland\b/.test(typeLine)) return false;
  return words.every((word) => word === 'land' || new RegExp('\\b' + word + '\\b').test(typeLine));
}

export function getDefendingLandAttackRestrictionReason(
  creature: any,
  defendingPlayerId: string | undefined,
  battlefield: readonly any[] | undefined,
): string | null {
  const text = String(creature?.card?.oracle_text || creature?.oracle_text || '').replace(/\u2019/g, "'");
  const match = text.match(DEFENDING_LAND_RE);
  if (!match) return null;
  const defender = String(defendingPlayerId || '').trim();
  if (!defender) return null;
  const phrase = String(match[2] || '').toLowerCase().trim();
  const words = phrase.split(/\s+/).map((word) => word.replace(/s$/, (s) => (word === 'plains' ? s : '')));
  const ok = (Array.isArray(battlefield) ? battlefield : []).some((perm: any) => (
    String(perm?.controller || '') === defender && landMatches(perm, words)
  ));
  return ok ? null : `can't attack unless defending player controls ${match[1]} ${phrase}`;
}
