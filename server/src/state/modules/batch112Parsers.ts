// Batch 112 leftover static and replacement sentences.
// Public: normalizeBatch112Oracle, parseBatch112StaticKind, and the parse* helpers.

import { wordNumber } from './batch111Parsers.js';

export { wordNumber };

export function normalizeBatch112Oracle(oracle: string, cardName?: string): string {
  let text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").replace(/\u2014|\u2013/g, '-').replace(/\([^)]*\)/g, ' ');
  const name = String(cardName || '').split('//')[0].trim().toLowerCase();
  const firstWord = name.split(/[\s,]+/)[0] || '';
  for (const part of [name, name.split(',')[0].trim()]) {
    if (part.length < 3) continue;
    text = text.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '~');
  }
  if (firstWord.length >= 4 && firstWord !== name) {
    text = text.replace(new RegExp(`\\b${firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?=\\s+(?:can't|has|gets|deals|is|enters|'s|must))`, 'g'), '~');
  }
  text = text.replace(/\bthis (?:creature|spacecraft|permanent|enchantment|artifact|vehicle)\b/g, '~');
  return text.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

export function parsePowerEqualToCreatureCardsInGraveyards(text: string): boolean {
  return /~'s power is equal to the number of creature cards in all graveyards/.test(text);
}

export function parsePtHalfHighestOpponentLife(text: string): boolean {
  return /~'s power and toughness are each equal to half the highest life total among your opponents, rounded up/.test(text);
}

export function parsePowerEqualToCardsDrawn(text: string): boolean {
  return /~'s power is equal to the number of cards you've drawn this turn/.test(text);
}

export function parsePowerEqualToCraftedCards(text: string): boolean {
  return /~'s power is equal to the total power of the exiled cards used to craft it/.test(text);
}

export function parsePtFromExiledCreature(text: string): boolean {
  return /~ gets \+x\/\+y, where x is the exiled creature card's power and y is its toughness/.test(text)
    || /as long as a card exiled with ~ is a creature card, ~ has the power, toughness, and creature types of the last creature card exiled with it/.test(text);
}

export function parsePtFromStoredResults(text: string): boolean {
  return /~ gets \+x\/\+x, where x is the greatest number of stored results on it of the same value/.test(text);
}

export function parseOtherCreaturesSpeed(text: string): boolean {
  return /other creatures you control get \+x\/\+0, where x is your speed/.test(text);
}

export function parseNamedPermanentBuff(text: string): { names: string[]; power: number; toughness: number } | null {
  const match = text.match(/~ gets \+(\d+)\/\+(\d+) as long as you control a permanent named ([a-z0-9' ,-]+?) or a permanent named ([a-z0-9' ,-]+)/);
  if (!match) return null;
  return { power: Number(match[1]), toughness: Number(match[2]), names: [match[3].trim(), match[4].trim()] };
}

export function parseFoodsDuringYourTurn(text: string): boolean {
  return /during your turn, artifacts you control are foods in addition to their other types/.test(text);
}

export function parseNontokenArtifactsAreLands(text: string): boolean {
  return /nontoken artifacts you control are lands in addition to their other types/.test(text);
}

export function parseMvArtifactsAreElementals(text: string): { mv: number; power: number; toughness: number } | null {
  const match = text.match(/during your turn, each non-equipment artifact and non-aura enchantment you control with mana value (\d+) or greater is a (\d+)\/(\d+) elemental creature/);
  return match ? { mv: Number(match[1]), power: Number(match[2]), toughness: Number(match[3]) } : null;
}

export function parseArmyArtifactCreature(text: string): boolean {
  return /as long as it's your turn and you control an army, ~ is an artifact creature/.test(text);
}

export function parseLoyaltyNinja(text: string): { power: number; toughness: number } | null {
  const match = text.match(/during your turn, as long as ~ has one or more loyalty counters on (?:him|her|it|them), (?:he's|she's|it's|they're) a (\d+)\/(\d+) ninja creature/);
  return match ? { power: Number(match[1]), toughness: Number(match[2]) } : null;
}

export function parseLivingWeaponGrant(text: string): boolean {
  return /each equipment you control has living weapon/.test(text);
}

export function parseChosenLandPhasing(text: string): boolean {
  return /each land of the chosen type has phasing/.test(text);
}

