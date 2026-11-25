/**
 * Splits the "becomes a N/N <words> creature with <abilities>" descriptors used by
 * animation clauses (Keyrunes, manlands, Licids) into card types/subtypes, colors
 * and keyword abilities.
 */

const COLOR_WORDS: Readonly<Record<string, string>> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

const ANIMATE_KEYWORDS = [
  'flying', 'deathtouch', 'haste', 'vigilance', 'trample', 'first strike', 'double strike',
  'lifelink', 'reach', 'menace', 'hexproof', 'indestructible', 'defender', 'shroud',
  'flash', 'prowess', 'ward {1}', 'ward {2}',
];

export interface AnimateTypeWords {
  readonly addTypes: string[];
  readonly colors: string[];
  readonly colorless: boolean;
}

/** "black and green Insect artifact" -> types [Insect, artifact], colors [B, G]. */
export function parseAnimateTypeWords(typeText: string): AnimateTypeWords {
  const addTypes: string[] = [];
  const colors: string[] = [];
  let colorless = false;
  for (const word of String(typeText || '').replace(/,/g, ' ').split(/\s+/).filter(Boolean)) {
    const lower = word.toLowerCase();
    if (lower === 'and' || lower === 'a' || lower === 'an') continue;
    if (lower === 'colorless') {
      colorless = true;
      continue;
    }
    const color = COLOR_WORDS[lower];
    if (color) {
      if (!colors.includes(color)) colors.push(color);
      continue;
    }
    addTypes.push(word);
  }
  return { addTypes, colors, colorless };
}

/** "flying and haste" / "deathtouch" / "first strike, vigilance" -> known keywords only. */
export function parseAnimateAbilityList(text: string): string[] {
  const out: string[] = [];
  const parts = String(text || '')
    .toLowerCase()
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (ANIMATE_KEYWORDS.includes(part) && !out.includes(part)) out.push(part);
  }
  return out;
}
