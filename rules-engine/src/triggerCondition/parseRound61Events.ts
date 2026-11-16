/**
 * Round 61 / legacy-r4: generic promotions for leftover ETB, combat-damage,
 * attack, spell-cast, and death families. Prefers dual-event combiners over
 * one-off card parsers.
 * Origin parent: parseRound59DelayedEvents.ts parseRound59DelayedTriggerSentence.
 * Public: parseRound61TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';
import { parseRound62TriggerSentence } from './parseRound62Events.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
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

function withController(base: Parsed | null, controller: 'you' | 'not_you' | 'any'): Parsed | null {
  if (!base) return null;
  const alts = (base.condition.alternatives || []).map((a) => ({ ...a, controller }));
  return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
}

export function parseRound61TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  // "When X enters and whenever/when/at the beginning of Y, effect"
  // "Whenever you cast A and whenever you draw..., effect"
  const andWhenever = /^(whenever|when) (.+) and (whenever|when|at the beginning of) (.+),\s*(.+)$/.exec(text);
  if (andWhenever) {
    const combined = combineDual(
      reparse(andWhenever[1] + ' ' + andWhenever[2] + ', ' + andWhenever[5]),
      reparse(andWhenever[3] + ' ' + andWhenever[4] + ', ' + andWhenever[5]),
    );
    if (combined) return combined;
  }
  const atAndWhenever = /^(at the beginning of .+) and (whenever|when|at the beginning of) (.+),\s*(.+)$/.exec(text);
  if (atAndWhenever) {
    const combined = combineDual(
      reparse(atAndWhenever[1] + ', ' + atAndWhenever[4]),
      reparse(atAndWhenever[2] + ' ' + atAndWhenever[3] + ', ' + atAndWhenever[4]),
    );
    if (combined) return combined;
  }

  // "enters or attacks", "enters or becomes the target...", "attacks or becomes the target..."
  const orEvent = /^(whenever|when) (.+?) (enters(?: the battlefield)?|attacks|dies) or ([^,]+),\s*(.+)$/.exec(text);
  if (orEvent && !/^(you|an opponent|a player|each player|that player)$/.test(orEvent[2].trim())) {
    const combined = combineDual(
      reparse(orEvent[1] + ' ' + orEvent[2] + ' ' + orEvent[3] + ', ' + orEvent[5]),
      reparse(orEvent[1] + ' ' + orEvent[2] + ' ' + orEvent[4] + ', ' + orEvent[5]),
    );
    if (combined) return combined;
  }

  // "a land you control enters from anywhere other than your hand or you cast a spell from..."
  const entersOrCast = /^(whenever|when) (.+?) enters(?: the battlefield)? (from [^,]+?) or you (cast a spell(?: from [^,]+)?),\s*(.+)$/.exec(text);
  if (entersOrCast) {
    const combined = combineDual(
      reparse(entersOrCast[1] + ' ' + entersOrCast[2] + ' enters ' + entersOrCast[3] + ', ' + entersOrCast[5]),
      reparse('whenever you ' + entersOrCast[4] + ', ' + entersOrCast[5]),
    );
    if (combined) return combined;
  }

  const playCard = /^(whenever|when) you play a card,\s*(.+)$/.exec(text);
  if (playCard) {
    const landOrSpell = reparse('whenever you play a land or cast a spell, ' + playCard[2]);
    const spell = reparse('whenever you cast a spell, ' + playCard[2]);
    if (landOrSpell && spell) return withFields(landOrSpell, { pairedCondition: spell.condition } as any);
    return landOrSpell;
  }

  const counterOnIt = /^(whenever|when) (.+) with a counter on it (.+),\s*(.+)$/.exec(text);
  if (counterOnIt) {
    return reparse(counterOnIt[1] + ' ' + counterOnIt[2] + ' with counters ' + counterOnIt[3] + ', ' + counterOnIt[4]);
  }

  const staff = /^(whenever|when) you cast a (white|blue|black|red|green) spell or an? ([a-z]+) you control enters,\s*(.+)$/.exec(text);
  if (staff) {
    const combined = combineDual(
      reparse('whenever you cast a ' + staff[2] + ' spell, ' + staff[4]),
      reparse('whenever a ' + staff[3] + ' you control enters, ' + staff[4]),
    );
    if (combined) return combined;
  }

  const fromZone = /^(whenever|when) (.+?) enters(?: the battlefield)? from (a graveyard|exile|anywhere other than your hand),\s*(.+)$/.exec(text);
  if (fromZone) {
    const zone = fromZone[3] === 'a graveyard' ? 'graveyard' : fromZone[3] === 'exile' ? 'exile' : 'not_hand';
    const fromZoneBase = reparse(fromZone[1] + ' ' + fromZone[2] + ' enters, ' + fromZone[4]);
    if (fromZoneBase) return withFields(fromZoneBase, { fromZone: zone } as any);
  }

  const duringCombat = /^(whenever|when) (.+?) enters(?: the battlefield)? during combat,\s*(.+)$/.exec(text);
  if (duringCombat) {
    return withFields(reparse(duringCombat[1] + ' ' + duringCombat[2] + ' enters, ' + duringCombat[3]), { duringCombat: true } as any);
  }

  const entersTapped = /^(whenever|when) (.+?) enters(?: the battlefield)? (tapped|untapped),\s*(.+)$/.exec(text);
  if (entersTapped) {
    const fields = entersTapped[3] === 'tapped' ? { entersTapped: true } : { entersUntapped: true };
    return withFields(reparse(entersTapped[1] + ' ' + entersTapped[2] + ' enters, ' + entersTapped[4]), fields as any);
  }

  const dmgThisTurn = /^(whenever|when) (it|that creature|this creature|a creature you control) deals combat damage to (?:a |that )?player this turn,\s*(.+)$/.exec(text);
  if (dmgThisTurn) {
    const who = dmgThisTurn[2] === 'it' || dmgThisTurn[2] === 'that creature' ? 'a creature' : dmgThisTurn[2];
    return withFields(
      reparse('whenever ' + who + ' deals combat damage to a player, ' + dmgThisTurn[3]),
      { thisTurn: true, delayedRider: true } as any,
    );
  }

  const duringTurn = /^(whenever|when) (.+?) deals combat damage during your turn,\s*(.+)$/.exec(text);
  if (duringTurn) {
    return withFields(
      reparse(duringTurn[1] + ' ' + duringTurn[2] + ' deals combat damage to a player, ' + duringTurn[3]),
      { whoseTurn: 'you' } as any,
    );
  }

  const yourCmd = /^(whenever|when) your commander deals combat damage to a player,\s*(.+)$/.exec(text);
  if (yourCmd) return reparse('whenever a commander you control deals combat damage to a player, ' + yourCmd[2]);

  const dmgYou = /^(whenever|when) (a creature|a source) deals damage to you,\s*(.+)$/.exec(text);
  if (dmgYou) {
    return withFields(
      reparse(dmgYou[1] + ' ' + dmgYou[2] + ' deals damage to a player, ' + dmgYou[3]),
      { damagedPlayer: 'you' } as any,
    );
  }

  const thatRef = /^(whenever|when) that (creature|token|permanent) (dies|leaves the battlefield|enters),\s*(.+)$/.exec(text);
  if (thatRef) {
    const verb = thatRef[3] === 'enters' ? 'enters' : thatRef[3] === 'dies' ? 'dies' : 'leaves the battlefield';
    const noun = thatRef[3] === 'dies' && thatRef[2] !== 'permanent' ? 'creature' : 'permanent';
    return withFields(reparse('whenever a ' + noun + ' ' + verb + ', ' + thatRef[4]), { delayedRider: true, thisWay: true } as any);
  }

  const diesOrExile = /^(whenever|when) (.+?) dies or is put into exile(?: from the battlefield)?,\s*(.+)$/.exec(text);
  if (diesOrExile) {
    const right = reparse(diesOrExile[1] + ' ' + diesOrExile[2] + ' is exiled, ' + diesOrExile[3])
      || reparse('whenever a creature is exiled, ' + diesOrExile[3]);
    const left = reparse(diesOrExile[1] + ' ' + diesOrExile[2] + ' dies, ' + diesOrExile[3]);
    const combined = combineDual(left, right);
    if (combined) return combined;
    if (left) return withFields(left, { pairedEvent: 'exiled' } as any);
  }

  const attackOpps = /^(whenever|when) one or more creatures attack one of your opponents(?: or a planeswalker they control)?,\s*(.+)$/.exec(text);
  if (attackOpps) {
    return withFields(reparse('whenever one or more creatures attack, ' + attackOpps[2]), {
      attackedPlayer: 'opponent',
      ...(/planeswalker/.test(text) ? {} : { attackedTargetType: 'player' }),
      quantity: 'one_or_more',
    } as any);
  }

  const oppAttacksYou = /^(whenever|when) an opponent attacks you with (two|three|four|five|\d+) or more creatures,\s*(.+)$/.exec(text);
  if (oppAttacksYou) {
    const WORD: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
    const n = WORD[oppAttacksYou[2]] ?? Number(oppAttacksYou[2]);
    return withFields(withController(reparse('whenever a creature attacks, ' + oppAttacksYou[3]), 'not_you'), {
      attackedPlayer: 'you',
      attackedTargetType: 'player',
      minAttackers: n,
      quantity: 'one_or_more',
    } as any);
  }

  const cycleThis = /^(whenever|when) you cycle this card,\s*(.+)$/.exec(text);
  if (cycleThis) {
    const base = reparse('whenever you cycle a card, ' + cycleThis[2]);
    if (base) return withFields(base, { sourceIsDiscarded: true } as any);
  }

  return parseRound62TriggerSentence(text, reparse);
}
