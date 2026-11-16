// server/src/state/modules/batch106Parsers.ts
// Generic oracle-pattern parsers for B106 statics, replacements, grants, and CDAs.
// Public entry symbols are the parse* functions exported below.

function normalize(oracle: string): string {
  return String(oracle || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

function readCount(raw: string): number {
  const text = String(raw || '').toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  return COUNT_WORDS[text] || 0;
}

/** "If ~ / this / <name> would die, instead exile it with N <kind> counters on it." */
export function parseWouldDieInsteadExileWithNamedCounters(oracle: string): { count: number; counter: string } | null {
  const m = normalize(oracle).match(
    /if (?:~|this creature|this permanent|[^.]+?) would die, instead exile it with (\d+|one|two|three|four|five) ([a-z]+) counters? on it/i,
  );
  if (!m) return null;
  const count = readCount(m[1]);
  const counter = String(m[2] || '').toLowerCase();
  if (!(count > 0) || !counter) return null;
  return { count, counter };
}

/** "If ~ would deal combat damage to a player, instead put that many +1/+1 counters on ~ and that player mills that many." */
export function parseWouldDealCombatDamageToPlayerInsteadCountersAndMill(oracle: string): boolean {
  return /if (?:~|this creature|this permanent|[^.]+?) would deal combat damage to a player, instead put that many [^\n.]*counters on (?:~|it|this creature|[^.]+?) and that player mills that many/i
    .test(normalize(oracle));
}

/** "If a creature would deal damage to you, prevent N of that damage." */
export function parseIfCreatureWouldDealDamageToYouPreventN(oracle: string): { n: number } | null {
  const m = normalize(oracle).match(/if a creature would deal damage to you, prevent (\d+|one) of that damage/i);
  if (!m) return null;
  const n = readCount(m[1]);
  return n > 0 ? { n } : null;
}

/** "You have hexproof." */
export function parseYouHaveHexproof(oracle: string): boolean {
  return /(?:^|[.\n])\s*you have hexproof\b/i.test(String(oracle || '').replace(/\u2019/g, "'"));
}

/** "Creatures you control with +1/+1 counters on them have all activated abilities of all <type> cards exiled with ~." */
export function parseCreaturesYouControlWithPlusCountersCopyExiledActivated(oracle: string): { cardType: string } | null {
  const m = normalize(oracle).match(
    /creatures you control with \+1\/\+1 counters on them have all activated abilities of all (land|creature|artifact) cards? exiled with/i,
  );
  return m ? { cardType: String(m[1] || '').toLowerCase() } : null;
}

/** "Locus / ~ has each activated ability of the exiled cards used to craft it." */
export function parseHasEachActivatedAbilityOfCraftExiledCards(oracle: string): boolean {
  return /has each activated ability of the exiled cards used to craft (?:it|this)/i.test(normalize(oracle));
}

/** "You may activate each of those abilities only once each turn." */
export function parseActivateThoseAbilitiesOnlyOnceEachTurn(oracle: string): boolean {
  return /you may activate each of those abilities only once each turn/i.test(normalize(oracle));
}

/** "You may spend mana as though it were mana of any color to activate abilities of creatures you control." */
export function parseSpendManaAsAnyToActivateCreatureAbilities(oracle: string): boolean {
  return /you may spend mana as though it were mana of any color to activate abilities of creatures you control/i.test(normalize(oracle));
}

/** "Enchanted creature gets +N/+M and has afterlife K." */
export function parseEnchantedCreatureGetsPTAndHasAfterlife(oracle: string): { power: number; toughness: number; afterlife: number } | null {
  const m = normalize(oracle).match(/enchanted creature gets ([+-]\d+)\s*\/\s*([+-]\d+) and has afterlife (\d+)/i);
  if (!m) return null;
  const power = Number(m[1]);
  const toughness = Number(m[2]);
  const afterlife = Number(m[3]);
  if (![power, toughness, afterlife].every((n) => Number.isFinite(n)) || !(afterlife > 0)) return null;
  return { power, toughness, afterlife };
}

export type GraveyardEncoreEqualCostGrant = {
  creatureType?: string;
  artifactOnly: boolean;
  costMode: 'mana_value' | 'mana_cost';
};

/** "Each [type] [artifact] creature card in your graveyard has encore. Its encore cost is equal to its mana cost." */
export function parseGyCardsHaveEncore(oracle: string): GraveyardEncoreEqualCostGrant | null {
  const text = normalize(oracle);
  const manaCost = /each (?:([a-z][a-z'-]*) )?(artifact )?creature card in your graveyard has encore\.?\s*its encore cost is equal to its mana cost/i.exec(text);
  if (manaCost) {
    const typ = String(manaCost[1] || '').toLowerCase();
    return {
      creatureType: typ && typ !== 'artifact' ? typ : undefined,
      artifactOnly: Boolean(manaCost[2]) || typ === 'artifact',
      costMode: 'mana_cost',
    };
  }
  const manaValue = /each (?:([a-z][a-z'-]*) )?creature card in your graveyard has encore \{x\}, where x is its mana value/i.exec(text);
  if (!manaValue) return null;
  const typ = String(manaValue[1] || '').toLowerCase();
  return {
    creatureType: typ || undefined,
    artifactOnly: false,
    costMode: 'mana_value',
  };
}

/** "Gets +X/+0, where X is the greatest power among creature cards in your graveyard." */
export function parseGetsPlusXPowerGreatestGyCreaturePower(oracle: string): boolean {
  return /gets \+x\/(?:\+0|0), where x is the greatest power among creature cards in your graveyard/i.test(normalize(oracle));
}

export function parsePowerToughnessEqualToTotalPowerOfCraftExiled(oracle: string): boolean {
  return /power and toughness are each equal to the total power of the exiled cards used to craft/i.test(normalize(oracle));
}

export function parsePowerToughnessEqualToColorsAmongCraftExiled(oracle: string): boolean {
  return /power and toughness are each equal to the number of colors among (?:the )?exiled cards used to craft/i.test(normalize(oracle));
}

export function parsePowerToughnessEqualToTwentyMinusHighestLife(oracle: string): boolean {
  return /(?:power and toughness are each|power is) equal to 20 minus the (?:highest|greatest) life total among players/i.test(normalize(oracle));
}

export function parsePowerToughnessEqualToNonbasicLandsChosenPlayerControls(oracle: string): boolean {
  return /(?:power and toughness are each|power and toughness is) equal to the number of nonbasic lands (?:the )?chosen player controls/i.test(normalize(oracle));
}

export function parsePowerEqualToInstantAndSorceryYouOwnInExileAndGy(oracle: string): boolean {
  return /power is equal to the (?:total )?number of instant and sorcery cards you own in exile (?:and|plus)(?: in)? your graveyard/i.test(normalize(oracle));
}

export function parseEachPlayerSkipsTheirUntapStep(oracle: string): boolean {
  return /(?:each player skips|players skip) their untap steps?/i.test(normalize(oracle));
}

export function parseNonlandPermanentsYouControlAreEnchantmentsInAddition(oracle: string): boolean {
  return /nonland permanents you control(?: and (?:nonland )?permanent spells you control)? are enchantments in addition/i.test(normalize(oracle));
}

export function parseGetsPlusOneForEachOtherSameName(oracle: string): boolean {
  return /gets \+1\/\+1 for each other creature (?:you control )?(?:with the same name(?: as (?:it|this creature))?|named [^.]+)/i.test(normalize(oracle));
}

/** "Fungus creatures you control get +1/+1 for each spore counter on them." */
export function parseCreaturesOfTypeGetPTPerCounterOnThem(oracle: string): { typeWord: string; power: number; toughness: number; counter: string; controllerOnly: boolean } | null {
  const you = normalize(oracle).match(
    /(?:other )?([a-z]+) creatures you control get ([+-]\d+)\s*\/\s*([+-]\d+) for each ([a-z]+) counters? on them/i,
  );
  if (you) {
    const typeWord = String(you[1] || '').toLowerCase();
    if (typeWord && typeWord !== 'creature') {
      return { typeWord, power: Number(you[2]), toughness: Number(you[3]), counter: String(you[4] || '').toLowerCase(), controllerOnly: true };
    }
  }
  const all = normalize(oracle).match(
    /each ([a-z]+) creature gets ([+-]\d+)\s*\/\s*([+-]\d+) for each ([a-z]+) counters? on it/i,
  );
  if (!all) return null;
  const typeWord = String(all[1] || '').toLowerCase();
  if (!typeWord || typeWord === 'creature') return null;
  return { typeWord, power: Number(all[2]), toughness: Number(all[3]), counter: String(all[4] || '').toLowerCase(), controllerOnly: false };
}

/** "Creatures you don't control get -1/-1 for each slime counter on them." */
export function parseCreaturesYouDontControlGetPTPerCounterOnThem(oracle: string): { power: number; toughness: number; counter: string } | null {
  const m = normalize(oracle).match(
    /creatures you don(?:'t|’t) control get ([+-]\d+)\s*\/\s*([+-]\d+) for each ([a-z]+) counters? on them/i,
  );
  if (!m) return null;
  return { power: Number(m[1]), toughness: Number(m[2]), counter: String(m[3] || '').toLowerCase() };
}

/** "Enchanted Wall / creature can attack as though it didn't have defender." */
export function parseEnchantedCanAttackAsThoughItDidntHaveDefender(oracle: string): boolean {
  return /enchanted (?:creature|wall) can attack as though it did(?:n't| not) have defender/i.test(normalize(oracle));
}

/** "All creatures attack enchanted creature's controller each combat if able." */
export function parseAllCreaturesAttackEnchantedControllerIfAble(oracle: string): boolean {
  return /all creatures attack enchanted creature's controller each combat if able/i.test(normalize(oracle));
}

/** "Except for ~ and artifact creatures, creatures you control can't attack." */
export function parseCreaturesYouControlCantAttackExceptNamedAndArtifact(oracle: string): boolean {
  return /except for (?:~|this creature|[^.]+?) and artifact creatures, creatures you control can't attack/i.test(normalize(oracle));
}

/** "All creatures with magnet counters on them attack each combat if able." */
export function parseCreaturesWithNamedCountersAttackEachCombatIfAble(oracle: string): { counter: string } | null {
  const m = normalize(oracle).match(/all creatures with ([a-z]+) counters? on them attack each combat if able/i);
  return m ? { counter: String(m[1] || '').toLowerCase() } : null;
}

export function parseHasFlyingEtcAsLongAsCraftExiledCardHasKeyword(oracle: string): boolean {
  const text = normalize(oracle);
  return /as long as an exiled card used to craft [^.]+ has flying, [^.]+ has flying/i.test(text)
    || /(?:~|this creature|this permanent|[^.]+?) has flying as long as an exiled card used to craft (?:it|this) has flying/i.test(text);
}
