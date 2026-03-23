export function getColorsFromObject(obj: any): readonly string[] {
  const normalizeColor = (value: unknown): string | null => {
    const color = String(value || '').trim().toUpperCase();
    return ['W', 'U', 'B', 'R', 'G'].includes(color) ? color : null;
  };

  const fromArray = (value: unknown): readonly string[] => {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      const normalized = normalizeColor(item);
      if (normalized && !out.includes(normalized)) out.push(normalized);
    }
    return out;
  };

  const direct = fromArray((obj as any)?.colors);
  if (direct.length > 0) return direct;
  const nested = fromArray((obj as any)?.card?.colors);
  if (nested.length > 0) return nested;
  const spellColors = fromArray((obj as any)?.spell?.colors);
  if (spellColors.length > 0) return spellColors;

  const colorIndicator = fromArray((obj as any)?.colorIndicator);
  if (colorIndicator.length > 0) return colorIndicator;
  const nestedColorIndicator = fromArray((obj as any)?.card?.colorIndicator);
  if (nestedColorIndicator.length > 0) return nestedColorIndicator;
  const spellColorIndicator = fromArray((obj as any)?.spell?.colorIndicator);
  if (spellColorIndicator.length > 0) return spellColorIndicator;

  const colorIdentity = fromArray((obj as any)?.colorIdentity);
  if (colorIdentity.length > 0) return colorIdentity;
  const nestedColorIdentity = fromArray((obj as any)?.card?.colorIdentity);
  if (nestedColorIdentity.length > 0) return nestedColorIdentity;
  const spellColorIdentity = fromArray((obj as any)?.spell?.colorIdentity);
  if (spellColorIdentity.length > 0) return spellColorIdentity;

  const manaCost = String(
    (obj as any)?.manaCost ||
      (obj as any)?.mana_cost ||
      (obj as any)?.card?.manaCost ||
      (obj as any)?.card?.mana_cost ||
      (obj as any)?.spell?.manaCost ||
      (obj as any)?.spell?.mana_cost ||
      ''
  ).toUpperCase();

  if (!manaCost) return [];
  const out: string[] = [];
  for (const symbol of ['W', 'U', 'B', 'R', 'G']) {
    if (manaCost.includes(symbol)) out.push(symbol);
  }
  return out;
}

export function countManaSymbolsInManaCost(obj: any, colorSymbol: string): number {
  const symbol = String(colorSymbol || '').trim().toUpperCase();
  if (!symbol) return 0;

  const manaCost = String(
    (obj as any)?.manaCost ||
      (obj as any)?.mana_cost ||
      (obj as any)?.card?.manaCost ||
      (obj as any)?.card?.mana_cost ||
      ''
  ).trim();
  if (!manaCost) return 0;

  let total = 0;
  const symbols = Array.from(manaCost.matchAll(/\{([^}]+)\}/g));
  for (const sym of symbols) {
    const inner = String(sym?.[1] || '').toUpperCase();
    if (inner.includes(symbol)) total += 1;
  }
  return total;
}

export function normalizeManaColorCode(value: unknown): string | null {
  const rawCode = String(value || '').trim().toLowerCase();
  if (!rawCode) return null;
  if (rawCode === 'w' || rawCode === 'white') return 'W';
  if (rawCode === 'u' || rawCode === 'blue') return 'U';
  if (rawCode === 'b' || rawCode === 'black') return 'B';
  if (rawCode === 'r' || rawCode === 'red') return 'R';
  if (rawCode === 'g' || rawCode === 'green') return 'G';
  return null;
}

export function getColorsOfManaSpent(obj: any): number | null {
  if (!obj) return null;

  const fromArray = (value: unknown): number | null => {
    if (!Array.isArray(value)) return null;
    const seen = new Set<string>();
    for (const item of value) {
      const normalized = normalizeManaColorCode(item);
      if (normalized) seen.add(normalized);
    }
    return seen.size;
  };

  const fromRecord = (value: unknown): number | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rec = value as Record<string, unknown>;
    const colorKeys: readonly string[] = ['white', 'blue', 'black', 'red', 'green', 'w', 'u', 'b', 'r', 'g'];
    const seen = new Set<string>();
    for (const key of colorKeys) {
      const n = Number(rec[key]);
      if (!Number.isFinite(n) || n <= 0) continue;
      const normalized = normalizeManaColorCode(key);
      if (normalized) seen.add(normalized);
    }
    return seen.size > 0 ? seen.size : null;
  };

  const candidates: unknown[] = [
    obj?.manaColorsSpent,
    obj?.card?.manaColorsSpent,
    obj?.manaSpentColors,
    obj?.card?.manaSpentColors,
    obj?.manaPayment,
    obj?.card?.manaPayment,
    obj?.manaSpent,
    obj?.card?.manaSpent,
  ];

  for (const candidate of candidates) {
    const fromA = fromArray(candidate);
    if (fromA !== null) return fromA;
    const fromR = fromRecord(candidate);
    if (fromR !== null) return fromR;
  }

  return null;
}

