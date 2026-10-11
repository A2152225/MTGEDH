/**
 * Family parsers for the trigger condition IR.
 * Public: parseEntersSubjectClause, parseAttacksSubjectClause, parseBlocksSubjectClause,
 *   parseBecomesTappedSubjectClause, parseBecomesUntappedSubjectClause,
 *   parseSpellCastClause, parsePhaseTriggerClause, parseTriggerEventSentence.
 *
 * Each returns null unless the clause is fully described. Callers keep their
 * existing filter for null.
 */

import { parseLateTriggerSentence } from './parseLateEvents.js';
import { normalizeTriggerClause, parseSubjectPhrase } from './parseSubjectPhrase.js';
import type { TriggerConditionEvent, TriggerConditionIR, TriggerWhoseTurn } from './types.js';

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

export function parseBecomesTappedSubjectClause(clause: string): TriggerConditionIR | null {
  return parseAttachmentOrSubject(clause, 'becomes_tapped');
}

export function parseBecomesUntappedSubjectClause(clause: string): TriggerConditionIR | null {
  return parseAttachmentOrSubject(clause, 'becomes_untapped');
}

/**
 * "you cast a creature spell from exile", "an opponent casts a noncreature spell
 * that targets you", "you cast your first spell each turn".
 */
export function parseSpellCastClause(clause: string): TriggerConditionIR | null {
  let text = normalizeTriggerClause(clause);
  if (!text || /\b(?:this|whenever|when|commander|chosen|historic|colorless|with|without|power|where|unless|~)\b/.test(text)) {
    return null;
  }

  let controller: TriggerConditionIR['alternatives'][number]['controller'] = 'any';
  if (text.startsWith('you cast ')) {
    controller = 'you';
    text = text.slice('you cast '.length);
  } else if (text.startsWith('an opponent casts ')) {
    controller = 'not_you';
    text = text.slice('an opponent casts '.length);
  } else if (text.startsWith('a player casts ')) {
    text = text.slice('a player casts '.length);
  } else {
    return null;
  }

  let ordinal: TriggerConditionIR['ordinal'];
  const ordinalMatch = /^(?:your|their) (first|second)\s+/.exec(text);
  if (ordinalMatch) {
    ordinal = ordinalMatch[1] as 'first' | 'second';
    text = text.slice(ordinalMatch[0].length);
  }
  text = text.replace(/\beach turn\b/, ' ').replace(/\s+/g, ' ').trim();

  let castFromZone: TriggerConditionIR['castFromZone'];
  const fromZone = / from (hand|graveyard|exile|library)\b/.exec(text);
  if (fromZone) {
    castFromZone = fromZone[1] as TriggerConditionIR['castFromZone'];
    text = text.replace(fromZone[0], ' ').replace(/\s+/g, ' ').trim();
  } else if (/ from anywhere other than (?:your |their )?hand\b/.test(text)) {
    castFromZone = 'not_hand';
    text = text.replace(/ from anywhere other than (?:your |their )?hand\b/, ' ').replace(/\s+/g, ' ').trim();
  }

  let targets: TriggerConditionIR['targets'];
  if (/\bthat targets you\b/.test(text)) {
    targets = 'you';
    text = text.replace(/\bthat targets you\b/, ' ').replace(/\s+/g, ' ').trim();
  } else if (/\bthat targets an opponent\b/.test(text)) {
    targets = 'opponent';
    text = text.replace(/\bthat targets an opponent\b/, ' ').replace(/\s+/g, ' ').trim();
  }

  text = text.replace(/\s+spells?$/, '').replace(/^spells?$/, '').trim();
  const subjectText = text === '' || text === 'a' || text === 'an' ? 'a permanent' : text;
  const parsed = parseSubjectPhrase(subjectText, 'spell_cast')
    ?? parseSubjectPhrase(`${subjectText} permanent`, 'spell_cast');
  if (!parsed) return null;

  return {
    ...parsed,
    event: 'spell_cast',
    ...(castFromZone ? { castFromZone } : {}),
    ...(ordinal ? { ordinal } : {}),
    ...(targets ? { targets } : {}),
    alternatives: parsed.alternatives.map((alternative) => ({ ...alternative, controller })),
  };
}

