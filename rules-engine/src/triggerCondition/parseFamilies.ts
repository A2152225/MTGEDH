/**
 * Family parsers for the trigger condition IR.
 * Public: parseEntersSubjectClause, parseAttacksSubjectClause, parseBlocksSubjectClause,
 *   parseBecomesTappedSubjectClause, parseBecomesUntappedSubjectClause,
 *   parseSpellCastClause, parsePhaseTriggerClause, parseTriggerEventSentence.
 *
 * Each returns null unless the clause is fully described. Callers keep their
 * existing filter for null.
 */

import { normalizeSelfNameInTriggerSentence } from './selfNameNormalize.js';
import { parseLateTriggerSentence } from './parseLateEvents.js';
import { parseSelfAndPlayerTriggerSentence } from './parseSelfAndPlayerEvents.js';
import { parseRound13TriggerSentence } from './parseRound13Events.js';
import { parseRound59DelayedTriggerSentence } from './parseRound59DelayedEvents.js';
import { parseRound14TriggerSentence } from './parseRound14Events.js';
import { parseRound15TriggerSentence } from './parseRound15Events.js';
import { parseRound16TriggerSentence } from './parseRound16Events.js';
import { parseRound37TrekTriggerSentence } from './parseRound37TrekEvents.js';
import { parseRound56TriggerSentence } from './parseRound56Events.js';
import { parseRound57TriggerSentence } from './parseRound57Events.js';
import { parseRound58TriggerSentence } from './parseRound58Events.js';
import { parseRound61TriggerSentence } from './parseRound61Events.js';
import { parseRound40BatchedTriggerSentence } from './parseRound40BatchedEvents.js';
import { normalizeTriggerClause, parseSubjectPhrase } from './parseSubjectPhrase.js';
import type { TriggerConditionEvent, TriggerConditionIR, TriggerWhoseTurn } from './types.js';
import { parseSpellCastClause } from './parseSpellCastClause.js';
import { parsePhaseTriggerClause } from './parsePhaseTriggerClause.js';
import { splitTriggerEffectRiders } from './parseTriggerRiders.js';
import type { ParsedTriggerClause, TriggerDelayedRider, TriggerReflexiveRider } from './parseTriggerRiders.js';
import { printedKeywordDeathAbilities } from './printedKeywordDeath.js';

export { parseSpellCastClause, parsePhaseTriggerClause, splitTriggerEffectRiders, printedKeywordDeathAbilities };
export type { ParsedTriggerClause, TriggerDelayedRider, TriggerReflexiveRider };

function withSource(
  parsed: TriggerConditionIR,
  source: TriggerConditionIR['alternatives'][number]['source'],
): TriggerConditionIR {
  return {
    ...parsed,
    alternatives: parsed.alternatives.map((alternative) => ({ ...alternative, source })),
  };
}

function parseAttachmentOrSubject(clause: string, event: TriggerConditionEvent): TriggerConditionIR | null {
  const normalized = normalizeTriggerClause(clause);
  const attachment = /^(enchanted|equipped)\s+(.+)$/.exec(normalized);
  if (!attachment) return parseSubjectPhrase(clause, event);
  const rest = attachment[2];
  const inner = parseSubjectPhrase(/^(?:a|an|the)\b/.test(rest) ? rest : `a ${rest}`, event);
  if (!inner) return null;
  return withSource(inner, attachment[1] as 'enchanted' | 'equipped');
}

function parseEntersLike(clause: string, event: TriggerConditionEvent): TriggerConditionIR | null {
  let text = normalizeTriggerClause(clause);
  let underYourControl = false;
  if (text.endsWith(' under your control')) {
    underYourControl = true;
    text = text.slice(0, -' under your control'.length).trim();
  }
  const parsed = parseAttachmentOrSubject(text, event);
  if (!parsed || !underYourControl) return parsed;
  return {
    ...parsed,
    alternatives: parsed.alternatives.map((alternative) => ({ ...alternative, controller: 'you' })),
  };
}

