/**
 * Round 65 leftover promotions, second half: leaves-the-battlefield, cycling, curse, counter,
 * monstrous, gate, exile-play, discard and door events. Reached from parseRound65TriggerSentence
 * (reparse already refuses the incoming sentence); falls through to Round 66.
 */
import { type Parsed65 as Parsed, withFields65 as withFields, stampSubject65 as stampSubject, combineDual65 as combineDual, splitOrList65 as splitOrList, emptySubject65 as EMPTY_SUBJECT, compose65 } from './parseRound65Helpers.js';
import { parseRound66TriggerSentence } from './parseRound66Events.js';
import { normalizeCreatureTypeWord } from '../../../shared/src/creatureTypes.js';

type Reparse=(s:string)=>Parsed|null;

export function parseRound65LateTriggerSentence(text: string, reparse: Reparse): Parsed | null {
  const orNontokenLtb = /^(whenever|when) (~|[a-z][a-z0-9' ,.-]{0,40}?|this creature) or another nontoken creature you control leaves the battlefield,\s*(.+)$/.exec(text);
  if (orNontokenLtb) {
    return combineDual(
      reparse('whenever ' + orNontokenLtb[2] + ' leaves the battlefield, ' + orNontokenLtb[3]),
      stampSubject(reparse('whenever another creature you control leaves the battlefield, ' + orNontokenLtb[3]), { token: 'nontoken' }),
    );
  }
  const ltbWithoutDying = /^(whenever|when) this creature or another creature you control leaves the battlefield without dying,\s*(.+)$/.exec(text);
  if (ltbWithoutDying) return withFields(reparse('whenever this creature or another creature you control leaves the battlefield, ' + ltbWithoutDying[2]), { notFromDying: true } as any);
  const ltbOrUntap = /^(when|whenever) (this artifact|this creature|this permanent|~|[a-z][a-z0-9' ,.-]{0,40}?) (?:leaves the battlefield or becomes untapped|becomes untapped or leaves the battlefield),\s*(.+)$/.exec(text);
  if (ltbOrUntap) {
    return combineDual(
      reparse(ltbOrUntap[1] + ' ' + ltbOrUntap[2] + ' leaves the battlefield, ' + ltbOrUntap[3]),
      reparse(ltbOrUntap[1] + ' ' + ltbOrUntap[2] + ' becomes untapped, ' + ltbOrUntap[3]),
    );
  }
  const selfOrAnotherLtb = /^(whenever|when) (~|[a-z][a-z0-9' ,.-]{0,40}?|this creature) or another creature you control leaves the battlefield,\s*(.+)$/.exec(text);
  if (selfOrAnotherLtb) {
    return combineDual(
      reparse('whenever ' + selfOrAnotherLtb[2] + ' leaves the battlefield, ' + selfOrAnotherLtb[3]),
      reparse('whenever another creature you control leaves the battlefield, ' + selfOrAnotherLtb[3]),
    );
  }
  const norin = /^(when|whenever) a player casts a spell or a creature attacks,\s*(.+)$/.exec(text);
  if (norin) return combineDual(reparse('whenever a player casts a spell, ' + norin[2]), reparse('whenever a creature attacks, ' + norin[2]));
  const cycleSelfOrOther = /^(whenever|when) you cycle this card or cycle another card(?: while this enchantment is on the battlefield)?,\s*(.+)$/.exec(text);
  if (cycleSelfOrOther) return withFields(reparse('whenever you cycle a card, ' + cycleSelfOrOther[2]), { includeOther: true } as any);
  const curseGy = /^(whenever|when) a curse is put into your graveyard from the battlefield,\s*(.+)$/.exec(text);
  if (curseGy) {
    const cursed = stampSubject(
      reparse('whenever an enchantment is put into your graveyard from the battlefield, ' + curseGy[2]),
      { subtypeGroups: [['curse']] },
    );
    if (cursed) return cursed;
  }
  const unblockedCombat = /^(whenever|when) a creature attacks and isn't blocked this combat,\s*(.+)$/.exec(text);
  if (unblockedCombat) return withFields(reparse("whenever a creature attacks and isn't blocked, " + unblockedCombat[2]), { thisCombat: true } as any);
  const enchantedAttacksOpp = /^(whenever|when) an enchanted creature attacks one of your opponents,\s*(.+)$/.exec(text);
  if (enchantedAttacksOpp) {
    const attacked = withFields(reparse('whenever enchanted creature attacks, ' + enchantedAttacksOpp[2]), { attackedPlayer: 'opponent' } as any);
    if (attacked) return attacked;
  }
  const enchOrEnchCr = /^(whenever|when) an enchanted creature or enchantment creature you control attacks,\s*(.+)$/.exec(text);
  if (enchOrEnchCr) {
    return combineDual(
      withFields(reparse('whenever a creature you control attacks, ' + enchOrEnchCr[2]), { requiresEnchantedSubject: true } as any),
      stampSubject(reparse('whenever a creature you control attacks, ' + enchOrEnchCr[2]), { typeGroups: [['enchantment'], ['creature']], groups: [{ types: ['enchantment', 'creature'], subtypes: [] }] }),
    );
  }
  const orTypeAttacks = /^(whenever|when) an? ([a-z]+(?:, [a-z]+)*),? or ([a-z]+) you control attacks,\s*(.+)$/.exec(text);
  if (orTypeAttacks) {
    const types = splitOrList(orTypeAttacks[2] + ', ' + orTypeAttacks[3]);
    let acc: Parsed | null = null;
    for (const typ of types) {
      const part = reparse('whenever a ' + typ + ' you control attacks, ' + orTypeAttacks[4]);
      acc = acc ? withFields(acc, { alternatives: [...(acc.condition.alternatives || []), ...(part?.condition.alternatives || [])] }) : part;
    }
    return acc;
  }
  const kaalia = /^(whenever|when) (~|[a-z][a-z0-9' ,.-]{0,40}?|this creature) attacks an opponent,\s*(.+)$/.exec(text);
  if (kaalia) return withFields(reparse('whenever ' + kaalia[2] + ' attacks, ' + kaalia[3]), { attackedPlayer: 'opponent' } as any);
  const auraAttack = /^(whenever|when) one or more creatures that are enchanted by an aura you control attack,\s*(.+)$/.exec(text);
  if (auraAttack) return withFields(reparse('whenever a creature you control attacks, ' + auraAttack[2]), { quantity: 'one_or_more', requiresEnchantedSubject: true } as any);
  const typeAttackPlayer = /^(whenever|when) one or more (non-)?([a-z]+) you control attack a player,\s*(.+)$/.exec(text);
  if (typeAttackPlayer) {
    // Plural subject ("Demons", "creatures") reparsed in singular so the subtype matches type lines.
    const fields: Record<string, unknown> = { quantity: 'one_or_more', attackedTargetType: 'player' };
    const word = /^creatures?$/.test(typeAttackPlayer[3]) ? 'creature' : normalizeCreatureTypeWord(typeAttackPlayer[3]) || typeAttackPlayer[3];
    const base = reparse('whenever a ' + (typeAttackPlayer[2] ? 'creature' : word) + ' you control attacks a player, ' + typeAttackPlayer[4]);
    const stamped = typeAttackPlayer[2] ? stampSubject(base, { excludedWords: [word] }) : base;
    if (stamped) return withFields(stamped, fields as any);
  }
  const typesInGyAtk = /^(whenever|when) this creature attacks while there are (\w+) or more card types among cards in your graveyard,\s*(.+)$/.exec(text);
  if (typesInGyAtk) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = words[typesInGyAtk[2]] || Number(typesInGyAtk[2]);
    return withFields(reparse('whenever this creature attacks, ' + typesInGyAtk[3]), { minCardTypesInGraveyard: n } as any);
  }
  const allNonWalls = /^(whenever|when) all non-wall creatures you control attack,\s*(.+)$/.exec(text);
  if (allNonWalls) return withFields(reparse('whenever a creature you control attacks, ' + allNonWalls[2]), { allNonWallsAttack: true } as any);
  const mvEqPower = /^(whenever|when) you cast a creature spell with mana value equal to (~|'s|this creature)'?s? power,\s*(.+)$/.exec(text)
    || /^(whenever|when) you cast a creature spell with mana value equal to ([a-z][a-z0-9' ,.-]{0,40}?)(?:'s)? power,\s*(.+)$/.exec(text);
  if (mvEqPower) return withFields(reparse('whenever you cast a creature spell, ' + mvEqPower[3]), { spellManaValueEqualsSourcePower: true } as any);
  const powerIn = /^(whenever|when) you cast a creature spell with power (\d+), (\d+), or (\d+),\s*(.+)$/.exec(text);
  if (powerIn) return withFields(reparse('whenever you cast a creature spell, ' + powerIn[5]), { spellPowerIn: [Number(powerIn[2]), Number(powerIn[3]), Number(powerIn[4])] } as any);
  const doctor = /^(whenever|when) you cast a doctor spell or creature spell with doctor's companion,\s*(.+)$/.exec(text);
  if (doctor) {
    return combineDual(
      reparse('whenever you cast a doctor spell, ' + doctor[2]),
      withFields(reparse('whenever you cast a creature spell, ' + doctor[2]), { hasDoctorsCompanion: true } as any),
    );
  }
  const noncrOrDragon = /^(whenever|when) you cast a noncreature spell or a dragon spell,\s*(.+)$/.exec(text);
  if (noncrOrDragon) return combineDual(reparse('whenever you cast a noncreature spell, ' + noncrOrDragon[2]), reparse('whenever you cast a dragon spell, ' + noncrOrDragon[2]));
  const blueSymbols = /^(whenever|when) you cast a noncreature spell with one or more ([a-z]+) mana symbols in its mana cost,\s*(.+)$/.exec(text);
  if (blueSymbols) return withFields(reparse('whenever you cast a noncreature spell, ' + blueSymbols[3]), { spellHasColorManaSymbol: blueSymbols[2][0], minColorManaSymbols: 1 } as any);
  const afterFirst = /^(whenever|when) you cast a spell during your turn other than your first spell that turn,\s*(.+)$/.exec(text);
  if (afterFirst) return withFields(reparse('whenever you cast a spell, ' + afterFirst[2]), { excludeFirstSpellEachTurn: true, whoseTurn: 'you' } as any);
  const phyrexian = /^(whenever|when) you cast a spell with \{h\} in its mana cost,\s*(.+)$/.exec(text);
  if (phyrexian) return withFields(reparse('whenever you cast a spell, ' + phyrexian[2]), { spellHasPhyrexian: true } as any);
  const exactTwo = /^(whenever|when) you cast a spell that's exactly two colors,\s*(.+)$/.exec(text);
  if (exactTwo) return withFields(reparse('whenever you cast a spell, ' + exactTwo[2]), { exactColorCount: 2 } as any);
  const whileCounters = /^(whenever|when) you cast an instant or sorcery spell while this enchantment has (two|2|\d+) or more ([a-z]+) counters on it,\s*(.+)$/.exec(text);
  if (whileCounters) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4 };
    const n = words[whileCounters[2]] || Number(whileCounters[2]);
    return withFields(reparse('whenever you cast an instant or sorcery spell, ' + whileCounters[4]), { sourceCounterCountGte: n, sourceCounterType: whileCounters[3] } as any);
  }
  const mvGtExp = /^(whenever|when) you cast an instant or sorcery spell with mana value greater than the number of ([a-z]+) counters you have,\s*(.+)$/.exec(text);
  if (mvGtExp) return withFields(reparse('whenever you cast an instant or sorcery spell, ' + mvGtExp[3]), { spellManaValueGtPlayerCounters: mvGtExp[2] } as any);
  const fromExileEither = /^(whenever|when) you cast a spell from exile or a land you control enters from exile,\s*(.+)$/.exec(text);
  if (fromExileEither) {
    return combineDual(
      withFields(reparse('whenever you cast a spell, ' + fromExileEither[2]), { castFromZone: 'exile' } as any),
      withFields(reparse('whenever a land you control enters, ' + fromExileEither[2]), { fromZone: 'exile' } as any),
    );
  }
  const ptOrMv = /^(when|whenever) (this creature|this permanent|~|[a-z][a-z0-9' ,.-]{0,40}?) enters? and whenever you cast a spell with power, toughness, or mana value (\d+),\s*(.+)$/.exec(text);
  if (ptOrMv) {
    const n = Number(ptOrMv[3]);
    return combineDual(
      reparse('whenever ' + ptOrMv[2] + ' enters, ' + ptOrMv[4]),
      withFields(reparse('whenever you cast a spell, ' + ptOrMv[4]), { spellPowerOrToughnessOrMv: n } as any),
    );
  }
  const selfBecomesTapped = /^(whenever|when) (~|this permanent|this creature) become[s]? tapped,\s*(.+)$/.exec(text);
  if (selfBecomesTapped && !/or /.test(text)) return reparse('whenever this creature becomes tapped, ' + selfBecomesTapped[3]);
  const teamworkTap = /^(whenever|when) (~|[a-z][a-z0-9' ,.-]{0,40}?|this creature) becomes tapped to pay a teamwork cost,\s*(.+)$/.exec(text);
  if (teamworkTap) return withFields(reparse('whenever ' + teamworkTap[2] + ' becomes tapped, ' + teamworkTap[3]), { teamworkCost: true } as any);
  const firstTapYourTurn = /^(whenever|when) this creature becomes tapped for the first time during each of your turns,\s*(.+)$/.exec(text);
  if (firstTapYourTurn) return withFields(reparse('whenever this creature becomes tapped, ' + firstTapYourTurn[2]), { onceEachTurn: true, whoseTurn: 'you' } as any);
  const tapWhileCounter = /^(whenever|when) this creature becomes tapped while it has a ([^ ]+) counter on it,\s*(.+)$/.exec(text);
  if (tapWhileCounter) return withFields(reparse('whenever this creature becomes tapped, ' + tapWhileCounter[3]), { sourceHasCounter: tapWhileCounter[2] } as any);
  const merfolkTap = /^(whenever|when) one or more nontoken ([a-z]+) you control become tapped,\s*(.+)$/.exec(text);
  if (merfolkTap) return stampSubject(withFields(reparse('whenever a ' + merfolkTap[2] + ' you control becomes tapped, ' + merfolkTap[3]), { quantity: 'one_or_more' } as any), { token: 'nontoken' });
  const fortifiedTap = /^(whenever|when) fortified land becomes tapped,\s*(.+)$/.exec(text);
  if (fortifiedTap) return withFields(reparse('whenever a land becomes tapped, ' + fortifiedTap[2]), { requiresFortifiedSubject: true } as any);
  const landManaChosen = /^(whenever|when) a land's ability causes you to add one or more mana of the chosen color,\s*(.+)$/.exec(text);
  if (landManaChosen) return withFields(reparse('whenever a land is tapped for mana, ' + landManaChosen[2]), { producedChosenColor: true } as any);
  const artifactTapOrActivate = /^(whenever|when) (an artifact(?: an opponent controls)?|enchanted artifact) becomes tapped or (?:an opponent|a player) activates (?:an artifact's ability|an ability of enchanted artifact) without \{t\} in its activation cost,\s*(.+)$/.exec(text);
  if (artifactTapOrActivate) {
    const subj = artifactTapOrActivate[2].includes('opponent') ? 'an artifact an opponent controls' : artifactTapOrActivate[2] === 'enchanted artifact' ? 'enchanted artifact' : 'an artifact';
    const combined = combineDual(
      reparse('whenever ' + subj + ' becomes tapped, ' + artifactTapOrActivate[3]),
      withFields(reparse('whenever a player activates an ability of ' + subj + ', ' + artifactTapOrActivate[3]), { notTapCost: true } as any),
    );
    if (combined) return combined;
  }
  const dealtFirst = /^(whenever|when) (~|[a-z][a-z0-9' ,.-]{0,40}?|this creature) is dealt damage for the first time each turn,\s*(.+)$/.exec(text);
  if (dealtFirst) return withFields(reparse('whenever ' + dealtFirst[2] + ' is dealt damage, ' + dealtFirst[3]), { onceEachTurn: true } as any);
  const oppSrcYouOrPerm = /^(whenever|when) a source an opponent controls deals damage to you or a permanent you control,\s*(.+)$/.exec(text);
  if (oppSrcYouOrPerm) {
    const youHalf = withFields(reparse('whenever a source an opponent controls deals damage to you, ' + oppSrcYouOrPerm[2]), { damageRecipient: 'you' } as any);
    if (youHalf) return withFields(youHalf, { damageRecipient: 'you_or_permanent_you_control' } as any);
    return compose65('deals_damage', oppSrcYouOrPerm[2], { damageRecipient: 'you_or_permanent_you_control' }, {});
  }
  // "a source an opponent controls deals damage to this creature" is owned by round 67.
  // Reparsing it as damage to a creature drops the opponent filter.
  const chosenColorDmg = /^(whenever|when) a source of the chosen color deals damage to you,\s*(.+)$/.exec(text);
  if (chosenColorDmg) return withFields(reparse('whenever a source deals damage to you, ' + chosenColorDmg[2]), { sourceChosenColor: true, damageRecipient: 'you' } as any);
  const enchPlayerDmg = /^(whenever|when) enchanted player is dealt damage,\s*(.+)$/.exec(text);
  if (enchPlayerDmg) return withFields(reparse('whenever a player is dealt damage, ' + enchPlayerDmg[2]), { enchantedPlayer: true } as any);
  const tapOrDmg = /^(when|whenever) enchanted creature becomes tapped or is dealt damage,\s*(.+)$/.exec(text);
  if (tapOrDmg) {
    return combineDual(
      withFields(reparse('whenever this creature becomes tapped, ' + tapOrDmg[2]), { requiresEnchantedSubject: true } as any),
      withFields(reparse('whenever this creature is dealt damage, ' + tapOrDmg[2]), { requiresEnchantedSubject: true } as any),
    );
  }
  const blocksThis = /^(whenever|when) a creature blocks this creature,\s*(.+)$/.exec(text);
  if (blocksThis) return withFields(reparse('whenever a creature blocks, ' + blocksThis[2]), { blockPartnerIsSource: true } as any);
  const enchBlocked = /^(whenever|when) a creature you control that's enchanted becomes blocked,\s*(.+)$/.exec(text);
  if (enchBlocked) return withFields(reparse('whenever a creature you control becomes blocked, ' + enchBlocked[2]), { requiresEnchantedSubject: true } as any);
  const eqBlocks = /^(whenever|when) equipped creature blocks a creature,\s*(.+)$/.exec(text);
  if (eqBlocks) return withFields(reparse('whenever equipped creature blocks, ' + eqBlocks[2]), {} as any);
  const becomeBlockedGroup = /^(whenever|when) one or more creatures you control become blocked,\s*(.+)$/.exec(text);
  if (becomeBlockedGroup) return withFields(reparse('whenever a creature you control becomes blocked, ' + becomeBlockedGroup[2]), { quantity: 'one_or_more' } as any);
  const blocksNoFly = /^(whenever|when) this creature blocks a creature without flying,\s*(.+)$/.exec(text);
  if (blocksNoFly) return stampSubject(reparse('whenever this creature blocks a creature, ' + blocksNoFly[2]), { keywordsWithout: ['flying'] });
  const blocksTwo = /^(whenever|when) this creature blocks two or more creatures,\s*(.+)$/.exec(text);
  if (blocksTwo) return withFields(reparse('whenever this creature blocks, ' + blocksTwo[2]), { minBlockedCreatures: 2 } as any);
  const sameNameMana = /^(whenever|when) a land with the same name as the exiled card is tapped for mana,\s*(.+)$/.exec(text);
  if (sameNameMana) return withFields(reparse('whenever a land is tapped for mana, ' + sameNameMana[2]), { sameNameAsExiledWithSource: true } as any);
  const atkManyLands = /^(whenever|when) this creature attacks a player who controls (eight|\d+) or more lands,\s*(.+)$/.exec(text);
  if (atkManyLands) {
    const n = atkManyLands[2] === 'eight' ? 8 : Number(atkManyLands[2]);
    return withFields(reparse('whenever this creature attacks a player, ' + atkManyLands[3]), { defendingLandCountGte: n } as any);
  }
  const solveCase = /^(when|whenever) this creature enters and whenever you solve a case,\s*(.+)$/.exec(text);
  if (solveCase) return combineDual(reparse('whenever this creature enters, ' + solveCase[2]), withFields({ condition: { event: 'performs', action: 'solve_case', quantity: 'one', alternatives: [{ controller: 'you', source: 'any', subject: { ...EMPTY_SUBJECT } }] }, effect: solveCase[2] }, {} as any));
  const millNonland = /^(whenever|when) one or more nonland cards are milled,\s*(.+)$/.exec(text);
  if (millNonland) return withFields(reparse('whenever a player mills one or more cards, ' + millNonland[2]), { milledNonland: true, quantity: 'one_or_more' } as any);
  const secondDraw = /^(whenever|when) a player draws their second card during their turn,\s*(.+)$/.exec(text);
  if (secondDraw) return withFields(reparse('whenever a player draws a card, ' + secondDraw[2]), { ordinal: 'second', whoseTurn: 'each_player' } as any);
  const loyaltyRm = /^(whenever|when) one or more loyalty counters are removed from (~|[a-z][a-z0-9' ,.-]{0,40}?|this planeswalker),\s*(.+)$/.exec(text);
  if (loyaltyRm) return withFields(reparse('whenever a counter is removed from ' + loyaltyRm[2] + ', ' + loyaltyRm[3]), { placedCounter: 'loyalty', quantity: 'one_or_more' } as any);
  const youPlace = /^(whenever|when) you put one or more counters on a permanent or player,\s*(.+)$/.exec(text);
  if (youPlace) return withFields(reparse('whenever one or more counters are put on a permanent, ' + youPlace[2]), { quantity: 'one_or_more', includesPlayerCounters: true } as any);
  const monstrous = /^(when|whenever) (~|[a-z][a-z0-9' ,.-]{0,40}?|this creature) becomes monstrous,\s*(.+)$/.exec(text);
  if (monstrous) return reparse('whenever ' + monstrous[2] + ' becomes monstrous, ' + monstrous[3]) || withFields({
    condition: { event: 'becomes_monstrous', quantity: 'one', alternatives: [{ controller: 'you', source: 'self', subject: { ...EMPTY_SUBJECT } }] },
    effect: monstrous[3],
  }, {} as any);
  const transformOrDies = /^(when|whenever) this creature transforms into (this permanent|this creature|~|[a-z][a-z0-9' ,.-]{0,40}?) or dies,\s*(.+)$/.exec(text);
  if (transformOrDies) return combineDual(reparse('whenever this creature transforms, ' + transformOrDies[3]), reparse('whenever this creature dies, ' + transformOrDies[3]));
  const gateGy = /^(whenever|when) a gate you control enters,\s*(.+)$/.exec(text);
  if (gateGy) return withFields(stampSubject(reparse('whenever a land you control enters, ' + gateGy[2]), { subtypeGroups: [['gate']], groups: [{ types: ['land'], subtypes: ['gate'] }] }), { sourceInGraveyard: true } as any);
  const sameNameLand = /^(whenever|when) a land an opponent controls with the same name as the exiled card enters,\s*(.+)$/.exec(text);
  if (sameNameLand) return withFields(reparse('whenever a land an opponent controls enters, ' + sameNameLand[2]), { sameNameAsExiledWithSource: true } as any);
  const landOrSpellExile = /^(whenever|when) a player plays a land from exile or casts a spell from exile,\s*(.+)$/.exec(text);
  if (landOrSpellExile) {
    return combineDual(
      withFields(reparse('whenever a player plays a land, ' + landOrSpellExile[2]), { fromZone: 'exile' } as any),
      withFields(reparse('whenever a player casts a spell, ' + landOrSpellExile[2]), { castFromZone: 'exile' } as any),
    );
  }
  const oppDiscard = /^(whenever|when) a spell or ability an opponent controls causes you to discard a card,\s*(.+)$/.exec(text);
  if (oppDiscard) return withFields(reparse('whenever you discard a card, ' + oppDiscard[2]), { causedByOpponent: true } as any);
  const roomEtb = /^(when|whenever) you unlock this door,\s*(.+)$/.exec(text);
  if (roomEtb) return withFields({
    condition: { event: 'unlocks_door', quantity: 'one', alternatives: [{ controller: 'you', source: 'self', subject: { ...EMPTY_SUBJECT } }] },
    effect: roomEtb[2],
  }, {} as any);

  return parseRound66TriggerSentence(text, reparse);
}
