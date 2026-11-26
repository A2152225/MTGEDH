/**
 * Shared additional-cost type-line matching.
 *
 * Sacrifice/return cost filters were previously tested with
 * typeLine.includes(filter), which fails for:
 *   - "artifact or creature" (no type line contains that whole phrase)
 *   - "nonland" (the substring "nonland" never appears on a type line)
 *   - "creature or pay" leftover from "sacrifice a creature or pay N life"
 *   - "creature with power 4 or greater" (Savage Order): the stat qualifier is split off and
 *     checked against the permanent (power / toughness / mana value; or greater|more|less|fewer, or exact).
 */

type AdditionalCostStatQualifier = { stat: 'power' | 'toughness' | 'mana value'; value: number; comparison: '>=' | '<=' | '=' };

const STAT_QUALIFIER_RE = /\s*\bwith (?:a )?(power|toughness|mana value|converted mana cost) (\d+)(?: or (greater|more|less|fewer))?\b/g;

function splitAdditionalCostQualifiers(filter: string): { typeFilter: string; qualifiers: AdditionalCostStatQualifier[] } {
  const qualifiers: AdditionalCostStatQualifier[] = [];
  const typeFilter = filter.replace(STAT_QUALIFIER_RE, (_m, stat: string, value: string, direction?: string) => {
    qualifiers.push({
      stat: stat === 'converted mana cost' ? 'mana value' : (stat as AdditionalCostStatQualifier['stat']),
      value: Number.parseInt(value, 10),
      comparison: !direction ? '=' : (direction === 'greater' || direction === 'more' ? '>=' : '<='),
    });
    return '';
  }).trim();
  return { typeFilter, qualifiers };
}

function permanentStat(permanent: any, stat: AdditionalCostStatQualifier['stat']): number {
  const card = permanent?.card || {};
  const raw = stat === 'power'
    ? (permanent?.effectivePower ?? permanent?.power ?? card.power)
    : stat === 'toughness'
      ? (permanent?.effectiveToughness ?? permanent?.toughness ?? card.toughness)
      : (card.cmc ?? card.mana_value ?? permanent?.cmc);
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function normalizeAdditionalCostTypeFilter(raw: string | null | undefined): string {
  let filter = String(raw || '').toLowerCase().trim();
  if (!filter) return '';
  filter = filter.replace(/\s+or\s+pay\s+(\{[^}]+\}|\d+\s+life).*$/i, '').trim();
  filter = filter.replace(/\s+(?:permanent|permanents|card|cards)\.?$/i, '').trim();
  return filter;
}

export function parseSacrificeAdditionalCostFilter(raw: string | null | undefined): {
  filter: string;
  orPayLife?: number;
  orPayMana?: string;
} {
  const source = String(raw || '').toLowerCase().trim();
  const life = source.match(/\bor\s+pay\s+(\d+)\s+life\b/i);
  const mana = source.match(/\bor\s+pay\s+(\{[^}]+\})/i);
  const filter = normalizeAdditionalCostTypeFilter(source);
  const result: { filter: string; orPayLife?: number; orPayMana?: string } = { filter };
  if (life) {
    const amount = Number.parseInt(life[1], 10);
    if (Number.isFinite(amount) && amount > 0) result.orPayLife = amount;
  }
  if (mana) result.orPayMana = mana[1];
  return result;
}

function typeWords(typeLine: string | null | undefined): string[] {
  return String(typeLine || '')
    .toLowerCase()
    .replace(/[\u2014\u2013-]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function tokenMatchesTypes(token: string, types: string[]): boolean {
  const normalized = String(token || '').toLowerCase().trim();
  if (!normalized) return true;
  if (/^non-/.test(normalized) && normalized.length > 4) {
    return !types.includes(normalized.slice(4));
  }
  if (/^non/.test(normalized) && normalized.length > 3) {
    return !types.includes(normalized.slice(3));
  }
  return types.includes(normalized);
}

export function typeLineMatchesAdditionalCostFilter(
  typeLine: string | null | undefined,
  filter?: string | null,
): boolean {
  const normalized = splitAdditionalCostQualifiers(normalizeAdditionalCostTypeFilter(filter)).typeFilter;
  if (!normalized) return true;
  const types = typeWords(typeLine);
  const alternatives = normalized.split(/\s+or\s+/).map((part) => part.trim()).filter(Boolean);
  if (alternatives.length === 0) return true;
  return alternatives.some((token) => tokenMatchesTypes(token, types));
}

export function permanentMatchesAdditionalCostTypeFilter(permanent: any, filter?: string | null): boolean {
  const typeLine = permanent?.card?.type_line || permanent?.type_line || '';
  if (!typeLineMatchesAdditionalCostFilter(typeLine, filter)) return false;
  const { qualifiers } = splitAdditionalCostQualifiers(normalizeAdditionalCostTypeFilter(filter));
  return qualifiers.every((q) => {
    const value = permanentStat(permanent, q.stat);
    return q.comparison === '>=' ? value >= q.value : q.comparison === '<=' ? value <= q.value : value === q.value;
  });
}