export function parseEntersSubjectClause(clause: string): TriggerConditionIR | null {
  return parseEntersLike(clause, 'enters');
}

export function parseAttacksSubjectClause(clause: string): TriggerConditionIR | null {
  return parseEntersLike(clause, 'attacks');
}

export function parseBlocksSubjectClause(clause: string): TriggerConditionIR | null {
  return parseEntersLike(clause, 'blocks');
}

/** Non-self "becomes blocked" / "attacks and isn't blocked" subjects, incl. enchanted/equipped. */
export function parseBlockedSubjectClause(
  clause: string,
  event: TriggerConditionEvent,
): TriggerConditionIR | null {
  return parseAttachmentOrSubject(clause, event);
}

export function parseBecomesTappedSubjectClause(clause: string): TriggerConditionIR | null {
  return parseAttachmentOrSubject(clause, 'becomes_tapped');
}

export function parseBecomesUntappedSubjectClause(clause: string): TriggerConditionIR | null {
  return parseAttachmentOrSubject(clause, 'becomes_untapped');
}

export interface ParsedTriggerEventSentence {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
}

function actorController(actor: string): 'you' | 'not_you' | 'any' {
  if (actor === 'you') return 'you';
  if (actor === 'an opponent') return 'not_you';
  return 'any';
}

