// server/src/state/modules/batch104Parsers.ts
// B104 oracle parsers. Public: the parse* functions exported below.

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

export function parseChosenQualityManaValueHaste(oracle: string): boolean {
  return /each creature with mana value of the chosen quality has haste/i.test(normalize(oracle));
}

export function parseEnchantedCreatureHasPoisonous(oracle: string): number | null {
  const m = normalize(oracle).match(/enchanted creature has poisonous (\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

export function parseOpponentsCreaturesAreIllusionAndSacrifice(oracle: string): string | null {
  const m = normalize(oracle).match(
    /each creature your opponents control is an illusion in addition to its other types and has "([^"]+)"/i,
  );
  return m ? m[1].trim() : null;
}

export function parseCannotChooseUntappedPermanentAsTarget(oracle: string): boolean {
  return /you can't choose an untapped permanent as this spell's target as you cast it/i.test(normalize(oracle));
}

export function parseCantBeBlockedUnlessDefenderControlsNSharingType(oracle: string): number | null {
  const m = normalize(oracle).match(
    /(?:this creature|~) can't be blocked unless defending player controls (\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more creatures that share a creature type/i,
  );
  if (!m) return null;
  const WORDS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const raw = m[1].toLowerCase();
  const n = WORDS[raw] ?? parseInt(raw, 10);
  return n > 0 ? n : null;
}

export function parsePlayersCantUntapMoreThanNNonbasicLands(oracle: string): number | null {
  const m = normalize(oracle).match(
    /(?:players|each player) can't untap more than (\d+|one|two|three|four|five) nonbasic lands? during their untap steps?/i,
  );
  if (!m) return null;
  const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const raw = m[1].toLowerCase();
  const n = WORDS[raw] ?? parseInt(raw, 10);
  return n > 0 ? n : null;
}

export function parseGetsPTForEachGraveyardWithNCards(oracle: string): { power: number; toughness: number; cards: number } | null {
  const m = normalize(oracle).match(
    /(?:~|this creature) gets ([+-]\d+)\s*\/\s*([+-]\d+) for each graveyard with (\d+|seven|eight|nine|ten) or more cards/i,
  );
  if (!m) return null;
  const WORDS: Record<string, number> = { seven: 7, eight: 8, nine: 9, ten: 10 };
  const cards = WORDS[m[3].toLowerCase()] ?? parseInt(m[3], 10);
  if (!(cards > 0)) return null;
  return { power: parseInt(m[1], 10), toughness: parseInt(m[2], 10), cards };
}

export function parseEnchantedArtifactCantAttackBlockOrActivate(oracle: string): boolean {
  return /enchanted artifact can't attack or block, and its activated abilities can't be activated/i.test(normalize(oracle));
}

export function parseTappedCreaturesYouControlCanBlockAsThoughUntapped(oracle: string): boolean {
  return /tapped creatures you control can block as though they were untapped/i.test(normalize(oracle));
}

export function parseCantBeBlockedIfPowerIsNOrLess(oracle: string): number | null {
  const m = normalize(oracle).match(
    /can't be blocked if (?:her|his|its|their) power is (\d+|one|two|three) or less/i,
  );
  if (!m) return null;
  const WORDS: Record<string, number> = { one: 1, two: 2, three: 3 };
  const raw = m[1].toLowerCase();
  const n = WORDS[raw] ?? parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseGetsPTForEachAuraYouControlAttachedToCreature(oracle: string): { power: number; toughness: number } | null {
  const m = normalize(oracle).match(
    /enchanted creature gets ([+-]\d+)\s*\/\s*([+-]\d+) for each aura you control that's attached to a creature/i,
  );
  if (!m) return null;
  return { power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) };
}

export function parseGetsPTAsLongAsOpponentControlsNonbasicLand(oracle: string): { power: number; toughness: number } | null {
  const m = normalize(oracle).match(
    /(?:~|this creature) gets ([+-]\d+)\s*\/\s*([+-]\d+) as long as an opponent controls a nonbasic land/i,
  );
  if (!m) return null;
  return { power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) };
}

