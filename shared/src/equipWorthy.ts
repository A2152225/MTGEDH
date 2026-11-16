// shared/src/equipWorthy.ts
// B97: "Equip worthy {M} (A creature is worthy if it's a legendary
// non-Villain that's red and/or white.)" (Mjölnir, Hammer of Thor). The
// shared equip parser already has a 'worthy' qualifier; this module reads the
// reminder definition and tests creatures against it. Public:
// parseWorthyDefinition, permanentMatchesWorthyDefinition,
// attachWorthyDefinitionToQualifiers.

const COLOR_WORDS: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

export interface WorthyDefinition {
  legendary: boolean;
  nonTypes: string[];
  types: string[];
  colors: string[];
  /** 'any' = "red and/or white"; 'all' = "red and white". */
  colorMode: 'any' | 'all';
}

const WORTHY_DEF_RE = /a creature is worthy if it's (?:an? )?(.+?)\./i;

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

export function parseWorthyDefinition(oracleText: string): WorthyDefinition | null {
  const text = normalize(oracleText);
  const m = text.match(WORTHY_DEF_RE);
  if (!m) return null;
  const body = String(m[1] || '').toLowerCase();
  const nonTypes: string[] = [];
  const types: string[] = [];
  const nonRe = /\bnon-([a-z]+)/gi;
  let n: RegExpExecArray | null;
  while ((n = nonRe.exec(body))) nonTypes.push(n[1]);
  const colors: string[] = [];
  const colorBits = body.match(/that's (.+)$/i);
  const colorPhrase = colorBits ? colorBits[1] : body;
  const found: { index: number; code: string }[] = [];
  for (const [word, code] of Object.entries(COLOR_WORDS)) {
    const m = new RegExp(`\\b${word}\\b`, 'i').exec(colorPhrase);
    if (m && m.index != null) found.push({ index: m.index, code });
  }
  found.sort((a, b) => a.index - b.index);
  for (const item of found) colors.push(item.code);
  const colorMode: 'any' | 'all' = /and\/or/.test(colorPhrase) ? 'any' : (/ and /.test(colorPhrase) ? 'all' : 'any');
  return {
    legendary: /\blegendary\b/.test(body),
    nonTypes,
    types,
    colors,
    colorMode,
  };
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function colorLetters(perm: any): string[] {
  const raw = perm?.card?.colors || perm?.colors || perm?.card?.color_identity || [];
  if (Array.isArray(raw) && raw.length) return raw.map((c: any) => String(c).toUpperCase());
  const ident = String(perm?.card?.mana_cost || perm?.card?.color_identity || '').toUpperCase();
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => ident.includes(c));
}

export function permanentMatchesWorthyDefinition(permanent: any, def: WorthyDefinition | null | undefined): boolean {
  if (!permanent || !def) return false;
  const tl = typeLineOf(permanent);
  if (!/\bcreature\b/.test(tl) && permanent?.isCreature !== true && permanent?.crewed !== true) return false;
  if (def.legendary && !/\blegendary\b/.test(tl)) return false;
  for (const t of def.nonTypes) {
    if (new RegExp(`\\b${t}\\b`, 'i').test(tl)) return false;
  }
  for (const t of def.types) {
    if (!new RegExp(`\\b${t}\\b`, 'i').test(tl)) return false;
  }
  if (def.colors.length) {
    const have = new Set(colorLetters(permanent));
    if (def.colorMode === 'all') {
      if (!def.colors.every((c) => have.has(c))) return false;
    } else if (!def.colors.some((c) => have.has(c))) {
      return false;
    }
  }
  return true;
}

/** Stamp worthy qualifiers parsed from the same oracle with the reminder definition. */
export function attachWorthyDefinitionToQualifiers<T extends { qualifier?: { kind?: string; worthyDef?: WorthyDefinition } }>(
  abilities: T[],
  oracleText: string,
): T[] {
  const def = parseWorthyDefinition(oracleText);
  if (!def) return abilities;
  for (const ability of abilities) {
    if (ability?.qualifier?.kind === 'worthy') ability.qualifier.worthyDef = def;
  }
  return abilities;
}
