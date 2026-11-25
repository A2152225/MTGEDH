/**
 * socket/colorChoiceSelection.ts
 *
 * COLOR_CHOICE steps list colors either as plain words ("white") or as option objects
 * ({ id: 'W', label: 'White' } from effect-program prompts). Answers arrive as either form.
 * These helpers compare both shapes as color words so a legal answer is never rejected.
 *
 * Public entry symbols: normalizeColorChoiceWord, colorChoiceStepColorWords.
 */
const COLOR_WORD_BY_KEY: Record<string, string> = {
  w: 'white', u: 'blue', b: 'black', r: 'red', g: 'green',
  '{w}': 'white', '{u}': 'blue', '{b}': 'black', '{r}': 'red', '{g}': 'green',
  white: 'white', blue: 'blue', black: 'black', red: 'red', green: 'green',
};

/** "W" / "{W}" / "White" / { id: 'W' } -> "white"; undefined for non-colors. */
export function normalizeColorChoiceWord(value: unknown): string | undefined {
  const parts = value && typeof value === 'object'
    ? [(value as any).id, (value as any).value, (value as any).label, (value as any).color]
    : [value];
  for (const part of parts) {
    const word = COLOR_WORD_BY_KEY[String(part ?? '').trim().toLowerCase()];
    if (word) return word;
  }
  return undefined;
}

/** Color words offered by a step's `colors` list (all five when the list is missing). */
export function colorChoiceStepColorWords(colors: unknown): string[] {
  if (!Array.isArray(colors) || colors.length === 0) return ['white', 'blue', 'black', 'red', 'green'];
  return colors.map((entry) => normalizeColorChoiceWord(entry)).filter((word): word is string => Boolean(word));
}
