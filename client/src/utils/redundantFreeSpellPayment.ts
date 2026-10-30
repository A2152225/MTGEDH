// client/src/utils/redundantFreeSpellPayment.ts
// Skips the empty "pay nothing" Cast Spell modal that follows an already-accepted
// free cast (Possibility Storm, cascade, and other "you may cast that card without
// paying its mana cost" prompts). Targets, modes, and X are separate steps and still prompt.
// Public entry: decideRedundantFreeSpellPayment, resetRedundantFreeSpellPaymentMemory.

export type RedundantFreeSpellPaymentDecision = 'submit' | 'suppress' | 'show' | 'ignore';

export interface RedundantFreeSpellPaymentResult {
  decision: RedundantFreeSpellPaymentDecision;
  stepId?: string;
  selections?: { alternateCostId: 'free'; xValue?: number };
}

const submittedStepIds = new Set<string>();
const submittedEffectIds = new Set<string>();

function isZeroManaCost(manaCost: unknown): boolean {
  const text = String(manaCost ?? '').replace(/\s+/g, '');
  return text === '' || text === '{0}' || text === '0';
}

/** Forced free cast whose payment step has no mana left to choose. */
export function isRedundantFreeSpellPaymentStep(step: any): boolean {
  if (!step || step.type !== 'mana_payment_choice') return false;
  if (step.spellPaymentRequired !== true) return false;
  if (step.wardPayment === true || step.phyrexianManaChoice === true || step.activationPaymentChoice === true) return false;
  if (step.graveyardSpellCastManaPayment === true) return false;
  if (String(step.forcedAlternateCostId || '').trim().toLowerCase() !== 'free') return false;
  if (step.castWithoutPayingManaCost !== true) return false;
  return isZeroManaCost(step.manaCost);
}

export function resetRedundantFreeSpellPaymentMemory(): void {
  submittedStepIds.clear();
  submittedEffectIds.clear();
}

/**
 * First prompt for a cast: submit free payment immediately.
 * A repeat of that same step is ignored so a double-emit cannot reopen the modal.
 * A new step for the same cast (payment failed and was re-queued) is shown.
 */
export function decideRedundantFreeSpellPayment(step: any): RedundantFreeSpellPaymentResult {
  if (!isRedundantFreeSpellPaymentStep(step)) return { decision: 'ignore' };
  const stepId = String(step?.id || '').trim();
  if (!stepId) return { decision: 'show' };
  const effectId = String(step?.effectId || '').trim();
  if (submittedStepIds.has(stepId)) return { decision: 'suppress' };
  if (effectId && submittedEffectIds.has(effectId)) return { decision: 'show' };

  submittedStepIds.add(stepId);
  if (effectId) submittedEffectIds.add(effectId);

  const xRaw = Number(step?.xValue);
  const selections: { alternateCostId: 'free'; xValue?: number } = { alternateCostId: 'free' };
  if (Number.isFinite(xRaw)) selections.xValue = Math.max(0, Math.floor(xRaw));
  return { decision: 'submit', stepId, selections };
}
