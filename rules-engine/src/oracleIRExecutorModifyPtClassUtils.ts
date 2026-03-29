import type { BattlefieldPermanent } from '../../shared/src';
import { normalizeControlledClassKey } from './oracleIRExecutorCreatureStepUtils';

type TypeLineLower = (value: any) => string;
type NormalizeManaColorCode = (value: unknown) => string | null;
type GetColors = (permanent: BattlefieldPermanent) => readonly string[];
type HasExecutorClass = (permanent: BattlefieldPermanent | any, klass: string) => boolean;
type GetCardManaValue = (card: any) => number | null;
type GetCreatureSubtypeKeys = (permanent: BattlefieldPermanent | any) => readonly string[];

export function countCardsByClasses(
  cards: readonly any[],
  classes: readonly string[],
  typeLineLower: TypeLineLower
): number {
  return cards.filter((card: any) => {
    const tl = typeLineLower(card);
    if (!tl) return false;
    return classes.some((klass) => {
      if (klass === 'permanent') {
        return (
          tl.includes('artifact') ||
          tl.includes('battle') ||
          tl.includes('creature') ||
          tl.includes('enchantment') ||
          tl.includes('land') ||
          tl.includes('planeswalker')
        );
      }
      if (klass === 'nonland permanent') {
        return (
          (tl.includes('artifact') ||
            tl.includes('battle') ||
            tl.includes('creature') ||
            tl.includes('enchantment') ||
            tl.includes('planeswalker')) &&
          !tl.includes('land')
        );
      }
      if (klass === 'instant' || klass === 'sorcery') return tl.includes(klass);
      return tl.includes(klass);
    });
  }).length;
}

export function parseCardClassList(text: string): readonly string[] | null {
  const normalized = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\bcards?\b/g, '')
    .replace(/\band\/or\b/g, 'and')
    .replace(/\band\s+or\b/g, 'and')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const parts = normalized
    .split(/\s*,\s*|\s+and\s+|\s+or\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const classes: string[] = [];
  for (const part of parts) {
    const direct = normalizeControlledClassKey(part);
    const mapped = direct || (/^instants?$/.test(part) ? 'instant' : /^sorceries$|^sorcery$/.test(part) ? 'sorcery' : null);
    if (!mapped) return null;
    if (!classes.includes(mapped)) classes.push(mapped);
  }
  return classes;
}

export function parseClassList(text: string): readonly string[] | null {
  const normalized = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\bcards?\b/g, '')
    .replace(/\band\/or\b/g, 'and')
    .replace(/\band\s+or\b/g, 'and')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const parts = normalized
    .split(/\s*,\s*|\s+and\s+|\s+or\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const classes: string[] = [];
  for (const part of parts) {
    const mapped = normalizeControlledClassKey(part);
    if (!mapped) return null;
    if (!classes.includes(mapped)) classes.push(mapped);
  }
  return classes;
}

export function parseColorQualifiedClassSpec(
  text: string,
  normalizeManaColorCode: NormalizeManaColorCode
): { readonly classes: readonly string[]; readonly requiredColor?: string } | null {
  const normalized = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return null;

  const colorMatch = normalized.match(/^(white|blue|black|red|green)\s+(.+)$/i);
  if (!colorMatch) {
    const classes = parseClassList(text);
    return classes ? { classes } : null;
  }

  const requiredColor = normalizeManaColorCode(colorMatch[1]);
  const classes = parseClassList(String(colorMatch[2] || ''));
  if (!requiredColor || !classes) return null;
  return { classes, requiredColor };
}

export function countPermanentsByClasses(
  permanents: readonly BattlefieldPermanent[],
  classes: readonly string[],
  getColors: GetColors,
  hasExecutorClass: HasExecutorClass,
  typeLineLower: TypeLineLower,
  requiredColor?: string
): number {
  return permanents.filter((permanent: any) => {
    if (requiredColor && !getColors(permanent).includes(requiredColor)) return false;
    return classes.some((klass) => {
      if (klass === 'permanent') return hasExecutorClass(permanent, 'permanent');
      if (klass === 'nonland permanent') return hasExecutorClass(permanent, 'nonland permanent');
      return hasExecutorClass(permanent, klass);
    });
  }).length;
}

export function countNegatedClass(
  permanents: readonly BattlefieldPermanent[],
  base: 'creature' | 'permanent',
  excludedQualifier: string,
  hasExecutorClass: HasExecutorClass,
  typeLineLower: TypeLineLower,
  excludedId?: string
): number {
  return permanents.filter((permanent: any) => {
    const id = String((permanent as any)?.id || '').trim();
    if (excludedId && id === excludedId) return false;
    const tl = typeLineLower(permanent);
    if (!tl) return false;
    if (!hasExecutorClass(permanent, base)) return false;
    return excludedQualifier ? !tl.includes(excludedQualifier) : true;
  }).length;
}

