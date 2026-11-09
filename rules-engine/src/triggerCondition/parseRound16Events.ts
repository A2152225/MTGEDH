/**
 * Round 16 trigger wordings: "a source deals damage to this creature", "blocks or becomes blocked",
 * and the long tail of wordings whose runtime lives only in the legacy
 * handlers (marked legacyRuntimeOnly so the IR never double-fires).
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseRound16TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

function stampChosenType(base: Parsed | null): Parsed | null {
  if (!base) return null;
  const alts = (base.condition.alternatives || []).map((a) => ({ ...a, subject: { ...a.subject, chosenType: true } }));
  return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
}

const SELF = '(?:~|this creature|this permanent)';
const CAST = '(?:you cast|a player casts|an opponent casts)';

const LEGACY_ONLY: readonly RegExp[] = [
  /^whenever you roll a \d+,\s*(.+)$/,
  /^when it connives this way,\s*(.+)$/,
  // promoted to IR: whenever you put +N/+N counters on ...
  /^whenever one or more (?:nonland )?cards are milled,\s*(.+)$/,
  // promoted: when you spend this mana to cast ...
  // promoted R52: no creatures on the battlefield
  /^whenever this creature (?:crews a vehicle|saddles a mount or crews a vehicle[^,]*),\s*(.+)$/,
  // promoted R51: enchanted ... put into a graveyard
  /^whenever another creature you control enters while [^,]+,\s*(.+)$/,
  // promoted R52: whenever an opponent activates an ability of ...
];

export function parseRound16TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  const thatManaSpentInstant = /^when that mana is spent to cast an? ((?:red |white |blue |black |green )?)(instant or sorcery spell|creature spell(?: that shares a creature type with your commander)?),\s*(.+)$/.exec(text);
  if (thatManaSpentInstant) {
    const kind = thatManaSpentInstant[2].startsWith('instant') ? 'an instant or sorcery spell' : 'a creature spell';
    const base = withFields(reparse('whenever you cast ' + kind + ', ' + thatManaSpentInstant[3]), { requiresSourceMana: true } as any);
    if (!base) return null;
    const color = (thatManaSpentInstant[1] || '').trim();
    if (!color) return base;
    const letter = ({ red: 'r', white: 'w', blue: 'u', black: 'b', green: 'g' } as Record<string, string>)[color];
    if (!letter) return base;
    const alts = (base.condition.alternatives || []).map((a) => ({ ...a, subject: { ...a.subject, colors: [letter] } }));
    return { ...base, condition: { ...base.condition, alternatives: alts } as any };
  }
  const chosenNameOrActivate = /^whenever an opponent casts a spell with the chosen name or activates an ability of a source with the chosen name,\s*(.+)$/.exec(text);
  if (chosenNameOrActivate) {
    return withFields(reparse('whenever an opponent casts a spell, ' + chosenNameOrActivate[1]), { chosenName: true, pairedEvent: 'performs', action: 'activate_ability' } as any);
  }
  const castMvExact = /^whenever an opponent casts a spell with mana value (\d+),\s*(.+)$/.exec(text);
  if (castMvExact) {
    return withFields(reparse('whenever an opponent casts a spell, ' + castMvExact[2]), { spellManaValue: Number(castMvExact[1]) } as any);
  }
  const castMvChosen = /^whenever an opponent casts a spell with mana value of the chosen quality,\s*(.+)$/.exec(text);
  if (castMvChosen) {
    return withFields(reparse('whenever an opponent casts a spell, ' + castMvChosen[1]), { chosenManaValue: true } as any);
  }
  const namedTokenAttacks = /^whenever ([a-z][a-z0-9' -]{1,40}?) attacks,\s*(.+)$/.exec(text);
  if (namedTokenAttacks && !/^(this|another|an|a|each|one|you|enchanted|equipped|your|the|that|its)\b/.test(namedTokenAttacks[1]) && !/\s/.test(namedTokenAttacks[1].trim())) {
    return withFields(reparse('whenever a creature attacks, ' + namedTokenAttacks[2]), { requireAttackerName: namedTokenAttacks[1] } as any);
  }
  const chaliceMv = /^(?:whenever|when) a player casts a spell with mana value equal to the number of charge counters on (?:this artifact|this permanent|~),\s*(.+)$/.exec(text);
  if (chaliceMv) {
    return withFields(reparse('whenever a player casts a spell, ' + chaliceMv[1]), { manaValueEqualsChargeCounters: true } as any);
  }
  const ichneumonR = /^(?:whenever|when) an opponent casts an? (instant|sorcery) spell other than the first \1 spell that player casts each turn,\s*(.+)$/.exec(text);
  if (ichneumonR) {
    return withFields(reparse('whenever an opponent casts an ' + ichneumonR[1] + ' spell, ' + ichneumonR[2]), { excludeFirstSpellEachTurn: true } as any);
  }
  const golemR = /^(?:whenever|when) a player casts an? instant or sorcery spell that targets only a single ([a-z]+),\s*(.+)$/.exec(text);
  if (golemR) {
    return withFields(reparse('whenever a player casts an instant or sorcery spell, ' + golemR[2]), { targets: 'creature', targetsOnlySubtype: golemR[1] } as any);
  }
  const playExiledR = /^(?:whenever|when) (you|a player|an opponent) plays? a card exiled with (~|this creature|this permanent|this artifact),\s*(.+)$/.exec(text);
  if (playExiledR) {
    const who = playExiledR[1] === 'you' ? 'you' : playExiledR[1] === 'an opponent' ? 'an opponent' : 'a player';
    return withFields(reparse('whenever ' + who + ' casts a spell, ' + playExiledR[3]), { exiledWithSource: true, castFromZone: 'exile' } as any);
  }
  const jumblebonesLeaves = /^when jumblebones leaves the battlefield,\s*(.+)$/.exec(text);
  if (jumblebonesLeaves) {
    return withFields(reparse('when this creature leaves the battlefield, ' + jumblebonesLeaves[1]), { grantedTokenName: 'Jumblebones' } as any);
  }
  const firstNoncreatureSpell = /^(?:whenever|when) the first noncreature spell of a turn is cast,\s*(.+)$/.exec(text);
  if (firstNoncreatureSpell) {
    return withFields(reparse('whenever a player casts a noncreature spell, ' + firstNoncreatureSpell[1]), { spellOrdinal: 1 } as any);
  }
  const castNotHand = /^(?:whenever|when) (?:another player|an opponent) casts? a spell from anywhere other than (?:their|his or her) hand,\s*(.+)$/.exec(text);
  if (castNotHand) {
    const who = text.includes('another player') ? 'a player' : 'an opponent';
    return withFields(reparse('whenever ' + who + ' casts a spell, ' + castNotHand[1]), { castFromZone: 'not_hand' } as any);
  }
  const sameNameGy = /^(?:whenever|when) (you|an opponent) casts? (?:an? )?(instant or sorcery spell|creature or planeswalker spell) (?:that has|with) the same name as a card in (?:your|their) graveyard,\s*(.+)$/.exec(text);
  if (sameNameGy) {
    const who = sameNameGy[1] === 'you' ? 'you cast' : 'an opponent casts';
    const kind = sameNameGy[2].includes('instant') ? 'an instant or sorcery spell' : 'a creature spell';
    const base = reparse('whenever ' + who + ' ' + kind + ', ' + sameNameGy[3]);
    if (!base) return null;
    return withFields(base, { sameNameAsGraveyard: true } as any);
  }
  const multiSubtypeCombat = /^(?:whenever|when)\s+one or more ([a-z]+(?:, [a-z]+)*,? and\/?or [a-z]+) you control deals? combat damage to a player,\s*(.+)$/.exec(text);
  if (multiSubtypeCombat) {
    const parts = multiSubtypeCombat[1].split(/,? and\/?or |, /).map((p) => { const w = p.trim().toLowerCase(); const irreg: Record<string,string> = { mice: 'mouse', werewolves: 'werewolf', wolves: 'wolf', calves: 'calf', elves: 'elf', dwarves: 'dwarf', vampires: 'vampire' }; return irreg[w] || w.replace(/s$/, ''); }).filter(Boolean);
    const base = reparse('whenever one or more creatures you control deal combat damage to a player, ' + multiSubtypeCombat[2]);
    if (!base || parts.length < 2) return null;
    const alt = base.condition.alternatives[0];
    const subject = { ...alt.subject, subtypeGroups: parts.map((p) => [p] as string[]), groups: parts.map((p) => ({ types: ['creature'], subtypes: [p] })) };
    return { ...base, condition: { ...base.condition, alternatives: [{ ...alt, subject }] } };
  }
  const multiSubtypeEnter = /^(?:whenever|when)\s+one or more (other )?([a-z]+(?:, [a-z]+)*,? and\/?or [a-z]+) you control enters?(?: the battlefield)?,\s*(.+)$/.exec(text);
  if (multiSubtypeEnter) {
    const parts = multiSubtypeEnter[2].split(/,? and\/?or |, /).map((p) => { const w = p.trim().toLowerCase(); const irreg: Record<string,string> = { mice: 'mouse', werewolves: 'werewolf', wolves: 'wolf', calves: 'calf', elves: 'elf', dwarves: 'dwarf', vampires: 'vampire' }; return irreg[w] || w.replace(/s$/, ''); }).filter(Boolean);
    const base = reparse('whenever one or more ' + (multiSubtypeEnter[1] ? 'other ' : '') + 'creatures you control enter, ' + multiSubtypeEnter[3]);
    if (!base || parts.length < 2) return null;
    const alt = base.condition.alternatives[0];
    const subject = { ...alt.subject, subtypeGroups: parts.map((p) => [p] as string[]), groups: parts.map((p) => ({ types: ['creature'], subtypes: [p] })) };
    return { ...base, condition: { ...base.condition, alternatives: [{ ...alt, source: multiSubtypeEnter[1] ? 'another' as const : alt.source, subject }] } };
  }
  const damaged = new RegExp('^whenever a source deals damage to ' + SELF + ',\\s*(.+)$').exec(text);
  if (damaged) return reparse('whenever this creature is dealt damage, ' + damaged[1]);

  const enchantedLandGy = /^when enchanted (artifact|creature|permanent|land|plains|island|swamp|mountain|forest) is put into a graveyard,\s*(.+)$/i.exec(text);
  if (enchantedLandGy) {
    const kind = enchantedLandGy[1].toLowerCase();
    const subject = ['plains','island','swamp','mountain','forest'].includes(kind) ? 'enchanted ' + kind : 'enchanted ' + kind;
    return reparse('when ' + subject + ' dies, ' + enchantedLandGy[2]);
  }
  const yourCommanderCombat = /^whenever your commander deals combat damage to (?:a player|an opponent),\s*(.+)$/.exec(text);
  if (yourCommanderCombat) return reparse('whenever a commander you control deals combat damage to a player, ' + yourCommanderCombat[1]);
  const opponentsCombatDuringTurn = /^when one or more of your opponents (?:are|is) dealt combat damage during your turn,\s*(.+)$/.exec(text);
  if (opponentsCombatDuringTurn) {
    const base = reparse('whenever you are dealt combat damage, ' + opponentsCombatDuringTurn[1]);
    if (!base) return null;
    return {
      ...base,
      condition: {
        ...base.condition,
        whoseTurn: 'you' as const,
        quantity: 'one_or_more' as const,
        alternatives: base.condition.alternatives.map((a) => ({ ...a, controller: 'not_you' as const })),
      },
    };
  }
  const commanderToCz = /^whenever your commander is put into the command zone from anywhere,\s*(.+)$/.exec(text);
  if (commanderToCz) {
    // Command-zone moves are a special LTB variant; leave as leaves_battlefield with legacyRuntimeOnly until CZ emit exists.
    return withFields(reparse('whenever a commander you control leaves the battlefield, ' + commanderToCz[1]), { legacyRuntimeOnly: true } as any);
  }
  // hand-from-GY: special_runtime (no IR emitter for put-into-hand)
  const emergeSac = /^when you sacrifice (?:this creature|~) while casting a spell with emerge,\s*(.+)$/.exec(text);
  if (emergeSac) {
    return withFields(reparse('whenever you sacrifice a creature, ' + emergeSac[1]), { whileCastingEmerge: true } as any);
  }
  const craftExile = /^when (?:this creature|~) is exiled from the battlefield while you'?re activating a craft ability,\s*(.+)$/.exec(text);
  if (craftExile) {
    return withFields(reparse('when this creature is exiled from the battlefield, ' + craftExile[1]), { whileActivatingCraft: true } as any);
  }
  const spendManaCommander = /^when you spend (?:this )?mana (?:from a commander )?to cast (?:your commander|a commander spell|your commander spell),\s*(.+)$/.exec(text);
  if (spendManaCommander) {
    return withFields(reparse('whenever you cast a legendary spell, ' + spendManaCommander[1]), { requiresSourceMana: true, isCommander: true } as any);
  }
  const spendManaFromCommander = /^whenever you spend mana from a commander to cast a spell,\s*(.+)$/.exec(text);
  if (spendManaFromCommander) {
    return withFields(reparse('whenever you cast a spell, ' + spendManaFromCommander[1]), { requiresSourceMana: true, fromCommander: true } as any);
  }
  const spendMana = /^when you spend this mana to (cast (.+?)|cast a spell or activate an ability),\s*(.+)$/.exec(text);
  if (spendMana) {
    const castTarget = spendMana[2] ? spendMana[2] : 'a spell';
    const spendCastTarget = /^(?:your )?commander(?: spell)?$/.test(castTarget) ? 'a legendary spell' : castTarget;
    const effect = spendMana[3];
    const via = spendMana[1].startsWith('cast a spell or activate')
      ? withFields(reparse('whenever you cast a spell, ' + effect), { pairedEvent: 'performs', action: 'activate_ability', causedByYou: true, requiresSourceMana: true } as any)
      : withFields(reparse('whenever you cast ' + spendCastTarget + ', ' + effect), { causedByYou: true, requiresSourceMana: true, ...(/commander/.test(castTarget) ? { isCommander: true } : {}) } as any);
    if (via) return via;
  }
  const youPutCounters = /^(?:whenever|when) you put (a \+1\/\+1 counter|one or more \+1\/\+1 counters|a -[0-9]+\/-[0-9]+ counter|one or more -[0-9]+\/-[0-9]+ counters|a loyalty counter|one or more loyalty counters|a time counter|one or more time counters|a lore counter|one or more lore counters|a counter|one or more counters) on (.+?),\s*(.+)$/.exec(text);
  if (youPutCounters) {
    const placedCounter = youPutCounters[1].includes('+1/+1') ? '+1/+1' : /loyalty/.test(youPutCounters[1]) ? 'loyalty' : /time/.test(youPutCounters[1]) ? 'time' : /lore/.test(youPutCounters[1]) ? 'lore' : /-[0-9]+\/-[0-9]+/.test(youPutCounters[1]) ? '-1/-1' : 'any';
    const oneOrMore = youPutCounters[1].startsWith('one or more');
    const via = placedCounter === 'any'
      ? reparse((oneOrMore ? 'whenever one or more counters are put on ' : 'whenever a counter is put on ') + youPutCounters[2] + ', ' + youPutCounters[3])
      : reparse((oneOrMore ? 'whenever one or more ' + placedCounter + ' counters are put on ' : 'whenever a ' + placedCounter + ' counter is put on ') + youPutCounters[2] + ', ' + youPutCounters[3]);
    if (via) return withFields(via, { causedByYou: true });
  }
  const blocksOrBlocked = /^whenever (enchanted creature|equipped creature|this creature|~) blocks or becomes blocked,\s*(.+)$/.exec(text);
  if (blocksOrBlocked) {
    return withFields(reparse('whenever ' + blocksOrBlocked[1] + ' blocks, ' + blocksOrBlocked[2]), { pairedEvent: 'becomes_blocked' });
  }

  const diesInCombat = /^when [^,]+ dies during combat,\s*(.+)$/.exec(text);
  // "a spell that's white, blue, or red" / "a white, blue, or red spell": any of the listed colors.
  const C = '(?:white|blue|black|red|green)';
  const colorList = new RegExp('^whenever you cast an? (?:spell that\'s (' + C + '(?:, ' + C + ')*,? (?:or|and/or) ' + C + '|' + C + ')|(' + C + '(?:, ' + C + ')*,? or ' + C + ') spell),\\s*(.+)$').exec(text);
  if (colorList) {
    const base: any = reparse('whenever you cast a spell, ' + colorList[3]);
    const letters: Record<string, string> = { white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g' };
    const colors = String(colorList[1] || colorList[2]).match(/white|blue|black|red|green/g)!.map((c) => letters[c]);
    const subject = base?.condition?.alternatives?.[0]?.subject;
    if (subject) return { ...base, condition: { ...base.condition, alternatives: [{ ...base.condition.alternatives[0], subject: { ...subject, anyObject: true, colors } }] } } as any;
  }
  if (diesInCombat) return withFields(reparse('when this creature dies, ' + diesInCombat[1]), { duringCombat: true });

  const attackBatch = parseAttackBatch(text, reparse);
  if (attackBatch) return attackBatch;

  // Two-color spells: "a blue or black spell".
  const twoColor = new RegExp('^whenever ' + CAST + ' an? (white|blue|black|red|green) or (white|blue|black|red|green) spell,\\s*(.+)$').exec(text);
  if (twoColor) {
    const letters: Record<string, string> = { white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g' };
    const caster = /^(whenever (?:you cast|a player casts|an opponent casts))/i.exec(text)?.[1] || 'whenever a player casts';
    const rebuilt: any = reparse(caster + ' a spell, ' + twoColor[3]);
    const subject = rebuilt?.condition?.alternatives?.[0]?.subject;
    if (subject) {
      return {
        ...rebuilt,
        condition: {
          ...rebuilt.condition,
          alternatives: [{ ...rebuilt.condition.alternatives[0], subject: { ...subject, anyObject: true, colors: [letters[twoColor[1]], letters[twoColor[2]]] } }],
        },
      } as any;
    }
  }

  const loyalty = /^whenever you activate a loyalty ability(?: of [^,]+)?,\s*(.+)$/.exec(text);
  if (loyalty) {
    const rebuilt: any = reparse("whenever you activate an ability that isn't a mana ability, " + loyalty[1]);
    if (rebuilt) return { ...rebuilt, condition: { ...rebuilt.condition, action: 'activate_loyalty' } } as any;
  }

  const sharae = /^whenever you tap (?:one or more )?untapped creatures? (?:an opponent controls|your opponents control),\s*(.+)$/.exec(text);
  if (sharae) {
    return withFields(reparse('whenever a creature an opponent controls becomes tapped, ' + sharae[1]), { causedByYou: true, requiresUntapped: true } as any);
  }
  const auraTarget = /^whenever (this creature|this permanent|~) becomes the target of an? aura spell,\s*(.+)$/.exec(text);
  if (auraTarget) return withFields(reparse('whenever ' + auraTarget[1] + ' becomes the target of a spell, ' + auraTarget[2]), { targetsSpellType: 'aura' } as any);
  const postcombat = /^at the beginning of each postcombat main phase,\s*(.+)$/.exec(text);
  if (postcombat) return withFields(reparse('at the beginning of your postcombat main phase, ' + postcombat[1]), { whoseTurn: 'any' } as any);
  const oppNoncombat = /^whenever (?:one or more )?opponents? (?:are|is) dealt (noncombat )?damage,\s*(.+)$/.exec(text);
  if (oppNoncombat) {
    return withFields(reparse('whenever a player is dealt damage, ' + oppNoncombat[2]), {
      damageKind: oppNoncombat[1] ? 'noncombat' : undefined,
      playerSubject: true,
      damageRecipient: 'opponent',
      quantity: 'one_or_more',
    } as any);
  }
  const plague = /^(?:whenever|when) (this artifact|this permanent|~) has (\d+|three|four|five) or more ([a-z]+) counters on it,\s*(.+)$/.exec(text);
  if (plague) {
    const WORD_N: Record<string, number> = { three: 3, four: 4, five: 5 };
    const n = WORD_N[plague[2]] ?? Number(plague[2]);
    return withFields(reparse('when ' + plague[1] + ' has no counters on it, ' + plague[4]), { counterMinimum: n, placedCounter: plague[3] } as any);
  }
  // R59_PROMOTE: largest Round-16 legacy stubs to real IR.
  const equippedAttacks = /^whenever an equipped creature you control attacks,\s*(.+)$/.exec(text);
  if (equippedAttacks) return withFields(reparse('whenever a creature you control attacks, ' + equippedAttacks[1]), { requireEquippedAttacker: true } as any);
  const attacksFirst = /^whenever (this creature|this permanent|~|equipped creature|enchanted creature) attacks for the first time each turn,\s*(.+)$/.exec(text);
  if (attacksFirst) return withFields(reparse('whenever ' + attacksFirst[1] + ' attacks, ' + attacksFirst[2]), { onceEachTurn: true } as any);
  const blocksWith = /^whenever (this creature|this permanent|~) blocks a creature with ([a-z][a-z -]+),\s*(.+)$/.exec(text);
  if (blocksWith) {
    const trait = blocksWith[2].trim();
    const base = reparse('whenever ' + blocksWith[1] + ' blocks a creature, ' + blocksWith[3]);
    if (!base) return null;
    const isKeyword = /^(flying|reach|trample|vigilance|haste|deathtouch|lifelink|menace|hexproof|indestructible|defender)$/.test(trait);
    return withFields(base, {
      blockPartner: {
        anyObject: false,
        typeGroups: [['creature']],
        subtypeGroups: [[]],
        groups: [{ types: ['creature'], subtypes: [] }],
        excludedWords: [],
        supertypes: [],
        keywordsWith: isKeyword ? [trait] : [],
        keywordsWithout: [],
        token: 'any' as const,
      },
    } as any);
  }
  const loseLifeFirst = /^whenever you lose life for the first time each turn,\s*(.+)$/.exec(text);
  if (loseLifeFirst) return withFields(reparse('whenever you lose life, ' + loseLifeFirst[1]), { onceEachTurn: true } as any);
  const equippedActivate = /^whenever an ability of equipped creature is activated,\s*(.+)$/.exec(text);
  if (equippedActivate) return withFields(reparse("whenever you activate an ability that isn't a mana ability, " + equippedActivate[1]), { action: 'activate_equipped' } as any);
  const multiDie = /^whenever one or more (other |nontoken )*(creatures(?: you control)?) die,\s*(.+)$/.exec(text);
  if (multiDie) {
    const subj = ((multiDie[1] || '') + multiDie[2]).trim();
    const singular = subj.replace(/^other /, 'another ').replace(/creatures/, 'creature').replace(/nontoken creature/, 'nontoken creature');
    return withFields(reparse('whenever ' + singular + ' dies, ' + multiDie[3]), { quantity: 'one_or_more' } as any);
  }
  const dealtDmgDies = /^whenever a creature dealt damage by (this creature|this permanent|~) this turn dies,\s*(.+)$/.exec(text);
  if (dealtDmgDies) return withFields(reparse('whenever a creature dies, ' + dealtDmgDies[2]), { dealtDamageBySource: true } as any);
  const dontOwn2 = /^whenever you cast a spell you don't own,\s*(.+)$/.exec(text);
  if (dontOwn2) return withFields(reparse('whenever you cast a spell, ' + dontOwn2[1]), { spellNotOwned: true } as any);
  const xCost = /^whenever you cast (?:a|an|your first) spell with \{x\} in its mana cost(?: each turn)?,\s*(.+)$/.exec(text);
  if (xCost) return withFields(reparse('whenever you cast a spell, ' + xCost[1]), { hasXInCost: true, ...( /your first/.test(text) || /each turn/.test(text) ? { onceEachTurn: true, ordinal: 'first' as const } : {}) } as any);
  const chosenTypeSpell = /^whenever you cast (?:a|an|your first) spell of the chosen type,\s*(.+)$/.exec(text);
  if (chosenTypeSpell) return stampChosenType(withFields(reparse('whenever you cast a spell, ' + chosenTypeSpell[1]), {} as any));
  const playExile = /^whenever you play a (?:land|card) from exile(?: or cast a spell from exile)?,\s*(.+)$/.exec(text);
  if (playExile) return withFields(reparse('whenever you play a land, ' + playExile[1]), { pairedEvent: 'spell_cast', castFromZone: 'exile' } as any);
  const drawOrd = /^when you draw your (second|third|fourth|fifth) card in a turn,\s*(.+)$/.exec(text);
  if (drawOrd) return withFields(reparse('whenever you draw a card, ' + drawOrd[2]), { ordinal: drawOrd[1], onceEachTurn: true } as any);
  const chosenTypeEnters = /^whenever a permanent you control of the chosen type enters,\s*(.+)$/.exec(text);
  if (chosenTypeEnters) return stampChosenType(withFields(reparse('whenever a permanent you control enters, ' + chosenTypeEnters[1]), {} as any));
  const tokenGy = /^when this token is put into a graveyard,\s*(.+)$/.exec(text);
  if (tokenGy) return withFields(reparse('when this creature dies, ' + tokenGy[1]), { requireToken: true } as any);
  const attackThisTurn = /^whenever you attack this turn,\s*(.+)$/.exec(text);
  if (attackThisTurn) return withFields(reparse('whenever you attack, ' + attackThisTurn[1]), { thisTurn: true } as any);
  const discardThis = /^when you discard this card,\s*(.+)$/.exec(text);
  if (discardThis) return withFields(reparse('whenever you discard a card, ' + discardThis[1]), { sourceIsDiscarded: true } as any);
  const castOrCycle = /^when you cast or cycle (?:~|this (?:permanent|card|creature|spell)),\s*(.+)$/.exec(text);
  if (castOrCycle) return withFields(reparse('when you cast this spell, ' + castOrCycle[1]), { pairedEvent: 'cycles' } as any);
  const sourceDmgYou = /^whenever a source (you control|an opponent controls) deals damage to you,\s*(.+)$/.exec(text);
  if (sourceDmgYou) return withFields(reparse('whenever a source deals damage to you, ' + sourceDmgYou[2]), { ...(sourceDmgYou[1] === 'you control' ? { causedByYou: true } : { causedByOpponent: true }) } as any);
  const attacksPlayer = /^whenever (this creature|this permanent|~|a creature|a creature you control) attacks a player,\s*(.+)$/.exec(text);
  if (attacksPlayer) return withFields(reparse('whenever ' + attacksPlayer[1] + ' attacks, ' + attacksPlayer[2]), { attackedPlayer: 'any' as const } as any);

  for (const re of LEGACY_ONLY) {
    const hit = re.exec(text);
    if (hit) return withFields(reparse('when this creature enters, ' + hit[1]), { legacyRuntimeOnly: true });
  }
  return null;
}

/** Player-level attack wordings as one-per-declaration IR attack conditions (quantity one_or_more). */
function parseAttackBatch(text: string, reparse: Reparse): Parsed | null {
  const once = (base: Parsed | null): Parsed | null => withFields(base, { quantity: 'one_or_more' });
  const youAttacked = /^whenever (?:a player|an opponent) attacks you(?: with one or more creatures)?,\s*(.+)$/.exec(text);
  if (youAttacked) return once(reparse('whenever a creature attacks you, ' + youAttacked[1]));
  const oppAttacks = /^whenever an opponent attacks with (?:one or more )?creatures,\s*(.+)$/.exec(text);
  if (oppAttacks) return once(reparse('whenever a creature an opponent controls attacks, ' + oppAttacks[1]));
  const anyAttacks = /^whenever a player attacks,\s*(.+)$/.exec(text);
  if (anyAttacks) return once(reparse('whenever a creature attacks, ' + anyAttacks[1]));
  const youWithCommander = /^whenever you attack with your commander,\s*(.+)$/.exec(text);
  if (youWithCommander) return reparse('whenever one or more commanders you control attack, ' + youWithCommander[1]);
  const youWith = /^whenever you attack with (?:one or more )?([^,]+?),\s*(.+)$/.exec(text);
  if (youWith) {
    const subject = youWith[1].replace(/\band\/or\b/g, 'or');
    const withPhrase = /^(.+?) (with .+)$/.exec(subject);
    const hasRelation = /\b(?:you control|an opponent controls|you own|an opponent owns)\b/.test(subject);
    const phrase = hasRelation
      ? subject
      : withPhrase ? withPhrase[1] + ' you control ' + withPhrase[2] : subject + ' you control';
    return reparse('whenever one or more ' + phrase + ' attack, ' + youWith[2]);
  }
  return null;
}
