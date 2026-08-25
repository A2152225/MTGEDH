/**
 * Origin parent: client/src/utils/activatedAbilityParser.ts
 *
 * Cluster moved: parseManaProduction.
 *
 * Public entry symbols: parseManaProduction.
 */

/**
 * Parse mana symbols from oracle text
 * Returns the mana produced (e.g., '{W}', '{U}', '{G} or {U}')
 */
export function parseManaProduction(text: string): string | null {
  // Thriving lands: "Add {G} or one mana of the chosen color"
  if (/add\s+\{[wubrgc]\}\s+or\s+(?:one\s+)?mana\s+of\s+the\s+chosen\s+colou?r/i.test(text)) {
    const fixed = text.match(/add\s+(\{[wubrgc]\})/i)?.[1];
    return fixed ? `${fixed} or chosen color` : 'chosen color';
  }

  // Match "Add {X}" or "Add {X} or {Y}" patterns
  const addMatch = text.match(/add\s+(\{[^}]+\}(?:\s+or\s+\{[^}]+\})*)/i);
  if (addMatch) {
    return addMatch[1];
  }
  
  // Match "add one mana of any color"
  if (/add\s+one\s+mana\s+of\s+any\s+color/i.test(text)) {
    return 'any color';
  }
  
  // Match "add X mana of any one color"
  const anyColorMatch = text.match(/add\s+(\w+)\s+mana\s+of\s+any\s+(?:one\s+)?color/i);
  if (anyColorMatch) {
    return `${anyColorMatch[1]} mana of any color`;
  }

  // Match "add N mana of the chosen color"
  if (/add\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+mana\s+of\s+the\s+chosen\s+colou?r/i.test(text)) {
    return 'chosen color';
  }
  
  return null;
}

