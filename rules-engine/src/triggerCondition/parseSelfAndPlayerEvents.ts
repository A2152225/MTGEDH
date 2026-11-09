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
  const draw = /^whenever (you|an opponent|a player) draws? (?:your|their) (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) card each turn,\s*(.+)$/.exec(text);
  if (!draw) return null;
  const subject = parseSubjectPhrase('a permanent', 'draws_card');
  if (!subject) return null;
  const controller = ACTOR_CONTROLLER[draw[1]];
  return {
    condition: {
      ...subject,
      event: 'draws_card',
      ordinal: draw[2] as TriggerConditionIR['ordinal'],
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
  const blocksOrBlockedBySelf = /^(?:whenever|when)\s+(.+?)\s+blocks or becomes blocked by (this creature|this permanent|~),\s*(.+)$/.exec(text);
  if (blocksOrBlockedBySelf) {
    const partner = parseSubjectPhrase(blocksOrBlockedBySelf[1], 'blocks');
    if (!partner) return null;
    return {
      condition: {
        ...selfCondition('blocks', { pairedEvent: 'becomes_blocked' } as any),
        blockPartner: partner.alternatives[0]?.subject,
        subjectIsBlockPartner: true,
      } as any,
      effect: blocksOrBlockedBySelf[3].trim(),
    };
  }
  const blockPair = /^(?:whenever|when)\s+(.+?)\s+blocks or becomes blocked(?: by (.+?))?,\s*(.+)$/.exec(text);
  if (blockPair && SELF_SUBJECT.test(blockPair[1].trim())) {
    const partnerText = (blockPair[2] || '').trim();
    let dealtDamageThisTurnPartner = false;
    let partnerForParse = partnerText;
    if (/that has been dealt damage this turn$/.test(partnerText)) {
      dealtDamageThisTurnPartner = true;
      partnerForParse = partnerText.replace(/\s+that has been dealt damage this turn$/, '').trim() || 'a creature';
    }
    let blockPartner: TriggerConditionIR['blockPartner'];
    if (partnerForParse && !/^(?:a|one or more) creatures?$/.test(partnerText)) {
      const partner = parseSubjectPhrase(partnerForParse, 'blocks');
      if (!partner || partner.alternatives.length === 0) return null;
      if (partner.alternatives.length === 1) {
        blockPartner = partner.alternatives[0].subject;
      } else {
        // Color-OR partners ("a green or white creature"): merge colors; fail closed on other splits.
        const base = partner.alternatives[0].subject;
        const colors = partner.alternatives.flatMap((alt) => alt.subject.colors || []);
        const sameShape = partner.alternatives.every((alt) =>
          JSON.stringify({ ...alt.subject, colors: undefined }) === JSON.stringify({ ...base, colors: undefined }));
        if (!sameShape || colors.length === 0) return null;
        blockPartner = { ...base, colors: [...new Set(colors)] };
      }
    }
    return {
      condition: selfCondition('blocks', { pairedEvent: 'becomes_blocked', ...(blockPartner ? { blockPartner } : {}), ...(dealtDamageThisTurnPartner ? { blockPartnerDealtDamageThisTurn: true } : {}) } as Partial<TriggerConditionIR>),
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

  const attackWithSelfAndAnother = /^whenever you attack with (~|this creature|this permanent) and another (legendary )?creatures?,\s*(.+)$/.exec(text);
  if (attackWithSelfAndAnother) {
    const subject = attackWithSelfAndAnother[2] ? 'one or more legendary creatures you control' : 'one or more creatures you control';
    const base = parseSubjectPhrase(subject, 'attacks');
    if (!base) return null;
    return { condition: { ...base, minOtherAttackers: 1, sourceAmongAttackers: true, ...(attackWithSelfAndAnother[2] ? { requireLegendaryPartner: true } : {}) } as any, effect: attackWithSelfAndAnother[3].trim() };
  }
  const untapDuringUntap = /^whenever you untap (one or more )?permanents? during your untap step,\s*(.+)$/.exec(text);
  if (untapDuringUntap) {
    const base = parseSubjectPhrase(untapDuringUntap[1] ? 'one or more permanents you control' : 'a permanent you control', 'becomes_untapped');
    if (!base) return null;
    return { condition: { ...base, duringUntapStep: true, causedByYou: true } as any, effect: untapDuringUntap[2].trim() };
  }
  const sameNameCombat = /^(?:whenever|when)\s+(?:this creature|~) or another creature with the same name deals combat damage to a player,\s*(.+)$/.exec(text);
  if (sameNameCombat) {
    const base = parseSubjectPhrase('a creature', 'deals_combat_damage_to_player');
    if (!base) return null;
    return { condition: { ...base, sameNameAsSource: true, alternatives: base.alternatives.map((a) => ({ ...a, source: 'any' as const })) } as any, effect: sameNameCombat[1].trim() };
  }
  const attackNonSelf = /^whenever you attack with (one|two|three|four|five|six|seven|eight|nine|ten) or more (non-~|non-this permanent|non-[A-Za-z][A-Za-z-]*) creatures,\s*(.+)$/.exec(text);
  if (attackNonSelf) {
    const count = ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 } as Record<string, number>)[attackNonSelf[1]];
    const base = parseSubjectPhrase('one or more creatures you control', 'attacks');
    if (!base || !count) return null;
    const excl = attackNonSelf[2];
    const excludeAttackerName = (excl === 'non-~' || excl === 'non-this permanent') ? undefined : excl.slice(4).toLowerCase();
    return { condition: { ...base, minOtherAttackers: Math.max(0, count - 1), exactAttackers: undefined, excludeSourceFromAttackers: true, ...(excludeAttackerName ? { excludeAttackerName } : { excludeSourceFromAttackers: true }) } as any, effect: attackNonSelf[3].trim() };
  }
  const blockedByTwoPlus = /^(?:whenever|when)\s+(.+?)\s+becomes blocked by (two|three|four|five) or more creatures,\s*(.+)$/.exec(text);
  if (blockedByTwoPlus) {
    const base = parseSubjectPhrase(blockedByTwoPlus[1].replace(/^a creature attacking one of your opponents$/, 'a creature'), 'becomes_blocked');
    const n = ({ two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[blockedByTwoPlus[2]];
    if (!base || !n) return null;
    const attackingOpp = /attacking one of your opponents/.test(blockedByTwoPlus[1]);
    return { condition: { ...base, event: 'becomes_blocked', minBlockers: n, ...(attackingOpp ? { attackedPlayer: 'opponent' as const } : {}) } as any, effect: blockedByTwoPlus[3].trim() };
  }
  const nonOwnerControls = /^(?:whenever|when) a player other than (?:this creature|this permanent|~)'?s? owner controls (?:it|this creature|this permanent|~),\s*(.+)$/.exec(text);
  if (nonOwnerControls) {
    return { condition: selfCondition('controls_none' as any, { controllerNotOwner: true } as any), effect: nonOwnerControls[1].trim() };
  }
  const multiSubtypeCombat = /^(?:whenever|when)\s+one or more ([A-Za-z]+(?:, [A-Za-z]+)*,? and\/?or [A-Za-z]+) you control deals? combat damage to a player,\s*(.+)$/.exec(text);
  if (multiSubtypeCombat) {
    const parts = multiSubtypeCombat[1].split(/,? and\/?or |, /).map((p) => { const w = p.trim().toLowerCase(); const irreg: Record<string,string> = { mice: 'mouse', werewolves: 'werewolf', wolves: 'wolf', calves: 'calf', elves: 'elf', dwarves: 'dwarf', vampires: 'vampire' }; return irreg[w] || w.replace(/s$/, ''); }).filter(Boolean);
    const base = parseSubjectPhrase('one or more creatures you control', 'deals_combat_damage_to_player');
    if (!base || parts.length < 2) return null;
    const alt = base.alternatives[0];
    const subject = { ...alt.subject, subtypeGroups: parts.map((p) => [p]), groups: parts.map((p) => ({ types: ['creature'], subtypes: [p] })) };
    return { condition: { ...base, alternatives: [{ ...alt, subject }] }, effect: multiSubtypeCombat[2].trim() };
  }
  const multiSubtypeEnter = /^(?:whenever|when)\s+one or more (other )?([A-Za-z]+(?:, [A-Za-z]+)*,? and\/?or [A-Za-z]+) you control enters?,\s*(.+)$/.exec(text);
  if (multiSubtypeEnter) {
    const parts = multiSubtypeEnter[2].split(/,? and\/?or |, /).map((p) => { const w = p.trim().toLowerCase(); const irreg: Record<string,string> = { mice: 'mouse', werewolves: 'werewolf', wolves: 'wolf', calves: 'calf', elves: 'elf', dwarves: 'dwarf', vampires: 'vampire' }; return irreg[w] || w.replace(/s$/, ''); }).filter(Boolean);
    const base = parseSubjectPhrase((multiSubtypeEnter[1] ? 'one or more other creatures you control' : 'one or more creatures you control'), 'enters');
    if (!base || parts.length < 2) return null;
    const alt = base.alternatives[0];
    const subject = { ...alt.subject, subtypeGroups: parts.map((p) => [p]), groups: parts.map((p) => ({ types: ['creature'], subtypes: [p] })) };
    return { condition: { ...base, alternatives: [{ ...alt, source: multiSubtypeEnter[1] ? 'another' as const : alt.source, subject }] }, effect: multiSubtypeEnter[3].trim() };
  }
  const selfAndSubtypeAttack = /^whenever (~|this creature|this permanent) and at least (two|three|four) ([A-Za-z]+)s? attack,\s*(.+)$/.exec(text);
  if (selfAndSubtypeAttack) {
    const n = ({ two: 2, three: 3, four: 4 } as Record<string, number>)[selfAndSubtypeAttack[2]];
    const sub = selfAndSubtypeAttack[3].replace(/s$/i, '').toLowerCase();
    const base = parseSubjectPhrase('one or more ' + sub + ' creatures you control', 'attacks');
    if (!base || !n) return null;
    return { condition: { ...base, minOtherAttackers: n, sourceAmongAttackers: true, requireSubtypePartners: sub } as any, effect: selfAndSubtypeAttack[4].trim() };
  }
  const attackTotalPower = /^whenever you attack with creatures with total power (\d+) or greater(?: for the first time each turn)?,\s*(.+)$/.exec(text);
  if (attackTotalPower) {
    const base = parseSubjectPhrase('one or more creatures you control', 'attacks');
    if (!base) return null;
    return { condition: { ...base, minTotalPower: Number(attackTotalPower[1]), ...( /for the first time each turn/.test(text) ? { onceEachTurn: true } : {}) } as any, effect: attackTotalPower[2].trim() };
  }
  const namedAttacks = /^whenever ([a-z][a-z0-9' -]+?) attacks,\s*(.+)$/.exec(text);
  if (namedAttacks && !/^(this|whenever|when|another|an|a|each|one|you|enchanted|equipped|your|the)\b/.test(namedAttacks[1])) {
    const base = parseSubjectPhrase('a creature', 'attacks');
    if (!base) return null;
    return { condition: { ...base, requireAttackerName: namedAttacks[1] } as any, effect: namedAttacks[2].trim() };
  }
  const youAttackExactly = /^whenever you attack with exactly (one|two|three|four|five|six|seven|eight|nine|ten) creatures?,\s*(.+)$/.exec(text);
  if (youAttackExactly) {
    const count = ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 } as Record<string, number>)[youAttackExactly[1]];
    const base = parseSubjectPhrase('one or more creatures you control', 'attacks');
    if (!base || !count) return null;
    return { condition: { ...base, minOtherAttackers: Math.max(0, count - 1), exactAttackers: count } as any, effect: youAttackExactly[2].trim() };
  }
  const youAttackTyped = /^whenever you attack with (one|two|three|four|five|six|seven|eight|nine|ten) or more (legendary )?creatures,\s*(.+)$/.exec(text);
  if (youAttackTyped) {
    const count = ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 } as Record<string, number>)[youAttackTyped[1]];
    const subject = youAttackTyped[2] ? 'one or more legendary creatures you control' : 'one or more creatures you control';
    const base = parseSubjectPhrase(subject, 'attacks');
    if (!base || !count) return null;
    const condition = count > 1 ? { ...base, minOtherAttackers: count - 1 } : base;
    return { condition, effect: youAttackTyped[3].trim() };
  }
  const youAttackWith = /^whenever you attack with (one|two|three|four|five|six|seven|eight|nine|ten) or more creatures,\s*(.+)$/.exec(text);
  if (youAttackWith) {
    const count = ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 } as Record<string, number>)[youAttackWith[1]];
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
      if (!partner || partner.alternatives.length === 0) return null;
      if (partner.alternatives.length === 1) {
        blockPartner = partner.alternatives[0].subject;
      } else {
        const base = partner.alternatives[0].subject;
        const colors = partner.alternatives.flatMap((alt) => alt.subject.colors || []);
        const sameShape = partner.alternatives.every((alt) =>
          JSON.stringify({ ...alt.subject, colors: undefined }) === JSON.stringify({ ...base, colors: undefined }));
        if (!sameShape || colors.length === 0) return null;
        blockPartner = { ...base, colors: [...new Set(colors)] };
      }
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

  const lastRemoved = /^when the last(?: (time|[a-z-]+) counter)? is removed(?: from (?:it|this card|this permanent|this creature|this enchantment|~))?(?:,? (?:while|if) it'?s exiled)?,\s*(.+)$/.exec(text);
  if (lastRemoved) {
    return {
      condition: selfCondition('last_counter_removed', { placedCounter: lastRemoved[1] || 'time' } as Partial<TriggerConditionIR>),
      effect: lastRemoved[2].trim(),
    };
  }
  const youRemoveLast = /^when you remove the last(?: ([a-z-]+) counter)? from (?:it|this card|this permanent|this creature|this enchantment|~),\s*(.+)$/.exec(text);
  if (youRemoveLast) {
    return {
      condition: selfCondition('last_counter_removed', { placedCounter: youRemoveLast[1] || 'any' } as Partial<TriggerConditionIR>),
      effect: youRemoveLast[2].trim(),
    };
  }

  const castSelf = /^when you cast (?:this spell|~|this card|this creature spell),\s*(.+)$/.exec(text);
  if (castSelf) return { condition: selfCondition('cast_self'), effect: castSelf[1].trim() };

  return null;
}
