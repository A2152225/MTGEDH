/**
 * Round 6 trigger wordings: attacks alone, battalion, becomes the target, deals damage, commit a crime.
 * Origin parent: parseSelfAndPlayerEvents.ts parseSelfAndPlayerTriggerSentence.
 * Public: parseRound6TriggerSentence.
 *
 * attacks_alone / attacks_in_group need context.attackerCount; becomes_target needs
 * context.targetingControllerId + targetingKind; deals_damage recipients need
 * context.damageRecipientPlayerId / damageRecipientIsCreature. All fail closed without them.
 */

import { parseBlockedSubjectClause } from './parseFamilies.js';
import { parseSubjectPhrase } from './parseSubjectPhrase.js';
import type { TriggerConditionIR } from './types.js';

export interface Round6TriggerSentence {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
}

const SELF_SUBJECT = /^(?:this (?:creature|permanent|card|artifact|enchantment|vehicle)|~|it)$/;
const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4 };
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
  if (SELF_SUBJECT.test(trimmed)) return selfCondition(event, extra);
  if (/^a source(?: you control| an opponent controls)?$/.test(trimmed)) {
    const parsed = parseSubjectPhrase(trimmed.replace(/^a source/, 'a permanent'), event);
    return parsed ? { ...parsed, event, ...extra } as TriggerConditionIR : null;
  }
  if (/\b(?:you|player|and)\b/.test(trimmed.replace(/ you control$| an opponent controls$/, ''))) return null;
  const parsed = parseBlockedSubjectClause(trimmed, event as any);
  if (!parsed) return null;
  return { ...parsed, event, ...extra } as TriggerConditionIR;
}

/** "you" as the event subject: matched against a player pseudo-subject (context.subjectIsPlayer). */
function playerSubjectCondition(event: TriggerConditionIR['event'], extra: Partial<TriggerConditionIR> = {}): TriggerConditionIR {
  const base = selfCondition(event, extra);
  return { ...base, playerSubject: true, alternatives: base.alternatives.map((alternative) => ({ ...alternative, controller: 'you', source: 'any' })) } as TriggerConditionIR;
}

const TARGET_KIND: Readonly<Record<string, 'spell' | 'ability' | 'spell_or_ability'>> = {
  'a spell or ability': 'spell_or_ability',
  'a spell': 'spell',
  'an ability': 'ability',
};

export function parseRound6TriggerSentence(text: string): Round6TriggerSentence | null {
  const alone = /^(?:whenever|when)\s+(.+?)\s+attacks alone,\s*(.+)$/.exec(text);
  if (alone) {
    const condition = subjectCondition(alone[1], 'attacks_alone');
    return condition ? { condition, effect: alone[2].trim() } : null;
  }

  const battalion = /^whenever\s+(.+?)\s+(?:and at least (one|two|three|four) other creatures? attack|attacks and at least (one|two|three|four) other creatures? attack),\s*(.+)$/.exec(text);
  if (battalion) {
    const others = NUMBER_WORDS[battalion[2] || battalion[3]];
    if (!SELF_SUBJECT.test(battalion[1].trim()) || !others) return null;
    return { condition: selfCondition('attacks_in_group', { minOtherAttackers: others } as Partial<TriggerConditionIR>), effect: battalion[4].trim() };
  }

  const targeted = /^(?:whenever|when)\s+(.+?)\s+becomes? the target of (a spell or ability|a spell|an ability)( an opponent controls| you control)?( for the first time each turn)?,\s*(.+)$/.exec(text);
  if (targeted) {
    const kind = TARGET_KIND[targeted[2]];
    const by = targeted[3] === ' an opponent controls' ? 'not_you' : targeted[3] === ' you control' ? 'you' : 'any';
    const extra: Partial<TriggerConditionIR> = {
      targetedBy: { controller: by, kind },
      ...(targeted[4] ? { onceEachTurn: true } : {}),
    } as Partial<TriggerConditionIR>;
    const condition = targeted[1].trim() === 'you'
      ? playerSubjectCondition('becomes_target', extra)
      : subjectCondition(targeted[1], 'becomes_target', extra);
    return condition ? { condition, effect: targeted[5].trim() } : null;
  }

  const damage = /^(?:whenever|when)\s+(.+?)\s+deals (noncombat )?damage( to an opponent| to a player| to a creature)?,\s*(.+)$/.exec(text);
  if (damage) {
    const recipient = damage[3] === ' to an opponent' ? 'opponent' : damage[3] === ' to a player' ? 'player' : damage[3] === ' to a creature' ? 'creature' : 'any';
    const extra: Partial<TriggerConditionIR> = {
      damageRecipient: recipient,
      ...(damage[2] ? { damageKind: 'noncombat' } : {}),
    } as Partial<TriggerConditionIR>;
    const condition = subjectCondition(damage[1], 'deals_damage', extra);
    return condition ? { condition, effect: damage[4].trim() } : null;
  }

  const crime = /^whenever (you|an opponent|a player) commits? a crime,\s*(.+)$/.exec(text);
  if (crime) {
    const subject = parseSubjectPhrase('a permanent', 'commits_crime');
    if (!subject) return null;
    const controller = ACTOR_CONTROLLER[crime[1]];
    return {
      condition: { ...subject, event: 'commits_crime', alternatives: subject.alternatives.map((alternative) => ({ ...alternative, controller })) },
      effect: crime[2].trim(),
    };
  }
  return null;
}
