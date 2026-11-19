/** Round 65 leftover promotions. */
import { type Parsed65 as Parsed, withFields65 as withFields, stampSubject65 as stampSubject, combineDual65 as combineDual, splitOrList65 as splitOrList, norm65 as norm, emptySubject65 as EMPTY_SUBJECT, parseDelayed65, compose65 } from './parseRound65Helpers.js';
import { parseRound66TriggerSentence } from './parseRound66Events.js';

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
    const fields: Record<string, unknown> = { quantity: 'one_or_more', attackedPlayer: 'player' };
    const base = reparse('whenever a creature you control attacks a player, ' + typeAttackPlayer[4]);
    const stamped = typeAttackPlayer[2]
      ? stampSubject(base, { excludedWords: [typeAttackPlayer[3]] })
      : stampSubject(base, {
          typeGroups: [['creature']],
          subtypeGroups: [[typeAttackPlayer[3]]],
          groups: [{ types: ['creature'], subtypes: [typeAttackPlayer[3]] }],
        });
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
