// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: player-chosen hand/battlefield override for a move_zone step
//   (Emeria Shepherd Plains landfall, and the existing X-or-more destination prompt).
// Public entry symbol: applyChosenMoveZoneDestination.

import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

export function applyChosenMoveZoneDestination(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
): Extract<OracleEffectStep, { kind: 'move_zone' }> {
  const chosen = String(ctx.selectorContext?.moveZoneDestination || '').trim();
  if (chosen !== 'hand' && chosen !== 'battlefield') return step;
  if (step.to !== 'hand' && step.to !== 'battlefield') return step;
  if (chosen === step.to) return step;
  return {
    ...step,
    to: chosen,
    ...(chosen === 'battlefield' && !step.battlefieldController
      ? { battlefieldController: { kind: 'you' as const } }
      : {}),
  };
}
