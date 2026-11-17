/**
 * Round 64 / legacy-r7: promote leftover combat-damage, ETB, death, spell-cast,
 * attack, block, special_runtime, and the last abilityActivated lines (boast,
 * clash-and-win, shuffle-its-controller). Parsers hook early (end of r63) so
 * they beat r12/r14/r16/r37 LEGACY_ONLY stubs. Events already in IR_EMITTED
 * reuse existing collectors; leftover regex paths keep firing only when IR
 * does not own the printed line.
 * Origin parent: parseRound63Events.ts parseRound63TriggerSentence.
 * Public: parseRound64TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';
import { parseRound65TriggerSentence } from './parseRound65Events.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

const EMPTY_SUBJECT = {
  anyObject: true,
  typeGroups: [] as readonly (readonly string[])[],
  subtypeGroups: [] as readonly (readonly string[])[],
  groups: [] as readonly { types: readonly string[]; subtypes: readonly string[] }[],
  excludedWords: [] as readonly string[],
  supertypes: [] as readonly string[],
  keywordsWith: [] as readonly string[],
  keywordsWithout: [] as readonly string[],
  token: 'any' as const,
};

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

function stampSubject(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  if (!base) return null;
  const alts = (base.condition.alternatives || []).map((a) => ({
    ...a,
    subject: { ...a.subject, ...fields },
  }));
  return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
}

function combineDual(left: Parsed | null, right: Parsed | null): Parsed | null {
  if (!left || !right) return null;
  if (left.condition.event === right.condition.event) {
    return withFields(left, {
      alternatives: [...(left.condition.alternatives || []), ...(right.condition.alternatives || [])],
    });
  }
  return withFields(left, {
    pairedEvent: right.condition.event,
    pairedCondition: right.condition,
  } as any);
}

function youPerform(action: string, effect: string, fields: Record<string, unknown> = {}): Parsed {
  return {
    condition: {
      event: 'performs',
      action,
      quantity: 'one',
      alternatives: [{ controller: 'you', source: 'any', subject: { ...EMPTY_SUBJECT } }],
      ...fields,
    } as TriggerConditionIR,
    effect,
  };
}

function rewriteChosenTypeController(phrase: string): string {
  return phrase
    .replace(/\byou control of the chosen type\b/g, 'of the chosen type you control')
    .replace(/\ban opponent controls of the chosen type\b/g, 'of the chosen type an opponent controls')
    .replace(/\byour team controls\b/g, 'you control');
}

function basePT(n: string, m?: string): Record<string, number> {
  const power = Number(n);
  const tough = m == null ? power : Number(m);
  return { basePowerEquals: power, ...(Number.isFinite(tough) ? { baseToughnessEquals: tough } : {}) };
}

export function parseRound64TriggerSentence(text: string, incoming: Reparse): Parsed | null {
  const reparse: Reparse = (sentence) => {
    if (String(sentence || '').replace(/\s+/g, ' ').trim() === String(text || '').replace(/\s+/g, ' ').trim()) return null;
    return incoming(sentence);
  };

  const timeExiled = /^(whenever|when) an? (time) counter is removed from (this (?:card|permanent|creature|artifact|enchantment)|~)(?:,? while it's exiled)?,\s*(.+)$/.exec(text);
  if (timeExiled) {
    return withFields(reparse('whenever a counter is removed from this permanent, ' + timeExiled[4]), {
      placedCounter: 'time',
      whileExiled: true,
    } as any);
  }

  const firstMain = /^at the beginning of each player's first main phase,\s*(.+)$/.exec(text);
  if (firstMain) return withFields(reparse('at the beginning of your precombat main phase, ' + firstMain[1]), { whoseTurn: 'each_player' } as any);

  const yourNextMain = /^at the beginning of your next(?: first)? main phase,\s*(.+)$/.exec(text);
  if (yourNextMain) return withFields(reparse('at the beginning of your precombat main phase, ' + yourNextMain[1]), { delayedRider: true, thisTurn: true } as any);

  const nextMainTurn = /^at the beginning of the next(?: first)? main phase this turn,\s*(.+)$/.exec(text);
  if (nextMainTurn) return withFields(reparse('at the beginning of your precombat main phase, ' + nextMainTurn[1]), { delayedRider: true, thisTurn: true } as any);

  const oppCombat = /^at the beginning of combat on each opponent's turn,\s*(.+)$/.exec(text);
  if (oppCombat) return withFields(reparse('at the beginning of combat on your turn, ' + oppCombat[1]), { whoseTurn: 'each_opponent' } as any);

  const eachCombat = /^at the beginning of combat on each player's turn,\s*(.+)$/.exec(text);
  if (eachCombat) return withFields(reparse('at the beginning of combat on your turn, ' + eachCombat[1]), { whoseTurn: 'each_player' } as any);

  const nextCombat = /^at the beginning of the next combat(?: phase)?(?: this turn)?,\s*(.+)$/.exec(text);
  if (nextCombat) return withFields(reparse('at the beginning of combat on your turn, ' + nextCombat[1]), { delayedRider: true, thisTurn: true } as any);

  const eachCombatTurn = /^at the beginning of each combat this turn,\s*(.+)$/.exec(text);
  if (eachCombatTurn) return withFields(reparse('at the beginning of combat on your turn, ' + eachCombatTurn[1]), { delayedRider: true, thisTurn: true } as any);

  const enchantedOppCombat = /^at the beginning of combat on enchanted opponent's turn,\s*(.+)$/.exec(text);
  if (enchantedOppCombat) return withFields(reparse('at the beginning of combat on your turn, ' + enchantedOppCombat[1]), { whoseTurn: 'enchanted_player' } as any);

  const boast = /^(whenever|when) you activate a boast ability,\s*(.+)$/.exec(text);
  if (boast) return youPerform('boast', boast[2], { abilityWord: 'boast' });

  const clashWin = /^(whenever|when) you clash and win,\s*(.+)$/.exec(text);
  if (clashWin) return youPerform('win_clash', clashWin[2]);

  const causedShuffle = /^(whenever|when) a spell or ability causes (?:its controller|you|a player|an opponent) to shuffle (?:their|your) library,\s*(.+)$/.exec(text);
  if (causedShuffle) {
    return withFields(reparse('whenever a player shuffles their library, ' + causedShuffle[2]), {
      causedByOpponent: false,
    } as any);
  }

  const youAttackTarget = /^(whenever|when) you attack (the player who has the initiative|enchanted player|an opponent|a player)(?! with),\s*(.+)$/.exec(text);
  if (youAttackTarget) {
    const target = youAttackTarget[2];
    const attackedPlayer = target === 'the player who has the initiative' ? 'initiative'
      : target === 'enchanted player' ? 'enchanted'
        : target === 'an opponent' ? 'opponent' : 'any';
    return withFields(reparse('whenever one or more creatures you control attack, ' + youAttackTarget[3]), {
      attackedPlayer,
      attackedTargetType: 'player',
      quantity: 'one_or_more',
    } as any);
  }

  const youAttackWhile = /^(whenever|when) you attack while you control a creature with power (\d+) or greater,\s*(.+)$/.exec(text);
  if (youAttackWhile) {
    return withFields(reparse('whenever one or more creatures you control attack, ' + youAttackWhile[3]), {
      quantity: 'one_or_more',
      requireControlledPowerGte: Number(youAttackWhile[2]),
    } as any);
  }

  const youAttackPlayerOrPw = /^(whenever|when) you attack a player or planeswalker with (?:one or more )?(.+?),\s*(.+)$/.exec(text);
  if (youAttackPlayerOrPw) {
    const phrase = youAttackPlayerOrPw[2];
    const subject = /\b(?:you control|an opponent controls)\b/.test(phrase) ? phrase : phrase + ' you control';
    return withFields(reparse('whenever one or more ' + subject + ' attack, ' + youAttackPlayerOrPw[3]), {
      attackedPlayer: 'any',
      quantity: 'one_or_more',
    } as any);
  }

  const oppAttacksYouMonarch = /^(whenever|when) an opponent attacks you while you're the monarch,\s*(.+)$/.exec(text);
  if (oppAttacksYouMonarch) {
    return withFields(reparse('whenever a creature an opponent controls attacks you, ' + oppAttacksYouMonarch[2]), {
      quantity: 'one_or_more',
      requireYouAreMonarch: true,
    } as any);
  }

  const oppAttacksPws = /^(whenever|when) an opponent attacks one or more planeswalkers you control,\s*(.+)$/.exec(text);
  if (oppAttacksPws) {
    return withFields(reparse('whenever a creature an opponent controls attacks, ' + oppAttacksPws[2]), {
      attackedTargetType: 'planeswalker',
      quantity: 'one_or_more',
    } as any);
  }

  const oppAttacksAnother = /^(whenever|when) an opponent attacks another one of your opponents,\s*(.+)$/.exec(text);
  if (oppAttacksAnother) {
    return withFields(reparse('whenever a creature an opponent controls attacks, ' + oppAttacksAnother[2]), {
      attackedPlayer: 'opponent',
      quantity: 'one_or_more',
      attackDifferentPlayers: true,
    } as any);
  }

  const oppAttacksBare = /^(whenever|when) an opponent attacks,\s*(.+)$/.exec(text);
  if (oppAttacksBare) {
    return withFields(reparse('whenever a creature an opponent controls attacks, ' + oppAttacksBare[2]), { quantity: 'one_or_more' } as any);
  }

  const playerAttacksOpps = /^(whenever|when) a player attacks one or more of your opponents,\s*(.+)$/.exec(text);
  if (playerAttacksOpps) {
    return withFields(reparse('whenever a creature attacks, ' + playerAttacksOpps[2]), {
      attackedPlayer: 'opponent',
      quantity: 'one_or_more',
    } as any);
  }

  const andAtLeastOne = /^(whenever|when) (this creature|this permanent|~|[^,]+?) and at least one (other )?([a-z]+?) attack,\s*(.+)$/.exec(text);
  if (andAtLeastOne && !/deals|dies|enters/.test(andAtLeastOne[2])) {
    const who = andAtLeastOne[2];
    return withFields(reparse(andAtLeastOne[1] + ' ' + who + ' attacks, ' + andAtLeastOne[5]), {
      minOtherAttackers: 1,
      sourceAmongAttackers: true,
    } as any);
  }

  const saddledAttacks = /^(whenever|when) a saddled creature you control attacks,\s*(.+)$/.exec(text);
  if (saddledAttacks) {
    return withFields(reparse('whenever a creature you control attacks, ' + saddledAttacks[2]), { requiresSubjectSaddled: true } as any);
  }

  const ownNotControl = /^(whenever|when) a creature you own but (?:don't|do not) control attacks,\s*(.+)$/.exec(text);
  if (ownNotControl) {
    return withFields(reparse('whenever a creature attacks, ' + ownNotControl[2]), { controllerNotOwner: true } as any);
  }

  const attacksPlayerUnblocked = /^(whenever|when) (.+?) attacks (?:a player|an opponent) and (?:isn't|is not) blocked,\s*(.+)$/.exec(text);
  if (attacksPlayerUnblocked) {
    return withFields(reparse(attacksPlayerUnblocked[1] + ' ' + attacksPlayerUnblocked[2] + ' attacks and isn\'t blocked, ' + attacksPlayerUnblocked[3]), {
      attackedTargetType: 'player',
    } as any);
  }

  const powerEqToughAttacks = /^(whenever|when) (a creature you control|this creature|~) with power equal to its toughness attacks,\s*(.+)$/.exec(text);
  if (powerEqToughAttacks) {
    return withFields(reparse(powerEqToughAttacks[1] + ' ' + powerEqToughAttacks[2] + ' attacks, ' + powerEqToughAttacks[3]), { powerEqualsToughness: true } as any);
  }

  const basePTAttacks = /^(whenever|when) a creature you control with base power and toughness (\d+)\/(\d+) attacks,\s*(.+)$/.exec(text);
  if (basePTAttacks) {
    return withFields(reparse('whenever a creature you control attacks, ' + basePTAttacks[4]), basePT(basePTAttacks[2], basePTAttacks[3]) as any);
  }

  const attacksWhileNoOther = /^(whenever|when) (.+?) attacks while you don't control another ([a-z]+),\s*(.+)$/.exec(text);
  if (attacksWhileNoOther) {
    return withFields(reparse(attacksWhileNoOther[1] + ' ' + attacksWhileNoOther[2] + ' attacks, ' + attacksWhileNoOther[4]), {
      youDontControlAnotherSubtype: attacksWhileNoOther[3],
    } as any);
  }

  const attacksWhileTypes = /^(whenever|when) (.+?) attacks while there are (\d+) or more card types among cards in your graveyard,\s*(.+)$/.exec(text);
  if (attacksWhileTypes) {
    return withFields(reparse(attacksWhileTypes[1] + ' ' + attacksWhileTypes[2] + ' attacks, ' + attacksWhileTypes[4]), {
      minCardTypesInGraveyard: Number(attacksWhileTypes[3]),
    } as any);
  }

  const attacksOrBlocksWhile = /^(whenever|when) (.+?) attacks or blocks while you control (?:a |an )?([a-z]+),\s*(.+)$/.exec(text);
  if (attacksOrBlocksWhile) {
    return combineDual(
      withFields(reparse(attacksOrBlocksWhile[1] + ' ' + attacksOrBlocksWhile[2] + ' attacks, ' + attacksOrBlocksWhile[4]), { requireYouControlSubtype: attacksOrBlocksWhile[3] } as any),
      withFields(reparse(attacksOrBlocksWhile[1] + ' ' + attacksOrBlocksWhile[2] + ' blocks, ' + attacksOrBlocksWhile[4]), { requireYouControlSubtype: attacksOrBlocksWhile[3] } as any),
    );
  }

  const evenOdd = /^(whenever|when) you cast ((?:an? )?(?:[a-z]+ )*spell) with an (even|odd) mana value,\s*(.+)$/.exec(text);
  if (evenOdd) {
    return withFields(reparse('whenever you cast ' + evenOdd[2] + ', ' + evenOdd[4]), { manaValueParity: evenOdd[3] } as any);
  }

  const firstSpell = /^(whenever|when) you cast your first spell during each of your turns,\s*(.+)$/.exec(text);
  if (firstSpell) return withFields(reparse('whenever you cast a spell, ' + firstSpell[2]), { spellOrdinal: 1, ordinal: 'first', whoseTurn: 'you' } as any);

  const thirdSpell = /^(whenever|when) you cast your third spell in a turn,\s*(.+)$/.exec(text);
  if (thirdSpell) return withFields(reparse('whenever you cast a spell, ' + thirdSpell[2]), { spellOrdinal: 3, ordinal: 'third' } as any);

  const withTargets = /^(whenever|when) you cast a spell with one or more targets,\s*(.+)$/.exec(text);
  if (withTargets) return withFields(reparse('whenever you cast a spell, ' + withTargets[2]), { minSpellTargets: 1 } as any);

  const dontOwn = /^(whenever|when) you cast (an? [a-z]+ spell) you don't own,\s*(.+)$/.exec(text);
  if (dontOwn) return withFields(reparse('whenever you ' + dontOwn[2].replace(/^an? /, 'cast a ') + ', ' + dontOwn[3]), { spellNotOwned: true } as any);

  // Plain "an Adventure spell" stays with the generic cast parser (hasAdventure, any card type); only the
  // explicit "Adventure instant or sorcery spell" wording narrows the spell types.
  const adventure = /^(whenever|when) you cast an adventure instant or sorcery spell,\s*(.+)$/.exec(text);
  if (adventure) return withFields(reparse('whenever you cast an instant or sorcery spell, ' + adventure[2]), { hasAdventure: true } as any);

  const adventureOr = /^(whenever|when) you cast an adventure or ([a-z]+) spell,\s*(.+)$/.exec(text);
  if (adventureOr) {
    return combineDual(
      withFields(reparse('whenever you cast an instant or sorcery spell, ' + adventureOr[3]), { hasAdventure: true } as any),
      reparse('whenever you cast a ' + adventureOr[2] + ' spell, ' + adventureOr[3]),
    );
  }

  const fromExileOrLand = /^(whenever|when) you cast a spell from exile or a land you control enters from exile,\s*(.+)$/.exec(text);
  if (fromExileOrLand) {
    const combinedExileOrLand = combineDual(
      withFields(reparse('whenever you cast a spell, ' + fromExileOrLand[2]), { castFromZone: 'exile' } as any),
      withFields(reparse('whenever a land you control enters, ' + fromExileOrLand[2]), { fromZone: 'exile' } as any),
    );
    if (combinedExileOrLand) return combinedExileOrLand;
  }

  const fromGyOrActivate = /^(whenever|when) you cast a spell from your graveyard or activate an ability of a card in your graveyard,\s*(.+)$/.exec(text);
  if (fromGyOrActivate) {
    return combineDual(
      withFields(reparse('whenever you cast a spell, ' + fromGyOrActivate[2]), { castFromZone: 'graveyard' } as any),
      youPerform('activate_ability', fromGyOrActivate[2], { fromZone: 'graveyard' }),
    );
  }

  const usingMana = /^(whenever|when) you (cast (?:an? )?(?:artifact or creature |permanent |[a-z]+ )?spell) using mana produced by (?:this (?:land|permanent|artifact)|~),\s*(.+)$/.exec(text);
  if (usingMana) {
    const verb = usingMana[2].startsWith('cast') ? 'you ' + usingMana[2] : usingMana[2];
    return withFields(reparse('whenever ' + verb + ', ' + usingMana[3]), { requiresSourceMana: true } as any);
  }

  const withX = /^(whenever|when) you (cast (?:an? )?(?:permanent )?spell with (?:\{x\} in its mana cost|a mana cost that contains \{x\}))(?: or activate an ability with \{x\} in its activation cost(?: that isn't a mana ability)?)?,\s*(.+)$/.exec(text);
  if (withX) {
    const base = withFields(reparse('whenever you cast a spell, ' + withX[3]), { hasXInCost: true } as any);
    if (/or activate an ability/.test(text)) {
      return combineDual(base, youPerform('activate_ability', withX[3], { hasXInCost: true, notManaAbility: /isn't a mana ability/.test(text) }));
    }
    return base;
  }

  const auraTargets = /^(whenever|when) you cast an aura spell that targets (a creature an opponent controls|a modified permanent you control),\s*(.+)$/.exec(text);
  if (auraTargets) {
    const fields = auraTargets[2].includes('opponent')
      ? { targetsOpponent: true }
      : { targets: 'you' };
    return withFields(reparse('whenever you cast an Aura spell, ' + auraTargets[3]), fields as any);
  }

  const instMain = /^(whenever|when) you (cast an instant spell) during your main phase,\s*(.+)$/.exec(text);
  if (instMain) return withFields(reparse('whenever you ' + instMain[2] + ', ' + instMain[3]), { duringMainPhase: true } as any);

  const instOrActX = /^(whenever|when) you (cast an instant or sorcery spell) or activate an ability,\s*(.+)$/.exec(text);
  if (instOrActX) {
    return combineDual(
      withFields(reparse('whenever you ' + instOrActX[2] + ', ' + instOrActX[3]), { hasXInCost: /\{x\}/.test(instOrActX[3] + text) } as any),
      youPerform('activate_ability', instOrActX[3], { hasXInCost: /\{x\}/.test(text) }),
    );
  }

  const cycleAnother = /^(whenever|when) you cycle another card(?: for the first time each turn)?,\s*(.+)$/.exec(text);
  if (cycleAnother) {
    return withFields(reparse('whenever you cycle a card, ' + cycleAnother[2]), {
      excludeSource: true,
      ...( /first time each turn/.test(text) ? { onceEachTurn: true } : {}),
    } as any);
  }

  const mvThisTurn = /^(whenever|when) you (cast a spell with mana value (\d+) or greater) this turn,\s*(.+)$/.exec(text);
  if (mvThisTurn) {
    return withFields(reparse('whenever you cast a spell, ' + mvThisTurn[4]), {
      minSpellManaValue: Number(mvThisTurn[3]),
      delayedRider: true,
      thisTurn: true,
    } as any);
  }

  const exactColors = /^(whenever|when) you (cast a spell that's exactly (\d+) colors?),\s*(.+)$/.exec(text)
    || /^(whenever|when) you (cast a spell that's one or more colors),\s*(.+)$/.exec(text);
  if (exactColors) {
    const n = exactColors[3] ? Number(exactColors[3]) : undefined;
    const fields = n != null && Number.isFinite(n) ? { exactColorCount: n } : { colorCount: 'multicolored' };
    return withFields(reparse('whenever you cast a spell, ' + exactColors[exactColors[3] ? 4 : 3]), fields as any);
  }

  const prepared = /^(whenever|when) you (cast a prepared spell|cast a modal spell),\s*(.+)$/.exec(text);
  if (prepared) {
    const field = prepared[2].includes('prepared') ? { preparedSpell: true } : { modalSpell: true };
    return withFields(reparse('whenever you cast a spell, ' + prepared[3]), field as any);
  }

  const sameNameExiled = /^(whenever|when) you play a card with the same name as one of the exiled cards,\s*(.+)$/.exec(text);
  if (sameNameExiled) return withFields(reparse('whenever you cast a spell, ' + sameNameExiled[2]), { sameNameAsExiledWithSource: true } as any);

  const fromGyDragon = /^(whenever|when) you (cast a [a-z]+ creature spell) from your graveyard,\s*(.+)$/.exec(text);
  if (fromGyDragon) return withFields(reparse('whenever you ' + fromGyDragon[2] + ', ' + fromGyDragon[3]), { castFromZone: 'graveyard' } as any);

  const oneOrMoreDmg = /^(whenever|when) one or more (?:other )?(.+?) (?:you control )?deal(?:s)?(?: combat)? damage to (a player|one or more players|one or more of your opponents|you)(?: this turn)?,\s*(.+)$/.exec(text);
  if (oneOrMoreDmg && !/dealt/.test(text)) {
    const who = oneOrMoreDmg[2];
    const dest = oneOrMoreDmg[3];
    const recipient = dest === 'you' ? 'you' : dest.includes('opponent') ? 'opponent' : 'player';
    const combat = /combat damage/.test(text);
    const ev = combat ? ' deals combat damage to a player, ' : ' deals damage to a player, ';
    const noun = /you control/.test(who) || /you control/.test(text) ? who.replace(/you control$/, '').trim() + ' you control' : who;
    const dealt = withFields(reparse('whenever a ' + noun.replace(/^one or more /, '') + ev + oneOrMoreDmg[4]), {
      quantity: 'one_or_more',
      damageRecipient: recipient,
      ...( /this turn/.test(text) && !/this turn,$/.test(text) ? { thisTurn: true } : {}),
    } as any);
    if (dealt) return dealt;
  }

  const enchantedDmg = /^(whenever|when) an enchanted creature you control deals combat damage to a player,\s*(.+)$/.exec(text);
  if (enchantedDmg) {
    return withFields(reparse('whenever a creature you control deals combat damage to a player, ' + enchantedDmg[2]), { requiresEnchantedSubject: true } as any);
  }

  const renownedDmg = /^(whenever|when) a renowned creature you control deals combat damage to a player,\s*(.+)$/.exec(text);
  if (renownedDmg) {
    return withFields(reparse('whenever a creature you control deals combat damage to a player, ' + renownedDmg[2]), { isRenowned: true } as any);
  }

  const keywordDmg = /^(whenever|when) a creature you control with (flying|deathtouch|skulk) deals(?: combat)? damage to (a player|a planeswalker|a player or planeswalker),\s*(.+)$/.exec(text);
  if (keywordDmg) {
    const planeswalkerOnly = keywordDmg[3] === 'a planeswalker';
    const both = keywordDmg[3].includes('player or planeswalker');
    const combat = /combat damage/.test(text);
    const fields: Record<string, unknown> = {};
    if (planeswalkerOnly) fields.damageRecipient = 'planeswalker';
    else if (both) fields.damageRecipient = 'player_or_planeswalker';
    const base = stampSubject(
      withFields(reparse('whenever a creature you control ' + (combat ? 'deals combat damage to ' : 'deals damage to ') + 'a player, ' + keywordDmg[4]), fields as any),
      { keywordsWith: [keywordDmg[2]] },
    );
    if (base) return base;
  }

  const oppDealt = /^(whenever|when) (?:your opponents are dealt combat damage|an opponent is dealt combat damage by one or more creatures you control),\s*(.+)$/.exec(text);
  if (oppDealt) {
    return withFields(reparse('whenever a creature you control deals combat damage to an opponent, ' + oppDealt[2]), { quantity: 'one_or_more' } as any);
  }

  const sourceDeals = /^(whenever|when) a (noncreature |red )?source you control( other than this artifact)? deals damage(?: to (an opponent|a player|you|one or more permanents and\/or players))?,\s*(.+)$/.exec(text);
  if (sourceDeals) {
    const destRaw = sourceDeals[4];
    const qualified = Boolean(sourceDeals[2] || sourceDeals[3]);
    const specialDest = destRaw === 'you' || (destRaw || '').includes('permanents');
    if (qualified || specialDest) {
      const dest = destRaw === 'you' ? ' you' : destRaw === 'an opponent' ? ' an opponent' : destRaw && destRaw.includes('permanents') ? ' a player' : destRaw === 'a player' ? ' a player' : ' a player';
      const fields: Record<string, unknown> = {};
      if (sourceDeals[2] === 'noncreature ') fields.subjectExcludedWord = 'creature';
      if (sourceDeals[2] === 'red ') fields.subjectColor = 'r';
      if (sourceDeals[3]) fields.excludeSource = true;
      if (destRaw === 'you') fields.damageRecipient = 'you';
      if (destRaw && destRaw.includes('permanents')) fields.damageRecipient = 'any';
      const effect = sourceDeals[5];
      const base = reparse('whenever a source you control deals damage to' + dest + ', ' + effect);
      if (base) return withFields(base, fields as any);
    }
  }

  const dmgToYouOrThis = /^(whenever|when) (a creature|a permanent|a spell|enchanted creature) deals damage to (you|this creature|enchanted planeswalker),\s*(.+)$/.exec(text);
  if (dmgToYouOrThis) {
    const dest = dmgToYouOrThis[3] === 'you' ? 'you' : dmgToYouOrThis[3].includes('planeswalker') ? 'enchanted_planeswalker' : 'source';
    const dealt = withFields(reparse('whenever ' + dmgToYouOrThis[2] + ' deals damage to a player, ' + dmgToYouOrThis[4]), { damageRecipient: dest } as any);
    if (dealt) return dealt;
  }

  const selfDmgCreatures = /^(whenever|when) (this creature|~) deals(?: combat)? damage to (one or more (?:blocking )?creatures|a creature or opponent|one or more blocking creatures),\s*(.+)$/.exec(text);
  if (selfDmgCreatures) {
    const dest = selfDmgCreatures[3].includes('opponent') ? 'creature_or_opponent'
      : selfDmgCreatures[3].includes('blocking') ? 'blocking_creature' : 'creature';
    const combat = /combat damage/.test(text);
    return withFields(reparse(selfDmgCreatures[1] + ' ' + selfDmgCreatures[2] + (combat ? ' deals combat damage to a creature, ' : ' deals damage to a creature, ') + selfDmgCreatures[4]), {
      damageRecipient: dest,
      quantity: /one or more/.test(selfDmgCreatures[3]) ? 'one_or_more' : 'one',
    } as any);
  }

  const diesDuring = /^(whenever|when) (this creature|this permanent|~|it) dies during your turn,\s*(.+)$/.exec(text);
  if (diesDuring) {
    const who = diesDuring[2] === 'it' ? 'this creature' : diesDuring[2];
    return withFields(reparse('whenever ' + who + ' dies, ' + diesDuring[3]), { whoseTurn: 'you' } as any);
  }

  const diesThisTurn = /^(whenever|when) (it|this creature|a creature) dies this turn,\s*(.+)$/.exec(text);
  if (diesThisTurn) {
    const who = diesThisTurn[2] === 'it' ? 'a creature' : diesThisTurn[2];
    return withFields(reparse('whenever ' + who + ' dies, ' + diesThisTurn[3]), { delayedRider: true, thisTurn: true } as any);
  }

  const oneOrMoreDie = /^(whenever|when) one or more (other )?(.+?) (you control |your opponents control |an opponent controls )?die,\s*(.+)$/.exec(text);
  if (oneOrMoreDie) {
    const rel = oneOrMoreDie[4] || '';
    const noun = oneOrMoreDie[2] ? 'another ' + oneOrMoreDie[3] : 'a ' + oneOrMoreDie[3].replace(/s$/, '');
    const ctl = rel.includes('opponent') ? ' an opponent controls' : rel.includes('you control') ? ' you control' : '';
    return withFields(reparse('whenever ' + noun + ctl + ' dies, ' + oneOrMoreDie[5]), { quantity: 'one_or_more' } as any);
  }

  const enchantedDies = /^(whenever|when) an enchanted creature dies,\s*(.+)$/.exec(text);
  if (enchantedDies) return withFields(reparse('whenever a creature dies, ' + enchantedDies[2]), { requiresEnchantedSubject: true } as any);

  const gyAnywhere = /^(whenever|when) one or more (?:other )?(.+?) (?:cards )?are put into your graveyard from anywhere( during your turn)?(?: for the first time each turn)?,\s*(.+)$/.exec(text);
  if (gyAnywhere) {
    return withFields(reparse('whenever a ' + gyAnywhere[2].replace(/s$/, '') + ' card is put into your graveyard from anywhere, ' + gyAnywhere[4]), {
      quantity: 'one_or_more',
      ...(gyAnywhere[3] ? { whoseTurn: 'you' } : {}),
      ...( /first time each turn/.test(text) ? { onceEachTurn: true } : {}),
    } as any);
  }

  const diesOrAnotherGy = /^(whenever|when) this creature dies or another ([a-z]+) you control is put into a graveyard from the battlefield,\s*(.+)$/.exec(text);
  if (diesOrAnotherGy) {
    return combineDual(
      reparse('whenever this creature dies, ' + diesOrAnotherGy[3]),
      reparse('whenever another ' + diesOrAnotherGy[2] + ' you control is put into a graveyard from the battlefield, ' + diesOrAnotherGy[3]),
    );
  }

  const noPermanentsColor = /^(whenever|when) you control no permanents of the chosen color,\s*(.+)$/.exec(text);
  if (noPermanentsColor) {
    return stampSubject(withFields(reparse('when you control no permanents, ' + noPermanentsColor[2]), {} as any), { chosenColor: true });
  }

  const chosenTypeEnters = /^(whenever|when) (.+?) enters,\s*(.+)$/.exec(text);
  if (chosenTypeEnters && /of the chosen type/.test(chosenTypeEnters[2])) {
    const who = rewriteChosenTypeController(chosenTypeEnters[2]);
    const stripped = who.replace(/\s*of the chosen type\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const base = reparse(chosenTypeEnters[1] + ' ' + stripped + ' enters, ' + chosenTypeEnters[3]);
    if (base) return stampSubject(base, { chosenType: true });
  }

  const powerEqEtb = /^(whenever|when) (a creature you control|this creature|~) with power equal to its toughness enters,\s*(.+)$/.exec(text);
  if (powerEqEtb) return withFields(reparse(powerEqEtb[1] + ' ' + powerEqEtb[2] + ' enters, ' + powerEqEtb[3]), { powerEqualsToughness: true } as any);

  const nxnEtb = /^(whenever|when) (?:a|another) (\d+)\/(\d+) creature you control enters,\s*(.+)$/.exec(text);
  if (nxnEtb) return withFields(reparse('whenever a creature you control enters, ' + nxnEtb[4]), basePT(nxnEtb[2], nxnEtb[3]) as any);

  const basePowerEtb = /^(whenever|when) another creature you control with base power (\d+) enters,\s*(.+)$/.exec(text);
  if (basePowerEtb) return withFields(reparse('whenever another creature you control enters, ' + basePowerEtb[3]), { basePowerEquals: Number(basePowerEtb[2]) } as any);

  const toughGtPower = /^(whenever|when) (this creature or another creature you control|a creature you control) with toughness greater than its power enters,\s*(.+)$/.exec(text);
  if (toughGtPower) return withFields(reparse(toughGtPower[1] + ' ' + toughGtPower[2] + ' enters, ' + toughGtPower[3]), { toughnessGreaterThanPower: true } as any);

  const thisOrAnother = /^(whenever|when) this creature or another (.+?) enters,\s*(.+)$/.exec(text);
  if (thisOrAnother) {
    return combineDual(
      reparse('whenever this creature enters, ' + thisOrAnother[3]),
      reparse('whenever another ' + rewriteChosenTypeController(thisOrAnother[2]) + ' enters, ' + thisOrAnother[3]),
    );
  }

  const entersThisWay = /^(whenever|when) (it|this creature|an exiled card|a creature card) enters(?: under your control)? this way,\s*(.+)$/.exec(text);
  if (entersThisWay) {
    const who = entersThisWay[2];
    const rewritten = who === 'it' ? 'a creature enters' : who === 'an exiled card' ? 'a permanent enters under your control' : who + ' enters';
    const fields: Record<string, unknown> = { thisWay: true, delayedRider: true };
    if (who === 'an exiled card') fields.fromZone = 'exile';
    const entered = withFields(reparse('whenever ' + rewritten + ', ' + entersThisWay[3]), fields as any);
    if (entered) return entered;
  }

  const entersAttached = /^(whenever|when) this aura enters attached to a creature,\s*(.+)$/.exec(text);
  if (entersAttached) return withFields(reparse('whenever this Aura enters, ' + entersAttached[2]), { attachedToCreature: true } as any);

  const entersNotGyExile = /^(whenever|when) this creature enters from anywhere other than a graveyard or exile,\s*(.+)$/.exec(text);
  if (entersNotGyExile) return withFields(reparse('whenever this creature enters, ' + entersNotGyExile[2]), { fromZone: 'not_graveyard_or_exile' } as any);

  const landDuringTurn = /^(whenever|when) a land enters during your turn,\s*(.+)$/.exec(text);
  if (landDuringTurn) return withFields(reparse('whenever a land enters, ' + landDuringTurn[2]), { whoseTurn: 'you' } as any);

  const manaTapLand = /^(whenever|when) (a basic land|a forest|a mountain|a land you control|a land an opponent controls|a land|fortified land|a land with the same name as the exiled card) is tapped for mana(?: of the chosen color)?,\s*(.+)$/.exec(text);
  if (manaTapLand) {
    const phrase = manaTapLand[2] === 'fortified land' || /same name as the exiled/.test(manaTapLand[2]) ? 'a land' : manaTapLand[2];
    const fields: Record<string, unknown> = { event: 'tapped_for_mana' };
    if (manaTapLand[2].startsWith('a basic')) fields.basicLand = true;
    if (/chosen color/.test(text)) fields.chosenColor = true;
    if (/same name as the exiled/.test(manaTapLand[2])) fields.sameNameAsExiledWithSource = true;
    if (manaTapLand[2] === 'fortified land') fields.requiresFortifiedSubject = true;
    const base = reparse('whenever ' + phrase + ' becomes tapped, ' + manaTapLand[3]);
    return withFields(base, fields as any);
  }

  const playerTapsTypes = /^(whenever|when) a player taps a mountain, forest, or plains for mana,\s*(.+)$/.exec(text);
  if (playerTapsTypes) {
    return withFields(reparse('whenever a land becomes tapped, ' + playerTapsTypes[2]), { event: 'tapped_for_mana' } as any);
  }

  const youTapLandMonarch = /^(whenever|when) you tap a land for mana while you're the monarch,\s*(.+)$/.exec(text);
  if (youTapLandMonarch) {
    return withFields(reparse('whenever a land you control becomes tapped, ' + youTapLandMonarch[2]), {
      event: 'tapped_for_mana',
      requireYouAreMonarch: true,
    } as any);
  }

  const youTapForC = /^(whenever|when) you tap a permanent for \{c\},\s*(.+)$/.exec(text);
  if (youTapForC) {
    return withFields(reparse('whenever a permanent you control becomes tapped, ' + youTapForC[2]), {
      event: 'tapped_for_mana',
      producedColor: 'c',
    } as any);
  }

  const youTapOpp = /^(whenever|when) you tap an untapped creature an opponent controls,\s*(.+)$/.exec(text);
  if (youTapOpp) {
    return withFields(reparse('whenever a creature an opponent controls becomes tapped, ' + youTapOpp[2]), {
      causedByYou: true,
      requiresUntapped: true,
    } as any);
  }

  const becomesTappedDuring = /^(whenever|when) (this creature|~|a creature you control) becomes tapped during your turn(?: for the first time during each of your turns)?,\s*(.+)$/.exec(text);
  if (becomesTappedDuring) {
    return withFields(reparse(becomesTappedDuring[1] + ' ' + becomesTappedDuring[2] + ' becomes tapped, ' + becomesTappedDuring[3]), {
      whoseTurn: 'you',
      ...( /first time/.test(text) ? { onceEachTurn: true } : {}),
    } as any);
  }

  const blockOrBlocked = /^(whenever|when) ((?:enchanted|equipped) creature) blocks or becomes blocked(?: by (one or more creatures|a non-wall creature|a creature with toughness (\d+) or less|a [a-z]+|a creature))?,\s*(.+)$/.exec(text);
  if (blockOrBlocked) {
    const by = blockOrBlocked[3] || '';
    const fields: Record<string, unknown> = {};
    if (/toughness/.test(by) && blockOrBlocked[4]) fields.blockPartnerToughnessLte = Number(blockOrBlocked[4]);
    if (/non-wall/.test(by)) fields.blockPartnerExcludedSubtype = 'wall';
    if (/^a [a-z]+$/.test(by) && !/creature/.test(by)) fields.blockPartnerSubtype = by.slice(2);
    if (/one or more/.test(by)) fields.quantity = 'one_or_more';
    return combineDual(
      withFields(reparse(blockOrBlocked[1] + ' ' + blockOrBlocked[2] + ' blocks, ' + blockOrBlocked[5]), fields as any),
      withFields(reparse(blockOrBlocked[1] + ' ' + blockOrBlocked[2] + ' becomes blocked, ' + blockOrBlocked[5]), fields as any),
    );
  }

  const blocksThisTurn = /^(whenever|when) a creature blocks this turn,\s*(.+)$/.exec(text);
  if (blocksThisTurn) return withFields(reparse('whenever a creature blocks, ' + blocksThisTurn[2]), { delayedRider: true, thisTurn: true } as any);

  const becomesBlockedThisTurn = /^(whenever|when) that creature becomes blocked this turn,\s*(.+)$/.exec(text);
  if (becomesBlockedThisTurn) return withFields(reparse('whenever this creature becomes blocked, ' + becomesBlockedThisTurn[2]), { delayedRider: true, thisTurn: true } as any);

  const blocksLesser = /^(whenever|when) a creature blocks a creature with lesser power,\s*(.+)$/.exec(text);
  if (blocksLesser) return withFields(reparse('whenever a creature blocks, ' + blocksLesser[2]), { blockPartnerLesserPower: true } as any);

  const blocksSelf = /^(whenever|when) a creature blocks this creature,\s*(.+)$/.exec(text);
  if (blocksSelf) return withFields(reparse('whenever a creature blocks, ' + blocksSelf[2]), { blockPartnerIsSource: true } as any);

  const youDrawOppTurn = /^(whenever|when) you draw a card during an opponent's turn,\s*(.+)$/.exec(text);
  if (youDrawOppTurn) return withFields(reparse('whenever you draw a card, ' + youDrawOppTurn[2]), { whoseTurn: 'each_opponent' } as any);

  const oppDrawYourTurn = /^(whenever|when) an opponent draws a card during your turn,\s*(.+)$/.exec(text);
  if (oppDrawYourTurn) return withFields(reparse('whenever an opponent draws a card, ' + oppDrawYourTurn[2]), { whoseTurn: 'you' } as any);

  const oppDrawExcept = /^(whenever|when) an opponent draws a card except the first one they draw in each of their draw steps,\s*(.+)$/.exec(text);
  if (oppDrawExcept) return withFields(reparse('whenever an opponent draws a card, ' + oppDrawExcept[2]), { exceptFirstCardDrawnInDrawStep: true } as any);

  const enchantedDraws = /^(whenever|when) enchanted (player|opponent) draws a card,\s*(.+)$/.exec(text);
  if (enchantedDraws) return withFields(reparse('whenever a player draws a card, ' + enchantedDraws[3]), { subjectControlledBy: 'enchanted_player' } as any);

  const gainOrLose = /^(whenever|when) you gain or lose life during your turn,\s*(.+)$/.exec(text);
  if (gainOrLose) {
    return combineDual(
      withFields(reparse('whenever you gain life, ' + gainOrLose[2]), { whoseTurn: 'you' } as any),
      withFields(reparse('whenever you lose life, ' + gainOrLose[2]), { whoseTurn: 'you' } as any),
    );
  }

  const oppLoseLifeFirst = /^(whenever|when) an opponent loses life for the first time during each of their turns,\s*(.+)$/.exec(text);
  if (oppLoseLifeFirst) return withFields(reparse('whenever an opponent loses life, ' + oppLoseLifeFirst[2]), { onceEachTurn: true, whoseTurn: 'each_opponent' } as any);

  const oppsLose = /^(whenever|when) one or more opponents lose life,\s*(.+)$/.exec(text);
  if (oppsLose) return withFields(reparse('whenever an opponent loses life, ' + oppsLose[2]), { quantity: 'one_or_more' } as any);

  const commanderCz = /^(whenever|when) your commander is put into the command zone from anywhere,\s*(.+)$/.exec(text);
  if (commanderCz) {
    return stampSubject(withFields(reparse('whenever a creature you control leaves the battlefield, ' + commanderCz[2]), { toZone: 'command' } as any), { commander: true });
  }

  const fromGyToHand = /^(whenever|when) this card is put into your hand from your graveyard,\s*(.+)$/.exec(text);
  if (fromGyToHand) {
    return withFields(reparse("whenever this creature is returned to its owner's hand, " + fromGyToHand[2])
      || reparse('whenever this permanent is returned to your hand, ' + fromGyToHand[2]), { fromZone: 'graveyard', event: 'returned_to_hand' } as any);
  }

  const countersFirst = /^(whenever|when) one or more((?: \+?\d+\/\+?\d+)?(?: [a-z]+)?) counters are put on (this creature|this permanent|~) for the first time each turn,\s*(.+)$/.exec(text);
  if (countersFirst) {
    // Keep the counter kind ("charge counters"): dropping it fires the trigger for every counter type.
    const kind = countersFirst[2].trim();
    const typed = kind ? reparse('whenever one or more ' + kind + ' counters are put on ' + countersFirst[3] + ', ' + countersFirst[4]) : null;
    return withFields(typed || reparse('whenever a counter is put on ' + countersFirst[3] + ', ' + countersFirst[4]), { onceEachTurn: true } as any);
  }

  const manaAbilityAttacks = /^(whenever|when) a creature you control with a mana ability attacks,\s*(.+)$/.exec(text);
  if (manaAbilityAttacks) return withFields(reparse('whenever a creature you control attacks, ' + manaAbilityAttacks[2]), { requireSubjectManaAbility: true } as any);

  const powerAttacksYou = /^(whenever|when) a creature with power (\d+) or greater attacks you,\s*(.+)$/.exec(text);
  if (powerAttacksYou) {
    return stampSubject(
      reparse('whenever a creature attacks you, ' + powerAttacksYou[3]),
      { stats: [{ stat: 'power', op: 'gte', value: Number(powerAttacksYou[2]) }] },
    );
  }

  return parseRound65TriggerSentence(text, reparse);
}
