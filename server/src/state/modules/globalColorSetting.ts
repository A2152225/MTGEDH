// server/src/state/modules/globalColorSetting.ts
// B46: global layer 5 colour SETTING on permanents (Thran Lens "All permanents are colorless";
// "All creatures are black" style lines). Additions ("in addition to") are handled elsewhere.
// Public entry symbols: readGlobalColorSetting.

const WORD: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const LINE_RE = /(?:^|[.\n]\s*)all (permanents|nonland permanents|creatures|artifacts|enchantments|lands) are (colorless|white|blue|black|red|green)(?=[.\s]|$)(?! in addition)/gi;

function typeOk(group: string, typeLine: string): boolean {
  const t = typeLine.toLowerCase();
  switch (group.toLowerCase()) {
    case 'permanents': return true;
    case 'nonland permanents': return !/\bland\b/.test(t);
    case 'creatures': return /\bcreature\b/.test(t);
    case 'artifacts': return /\bartifact\b/.test(t);
    case 'enchantments': return /\benchantment\b/.test(t);
    case 'lands': return /\bland\b/.test(t);
    default: return false;
  }
}

/** Colour setters applying to a battlefield object; colorless=true when a "colorless" setter applies. */
export function readGlobalColorSetting(state: any, object: any): { set: string[]; colorless: boolean } {
  const out = { set: [] as string[], colorless: false };
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const id = String(object?.id || '');
  if (!id || !battlefield.some((p: any) => p && String(p.id) === id)) return out;
  const typeLine = String(object?.card?.type_line || object?.type_line || '');
  for (const perm of battlefield) {
    const oracle = String(perm?.card?.oracle_text || '');
    if (!/\ball [a-z ]+ are (?:colorless|white|blue|black|red|green)/i.test(oracle)) continue;
    LINE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINE_RE.exec(oracle))) {
      if (!typeOk(m[1], typeLine)) continue;
      const c = m[2].toLowerCase();
      if (c === 'colorless') out.colorless = true;
      else if (!out.set.includes(WORD[c])) out.set.push(WORD[c]);
    }
  }
  return out;
}
