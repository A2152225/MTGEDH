const COMMON_GRANTED_ABILITIES = [
  'flying',
  'indestructible',
  'vigilance',
  'trample',
  'hexproof',
  'shroud',
  'deathtouch',
  'lifelink',
  'haste',
  'menace',
  'reach',
  'first strike',
  'double strike',
  'protection',
  'ward',
  'wither',
  'infect',
];

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCounterName(value: unknown): string {
  return normalizeText(value)
    .replace(/ counters?$/i, '')
    .replace(/^an?\s+/i, '')
    .trim();
}

function parseGrantedAbilities(text: string): string[] {
  const normalized = normalizeText(text);
  const found = new Set<string>();
  for (const ability of COMMON_GRANTED_ABILITIES) {
    if (normalized.includes(ability)) {
      found.add(ability);
    }
  }
  return Array.from(found);
}

function getCounterEntries(permanent: any): Array<[string, number]> {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) return [];
  return Object.entries(counters as Record<string, unknown>).map(([name, amount]) => [name, Number(amount || 0)]);
}

export function getCounterValue(permanent: any, counterName: string): number {
  const target = normalizeCounterName(counterName);
  for (const [name, amount] of getCounterEntries(permanent)) {
    if (normalizeCounterName(name) === target && amount > 0) {
      return amount;
    }
  }
  return 0;
}

export function permanentHasCounter(permanent: any, counterName: string): boolean {
  return getCounterValue(permanent, counterName) > 0;
}

export function removeSingleCounter(permanent: any, counterName: string): boolean {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) return false;

  const target = normalizeCounterName(counterName);
  for (const [name, amountRaw] of Object.entries(counters as Record<string, unknown>)) {
    const amount = Number(amountRaw || 0);
    if (normalizeCounterName(name) !== target || amount <= 0) continue;

    const next = amount - 1;
    if (next > 0) {
      (counters as any)[name] = next;
    } else {
      delete (counters as any)[name];
    }

    if (Object.keys(counters as Record<string, unknown>).length === 0) {
      permanent.counters = undefined;
    }
    return true;
  }

  return false;
}

export function clearMarkedPermanentDamage(permanent: any): void {
  if (!permanent || typeof permanent !== 'object') return;
  permanent.damage = 0;
  permanent.markedDamage = 0;
  permanent.damageMarked = 0;
  if (permanent.counters && typeof permanent.counters === 'object' && !Array.isArray(permanent.counters)) {
    if ('damage' in permanent.counters) {
      delete permanent.counters.damage;
      if (Object.keys(permanent.counters).length === 0) {
        permanent.counters = undefined;
      }
    }
  }
}

export function applyShieldCounterDamagePrevention(permanent: any): boolean {
  if (!permanentHasCounter(permanent, 'shield')) return false;
  const removed = removeSingleCounter(permanent, 'shield');
  if (removed) {
    clearMarkedPermanentDamage(permanent);
  }
  return removed;
}

export function applyDamageToPermanentWithCounterEffects(
  permanent: any,
  amount: number,
  damageField: 'damage' | 'markedDamage' | 'damageMarked' = 'damageMarked'
): { prevented: boolean; appliedAmount: number } {
  const normalizedAmount = Math.max(0, Number(amount || 0));
  if (!permanent || normalizedAmount <= 0) {
    return { prevented: false, appliedAmount: 0 };
  }

  if (applyShieldCounterDamagePrevention(permanent)) {
    return { prevented: true, appliedAmount: 0 };
  }

  permanent[damageField] = Number(permanent[damageField] || 0) + normalizedAmount;
  return { prevented: false, appliedAmount: normalizedAmount };
}

export function getCounterLeaveBattlefieldReplacement(
  permanent: any,
  destination: 'graveyard' | 'exile' | 'hand'
): 'graveyard' | 'exile' | 'hand' {
  if (destination !== 'graveyard') return destination;

  const typeLine = normalizeText(permanent?.card?.type_line || permanent?.type_line || '');
  const isCreature = typeLine.includes('creature');
  if (isCreature && permanentHasCounter(permanent, 'finality')) {
    return 'exile';
  }

  return destination;
}

export function getCounterGrantedAbilities(state: any, permanent: any): string[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const granted = new Set<string>();
  const isCreature = normalizeText(permanent?.card?.type_line || permanent?.type_line || '').includes('creature');

  for (const source of battlefield) {
    const oracle = normalizeText(source?.card?.oracle_text || source?.oracle_text || '');
    if (!oracle) continue;

    const pluralScopeMatches = oracle.matchAll(/(?:each|all)?\s*(creatures|permanents)\s+with\s+(?:a|an)\s+([a-z0-9+'\/-]+)\s+counters?\s+on\s+them\s+have\s+([^.]+)/gi);
    for (const match of pluralScopeMatches) {
      const scope = normalizeText(match[1]);
      const counterName = normalizeCounterName(match[2]);
      if (scope === 'creatures' && !isCreature) continue;
      if (!permanentHasCounter(permanent, counterName)) continue;
      for (const ability of parseGrantedAbilities(String(match[3] || ''))) {
        granted.add(ability);
      }
    }

    const singularScopeMatches = oracle.matchAll(/(?:each|all)?\s*(creature|permanent)\s+with\s+(?:a|an)\s+([a-z0-9+'\/-]+)\s+counter\s+on\s+it\s+has\s+([^.]+)/gi);
    for (const match of singularScopeMatches) {
      const scope = normalizeText(match[1]);
      const counterName = normalizeCounterName(match[2]);
      if (scope === 'creature' && !isCreature) continue;
      if (!permanentHasCounter(permanent, counterName)) continue;
      for (const ability of parseGrantedAbilities(String(match[3] || ''))) {
        granted.add(ability);
      }
    }

    const conditionalMatch = oracle.match(/(?:that creature|that permanent|it) has ([^.]+?) for as long as it has (?:a|an) ([a-z0-9+'\/-]+) counter on it/);
    if (conditionalMatch) {
      const counterName = normalizeCounterName(conditionalMatch[2]);
      const creatureOnly = oracle.includes('that creature has');
      if ((!creatureOnly || isCreature) && permanentHasCounter(permanent, counterName)) {
        for (const ability of parseGrantedAbilities(String(conditionalMatch[1] || ''))) {
          granted.add(ability);
        }
      }
    }
  }

  return Array.from(granted);
}

export function permanentHasCounterGrantedAbility(state: any, permanent: any, ability: string): boolean {
  const target = normalizeText(ability);
  return getCounterGrantedAbilities(state, permanent).some((entry) => normalizeText(entry) === target);
}
