/**
 * Origin parent: rules-engine/src/oracleIRParserEffectClauseToStep.ts
 * Cluster: each-player choose-then-destroy-the-rest (Divine Reckoning family).
 * Public: tryParseEachPlayerChooseThenDestroyRest
 * Leaf must not import oracleIR.ts or oracleIRParserEffectClauseToStep.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import { normalizeOracleText } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const FLASHBACK_TAIL =
  /\s*flashback\b[\s\S]*$/i;

const EACH_PLAYER_CHOOSE_DESTROY_REST =
  /^each\s+player\s+chooses\s+(?:a|an|one)\s+(.+?)\s+they\s+control\.?\s+destroy\s+the\s+rest\.?$/i;

const PERMANENT_TYPE_WORDS = [
  'creature',
  'enchantment',
  'artifact',
  'land',
  'planeswalker',
  'battle',
  'kindred',
] as const;

function stripFlashbackAndReminders(text: string): string {
  return normalizeOracleText(String(text || ''))
    .replace(FLASHBACK_TAIL, '')
    .replace(/\s+\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '.')
    .trim();
}

function parseKeepTypes(typePhrase: string): readonly string[] {
  const phrase = String(typePhrase || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const keepTypes = PERMANENT_TYPE_WORDS.filter((typeWord) =>
    new RegExp(`\\b${typeWord}s?\\b`, 'i').test(phrase),
  );
  return keepTypes.length > 0 ? keepTypes : ['creature'];
}

export function tryParseEachPlayerChooseThenDestroyRest(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = stripFlashbackAndReminders(clause);
  if (!normalized) return null;

  const match = normalized.match(EACH_PLAYER_CHOOSE_DESTROY_REST);
  if (!match) return null;

  const keepTypes = parseKeepTypes(String(match[1] || ''));
  return withMeta({
    kind: 'each_player_choose_then_destroy_rest',
    choosers: { kind: 'each_player' },
    keepTypes,
    keepCount: 1,
    raw: rawClause,
  });
}
