// server/src/state/modules/batch105Parsers.ts
// B105 oracle parsers. Generic patterns; no apply logic.

function normalize(oracle: string): string {
  return String(oracle || '').replace(/\u2019/g, "'").replace(/\u2014/g, '-');
}

function signedInt(raw: string | undefined, fallback = 0): number {
  const n = Number(String(raw || '').replace(/^[+]/, ''));
  return Number.isFinite(n) ? n : fallback;
}

/** "TYPEs you control are Equipment in addition ... and have "..." and equip {M}." Optional non-X prefixes. */
export function parseAreEquipmentInAdditionAndHaveQuoted(oracle: string): {
  type: string;
  fragment: string;
  excludedTypeWords: string[];
} | null {
  const text = normalize(oracle);
  const m = text.match(
    /(?:((?:non[-]?[a-z]+(?:,)?\s+)+))?([a-z]+)s you control are equipment in addition to their other types and have "([^"]+)"/i,
  );
  if (!m) return null;
  const type = String(m[2] || '').toLowerCase().replace(/s$/, '');
  const excludedTypeWords = (String(m[1] || '').toLowerCase().match(/non[-]?[a-z]+/g) || [])
    .map((w) => w.replace(/^non-?/, ''))
    .filter(Boolean);
  const afterQuote = text.slice(text.indexOf(m[0]) + m[0].length);
  const trail = afterQuote.split(/\n/)[0].replace(/\s*$/, '');
  const fragment = `${String(m[3] || '').trim().replace(/[.,;]+$/, '')}. ${trail}`.replace(/\s+/g, ' ').trim();
  return { type, fragment, excludedTypeWords };
}

/** "If a creature an opponent controls attacks, all creatures that opponent controls attack if able." */
export function parseOpponentCreaturesAllAttackIfAble(oracle: string): boolean {
  return /if a creature an opponent controls attacks, all creatures that opponent controls attack if able/i.test(normalize(oracle));
}

/** "Creatures you control with KEYWORD have "{cost}: effect."" */
export function parseCreaturesYouControlWithKeywordHaveQuotedActivated(oracle: string): { keyword: string; ability: string } | null {
  const m = normalize(oracle).match(/creatures you control with ([a-z]+) have "([^"]+)"/i);
  if (!m) return null;
  return { keyword: String(m[1] || '').toLowerCase(), ability: String(m[2] || '').trim() };
}

/** "As a historic permanent you control enters, it becomes a N/N TYPE creature in addition to its other types." */
export function parseAsHistoricPermanentYouControlEntersBecomes(oracle: string): {
  power: number;
  toughness: number;
  types: string[];
} | null {
  const m = normalize(oracle).match(
    /as a historic permanent you control enters, it becomes a ([+-]?\d+)\/([+-]?\d+) ([a-z]+) creature in addition to its other types/i,
  );
  if (!m) return null;
  const subtype = String(m[3] || '').trim();
  return {
    power: signedInt(m[1]),
    toughness: signedInt(m[2]),
    types: subtype ? ['Creature', subtype[0].toUpperCase() + subtype.slice(1)] : ['Creature'],
  };
}

/** "During your turn, each instant and sorcery card in your graveyard has flashback. Its flashback cost is equal to its mana cost." */
export function parseGraveyardCardsHaveFlashbackEqualToManaCost(oracle: string): {
  types: string[];
  duringYourTurn: boolean;
} | null {
  const text = normalize(oracle);
  const m = text.match(/(?:during your turn,\s*)?each ([^.]+?) cards? in your graveyard has flashback/i);
  if (!m) return null;
  const types = String(m[1] || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w && w !== 'and' && w !== 'or');
  return { types, duringYourTurn: /during your turn/i.test(text) };
}

/** "If a creature you control would connive, instead you draw a card, then that creature connives." */
export function parseWouldConniveInsteadYouDrawThenConnives(oracle: string): boolean {
  return /if a creature you control would connive, instead you draw a card, then that creature connives/i.test(normalize(oracle));
}

/** "During combat, players can't cast instant spells or activate abilities that aren't mana abilities." */
export function parseDuringCombatCantCastInstantsOrActivateNonMana(oracle: string): boolean {
  return /during combat, players can't cast instant spells or activate abilities that aren't mana abilities/i.test(normalize(oracle));
}

/** "As long as your life total is greater than your starting life total, ~ gets +N/+N and has KEYWORD." */
export function parseGetsPTAndKeywordWhenLifeGreaterThanStarting(oracle: string): {
  power: number;
  toughness: number;
  keyword: string;
} | null {
  const m = normalize(oracle).match(
    /as long as your life total is greater than your starting life total,\s*(?:~|this creature|this permanent|[^.]+?)?\s*gets ([+-]?\d+)\/([+-]?\d+) and has ([a-z]+)/i,
  );
  if (!m) return null;
  return { power: signedInt(m[1]), toughness: signedInt(m[2]), keyword: String(m[3] || '').toLowerCase() };
}