export function parseFungusSaprolingMana(text: string): boolean {
  return /each fungus and saproling you control has "\{t\}: add \{g\}"/.test(text)
    || /each fungus and saproling you control has "\{t\}: add \{g\}/.test(text);
}

export function parseDamageNotRemoved(text: string): boolean {
  return /damage isn't removed from ~ during cleanup steps/.test(text);
}

export function parseGlobalWither(text: string): boolean {
  return /all damage is dealt as though its source had wither/.test(text);
}

export function parseNegativePowerAssignsPositive(text: string): boolean {
  return /if ~'s power is negative, (?:he|she|it|they) assigns combat damage as though (?:his|her|its|their) power were positive/.test(text);
}

export function parseHasteAsThoughAttackingOpponents(text: string): boolean {
  return /all creatures can attack your opponents and planeswalkers your opponents control as though those creatures had haste/.test(text);
}

export function parseMonarchSmallCantAttackYou(text: string): number {
  const match = text.match(/as long as you're the monarch, creatures with power (\d+) or less can't attack you/);
  return match ? Number(match[1]) : 0;
}

export function parseMustAttackYou(text: string): boolean {
  return /each opponent must attack you or a planeswalker you control with at least one creature each combat if able/.test(text);
}

export function parsePartyEnteredUnblockable(text: string): boolean {
  return /~ can't be blocked if you had another cleric, rogue, warrior, or wizard enter the battlefield under your control this turn/.test(text);
}

export function parseAttackerChoosesBlockers(text: string): boolean {
  return /the attacking player chooses how each creature blocks each combat/.test(text);
}

export function parseCreatureSpellsCantBeCast(text: string): boolean {
  return /creature spells can't be cast/.test(text);
}

export function parseNonartifactSpellLock(text: string): boolean {
  return /each player who has cast a nonartifact spell this turn can't cast additional nonartifact spells/.test(text);
}

export function parseCantCastDuringCombat(text: string): boolean {
  return /during combat, players can't cast spells or activate abilities that aren't mana abilities/.test(text);
}

export function parseAttackersCantCast(text: string): boolean {
  return /each opponent who attacked you or a planeswalker you control this turn can't cast spells/.test(text);
}

export function parseArabianNightsLock(text: string): boolean {
  return /players can't cast spells or play lands with a name originally printed in the arabian nights expansion/.test(text);
}

export function parseBasicLandManaOnly(text: string): boolean {
  return /spend only mana produced by basic lands to cast this spell/.test(text);
}

export function parseSpendWhiteAsRed(text: string): boolean {
  const match = text.match(/you may spend (white|blue|black|red|green) mana as though it were (white|blue|black|red|green) mana/);
  return !!match;
}

export function parseSpendColorPair(text: string): { from: string; to: string } | null {
  const match = text.match(/you may spend (white|blue|black|red|green) mana as though it were (white|blue|black|red|green) mana/);
  return match ? { from: match[1], to: match[2] } : null;
}

export function parseOneLandUntap(text: string): boolean {
  return /you can't untap more than one land during your untap step/.test(text);
}

export function parseWindCounterUntap(text: string): boolean {
  return /if a permanent with a wind counter on it would untap during its controller's untap step, remove all wind counters from it instead/.test(text);
}

export function parseEnterUntappedWhileSourceUntapped(text: string): boolean {
  return /as long as ~ is untapped, other permanents enter untapped/.test(text);
}