const PHASE_EVENT: Readonly<Record<string, TriggerConditionEvent>> = {
  upkeep: 'beginning_of_upkeep',
  'draw step': 'beginning_of_draw_step',
  combat: 'beginning_of_combat',
  'end step': 'beginning_of_end_step',
};

export function parsePhaseTriggerClause(clause: string): TriggerConditionIR | null {
  const text = normalizeTriggerClause(clause);
  const exact: Record<string, { event: TriggerConditionEvent; whoseTurn: TriggerWhoseTurn }> = {
    'at the beginning of combat on your turn': { event: 'beginning_of_combat', whoseTurn: 'you' },
    'the beginning of combat on your turn': { event: 'beginning_of_combat', whoseTurn: 'you' },
    'at the beginning of your precombat main phase': { event: 'beginning_of_precombat_main', whoseTurn: 'you' },
    'at the beginning of your first main phase': { event: 'beginning_of_precombat_main', whoseTurn: 'you' },
    'at the beginning of your postcombat main phase': { event: 'beginning_of_postcombat_main', whoseTurn: 'you' },
    'at the beginning of your second main phase': { event: 'beginning_of_postcombat_main', whoseTurn: 'you' },
    'at the beginning of each of your main phases': { event: 'each_of_your_main_phases', whoseTurn: 'you' },
    'at end of combat': { event: 'end_of_combat', whoseTurn: 'each_player' },
    'at the end of combat': { event: 'end_of_combat', whoseTurn: 'each_player' },
    'at end of combat on your turn': { event: 'end_of_combat', whoseTurn: 'you' },
    'at the end of combat on your turn': { event: 'end_of_combat', whoseTurn: 'you' },
  };
  const known = exact[text];
  if (known) {
    return { event: known.event, quantity: 'one', whoseTurn: known.whoseTurn, alternatives: [] };
  }
  if (/^at the beginning of the upkeep of enchanted (?:creature|land|enchantment|permanent|artifact)'s controller$/.test(text)) {
    return { event: 'beginning_of_upkeep', quantity: 'one', whoseTurn: 'enchanted_controller', alternatives: [] };
  }
  if (/^at the beginning of the upkeep of the exiled card's owner$/.test(text)) {
    return { event: 'beginning_of_upkeep', quantity: 'one', whoseTurn: 'exiled_card_owner', alternatives: [] };
  }
  const match = /^(?:at the beginning of )?(your|each player's|each opponent's|each|enchanted player's|the monarch's|the chosen player's) (upkeep|draw step|combat|end step)$/.exec(text);
  if (!match) return null;
  const event = PHASE_EVENT[match[2]];
  if (!event) return null;
  const whoseTurn: TriggerWhoseTurn = match[1] === 'your'
    ? 'you'
    : match[1] === "each opponent's"
      ? 'each_opponent'
      : match[1] === "enchanted player's"
        ? 'enchanted_player'
        : match[1] === "the monarch's"
          ? 'monarch'
          : match[1] === "the chosen player's"
            ? 'chosen_player'
            : 'each_player';
  return {
    event,
    quantity: 'one',
    whoseTurn,
    alternatives: [],
  };
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
    const created = /^(.+?),\s*(.+)$/.exec(rest.trim());
    if (!created) return null;
    const subject = parseSubjectPhrase(prepareSubjectPhrase(created[1]), 'creates_token');
    const effect = effectOf(created[2]);
    if (!subject || !effect) return null;
    return { condition: withController(subject, controller), effect };
  }
  return null;
}

/**
 * "Whenever a Goblin you control dies, you gain 1 life."
 * Null when the subject is outside the condition record.
 */
