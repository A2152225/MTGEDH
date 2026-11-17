// Origin parent: oracleIRExecutorDamageStepHandlers.ts
// Cluster moved: antecedentIdsFromContext + pronounDamageSourceId ("it / that creature deals damage" source binding).
// Public entry symbol: pronounDamageSourceId.
import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

export function antecedentIdsFromContext(ctx: OracleIRExecutionContext): string[] {
  return [
    ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
    ...(Array.isArray(ctx.selectorContext?.lastAntecedentBattlefieldPermanentIds)
      ? ctx.selectorContext.lastAntecedentBattlefieldPermanentIds
      : []),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
}

/** "it / that creature deals damage" uses the entering permanent, not the ability source. */
export function pronounDamageSourceId(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'deal_damage' }>,
  ctx: OracleIRExecutionContext,
): string {
  const sourceText = String((step.source as any)?.kind === 'raw' ? (step.source as any).text : '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  if (sourceText !== 'it' && sourceText !== 'that creature' && sourceText !== 'that permanent') return '';
  const battlefield = (state.battlefield || []) as any[];
  for (const id of antecedentIdsFromContext(ctx)) {
    if (battlefield.some((permanent) => String(permanent?.id || '').trim() === id)) return id;
  }
  return '';
}
