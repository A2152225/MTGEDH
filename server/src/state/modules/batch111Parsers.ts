// Batch 111 long-tail static and damage sentences. The card name and
// "this creature" are normalized to "~" by the caller.
// Public: normalizeBatch111Oracle, and the parse* helpers below.

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function wordNumber(raw: string): number {
  const token = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(token)) return Number(token);
  return WORDS[token] || 0;
}

export function normalizeBatch111Oracle(oracle: string, cardName?: string): string {
  let text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").replace(/\([^)]*\)/g, ' ');
  const name = String(cardName || '').split('//')[0].trim().toLowerCase();
  for (const part of [name, name.split(',')[0].trim()]) {
    if (part.length < 3) continue;
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\b${escaped}\\b`, 'g'), '~');
  }
  text = text.replace(/\bthis (?:creature|spacecraft|permanent|enchantment|artifact)\b/g, '~');
  return text.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

export type PtDelta = { power: number; toughness: number };

function pt(match: RegExpMatchArray | null, powerIndex = 1, toughIndex = 2): PtDelta | null {
  if (!match) return null;
  const power = Number(match[powerIndex]);
  const toughness = Number(match[toughIndex]);
  if (!Number.isFinite(power) || !Number.isFinite(toughness)) return null;
  return { power, toughness };
}

export function parseEnchantedPtPerOtherEnchantment(text: string): PtDelta | null {
  return pt(text.match(/enchanted creature gets \+(-?\d+)\/\+(-?\d+) for each other enchantment on the battlefield/));
}

export function parseEquippedPtEqualsManaValue(text: string): boolean {
  return /equipped creature gets \+x\/\+x, where x is its mana value/.test(text);
}

export function parseChosenTypeCreaturesGetPt(text: string): PtDelta | null {
  const match = text.match(/all creatures of the chosen type get ([+-]?\d+)\/([+-]?\d+)/);
  if (!match) return null;
  return { power: Number(match[1]), toughness: Number(match[2]) };
}

export function parseSelfPtPerExiledWithIt(text: string): PtDelta | null {
  return pt(text.match(/~ gets \+(\d+)\/\+(\d+) for each card exiled with it/));
}

export function parseSelfPtPerFaceDownCreature(text: string): PtDelta | null {
  return pt(text.match(/~ gets \+(\d+)\/\+(\d+) for each face-down creature on the battlefield/));
}

export function parseSelfPtPerArtifactYouControl(text: string): PtDelta | null {
  return pt(text.match(/~ gets \+(\d+)\/\+(\d+) for each artifact you control/));
}

export function parseEquippedPtPerArtifactYouControl(text: string): { toughness: number } | null {
  const match = text.match(/equipped creature gets \+x\/\+(\d+), where x is the number of artifacts you control/);
  return match ? { toughness: Number(match[1]) } : null;
}

export function parseEnchantedCreaturesYouControlPt(text: string): PtDelta | null {
  return pt(text.match(/creatures you control that are enchanted get \+(-?\d+)\/\+(-?\d+)/));
}

export function parseCreaturesYouControlMvOrLessPt(text: string): { mv: number; power: number; toughness: number } | null {
  const match = text.match(/creatures you control with mana value (\d+) or less get \+(-?\d+)\/\+(-?\d+)/);
  if (!match) return null;
  return { mv: Number(match[1]), power: Number(match[2]), toughness: Number(match[3]) };
}

export function parseSelfPtPerLandControlledNotOwned(text: string): PtDelta | null {
  return pt(text.match(/~ gets \+(\d+)\/\+(\d+) for each land you control but don't own/));
}

export function parseSelfPtPerOtherCreatureWithPlusCounter(text: string): PtDelta | null {
  return pt(text.match(/~ gets \+(\d+)\/\+(\d+) for each other creature you control with a \+1\/\+1 counter on it/));
}

export function parseSelfPtIfCommanderCreatureOrWalker(text: string): PtDelta | null {
  return pt(text.match(/~ gets \+(\d+)\/\+(\d+) as long as you control a commander that's a creature or planeswalker/));
}

export function parseOtherInfectCreaturesPt(text: string): PtDelta | null {
  return pt(text.match(/other creatures you control with infect get \+(\d+)\/\+(\d+)/));
}

export function parseLevelCounterCreaturesPt(text: string): PtDelta | null {
  return pt(text.match(/each creature you control with a level counter on it gets \+(\d+)\/\+(\d+)/));
}

export function parseSelfPtPerOtherSnow(text: string): PtDelta | null {
  return pt(text.match(/~ gets \+(\d+)\/\+(\d+) for each other snow permanent you control/));
}

export function parseEquippedLegendaryPt(text: string): PtDelta | null {
  return pt(text.match(/equipped creature gets \+(\d+)\/\+(\d+) as long as it's legendary/));
}

export function parseLandThatIsCreaturePt(text: string): PtDelta | null {
  return pt(text.match(/each land gets \+(\d+)\/\+(\d+) as long as it's a creature/));
}

export function parseSelfPtPerLandNamed(text: string): { name: string; power: number; toughness: number } | null {
  const match = text.match(/~ gets \+(\d+)\/\+(\d+) for each land you control named ([a-z0-9' -]+)/);
  if (!match) return null;
  return { power: Number(match[1]), toughness: Number(match[2]), name: match[3].trim() };
}

export function parseSelfPtPerColorAmongOtherLegendaries(text: string): PtDelta | null {
  return pt(text.match(/~ gets \+(\d+)\/\+(\d+) for each color among other legendary permanents you control/));
}

export function parseNonArchonBasePt(text: string): PtDelta | null {
  return pt(text.match(/non-archon creatures have base power and toughness (\d+)\/(\d+)/));
}

export function parseCreaturesBasePtEqualCreatureCount(text: string): boolean {
  return /creatures you control have base power and toughness each equal to the number of creatures you control/.test(text);
}

export function parseSelfBasePtIfGraveyardAtLeast(text: string): { count: number; power: number; toughness: number } | null {
  const match = text.match(/as long as there are (\d+|[a-z]+) or more cards in your graveyard, ~ has base power and toughness (\d+)\/(\d+)/);
  if (!match) return null;
  const count = wordNumber(match[1]);
  return count > 0 ? { count, power: Number(match[2]), toughness: Number(match[3]) } : null;
}

export function parseSelfNotCreatureIfGraveyardBelow(text: string): number {
  const match = text.match(/as long as there are fewer than (\d+|[a-z]+) cards in your graveyard, ~ isn't a creature/);
  return match ? wordNumber(match[1]) : 0;
}

export function parseForestsAreElfCreatures(text: string): boolean {
  return /forests you control are 1\/1 green elf creatures that are still lands/.test(text);
}

export function parseGoblinsAreBlackZombies(text: string): boolean {
  return /all goblins are black and are zombies in addition to their other creature types/.test(text);
}

export function parseEnchantedIsSubtypes(text: string): string[] {
  const match = text.match(/enchanted creature is an? ([a-z]+(?: [a-z]+)*)/);
  if (!match) return [];
  return match[1].split(/\s+/).filter((word) => !['and', 'a', 'an'].includes(word));
}

export function parseSelfPtIfOilCounters(text: string): { count: number; power: number; toughness: number } | null {
  const match = text.match(/as long as ~ has (\d+|[a-z]+) or more oil counters on it, it gets \+(\d+)\/\+(\d+)/);
  if (!match) return null;
  const count = wordNumber(match[1]);
  return count > 0 ? { count, power: Number(match[2]), toughness: Number(match[3]) } : null;
}

export function parseSelfPtIfUnlockedDoors(text: string): { count: number; power: number; toughness: number } | null {
  const match = text.match(/~ gets \+(\d+)\/\+(\d+) as long as there are (\d+|[a-z]+) or more unlocked doors among rooms you control/);
  if (!match) return null;
  const count = wordNumber(match[3]);
  return count > 0 ? { count, power: Number(match[1]), toughness: Number(match[2]) } : null;
}

export function parseOtherSamuraiPerBushido(text: string): PtDelta | null {
  return pt(text.match(/each other samurai creature you control gets \+(\d+)\/\+(\d+) for each point of bushido it has/));
}

export function parseOpponentNoncombatKeywords(text: string): string[] {
  const match = text.match(/as long as an opponent was dealt noncombat damage this turn, ~ has ([^.]+)/);
  if (!match) return [];
  return match[1].split(/\s+and\s+|,\s*/).map((word) => word.trim()).filter((word) =>
    ['flying', 'haste', 'trample', 'lifelink', 'vigilance', 'menace', 'hexproof', 'indestructible', 'deathtouch', 'first strike', 'double strike'].includes(word));
}

export function parseIndestructibleWhileDefender(text: string): boolean {
  return /~ has indestructible as long as it has defender/.test(text);
}

export function parseUnblockedNinjasLifelink(text: string): boolean {
  return /unblocked attacking ninjas you control have lifelink/.test(text);
}

export function parseHasteIfAdventureInExile(text: string): boolean {
  return /~ has haste as long as you own a card in exile that has an adventure/.test(text);
}

export function parseShroudOnArtifactsAndEnchantments(text: string): boolean {
  return /artifacts and enchantments you control have shroud/.test(text);
}

export function parseEnchantedToxic(text: string): number {
  const match = text.match(/enchanted creature has toxic (\d+)/);
  return match ? Number(match[1]) : 0;
}

export function parseColorConditionalKeywords(text: string): Array<{ color: string; keyword: string }> {
  if (!/each creature you control has .+ if it's /.test(text)) return [];
  const out: Array<{ color: string; keyword: string }> = [];
  for (const match of text.matchAll(/(vigilance|hexproof|lifelink|first strike|trample|flying|haste|menace|deathtouch|double strike) if it's (white|blue|black|red|green)/g)) {
    out.push({ keyword: match[1], color: match[2] });
  }
  return out;
}

export function parseCantAttackOrBlockUnlessExile(text: string): number {
  const match = text.match(/~ can't attack or block unless there are (\d+|[a-z]+) or more cards in exile/);
  return match ? wordNumber(match[1]) : 0;
}

export function parseCantAttackUnlessColorsAlsoAttack(text: string): string[] {
  const match = text.match(/~ can't attack unless an? ([a-z]+) or ([a-z]+) creature also attacks/);
  return match ? [match[1], match[2]] : [];
}

export function parseCantAttackUnlessYouControlPower(text: string): number {
  const match = text.match(/~ can't attack unless you control a creature with power (\d+) or greater/);
  return match ? Number(match[1]) : 0;
}

export function parseCantAttackUnlessGreaterPowerAlsoAttacks(text: string): boolean {
  return /~ can't attack unless a creature with greater power also attacks/.test(text);
}

export function parseCantBlockUnlessGreaterPowerAlsoBlocks(text: string): boolean {
  return /~ can't block unless a creature with greater power also blocks/.test(text);
}

export function parseCantAttackUnlessDefenderPoisoned(text: string): boolean {
  return /~ can't attack unless defending player is poisoned/.test(text);
}

export function parseCantAttackUnlessDefenderMonarch(text: string): boolean {
  return /~ can't attack unless defending player is the monarch/.test(text);
}

export function parseCantAttackUnlessDefenderGraveyard(text: string): number {
  const match = text.match(/~ can't attack unless defending player has (\d+|[a-z]+) or more cards in their graveyard/);
  return match ? wordNumber(match[1]) : 0;
}

export function parseOpponentsWithCountersCantAttackOrBlock(text: string): boolean {
  return /creatures your opponents control with counters on them can't attack or block/.test(text);
}

export function parseEnchantedCantBeBlockedExceptBy(text: string): string {
  const match = text.match(/enchanted creature can't be blocked except by ([a-z]+)/);
  return match ? match[1].replace(/s$/, '') : '';
}

export function parseYourCreaturesCantBeBlockedExceptLegendary(text: string): boolean {
  return /creatures you control can't be blocked except by legendary creatures/.test(text);
}

export function parseFlyingCantBlockYourCreatures(text: string): boolean {
  return /creatures with flying can't block creatures you control/.test(text);
}

export function parseColorsCantBlock(text: string): string[] {
  const match = text.match(/^([a-z]+) creatures and ([a-z]+) creatures can't block$/);
  return match ? [match[1], match[2]] : [];
}

export function parseCantBeBlockedIfCastInstantOrSorcery(text: string): boolean {
  return /~ can't be blocked as long as you've cast an instant or sorcery spell this turn/.test(text);
}

export function parseEnchantedYouControlExceptDefender(text: string): boolean {
  return /can't be blocked except by creatures with defender/.test(text);
}

export function parseCantBeBlockedIfOpponentGraveyard(text: string): number {
  const match = text.match(/as long as an opponent has (\d+|[a-z]+) or more cards in their graveyard, ~ can attack as though it didn't have defender and it can't be blocked/);
  return match ? wordNumber(match[1]) : 0;
}

export function parseTypeYouControlMaxBlockers(text: string): { type: string; max: number } | null {
  const match = text.match(/([a-z]+)s you control can't be blocked by more than (\d+|one|two|three|four|five) creatures?/);
  if (!match || match[1] === 'creature') return null;
  return { type: match[1].replace(/ie$/, 'y').replace(/s$/, ''), max: wordNumber(match[2]) };
}

export function parseAnyCounterMaxBlockers(text: string): number {
  const match = text.match(/each creature you control with a counter on it can't be blocked by more than (\d+|one|two|three|four|five) creatures?/);
  return match ? wordNumber(match[1]) : 0;
}

export function parseNonlandDontUntap(text: string): boolean {
  return /nonland permanents don't untap during their controllers' untap steps/.test(text);
}

export function parseChosenTypeDontUntap(text: string): boolean {
  return /creatures of the chosen type don't untap during their controllers' untap steps/.test(text);
}

export function parseNonwhitePowerDontUntap(text: string): number {
  const match = text.match(/nonwhite creatures with power (\d+) or greater don't untap during their controllers' untap steps/);
  return match ? Number(match[1]) : 0;
}

export function parseDefenderIfPowerAtLeast(text: string): number {
  const match = text.match(/as long as ~'s power is (\d+) or greater, it can attack as though it didn't have defender/);
  return match ? Number(match[1]) : 0;
}

export function parseColorSpellDamageDouble(text: string): string {
  const match = text.match(/if an? (white|blue|black|red|green) instant or sorcery spell you control would deal damage, it deals double that damage instead/);
  return match ? match[1] : '';
}

export function parseNoncombatDamageToOpponentPlus(text: string): number {
  const match = text.match(/if a source you control would deal noncombat damage to an opponent, it deals that much damage plus (\d+) instead/);
  return match ? Number(match[1]) : 0;
}

export function parseDamageBecomesIfAtLeast(text: string): { atLeast: number; becomes: number } | null {
  const match = text.match(/if a source would deal (\d+) or more damage to a permanent or player, that source deals (\d+) damage to that permanent or player instead/);
  return match ? { atLeast: Number(match[1]), becomes: Number(match[2]) } : null;
}

export function parseOptionalSkipDraw(text: string): boolean {
  return /if you would draw a card, you may skip that draw instead/.test(text);
}

const KIND_CHECKS: Array<[string, (text: string) => boolean]> = [
  ['enchanted_pt_per_enchantment', (text) => !!parseEnchantedPtPerOtherEnchantment(text)],
  ['equipped_mv_pt', parseEquippedPtEqualsManaValue],
  ['chosen_type_pt', (text) => !!parseChosenTypeCreaturesGetPt(text)],
  ['exiled_with_pt', (text) => !!parseSelfPtPerExiledWithIt(text)],
  ['face_down_pt', (text) => !!parseSelfPtPerFaceDownCreature(text)],
  ['artifact_count_pt', (text) => !!parseSelfPtPerArtifactYouControl(text)],
  ['equipped_artifact_pt', (text) => !!parseEquippedPtPerArtifactYouControl(text)],
  ['enchanted_you_control_pt', (text) => !!parseEnchantedCreaturesYouControlPt(text)],
  ['mv_or_less_pt', (text) => !!parseCreaturesYouControlMvOrLessPt(text)],
  ['land_not_owned_pt', (text) => !!parseSelfPtPerLandControlledNotOwned(text)],
  ['plus_counter_creatures_pt', (text) => !!parseSelfPtPerOtherCreatureWithPlusCounter(text)],
  ['commander_permanent_pt', (text) => !!parseSelfPtIfCommanderCreatureOrWalker(text)],
  ['infect_pt', (text) => !!parseOtherInfectCreaturesPt(text)],
  ['level_counter_pt', (text) => !!parseLevelCounterCreaturesPt(text)],
  ['snow_pt', (text) => !!parseSelfPtPerOtherSnow(text)],
  ['equipped_legendary_pt', (text) => !!parseEquippedLegendaryPt(text)],
  ['land_creature_pt', (text) => !!parseLandThatIsCreaturePt(text)],
  ['land_named_pt', (text) => !!parseSelfPtPerLandNamed(text)],
  ['legendary_colors_pt', (text) => !!parseSelfPtPerColorAmongOtherLegendaries(text)],
  ['base_pt_creature_count', parseCreaturesBasePtEqualCreatureCount],
  ['non_archon_base_pt', (text) => !!parseNonArchonBasePt(text)],
  ['base_pt_graveyard', (text) => !!parseSelfBasePtIfGraveyardAtLeast(text)],
  ['not_creature_graveyard', (text) => parseSelfNotCreatureIfGraveyardBelow(text) > 0],
  ['forest_elf', parseForestsAreElfCreatures],
  ['goblin_zombie', parseGoblinsAreBlackZombies],
  ['enchanted_subtypes', (text) => parseEnchantedIsSubtypes(text).length > 0 && /enchanted creature is an? [a-z]/.test(text) && !/gets /.test(text)],
  ['oil_pt', (text) => !!parseSelfPtIfOilCounters(text)],
  ['unlocked_doors_pt', (text) => !!parseSelfPtIfUnlockedDoors(text)],
  ['bushido_pt', (text) => !!parseOtherSamuraiPerBushido(text)],
  ['noncombat_keywords', (text) => parseOpponentNoncombatKeywords(text).length > 0],
  ['indestructible_defender', parseIndestructibleWhileDefender],
  ['ninja_lifelink', parseUnblockedNinjasLifelink],
  ['adventure_haste', parseHasteIfAdventureInExile],
  ['shroud_grant', parseShroudOnArtifactsAndEnchantments],
  ['toxic', (text) => parseEnchantedToxic(text) > 0],
  ['color_keywords', (text) => parseColorConditionalKeywords(text).length > 0],
  ['exile_attack_block', (text) => parseCantAttackOrBlockUnlessExile(text) > 0],
  ['color_also_attacks', (text) => parseCantAttackUnlessColorsAlsoAttack(text).length > 0],
  ['control_power_attack', (text) => parseCantAttackUnlessYouControlPower(text) > 0],
  ['greater_power_attack', parseCantAttackUnlessGreaterPowerAlsoAttacks],
  ['greater_power_block', parseCantBlockUnlessGreaterPowerAlsoBlocks],
  ['poison_attack', parseCantAttackUnlessDefenderPoisoned],
  ['monarch_attack', parseCantAttackUnlessDefenderMonarch],
  ['graveyard_attack', (text) => parseCantAttackUnlessDefenderGraveyard(text) > 0],
  ['opponent_counters_combat', parseOpponentsWithCountersCantAttackOrBlock],
  ['enchanted_except_type', (text) => !!parseEnchantedCantBeBlockedExceptBy(text)],
  ['legendary_blockers', parseYourCreaturesCantBeBlockedExceptLegendary],
  ['flying_cant_block', parseFlyingCantBlockYourCreatures],
  ['colors_cant_block', (text) => parseColorsCantBlock(text).length > 0],
  ['spell_unblockable', parseCantBeBlockedIfCastInstantOrSorcery],
  ['defender_blockers', parseEnchantedYouControlExceptDefender],
  ['opponent_gy_unblockable', (text) => parseCantBeBlockedIfOpponentGraveyard(text) > 0],
  ['type_max_blockers', (text) => !!parseTypeYouControlMaxBlockers(text)],
  ['any_counter_max_blockers', (text) => parseAnyCounterMaxBlockers(text) > 0],
  ['nonland_untap', parseNonlandDontUntap],
  ['chosen_type_untap', parseChosenTypeDontUntap],
  ['nonwhite_untap', (text) => parseNonwhitePowerDontUntap(text) > 0],
  ['power_defender', (text) => parseDefenderIfPowerAtLeast(text) > 0],
];

export function parseBatch111StaticKind(oracle: string, cardName?: string): string | null {
  const text = normalizeBatch111Oracle(oracle, cardName);
  for (const [kind, check] of KIND_CHECKS) {
    if (check(text)) return kind;
  }
  return null;
}