export function parseCounterCap(text: string): { name: string; max: number } | null {
  const match = text.match(/~ can't have more than (\d+|[a-z]+) ([a-z]+) counters on it/);
  if (!match) return null;
  const max = wordNumber(match[1]);
  return max > 0 ? { max, name: match[2] } : null;
}

export function parsePlayersCantGetCounters(text: string): boolean {
  return /players can't get counters/.test(text);
}

export function parseCountersCantBePutOnTypes(text: string): boolean {
  return /counters can't be put on artifacts, creatures, enchantments, or lands/.test(text);
}

export function parseRadiationGainInstead(text: string): boolean {
  return /you gain life rather than lose life from radiation/.test(text);
}

export function parseBoastTwice(text: string): boolean {
  return /creatures you control can boast twice during each of your turns rather than once/.test(text);
}

export function parseRetraceDuringYourTurn(text: string): boolean {
  return /during your turn, nonland permanent cards in your graveyard have retrace/.test(text);
}

export function parseWardExperience(text: string): boolean {
  return /~ has ward \{x\}, where x is the number of experience counters you have/.test(text);
}

export function parseHellbentSkipUpkeep(text: string): boolean {
  return /skip your upkeep step if you have no cards in hand/.test(text);
}

export function parseSharedFatePlay(text: string): boolean {
  return /each player may look at cards they exiled with ~, and they may play lands and cast spells from among those cards/.test(text);
}

export function parseSpaceSculptor(text: string): boolean {
  return /space sculptor/.test(text);
}

export function parseQuotedManaAbilityGrant(text: string): boolean {
  return /each creature you control has "whenever a mana ability of (?:this creature|~) resolves/.test(text);
}

export function parseSpellHasDelve(text: string): boolean {
  return /spells you cast have delve/.test(text);
}

export function parseCascadeAtMv(text: string): number {
  const match = text.match(/spells you cast with mana value (\d+) or greater have cascade/);
  return match ? Number(match[1]) : 0;
}

export function parseDoubleCascadeFromHand(text: string): number {
  const match = text.match(/colorless spells you cast from your hand with mana value (\d+) or greater have "cascade, cascade\.?"/);
  return match ? Number(match[1]) : 0;
}

export function parseConspireFromExile(text: string): boolean {
  return /each noncreature spell you cast from exile has conspire/.test(text);
}

export function parseAffinityForCreatures(text: string): boolean {
  return /instant and sorcery spells you cast have affinity for creatures/.test(text);
}

export function parseNinjutsuGrant(text: string): string {
  const match = text.match(/each creature card in your hand has ninjutsu\s*(\{[^}]+\}\s*)+/);
  return match ? match[0].replace(/.*ninjutsu\s*/i, '').trim() : '';
}

