/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: simple card-type parsing and card matching primitives used by zone-op selectors.
 * Public entry symbols: SimpleCardType, parseSimpleCardTypeFromText, cardMatchesType,
 * cardMatchesTotalPowerToughnessLte.
 *
 * Also exports the private helpers this cluster closed over; the parent still uses them in
 * later criteria parsers and graveyard/hand selectors.
 * Later ZoneOps extracts also moved toTitleCaseWords, parseCreatureSubtypeWord, and
 * parseCompoundCardTypeFromText here so parser leaves do not import the parent.
 */
import { isValidCreatureType } from '../../shared/src/creatureTypes';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export type SimpleCardType =
  | 'any'
  | 'permanent'
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'land'
  | 'instant'
  | 'sorcery'
  | 'planeswalker'
  | 'saga'
  | 'aura'
  | 'nonland'
  | 'noncreature_nonland_permanent'
  | 'instant_or_sorcery'
  | 'artifact_or_creature'
  | 'artifact_or_enchantment'
  | 'creature_or_land'
  | 'creature_or_planeswalker'
  | 'creature_or_equipment'
  | 'artifact_instant_or_sorcery'
  | 'creature_instant_or_sorcery'
  | 'non_dragon_creature'
  | 'legendary_creature'
  | 'legendary_permanent'
  | 'nonlegendary_permanent'
  | 'equipment'
  | 'noncreature';

const COLOR_WORD_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

export function normalizeCardColor(value: string | undefined): string | null {
  const lower = String(value || '').trim().toLowerCase();
  if (!lower) return null;
  if (lower === 'w' || lower === 'white') return 'W';
  if (lower === 'u' || lower === 'blue') return 'U';
  if (lower === 'b' || lower === 'black') return 'B';
  if (lower === 'r' || lower === 'red') return 'R';
  if (lower === 'g' || lower === 'green') return 'G';
  return null;
}

export function cardRepresentsPermanent(card: any): boolean {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  return (
    typeLine.includes('artifact') ||
    typeLine.includes('battle') ||
    typeLine.includes('creature') ||
    typeLine.includes('enchantment') ||
    typeLine.includes('land') ||
    typeLine.includes('planeswalker')
  );
}

export function getCardOracleText(card: any): string {
  return String(card?.oracle_text || card?.oracleText || card?.text || card?.card?.oracle_text || card?.card?.oracleText || '').trim();
}

export function collectCardColors(card: any): readonly string[] {
  const collected: string[] = [];

  for (const source of [card?.colors, card?.color_identity, card?.card?.colors, card?.card?.color_identity]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      const normalized = normalizeCardColor(String(entry || ''));
      if (normalized && !collected.includes(normalized)) collected.push(normalized);
    }
  }

  const manaCost = String(card?.mana_cost || card?.manaCost || card?.card?.mana_cost || card?.card?.manaCost || '');
  for (const [word, symbol] of Object.entries(COLOR_WORD_TO_SYMBOL)) {
    if (manaCost.includes(`{${symbol}}`) && !collected.includes(symbol)) {
      collected.push(symbol);
    }
    if (manaCost.toLowerCase().includes(`{${word[0]}}`) && !collected.includes(symbol)) {
      collected.push(symbol);
    }
  }

  const typeLine = getExecutorTypeLineLower(card);
  if (typeLine.includes('land')) {
    const basicLandColors: Array<[string, string]> = [
      ['plains', 'W'],
      ['island', 'U'],
      ['swamp', 'B'],
      ['mountain', 'R'],
      ['forest', 'G'],
    ];
    for (const [subtype, color] of basicLandColors) {
      if (typeLine.includes(subtype) && !collected.includes(color)) {
        collected.push(color);
      }
    }
  }

  return collected;
}

export function cardHasAllColors(card: any, requiredColors: readonly string[]): boolean {
  const colors = collectCardColors(card);
  return requiredColors.every(color => colors.includes(color));
}

export function cardHasAnyColors(card: any, requiredColors: readonly string[]): boolean {
  const colors = collectCardColors(card);
  return requiredColors.some(color => colors.includes(color));
}

