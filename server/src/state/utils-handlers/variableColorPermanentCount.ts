/**
 * variableColorPermanentCount.ts
 *
 * CDA reader: "~'s power and toughness are each equal to the number of [COLOR] permanents
 * you control" (e.g. Nightmare-style counts by color). Also covers "[COLOR] creatures".
 */

const COLOR_LETTER: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

const COLOR_COUNT_RE =
  /power and toughness are each equal to the number of (white|blue|black|red|green)(?: and\/or (white|blue|black|red|green))? (permanents|creatures) you control/;

export function permanentColorLetters(perm: any): string[] {
  const card = perm?.card || {};
  const explicit = Array.isArray(card.colors) ? card.colors : Array.isArray(perm?.colors) ? perm.colors : undefined;
  if (explicit) return explicit.map((c: any) => String(c).toUpperCase());
  const cost = String(card.mana_cost || '');
  const out = new Set<string>();
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) for (const ch of m[1].toUpperCase()) if ('WUBRG'.includes(ch)) out.add(ch);
  return [...out];
}

export function matchColorPermanentCountCDA(oracleLower: string): { colors: string[]; creaturesOnly: boolean } | null {
  const m = String(oracleLower || '').toLowerCase().match(COLOR_COUNT_RE);
  if (!m) return null;
  return { colors: [m[1], m[2]].filter(Boolean).map((c) => COLOR_LETTER[c]), creaturesOnly: m[3] === 'creatures' };
}

export function calculateColorPermanentCountPT(
  oracleLower: string,
  battlefield: readonly any[],
  controllerId: string | undefined,
): { power: number; toughness: number } | undefined {
  const spec = matchColorPermanentCountCDA(oracleLower);
  if (!spec || !controllerId) return undefined;
  const n = (battlefield || []).filter((p: any) => {
    if (!p || p.controller !== controllerId) return false;
    if (spec.creaturesOnly && !/\bcreature\b/i.test(String(p.card?.type_line || ''))) return false;
    const colors = permanentColorLetters(p);
    return spec.colors.some((c) => colors.includes(c));
  }).length;
  return { power: n, toughness: n };
}