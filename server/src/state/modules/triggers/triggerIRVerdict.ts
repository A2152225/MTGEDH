/**
 * IR verdicts for legacy trigger entries.
 * Public: parsedTriggerLinesForEffect, triggerSubjectIRVerdict, spellCastTriggerIRVerdict,
 *   isOneOrMoreIRBatchDuplicate.
 *
 * Legacy family detectors keep a lossy enum ("creature", "land_you_control_etb"). These
 * helpers find the printed trigger sentence behind a legacy entry and check the event's
 * subject against its full condition IR, so qualifiers the enum dropped ("artifact creature
 * spell", "nontoken land", "another Elf") still apply. They only ever tighten a legacy match.
 */

import { stripReminderParentheticals } from '../../../../../rules-engine/src/oracleReminderText.js';
import { parseTriggerClause, triggerConditionMatches } from '../../../../../rules-engine/src/triggerCondition/index.js';
import type { TriggerConditionEvent, TriggerConditionIR } from '../../../../../rules-engine/src/triggerCondition/index.js';
import { parsedEffectDuplicates, permanentToTriggerMatch } from './triggerConditionFamilyMatch.js';
import { claimSimultaneousBatchKey } from './simultaneousEntryBatch.js';

export interface ParsedTriggerLine {
  readonly condition: TriggerConditionIR;
  readonly effect: string;
}

function triggerSentences(oracleText: string): string[] {
  const text = stripReminderParentheticals(String(oracleText || ''))
    .replace(/"[^"\n]*"|\u201c[^\u201d\n]*\u201d/g, '""');
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=\.)\s+(?=(?:when|whenever|at)\b)/i))
    // Ability words ("Landfall - Whenever ...") are not part of the trigger condition.
    .map((sentence) => sentence.replace(/^[A-Za-z' ]+\s[\u2014-]+\s(?=(?:when|whenever)\b)/i, ''));
}

/** Parsed trigger sentences on the card for these events whose effect is the legacy entry's effect. */
export function parsedTriggerLinesForEffect(
  oracleText: string,
  events: readonly TriggerConditionEvent[],
  effectTexts: readonly unknown[],
  cardName?: string,
): ParsedTriggerLine[] {
  const lines: ParsedTriggerLine[] = [];
  const texts = effectTexts.filter((text) => String(text || '').trim() !== '');
  if (texts.length === 0) return lines;
  for (const sentence of triggerSentences(oracleText)) {
    const parsed = parseTriggerClause(sentence, cardName);
    if (!parsed || !parsed.effect) continue;
    const event = parsed.condition.event;
    const paired = parsed.condition.pairedEvent;
    if (!events.includes(event) && !(paired && events.includes(paired))) continue;
    if (!parsedEffectDuplicates([...texts], parsed)) continue;
    lines.push({ condition: parsed.condition, effect: parsed.effect });
  }
  return lines;
}

/**
 * Subject check only (controller, source relation, types, subtypes, keywords, colours...).
 * Zone, ordinal, target and turn qualifiers stay with the legacy path.
 * Null when no parsed sentence backs the entry, so the caller keeps its legacy verdict.
 */
export function triggerSubjectIRVerdict(options: {
  oracleText: string;
  events: readonly TriggerConditionEvent[];
  effectTexts: readonly unknown[];
  subjectPermanent: any;
  subjectControllerId: string;
  sourcePermanent: any;
  state?: any;
  subjectColors?: readonly string[];
}): boolean | null {
  const lines = parsedTriggerLinesForEffect(
    options.oracleText,
    options.events,
    options.effectTexts,
    String(options.sourcePermanent?.card?.name || options.sourcePermanent?.name || '').trim() || undefined,
  )
    .filter((line) => line.condition.alternatives.length > 0);
  if (lines.length === 0) return null;
  const base = permanentToTriggerMatch(options.subjectPermanent, options.subjectControllerId, options.state);
  const subject = options.subjectColors ? { ...base, colors: [...options.subjectColors] } : base;
  const source = {
    id: String(options.sourcePermanent?.id || '').trim(),
    controllerId: String(options.sourcePermanent?.controller || '').trim(),
    attachedToId: String(options.sourcePermanent?.attachedTo || '').trim(),
    chosenCreatureType: String(options.sourcePermanent?.chosenCreatureType || '').trim() || undefined,
  };
  return lines.some((line) => triggerConditionMatches(
    { event: line.condition.event, quantity: line.condition.quantity, alternatives: line.condition.alternatives },
    subject,
    source,
  ));
}

const COLOR_LETTER: Readonly<Record<string, string>> = {
  white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g', w: 'w', u: 'u', b: 'b', r: 'r', g: 'g',
};

/**
 * Spell-cast entry against the full IR of its printed sentence ("an artifact creature spell",
 * "a multicolored instant spell"). A parsed entry carries its own condition. Null keeps the
 * legacy verdict.
 */
export function spellCastTriggerIRVerdict(options: {
  trigger: any;
  sourcePermanent: any;
  spellCard: any;
  casterId: string;
  state?: any;
  effectiveSpellColors?: readonly string[];
}): boolean | null {
  const colors = options.effectiveSpellColors
    ? options.effectiveSpellColors.map((color) => COLOR_LETTER[String(color || '').trim().toLowerCase()]).filter(Boolean)
    : undefined;
  const condition: TriggerConditionIR | undefined = options.trigger?.triggerCondition;
  if (condition && condition.alternatives.length > 0) {
    const base = permanentToTriggerMatch(options.spellCard, options.casterId);
    return triggerConditionMatches(
      { event: condition.event, quantity: condition.quantity, alternatives: condition.alternatives },
      colors ? { ...base, colors } : base,
      {
        id: String(options.sourcePermanent?.id || '').trim(),
        controllerId: String(options.sourcePermanent?.controller || '').trim(),
        chosenCreatureType: String(options.sourcePermanent?.chosenCreatureType || '').trim() || undefined,
      },
    );
  }
  return triggerSubjectIRVerdict({
    oracleText: String(options.sourcePermanent?.card?.oracle_text || ''),
    events: ['spell_cast'],
    effectTexts: [options.trigger?.effect, options.trigger?.description, options.trigger?.benefitIfNotPaid],
    subjectPermanent: options.spellCard,
    subjectControllerId: options.casterId,
    sourcePermanent: options.sourcePermanent,
    subjectColors: colors,
  });
}

/**
 * "Whenever you sacrifice one or more ..." / "one or more creatures you control": the
 * entry fires once per simultaneous event. True when this source already fired for the
 * active batch and the entry must be dropped. Outside a batch nothing is a duplicate.
 */
export function isOneOrMoreIRBatchDuplicate(
  kind: string,
  sourcePermanent: any,
  effectTexts: readonly unknown[],
  events: readonly TriggerConditionEvent[],
): boolean {
  const oracleText = String(sourcePermanent?.card?.oracle_text || sourcePermanent?.oracle_text || '');
  const lines = parsedTriggerLinesForEffect(
    oracleText,
    events,
    effectTexts,
    String(sourcePermanent?.card?.name || sourcePermanent?.name || '').trim() || undefined,
  );
  const line = lines.find((entry) => entry.condition.quantity === 'one_or_more');
  if (!line) return false;
  const key = `${kind}|${String(sourcePermanent?.id || '')}|${line.effect.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  return claimSimultaneousBatchKey(key) === 'duplicate';
}