export function parseAllNonlandPermanentsAreLegendary(oracle: string): boolean {
  return /all nonland permanents are legendary/i.test(normalize(oracle));
}

export function parseLandsYouControlAreTheChosenType(oracle: string): boolean {
  return /lands you control are the chosen type in addition to their other types/i.test(normalize(oracle));
}

export function parsePlayersCantCastSpellsOfTheChosenType(oracle: string): boolean {
  return /players can't cast spells of the chosen type/i.test(normalize(oracle));
}

export function parseNonlandCardsInHandHaveMiracle(oracle: string): string | null {
  const m = normalize(oracle).match(/nonland cards in your hand have miracle ((?:\{[^}]+\})+)/i);
  return m ? m[1].toUpperCase() : null;
}

export function parseLandCardsInGraveyardHaveDredge(oracle: string): number | null {
  const m = normalize(oracle).match(/land cards in your graveyard have dredge (\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

export function parseExactlyNColorSpellsHaveReplicate(oracle: string): { colors: number; cost: string } | null {
  const m = normalize(oracle).match(
    /each spell you cast that's exactly (\d+|three|two|four|five) colors has replicate ((?:\{[^}]+\})+)/i,
  );
  if (!m) return null;
  const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
  const colors = WORDS[m[1].toLowerCase()] ?? parseInt(m[1], 10);
  if (!(colors > 0)) return null;
  return { colors, cost: m[2].toUpperCase() };
}

export function parseTypeSpellsYouCastHaveProwl(oracle: string): { typeWord: string; cost: string } | null {
  const m = normalize(oracle).match(/([a-z]+) spells you cast have prowl ((?:\{[^}]+\})+)/i);
  if (!m) return null;
  return { typeWord: m[1].toLowerCase(), cost: m[2].toUpperCase() };
}

export function parseNontokenCreaturesYouControlHaveRiot(oracle: string): boolean {
  return /nontoken creatures you control have riot/i.test(normalize(oracle));
}

export function parseCreaturesYouControlButDontOwnAreType(oracle: string): string | null {
  const m = normalize(oracle).match(
    /creatures you control but don't own are ([a-z]+) in addition to their other types/i,
  );
  if (!m) return null;
  const raw = m[1].toLowerCase();
  if (raw.endsWith('ies')) return raw.slice(0, -3) + 'y';
  if (raw.endsWith('s') && !raw.endsWith('ss')) return raw.slice(0, -1);
  return raw;
}

export function parseCanAttackAsThoughNoDefenderIfScriedOrSurveilled(oracle: string): boolean {
  return /as long as you've scried or surveilled this turn, (?:this creature|~|it) can attack as though it didn't have defender/i.test(normalize(oracle));
}

export function parseCanAttackAsThoughNoDefenderIfNoCardsInHand(oracle: string): boolean {
  return /(?:this creature|~|it) can attack as though it didn't have defender as long as you have no cards in hand/i.test(normalize(oracle));
}

export function parseCreatureWithP1P1DealsDoubleDamage(oracle: string): boolean {
  return /if a creature you control with a \+1\/\+1 counter on it would deal damage to a permanent or player, it deals double that damage instead/i.test(normalize(oracle));
}

export function parseSpellYouControlDamageToOpponentPrevent(oracle: string): boolean {
  return /if a spell you control would deal damage to an opponent, prevent that damage/i.test(normalize(oracle));
}

export function parseEnchantedHasBasePowerAndQuoted(oracle: string): { power: number; quoted: string } | null {
  const m = normalize(oracle).match(
    /enchanted creature has base power (\d+) and has "([^"]+)"/i,
  );
  if (!m) return null;
  return { power: parseInt(m[1], 10), quoted: m[2].trim() };
}

export function parseSelfGetsPTCountedOrConditional(oracle: string): boolean {
  return !!(
    parseGetsPTForEachGraveyardWithNCards(oracle)
    || parseGetsPTForEachAuraYouControlAttachedToCreature(oracle)
    || parseGetsPTAsLongAsOpponentControlsNonbasicLand(oracle)
  );
}
