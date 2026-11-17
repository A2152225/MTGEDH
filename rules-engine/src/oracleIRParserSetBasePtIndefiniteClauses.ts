/**
 * Origin parent: oracleIRParserModifyPtClauses.ts (`tryParseTemporarySetBasePtClause` handles end-of-turn setters).
 * Cluster: indefinite ("static" duration) base power/toughness setters that have no "until end of turn".
 *   - "this creature's base toughness becomes equal to <amount>"
 *   - "the base power and toughness of <creatures> become N/M" (optionally followed by the
 *     "(This effect lasts indefinitely.)" reminder)
 * Public entry: tryParseIndefiniteSetBasePtClause.
 */

import type { OracleEffectStep } from './oracleIR';

const INDEFINITE_REMINDER_SUFFIX = /\s*\(\s*this\s+effect\s+lasts\s+indefinitely\.?\s*\)\.?\s*$/i;

function normalizeIndefiniteClause(clause: string): string {
  return String(clause || '')
    .replace(INDEFINITE_REMINDER_SUFFIX, '')
    .replace(/[\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .trim();
}

export function tryParseIndefiniteSetBasePtClause(params: {
  clause: string;
  rawClause: string;
  withMeta: <T extends OracleEffectStep>(step: T) => T;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = params;
  const normalized = normalizeIndefiniteClause(clause);
  if (!normalized) return null;

  const baseToughnessEqual = normalized.match(
    /^(this creature|this permanent)(?:'s)? base toughness becomes equal to (.+)$/i,
  );
  if (baseToughnessEqual) {
    const amountText = String(baseToughnessEqual[2] || '').trim();
    if (!amountText) return null;
    return withMeta({
      kind: 'set_base_pt',
      target: { kind: 'raw', text: String(baseToughnessEqual[1] || '').trim().toLowerCase() },
      toughnessAmount: { kind: 'reference_amount', raw: amountText },
      duration: 'static',
      raw: rawClause,
    } as unknown as OracleEffectStep);
  }

  const basePtOfBecome = normalized.match(
    /^the base power and toughness of (.+?) become (\d+)\s*\/\s*(\d+)$/i,
  );
  if (basePtOfBecome) {
    return withMeta({
      kind: 'set_base_pt',
      target: { kind: 'raw', text: String(basePtOfBecome[1] || '').trim().toLowerCase() },
      power: Number.parseInt(String(basePtOfBecome[2] || '0'), 10),
      toughness: Number.parseInt(String(basePtOfBecome[3] || '0'), 10),
      duration: 'static',
      raw: rawClause,
    } as unknown as OracleEffectStep);
  }

  return null;
}
