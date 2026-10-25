/**
 * Census trigger wordings with no live emitter of their own.
 * Origin parent: parseLateEvents.ts parseLateTriggerSentence.
 * Public: parseSelfAndPlayerTriggerSentence.
 *
 * "whenever you attack" maps to attacks / one_or_more / you (the attack emitter
 * dedupes per source + effect, so it fires once per declaration).
 * "becomes blocked" (self, watcher, enchanted/equipped, optional "by X" partner filter)
 * and "attacks and isn't blocked" are collected by the server combat emitters.
 * "the last (time counter) is removed" and "when you cast this spell" get their own
 * events, which no parsed emitter collects yet; the legacy detectors keep runtime handling.
 */

import { parseBlockedSubjectClause, parseSpellCastClause } from './parseFamilies.js';
import { parseSubjectPhrase } from './parseSubjectPhrase.js';
import type { TriggerConditionIR } from './types.js';
import { parseRound6TriggerSentence } from './parseRound6Events.js';
import { parseRound8TriggerSentence } from './parseRound8Events.js';
import { parseRound11TriggerSentence } from './parseRound11Events.js';
import { parseRound12TriggerSentence } from './parseRound12Events.js';
import { parseTriggerEventSentence } from './parseFamilies.js';

export interface SelfAndPlayerTriggerSentence {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
}

const SELF_SUBJECT = /^(?:this (?:creature|permanent|card|artifact|enchantment|vehicle)|~|it)$/;

function selfCondition(event: TriggerConditionIR['event'], extra: Partial<TriggerConditionIR> = {}): TriggerConditionIR {
  return {
    event,
    quantity: 'one',
    alternatives: [{
      controller: 'any',
      source: 'self',
      subject: {
        anyObject: true,
        typeGroups: [],
        subtypeGroups: [],
        groups: [],
        excludedWords: [],
        supertypes: [],
        keywordsWith: [],
        keywordsWithout: [],
        token: 'any',
      },
    }],
    ...extra,
  } as TriggerConditionIR;
}

const ACTOR_CONTROLLER: Readonly<Record<string, 'you' | 'not_you' | 'any'>> = { you: 'you', 'an opponent': 'not_you', 'a player': 'any' };

/**
 * "draws your/their second card each turn": draws_card with an ordinal. The draw emitter
 * passes no ordinal in its context, so the matcher refuses it and the legacy detector keeps it.
 */
function parseOrdinalDraw(text: string): SelfAndPlayerTriggerSentence | null {
  const draw = /^whenever (you|an opponent|a player) draws? (?:your|their) (first|second) card each turn,\s*(.+)$/.exec(text);
  if (!draw) return null;
  const subject = parseSubjectPhrase('a permanent', 'draws_card');
  if (!subject) return null;
  const controller = ACTOR_CONTROLLER[draw[1]];
  return {
    condition: {
      ...subject,
      event: 'draws_card',
      ordinal: draw[2] as 'first' | 'second',
      alternatives: subject.alternatives.map((alternative) => ({ ...alternative, controller })),
    },
    effect: draw[3].trim(),
  };
}

/** Heroic: "you cast a spell that targets this creature". Matches only with targetPermanentIds. */
function parseSpellTargetsSelf(text: string): SelfAndPlayerTriggerSentence | null {
  const cast = /^whenever (you cast|an opponent casts|a player casts) (.+?) that targets (?:this creature|this permanent|~|it),\s*(.+)$/.exec(text);
  if (!cast) return null;
  const parsed = parseSpellCastClause(`${cast[1]} ${cast[2]}`);
  if (!parsed) return null;
  return { condition: { ...parsed, targets: 'self' }, effect: cast[3].trim() };
}

/**
 * Round 3 self wordings. "dies or is exiled" pairs dies with exiled. "attacks and isn't
 * blocked" gets attacks_unblocked, which no parsed emitter collects yet. "attacks while
 * saddled" is attacks gated on source.saddled. "blocks or becomes blocked [by X]" is blocks
 * paired with becomes_blocked, and an X filter fails closed without context.blockPartner.
 * Magecraft keeps only the cast half; copies stay with the legacy detector.
 */
