/**
 * Assimilate keyword action (Star Trek trk/trc) lowered onto existing IR steps.
 *  - a card (graveyard / exile / revealed): move_zone to the battlefield under your control with a +1/+1
 *    counter and battlefieldAssimilate (type line becomes a Borg artifact creature on entry).
 *  - a permanent on the battlefield: gain_control (indefinite) with assimilate (counter + Borg type after control).
 * Public entry symbols: lowerAssimilateKeywordAction.
 */
import type { OracleEffectStep } from './oracleIR';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { normalizeClauseForParse } from './oracleIRParserUtils';

function parseOne(rawClause: string, sequence?: 'then'): OracleEffectStep | null {
  const normalized = normalizeClauseForParse(rawClause);
  const withMeta = <T extends OracleEffectStep>(candidate: T): T => {
    const out: any = { ...candidate };
    if (sequence) out.sequence = sequence;
    return out;
  };
  return (
    tryParseSimpleActionClause({ clause: normalized.clause, rawClause, withMeta }) ??
    tryParseZoneAndRemovalClause({ clause: normalized.clause, rawClause, withMeta })
  );
}

function isCardObject(obj: string): boolean {
  return /\bcards?\b/i.test(obj) || /\brevealed\b|\bexiled\b/i.test(obj);
}

export function lowerAssimilateKeywordAction(normalized: string, sequence?: 'then'): OracleEffectStep | null {
  const m = String(normalized || '').replace(/\s*\(.*$/, '').replace(/[.]+$/, '').match(/^assimilate\s+(.+)$/i);
  if (!m) return null;
  const obj = String(m[1] || '').trim();
  if (!obj) return null;
  if (isCardObject(obj)) {
    const candidates = [
      `return ${obj} to the battlefield under your control`,
      `put ${obj} onto the battlefield under your control`,
    ];
    for (const clause of candidates) {
      const parsed: any = parseOne(clause, sequence);
      if (parsed?.kind === 'move_zone' && parsed.to === 'battlefield') {
        const withCounters = { ...(parsed.withCounters || {}) };
        withCounters['+1/+1'] = Number(withCounters['+1/+1'] || 0) + 1;
        return { ...parsed, withCounters, battlefieldAssimilate: true, raw: normalized } as OracleEffectStep;
      }
    }
    return null;
  }
  const parsed: any = parseOne(`gain control of ${obj}`, sequence);
  if (parsed?.kind === 'gain_control') {
    return { ...parsed, duration: 'indefinite', assimilate: true, raw: normalized } as OracleEffectStep;
  }
  return null;
}
