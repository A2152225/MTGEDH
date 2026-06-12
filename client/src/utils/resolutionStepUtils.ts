/**
 * Client-side mirror of server mandatory inference for resolution prompts.
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

export function isResolutionStepMandatory(step: Record<string, unknown> | null | undefined): boolean {
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

  if (typeof step.effectText === 'string' && textIndicatesOptionalClause(step.effectText)) return false;
  if (typeof step.description === 'string' && textIndicatesOptionalClause(step.description)) return false;
  if (typeof step.message === 'string' && textIndicatesOptionalClause(step.message)) return false;
  if (typeof step.fullAbilityText === 'string' && textIndicatesOptionalAnywhere(step.fullAbilityText)) return false;
  if (typeof step.triggerText === 'string' && textIndicatesOptionalAnywhere(step.triggerText)) return false;

  return true;
}

export function isResolutionStepCancellable(step: Record<string, unknown> | null | undefined): boolean {
  return !isResolutionStepMandatory(step);
}