function parseRound3Sentence(text: string): SelfAndPlayerTriggerSentence | null {
  const diesOrExiled = /^(?:whenever|when)\s+(.+?)\s+dies or is (?:put into exile|exiled),\s*(.+)$/.exec(text);
  if (diesOrExiled && SELF_SUBJECT.test(diesOrExiled[1].trim())) {
    return { condition: selfCondition('dies', { pairedEvent: 'exiled' } as Partial<TriggerConditionIR>), effect: diesOrExiled[2].trim() };
  }
  const castOrCopy = /^whenever (you|an opponent|a player) casts? or cop(?:y|ies) (.+?),\s*(.+)$/.exec(text);
  if (castOrCopy) {
    const verb = castOrCopy[1] === 'you' ? 'you cast' : `${castOrCopy[1]} casts`;
    const parsed = parseSpellCastClause(`${verb} ${castOrCopy[2]}`);
    if (parsed) return { condition: { ...parsed, pairedEvent: 'spell_copied' }, effect: castOrCopy[3].trim() };
  }
  const copies = /^whenever (you|an opponent|a player) cop(?:y|ies) (an? .+?|one or more .+?),\s*(.+)$/.exec(text);
  if (copies) {
    const verb = copies[1] === 'you' ? 'you cast' : `${copies[1]} casts`;
    const parsed = parseSpellCastClause(`${verb} ${copies[2]}`);
    if (parsed) return { condition: { ...parsed, event: 'spell_copied' }, effect: copies[3].trim() };
  }
  const unblocked = /^(?:whenever|when)\s+(.+?)\s+attacks and (?:isn't|is not) blocked,\s*(.+)$/.exec(text);
  if (unblocked) {
    const subjectText = unblocked[1].trim();
    if (SELF_SUBJECT.test(subjectText)) return { condition: selfCondition('attacks_unblocked'), effect: unblocked[2].trim() };
    const subject = parseBlockedSubjectClause(subjectText, 'attacks_unblocked');
    if (subject) return { condition: subject, effect: unblocked[2].trim() };
    return null;
  }
  const saddled = /^(?:whenever|when)\s+(.+?)\s+attacks while saddled,\s*(.+)$/.exec(text);
  if (saddled && SELF_SUBJECT.test(saddled[1].trim())) {
    return { condition: selfCondition('attacks', { requiresSaddled: true } as Partial<TriggerConditionIR>), effect: saddled[2].trim() };
  }
  const blockPair = /^(?:whenever|when)\s+(.+?)\s+blocks or becomes blocked(?: by (.+?))?,\s*(.+)$/.exec(text);
  if (blockPair && SELF_SUBJECT.test(blockPair[1].trim())) {
    const partnerText = (blockPair[2] || '').trim();
    let blockPartner: TriggerConditionIR['blockPartner'];
    if (partnerText && !/^(?:a|one or more) creatures?$/.test(partnerText)) {
      const partner = parseSubjectPhrase(partnerText, 'blocks');
      if (!partner || partner.alternatives.length !== 1) return null;
      blockPartner = partner.alternatives[0].subject;
    }
    return {
      condition: selfCondition('blocks', { pairedEvent: 'becomes_blocked', ...(blockPartner ? { blockPartner } : {}) } as Partial<TriggerConditionIR>),
      effect: blockPair[3].trim(),
    };
  }
  return null;
}

export function parseSelfAndPlayerTriggerSentence(text: string): SelfAndPlayerTriggerSentence | null {
  const round6 = parseRound6TriggerSentence(text);
  if (round6) return round6;
  const round8 = parseRound8TriggerSentence(text);
  if (round8) return round8;
  const round11 = parseRound11TriggerSentence(text, (s) => parseTriggerEventSentence(s) as any);
  if (round11) return round11;
  const round12 = parseRound12TriggerSentence(text, (s) => parseTriggerEventSentence(s) as any);
  if (round12) return round12;
  const round3 = parseRound3Sentence(text);
  if (round3) return round3;
  const ordinalDraw = parseOrdinalDraw(text);
  if (ordinalDraw) return ordinalDraw;
  const targetsSelf = parseSpellTargetsSelf(text);
  if (targetsSelf) return targetsSelf;

  const youAttackWith = /^whenever you attack with (one|two|three|four|five) or more creatures,\s*(.+)$/.exec(text);
  if (youAttackWith) {
    const count = ({ one: 1, two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[youAttackWith[1]];
    const base = parseSubjectPhrase('one or more creatures you control', 'attacks');
    if (!base || !count) return null;
    const condition = count > 1 ? { ...base, minOtherAttackers: count - 1 } : base;
    return { condition, effect: youAttackWith[2].trim() };
  }

  const youAttack = /^whenever you attack,\s*(.+)$/.exec(text);
  if (youAttack) {
    const condition = parseSubjectPhrase('one or more creatures you control', 'attacks');
    return condition ? { condition, effect: youAttack[1].trim() } : null;
  }

  const blocked = /^(?:whenever|when)\s+(.+?)\s+becomes blocked(?: by (.+?))?,\s*(.+)$/.exec(text);
  if (blocked) {
    const partnerText = (blocked[2] || '').trim();
    let blockPartner: TriggerConditionIR['blockPartner'];
    if (partnerText && !/^(?:a|one or more) creatures?$/.test(partnerText)) {
      const partner = parseSubjectPhrase(partnerText, 'blocks');
      if (!partner || partner.alternatives.length !== 1) return null;
      blockPartner = partner.alternatives[0].subject;
    }
    const extra = blockPartner ? { blockPartner } : {};
    const subjectText = blocked[1].trim();
    if (SELF_SUBJECT.test(subjectText)) {
      return { condition: selfCondition('becomes_blocked', extra as Partial<TriggerConditionIR>), effect: blocked[3].trim() };
    }
    const subject = parseBlockedSubjectClause(subjectText, 'becomes_blocked');
    if (!subject) return null;
    return { condition: { ...subject, ...extra }, effect: blocked[3].trim() };
  }

  const lastRemoved = /^when the last(?: (time|[a-z-]+) counter)? is removed(?: from (?:it|this card|this permanent|this creature|~))?(?:,? (?:while|if) it'?s exiled)?,\s*(.+)$/.exec(text);
  if (lastRemoved) {
    return {
      condition: selfCondition('last_counter_removed', { placedCounter: lastRemoved[1] || 'time' } as Partial<TriggerConditionIR>),
      effect: lastRemoved[2].trim(),
    };
  }

  const castSelf = /^when you cast (?:this spell|~|this card|this creature spell),\s*(.+)$/.exec(text);
  if (castSelf) return { condition: selfCondition('cast_self'), effect: castSelf[1].trim() };

  return null;
}
