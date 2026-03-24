import type { OracleEffectStep } from './oracleIR';
import { parseEffectLevelImpulsePermissionClause } from './oracleIRParserEffectImpulsePermission';
import { cleanImpulseClause, isIgnorableImpulseReminderClause } from './oracleIRParserImpulseClauseUtils';

export type PendingImpulseFromExileTop = { stepIndex: number; clauseIndex: number } | null;

export type PendingImpulseUpgradeResult =
  | { kind: 'none'; pending: PendingImpulseFromExileTop }
  | { kind: 'clear'; pending: null }
  | { kind: 'upgrade'; pending: null; steps: OracleEffectStep[]; nextIndex: number };

export function tryUpgradePendingExileTopToImpulse(params: {
  clauses: string[];
  currentIndex: number;
  pending: PendingImpulseFromExileTop;
  steps: OracleEffectStep[];
}): PendingImpulseUpgradeResult {
  const { clauses, currentIndex, pending, steps } = params;
  if (!pending) return { kind: 'none', pending };

  const age = currentIndex - pending.clauseIndex;
  if (age > 4) return { kind: 'clear', pending: null };

  const maxClauseIndex = Math.min(clauses.length, pending.clauseIndex + 5);
  let best: ReturnType<typeof parseEffectLevelImpulsePermissionClause> | null = null;
  let bestClauseIndex: number | null = null;

  for (let j = currentIndex; j < maxClauseIndex; j++) {
    const parsed = parseEffectLevelImpulsePermissionClause(cleanImpulseClause(clauses[j]));
    if (parsed) {
      if (!best || (best.duration === 'during_resolution' && parsed.duration !== 'during_resolution')) {
        best = parsed;
        bestClauseIndex = j;
      }
      if (parsed.duration !== 'during_resolution') break;
      continue;
    }

    if (!isIgnorableImpulseReminderClause(cleanImpulseClause(clauses[j]))) break;
  }

  if (!best || bestClauseIndex === null) return { kind: 'none', pending };

  const prev: any = steps[pending.stepIndex];
  if (!prev || prev.kind !== 'exile_top') return { kind: 'clear', pending: null };

  const combinedRaw = `${String(prev.raw || '').trim()} ${String(clauses[bestClauseIndex] || '').trim()}`.trim();
  const nextSteps = steps.slice();
  nextSteps[pending.stepIndex] = {
    kind: 'impulse_exile_top',
    who: prev.who,
    amount: prev.amount,
    duration: best.duration,
    permission: best.permission,
    ...(best.condition ? { condition: best.condition } : {}),
    ...(prev.optional ? { optional: prev.optional } : {}),
    ...(prev.sequence ? { sequence: prev.sequence } : {}),
    raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
  } as any;

  return {
    kind: 'upgrade',
    pending: null,
    steps: nextSteps,
    nextIndex: bestClauseIndex + 1,
  };
}
