// server/src/state/modules/batch109Parsers.ts
// B109 oracle parsers. Public entry symbols are the parse* functions below.
// Finished UI/payment cards (Street Wraith, Karn's Sylex, Arctic Merfolk,
// Valgavoth, Breathstealer's Crypt) are counted in the census classifier,
// not here.

export function normalizeB109Oracle(text: string): string {
  return String(text || '')
    .replace(/\u2019/g, "'")
    .replace(/\u2014/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

function n(text: string): string {
  return normalizeB109Oracle(text);
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function parseB109Number(raw: string): number {
  const key = String(raw || '').toLowerCase();
  if (key in WORDS) return WORDS[key];
  const value = parseInt(key, 10);
  return Number.isFinite(value) ? value : 0;
}

const SELF = '(?:this creature|this permanent|~)';

/** Common Cause. */
export function parseNonartifactCreaturesShareAColorPT(oracle: string): { power: number; toughness: number } | null {
  const m = n(oracle).match(/nonartifact creatures get ([+-]\d+)\s*\/\s*([+-]\d+) as long as they all share a color/i);
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]) };
}

/** Battle Brawler. */
export function parseControlEitherColorSelfPTAndFirstStrike(oracle: string): { colors: string[]; power: number; toughness: number } | null {
  const m = n(oracle).match(new RegExp(
    `as long as you control a (white|blue|black|red|green) or (white|blue|black|red|green) permanent, ${SELF} gets ([+-]\\d+)\\s*\\/\\s*([+-]\\d+) and has first strike`,
    'i',
  ));
  if (!m) return null;
  return { colors: [m[1].toLowerCase(), m[2].toLowerCase()], power: Number(m[3]), toughness: Number(m[4]) };
}

/** Stoic Sphinx. */
export function parseHexproofIfYouHaventCastASpell(oracle: string): boolean {
  return new RegExp(`${SELF} has hexproof as long as you haven't cast a spell this turn`, 'i').test(n(oracle));
}

/** Starfleet Spanner Jockey. */
export function parseAttackAsThoughNoDefenderIfCastNoncreature(oracle: string): boolean {
  return new RegExp(`as long as you've cast a noncreature spell this turn, ${SELF} can attack as though it didn't have defender`, 'i').test(n(oracle));
}

/** Absolute Virtue. */
export function parseYouHaveProtectionFromEachOpponent(oracle: string): boolean {
  return /you have protection from each of your opponents/i.test(n(oracle));
}

/** Serpent of Yawning Depths. Returns singular creature types. */
export function parseTypalYouControlCantBeBlockedExceptBySameTypal(oracle: string): string[] | null {
  const m = n(oracle).match(/((?:[a-z]+, )+(?:and )?[a-z]+) you control can't be blocked except by ((?:[a-z]+, )+(?:and )?[a-z]+)/i);
  if (!m) return null;
  const left = singularTypeList(m[1]);
  const right = singularTypeList(m[2]);
  if (left.length < 2 || left.join('|') !== right.join('|')) return null;
  return left;
}

function singularTypeList(raw: string): string[] {
  return raw.toLowerCase().split(/,| and /).map((w) => w.trim()).filter(Boolean).map(singularType);
}

function singularType(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('es')) {
    const stem = word.slice(0, -2);
    if (/(?:us|x|s|ch|sh)$/.test(stem)) return stem;
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Orcish Conscripts attack clause. */
export function parseCantAttackUnlessNOtherCreaturesAttack(oracle: string): number | null {
  const m = n(oracle).match(new RegExp(`${SELF} can't attack unless at least (\\w+|\\d+) other creatures attack`, 'i'));
  if (!m) return null;
  const min = parseB109Number(m[1]);
  return min > 0 ? min : null;
}

/** Orcish Conscripts block clause. */
export function parseCantBlockUnlessNOtherCreaturesBlock(oracle: string): number | null {
  const m = n(oracle).match(new RegExp(`${SELF} can't block unless at least (\\w+|\\d+) other creatures block`, 'i'));
  if (!m) return null;
  const min = parseB109Number(m[1]);
  return min > 0 ? min : null;
}

/** Viashino Bey. */
export function parseIfThisAttacksAllYouControlAttackIfAble(oracle: string): boolean {
  return new RegExp(`if ${SELF} attacks, all creatures you control attack if able`, 'i').test(n(oracle));
}

/** Freyalise's Radiance. */
export function parseSnowPermanentsDontUntap(oracle: string): boolean {
  return /snow permanents don't untap during their controllers' untap steps/i.test(n(oracle));
}

/** Bilbo, Fellow Conspirator. */
export function parseFoodTokenAlsoCreatesTreasure(oracle: string): boolean {
  return /if you would create a food token, instead create a food token and a treasure token/i.test(n(oracle));
}

/** Goldnight Castigator — damage to you. */
export function parseDamageToYouIsDoubled(oracle: string): boolean {
  return /if a source would deal damage to you, it deals double that damage to you instead/i.test(n(oracle));
}

/** Goldnight Castigator — damage to this creature. */
export function parseDamageToThisCreatureIsDoubled(oracle: string): boolean {
  return new RegExp(`if a source would deal damage to ${SELF}, it deals double that damage to ${SELF} instead`, 'i').test(n(oracle));
}

/** Ojer Axonil. Color word plus raise-to-power. */
export function parseColorSourceNoncombatDamageRaisedToPower(oracle: string): { color: string } | null {
  const m = n(oracle).match(/if a (white|blue|black|red|green) source you control would deal an amount of noncombat damage less than .+?'s power to an opponent, that source deals damage equal to .+?'s power instead/i);
  return m ? { color: m[1].toLowerCase() } : null;
}

/** Shield of the Realm. */
export function parsePreventNDamageToEquipped(oracle: string): number | null {
  const m = n(oracle).match(/if a source would deal damage to equipped creature, prevent (\w+|\d+) of that damage/i);
  if (!m) return null;
  const amount = parseB109Number(m[1]);
  return amount > 0 ? amount : null;
}

/** Camel. */
export function parsePreventDesertDamageWhileAttacking(oracle: string): boolean {
  return new RegExp(
    `as long as ${SELF} is attacking, prevent all damage deserts would deal to ${SELF} and to creatures banded with ${SELF}`,
    'i',
  ).test(n(oracle));
}
