/**
 * Spell-cast trigger clause parser ("you cast a creature spell from exile", "an opponent casts a
 * noncreature spell that targets you"). Split from parseFamilies.ts with no behavior change;
 * parseFamilies.ts re-exports parseSpellCastClause.
 */

import { normalizeTriggerClause, parseSubjectPhrase } from './parseSubjectPhrase.js';
import type { TriggerConditionIR } from './types.js';

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
    targets = 'single_creature_you_control';
  } else if (earlyTargetsSingleCreatureBare) {
    targets = 'creature';
  } else if (earlyTargetsSingleArtOrCreYou) {
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
