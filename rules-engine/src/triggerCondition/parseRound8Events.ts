/**
 * Round 8 trigger wordings: turned face up, transforms into, class level, tapped for mana,
 * control no X, scry or surveil, enchantment-or-room enters, blocks a creature,
 * attacks you or a planeswalker you control.
 * Origin parent: parseSelfAndPlayerEvents.ts parseSelfAndPlayerTriggerSentence.
 * Public: parseRound8TriggerSentence.
 *
 * tapped_for_mana lines are triggered mana abilities (CR 605.1b) and controls_none is a
 * state trigger (CR 603.8); neither has a parsed stack emitter, legacy keeps runtime.
 * attackedPlayer 'you' needs context.attackedPlayerId and fails closed without it.
 */

import { parseBlockedSubjectClause } from './parseFamilies.js';
import { parseSubjectPhrase } from './parseSubjectPhrase.js';
import type { TriggerConditionIR } from './types.js';

export interface Round8TriggerSentence {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
}

const SELF = '(?:this (?:creature|permanent|card|artifact|enchantment|vehicle|land)|~|it)';
/** A face name, optionally with a short epithet ("Avacyn, the Purifier"); only the source's own face can follow "this creature transforms into". */
const FACE_NAME = "(?:~|this creature|this permanent|[a-z0-9'-]+(?: [a-z0-9'-]+){0,3})(?:, (?:the )?[a-z'-]+(?: [a-z'-]+){0,2})?";
const BASIC_LAND_TYPES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);
const ACTOR_CONTROLLER: Readonly<Record<string, 'you' | 'not_you' | 'any'>> = { you: 'you', 'an opponent': 'not_you', 'a player': 'any' };

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

function subjectCondition(subjectText: string, event: TriggerConditionIR['event'], extra: Partial<TriggerConditionIR> = {}): TriggerConditionIR | null {
  const trimmed = subjectText.trim();
  if (new RegExp('^' + SELF + '$').test(trimmed)) return selfCondition(event, extra);
  if (/\b(?:you|player|and|or)\b/.test(trimmed.replace(/ you control$| an opponent controls$/, ''))) return null;
  const parsed = parseBlockedSubjectClause(trimmed, event as any);
  if (!parsed) return null;
  return { ...parsed, event, ...extra } as TriggerConditionIR;
}

function withController(condition: TriggerConditionIR, controller: 'you' | 'not_you' | 'any'): TriggerConditionIR {
  return {
    ...condition,
    alternatives: condition.alternatives.map((alternative) => ({ ...alternative, controller })),
  } as TriggerConditionIR;
}

function basicLandSubject(subtype: string): TriggerConditionIR | null {
  const land = parseSubjectPhrase('a land', 'controls_none' as any);
  if (!land) return null;
  return {
    ...land,
    alternatives: land.alternatives.map((alternative) => ({
      ...alternative,
      subject: {
        ...alternative.subject,
        subtypeGroups: [[subtype]],
        groups: [{ types: ['land'], subtypes: [subtype] }],
      },
    })),
  } as TriggerConditionIR;
}

function result(condition: TriggerConditionIR | null, effect: string): Round8TriggerSentence | null {
  const trimmed = effect.trim();
  return condition && trimmed ? { condition, effect: trimmed } : null;
}

export function parseRound8TriggerSentence(text: string): Round8TriggerSentence | null {
  const faceUpSelf = new RegExp('^(?:whenever|when) ' + SELF + ' is turned face up,\\s*(.+)$').exec(text);
  if (faceUpSelf) return result(selfCondition('turned_face_up'), faceUpSelf[1]);
  const faceUp = /^(?:whenever|when) ((?:a|an|another) .+?) is turned face up,\s*(.+)$/.exec(text);
  if (faceUp) return result(subjectCondition(faceUp[1], 'turned_face_up'), faceUp[2]);

  const entersOrTransforms = new RegExp('^(?:whenever|when) ' + SELF + ' enters or transforms into ' + FACE_NAME + ',\\s*(.+)$').exec(text);
  if (entersOrTransforms) return result(selfCondition('enters', { pairedEvent: 'transforms' }), entersOrTransforms[1]);
  const transformsInto = new RegExp('^(?:whenever|when) ' + SELF + ' transforms into ' + FACE_NAME + ',\\s*(.+)$').exec(text);
  if (transformsInto) return result(selfCondition('transforms'), transformsInto[1]);

  const classLevel = /^(?:whenever|when) this class becomes level (\d+),\s*(.+)$/.exec(text);
  if (classLevel) return result(selfCondition('class_level', { classLevel: Number(classLevel[1]) }), classLevel[2]);

  const attachedTapped = /^(?:whenever|when) ((?:enchanted|equipped) [a-z]+) is tapped for mana,\s*(.+)$/.exec(text);
  if (attachedTapped) return result(subjectCondition(attachedTapped[1], 'tapped_for_mana'), attachedTapped[2]);
  const actorTaps = /^(?:whenever|when) (you|an opponent|a player) taps? (an? [a-z ]+?|another [a-z ]+?) for mana,\s*(.+)$/.exec(text);
  if (actorTaps) {
    const parsed = subjectCondition(actorTaps[2], 'tapped_for_mana');
    return result(parsed ? withController(parsed, ACTOR_CONTROLLER[actorTaps[1]] ?? 'any') : null, actorTaps[3]);
  }

  const controlsNone = /^(?:whenever|when) you control no ([a-z ]+?),\s*(.+)$/.exec(text);
  if (controlsNone) {
    const singular = controlsNone[1] === 'plains' ? 'plains' : controlsNone[1].replace(/ies$/, 'y').replace(/(?<!s)s$/, '');
    const parsed = BASIC_LAND_TYPES.has(singular) ? basicLandSubject(singular) : parseSubjectPhrase(`a ${singular}`, 'controls_none' as any);
    return result(parsed ? withController({ ...parsed, event: 'controls_none' } as TriggerConditionIR, 'you') : null, controlsNone[2]);
  }

  const scryOrSurveil = /^(?:whenever|when) (you|an opponent|a player) (?:scry or surveil|scries or surveils),\s*(.+)$/.exec(text);
  if (scryOrSurveil) {
    const parsed = parseSubjectPhrase('a permanent', 'performs');
    return result(parsed
      ? withController({ ...parsed, event: 'performs', action: 'scry|surveil' } as TriggerConditionIR, ACTOR_CONTROLLER[scryOrSurveil[1]] ?? 'any')
      : null, scryOrSurveil[2]);
  }

  const entersOrRoom = /^whenever ((?:a|an|another) .+?) enters(?: the battlefield)? and whenever you fully unlock a room,\s*(.+)$/.exec(text);
  if (entersOrRoom) return result(subjectCondition(entersOrRoom[1], 'enters', { pairedEvent: 'room_fully_unlocked' }), entersOrRoom[2]);

  const blocksCreature = new RegExp('^(?:whenever|when) ' + SELF + ' blocks a creature,\\s*(.+)$').exec(text);
  if (blocksCreature) return result(selfCondition('blocks'), blocksCreature[1]);

  const attacksYou = /^(?:whenever|when) ((?:a|an|another) .+?) attacks you or a planeswalker you control,\s*(.+)$/.exec(text);
  if (attacksYou) return result(subjectCondition(attacksYou[1], 'attacks', { attackedPlayer: 'you' }), attacksYou[2]);

  return null;
}
