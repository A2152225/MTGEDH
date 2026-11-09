/**
 * Round 59 / legacy-r2: delayed_rider IR shapes.
 * Standalone "When you/they do", next/that end step, that combat, next EOC,
 * that-creature dies/leaves this turn, next-cast / that-spell already partially
 * covered — promote remaining stubs off legacyRuntimeOnly.
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseRound59DelayedTriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

export function parseRound59DelayedTriggerSentence(text: string, reparse: Reparse): Parsed | null {
  // Standalone reflexive riders (split off parent sentences by inventory / oracle split).
  const youDo = /^(?:when|whenever) you do,\s*(.+)$/i.exec(text);
  if (youDo) {
    return {
      condition: {
        event: 'reflexive_do',
        quantity: 'one',
        alternatives: [],
        reflexiveActor: 'you',
        delayedRider: true,
      } as TriggerConditionIR,
      effect: youDo[1].trim(),
    };
  }
  const theyDo = /^(?:when|whenever) they do,\s*(.+)$/i.exec(text);
  if (theyDo) {
    return {
      condition: {
        event: 'reflexive_do',
        quantity: 'one',
        alternatives: [],
        reflexiveActor: 'they',
        delayedRider: true,
      } as TriggerConditionIR,
      effect: theyDo[1].trim(),
    };
  }

  // "At the beginning of the next end step, ..."
  const nextEnd = /^at the beginning of the next end step,\s*(.+)$/i.exec(text);
  if (nextEnd) {
    const base = reparse('at the beginning of the end step, ' + nextEnd[1]);
    if (base) return withFields(base, { delayedNextTurn: true, delayedRider: true, whoseTurn: 'each_player' } as any);
    return {
      condition: {
        event: 'beginning_of_end_step',
        quantity: 'one',
        alternatives: [],
        delayedNextTurn: true,
        delayedRider: true,
        whoseTurn: 'each_player',
      } as TriggerConditionIR,
      effect: nextEnd[1].trim(),
    };
  }

  // "At the beginning of that turn's end step, ..."
  const thatTurnEnd = /^at the beginning of that turn'?s? end step,\s*(.+)$/i.exec(text);
  if (thatTurnEnd) {
    return withFields(reparse('at the beginning of the end step, ' + thatTurnEnd[1]), {
      delayedNextTurn: true,
      delayedRider: true,
      whoseTurn: 'that_player',
    } as any);
  }

  // "At the beginning of that combat, ..."
  const thatCombat = /^at the beginning of that combat,\s*(.+)$/i.exec(text);
  if (thatCombat) {
    const base = reparse('at the beginning of combat on your turn, ' + thatCombat[1])
      || reparse('at the beginning of combat, ' + thatCombat[1]);
    if (base) return withFields(base, { delayedNextTurn: true, delayedRider: true } as any);
    return {
      condition: {
        event: 'beginning_of_combat',
        quantity: 'one',
        alternatives: [],
        delayedNextTurn: true,
        delayedRider: true,
      } as TriggerConditionIR,
      effect: thatCombat[1].trim(),
    };
  }

  // "At this turn's next end of combat, ..."
  const nextEoc = /^at this turn'?s? next end of combat,\s*(.+)$/i.exec(text);
  if (nextEoc) {
    const base = reparse('at end of combat, ' + nextEoc[1]);
    if (base) return withFields(base, { delayedNextTurn: true, delayedRider: true, thisTurn: true } as any);
    return {
      condition: {
        event: 'end_of_combat',
        quantity: 'one',
        alternatives: [],
        delayedNextTurn: true,
        delayedRider: true,
        thisTurn: true,
      } as TriggerConditionIR,
      effect: nextEoc[1].trim(),
    };
  }

  // "When that/the/it creature dies this turn, ..."
  const thatDies = /^when (?:that creature|the creature|it) dies this turn,\s*(.+)$/i.exec(text);
  if (thatDies) {
    return withFields(reparse('when a creature dies, ' + thatDies[1]), {
      thisTurn: true,
      delayedRider: true,
    } as any);
  }

  // "When that/the creature leaves the battlefield this turn, ..."
  const thatLeaves = /^when (?:that creature|the creature|it) leaves the battlefield this turn,\s*(.+)$/i.exec(text);
  if (thatLeaves) {
    return withFields(reparse('when a creature leaves the battlefield, ' + thatLeaves[1]), {
      thisTurn: true,
      delayedRider: true,
    } as any);
  }

  // "Whenever that creature deals (combat) damage this turn/combat, ..."
  const thatDmg = /^whenever that creature deals (?:combat )?damage(?: to (?:a player|any target|you))?(?: this (?:turn|combat))?,\s*(.+)$/i.exec(text);
  if (thatDmg) {
    const toPlayer = /to a player|to you/i.test(text);
    const combat = /combat damage/i.test(text);
    const event = combat && toPlayer ? 'deals_combat_damage_to_player' : combat ? 'deals_combat_damage' : 'deals_damage';
    return withFields(reparse(`whenever a creature deals${combat ? ' combat' : ''} damage${toPlayer ? ' to a player' : ''}, ` + thatDmg[1]), {
      thisTurn: true,
      delayedRider: true,
    } as any);
  }

  // Ensure "when you next cast ..." carries delayedRider (parser may already set nextSpellThisTurn).
  const nextCast = /^when you next cast (.+?) this turn,\s*(.+)$/i.exec(text);
  if (nextCast) {
    const base = reparse('whenever you cast ' + nextCast[1] + ', ' + nextCast[2]);
    return withFields(base, { nextSpellThisTurn: true, delayedRider: true } as any);
  }

  // "When you cast that spell, ..."
  const thatSpell = /^when you cast that spell,\s*(.+)$/i.exec(text);
  if (thatSpell) {
    return withFields(reparse('whenever you cast a spell, ' + thatSpell[1]), {
      thatSpell: true,
      nextSpellThisTurn: true,
      delayedRider: true,
    } as any);
  }

  // "At the beginning of your next upkeep, ..."
  const yourNextUpkeep = /^at the beginning of your next upkeep,\s*(.+)$/i.exec(text);
  if (yourNextUpkeep) {
    return withFields(reparse('at the beginning of your upkeep, ' + yourNextUpkeep[1]), {
      delayedNextTurn: true,
      delayedRider: true,
    } as any);
  }

  // "At the beginning of the next upkeep, ..."
  const nextUpkeep = /^at the beginning of the next upkeep,\s*(.+)$/i.exec(text);
  if (nextUpkeep) {
    return withFields(reparse('at the beginning of the upkeep, ' + nextUpkeep[1]), {
      delayedNextTurn: true,
      delayedRider: true,
    } as any);
  }

  // --- ETB / attack this-turn promotions (legacy-r2) -------------------------

  // "When ~ enters and at the beginning of your upkeep, ..."
  const entersAndUpkeep = /^when (.+?) enters and at the beginning of your upkeep,\s*(.+)$/i.exec(text);
  if (entersAndUpkeep) {
    return withFields(reparse('when ' + entersAndUpkeep[1] + ' enters, ' + entersAndUpkeep[2]), {
      pairedEvent: 'beginning_of_upkeep',
    } as any);
  }

  // "When ~ enters during the declare attackers step, ..."
  const entersDeclare = /^when (.+?) enters during the declare attackers step,\s*(.+)$/i.exec(text);
  if (entersDeclare) {
    return withFields(reparse('when ' + entersDeclare[1] + ' enters, ' + entersDeclare[2]), {
      duringCombat: true,
      delayedRider: false,
    } as any);
  }

  // "When ~ enters from a graveyard, ..."
  const entersGy = /^when (.+?) enters from a graveyard,\s*(.+)$/i.exec(text);
  if (entersGy) {
    return withFields(reparse('when ' + entersGy[1] + ' enters, ' + entersGy[2]), {
      fromZone: 'graveyard',
    } as any);
  }

  // "When it regenerates this way, ..." — parent-scheduled regenerate rider
  const regen = /^when it regenerates this way,\s*(.+)$/i.exec(text);
  if (regen) {
    return {
      condition: {
        event: 'reflexive_do',
        quantity: 'one',
        alternatives: [],
        reflexiveActor: 'you',
        delayedRider: true,
        thisWay: true,
      } as TriggerConditionIR,
      effect: regen[1].trim(),
    };
  }

  // "Whenever a creature attacks this turn, ..." (and typed variants) — turn-scoped delayed watcher
  const attacksThisTurn = /^whenever (a creature|an? [a-z][a-z\- ]*?|one or more creatures(?: you control)?) attacks this turn,\s*(.+)$/i.exec(text);
  if (attacksThisTurn) {
    const subj = /one or more/i.test(attacksThisTurn[1]) ? attacksThisTurn[1] : attacksThisTurn[1];
    return withFields(reparse('whenever ' + subj + ' attacks, ' + attacksThisTurn[2]), {
      thisTurn: true,
      delayedRider: true,
    } as any);
  }

  // "Whenever a creature you control that's enchanted or equipped attacks, ..."
  const enchOrEquip = /^whenever a creature you control that'?s? enchanted or equipped attacks,\s*(.+)$/i.exec(text);
  if (enchOrEquip) {
    return withFields(reparse('whenever a creature you control attacks, ' + enchOrEquip[1]), {
      requireEquippedAttacker: true,
      // also enchanted — match accepts equipped; stamp modified-style via requireEquipped is partial.
      // Use subject filter modified if available: leave requireEquippedAttacker and also mark alternatives.
    } as any);
  }

  // "Whenever a player attacks enchanted player with one or more creatures, ..."
  const attackEnchantedBatch = /^whenever a player attacks enchanted player with one or more creatures,\s*(.+)$/i.exec(text);
  if (attackEnchantedBatch) {
    return withFields(reparse('whenever a creature attacks, ' + attackEnchantedBatch[1]), {
      attackedPlayer: 'enchanted',
      quantity: 'one_or_more',
    } as any);
  }

  return null;
}
