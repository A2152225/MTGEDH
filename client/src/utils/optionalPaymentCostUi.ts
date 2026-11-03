// UI42: optional-payment OPTION_CHOICE (e.g. Lorca's graveyard trigger: pay_mana / decline + {B}).
// Make sure the pay option always shows its cost, even when the server label is just "Pay".
import type { OptionChoiceOption } from '../components/OptionChoiceModal';

export function decorateOptionalPaymentCost(step: Record<string, unknown>, options: OptionChoiceOption[]): OptionChoiceOption[] {
  const cost = String(step.optionalPaymentManaCost || (step.optionalPaymentPrompt === true ? step.manaCost || '' : '') || '').trim();
  const payId = String(step.optionalPaymentPayChoiceId || 'pay_mana').trim();
  if (!cost || !Array.isArray(options)) return options;
  return options.map((opt: any) => {
    if (String(opt?.id || '') !== payId) return opt;
    const label = String(opt?.label || 'Pay');
    return label.includes(cost) ? opt : { ...opt, label: `${label.replace(/\s+$/, '')} ${cost}` };
  });
}