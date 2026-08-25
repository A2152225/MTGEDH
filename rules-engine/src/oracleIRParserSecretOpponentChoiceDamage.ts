/**
 * Origin parent: rules-engine/src/oracleIRParserEffectClauseToStep.ts
 * Cluster: secret each-opponent binary choice + all-same / mixed damage matrix
 *   (Prisoner's Dilemma family).
 * Public: tryParseSecretOpponentChoiceDamage
 * Leaf must not import oracleIR.ts or oracleIRParserEffectClauseToStep.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import { normalizeOracleText } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const FLASHBACK_TAIL =
  /\s*flashback\b[\s\S]*$/i;

const SECRET_CHOICE_LEAD =
  /^each\s+opponent\s+secretly\s+chooses\s+(\w+)\s+or\s+(\w+),\s+then\s+the\s+choices\s+are\s+revealed\.?\s+/i;

const ALL_SAME_DAMAGE =
  /if\s+each\s+opponent\s+chose\s+(\w+),\s*[^.]+\s+deals\s+(\d+)\s+damage\s+to\s+each\s+of\s+them/gi;

const MIXED_DAMAGE =
  /otherwise,\s*[^.]+\s+deals\s+(\d+)\s+damage\s+to\s+each\s+opponent\s+who\s+chose\s+(\w+)/i;

function stripFlashbackAndReminders(text: string): string {
  return normalizeOracleText(String(text || ''))
    .replace(FLASHBACK_TAIL, '')
    .replace(/\s+\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeChoiceLabel(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function tryParseSecretOpponentChoiceDamage(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = stripFlashbackAndReminders(clause);
  if (!normalized) return null;

  const lead = normalized.match(SECRET_CHOICE_LEAD);
  if (!lead) return null;

  const firstChoice = normalizeChoiceLabel(lead[1] || '');
  const secondChoice = normalizeChoiceLabel(lead[2] || '');
  if (!firstChoice || !secondChoice || firstChoice === secondChoice) return null;

  const rest = normalized.slice(lead[0].length);
  const allSameMatches = [...rest.matchAll(ALL_SAME_DAMAGE)];
  if (allSameMatches.length < 2) return null;

  const firstAll = allSameMatches[0];
  const secondAll = allSameMatches[1];
  const firstAllChoice = normalizeChoiceLabel(firstAll?.[1] || '');
  const secondAllChoice = normalizeChoiceLabel(secondAll?.[1] || '');
  const allFirstDamage = Number(firstAll?.[2] || '');
  const allSecondDamage = Number(secondAll?.[2] || '');
  if (!Number.isFinite(allFirstDamage) || !Number.isFinite(allSecondDamage)) return null;
  if (firstAllChoice !== firstChoice || secondAllChoice !== secondChoice) return null;

  const mixed = rest.match(MIXED_DAMAGE);
  const mixedChoice = normalizeChoiceLabel(mixed?.[2] || '');
  const mixedDamage = Number(mixed?.[1] || '');
  if (!mixed || mixedChoice !== firstChoice || !Number.isFinite(mixedDamage)) return null;

  return withMeta({
    kind: 'secret_opponent_choice_damage',
    choosers: { kind: 'each_opponent' },
    choices: [firstChoice, secondChoice],
    secret: true,
    allFirstDamage,
    allSecondDamage,
    mixedFirstDamage: mixedDamage,
    raw: rawClause,
  });
}
