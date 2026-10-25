/**
 * Later trigger-event sentences.
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseLateTriggerSentence.
 *
 * Returns null unless the sentence is one event the record can describe.
 * "or" of two different events stays on the old detector, except
 * "create or sacrifice", which sets pairedEvent.
 */

import { parseSubjectPhrase } from './parseSubjectPhrase.js';
import type { TriggerConditionEvent, TriggerConditionIR } from './types.js';

export interface LateTriggerSentence {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
}

function actorController(actor: string): 'you' | 'not_you' | 'any' {
  if (actor === 'you') return 'you';
  if (actor === 'an opponent') return 'not_you';
  return 'any';
}

function withController(condition: TriggerConditionIR, controller: 'you' | 'not_you' | 'any'): TriggerConditionIR {
  return {
    ...condition,
    alternatives: condition.alternatives.map((alternative) => ({ ...alternative, controller })),
  };
}

function prepareSubjectPhrase(raw: string): string {
  let text = raw.replace(/\bcards?\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (text === 'one or more' || text.startsWith('one or more ')) {
    const rest = text.slice('one or more'.length).trim();
    const noun = rest === '' || rest === 'a' || rest === 'an' ? 'permanent' : rest;
    const article = /^(?:a|an|this|another|other)\b/.test(noun) ? noun : `a ${noun}`;
    return `one or more ${article}`;
  }
  if (text === '' || text === 'a' || text === 'an') return 'a permanent';
  if (!/^(?:a|an|this|another|other|enchanted|equipped)\b/.test(text)) return `a ${text}`;
  return text;
}

function subjectEvent(
  event: TriggerConditionEvent,
  rawSubject: string,
  effect: string,
  extra: Partial<TriggerConditionIR> = {},
): LateTriggerSentence | null {
  const attached = /^(enchanted|equipped)\s+(.+)$/.exec(rawSubject.trim());
  let subject = parseSubjectPhrase(prepareSubjectPhrase(rawSubject), event);
  if (!subject && attached) {
    const inner = parseSubjectPhrase(prepareSubjectPhrase(attached[2]), event);
    subject = inner
      ? { ...inner, alternatives: inner.alternatives.map((alternative) => ({ ...alternative, source: attached[1] as 'enchanted' | 'equipped' })) }
      : null;
  }
  const trimmed = effect.trim();
  if (!subject || !trimmed) return null;
  return { condition: { ...subject, ...extra, event }, effect: trimmed };
}

const PERFORM_ACTIONS: ReadonlyArray<{ phrase: string; action: string }> = [
  { phrase: 'activate an exhaust ability', action: 'activate_exhaust' },
  { phrase: "activate an ability that isn't a mana ability", action: 'activate_nonmana' },
  { phrase: 'activate an ability', action: 'activate_ability' },
  { phrase: 'foretell a card', action: 'foretell' },
  { phrase: 'roll a die', action: 'roll_die' },
  { phrase: 'roll the planar die', action: 'roll_planar_die' },
  { phrase: 'roll one or more dice', action: 'roll_die' },
  { phrase: 'win a coin flip', action: 'win_coin_flip' },
  { phrase: 'become the monarch', action: 'become_monarch' },
  { phrase: 'exert a creature', action: 'exert' },
  { phrase: 'complete a dungeon', action: 'complete_dungeon' },
  { phrase: 'surveil', action: 'surveil' },
  { phrase: 'scry', action: 'scry' },
  { phrase: 'explore', action: 'explore' },
  { phrase: 'connive', action: 'connive' },
  { phrase: 'discover', action: 'discover' },
  { phrase: 'clash', action: 'clash' },
  { phrase: 'expend', action: 'expend' },
  { phrase: 'proliferate', action: 'proliferate' },
];

function fromZoneOf(phrase: string): TriggerConditionIR['fromZone'] | null {
  if (phrase === 'the battlefield') return 'battlefield';
  if (phrase === 'anywhere') return 'anywhere';
  if (phrase === 'anywhere other than your hand') return 'not_hand';
  if (phrase === 'your library') return 'library';
  if (phrase === 'your hand') return 'hand';
  if (phrase === 'your graveyard' || phrase === 'a graveyard' || phrase === 'graveyard') return 'graveyard';
  if (phrase === 'exile') return 'exile';
  return null;
}

export function parseLateTriggerSentence(text: string): LateTriggerSentence | null {
  const putIntoExile = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) put into exile from (?:your |a )?graveyards?,\s*(.+)$/.exec(text);
  if (putIntoExile) return subjectEvent('exiled', putIntoExile[1], putIntoExile[2], { fromZone: 'graveyard' });

  const control = /^(?:whenever|when)\s+you\s+(gain|lose)\s+control\s+of\s+(.+?),\s*(.+)$/.exec(text);
  if (control) {
    const parsed = subjectEvent(control[1] === 'gain' ? 'gains_control' : 'loses_control', control[2], control[3]);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const leaves = /^(?:whenever|when)\s+(.+?)\s+leaves(?: the battlefield)?,\s*(.+)$/.exec(text);
  if (leaves && !/\bor\b/.test(leaves[1])) {
    return subjectEvent('leaves_battlefield', leaves[1], leaves[2]);
  }

  const bounce = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) returned to (your|its owner's|a player's) hand,\s*(.+)$/.exec(text);
  if (bounce) {
    const zoneOwner = bounce[2] === 'your' ? 'you' : 'any';
    return subjectEvent('returned_to_hand', bounce[1], bounce[3], { zoneOwner });
  }

  const countered = /^(?:whenever|when)\s+(a spell you control|a spell you've cast|a spell you have cast|a spell)\s+is countered,\s*(.+)$/.exec(text);
  if (countered) {
    const yours = countered[1] !== 'a spell';
    const parsed = subjectEvent('spell_countered', 'a permanent', countered[2], yours ? { zoneOwner: 'you' } : {});
    return parsed;
  }

  const youCounter = /^(?:whenever|when)\s+you counter a spell,\s*(.+)$/.exec(text);
  if (youCounter) {
    const parsed = subjectEvent('counters_spell', 'a permanent', youCounter[1]);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const yourSpellCounters = /^(?:whenever|when)\s+a spell or ability you control counters a spell,\s*(.+)$/.exec(text);
  if (yourSpellCounters) {
    const parsed = subjectEvent('counters_spell', 'a permanent', yourSpellCounters[1]);
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const stack = /^(?:whenever|when)\s+a spell or ability is put onto the stack,\s*(.+)$/.exec(text);
  if (stack) return subjectEvent('put_on_stack', 'a permanent', stack[1]);

  const cycleOrDiscard = /^(?:whenever|when)\s+(you|an opponent|a player)\s+cycles? or discards?\s+(?:a|another|one or more)\s+cards?,\s*(.+)$/.exec(text);
  if (cycleOrDiscard) {
    const parsed = subjectEvent('cycles', 'a card', cycleOrDiscard[2], { pairedEvent: 'discards' });
    return parsed ? { condition: withController(parsed.condition, actorController(cycleOrDiscard[1])), effect: parsed.effect } : null;
  }
  const cycle = /^(?:whenever|when)\s+(you|an opponent|a player)\s+cycles?\s+(?:a|another|one or more)\s+cards?,\s*(.+)$/.exec(text);
  if (cycle && !/\bcycle or discard\b/.test(text)) {
    const parsed = subjectEvent('cycles', 'a card', cycle[2]);
    return parsed ? { condition: withController(parsed.condition, actorController(cycle[1])), effect: parsed.effect } : null;
  }

  const transform = /^(?:whenever|when)\s+(.+?)\s+transforms,\s*(.+)$/.exec(text);
  if (transform) return subjectEvent('transforms', transform[1], transform[2]);

  const mutate = /^(?:whenever|when)\s+(.+?)\s+mutates,\s*(.+)$/.exec(text);
  if (mutate) return subjectEvent('mutates', mutate[1], mutate[2]);

  const attached = /^(?:whenever|when)\s+this equipment becomes attached to (?:a creature|a permanent),\s*(.+)$/.exec(text);
  if (attached) return subjectEvent('becomes_attached', 'this equipment', attached[1]);

  const unattached = /^(?:whenever|when)\s+this equipment becomes unattached from a permanent,\s*(.+)$/.exec(text);
  if (unattached) return subjectEvent('becomes_unattached', 'this equipment', unattached[1]);

  const monstrous = /^(?:whenever|when)\s+this creature becomes monstrous,\s*(.+)$/.exec(text);
  if (monstrous) return subjectEvent('becomes_monstrous', 'this creature', monstrous[1]);

  const crewed = /^(?:whenever|when)\s+this vehicle becomes crewed( for the first time each turn)?,\s*(.+)$/.exec(text);
  if (crewed) return subjectEvent('becomes_crewed', 'this vehicle', crewed[2], crewed[1] ? { onceEachTurn: true } : {});

  const saddled = /^(?:whenever|when)\s+this creature becomes saddled( for the first time each turn)?,\s*(.+)$/.exec(text);
  if (saddled) return subjectEvent('becomes_saddled', 'this creature', saddled[2], saddled[1] ? { onceEachTurn: true } : {});

  const youDealt = /^(?:whenever|when)\s+you(?:'re| are)\s+dealt (combat |noncombat )?damage,\s*(.+)$/.exec(text);
  if (youDealt) {
    const damageKind = youDealt[1]?.trim() === 'combat' ? 'combat' : youDealt[1]?.trim() === 'noncombat' ? 'noncombat' : 'any';
    const parsed = subjectEvent('dealt_damage', 'a permanent', youDealt[2], { damageKind, playerSubject: true });
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const dealt = /^(?:whenever|when)\s+(.+?)\s+is dealt (combat |noncombat )?damage,\s*(.+)$/.exec(text);
  if (dealt) {
    const damageKind = dealt[2]?.trim() === 'combat' ? 'combat' : dealt[2]?.trim() === 'noncombat' ? 'noncombat' : 'any';
    return subjectEvent('dealt_damage', dealt[1], dealt[3], { damageKind });
  }

  const playsLand = /^(?:whenever|when)\s+(you|an opponent|a player)\s+plays? a land,\s*(.+)$/.exec(text);
  if (playsLand) {
    const parsed = subjectEvent('plays_land', 'a land', playsLand[2]);
    return parsed ? { condition: withController(parsed.condition, actorController(playsLand[1])), effect: parsed.effect } : null;
  }

  const unlock = /^(?:whenever|when)\s+you unlock this door,\s*(.+)$/.exec(text);
  if (unlock) return subjectEvent('unlocks_door', 'this permanent', unlock[1]);

  const causedShuffle = /^(?:whenever|when)\s+a spell or ability causes\s+(you|an opponent|a player)\s+to shuffle\s+(their|your|his or her)\s+library,\s*(.+)$/.exec(text);
  if (causedShuffle) {
    const parsed = subjectEvent('shuffles_library', 'a permanent', causedShuffle[3], {
      libraryOwner: causedShuffle[2] === 'your' ? 'source' : 'subject',
    });
    return parsed ? { condition: withController(parsed.condition, actorController(causedShuffle[1])), effect: parsed.effect } : null;
  }

  const entersFrom = /^(?:whenever|when)\s+(.+?)\s+enters(?: the battlefield)? from (anywhere other than your hand|your library|your graveyard|your hand),\s*(.+)$/.exec(text);
  if (entersFrom) {
    const fromZone = fromZoneOf(entersFrom[2]);
    if (!fromZone) return null;
    return subjectEvent('enters', entersFrom[1], entersFrom[3], { fromZone });
  }

  const perform = /^(?:whenever|when)\s+(you|an opponent|a player)\s+(.+?),\s*(.+)$/.exec(text);
  if (perform) {
    const verb = perform[2] === 'scry' || /^scry \d+$/.test(perform[2])
      ? 'scry'
      : /^expend(?: \d+)?$/.test(perform[2])
        ? 'expend'
        : perform[2];
    const known = PERFORM_ACTIONS.find((entry) => entry.phrase === verb);
    if (known) {
      const expendAmount = known.action === 'expend' ? Number(/^expend (\d+)$/.exec(perform[2])?.[1]) : NaN;
      const parsed = subjectEvent('performs', 'a permanent', perform[3], {
        action: known.action,
        ...(Number.isFinite(expendAmount) ? { actionAmount: expendAmount } : {}),
      });
      return parsed ? { condition: withController(parsed.condition, actorController(perform[1])), effect: parsed.effect } : null;
    }
  }

  if (/^whenever the ring tempts you,\s*(.+)$/.exec(text)) {
    const ring = /^whenever the ring tempts you,\s*(.+)$/.exec(text);
    if (!ring) return null;
    const parsed = subjectEvent('performs', 'a permanent', ring[1], { action: 'ring_tempts' });
    return parsed ? { condition: withController(parsed.condition, 'you'), effect: parsed.effect } : null;
  }

  const day = /^whenever day becomes night or night becomes day,\s*(.+)$/.exec(text);
  if (day) return subjectEvent('performs', 'a permanent', day[1], { action: 'day_night' });

  const chaos = /^whenever chaos ensues,\s*(.+)$/.exec(text);
  if (chaos) return subjectEvent('performs', 'a permanent', chaos[1], { action: 'chaos' });

  const vote = /^whenever players finish voting,\s*(.+)$/.exec(text);
  if (vote) return subjectEvent('performs', 'a permanent', vote[1], { action: 'vote' });

  return null;
}