export function parseWebSlingingGrant(text: string): string {
  const match = text.match(/each legendary spell you cast that's one or more colors has web-slinging\s*((?:\{[^}]+\}\s*)+)/);
  return match ? match[1].trim() : '';
}

export function parseTreasureCascade(text: string): boolean {
  return /the first spell you cast each turn that mana from a treasure was spent to cast has cascade/.test(text);
}

export function parseColorManaReplacement(text: string): string {
  const symbol = text.match(/if a land is tapped for mana, it produces (\{[wubrgc]\}) instead of any other type/);
  if (symbol) return symbol[1].replace(/[{}]/g, '').toUpperCase();
  if (/if a land is tapped for mana, it produces colorless mana instead of any other type/.test(text)) return 'C';
  return '';
}

export function parseBasicLandColorChoice(text: string): boolean {
  return /if a basic land you control is tapped for mana, it produces mana of a color of your choice instead of any other type/.test(text);
}

export function parseTwoOrMoreManaBecomesColorless(text: string): boolean {
  return /if a land is tapped for two or more mana, it produces \{c\} instead of any other type and amount/.test(text);
}

export function parseLandTypeCycle(text: string): boolean {
  return /if tapped for mana, plains produce \{r\}/.test(text);
}

export function parseLookOneRestGraveyard(text: string): number {
  const match = text.match(/if you would draw a card, instead look at the top (\d+|[a-z]+) cards of your library, then put one into your hand and the rest into your graveyard/);
  return match ? wordNumber(match[1]) : 0;
}

export function parseChainsDraw(text: string): boolean {
  return /if a player would draw a card except the first one they draw in each of their draw steps, that player discards a card instead/.test(text);
}

export function parseSharedFateDraw(text: string): boolean {
  return /if a player would draw a card, that player exiles the top card of one of their opponents' libraries face down instead/.test(text);
}

export function parsePreventOne(text: string): number {
  const match = text.match(/if a source would deal damage to you or a creature you control, prevent (\d+) of that damage/);
  return match ? Number(match[1]) : 0;
}

export function parseDelayDamage(text: string): boolean {
  return /if damage would be dealt to you, put that many delay counters on ~ instead/.test(text);
}

export function parseExileGraveyardForDamage(text: string): boolean {
  return /if damage would be dealt to you, exile that many cards from your graveyard instead/.test(text);
}

export function parseExileLibraryForDamage(text: string): boolean {
  return /if damage would be dealt to a player, that player exiles that many cards from the top of their library instead/.test(text);
}

export function parsePreventAndRemoveCounter(text: string): boolean {
  return /if ~ would be dealt damage, prevent that damage and remove a \+1\/\+1 counter from it/.test(text);
}

export function parseAgeCounterPrevent(text: string): boolean {
  return /if a creature would deal combat damage to you and\/or one or more creatures you control, prevent x of that damage, where x is the number of age counters on ~/.test(text);
}

export function parseChosenPlayersDouble(text: string): boolean {
  return /if a source controlled by one of the chosen players would deal damage to the other chosen player/.test(text);
}

export function parseEnchantedDiesToHand(text: string): boolean {
  return /if a creature you control that's enchanted would die, return it to its owner's hand instead/.test(text);
}

export function parseOpponentOwnedCreatureExile(text: string): boolean {
  return /if a nontoken creature an opponent owns would die or a creature card not on the battlefield would be put into an opponent's graveyard, exile that card instead/.test(text);
}

export function parseOpponentNontokenDiesZombie(text: string): boolean {
  return /if a nontoken creature an opponent controls would die, instead exile that card and create a \d+\/\d+ black zombie creature token/.test(text);
}

export function parseNontokenDiesBlood(text: string): boolean {
  return /if a nontoken creature would die, exile that card with a blood counter on it instead/.test(text);
}

export function parseOpponentGraveyardExile(text: string): boolean {
  return /if a card would be put into an opponent's graveyard from anywhere, exile it instead/.test(text)
    || /if a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter/.test(text);
}

export function parseSelfExtraTurn(text: string): boolean {
  return /if ~ would be put into a graveyard from the battlefield, instead exile it and take an extra turn after this one/.test(text);
}

export function parseDestroyBecomesHeal(text: string): boolean {
  return /if another creature you control with a \+1\/\+1 counter on it would be destroyed, instead remove all \+1\/\+1 counters from it/.test(text);
}

export function parseFirstTokenCopiesEnchanted(text: string): boolean {
  return /the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of enchanted permanent/.test(text);
}

export function parseClueTokensInstead(text: string): boolean {
  return /if you would create one or more tokens, you may create that many clue tokens instead/.test(text);
}

export function parseOneOfEachToken(text: string): boolean {
  return /if you would create a clue, food, or treasure token, instead create one of each/.test(text);
}

export function parseLichMirror(text: string): boolean {
  return /if you would lose the game, instead shuffle your hand, your graveyard, and all permanents you own into your library/.test(text);
}

export function parseEnterDiscardLand(text: string): boolean {
  return /if ~ would enter, you may discard a land card instead/.test(text);
}

export function parseEchoSacrificeLands(text: string): number {
  const match = text.match(/echo-sacrifice (\d+|[a-z]+) lands/);
  return match ? wordNumber(match[1]) : 0;
}

export function parseCrewOnce(text: string): boolean {
  return /crew \d+\. activate only once each turn/.test(text) || /activate only once each turn/.test(text) && /crew /.test(text);
}

export function parseKickerDiscardCreature(text: string): boolean {
  return /kicker-/.test(text) && /discard a creature card/.test(text);
}

export function parseEquipPayLifeOnce(text: string): boolean {
  return /equip-pay \d+ life/.test(text) && /activate only once each turn/.test(text);
}

export function parseProtectionFromColorsYouControl(text: string): boolean {
  return /enchanted creature has protection from each color among permanents you control/.test(text);
}

export function parseProtectionFromGorgons(text: string): boolean {
  return /green creatures and white creatures have protection from gorgons/.test(text);
}

export function parseGreatestMvProtection(text: string): boolean {
  return /each creature with the greatest mana value has protection from each color/.test(text);
}

export function parseCantBeTargetOfColors(text: string): string[] {
  const match = text.match(/~ can't be the target of (white|blue|black|red|green) or (white|blue|black|red|green) spells/);
  return match ? [match[1], match[2]] : [];
}

export function parseCreaturesCantBeTargeted(text: string): boolean {
  return /creatures can't be the targets of spells/.test(text);
}

export function parseRayamiKeywords(text: string): boolean {
  return /as long as an exiled creature card with a blood counter on it has flying, ~ has flying/.test(text);
}

const CHECKS: Array<[string, (text: string) => boolean]> = [
  ['gy_creature_power', parsePowerEqualToCreatureCardsInGraveyards],
  ['half_life_pt', parsePtHalfHighestOpponentLife],
  ['drawn_power', parsePowerEqualToCardsDrawn],
  ['craft_power', parsePowerEqualToCraftedCards],
  ['exiled_creature_pt', parsePtFromExiledCreature],
  ['stored_results_pt', parsePtFromStoredResults],
  ['speed_pt', parseOtherCreaturesSpeed],
  ['named_pair_pt', (text) => !!parseNamedPermanentBuff(text)],
  ['foods', parseFoodsDuringYourTurn],
  ['artifacts_are_lands', parseNontokenArtifactsAreLands],
  ['elemental_animation', (text) => !!parseMvArtifactsAreElementals(text)],
  ['army_creature', parseArmyArtifactCreature],
  ['loyalty_ninja', (text) => !!parseLoyaltyNinja(text)],
  ['living_weapon', parseLivingWeaponGrant],
  ['land_phasing', parseChosenLandPhasing],
  ['fungus_mana', parseFungusSaprolingMana],
  ['damage_stays', parseDamageNotRemoved],
  ['wither', parseGlobalWither],
  ['negative_power', parseNegativePowerAssignsPositive],
  ['haste_as_though', parseHasteAsThoughAttackingOpponents],
  ['monarch_attack', (text) => parseMonarchSmallCantAttackYou(text) > 0],
  ['must_attack', parseMustAttackYou],
  ['party_unblockable', parsePartyEnteredUnblockable],
  ['attacker_blocks', parseAttackerChoosesBlockers],
  ['no_creature_spells', parseCreatureSpellsCantBeCast],
  ['nonartifact_lock', parseNonartifactSpellLock],
  ['combat_cast_lock', parseCantCastDuringCombat],
  ['attacked_cant_cast', parseAttackersCantCast],
  ['arabian_nights', parseArabianNightsLock],
  ['basic_mana_only', parseBasicLandManaOnly],
  ['mana_as_though', (text) => !!parseSpendColorPair(text)],
  ['one_land_untap', parseOneLandUntap],
  ['wind_untap', parseWindCounterUntap],
  ['enter_untapped', parseEnterUntappedWhileSourceUntapped],
  ['counter_cap', (text) => !!parseCounterCap(text)],
  ['no_player_counters', parsePlayersCantGetCounters],
  ['no_permanent_counters', parseCountersCantBePutOnTypes],
  ['radiation_gain', parseRadiationGainInstead],
  ['boast_twice', parseBoastTwice],
  ['retrace', parseRetraceDuringYourTurn],
  ['ward_experience', parseWardExperience],
  ['skip_upkeep', parseHellbentSkipUpkeep],
  ['shared_fate_play', parseSharedFatePlay],
  ['sectors', parseSpaceSculptor],
  ['mana_ability_grant', parseQuotedManaAbilityGrant],
  ['die_gated_loyalty', (text) => /^\d+(?: or \d+)? - (?:\[|~ deals damage)/.test(text)],
  ['delve_grant', parseSpellHasDelve],
  ['cascade_mv', (text) => parseCascadeAtMv(text) > 0],
  ['cascade_double', (text) => parseDoubleCascadeFromHand(text) > 0],
  ['conspire', parseConspireFromExile],
  ['affinity', parseAffinityForCreatures],
  ['ninjutsu', (text) => !!parseNinjutsuGrant(text)],
  ['web_slinging', (text) => !!parseWebSlingingGrant(text)],
  ['treasure_cascade', parseTreasureCascade],
  ['protection_colors', parseProtectionFromColorsYouControl],
  ['protection_gorgons', parseProtectionFromGorgons],
  ['protection_mv', parseGreatestMvProtection],
  ['cant_target_colors', (text) => parseCantBeTargetOfColors(text).length > 0],
  ['creatures_hexproof_from_spells', parseCreaturesCantBeTargeted],
  ['blood_keywords', parseRayamiKeywords],
  ['echo_lands', (text) => parseEchoSacrificeLands(text) > 0],
  ['crew_once', parseCrewOnce],
  ['kicker_discard', parseKickerDiscardCreature],
  ['equip_once', parseEquipPayLifeOnce],
];

export function parseBatch112StaticKind(oracle: string, cardName?: string): string | null {
  const text = normalizeBatch112Oracle(oracle, cardName);
  for (const [kind, check] of CHECKS) if (check(text)) return kind;
  return null;
}
