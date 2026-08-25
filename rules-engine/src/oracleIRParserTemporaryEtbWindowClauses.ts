/**
 * Origin parent: rules-engine/src/oracleIRParserEffectClauseToStep.ts
 * Cluster: delayed this-turn ETB windows created by instant/sorcery resolution
 *   (Rite of Harmony family: "Whenever a [types] you control enters this turn, [effect]").
 * Public: isTemporaryEtbWindowSpellLine, tryParseTemporaryEtbWindowClause
 * Leaf must not import oracleIR.ts or oracleIRParserEffectClauseToStep.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep.js';
import { normalizeOracleText } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const PERMANENT_TYPE_WORDS = [
  'creature',
  'enchantment',
  'artifact',
  'land',
  'planeswalker',
  'battle',
  'kindred',
] as const;

const YOU_CONTROL_ENTERS_THIS_TURN =
  /^whenever\s+a(?:n)?\s+(.+?)\s+you\s+control\s+enters(?:\s+the\s+battlefield)?\s+this\s+turn,?\s*(.+)$/i;
const ENTERS_UNDER_YOUR_CONTROL_THIS_TURN =
  /^whenever\s+a(?:n)?\s+(.+?)\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control\s+this\s+turn,?\s*(.+)$/i;

export function isTemporaryEtbWindowSpellLine(text: string): boolean {
  const normalized = normalizeOracleText(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return YOU_CONTROL_ENTERS_THIS_TURN.test(normalized) || ENTERS_UNDER_YOUR_CONTROL_THIS_TURN.test(normalized);
}

function parseWatchTypes(typePhrase: string): {
  readonly watchTypes: readonly string[];
  readonly nontokenOnly: boolean;
} {
  const phrase = String(typePhrase || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const nontokenOnly = /\bnontoken\b/.test(phrase);
  const watchTypes = PERMANENT_TYPE_WORDS.filter((typeWord) =>
    new RegExp(`\\b${typeWord}s?\\b`, 'i').test(phrase),
  );
  return {
    watchTypes: watchTypes.length > 0 ? watchTypes : ['creature'],
    nontokenOnly,
  };
}

function trimEffectText(effectText: string): string {
  return String(effectText || '')
    .replace(/\s+\([^)]*$/g, '')
    .replace(/[.]+$/g, '')
    .trim();
}

export function tryParseTemporaryEtbWindowClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = normalizeOracleText(clause).replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const match = normalized.match(YOU_CONTROL_ENTERS_THIS_TURN)
    ?? normalized.match(ENTERS_UNDER_YOUR_CONTROL_THIS_TURN);
  if (!match) return null;

  const effect = trimEffectText(String(match[2] || ''));
  if (!effect) return null;

  const { watchTypes, nontokenOnly } = parseWatchTypes(String(match[1] || ''));
  return withMeta({
    kind: 'grant_temporary_etb_trigger',
    watchTypes,
    ...(nontokenOnly ? { nontokenOnly: true } : {}),
    effect,
    duration: 'until_end_of_turn',
    raw: rawClause,
  } as OracleEffectStep);
}