function prepareSubjectPhrase(raw: string): string {
  let text = raw.replace(/\band\/or\b/gi, 'or').replace(/,(?=\s*non)/gi, '').replace(/\bcards?\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (text === 'one or more' || text.startsWith('one or more ')) {
    const rest = text.slice('one or more'.length).trim();
    const noun = rest === '' || rest === 'a' || rest === 'an' ? 'permanent' : rest;
    const article = /^(?:a|an|this|another|other)\b/.test(noun) ? noun : `a ${noun}`;
    return `one or more ${article}`;
  }
  if (text === '' || text === 'a' || text === 'an') return 'a permanent';
  if (text === '~') return 'this permanent';
  if (text === 'this' || text === 'that') return 'this permanent';
  if (text === 'another' || text === 'other') return 'another permanent';
  if (!/^(?:a|an|this|another|other|enchanted|equipped)\b/.test(text)) return `a ${text}`;
  return text;
}

function withController(condition: TriggerConditionIR, controller: 'you' | 'not_you' | 'any'): TriggerConditionIR {
  return {
    ...condition,
    alternatives: condition.alternatives.map((alternative) => ({ ...alternative, controller })),
  };
}

function parseActorTrigger(actor: string, verb: string, rest: string): ParsedTriggerEventSentence | null {
  const controller = actorController(actor);
  const effectOf = (effect: string): string => effect.trim();
  if (/^search|^shuffle/.test(verb)) {
    const library = /^(their|your|a|his or her)\s+library(?: for an? cards?)?,\s*(.+)$/.exec(rest.trim());
    if (!library) return null;
    const event = verb.startsWith('search') ? 'searches_library' : 'shuffles_library';
    const subject = parseSubjectPhrase('a permanent', event);
    const effect = effectOf(library[2]);
    if (!subject || !effect) return null;
    const libraryOwner = library[1] === 'your' ? 'source' : library[1] === 'a' ? 'any' : 'subject';
    return {
      condition: { ...withController(subject, controller), libraryOwner },
      effect,
    };
  }
  if (/^pay/.test(verb)) {
    const pay = /^life,\s*(.+)$/.exec(rest.trim());
    if (!pay) return null;
    const subject = parseSubjectPhrase('a permanent', 'pays_life');
    const effect = effectOf(pay[1]);
    if (!subject || !effect) return null;
    return { condition: withController(subject, controller), effect };
  }
  if (/^create/.test(verb)) {
    const sacrificeOr = /^or sacrifice\s+(.+?),\s*(.+)$/.exec(rest.trim());
    if (sacrificeOr) {
      const subject = parseSubjectPhrase(prepareSubjectPhrase(sacrificeOr[1]), 'creates_token');
      const effect = effectOf(sacrificeOr[2]);
      if (!subject || !effect) return null;
      return { condition: { ...withController(subject, controller), pairedEvent: 'sacrifices' }, effect };
    }
    const firstTime = /\s+for the first time each turn,/.test(rest);
    const createdBody = firstTime ? rest.replace(/\s+for the first time each turn,/, ',') : rest;
    const created = /^(.+?),\s*(.+)$/.exec(createdBody);
    if (!created) return null;
    const subject = parseSubjectPhrase(prepareSubjectPhrase(created[1]), 'creates_token');
    const effect = effectOf(created[2]);
    if (!subject || !effect) return null;
    const condition = withController(subject, controller);
    return { condition: firstTime ? { ...condition, onceEachTurn: true } : condition, effect };
  }
  return null;
}

const PAIRED_EVENT_WORD: Readonly<Record<string, TriggerConditionEvent>> = {
  enters: 'enters', attacks: 'attacks', blocks: 'blocks', dies: 'dies',
};

/**
 * "Whenever this creature enters or attacks, ..." / "attacks or blocks" / "enters or dies":
 * one self-subject trigger listening to two events (pairedEvent). Only self subjects, so
 * "a creature enters or attacks" stays with its own families.
 */
function parseSelfPairedEventSentence(text: string): ParsedTriggerEventSentence | null {
  const m = /^(?:whenever|when)\s+(this (?:creature|permanent|vehicle|artifact|enchantment))\s+(enters|attacks|blocks)(?: the battlefield)? or (attacks|blocks|dies)\s*,\s*(.+)$/.exec(text);
  if (!m || m[2] === m[3]) return null;
  const first = parseTriggerEventSentence(`when ${m[1]} ${m[2]}, ${m[4]}`);
  const pairedEvent = PAIRED_EVENT_WORD[m[3]];
  if (!first || !pairedEvent) return null;
  return { ...first, condition: { ...first.condition, pairedEvent } };
}

/**
 * "Whenever a Goblin you control dies, you gain 1 life."
 * Null when the subject is outside the condition record.
 */
export function parseTriggerEventSentence(sentence: string): ParsedTriggerEventSentence | null {
  // Rounds 61-65 (chained 62->63->64->65) refine or promote what the older families parse, but they
  // must never re-label the event of an older, more specific parse (combat damage collapsed to
  // deals_damage, dies/enters swapped). Same event: the newer round wins (it adds qualifiers);
  // different event: the older family keeps it; older null or legacyRuntimeOnly: promote.
  const older = parseTriggerEventSentenceOlder(sentence);
  const chained = parseRound61TriggerSentence(
    normalizeTriggerClause(sentence).replace(/\.+$/, '').trim(),
    parseTriggerEventSentence as any,
  );
  if (!chained) return older;
  if (!older || (older.condition as any).legacyRuntimeOnly) return chained;
  return chained.condition.event === older.condition.event ? chained : older;
}

function parseTriggerEventSentenceOlder(sentence: string): ParsedTriggerEventSentence | null {
  const text = normalizeTriggerClause(sentence).replace(/\.+$/, '').trim();
  const paired = parseSelfPairedEventSentence(text);
  if (paired) return paired;
  const round59d = parseRound59DelayedTriggerSentence(text, parseTriggerEventSentence as any);
  if (round59d) return round59d;
  const round13 = parseRound13TriggerSentence(text, parseTriggerEventSentence as any);
  if (round13) return round13;
  const round14 = parseRound14TriggerSentence(text, parseTriggerEventSentence as any);
  if (round14) return round14;
  const round15 = parseRound15TriggerSentence(text, parseTriggerEventSentence as any);
  if (round15) return round15;
  const round16 = parseRound16TriggerSentence(text, parseTriggerEventSentence as any);
  if (round16) return round16;
  const round56 = parseRound56TriggerSentence(text, parseTriggerEventSentence as any);
  if (round56) return round56;
  const round57 = parseRound57TriggerSentence(text, parseTriggerEventSentence as any);
  if (round57) return round57;
  const round58 = parseRound58TriggerSentence(text, parseTriggerEventSentence as any);
  if (round58) return round58;
  const round37 = parseRound37TrekTriggerSentence(text, parseTriggerEventSentence as any);
  if (round37) return round37;
  const match = /^(?:whenever|when)\s+(.+?)\s+(dies|enters(?: the battlefield)?(?: under your control)?|attacks|blocks|becomes tapped|becomes untapped)\s*,\s*(.+)$/.exec(text)
    // Plural verbs only with a batched subject ("one or more tokens you control enter").
    ?? /^(?:whenever|when)\s+(one or more .+?)\s+(enter(?: the battlefield)?(?: under your control)?|attack)\s*,\s*(.+)$/.exec(text);
  if (!match) {
    const endStepOnYourNextTurn = /^(?:at the beginning of the end step on your next turn),\s*(.+)$/.exec(text);
    if (endStepOnYourNextTurn) {
      const condition = parsePhaseTriggerClause('at the beginning of the end step');
      if (condition) return { condition: { ...condition, whoseTurn: 'you', delayedNextTurn: true, delayedRider: true } as any, effect: endStepOnYourNextTurn[1].trim() };
    }
    const thatPlayerNextEnd = /^(?:at the beginning of that player's next end step),\s*(.+)$/.exec(text);
    if (thatPlayerNextEnd) {
      const condition = parsePhaseTriggerClause('at the beginning of the end step');
      if (condition) return { condition: { ...condition, whoseTurn: 'that_player', delayedNextTurn: true, delayedRider: true } as any, effect: thatPlayerNextEnd[1].trim() };
    }
    const yourNextEnd = /^(?:at the beginning of your next end step),\s*(.+)$/.exec(text);
    if (yourNextEnd) {
      const condition = parsePhaseTriggerClause('at the beginning of the end step');
      if (condition) return { condition: { ...condition, whoseTurn: 'you', delayedNextTurn: true, delayedRider: true } as any, effect: yourNextEnd[1].trim() };
    }
    const phaseSentence = /^at the beginning of ([^,]+),\s*(.+)$/.exec(text);
    if (phaseSentence) {
      const condition = parsePhaseTriggerClause(`at the beginning of ${phaseSentence[1].trim()}`);
      const effect = phaseSentence[2].trim();
      if (condition && effect) return { condition, effect };
    }
    const shaken = /^(?:whenever|when)\s+enchanted player casts a spell other than the first spell they cast each turn or copies a spell,\s*(.+)$/i.exec(text);
    if (shaken) {
      const condition = parseSpellCastClause('enchanted player casts a spell');
      const effect = shaken[1].trim();
      if (condition && effect) {
        return {
          condition: { ...condition, excludeFirstSpellEachTurn: true, orSpellCopy: true },
          effect,
        };
      }
    }
    const castOrActivateOnly = /^(?:whenever|when)\s+you cast (an? .+?) that targets only (~|this creature|this permanent|[A-Z][^,]+?) or activate an ability that targets only \2,\s*(.+)$/.exec(text);
    if (castOrActivateOnly) {
      const condition = parseSpellCastClause('you cast ' + castOrActivateOnly[1] + ' that targets only ' + castOrActivateOnly[2]);
      if (condition) {
        return {
          condition: { ...condition, pairedEvent: 'performs', action: 'activate_targeting', targets: 'self_only' },
          effect: castOrActivateOnly[3].trim(),
        };
      }
    }
  const isCast = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) cast( during your turn)?,\s*(.+)$/.exec(text);
    if (isCast) {
      const condition = parseSpellCastClause(('a player casts ' + isCast[1] + (isCast[2] || '')).replace(/\s+/g, ' ').trim());
      if (condition) return { condition, effect: isCast[3].trim() };
    }
    const castSentence = /^(?:whenever|when)\s+((?:you cast|an opponent casts|a player casts|enchanted player casts)\b.+?),\s*(.+)$/.exec(text);
    if (castSentence) {
      const condition = parseSpellCastClause(castSentence[1]);
      const effect = castSentence[2].trim();
      if (condition && effect) return { condition, effect };
    }
    const firstCombatEnd = /^(at (?:the )?end of the first combat phase on your turn),\s*(.+)$/.exec(text);
    if (firstCombatEnd) {
      const condition = parsePhaseTriggerClause('at the end of combat on your turn');
      const effect = firstCombatEnd[2].trim();
      if (condition && effect) return { condition: { ...condition, firstCombat: true } as any, effect };
    }
    const endCombat = /^(at (?:the )?end of combat(?: on your turn)?),\s*(.+)$/.exec(text);
    if (endCombat) {
      const condition = parsePhaseTriggerClause(endCombat[1]);
      const effect = endCombat[2].trim();
      if (condition && effect) return { condition, effect };
    }
    const opponentsEachLose = /^(?:whenever|when)\s+one or more opponents each lose exactly (\d+) life,\s*(.+)$/.exec(text);
    if (opponentsEachLose) {
      return {
        condition: {
          event: 'loses_life' as const,
          quantity: 'one_or_more' as const,
          lifeAmount: Number(opponentsEachLose[1]),
          exactLife: true,
          eachOpponent: true,
          alternatives: [{ controller: 'not_you' as const, source: 'any' as const, subject: { anyObject: true, typeGroups: [], subtypeGroups: [], excludedWords: [], supertypes: [], keywordsWith: [], keywordsWithout: [], token: 'any' as const } }],
        } as any,
        effect: opponentsEachLose[2].trim(),
      };
    }
    const loseExactly = /^(?:whenever|when)\s+(you|an opponent|a player)\s+loses? exactly (\d+) life,\s*(.+)$/.exec(text);
    if (loseExactly) {
      const controller = loseExactly[1] === 'you' ? 'you' : loseExactly[1] === 'an opponent' ? 'not_you' : 'any';
      return {
        condition: {
          event: 'loses_life' as const,
          quantity: 'one' as const,
          lifeAmount: Number(loseExactly[2]),
          exactLife: true,
          alternatives: [{ controller, source: 'any' as const, subject: { anyObject: true, typeGroups: [], subtypeGroups: [], excludedWords: [], supertypes: [], keywordsWith: [], keywordsWithout: [], token: 'any' as const } }],
        } as any,
        effect: loseExactly[3].trim(),
      };
    }
    const life = /^(?:whenever|when)\s+(you|an opponent|a player)\s+(gains?|loses?)\s+life(?: during your turn)?,\s*(.+)$/.exec(text);
    if (life) {
      const controller = life[1] === 'you' ? 'you' : life[1] === 'an opponent' ? 'not_you' : 'any';
      const event = /gain/.test(life[2]) ? 'gains_life' : 'loses_life';
      const whoseTurn = / during your turn,/.test(text) ? 'you' as const : undefined;
      const effect = life[3].trim();
      if (effect) {
        return {
          condition: {
            event,
            ...(whoseTurn ? { whoseTurn } : {}),
            quantity: 'one',
            alternatives: [{
              controller,
              source: 'any',
              subject: {
                anyObject: true,
                typeGroups: [],
                subtypeGroups: [],
                excludedWords: [],
                supertypes: [],
                keywordsWith: [],
                keywordsWithout: [],
                token: 'any',
              },
            }],
          },
          effect,
        };
      }
    }
    const sacrifice = /^(?:whenever|when)\s+(you|an opponent|a player)\s+sacrifices?\s+(.+?),\s*(.+)$/.exec(text);
    if (sacrifice) {
      const controller = sacrifice[1] === 'you' ? 'you' : sacrifice[1] === 'an opponent' ? 'not_you' : 'any';
      let subjectText = sacrifice[2].trim();
      let whoseTurn: TriggerConditionIR['whoseTurn'] | undefined;
      if (/\s+during your turn\b/.test(subjectText)) {
        whoseTurn = 'you';
        subjectText = subjectText.replace(/\s+during your turn\b/, '').trim();
      }
      const subject = parseSubjectPhrase(subjectText, 'sacrifices');
      const effect = sacrifice[3].trim();
      if (subject && effect) {
        return {
          condition: {
            ...subject,
            event: 'sacrifices',
            ...(whoseTurn ? { whoseTurn } : {}),
            alternatives: subject.alternatives.map((alternative) => ({ ...alternative, controller })),
          },
          effect,
        };
      }
    }
    const playerAction = /^(?:whenever|when)\s+(you|an opponent|a player)\s+(draws?|discards?|mills?)\s+(.+?),\s*(.+)$/.exec(text);
    if (playerAction) {
      const controller = playerAction[1] === 'you' ? 'you' : playerAction[1] === 'an opponent' ? 'not_you' : 'any';
      const verb = playerAction[2];
      const event = /draw/.test(verb) ? 'draws_card' : /discard/.test(verb) ? 'discards' : 'mills';
      let onceEachTurnDiscard = false;
      let playerActionObject = playerAction[3];
      if (/\s+for the first time each turn$/.test(playerActionObject)) {
        onceEachTurnDiscard = true;
        playerActionObject = playerActionObject.replace(/\s+for the first time each turn$/, '').trim();
      }
      const rawObjectText = playerActionObject.replace(/\s+cards?\b/g, '').replace(/\bcards?\b/g, 'permanent').replace(/\s+/g, ' ').trim();
      // "one or more cards" / "one or more land cards": batched (one trigger per event).
      const oneOrMore = /^one or more\b/.test(rawObjectText);
      const objectText = oneOrMore ? `a ${rawObjectText.slice('one or more'.length).trim()}`.trim() : rawObjectText;
      const parsedSubject = parseSubjectPhrase(
        objectText === '' || objectText === 'a' || objectText === 'an' ? 'a permanent' : objectText,
        event,
      );
      const subject = parsedSubject && oneOrMore ? { ...parsedSubject, quantity: 'one_or_more' as const } : parsedSubject;
      const effect = playerAction[4].trim();
      if (subject && effect) {
        return {
          condition: {
            ...subject,
            event,
            alternatives: subject.alternatives.map((alternative) => ({ ...alternative, controller })),
            ...(onceEachTurnDiscard ? { onceEachTurn: true } : {}),
          },
          effect,
        };
      }
    }
    const combatDamage = /^(?:whenever|when)\s+(.+?)\s+deals? combat damage to (a player|an opponent|you|a creature),\s*(.+)$/.exec(text);
    if (combatDamage) {
      const toCreature = combatDamage[2] === 'a creature';
      // Only attacking creatures deal combat damage to players, so "an attacking creature" is just "a creature" there (Harsh Justice).
      const attackingCombatSubject = toCreature ? combatDamage[1] : combatDamage[1].replace(/^an? attacking\s+/, 'a ');
      const subject = parseAttachmentOrSubject(attackingCombatSubject, toCreature ? 'deals_combat_damage_to_creature' : 'deals_combat_damage_to_player');
      const effect = combatDamage[3].trim();
      if (subject && effect) return { condition: combatDamage[2] === 'you' ? { ...subject, damagedPlayer: 'you' as const } : subject, effect };
    }
    const kindCounterPlaced = /^(?:whenever|when)\s+(an?|one or more) ([a-z][a-z0-9/-]*) counters? (?:is|are) put on\s+(.+?),\s*(.+)$/.exec(text);
    if (kindCounterPlaced && !/^(?:\+1\/\+1|-[0-9]+\/-[0-9]+|loyalty|time|lore|counter)$/.test(kindCounterPlaced[2])) {
      const subject = parseSubjectPhrase(prepareSubjectPhrase(kindCounterPlaced[3]), 'counter_placed');
      const effect = kindCounterPlaced[4].trim();
      if (subject && effect) {
        return { condition: { ...subject, event: 'counter_placed', placedCounter: kindCounterPlaced[2], ...(kindCounterPlaced[1].startsWith('one') ? { quantity: 'one_or_more' as const } : {}) }, effect };
      }
    }
    const counterPlaced = /^(?:whenever|when)\s+(a \+1\/\+1 counter|one or more \+1\/\+1 counters|a -[0-9]+\/-[0-9]+ counter|one or more -[0-9]+\/-[0-9]+ counters|a loyalty counter|one or more loyalty counters|a time counter|one or more time counters|a lore counter|one or more lore counters|a counter|one or more counters)\s+(?:is|are) put on\s+(.+?),\s*(.+)$/.exec(text);
    if (counterPlaced) {
      const placedCounter = counterPlaced[1].includes('+1/+1') ? '+1/+1' : /loyalty/.test(counterPlaced[1]) ? 'loyalty' : /time/.test(counterPlaced[1]) ? 'time' : /lore/.test(counterPlaced[1]) ? 'lore' : /-[0-9]+\/-[0-9]+/.test(counterPlaced[1]) ? '-1/-1' : 'any';
      const subject = parseSubjectPhrase(prepareSubjectPhrase(counterPlaced[2]), 'counter_placed');
      const effect = counterPlaced[3].trim();
      if (subject && effect) {
        return { condition: { ...subject, event: 'counter_placed', placedCounter }, effect };
      }
    }
    const actor = /^(?:whenever|when)\s+(you|an opponent|a player)\s+(search(?:es)?|shuffles?|pays?|creates?)\s+(.+)$/.exec(text);
    if (actor) return parseActorTrigger(actor[1], actor[2], actor[3]);
    const createdPassive = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) created( under your control)?,\s*(.+)$/.exec(text);
    if (createdPassive) {
      const subject = parseSubjectPhrase(prepareSubjectPhrase(createdPassive[1]), 'creates_token');
      const effect = createdPassive[3].trim();
      if (!subject || !effect) return null;
      return {
        condition: createdPassive[2] ? withController(subject, 'you') : subject,
        effect,
      };
    }
    const counterRemoved = /^(?:whenever|when)\s+(a \+1\/\+1 counter|one or more \+1\/\+1 counters|a counter|one or more counters)\s+(?:is|are) removed from\s+(.+?),\s*(.+)$/.exec(text);
    if (counterRemoved) {
      const placedCounter = counterRemoved[1].includes('+1/+1') ? '+1/+1' : 'any';
      const subject = parseSubjectPhrase(counterRemoved[2], 'counter_removed');
      const effect = counterRemoved[3].trim();
      if (subject && effect) return { condition: { ...subject, event: 'counter_removed', placedCounter }, effect };
    }
    const exile = /^(?:whenever|when)\s+(.+?)\s+is exiled(?: from (the battlefield|anywhere|your graveyard|a graveyard|your hand|your library))?,\s*(.+)$/.exec(text);
    if (exile) {
      const fromZone = exile[2] === 'anywhere'
        ? 'anywhere'
        : exile[2] === 'your graveyard' || exile[2] === 'a graveyard'
          ? 'graveyard'
          : exile[2] === 'your hand'
            ? 'hand'
            : exile[2] === 'your library'
              ? 'library'
              : 'battlefield';
      const subject = parseSubjectPhrase(prepareSubjectPhrase(exile[1]), 'exiled');
      const effect = exile[3].trim();
      if (subject && effect) return { condition: { ...subject, event: 'exiled', fromZone }, effect };
    }
    const graveyard = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) put into (?:(your|a|an opponent's|a player's) )?graveyards?(?: from (anywhere|the battlefield|your library|their library|your hand))?,\s*(.+)$/.exec(text);
    if (graveyard) {
      const subject = parseSubjectPhrase(prepareSubjectPhrase(graveyard[1]), 'put_into_graveyard');
      const effect = graveyard[4].trim();
      if (!subject || !effect) return null;
      const zoneOwner = graveyard[2] === 'your' ? 'you' : graveyard[2] === "an opponent's" ? 'not_you' : 'any';
      const fromRaw = graveyard[3] || 'anywhere';
      return {
        condition: {
          ...subject,
          event: 'put_into_graveyard',
          fromZone: fromRaw === 'the battlefield'
            ? 'battlefield'
            : fromRaw === 'your library' || fromRaw === 'their library'
              ? 'library'
              : fromRaw === 'your hand'
                ? 'hand'
                : 'anywhere',
          zoneOwner,
        },
        effect,
      };
    }
    const leftGraveyard = /^(?:whenever|when)\s+(.+?)\s+(?:leaves|leave) (your|a|an opponent's) graveyard(?: during your turn)?,\s*(.+)$/.exec(text);
    if (leftGraveyard) {
      const subject = parseSubjectPhrase(prepareSubjectPhrase(leftGraveyard[1]), 'left_graveyard');
      const effect = leftGraveyard[3].trim();
      if (!subject || !effect) return null;
      const zoneOwner = leftGraveyard[2] === 'your' ? 'you' : leftGraveyard[2] === "an opponent's" ? 'not_you' : 'any';
      const duringYourTurn = /\sduring your turn,/.test(text);
      return { condition: { ...subject, event: 'left_graveyard', zoneOwner, ...(duringYourTurn ? { whoseTurn: 'you' as const } : {}) }, effect };
    }
    return parseLateTriggerSentence(text) ?? parseSelfAndPlayerTriggerSentence(text);
  }
  const subject = match[1].trim();
  const eventWord = match[2];
  const effect = match[3].trim();
  if (!subject || !effect) return null;

  const underYourControl = /under your control$/.test(eventWord);
  const eventKind = eventWord.startsWith('enter')
    ? 'enters'
    : eventWord.startsWith('attack')
      ? 'attacks'
      : eventWord.startsWith('blocks')
        ? 'blocks'
        : eventWord === 'becomes tapped'
          ? 'becomes_tapped'
          : eventWord === 'becomes untapped'
            ? 'becomes_untapped'
            : 'dies';
  const subjectText = underYourControl ? `${subject} under your control` : subject;
  const condition = eventKind === 'enters'
    ? parseEntersSubjectClause(subjectText)
    : eventKind === 'attacks'
      ? parseAttacksSubjectClause(subjectText)
      : eventKind === 'blocks'
        ? parseBlocksSubjectClause(subjectText)
        : eventKind === 'becomes_tapped'
          ? parseBecomesTappedSubjectClause(subjectText)
          : eventKind === 'becomes_untapped'
            ? parseBecomesUntappedSubjectClause(subjectText)
            : parseAttachmentOrSubject(subjectText, 'dies');
  if (!condition) return null;
  return { condition, effect };
}

/** "Landfall — Whenever ...": an ability word labels the trigger and is not part of it. */
const ABILITY_WORD_PREFIX = /^\s*(?:[\d,]+\s+)?[a-z][a-z' ]{0,40}?\s+(?:\u2014|--?)\s+(?=(?:when|whenever|at)\b)/i;

export function parseTriggerClause(sentence: string, cardName?: string): ParsedTriggerClause | null {
  const unlabeled = String(sentence || '').replace(ABILITY_WORD_PREFIX, '');
  const selfNormalized = cardName ? normalizeSelfNameInTriggerSentence(unlabeled, cardName) : unlabeled;
  const parsed = parseTriggerEventSentence(selfNormalized)
    ?? parseRound40BatchedTriggerSentence(normalizeTriggerClause(selfNormalized), parseTriggerEventSentence as any);
  if (!parsed) return null;
  return { condition: parsed.condition, ...splitTriggerEffectRiders(parsed.effect) };
}
