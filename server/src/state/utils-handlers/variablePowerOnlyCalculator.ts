// server/src/state/utils-handlers/variablePowerOnlyCalculator.ts
// Characteristic-defining "~'s power is equal to the number of X" (CR 604.3) where only power
// is variable and toughness is printed (Snow Villiers */3, Haughty Djinn */4, Filigree Attendant */3), and the
// toughness-only mirror (People of the Woods 1/*, Treefolk Seedlings 2/*, Tymaret's devotion 2/*).

function typeLineOf(obj: any): string {
  return String(obj?.card?.type_line ?? obj?.type_line ?? '').toLowerCase();
}

/** Count for the "number of ..." phrase, or undefined when the phrase is not recognized. */
export function countPowerOnlyPhrase(phrase: string, battlefield: any[], zones: any, controllerId: string): number | undefined {
  const p = phrase.toLowerCase().trim();
  const mine = (battlefield || []).filter((perm: any) => perm?.controller === controllerId);
  const graveyard: any[] = zones?.[controllerId]?.graveyard || [];

  let m = p.match(/^(?:(white|blue|black|red|green) )?(creatures|artifacts|enchantments|lands) you control$/);
  if (m) {
    const want = m[2].slice(0, -1);
    return mine.filter((perm: any) => {
      if (!typeLineOf(perm).includes(want)) return false;
      if (!m![1]) return true;
      const letter = m![1] === 'blue' ? 'U' : m![1][0].toUpperCase();
      return (perm?.card?.colors || []).includes(letter);
    }).length;
  }
  if (/^instant and sorcery cards in your graveyard$|^instant and\/or sorcery cards in your graveyard$/.test(p)) {
    return graveyard.filter((c: any) => /\b(instant|sorcery)\b/.test(typeLineOf(c))).length;
  }
  m = p.match(/^(creature|artifact|land|enchantment) cards in your graveyard$/);
  if (m) return graveyard.filter((c: any) => typeLineOf(c).includes(m![1])).length;
  // Domain (Fblthp, Knows the Way): basic land types among lands you control.
  if (p === 'basic land types among lands you control') {
    const kinds = ['plains', 'island', 'swamp', 'mountain', 'forest'];
    return kinds.filter((k) => mine.some((perm: any) => new RegExp('\\b' + k + '\\b').test(typeLineOf(perm)))).length;
  }
  // "Forests you control" (People of the Woods, Dakmor Plague-style): basic land subtypes on the type line.
  m = p.match(/^(plains|islands|swamps|mountains|forests) you control$/);
  if (m) {
    const sub = m[1] === 'plains' ? 'plains' : m[1].slice(0, -1);
    return mine.filter((perm: any) => new RegExp('\\b' + sub + '\\b').test(typeLineOf(perm))).length;
  }
  if (p === 'cards in your hand') return zones?.[controllerId]?.handCount ?? zones?.[controllerId]?.hand?.length ?? 0;
  return undefined;
}

const DEVOTION_SYM: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/** Devotion (CR 700.5): coloured mana symbols (hybrid included) in mana costs of permanents you control. */
export function devotionTo(color: string, battlefield: any[], controllerId: string): number {
  const sym = DEVOTION_SYM[color];
  if (!sym) return 0;
  return (battlefield || []).filter((perm: any) => perm?.controller === controllerId).reduce((sum: number, perm: any) => {
    const cost = String(perm?.card?.mana_cost ?? '').toUpperCase();
    return sum + (cost.match(/\{[^}]*\}/g) || []).filter((s) => s.includes(sym)).length;
  }, 0);
}

function variableSideCount(oracleTextLower: string, side: 'power' | 'toughness', battlefield: any[], zones: any, controllerId: string): number | undefined {
  const re = new RegExp('(?:^|\\n|\\. )[^.\\n]*?\\b' + side + ' is equal to (?:the number of ([^.\\n]+?)|your devotion to (white|blue|black|red|green))\\.');
  const match = oracleTextLower.match(re);
  if (!match) return undefined;
  if (match[2]) return devotionTo(match[2], battlefield, controllerId);
  return countPowerOnlyPhrase(match[1], battlefield, zones, controllerId);
}

/** "~'s toughness is equal to ..." with printed numeric power. */
export function calculateToughnessOnlyCDA(card: any, oracleTextLower: string, battlefield: any[], zones: any, controllerId: string): { power: number; toughness: number } | undefined {
  if (!String(card?.toughness ?? '').includes('*') || String(card?.power ?? '').includes('*')) return undefined;
  const power = Number(card?.power);
  if (!Number.isFinite(power)) return undefined;
  const count = variableSideCount(oracleTextLower, 'toughness', battlefield, zones, controllerId);
  return count === undefined ? undefined : { power, toughness: count };
}

export function calculatePowerOnlyCDA(
  card: any,
  oracleTextLower: string,
  battlefield: any[],
  zones: any,
  controllerId: string,
): { power: number; toughness: number } | undefined {
  if (!String(card?.power ?? '').includes('*')) return calculateToughnessOnlyCDA(card, oracleTextLower, battlefield, zones, controllerId);
  const toughness = Number(card?.toughness);
  if (!Number.isFinite(toughness)) return undefined;
  const count = variableSideCount(oracleTextLower, 'power', battlefield, zones, controllerId);
  if (count === undefined) return undefined;
  return { power: count, toughness };
}