export function getAmountOfManaSpent(obj: any): number | null {
  if (!obj) return null;

  const directNumbers = [
    obj?.manaSpentTotal,
    obj?.card?.manaSpentTotal,
    obj?.totalManaSpent,
    obj?.card?.totalManaSpent,
  ];
  for (const value of directNumbers) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, n);
  }

  const sumFromRecord = (value: unknown): number | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rec = value as Record<string, unknown>;
    const keys: readonly string[] = ['white', 'blue', 'black', 'red', 'green', 'colorless', 'generic', 'w', 'u', 'b', 'r', 'g', 'c'];
    let total = 0;
    let used = false;
    for (const key of keys) {
      const n = Number(rec[key]);
      if (!Number.isFinite(n) || n <= 0) continue;
      total += n;
      used = true;
    }
    return used ? total : null;
  };

  const recordCandidates: unknown[] = [
    obj?.manaPayment,
    obj?.card?.manaPayment,
    obj?.manaSpent,
    obj?.card?.manaSpent,
  ];
  for (const candidate of recordCandidates) {
    const summed = sumFromRecord(candidate);
    if (summed !== null) return summed;
  }

  const arrayCandidates: unknown[] = [
    obj?.manaColorsSpent,
    obj?.card?.manaColorsSpent,
    obj?.manaSpentColors,
    obj?.card?.manaSpentColors,
  ];
  for (const candidate of arrayCandidates) {
    if (Array.isArray(candidate)) return candidate.length;
  }

  return null;
}

export function getAmountOfSpecificManaSymbolSpent(obj: any, symbolRaw: string): number | null {
  if (!obj) return null;

  const symbol = String(symbolRaw || '').trim().toUpperCase();
  if (!symbol) return null;

  const mapKey = (() => {
    if (symbol === 'W') return 'white';
    if (symbol === 'U') return 'blue';
    if (symbol === 'B') return 'black';
    if (symbol === 'R') return 'red';
    if (symbol === 'G') return 'green';
    if (symbol === 'C') return 'colorless';
    if (symbol === 'S') return 'snow';
    if (symbol === 'E') return 'energy';
    return null;
  })();
  if (!mapKey) return null;

  const fromRecord = (value: unknown): number | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rec = value as Record<string, unknown>;

    const aliases = new Set<string>([
      mapKey,
      mapKey[0],
      symbol.toLowerCase(),
      symbol,
    ]);
    if (symbol === 'S') {
      aliases.add('snowmana');
    } else if (symbol === 'E') {
      aliases.add('energycounter');
      aliases.add('energycounters');
      aliases.add('energyspent');
      aliases.add('spentenergy');
    }

    for (const key of aliases) {
      const n = Number(rec[key]);
      if (Number.isFinite(n)) return Math.max(0, n);
    }

    return 0;
  };

  const fromArray = (value: unknown): number | null => {
    if (!Array.isArray(value)) return null;
    let count = 0;
    for (const item of value as any[]) {
      const color = String(item?.manaColor || item?.color || item || '').trim().toUpperCase();
      if (!color) continue;
      if (symbol === 'S') {
        if (color === 'S' || color === 'SNOW') count += 1;
        continue;
      }
      if (symbol === 'E') {
        if (color === 'E' || color === 'ENERGY') count += 1;
        continue;
      }
      if (color === symbol || color === mapKey.toUpperCase()) count += 1;
    }
    return count;
  };

  const candidates: unknown[] = [
    obj?.manaPayment,
    obj?.card?.manaPayment,
    obj?.manaSpent,
    obj?.card?.manaSpent,
    obj?.manaSpentSymbols,
    obj?.card?.manaSpentSymbols,
  ];

  for (const candidate of candidates) {
    const fromR = fromRecord(candidate);
    if (fromR !== null) return fromR;
    const fromA = fromArray(candidate);
    if (fromA !== null) return fromA;
  }

  return null;
}
