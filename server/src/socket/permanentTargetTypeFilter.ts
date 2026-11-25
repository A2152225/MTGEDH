/**
 * socket/permanentTargetTypeFilter.ts
 *
 * Shared predicate for step `targetFilter.types` entries on battlefield-permanent prompts
 * (TAP_UNTAP_TARGET and friends). Entries used to be matched as literal substrings of the type
 * line, so "permanent" (Kelpie Guide, Vizier of Tumbling Sands) and color words (Homarid Shaman's
 * "green creature") rejected every legal target. An entry is one or more space-separated words,
 * all of which must hold:
 *   - "permanent"                      -> any battlefield permanent
 *   - white/blue/black/red/green       -> color (CR 105.2)
 *   - colorless / multicolored / monocolored
 *   - token / nontoken
 *   - non<word> / non-<word>           -> negation (Coeurl's "nonenchantment creature")
 *   - anything else                    -> type-line word (card type, supertype or subtype)
 *
 * Public entry symbols: permanentMatchesTargetTypeEntry, permanentMatchesTargetTypes.
 */

const COLOR_LETTERS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function permanentColors(perm: any): string[] {
  const raw = perm?.colors ?? perm?.card?.colors;
  if (Array.isArray(raw)) return raw.map((c: any) => String(c || '').trim().toUpperCase()).filter(Boolean);
  // No printed color array: derive from the mana cost symbols (CR 105.2, 202.2).
  const cost = String(perm?.card?.mana_cost || '').toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].filter((letter) => new RegExp(`\\{[^}]*${letter}[^}]*\\}`).test(cost));
}

function typeLineWords(perm: any): string[] {
  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  return typeLine.split(/[^a-z']+/).filter(Boolean);
}

function isTokenPermanent(perm: any): boolean {
  return perm?.isToken === true || perm?.card?.isToken === true || /\btoken\b/i.test(String(perm?.card?.type_line || ''));
}

function matchesWord(perm: any, word: string): boolean {
  const w = word.toLowerCase();
  if (!w || w === 'permanent' || w === 'permanents') return true;
  const neg = w.match(/^non-?(.+)$/);
  if (neg && w !== 'none') return !matchesWord(perm, neg[1]);
  if (COLOR_LETTERS[w]) return permanentColors(perm).includes(COLOR_LETTERS[w]);
  if (w === 'colorless') return permanentColors(perm).length === 0;
  if (w === 'multicolored') return permanentColors(perm).length > 1;
  if (w === 'monocolored') return permanentColors(perm).length === 1;
  if (w === 'token') return isTokenPermanent(perm);
  const words = typeLineWords(perm);
  const singular = w.endsWith('s') && !words.includes(w) ? w.slice(0, -1) : w;
  return words.includes(w) || words.includes(singular);
}

/** One `targetFilter.types` entry ("permanent", "green creature", "nonenchantment creature"). */
export function permanentMatchesTargetTypeEntry(perm: any, entry: unknown): boolean {
  const words = String(entry ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // Multi-word type-line phrases ("creature or land" is split by parsers already).
  return words.every((word) => matchesWord(perm, word));
}

/** Match a `targetFilter.types` list; `requireAll` keeps the existing all-of semantics. */
export function permanentMatchesTargetTypes(perm: any, types: unknown[], requireAll: boolean): boolean {
  const list = Array.isArray(types) ? types : [];
  if (list.length === 0) return true;
  return requireAll
    ? list.every((entry) => permanentMatchesTargetTypeEntry(perm, entry))
    : list.some((entry) => permanentMatchesTargetTypeEntry(perm, entry));
}
