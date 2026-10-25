/**
 * Batch 14 (census #19): "~ is all colors." — a characteristic-defining ability (CR 604.3, 105.2):
 * the object is white, blue, black, red and green in every zone (Sphinx of the Guildpact, Fallaji Wayfarer,
 * O-Kagachi Made Manifest). Read by getEffectiveColors.
 */
export const ALL_COLOR_SYMBOLS = ['W', 'U', 'B', 'R', 'G'];

export function hasSelfAllColorsCDA(card: any): boolean {
  if (!card || card.isFaceDownStub === true) return false;
  const text = String(card.oracle_text || '');
  if (!/is all colors/i.test(text)) return false;
  const name = String(card.name || '').split(' // ')[0].trim();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const subject = `(?:this (?:creature|card|spell|permanent|artifact|enchantment)|~${esc ? `|${esc}` : ''})`;
  return new RegExp(`(?:^|\\n)\\s*${subject} is all colors\\.?\\s*(?:$|\\n)`, 'i').test(text);
}