/** "Gets an additional +N/+N as long as your life total is at least M greater than your starting life total." */
export function parseAdditionalPTWhenLifeAtLeastNGreaterThanStarting(oracle: string): {
  power: number;
  toughness: number;
  atLeast: number;
} | null {
  const m = normalize(oracle).match(
    /gets an additional ([+-]?\d+)\/([+-]?\d+) as long as your life total is at least (\d+) greater than your starting life total/i,
  );
  if (!m) return null;
  return { power: signedInt(m[1]), toughness: signedInt(m[2]), atLeast: signedInt(m[3]) };
}

/** "~ has haste and ward {M} as long as it was cast." */
export function parseHasHasteAndWardAsLongAsCast(oracle: string): { wardCost: string } | null {
  const m = normalize(oracle).match(/has haste and ward\s*(\{[^}]+\}) as long as it was cast/i);
  if (!m) return null;
  return { wardCost: String(m[1] || '').toUpperCase() };
}

/** "The monarch controls enchanted creature." */
export function parseTheMonarchControlsEnchanted(oracle: string): boolean {
  return /the monarch controls enchanted (?:creature|permanent|artifact|land|planeswalker|enchantment)/i.test(normalize(oracle));
}

/** "Enchanted creature attacks each combat if able and can't attack you." */
export function parseEnchantedAttacksEachCombatIfAbleAndCantAttackYou(oracle: string): boolean {
  return /enchanted creature attacks each combat if able and can't attack you/i.test(normalize(oracle));
}

/** Power equal to the greatest mana value among noncreature permanents you control and noncreature cards in your graveyard. */
export function parsePowerEqualToGreatestMvAmongNoncreaturePermanentsAndGy(oracle: string): boolean {
  return /power is equal to the greatest mana value among noncreature permanents you control and noncreature cards in your graveyard/i.test(normalize(oracle));
}

/** "~ can't be blocked if a TYPE entered the battlefield under your control this turn." */
export function parseCantBeBlockedIfTypeEnteredThisTurn(oracle: string): { type: string } | null {
  const m = normalize(oracle).match(
    /can't be blocked if an? ([a-z]+) entered the battlefield under your control this turn/i,
  );
  if (!m) return null;
  return { type: String(m[1] || '').toLowerCase() };
}

/** Power = permanent cards in your graveyard; toughness = that number plus 1. */
export function parsePowerEqualToPermanentCardsInGyToughnessPlusOne(oracle: string): boolean {
  return /power is equal to the number of permanent cards in your graveyard and its toughness is equal to that number plus (?:one|1)/i.test(normalize(oracle));
}

/** "Auras attached to permanents you control have umbra armor." */
export function parseAurasAttachedToPermanentsYouControlHaveUmbraArmor(oracle: string): boolean {
  return /auras attached to permanents you control have umbra armor/i.test(normalize(oracle));
}

/** "SUBTYPEs you control get +N/+N for each other SUBTYPE you control and can't be blocked by monocolored creatures." */
export function parseSubtypeYouControlGetPTForEachOtherAndCantBeBlockedByMono(oracle: string): {
  subtype: string;
  power: number;
  toughness: number;
  blockRestriction: 'monocolored';
} | null {
  const m = normalize(oracle).match(
    /([a-z]+)s? you control get ([+-]?\d+)\/([+-]?\d+) for each other \1s? you control and can't be blocked by monocolored creatures/i,
  );
  if (!m) return null;
  return {
    subtype: String(m[1] || '').toLowerCase(),
    power: signedInt(m[2]),
    toughness: signedInt(m[3]),
    blockRestriction: 'monocolored',
  };
}

/** "Creatures attacking your opponents have double strike." */
export function parseCreaturesAttackingYourOpponentsHaveDoubleStrike(oracle: string): boolean {
  return /creatures attacking your opponents have double strike/i.test(normalize(oracle));
}

/** "Creatures lose all abilities." */
export function parseCreaturesLoseAllAbilities(oracle: string): boolean {
  return /(?:^|\n)\s*creatures lose all abilities\.?\s*(?:\n|$)/i.test(normalize(oracle))
    || /^\s*creatures lose all abilities\.?\s*$/i.test(normalize(oracle).trim());
}

/** "Your opponents can't cast spells with the chosen name." */
export function parseOpponentsCantCastSpellsWithChosenName(oracle: string): boolean {
  return /your opponents can't cast spells with the chosen name/i.test(normalize(oracle));
}