export function parseTriggerEventSentence(sentence: string): ParsedTriggerEventSentence | null {
  const text = normalizeTriggerClause(sentence).replace(/\.+$/, '').trim();
  const match = /^(?:whenever|when)\s+(.+?)\s+(dies|enters(?: the battlefield)?(?: under your control)?|attacks|blocks|becomes tapped|becomes untapped)\s*,\s*(.+)$/.exec(text);
  if (!match) {
    const phaseSentence = /^at the beginning of ([^,]+),\s*(.+)$/.exec(text);
    if (phaseSentence) {
      const condition = parsePhaseTriggerClause(`at the beginning of ${phaseSentence[1].trim()}`);
      const effect = phaseSentence[2].trim();
      if (condition && effect) return { condition, effect };
    }
    const castSentence = /^(?:whenever|when)\s+((?:you cast|an opponent casts|a player casts)\b.+?),\s*(.+)$/.exec(text);
    if (castSentence) {
      const condition = parseSpellCastClause(castSentence[1]);
      const effect = castSentence[2].trim();
      if (condition && effect) return { condition, effect };
    }
    const endCombat = /^(at (?:the )?end of combat(?: on your turn)?),\s*(.+)$/.exec(text);
    if (endCombat) {
      const condition = parsePhaseTriggerClause(endCombat[1]);
      const effect = endCombat[2].trim();
      if (condition && effect) return { condition, effect };
    }
    const life = /^(?:whenever|when)\s+(you|an opponent|a player)\s+(gains?|loses?)\s+life,\s*(.+)$/.exec(text);
    if (life) {
      const controller = life[1] === 'you' ? 'you' : life[1] === 'an opponent' ? 'not_you' : 'any';
      const event = /gain/.test(life[2]) ? 'gains_life' : 'loses_life';
      const effect = life[3].trim();
      if (effect) {
        return {
          condition: {
            event,
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
      const subject = parseSubjectPhrase(sacrifice[2], 'sacrifices');
      const effect = sacrifice[3].trim();
      if (subject && effect) {
        return {
          condition: {
            ...subject,
            event: 'sacrifices',
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
      const objectText = playerAction[3].replace(/\s+cards?\b/g, '').replace(/\bcards?\b/g, 'permanent').replace(/\s+/g, ' ').trim();
      const subject = parseSubjectPhrase(
        objectText === '' || objectText === 'a' || objectText === 'an' ? 'a permanent' : objectText,
        event,
      );
      const effect = playerAction[4].trim();
      if (subject && effect) {
        return {
          condition: {
            ...subject,
            event,
            alternatives: subject.alternatives.map((alternative) => ({ ...alternative, controller })),
          },
          effect,
        };
      }
    }
    const combatDamage = /^(?:whenever|when)\s+(.+?)\s+deals combat damage to (a player|an opponent|you|a creature),\s*(.+)$/.exec(text);
    if (combatDamage) {
      const toCreature = combatDamage[2] === 'a creature';
      const subject = parseSubjectPhrase(combatDamage[1], toCreature ? 'deals_combat_damage_to_creature' : 'deals_combat_damage_to_player');
      const effect = combatDamage[3].trim();
      if (subject && effect) return { condition: subject, effect };
    }
    const counterPlaced = /^(?:whenever|when)\s+(a \+1\/\+1 counter|one or more \+1\/\+1 counters|a counter|one or more counters)\s+(?:is|are) put on\s+(.+?),\s*(.+)$/.exec(text);
    if (counterPlaced) {
      const placedCounter = counterPlaced[1].includes('+1/+1') ? '+1/+1' : 'any';
      const subject = parseSubjectPhrase(counterPlaced[2], 'counter_placed');
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
    const graveyard = /^(?:whenever|when)\s+(.+?)\s+(?:is|are) put into (your|a|an opponent's) graveyard from (anywhere|the battlefield|your library|your hand),\s*(.+)$/.exec(text);
    if (graveyard) {
      const subject = parseSubjectPhrase(prepareSubjectPhrase(graveyard[1]), 'put_into_graveyard');
      const effect = graveyard[4].trim();
      if (!subject || !effect) return null;
      const zoneOwner = graveyard[2] === 'your' ? 'you' : graveyard[2] === "an opponent's" ? 'not_you' : 'any';
      return {
        condition: {
          ...subject,
          event: 'put_into_graveyard',
          fromZone: graveyard[3] === 'the battlefield'
            ? 'battlefield'
            : graveyard[3] === 'your library'
              ? 'library'
              : graveyard[3] === 'your hand'
                ? 'hand'
                : 'anywhere',
          zoneOwner,
        },
        effect,
      };
    }
    const leftGraveyard = /^(?:whenever|when)\s+(.+?)\s+(?:leaves|leave) (your|a|an opponent's) graveyard,\s*(.+)$/.exec(text);
    if (leftGraveyard) {
      const subject = parseSubjectPhrase(prepareSubjectPhrase(leftGraveyard[1]), 'left_graveyard');
      const effect = leftGraveyard[3].trim();
      if (!subject || !effect) return null;
      const zoneOwner = leftGraveyard[2] === 'your' ? 'you' : leftGraveyard[2] === "an opponent's" ? 'not_you' : 'any';
      return { condition: { ...subject, event: 'left_graveyard', zoneOwner }, effect };
    }
    return parseLateTriggerSentence(text);
  }
  const subject = match[1].trim();
  const eventWord = match[2];
  const effect = match[3].trim();
  if (!subject || !effect) return null;

  const underYourControl = /under your control$/.test(eventWord);
  const eventKind = eventWord.startsWith('enters')
    ? 'enters'
    : eventWord.startsWith('attacks')
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
            : parseSubjectPhrase(subjectText, 'dies');
  if (!condition) return null;
  return { condition, effect };
}

export interface TriggerReflexiveRider {
  readonly actor: 'you' | 'they';
  readonly effect: string;
  readonly delayed?: TriggerDelayedRider;
}

export interface TriggerDelayedRider {
  readonly timing: 'next_end_step' | 'your_next_end_step';
  readonly effect: string;
}

export interface ParsedTriggerClause {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
  readonly interveningIf?: string;
  readonly reflexive?: TriggerReflexiveRider;
  readonly delayed?: TriggerDelayedRider;
}

function splitDelayedTail(effect: string): { effect: string; delayed?: TriggerDelayedRider } {
  const delayedMatch = /\bat the beginning of (your next|the next) end step,\s+([\s\S]+)$/i.exec(effect);
  if (!delayedMatch || delayedMatch.index === undefined) return { effect };
  return {
    effect: effect.slice(0, delayedMatch.index).replace(/[.\s]+$/, '').trim(),
    delayed: {
      timing: delayedMatch[1].toLowerCase().startsWith('your') ? 'your_next_end_step' : 'next_end_step',
      effect: delayedMatch[2].trim(),
    },
  };
}

/** Pull intervening-if, "when you do", and "next end step" off a trigger effect. */
export function splitTriggerEffectRiders(effect: string): Omit<ParsedTriggerClause, 'condition'> {
  let text = String(effect || '').trim();
  let interveningIf: string | undefined;
  const ifMatch = /^if\s+(.+?),\s+([\s\S]+)$/i.exec(text);
  if (ifMatch && !/^(?:you|they)\s+do\b/i.test(ifMatch[1])) {
    interveningIf = ifMatch[1].trim();
    text = ifMatch[2].trim();
  }

  let delayed: TriggerDelayedRider | undefined;
  let reflexive: TriggerReflexiveRider | undefined;
  const reflex = /\b(?:when|if)\s+(you|they)\s+do,\s+([\s\S]+)$/i.exec(text);
  if (reflex && reflex.index !== undefined) {
    const rider = splitDelayedTail(reflex[2].trim());
    reflexive = {
      actor: reflex[1].toLowerCase() === 'they' ? 'they' : 'you',
      effect: rider.effect,
      ...(rider.delayed ? { delayed: rider.delayed } : {}),
    };
    text = text.slice(0, reflex.index).replace(/[.\s]+$/, '').trim();
  } else {
    const mainTail = splitDelayedTail(text);
    delayed = mainTail.delayed;
    text = mainTail.effect;
  }

  return {
    effect: text,
    ...(interveningIf ? { interveningIf } : {}),
    ...(reflexive ? { reflexive } : {}),
    ...(delayed ? { delayed } : {}),
  };
}

export function parseTriggerClause(sentence: string): ParsedTriggerClause | null {
  const parsed = parseTriggerEventSentence(sentence);
  if (!parsed) return null;
  return { condition: parsed.condition, ...splitTriggerEffectRiders(parsed.effect) };
}

const KEYWORD_DEATH = /\b(undying|persist)\b/gi;

/** Printed undying/persist, ignoring reminder text. */
export function printedKeywordDeathAbilities(oracleText: string): Array<'undying' | 'persist'> {
  const text = String(oracleText || '').replace(/\([^)]*\)/g, ' ');
  const found = new Set<'undying' | 'persist'>();
  for (const match of text.matchAll(KEYWORD_DEATH)) {
    const word = String(match[1] || '').toLowerCase();
    if (word === 'undying' || word === 'persist') found.add(word);
  }
  return [...found];
}
