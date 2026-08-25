/**
 * Origin parent: oracleIRExecutorDamageStepHandlers.ts
 * Cluster moved: resolveSinglePermanentDamageTargetId
 * Public: resolveSinglePermanentDamageTargetId
 */

import type { GameState } from '../../../shared/src';
import type { OracleEffectStep } from '../oracleIR';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import { hasExecutorClass } from '../oracleIRExecutorPermanentUtils';

export function resolveSinglePermanentDamageTargetId(
  state: GameState,
  target: Extract<OracleEffectStep, { kind: 'deal_damage' }>['target'],
  ctx: OracleIRExecutionContext
): string | undefined {
  if (target.kind !== 'raw') return undefined;

  const targetText = String(target.text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]$/, '');
  if (targetText !== 'any target' && targetText !== 'target') return undefined;

  const candidateIds = [
    String(ctx.targetPermanentId || '').trim(),
    String(ctx.targetCreatureId || '').trim(),
    ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) && ctx.selectorContext.chosenObjectIds.length === 1
      ? [String(ctx.selectorContext.chosenObjectIds[0] || '').trim()]
      : []),
  ].filter(Boolean);

  if (candidateIds.length === 0) return undefined;

  const rawLower = String((ctx as any)?.currentStepRaw || '').trim().toLowerCase();
  if (/target creature/.test(rawLower) || /dealt to target creature/.test(rawLower)) {
    return candidateIds[0];
  }

  const battlefield = (state.battlefield || []) as any[];
  for (const candidateId of candidateIds) {
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === candidateId);
    if (!matched) continue;
    if (
      hasExecutorClass(matched, 'creature') ||
      hasExecutorClass(matched, 'planeswalker') ||
      hasExecutorClass(matched, 'battle')
    ) {
      return candidateId;
    }
  }

  return undefined;
}