/** "CARDNAME can't attack or block unless a creature died under your control this turn." */
export function parseCantAttackOrBlockUnlessCreatureDiedUnderYourControl(oracle: string): boolean {
  return /can't attack or block unless a creature died under your control this turn/i.test(normalize(oracle));
}

/** "Creatures can't block." */
export function parseCreaturesCantBlock(oracle: string): boolean {
  return /(?:^|\n)\s*creatures can't block\.?\s*(?:\n|$)/i.test(normalize(oracle))
    || /^\s*creatures can't block\.?\s*$/i.test(normalize(oracle).trim());
}

/** "If ~ would die, instead exile it with N NAME counters on it." */
export function parseIfWouldDieInsteadExileWithNNamedCounters(oracle: string): { count: number; counter: string } | null {
  const m = normalize(oracle).match(
    /if (?:~|this creature|this permanent|[a-z][a-z' -]*) would die, instead exile it with (\d+|one|two|three|four|five) ([a-z]+) counters? on it/i,
  );
  if (!m) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const raw = String(m[1] || '').toLowerCase();
  const count = /^\d+$/.test(raw) ? Number(raw) : (words[raw] || 0);
  if (!(count > 0)) return null;
  return { count, counter: String(m[2] || '').toLowerCase() };
}

/** "Each creature card in your graveyard that's a A, B, and/or C has unearth {M}." */
export function parseGyCreatureCardsOfTypesHaveUnearth(oracle: string): { types: string[]; cost: string } | null {
  const m = normalize(oracle).match(
    /each creature card in your graveyard that's an? ([^.]+?) has unearth\s*((?:\{[^}]+\})+)/i,
  );
  if (!m) return null;
  const types = String(m[1] || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w && w !== 'and' && w !== 'or' && w !== 'a');
  return { types, cost: String(m[2] || '').replace(/\s+/g, '').toUpperCase() };
}

/** Ward of Bones style: each opponent who controls more TYPEs than you can't cast TYPE spells / play lands. */
export function parseOpponentWhoControlsMoreTypeCantCastOrPlay(oracle: string): Array<{ type: string; action: 'cast' | 'play' }> {
  const text = normalize(oracle);
  const out: Array<{ type: string; action: 'cast' | 'play' }> = [];
  const castRe = /each opponent who controls more ([a-z]+)s than you can't cast \1 spells/gi;
  let m: RegExpExecArray | null;
  while ((m = castRe.exec(text))) {
    out.push({ type: String(m[1] || '').toLowerCase(), action: 'cast' });
  }
  if (/each opponent who controls more lands than you can't play lands/i.test(text)) {
    out.push({ type: 'land', action: 'play' });
  }
  return out;
}

/** "Threshold — ~ gets +N/+N for each COLOR permanent your opponents control as long as there are M or more cards in your graveyard." */
export function parseGetsPTForEachColorPermanentOpponentsControlWithThreshold(oracle: string): {
  power: number;
  toughness: number;
  color: string;
  threshold: number;
} | null {
  const m = normalize(oracle).match(
    /gets ([+-]?\d+)\/([+-]?\d+) for each (white|blue|black|red|green|colorless) permanent (?:your opponents control|opponents control) as long as (?:there are |you have )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more cards in your graveyard/i,
  );
  if (!m) return null;
  const words = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };
  const raw = String(m[4] || '').toLowerCase();
  const threshold = /^\d+$/.test(raw) ? Number(raw) : (words[raw] || signedInt(m[4]));
  return { power: signedInt(m[1]), toughness: signedInt(m[2]), color: String(m[3] || '').toLowerCase(), threshold };
}

/** "If ~ would deal combat damage to a player, instead put that many +N/+N counters on ~ and that player mills that many." */
export function parseWouldDealCombatDamageToPlayerInsteadCountersAndMill(oracle: string): boolean {
  return /if (?:~|this creature|this permanent) would deal combat damage to a player, instead put that many [^\n]*counters on (?:~|it|this creature) and that player mills that many/i.test(normalize(oracle));
}

/** "If a creature would deal damage to you, prevent N of that damage." */
export function parseIfCreatureWouldDealDamageToYouPreventN(oracle: string): { n: number } | null {
  const m = normalize(oracle).match(/if a creature would deal damage to you, prevent (\d+|one) of that damage/i);
  if (!m) return null;
  const raw = String(m[1] || '').toLowerCase();
  const n = raw === 'one' ? 1 : Number(raw);
  return Number.isFinite(n) && n > 0 ? { n } : null;
}

/** "You have hexproof." */
export function parseYouHaveHexproof(oracle: string): boolean {
  return /(?:^|\n)\s*you have hexproof\.?\s*(?:\n|$)/i.test(normalize(oracle));
}
