/**
 * Color choice selection handlers
 *
 * Used for cards that require choosing a color as they enter the battlefield or resolve:
 * - Caged Sun - "As Caged Sun enters the battlefield, choose a color"
 * - Thriving Grove - "As it enters, choose a color other than green"
 * - Chromatic Lantern variants
 * - Color-specific protection effects
 * - Brave the Elements - "Choose a color. White creatures you control gain protection..."
 * etc.
 */

export type MagicColorName = 'white' | 'blue' | 'black' | 'red' | 'green';

const ALL_COLORS: readonly MagicColorName[] = ['white', 'blue', 'black', 'red', 'green'];

const COLOR_WORD_TO_NAME: Record<string, MagicColorName> = {
  white: 'white',
  blue: 'blue',
  black: 'black',
  red: 'red',
  green: 'green',
};

function normalizeExcludedColorWord(raw: string | undefined): MagicColorName | null {
  const key = String(raw || '').trim().toLowerCase();
  return COLOR_WORD_TO_NAME[key] || null;
}

/**
 * Check if a card requires color choice on ETB.
 * Also returns the legal color options (e.g. Thriving lands exclude one color).
 */
export function requiresColorChoice(card: any): {
  required: boolean;
  reason: string;
  colors?: MagicColorName[];
  excludedColors?: MagicColorName[];
} {
  if (!card) return { required: false, reason: '' };

  const name = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();

  // Caged Sun - "As Caged Sun enters the battlefield, choose a color"
  if (name.includes('caged sun')) {
    return { required: true, reason: "Choose a color for Caged Sun's effects", colors: [...ALL_COLORS] };
  }

  // Gauntlet of Power - "As Gauntlet of Power enters the battlefield, choose a color"
  if (name.includes('gauntlet of power')) {
    return { required: true, reason: 'Choose a color for Gauntlet of Power', colors: [...ALL_COLORS] };
  }

  // Extraplanar Lens - "As Extraplanar Lens enters the battlefield, you may choose a color"
  if (name.includes('extraplanar lens')) {
    return {
      required: true,
      reason: 'Choose a color for Extraplanar Lens (optional)',
      colors: [...ALL_COLORS],
    };
  }

  // Generic ETB color choice, including Thriving lands:
  // "As it enters, choose a color other than green."
  // "As Thriving Grove enters the battlefield, choose a color other than green."
  //
  // Must NOT match activated abilities like Three Tree City's
  // "{2}, {T}: Choose a color. Add an amount of mana..."
  const entersChooseColorPattern =
    /as .+? enters(?: the battlefield)?,?\s+(?:you may\s+)?choose a colou?r(?:\s+other\s+than\s+(white|blue|black|red|green))?\.?(?:\n|$|[.!?])/i;
  const match = oracleText.match(entersChooseColorPattern);
  if (match) {
    const excluded = normalizeExcludedColorWord(match[1]);
    const colors = excluded
      ? ALL_COLORS.filter((color) => color !== excluded)
      : [...ALL_COLORS];
    const reason = excluded
      ? `Choose a color other than ${excluded}`
      : 'Choose a color';
    return {
      required: true,
      reason,
      colors,
      ...(excluded ? { excludedColors: [excluded] } : {}),
    };
  }

  return { required: false, reason: '' };
}
