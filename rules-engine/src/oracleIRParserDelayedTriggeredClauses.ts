import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';

type DelayedTriggerTiming =
  | 'next_end_step'
  | 'your_next_end_step'
  | 'next_upkeep'
  | 'your_next_upkeep'
  | 'when_dealt_damage';

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
  {
    timing: 'next_upkeep',
    leading: /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+turn(?:'|')?s\s+upkeep,\s*(.+)$/i,
    trailing: /^(.+?)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+turn(?:'|')?s\s+upkeep\s*$/i,
  },
];

function normalizeEffectText(rawEffect: string): string {
  return normalizeOracleText(rawEffect).replace(/[.]+$/g, '').trim();
}

function isCompoundCreateTokenTrailingTimingClause(effect: string): boolean {
  const normalized = normalizeEffectText(effect).toLowerCase();
  if (!normalized) return false;
  if (/\bfor each\b/.test(normalized) && /\bcreate\b/.test(normalized) && /\btoken\b/.test(normalized)) {
    return true;
  }
  if (/\bfor each\b.+\bdestroyed this way\b/.test(normalized)) return true;
  return false;
}

export function tryParseDelayedTriggerClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  // Reflexive "When you do" (CR 603.12) is a delayed trigger on the same ability,
  // not a new triggered ability line. Keep it as on_event so the server can queue
  // it immediately after the antecedent (e.g. create a token).
  const whenYouDo = clause.match(/^when you do(?: so)?,?\s*(.+)$/i);
  if (whenYouDo) {
    const effect = normalizeEffectText(String(whenYouDo[1] || ''));
    if (effect) {
      return withMeta({
        kind: 'schedule_delayed_trigger',
        timing: 'on_event',
        effect,
        raw: rawClause,
      });
    }
  }

  // Arcbond-style: "Whenever that creature is dealt damage this turn, …"
  const dealtDamageThisTurn = clause.match(
    /^whenever that creature is dealt damage this turn,?\s*(.+)$/i,
  );
  if (dealtDamageThisTurn) {
    const effect = normalizeEffectText(String(dealtDamageThisTurn[1] || ''));
    if (effect) {
      return withMeta({
        kind: 'schedule_delayed_trigger',
        timing: 'when_dealt_damage',
        effect,
        raw: rawClause,
      });
    }
  }

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
      if (/^create(?:s)?\b/i.test(effect)) return null;
      if (isCompoundCreateTokenTrailingTimingClause(effect)) return null;
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
