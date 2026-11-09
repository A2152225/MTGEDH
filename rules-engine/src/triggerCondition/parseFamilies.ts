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
import { parseRound40BatchedTriggerSentence } from './parseRound40BatchedEvents.js';
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

/**
 * "you cast a creature spell from exile", "an opponent casts a noncreature spell
 * that targets you", "you cast your first spell each turn".
 */
export function parseSpellCastClause(clause: string): TriggerConditionIR | null {
  // "a spell that has convoke" reads as "a spell with convoke".
  let text = normalizeTriggerClause(clause).replace(/ (spells?) that (?:has|have) /, ' $1 with ');
  const manaValue = / with (?:mana value|converted mana cost) (\d+) or (greater|more|less)\b/.exec(text);
  if (manaValue) text = text.replace(manaValue[0], ' ').replace(/\s+/g, ' ').trim();
  const kicked = /^(?:you cast|an opponent casts|a player casts|enchanted player casts) (?:a|an) kicked\b/.test(text);
  if (kicked) text = text.replace(/ kicked\b/, ' ').replace(/\s+/g, ' ').trim();
  // Strip "targets only this" before the refuse-this guard (Beamsplitter / Reflective Golem).
  let earlyTargetsOnly = false;
  if (/\bthat targets only (?:this creature|this permanent|~)\b/.test(text)) {
    earlyTargetsOnly = true;
    text = text.replace(/\bthat targets only (?:this creature|this permanent|~)\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let requiresChosenName = false;
  if (/\bwith the chosen name\b/.test(text)) {
    requiresChosenName = true;
    text = text.replace(/\bwith the chosen name\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let requiresChosenColor = false;
  if (/\bof the chosen colou?r\b/.test(text)) {
    requiresChosenColor = true;
    text = text.replace(/\bof the chosen colou?r\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let hasAdventure = false;
  if (/\b(?:that has|with) an adventure\b/.test(text) || /\ban adventure (?:or\s+)?spell\b/.test(text)) {
    hasAdventure = true;
    text = text.replace(/\b(?:that has|with) an adventure\b/, ' ').replace(/\ban adventure (?:or\s+)?/, 'a ').replace(/\s+/g, ' ').trim();
  }
  let earlyTargetsPermanent = false;
  if (/\bthat targets (?:a|one or more) permanents?\b/.test(text)) {
    earlyTargetsPermanent = true;
    text = text.replace(/\bthat targets (?:a|one or more) permanents?\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let earlyTargetsYouOrCreature = false;
  if (/\bthat targets you or a creature you control\b/.test(text)) {
    earlyTargetsYouOrCreature = true;
    text = text.replace(/\bthat targets you or a creature you control\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let earlyTargetsOpponentOrCreature = false;
  if (/\bthat targets an opponent or a creature an opponent controls\b/.test(text)) {
    earlyTargetsOpponentOrCreature = true;
    text = text.replace(/\bthat targets an opponent or a creature an opponent controls\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let earlyTargetsArtifactOrLand = false;
  if (/\bthat targets an artifact or land\b/.test(text)) {
    earlyTargetsArtifactOrLand = true;
    text = text.replace(/\bthat targets an artifact or land\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let earlyTargetsSingleCreatureBare = false;
  if (/\bthat targets only a single creature\b/.test(text) && !/creature you control/.test(text) && !/other than/.test(text)) {
    earlyTargetsSingleCreatureBare = true;
    text = text.replace(/\bthat targets only a single creature\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let earlyTargetsSingleArtOrCreYou = false;
  if (/\bthat targets only a single artifact or creature you control\b/.test(text)) {
    earlyTargetsSingleArtOrCreYou = true;
    text = text.replace(/\bthat targets only a single artifact or creature you control\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let earlyTargetsSingleCreatureYou = false;
  if (/\bthat targets only a single creature you control\b/.test(text)) {
    earlyTargetsSingleCreatureYou = true;
    text = text.replace(/\bthat targets only a single creature you control\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let earlyTargetsSingleCreatureOther = false;
  if (/\bthat targets only a single creature other than (?:~|this creature|this permanent)\b/.test(text)) {
    earlyTargetsSingleCreatureOther = true;
    text = text.replace(/\bthat targets only a single creature other than (?:~|this creature|this permanent)\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  let earlyTargetsOnlySelfName = false;
  if (/\bthat targets only (?:it|~)\b/.test(text) || /\btargets only it\b/.test(text)) {
    // "becomes the target of an ability that targets only it" handled elsewhere; cast path:
    if (/\bthat targets only (?:it|~)\b/.test(text)) {
      earlyTargetsOnlySelfName = true;
      text = text.replace(/\bthat targets only (?:it|~)\b/, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  // "a spell with cascade": a trailing keyword clause is validated by parseSubjectPhrase's keyword list.
  const guardText = text.replace(/ spells? with(?:out)? [a-z ]+$/, ' spell');
  if (!text || /\b(?:this|whenever|when|commander|chosen|with|without|power|where|unless|~)\b/.test(guardText)) {
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
  } else if (text.startsWith('enchanted player casts ')) {
    controller = 'enchanted_player';
    text = text.slice('enchanted player casts '.length);
  } else {
    return null;
  }

  let ordinal: TriggerConditionIR['ordinal'];
  const ordinalMatch = /^(?:your|their) (first|second|third|fourth)\s+/.exec(text);
  if (ordinalMatch) {
    ordinal = ordinalMatch[1] as TriggerConditionIR['ordinal'];
    text = text.slice(ordinalMatch[0].length);
  }
  text = text.replace(/\beach turn\b/, ' ').replace(/\sduring their turn\b/, ' ').replace(/\s+/g, ' ').trim();

  let castFromZone: TriggerConditionIR['castFromZone'];
  let whoseTurn: TriggerConditionIR['whoseTurn'];
  const duringTurn = / during (?:an|each) opponent's turn\b| during your turn\b/.exec(text);
  if (duringTurn) {
    whoseTurn = /your turn/.test(duringTurn[0]) ? 'you' : 'each_opponent';
    text = text.replace(duringTurn[0], ' ').replace(/\s+/g, ' ').trim();
  }
  let duringCombat = false;
  if (/ during combat\b/.test(text)) {
    duringCombat = true;
    text = text.replace(/ during combat\b/, ' ').replace(/\s+/g, ' ').trim();
  }
  const fromZone = / from (?:your |their |a )?(hand|graveyard|exile|library)\b/.exec(text);
  if (fromZone) {
    castFromZone = fromZone[1] as TriggerConditionIR['castFromZone'];
    text = text.replace(fromZone[0], ' ').replace(/\s+/g, ' ').trim();
  } else if (/ from anywhere other than (?:your |their )?hand\b/.test(text)) {
    castFromZone = 'not_hand';
    text = text.replace(/ from anywhere other than (?:your |their )?hand\b/, ' ').replace(/\s+/g, ' ').trim();
  }

  let targets: TriggerConditionIR['targets'];
  if (earlyTargetsOnly || earlyTargetsOnlySelfName) {
    targets = 'self_only';
  } else if (earlyTargetsPermanent) {
    targets = 'permanent';
  } else if (earlyTargetsYouOrCreature) {
    targets = 'you_or_creature_you_control';
  } else if (earlyTargetsOpponentOrCreature) {
    targets = 'opponent_or_creature_opponent_controls';
  } else if (earlyTargetsArtifactOrLand) {
    targets = 'artifact_or_land';
  } else if (earlyTargetsSingleCreatureYou) {
  } else if (earlyTargetsSingleCreatureBare) {
    targets = 'creature';
  } else if (earlyTargetsSingleArtOrCreYou) {
    targets = 'single_creature_you_control';
    targets = 'single_creature_you_control';
  } else if (earlyTargetsSingleCreatureOther) {
    targets = 'single_creature_other';
  } else if (/\bthat targets you\b/.test(text)) {
    targets = 'you';
    text = text.replace(/\bthat targets you\b/, ' ').replace(/\s+/g, ' ').trim();
  } else if (/\bthat targets (?:a|one or more) creatures? you don't control\b/.test(text)) {
    targets = 'creature_you_dont_control';
    text = text.replace(/\bthat targets (?:a|one or more) creatures? you don't control\b/, ' ').replace(/\s+/g, ' ').trim();
  } else if (/\bthat targets (?:a|one or more) creatures? you control\b/.test(text)) {
    targets = 'creature_you_control';
    text = text.replace(/\bthat targets (?:a|one or more) creatures? you control\b/, ' ').replace(/\s+/g, ' ').trim();
  } else if (/\bthat targets (?:a|one or more) creatures?\b/.test(text)) {
    targets = 'creature';
    text = text.replace(/\bthat targets (?:a|one or more) creatures?\b/, ' ').replace(/\s+/g, ' ').trim();
  } else if (/\bthat targets an opponent\b/.test(text)) {
    targets = 'opponent';
    text = text.replace(/\bthat targets an opponent\b/, ' ').replace(/\s+/g, ' ').trim();
  }

  // "a spell with cascade" / "a creature spell with flying": the keyword qualifies the spell.
  text = text.replace(/(^|\s)spells?(?= with(?:out)? )/, '$1').replace(/\s+/g, ' ').trim();
  text = text.replace(/\s+spells?$/, '').replace(/^spells?$/, '').trim();
  text = text.replace(/\s+cards?$/, '').replace(/^cards?$/, '').trim();
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
    ...(whoseTurn ? { whoseTurn } : {}),
    ...(duringCombat ? { duringCombat: true } : {}),
    ...(requiresChosenName ? { requiresChosenName: true } : {}),
    ...(hasAdventure ? { hasAdventure: true } : {}),
    alternatives: parsed.alternatives.map((alternative) => ({
      ...alternative,
      controller,
      subject: {
        ...alternative.subject,
        ...(requiresChosenColor ? { chosenColor: true } : {}),
        ...(manaValue
          ? { stats: [...(alternative.subject.stats || []), { stat: 'mana_value' as const, op: manaValue[2] === 'less' ? 'lte' as const : 'gte' as const, value: Number(manaValue[1]) }] }
          : {}),
        ...(kicked ? { kicked: true } : {}),
      },
    })),
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
    'at the beginning of each of your postcombat main phases': { event: 'beginning_of_postcombat_main', whoseTurn: 'you' },
    'at the beginning of each of enchanted player\'s postcombat main phases': { event: 'beginning_of_postcombat_main', whoseTurn: 'enchanted_player' },
    'at the beginning of each of enchanted player\'s upkeeps': { event: 'beginning_of_upkeep', whoseTurn: 'enchanted_player' },
    'at the beginning of each of your upkeeps': { event: 'beginning_of_upkeep', whoseTurn: 'you' },
    'at the beginning of each of your end steps': { event: 'beginning_of_end_step', whoseTurn: 'you' },
    'at end of combat': { event: 'end_of_combat', whoseTurn: 'each_player' },
    'at the end of combat': { event: 'end_of_combat', whoseTurn: 'each_player' },
    'at end of combat on your turn': { event: 'end_of_combat', whoseTurn: 'you' },
    'at the end of combat on your turn': { event: 'end_of_combat', whoseTurn: 'you' },
    'at the end of the first combat phase on your turn': { event: 'end_of_combat', whoseTurn: 'you', firstCombat: true } as { event: 'end_of_combat'; whoseTurn: 'you'; firstCombat: true },
    // Ball Lightning family: "At the beginning of the end step" is every end step.
    'at the beginning of the end step': { event: 'beginning_of_end_step', whoseTurn: 'each_player' },
  };
  const known = exact[text];
  if (known) {
    return { event: known.event, quantity: 'one', whoseTurn: known.whoseTurn, alternatives: [], ...((known as any).firstCombat ? { firstCombat: true } : {}) };
  }
  if (/^at the beginning of the upkeep of enchanted (?:creature|land|enchantment|permanent|artifact)'s controller$/.test(text)) {
    return { event: 'beginning_of_upkeep', quantity: 'one', whoseTurn: 'enchanted_controller', alternatives: [] };
  }
  if (/^at the beginning of the draw step of enchanted (?:creature|land|enchantment|permanent|artifact)'s controller$/.test(text)) {
    return { event: 'beginning_of_draw_step', quantity: 'one', whoseTurn: 'enchanted_controller', alternatives: [] };
  }
  if (/^at the beginning of (?:each of )?that player's (upkeeps?|draw steps?|end steps?)$/.test(text)) {
    const phase = /^at the beginning of (?:each of )?that player's (upkeeps?|draw steps?|end steps?)$/.exec(text)![1];
    const phaseRaw = phase.replace(/s$/, '');
    const event = phaseRaw === 'upkeep' ? 'beginning_of_upkeep' : phaseRaw === 'draw step' ? 'beginning_of_draw_step' : 'beginning_of_end_step';
    return { event, quantity: 'one', whoseTurn: 'that_player', alternatives: [] };
  }
  if (/^at the beginning of the upkeep of the exiled card's owner$/.test(text)) {
    return { event: 'beginning_of_upkeep', quantity: 'one', whoseTurn: 'exiled_card_owner', alternatives: [] };
  }
  const match = /^(?:at the beginning of )?(your|each player's|each opponent's|each other player's|each|enchanted player's|the monarch's|the chosen player's) (upkeep|draw step|combat|end step)$/.exec(text);
  if (!match) return null;
  const event = PHASE_EVENT[match[2]];
  if (!event) return null;
  const whoseTurn: TriggerWhoseTurn = match[1] === 'your'
    ? 'you'
    : match[1] === "each opponent's"
      ? 'each_opponent'
      : match[1] === "each other player's"
        ? 'each_other_player'
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

export interface TriggerReflexiveRider {
  readonly actor: 'you' | 'they';
  readonly effect: string;
  readonly delayed?: TriggerDelayedRider;
}

export interface TriggerDelayedRider {
  readonly timing: 'next_end_step' | 'your_next_end_step' | 'end_step_on_your_next_turn' | 'that_player_next_end_step';
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

/** "Landfall — Whenever ...": an ability word labels the trigger and is not part of it. */
const ABILITY_WORD_PREFIX = /^\s*[a-z][a-z' ]{0,40}?\s+(?:\u2014|--?)\s+(?=(?:when|whenever|at)\b)/i;

export function parseTriggerClause(sentence: string, cardName?: string): ParsedTriggerClause | null {
  const unlabeled = String(sentence || '').replace(ABILITY_WORD_PREFIX, '');
  const selfNormalized = cardName ? normalizeSelfNameInTriggerSentence(unlabeled, cardName) : unlabeled;
  const parsed = parseTriggerEventSentence(selfNormalized)
    ?? parseRound40BatchedTriggerSentence(normalizeTriggerClause(selfNormalized), parseTriggerEventSentence as any);
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
