// server/src/state/modules/batch103Parsers.ts
// B103 oracle parsers. Public: the parse* functions exported below.

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

export function parseDefensiveFormation(oracle: string): boolean {
  return /rather than the attacking player, you assign the combat damage of each creature attacking you/i.test(normalize(oracle));
}

export function parseTwelfthDoctorDemonstrate(oracle: string): boolean {
  return /the first spell you cast from anywhere other than (?:your |a )?hand each turn has demonstrate/i.test(normalize(oracle));
}

export function parseOffBattlefieldSpellsAndPermanentsColorless(oracle: string): boolean {
  return /all cards that aren't on the battlefield, spells, and permanents are colorless/i.test(normalize(oracle));
}

export function parsePlayersSpendManaAsAnyColor(oracle: string): boolean {
  return /players may spend mana as though it were mana of any color/i.test(normalize(oracle));
}

export function parseNonlandPermanentsYouControlAreColor(oracle: string): string | null {
  const m = normalize(oracle).match(/nonland permanents you control are (white|blue|black|red|green)(?!\s+in addition)/i);
  return m ? m[1].toLowerCase() : null;
}

export function parseSpendColorManaAsAny(oracle: string): string | null {
  const m = normalize(oracle).match(/you may spend (white|blue|black|red|green) mana as though it were mana of any color/i);
  return m ? m[1].toLowerCase() : null;
}

export function parseSpendOtherManaOnlyColorless(oracle: string): boolean {
  return /you may spend other mana only as though it were colorless mana/i.test(normalize(oracle));
}

export function parseSpellsYouCastHaveRipple(oracle: string): number | null {
  const m = normalize(oracle).match(/spells you cast have ripple (\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

export function parseHandCardsHaveWarp(oracle: string): { cost: string } | null {
  const m = normalize(oracle).match(/(?:artifact cards and [a-z]+ creature cards|[a-z]+ cards(?: and [a-z]+ creature cards)?) in your hand have warp ((?:\{[^}]+\})+)/i);
  if (!m) return null;
  return { cost: m[1].toUpperCase() };
}

export function parseCombatDamageCantBePrevented(oracle: string): boolean {
  return /combat damage that would be dealt by creatures you control can't be prevented/i.test(normalize(oracle));
}

export function parseNontokenTypeActivatedAdditionalCost(oracle: string): { typeWord: string; costText: string } | null {
  const m = normalize(oracle).match(/activated abilities of nontoken ([a-z]+)s? cost an additional "([^"]+)" to activate/i);
  if (!m) return null;
  return { typeWord: m[1].toLowerCase().replace(/s$/, ''), costText: m[2].trim() };
}

const SIDED_WORDS: Record<string, number> = {
  four: 4, six: 6, eight: 8, ten: 10, twelve: 12, twenty: 20,
};

export function parseDiceExchangeWithBasePT(oracle: string): { sides: number } | null {
  const m = normalize(oracle).match(/if you would roll (?:one or more |\d+ or more )?(\d+|four|six|eight|ten|twelve|twenty|n)-sided dice, instead roll them and you may exchange (?:one|\d+|n) results? with (?:this creature|~|[^\n]{0,24})(?:'s)? base power or base toughness/i);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const sides = raw === 'n' ? 6 : (SIDED_WORDS[raw] ?? parseInt(raw, 10));
  return sides > 0 ? { sides } : null;
}

export { parseCasualtyX } from './batch101Parsers.js';
