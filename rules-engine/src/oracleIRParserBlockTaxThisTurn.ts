/**
 * Origin parent: oracleIRParserEffectClauseToStep.ts
 * Cluster: this-turn “creatures can't block unless their controller pays {N}/{X}”
 *   (War Cadence activation). Continuous Archangel “as long as this creature is
 *   attacking” stays StaticEffectSpec. Idle War Cadence must not tax.
 * Public: tryParseBlockTaxThisTurnClause
 * Leaf must not import oracleIRParserEffectClauseToStep.ts or oracleIRParserSimpleActionClauses.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep.js';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const ACTIVATED_COST_PREFIX =
  /^(?:(?:\{[^}]+\}|\{T\})\s*,?\s*)+:\s*(.+)$/i;

const MANA = '\\{(?:X|\\d+)\\}';
const PAY = `unless\\s+their\\s+controller\\s+pays\\s+(${MANA})`;
const EACH = '(?:\\s+for\\s+each\\s+(?:blocking\\s+creature\\s+they\\s+control|of\\s+those\\s+creatures))?';
const BLOCK_GLOBAL = 'can(?:not|\'t|’t)\\s+block';

const THIS_TURN_LEADING = new RegExp(
  `^this\\s+turn,?\\s+creatures\\s+${BLOCK_GLOBAL}\\s+${PAY}${EACH}\\.?$`,
  'i',
);

const THIS_TURN_TRAILING = new RegExp(
  `^creatures\\s+${BLOCK_GLOBAL}\\s+${PAY}${EACH}\\s+this\\s+turn\\.?$`,
  'i',
);

function stripActivatedCostPrefix(clause: string): string {
  const match = String(clause || '').trim().match(ACTIVATED_COST_PREFIX);
  return match ? String(match[1] || '').trim() : String(clause || '').trim();
}

function manaFromMatch(match: RegExpMatchArray | null): string {
  return String(match?.[1] || '').trim();
}

export function tryParseBlockTaxThisTurnClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): Extract<OracleEffectStep, { kind: 'grant_static_ability' }> | null {
  const { rawClause, withMeta } = args;
  const clause = normalizeOracleText(String(args.clause || ''))
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
  if (!clause) return null;

  const body = stripActivatedCostPrefix(clause);
  const match = body.match(THIS_TURN_LEADING) || body.match(THIS_TURN_TRAILING);
  if (!match) return null;

  const mana = manaFromMatch(match);
  if (!mana) return null;

  return withMeta({
    kind: 'grant_static_ability',
    target: parseObjectSelector('creatures'),
    effectText: [`can't block unless their controller pays ${mana}`],
    duration: 'this_turn',
    raw: rawClause,
  });
}
