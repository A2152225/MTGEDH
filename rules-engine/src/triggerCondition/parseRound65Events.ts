/** Round 65 leftover promotions (first half; the rest is in parseRound65LateEvents.ts). */
import { type Parsed65 as Parsed, withFields65 as withFields, stampSubject65 as stampSubject, combineDual65 as combineDual, splitOrList65 as splitOrList, norm65 as norm, parseDelayed65, compose65 } from './parseRound65Helpers.js';
import { parseRound65LateTriggerSentence } from './parseRound65LateEvents.js';

type Reparse=(s:string)=>Parsed|null;

export function parseRound65TriggerSentence(text: string, incoming: Reparse): Parsed | null {
  const reparse: Reparse = (sentence) => {
    if (norm(sentence) === norm(text)) return null;
    return incoming(sentence);
  };
  const delayed = parseDelayed65(text, reparse);
  if (delayed) return delayed;

  const fightsYou = /^(whenever|when) a creature you control fights,s*(.+)$/.exec(text);
  if (fightsYou) return compose65('fights', fightsYou[2], { quantity: 'one' }, { typeGroups: [['creature']] });

  const pteLte = /^(whenever|when) a creature you control with power or toughness (\d+) or less dies,\s*(.+)$/.exec(text);
  if (pteLte) {
    return withFields(reparse('whenever a creature you control dies, ' + pteLte[3]), { powerOrToughnessLte: Number(pteLte[2]) } as any);
  }
  const anotherDuring = /^(whenever|when) (another creature|another creature you control) dies during your turn,\s*(.+)$/.exec(text);
  if (anotherDuring) {
    const who = anotherDuring[2].includes('you control') ? 'another creature you control' : 'another creature';
    return withFields(reparse('whenever ' + who + ' dies, ' + anotherDuring[3]), { whoseTurn: 'you' } as any);
  }
  const typeDuring = /^(whenever|when) (an? [a-z]+ you control) dies during your turn,\s*(.+)$/.exec(text);
  if (typeDuring) {
    return withFields(reparse('whenever ' + typeDuring[2] + ' dies, ' + typeDuring[3]), { whoseTurn: 'you' } as any);
  }
  const legendOther = /^(whenever|when) a legendary permanent other than (this creature|this permanent|~|[a-z][a-z0-9' ,.-]{0,40}?) is put into a graveyard from the battlefield,\s*(.+)$/.exec(text);
  if (legendOther) {
    return stampSubject(
      withFields(reparse('whenever a permanent is put into a graveyard from the battlefield, ' + legendOther[3]), { excludeSource: true } as any),
      { supertypes: ['legendary'] },
    );
  }
  const otherPermBf = /^(whenever|when) a permanent other than (this enchantment|this creature|this permanent|~) is put into a graveyard from the battlefield,\s*(.+)$/.exec(text);
  if (otherPermBf) return withFields(reparse('whenever a permanent is put into a graveyard from the battlefield, ' + otherPermBf[3]), { excludeSource: true } as any);
  const ownedOther = /^(whenever|when) a permanent owned by another player is put into a graveyard from the battlefield,\s*(.+)$/.exec(text);
  if (ownedOther) return withFields(reparse('whenever a permanent is put into a graveyard from the battlefield, ' + ownedOther[2]), { ownerNotYou: true } as any);
  const fromNotBf = /^(whenever|when) (an? [a-z]+ permanent card) is put into your graveyard from anywhere other than the battlefield,\s*(.+)$/.exec(text);
  if (fromNotBf) return withFields(reparse('whenever ' + fromNotBf[2] + ' is put into your graveyard from anywhere, ' + fromNotBf[3]), { fromZone: 'not_battlefield' } as any);
  const diesInGy = /^(whenever|when) (a creature you control|an? [a-z]+ you control) dies while this card is in your graveyard,\s*(.+)$/.exec(text);
  if (diesInGy) return withFields(reparse('whenever ' + diesInGy[2] + ' dies, ' + diesInGy[3]), { sourceInGraveyard: true } as any);
  const greatest = /^(whenever|when) a creature an opponent controls with the greatest power among creatures that player controls dies,\s*(.+)$/.exec(text);
  if (greatest) return withFields(reparse('whenever a creature an opponent controls dies, ' + greatest[2]), { greatestPowerAmongItsController: true } as any);
  const blockingThis = /^(whenever|when) a creature blocking this creature dies,\s*(.+)$/.exec(text);
  if (blockingThis) return withFields(reparse('whenever a creature dies, ' + blockingThis[2]), { blockingSource: true } as any);
  const dmgByEnchanted = /^(whenever|when) a creature dealt damage by enchanted creature this turn dies,\s*(.+)$/.exec(text);
  if (dmgByEnchanted) return withFields(reparse('whenever a creature dies, ' + dmgByEnchanted[2]), { dealtDamageByEnchantedThisTurn: true, thisTurn: true } as any);
  const dmgByType = /^(whenever|when) another creature dealt damage this turn by an? ([a-z]+) you controlled dies,\s*(.+)$/.exec(text);
  if (dmgByType) return withFields(reparse('whenever another creature dies, ' + dmgByType[3]), { dealtDamageByYourSubtypeThisTurn: dmgByType[2], thisTurn: true } as any);
  const gyAnywhereWhile = /^(whenever|when) one or more permanent cards are put into your graveyard from anywhere while this creature has a ([^ ,]+) counter on it,\s*(.+)$/.exec(text);
  if (gyAnywhereWhile) return withFields(reparse('whenever a permanent card is put into your graveyard from anywhere, ' + gyAnywhereWhile[3]), { sourceHasCounter: gyAnywhereWhile[2].replace(/-1\/-1/, '-1/-1'), quantity: 'one_or_more' } as any);
  const orTypeDies = /^(whenever|when) another ([a-z]+(?:, [a-z]+)*),? or ([a-z]+) you control dies,\s*(.+)$/.exec(text);
  if (orTypeDies) {
    const types = splitOrList(orTypeDies[2] + ', ' + orTypeDies[3]);
    let acc: Parsed | null = null;
    for (const typ of types) {
      const part = reparse('whenever another ' + typ + ' you control dies, ' + orTypeDies[4]);
      acc = acc ? withFields(acc, { alternatives: [...(acc.condition.alternatives || []), ...(part?.condition.alternatives || [])] }) : part;
    }
    return acc;
  }
  const attacksOrDies = /^(whenever|when) an equipped creature you control other than (this creature|this permanent|~|[a-z][a-z0-9' ,.-]{0,40}?) attacks or dies,\s*(.+)$/.exec(text);
  if (attacksOrDies) {
    return combineDual(
      stampSubject(withFields(reparse('whenever a creature you control attacks, ' + attacksOrDies[3]), { excludeSource: true } as any), { equipped: true }),
      stampSubject(withFields(reparse('whenever a creature you control dies, ' + attacksOrDies[3]), { excludeSource: true } as any), { equipped: true }),
    );
  }
  const etbOrDies = /^(whenever|when) (this creature|this permanent|~|[a-z][a-z0-9' ,.-]{0,40}?) enters or another (nontoken )?(creature|human|angel) you control dies,\s*(.+)$/.exec(text);
  if (etbOrDies) {
    const typ = etbOrDies[4] === 'creature' ? 'creature' : etbOrDies[4];
    const nontoken = etbOrDies[3] ? 'nontoken ' : '';
    return combineDual(
      reparse('whenever ' + etbOrDies[2] + ' enters, ' + etbOrDies[5]),
      stampSubject(reparse('whenever another ' + typ + ' you control dies, ' + etbOrDies[5]), etbOrDies[3] ? { token: 'nontoken' } : {}),
    ) || withFields(reparse('whenever another ' + nontoken + typ + ' you control dies, ' + etbOrDies[5]), {} as any);
  }
  const orTypeEtb = /^(whenever|when) (another )?(?:a )?([a-z]+(?:, [a-z]+)*),? or ([a-z]+) you control enters,\s*(.+)$/.exec(text);
  if (orTypeEtb) {
    const types = splitOrList(orTypeEtb[3] + ', ' + orTypeEtb[4]);
    const other = orTypeEtb[2] ? 'another ' : '';
    let acc: Parsed | null = null;
    for (const typ of types) {
      const part = reparse('whenever ' + other + typ + ' you control enters, ' + orTypeEtb[5]);
      acc = acc ? withFields(acc, { alternatives: [...(acc.condition.alternatives || []), ...(part?.condition.alternatives || [])] }) : part;
    }
    return acc;
  }
  const teamEtb = /^(whenever|when) another ([a-z]+) your team controls enters,\s*(.+)$/.exec(text);
  if (teamEtb) return reparse('whenever another ' + teamEtb[2] + ' you control enters, ' + teamEtb[3]);
  const base11 = /^(whenever|when) one or more other creatures you control with base power and toughness 1\/1 enter,\s*(.+)$/.exec(text);
  if (base11) return withFields(reparse('whenever another creature you control enters, ' + base11[2]), { quantity: 'one_or_more', basePowerEquals: 1, baseToughnessEquals: 1 } as any);
  const secondLand = /^(whenever|when) a land enters under an opponent's control, if that player had another land enter the battlefield under their control this turn,\s*(.+)$/.exec(text);
  if (secondLand) return withFields(reparse("whenever a land enters under an opponent's control, " + secondLand[2]), { controllerHadAnotherLandEnterThisTurn: true } as any);
  const transformOrEtb = /^(whenever|when) a permanent you control transforms or a permanent you control enters transformed,\s*(.+)$/.exec(text);
  if (transformOrEtb) {
    return combineDual(
      reparse('whenever a permanent you control transforms, ' + transformOrEtb[2]),
      withFields(reparse('whenever a permanent you control enters, ' + transformOrEtb[2]), { entersTransformed: true } as any),
    );
  }
  const etbOrUnlock = /^(whenever|when) (this creature or another enchantment you control) enters and whenever you fully unlock a room,\s*(.+)$/.exec(text);
  if (etbOrUnlock) {
    const combined = combineDual(reparse('whenever ' + etbOrUnlock[2] + ' enters, ' + etbOrUnlock[3]), reparse('whenever you fully unlock a room, ' + etbOrUnlock[3]));
    if (combined) return combined;
  }
  const entersAndPlay = /^(when|whenever) (this creature|this permanent|~|[a-z][a-z0-9' ,.-]{0,40}?) enters and whenever you play a card with two or more card types,\s*(.+)$/.exec(text);
  if (entersAndPlay) {
    return combineDual(
      reparse('whenever ' + entersAndPlay[2] + ' enters, ' + entersAndPlay[3]),
      withFields(reparse('whenever you play a card, ' + entersAndPlay[3]), { minCardTypes: 2 } as any),
    );
  }
  const eqOrTarget = /^(whenever|when) you cast an equipment spell or a spell that targets a creature you control,\s*(.+)$/.exec(text);
  if (eqOrTarget) {
    return combineDual(
      reparse('whenever you cast an equipment spell, ' + eqOrTarget[2]),
      withFields(reparse('whenever you cast a spell, ' + eqOrTarget[2]), { spellTargetsCreatureYouControl: true } as any),
    );
  }
  const faceUp = /^(when|whenever) enchanted creature is turned face up,\s*(.+)$/.exec(text);
  if (faceUp) return withFields(reparse('whenever enchanted creature is turned face up, ' + faceUp[2]), {} as any) || withFields(reparse('when this creature is turned face up, ' + faceUp[2]), { requiresEnchantedSubject: true } as any);
  const auraOrTarget = /^(whenever|when) this aura enters or enchanted creature becomes the target of an aura spell,\s*(.+)$/.exec(text);
  if (auraOrTarget) {
    return combineDual(
      reparse('whenever this aura enters, ' + auraOrTarget[2]),
      withFields(reparse('whenever enchanted creature becomes the target of a spell, ' + auraOrTarget[2]), { spellIsAura: true } as any),
    );
  }
  const enteredAttacks = /^(whenever|when) (?:a |one or more )?(creatures? you control) that entered this turn attacks?(?: a player)?,\s*(.+)$/.exec(text);
  if (enteredAttacks) return withFields(reparse('whenever a creature you control attacks, ' + enteredAttacks[3]), { enteredThisTurn: true, quantity: /one or more/.test(text) ? 'one_or_more' : 'one' } as any);
  const enteredDmg = /^(whenever|when) one or more creatures you control that entered this turn deal combat damage to a player,\s*(.+)$/.exec(text);
  if (enteredDmg) return withFields(reparse('whenever a creature you control deals combat damage to a player, ' + enteredDmg[2]), { enteredThisTurn: true, quantity: 'one_or_more' } as any);
  const attacksOrEntersAtk = /^(whenever|when) a creature you control attacks or enters attacking,\s*(.+)$/.exec(text);
  if (attacksOrEntersAtk) {
    return combineDual(
      reparse('whenever a creature you control attacks, ' + attacksOrEntersAtk[2]),
      withFields(reparse('whenever a creature you control enters, ' + attacksOrEntersAtk[2]), { entersAttacking: true } as any),
    );
  }
  const typeOrEtb = /^(whenever|when) an artifact, creature, or enchantment enters,\s*(.+)$/.exec(text);
  if (typeOrEtb) {
    let acc: Parsed | null = null;
    for (const typ of ['artifact', 'creature', 'enchantment']) {
      const part = reparse('whenever a ' + typ + ' enters, ' + typeOrEtb[2]);
      acc = acc ? withFields(acc, { alternatives: [...(acc.condition.alternatives || []), ...(part?.condition.alternatives || [])] }) : part;
    }
    return acc;
  }
  const etbAndActivate = /^(whenever|when) another creature you control enters and whenever you activate a ([a-z-]+) ability,\s*(.+)$/.exec(text);
  if (etbAndActivate) {
    const combined = combineDual(reparse('whenever another creature you control enters, ' + etbAndActivate[3]), reparse('whenever you activate a ' + etbAndActivate[2] + ' ability, ' + etbAndActivate[3]));
    if (combined) return combined;
  }
  const etbAndLose = /^(when|whenever) this enchantment enters and whenever an opponent loses the game,\s*(.+)$/.exec(text);
  if (etbAndLose) {
    const combined = combineDual(reparse('whenever this enchantment enters, ' + etbAndLose[2]), reparse('whenever an opponent loses the game, ' + etbAndLose[2]));
    if (combined) return combined;
  }
  const selfOrEnchantedDmg = /^(whenever|when) (~|[a-z][a-z0-9' ,.-]{0,40}?|this creature) or an enchanted creature you control deals combat damage to a player,\s*(.+)$/.exec(text);
  if (selfOrEnchantedDmg) {
    return combineDual(
      reparse('whenever this creature deals combat damage to a player, ' + selfOrEnchantedDmg[3]),
      withFields(reparse('whenever a creature you control deals combat damage to a player, ' + selfOrEnchantedDmg[3]), { requiresEnchantedSubject: true } as any),
    );
  }
  const selfOrSpellDmg = /^(whenever|when) (~|[a-z][a-z0-9' ,.-]{0,40}?|this creature) or an instant or sorcery spell you control deals damage to a player,\s*(.+)$/.exec(text);
  if (selfOrSpellDmg) {
    return combineDual(
      reparse('whenever this creature deals damage to a player, ' + selfOrSpellDmg[3]),
      reparse('whenever an instant or sorcery spell you control deals damage to a player, ' + selfOrSpellDmg[3]),
    );
  }
  const kwDmg = /^(whenever|when) a creature (you control )?with (skulk|deathtouch|flying) deals(?: combat)? damage to (one of your opponents|a planeswalker|a player),\s*(.+)$/.exec(text);
  if (kwDmg) {
    const pw = kwDmg[4] === 'a planeswalker';
    const opp = kwDmg[4] === 'one of your opponents';
    const dest = pw ? 'a player' : opp ? 'an opponent' : 'a player';
    const ev = /combat/.test(text) ? 'deals combat damage to ' : 'deals damage to ';
    const who = kwDmg[2] ? 'a creature you control' : 'a creature';
    const base = stampSubject(reparse('whenever ' + who + ' ' + ev + dest + ', ' + kwDmg[5]), { keywordsWith: [kwDmg[3]] });
    const recipient = pw ? { damageRecipient: 'planeswalker' } : opp ? { damageRecipient: 'opponent' } : {};
    if (base) return withFields(base, recipient as any);
  }
  const chosenNameDmg = /^(whenever|when) a creature with the chosen name deals combat damage to a player(?: this turn)?,\s*(.+)$/.exec(text);
  if (chosenNameDmg) {
    const fields: Record<string, unknown> = { requiresChosenName: true };
    if (/this turn/.test(text)) { fields.delayedRider = true; fields.thisTurn = true; }
    return withFields(reparse('whenever a creature deals combat damage to a player, ' + chosenNameDmg[2]), fields as any);
  }
  const faceUpDmg = /^(whenever|when) a creature you control that was turned face up this turn deals combat damage to a player,\s*(.+)$/.exec(text);
  if (faceUpDmg) return withFields(reparse('whenever a creature you control deals combat damage to a player, ' + faceUpDmg[2]), { becameFaceUpThisTurn: true } as any);
  const legEqDmg = /^(whenever|when) a creature you control with a legendary equipment attached to it deals combat damage to a player,\s*(.+)$/.exec(text);
  if (legEqDmg) return withFields(reparse('whenever a creature you control deals combat damage to a player, ' + legEqDmg[2]), { hasLegendaryEquipmentAttached: true } as any);
  const base0Dmg = /^(whenever|when) one or more creatures you control with base power 0 deal combat damage to a player,\s*(.+)$/.exec(text);
  if (base0Dmg) return withFields(reparse('whenever a creature you control deals combat damage to a player, ' + base0Dmg[2]), { quantity: 'one_or_more', basePowerEquals: 0 } as any);
  const moreLands = /^(when|whenever) this creature deals combat damage to a player who controls more lands than you,\s*(.+)$/.exec(text);
  if (moreLands) return withFields(reparse('whenever this creature deals combat damage to a player, ' + moreLands[2]), { moreLandsThanYou: true } as any);
  const dmgToPw = /^(whenever|when) a creature you control deals combat damage to a planeswalker,\s*(.+)$/.exec(text);
  if (dmgToPw) return withFields(reparse('whenever a creature you control deals combat damage to a player, ' + dmgToPw[2]), { damageRecipient: 'player_or_planeswalker' } as any);
  const typeCombat = /^(whenever|when) (?:a |one or more )([a-z]+(?:, [a-z]+)*),? or ([a-z]+) you control deal(?:s)?(?: combat)? damage to (?:a player|one or more of your opponents|one or more players),\s*(.+)$/.exec(text);
  if (typeCombat) {
    const types = splitOrList(typeCombat[2] + ', ' + typeCombat[3]);
    const ev = /combat damage/.test(text) ? 'deals combat damage to a player' : 'deals damage to a player';
    let acc: Parsed | null = null;
    for (const typ of types) {
      const part = reparse('whenever a ' + typ + ' you control ' + ev + ', ' + typeCombat[4]);
      acc = acc ? withFields(acc, { alternatives: [...(acc.condition.alternatives || []), ...(part?.condition.alternatives || [])] }) : part;
    }
    return withFields(acc, { quantity: /one or more/.test(text) ? 'one_or_more' : 'one' } as any);
  }
  const dmgToYouMonarch = /^(whenever|when) one or more creatures deal combat damage to you while you're the monarch,\s*(.+)$/.exec(text);
  if (dmgToYouMonarch) return withFields(reparse('whenever a creature deals combat damage to you, ' + dmgToYouMonarch[2]), { quantity: 'one_or_more', requireYouAreMonarch: true } as any);
  const oneOrMoreOpp = /^(whenever|when) one or more ([a-z]+) you control deal combat damage to one or more of your opponents,\s*(.+)$/.exec(text);
  if (oneOrMoreOpp) return withFields(reparse('whenever a ' + oneOrMoreOpp[2] + ' you control deals combat damage to an opponent, ' + oneOrMoreOpp[3]), { quantity: 'one_or_more' } as any);
  const thisTurnDmg = /^(whenever|when) one or more creatures you control with flying deal combat damage to a player this turn,\s*(.+)$/.exec(text);
  if (thisTurnDmg) {
    const flying = stampSubject(
      withFields(reparse('whenever a creature you control deals combat damage to a player, ' + thisTurnDmg[2]), { delayedRider: true, thisTurn: true, quantity: 'one_or_more' } as any),
      { keywordsWith: ['flying'] },
    );
    if (flying) return flying;
  }
  const spellHitsThis = /^(whenever|when) a spell deals damage to this creature,\s*(.+)$/.exec(text);
  if (spellHitsThis) {
    const hit = withFields(reparse('whenever a spell deals damage to a creature, ' + spellHitsThis[2]), { damageRecipient: 'source' } as any);
    if (hit) return hit;
  }
  const eqBlocking = /^(whenever|when) equipped creature deals damage to a blocking creature,\s*(.+)$/.exec(text);
  if (eqBlocking) return withFields(reparse('whenever equipped creature deals damage to a creature, ' + eqBlocking[2]), { damageRecipient: 'blocking_creature' } as any);
  return parseRound65LateTriggerSentence(text, reparse);
}
