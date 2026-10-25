// server/src/state/modules/colorSettingMarker.ts
// Layer 5 colour SETTING (CR 613.1e / 105.3): "is a blue Frog creature" replaces every other colour.
// Setters ride the existing colorAdditions pipeline as "SET:<symbol>" entries so every stamp/reader
// that forwards additions also forwards them; resolveColorsWithSetting turns them into a replacement.
// Public entry symbols: COLOR_SET_PREFIX, colorSetEntry, resolveColorsWithSetting.

export const COLOR_SET_PREFIX = 'SET:';

const WORD: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/** "blue" / "U" -> "SET:U" (null for non-colours). */
export function colorSetEntry(raw: string): string | null {
  const k = String(raw || '').trim();
  const sym = WORD[k.toLowerCase()] || (/^[wubrg]$/i.test(k) ? k.toUpperCase() : '');
  return sym ? COLOR_SET_PREFIX + sym : null;
}

/**
 * Printed colours plus additions, honouring setters: when any SET: entry is present the printed
 * colours are dropped and the set colours replace them; plain additions still add on top.
 */
export function resolveColorsWithSetting(printed: readonly string[], rawAdditions: readonly unknown[]): string[] {
  const set: string[] = [];
  const add: string[] = [];
  for (const raw of rawAdditions || []) {
    const s = String(raw || '').trim();
    if (s.toUpperCase().startsWith(COLOR_SET_PREFIX)) set.push(s.slice(COLOR_SET_PREFIX.length).toUpperCase());
    else if (s) add.push(s);
  }
  return [...new Set([...(set.length ? set : printed), ...add])];
}
