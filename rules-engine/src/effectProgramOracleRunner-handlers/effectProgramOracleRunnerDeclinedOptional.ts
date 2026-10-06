// Declined-optional antecedent detection for Effect Program conditions.
// Public entry symbols: findDeclinedOptionalAntecedentOutcome.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.
//
// "They may pay {2}. If they don't, ..." compiles to a may-choice, a command guarded on that choice
// answering "yes", then a condition. When the player answers "no" the guarded command is skipped
// and never records a last-action outcome, so "they don't" had no antecedent to evaluate and the
// program blocked. This helper reports that skip as a declined antecedent.

import type { GameState } from '../../../shared/src';
import type { ChoiceResponse } from '../choiceEventsTypes';
import type { EffectProgramRuntime } from '../effectProgram';
import { normalizeChoiceResponseSelections } from './effectProgramOracleRunnerChoiceNormalize';

export interface DeclinedOptionalAntecedentOutcome {
  readonly kind: 'declined';
  readonly stepKind: string;
}

function choiceResponseAcceptedYes(binding: unknown): boolean {
  if (!binding || typeof binding !== 'object') return false;
  const response = binding as ChoiceResponse;
  if ((response as { readonly cancelled?: unknown }).cancelled === true) return false;
  return normalizeChoiceResponseSelections(response).some(selection => selection.trim().toLowerCase() === 'yes');
}

/**
 * Finds the nearest command before `conditionStepId`. If it was an optional ("may") command whose
 * choice was answered with anything other than "yes", returns a declined outcome for it.
 * Returns null when there is no such antecedent or the choice was accepted or not yet made.
 */
export function findDeclinedOptionalAntecedentOutcome(
  runtime: EffectProgramRuntime<GameState>,
  conditionStepId: string
): DeclinedOptionalAntecedentOutcome | null {
  const steps = runtime.program.steps;
  const conditionIndex = steps.findIndex(step => step.id === conditionStepId);
  if (conditionIndex <= 0) return null;

  for (let index = conditionIndex - 1; index >= 0; index -= 1) {
    const step = steps[index] as any;
    if (step?.kind === 'note' || step?.kind === 'choice') continue;
    if (step?.kind !== 'command') return null;

    const guard = step.guard;
    if (!guard || guard.selectionIncludes !== 'yes' || !guard.bindingKey) return null;
    const binding = runtime.bindings[guard.bindingKey];
    if (binding === undefined) return null;
    if (choiceResponseAcceptedYes(binding)) return null;

    const stepKind = step.command?.kind === 'oracle_ir_step'
      ? String(step.command.step?.kind || 'unknown')
      : String(step.command?.kind || 'unknown');
    return { kind: 'declined', stepKind };
  }

  return null;
}
