/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: getPermanentKeywordSet and getPermanentCombatStats used by
 * keyword-counter scoring and some option prompts.
 *
 * Public entry symbols: getPermanentKeywordSet, getPermanentCombatStats.
 */

export function getPermanentKeywordSet(permanent: any): Set<string> {
  const keywords = new Set<string>();

  for (const keyword of Array.isArray(permanent?.card?.keywords) ? permanent.card.keywords : []) {
    const normalized = String(keyword || '').trim().toLowerCase();
    if (normalized) keywords.add(normalized);
  }

  for (const ability of Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : []) {
    const normalized = String(ability || '').trim().toLowerCase();
    if (normalized) keywords.add(normalized);
  }

  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  for (const [counterName, amount] of Object.entries(counters)) {
    if (Number(amount || 0) <= 0) continue;
    const normalized = String(counterName || '').trim().toLowerCase();
    if (normalized && !normalized.includes('+') && !normalized.includes('-')) {
      keywords.add(normalized);
    }
  }

  return keywords;
}

export function getPermanentCombatStats(permanent: any): { power: number; toughness: number } {
  return {
    power: Number(permanent?.card?.power || permanent?.basePower || 0) || 0,
    toughness: Number(permanent?.card?.toughness || permanent?.baseToughness || 0) || 0,
  };
}
