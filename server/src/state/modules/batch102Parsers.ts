// server/src/state/modules/batch102Parsers.ts
// B102 oracle parsers. Public: the parse* functions exported below.

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

export function parseSanctuaryBladeColorChoice(oracle: string): boolean {
  return /as (?:this equipment|~|[^,\n]+?) becomes attached to a creature, choose a color/i.test(normalize(oracle));
}

export function parseProtectionFromLastChosenColor(oracle: string): boolean {
  return /(?:equipped creature|it) gets [+-]\d+\/[+-]\d+ and has protection from the last chosen color/i.test(normalize(oracle))
    || /has protection from the last chosen color/i.test(normalize(oracle));
}

export function parseDarkbladeCombatDamageDraw(oracle: string): boolean {
  return /as long as you(?:'ve| have) surveilled this turn[\s\S]*deals combat damage to a player, you draw a card/i.test(normalize(oracle));
}

export function parseCreaturesWithoutFlyingDontUntap(oracle: string): boolean {
  return /creatures without flying don't untap during their controllers' untap steps/i.test(normalize(oracle));
}

export function parseArboriaAttackRestriction(oracle: string): boolean {
  return /creatures can't attack a player unless that player cast a spell or put a nontoken permanent onto the battlefield during their last turn/i.test(normalize(oracle));
}

export function parseAnotherCreatureWouldDieExile(oracle: string): boolean {
  return /if another creature would die, exile it instead/i.test(normalize(oracle));
}

export function parseIdrisExiledAbilitiesAndPump(oracle: string): boolean {
  return /has all activated and triggered abilities of the exiled card and gets \+x\/\+x, where x is the exiled card's mana value/i.test(normalize(oracle));
}

export function parseGoblinsAndElementalsHaveMenace(oracle: string): boolean {
  return /goblins you control and elementals you control have menace/i.test(normalize(oracle));
}

export function parseNoblesAndLessonsHaveLifelink(oracle: string): boolean {
  return /noble creatures you control and lesson spells you control have lifelink/i.test(normalize(oracle));
}

export function parseEnchantedMinusXPowerFromControllerGy(oracle: string): boolean {
  return /enchanted creature gets -x\/(?:-0|-n), where x is the number of cards in its controller's graveyard/i.test(normalize(oracle));
}

export function parseOtherCreaturesGetMinusOneMinusOne(oracle: string): boolean {
  return /^other creatures get -1\/-1$/im.test(normalize(oracle).replace(/\.$/, ''))
    || /(?:^|[.\n])other creatures get -1\/-1(?:\.|$)/i.test(normalize(oracle));
}

export function parseNamedPermanentCastLock(oracle: string): boolean {
  return /cast this spell only if no permanents named (?:~|this [a-z]+|[^.\n]+?) are on the battlefield/i.test(normalize(oracle));
}

export function parseDomainLandwalk(oracle: string): boolean {
  return /for each basic land type among lands you control, (?:this creature|~|it|[^,\n]+?) has landwalk of that type/i.test(normalize(oracle));
}

export function parsePreventDamageControllerDraws(oracle: string): boolean {
  return /if a source would deal damage to (?:this creature|~), prevent that damage(?:\.|,) the source's controller draws cards equal to the damage prevented this way/i.test(normalize(oracle));
}

export function parseBlockingOrBlockedHaveLifelink(oracle: string): boolean {
  return /creatures blocking or blocked by (?:this creature|~|[^.\n]+?) have lifelink/i.test(normalize(oracle));
}

export function parseDuringYourTurnBasePT(oracle: string): { power: number; toughness: number } | null {
  const m = normalize(oracle).match(/during your turn, (?:this creature|~|it|[^,\n]+?) has base power and toughness (\d+)\/(\d+)/i);
  if (!m) return null;
  return { power: parseInt(m[1], 10), toughness: parseInt(m[2], 10) };
}

export function parseDivinityCounterIndestructible(oracle: string): boolean {
  return /each permanent with a divinity counter on it has indestructible/i.test(normalize(oracle));
}

export function parseCluesYouControlAreEquipment(oracle: string): boolean {
  return /clues you control are equipment in addition to their other types and have/i.test(normalize(oracle));
}

export function parseCrewsUsingToughness(oracle: string): boolean {
  return /(?:this creature|~|[^.\n]+?) crews vehicles using its toughness rather than its power/i.test(normalize(oracle));
}

export function parseEnchantedCantBeBlockedIfGate(oracle: string): boolean {
  return /enchanted creature can't be blocked as long as you control a gate/i.test(normalize(oracle));
}

export function parseEnchantedIsFlagbearer(oracle: string): boolean {
  return /enchanted creature is a flagbearer/i.test(normalize(oracle));
}

export function parseAttackingYourOpponentHasTrample(oracle: string): boolean {
  return /each creature that's attacking (?:one of )?your opponents has trample/i.test(normalize(oracle));
}

export function parsePreventDamageWhileMonarchPlusCounters(oracle: string): boolean {
  return /if damage would be dealt to (?:~|this creature|.+) while you're the monarch, prevent that damage and put that many \+1\/\+1 counters on it/i.test(normalize(oracle));
}

export function parseHexproofUnlessAttacking(oracle: string): boolean {
  return /has hexproof unless (?:it's|it is) attacking/i.test(normalize(oracle));
}

export function parseOpponentsCreaturesCantGetP1P1(oracle: string): boolean {
  return /creatures your opponents control can't have \+1\/\+1 counters put on them/i.test(normalize(oracle));
}

export function parseEmptyHandDrawTwoLoseLife(oracle: string): boolean {
  return /if you would draw a card while you have no cards in hand, instead you draw (?:two|2) cards and you lose (?:1|one) life/i.test(normalize(oracle));
}

export function parseDamageRemovesP1P1AndPrevents(oracle: string): boolean {
  return /for each 1 damage that would be dealt to (?:this creature|~), if it has a \+1\/\+1 counter on it, remove a \+1\/\+1 counter from it and prevent that 1 damage/i.test(normalize(oracle));
}

export function parseDeliriumDoubleNoncombatDamage(oracle: string): boolean {
  return /if a source you control would deal noncombat damage to a permanent or player while there are (?:four|4) or more card types among cards in your graveyard, it deals double that damage instead/i.test(normalize(oracle));
}

export function parseEightCountersIsCreatureAnnihilator(oracle: string): { annihilator: number } | null {
  const m = normalize(oracle).match(/as long as (?:this artifact|~|it) has eight or more \+1\/\+1 counters on it, it's a 0\/0 creature in addition to its other types and it has annihilator (\d+)/i);
  if (!m) return null;
  return { annihilator: parseInt(m[1], 10) };
}

export const COLOR_CHOICE_OPTIONS = [
  { id: 'white', label: 'White' },
  { id: 'blue', label: 'Blue' },
  { id: 'black', label: 'Black' },
  { id: 'red', label: 'Red' },
  { id: 'green', label: 'Green' },
] as const;