export function leastStatAmongCreatures(
  permanents: readonly BattlefieldPermanent[],
  which: 'power' | 'toughness',
  hasExecutorClass: HasExecutorClass,
  typeLineLower: TypeLineLower,
  opts?: { readonly excludedId?: string; readonly excludedSubtype?: string }
): number {
  let least: number | null = null;
  for (const permanent of permanents as any[]) {
    const id = String((permanent as any)?.id || '').trim();
    if (opts?.excludedId && id === opts.excludedId) continue;
    const tl = typeLineLower(permanent);
    if (!hasExecutorClass(permanent, 'creature')) continue;
    if (opts?.excludedSubtype && tl.includes(opts.excludedSubtype)) continue;
    const n = Number(which === 'power' ? permanent?.power : permanent?.toughness);
    if (!Number.isFinite(n)) continue;
    least = least === null ? n : Math.min(least, n);
  }
  return least ?? 0;
}

export function greatestStatAmongCreatures(
  permanents: readonly BattlefieldPermanent[],
  which: 'power' | 'toughness',
  hasExecutorClass: HasExecutorClass,
  typeLineLower: TypeLineLower,
  opts?: { readonly excludedId?: string; readonly excludedSubtype?: string }
): number {
  let greatest = 0;
  for (const permanent of permanents as any[]) {
    const id = String((permanent as any)?.id || '').trim();
    if (opts?.excludedId && id === opts.excludedId) continue;
    const tl = typeLineLower(permanent);
    if (!hasExecutorClass(permanent, 'creature')) continue;
    if (opts?.excludedSubtype && tl.includes(opts.excludedSubtype)) continue;
    const n = Number(which === 'power' ? permanent?.power : permanent?.toughness);
    if (!Number.isFinite(n)) continue;
    greatest = Math.max(greatest, n);
  }
  return greatest;
}

export function lowestManaValueAmongPermanents(
  permanents: readonly BattlefieldPermanent[],
  getCardManaValue: GetCardManaValue,
  hasExecutorClass: HasExecutorClass,
  typeLineLower: TypeLineLower,
  opts?: { readonly excludedId?: string; readonly excludedQualifier?: string }
): number {
  let least: number | null = null;
  for (const permanent of permanents as any[]) {
    const id = String((permanent as any)?.id || '').trim();
    if (opts?.excludedId && id === opts.excludedId) continue;
    const tl = typeLineLower(permanent);
    if (!hasExecutorClass(permanent, 'permanent')) continue;
    if (opts?.excludedQualifier && tl.includes(opts.excludedQualifier)) continue;
    const manaValue = getCardManaValue(permanent?.card || permanent);
    if (manaValue === null) continue;
    least = least === null ? manaValue : Math.min(least, manaValue);
  }
  return least ?? 0;
}

export function highestManaValueAmongPermanents(
  permanents: readonly BattlefieldPermanent[],
  getCardManaValue: GetCardManaValue,
  hasExecutorClass: HasExecutorClass,
  typeLineLower: TypeLineLower,
  opts?: { readonly excludedId?: string; readonly excludedQualifier?: string }
): number {
  let greatest = 0;
  for (const permanent of permanents as any[]) {
    const id = String((permanent as any)?.id || '').trim();
    if (opts?.excludedId && id === opts.excludedId) continue;
    const tl = typeLineLower(permanent);
    if (opts?.excludedQualifier && tl.includes(opts.excludedQualifier)) continue;
    if (!hasExecutorClass(permanent, 'permanent')) continue;
    const manaValue = getCardManaValue(permanent?.card || permanent);
    if (manaValue === null) continue;
    greatest = Math.max(greatest, manaValue);
  }
  return greatest;
}

export function greatestPowerAmongCreatureCards(
  cards: readonly any[],
  typeLineLower: TypeLineLower
): number {
  let greatest = 0;
  for (const card of cards as any[]) {
    const tl = typeLineLower(card);
    if (!tl.includes('creature')) continue;
    const n = Number((card as any)?.power ?? (card as any)?.card?.power);
    if (!Number.isFinite(n)) continue;
    greatest = Math.max(greatest, n);
  }
  return greatest;
}

export function greatestManaValueAmongCards(
  cards: readonly any[],
  getCardManaValue: GetCardManaValue
): number {
  let greatest = 0;
  for (const card of cards as any[]) {
    const manaValue = getCardManaValue((card as any)?.card || card);
    if (manaValue === null) continue;
    greatest = Math.max(greatest, manaValue);
  }
  return greatest;
}

export function greatestSharedCreatureSubtypeCount(
  permanents: readonly BattlefieldPermanent[],
  hasExecutorClass: HasExecutorClass,
  getCreatureSubtypeKeys: GetCreatureSubtypeKeys
): number {
  const subtypeCounts = new Map<string, number>();
  for (const permanent of permanents as any[]) {
    if (!hasExecutorClass(permanent, 'creature')) continue;
    const subtypeSet = new Set(getCreatureSubtypeKeys(permanent));
    for (const subtype of subtypeSet) {
      subtypeCounts.set(subtype, (subtypeCounts.get(subtype) || 0) + 1);
    }
  }

  let greatest = 0;
  for (const count of subtypeCounts.values()) {
    if (count > greatest) greatest = count;
  }
  return greatest;
}