export function getCardPower(card: any): number | null {
  const raw = (card as any)?.power ?? (card as any)?.card?.power;
  if (raw === undefined || raw === null || raw === '*') return null;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getCardToughness(card: any): number | null {
  const raw = (card as any)?.toughness ?? (card as any)?.card?.toughness;
  if (raw === undefined || raw === null || raw === '*') return null;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cardMatchesTotalPowerToughnessLte(card: any, maxTotal: number): boolean {
  const power = getCardPower(card);
  const toughness = getCardToughness(card);
  if (power === null || toughness === null) return false;
  return power + toughness <= maxTotal;
}

export function cardHasNoAbilities(card: any): boolean {
  const oracleText = getCardOracleText(card);
  if (oracleText) return false;

  for (const keywords of [card?.keywords, card?.card?.keywords, card?.abilities, card?.card?.abilities]) {
    if (Array.isArray(keywords) && keywords.length > 0) {
      return false;
    }
  }

  return true;
}

export function cardMatchesHistoric(card: any): boolean {
  const typeLine = getExecutorTypeLineLower(card);
  return typeLine.includes('artifact') || typeLine.includes('legendary') || typeLine.includes('saga');
}

export function splitTypeCriteriaList(text: string): readonly string[] {
  const normalized = String(text || '')
    .replace(/\s*,\s*or\s+/gi, ',')
    .replace(/\s+or\s+/gi, ',')
    .replace(/\s*,\s*/g, ',')
    .trim();
  if (!normalized) return [];
  return normalized
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

export function normalizeTypeCriteriaTerm(term: string): string {
  return String(term || '')
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[.\s]+$/g, '')
    .trim();
}

export function normalizeCreatureTypeCriteriaTerm(term: string): string | null {
  const normalized = normalizeTypeCriteriaTerm(term);
  if (!normalized) return null;
  for (const word of normalized.split(/[\s-]+/g)) {
    if (!word) return null;
  }
  const titleCased = normalized
    .split('-')
    .map(part =>
      part
        .split(/\s+/g)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    )
    .join('-');
  return isValidCreatureType(titleCased) ? titleCased : null;
}

export function cardTypeLineIncludesTerm(card: any, term: string): boolean {
  const typeLine = ` ${getExecutorTypeLineLower(card)} `;
  const normalized = normalizeTypeCriteriaTerm(term);
  if (!normalized) return false;
  const pattern = new RegExp(`(^|[^a-z])${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z]|$)`, 'i');
  return pattern.test(typeLine);
}

export function parseSmallNumberWord(text: string): number | null {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return null;
  if (/^\d+$/.test(lower)) return parseInt(lower, 10);
  const lookup: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  return Number.isFinite(lookup[lower]) ? lookup[lower] : null;
}

export function parseSimpleCardTypeFromText(text: string): SimpleCardType | null {
  const lower = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();

  if (!lower) return null;
  if (lower === 'nonland permanent') return 'nonland';
  if (lower === 'noncreature, nonland permanent' || lower === 'noncreature nonland permanent') {
    return 'noncreature_nonland_permanent';
  }
  if (lower === 'artifact or creature') return 'artifact_or_creature';
  if (lower === 'artifact or enchantment') return 'artifact_or_enchantment';
  if (lower === 'creature or land') return 'creature_or_land';
  if (lower === 'creature or planeswalker') return 'creature_or_planeswalker';
  if (lower === 'creature or equipment') return 'creature_or_equipment';
  if (lower === 'noncreature, nonland' || lower === 'noncreature nonland') {
    return 'noncreature_nonland_permanent';
  }
  if (lower === 'instant or sorcery' || lower === 'instant and/or sorcery') return 'instant_or_sorcery';
  if (lower === 'artifact, instant, or sorcery' || lower === 'artifact, instant or sorcery') {
    return 'artifact_instant_or_sorcery';
  }
  if (
    lower === 'instant, sorcery, or creature' ||
    lower === 'instant, sorcery or creature' ||
    lower === 'creature, instant, or sorcery' ||
    lower === 'creature, instant or sorcery'
  ) {
    return 'creature_instant_or_sorcery';
  }
  if (lower === 'saga') return 'saga';
  if (lower === 'permanent') return 'permanent';
  if (lower === 'nonland') return 'nonland';
  if (lower === 'aura') return 'aura';
  if (lower === 'non-dragon creature') return 'non_dragon_creature';
  if (lower === 'legendary creature') return 'legendary_creature';
  if (lower === 'legendary permanent') return 'legendary_permanent';
  if (lower === 'nonlegendary permanent') return 'nonlegendary_permanent';
  if (/\bcreature(s)?\b/i.test(lower)) return 'creature';
  if (/\bequipment(s)?\b/i.test(lower)) return 'equipment';
  if (/\bartifact(s)?\b/i.test(lower)) return 'artifact';
  if (/\benchantment(s)?\b/i.test(lower)) return 'enchantment';
  if (/\bland(s)?\b/i.test(lower)) return 'land';
  if (/\binstant(s)?\b/i.test(lower)) return 'instant';
  if (/\bsorcery|sorceries\b/i.test(lower)) return 'sorcery';
  if (/\bplaneswalker(s)?\b/i.test(lower)) return 'planeswalker';
  if (/\bsaga(s)?\b/i.test(lower)) return 'saga';
  return null;
}

// The tail of parseSimpleCardTypeFromText matches on a type word appearing anywhere in the text, so
// these results carry no guarantee that the rest of the text was understood. Every other return
// above is an exact-string match on a specific (possibly combined) type.
export const LOOSE_TYPE_WORD_FALLBACKS: ReadonlySet<SimpleCardType> = new Set<SimpleCardType>([
  'creature',
  'equipment',
  'artifact',
  'enchantment',
  'land',
  'instant',
  'sorcery',
  'planeswalker',
  'saga',
]);

export function cardMatchesType(card: any, type: SimpleCardType): boolean {
  const typeLine = getExecutorTypeLineLower(card);
  if (type === 'any') return true;
  if (type === 'permanent') {
    return cardRepresentsPermanent(card);
  }
  if (type === 'nonland') return !typeLine.includes('land');
  if (type === 'noncreature') return !typeLine.includes('creature');
  if (type === 'noncreature_nonland_permanent') {
    return cardRepresentsPermanent(card) && !typeLine.includes('creature') && !typeLine.includes('land');
  }
  if (type === 'aura') return typeLine.includes('aura');
  if (type === 'equipment') return typeLine.includes('equipment');
  if (type === 'instant_or_sorcery') return typeLine.includes('instant') || typeLine.includes('sorcery');
  if (type === 'artifact_or_creature') return typeLine.includes('artifact') || typeLine.includes('creature');
  if (type === 'artifact_or_enchantment') return typeLine.includes('artifact') || typeLine.includes('enchantment');
  if (type === 'creature_or_land') return typeLine.includes('creature') || typeLine.includes('land');
  if (type === 'creature_or_planeswalker') return typeLine.includes('creature') || typeLine.includes('planeswalker');
  if (type === 'creature_or_equipment') return typeLine.includes('creature') || typeLine.includes('equipment');
  if (type === 'artifact_instant_or_sorcery') {
    return typeLine.includes('artifact') || typeLine.includes('instant') || typeLine.includes('sorcery');
  }
  if (type === 'creature_instant_or_sorcery') {
    return typeLine.includes('creature') || typeLine.includes('instant') || typeLine.includes('sorcery');
  }
  if (type === 'non_dragon_creature') return typeLine.includes('creature') && !typeLine.includes('dragon');
  if (type === 'legendary_creature') return typeLine.includes('legendary') && typeLine.includes('creature');
  if (type === 'legendary_permanent') return typeLine.includes('legendary') && cardMatchesType(card, 'permanent');
  if (type === 'nonlegendary_permanent') return !typeLine.includes('legendary') && cardMatchesType(card, 'permanent');
  return typeLine.includes(type);
}

export function toTitleCaseWords(value: string): string {
  return String(value || '')
    .split(/[\s-]+/g)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function parseCreatureSubtypeWord(typeText: string): string | null {
  const normalized = String(typeText || '').replace(/\s+/g, ' ').trim();
  const creatureTypeAndCreatureMatch = normalized.match(/^([a-z][a-z' -]+)\s+creature$/i);
  if (creatureTypeAndCreatureMatch) {
    const creatureType = toTitleCaseWords(String(creatureTypeAndCreatureMatch[1] || '').trim());
    return isValidCreatureType(creatureType) ? creatureType : null;
  }
  const singleWord = toTitleCaseWords(normalized);
  return isValidCreatureType(singleWord) ? singleWord : null;
}

export function parseCompoundCardTypeFromText(typeText: string): SimpleCardType | null {
  const normalized = String(typeText || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized === 'artifact and enchantment' || normalized === 'artifact or enchantment') {
    return 'artifact_or_enchantment';
  }
  if (normalized === 'artifact and creature' || normalized === 'artifact or creature') {
    return 'artifact_or_creature';
  }
  if (normalized === 'creature and planeswalker' || normalized === 'creature or planeswalker') {
    return 'creature_or_planeswalker';
  }
  if (normalized === 'creature and equipment' || normalized === 'creature or equipment') {
    return 'creature_or_equipment';
  }
  return null;
}
