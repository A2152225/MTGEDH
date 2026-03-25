import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

type DelayedTriggerTiming =
  | 'next_end_step'
  | 'your_next_end_step'
  | 'next_upkeep'
  | 'your_next_upkeep';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const TIMING_SPECS: readonly {
  readonly timing: DelayedTriggerTiming;
  readonly leading: RegExp;
  readonly trailing: RegExp;
}[] = [
  {
    timing: 'next_end_step',
    leading: /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step,\s*(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step\s*$/i,
  },
  {
    timing: 'your_next_end_step',
    leading: /^at\s+the\s+beginning\s+of\s+your\s+next\s+end\s+step,\s*(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+your\s+next\s+end\s+step\s*$/i,
  },
  {
    timing: 'next_upkeep',
    leading: /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+upkeep,\s*(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+upkeep\s*$/i,
  },
  {
    timing: 'your_next_upkeep',
    leading: /^at\s+the\s+beginning\s+of\s+your\s+next\s+upkeep,\s*(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+your\s+next\s+upkeep\s*$/i,
  },
];

function normalizeEffectText(rawEffect: string): string {
  return normalizeOracleText(rawEffect).replace(/[.]+$/g, '').trim();
}

export function tryParseDelayedTriggerClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  for (const spec of TIMING_SPECS) {
    const leading = clause.match(spec.leading);
    if (leading) {
      const effect = normalizeEffectText(String(leading[1] || ''));
      if (!effect) return null;
      return withMeta({
        kind: 'schedule_delayed_trigger',
        timing: spec.timing,
        effect,
        raw: rawClause,
      });
    }

    const trailing = clause.match(spec.trailing);
    if (trailing) {
      const effect = normalizeEffectText(String(trailing[1] || ''));
      if (!effect) return null;
      return withMeta({
        kind: 'schedule_delayed_trigger',
        timing: spec.timing,
        effect,
        raw: rawClause,
      });
    }
  }

  return null;
}
