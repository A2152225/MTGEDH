/**
 * Infer whether a resolution step must be completed (cannot be cancelled/declined).
 * Optional "you may" effects should remain cancellable even when callers omit mandatory: false.
 */

function textIndicatesOptionalClause(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  return /^you may\b/i.test(trimmed);
}

function textIndicatesOptionalAnywhere(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  return /\byou may\b/i.test(trimmed);
}

export function inferResolutionStepMandatory(step: Record<string, unknown> | null | undefined): boolean {
  if (!step || typeof step !== 'object') return true;

  if (step.mandatory === false) return false;

  if (
    step.optional === true ||
    step.isOptional === true ||
    step.mayAbilityPrompt === true ||
    step.optionalTriggeredAbilityPrompt === true
  ) {
    return false;
  }

  const family = String(step.effectProgramFamily ?? '').trim();
  if (
    step.effectProgramPrompt === true &&
    (family === 'optional_triggered_ability' || family === 'optional_payment')
  ) {
    return false;
  }

  if (step.mandatory === true) return true;

  const effectText = step.effectText;
  if (typeof effectText === 'string' && textIndicatesOptionalClause(effectText)) return false;

  const description = step.description;
  if (typeof description === 'string' && textIndicatesOptionalClause(description)) return false;

  const message = step.message;
  if (typeof message === 'string' && textIndicatesOptionalClause(message)) return false;

  const fullAbilityText = step.fullAbilityText;
  if (typeof fullAbilityText === 'string' && textIndicatesOptionalAnywhere(fullAbilityText)) return false;

  const triggerText = step.triggerText;
  if (typeof triggerText === 'string' && textIndicatesOptionalAnywhere(triggerText)) return false;

  return true;
}

export function normalizeResolutionStepMandatory<T extends object>(step: T): T {
  return {
    ...step,
    mandatory: inferResolutionStepMandatory(step as Record<string, unknown>),
  };
}
