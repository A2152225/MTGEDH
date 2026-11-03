import { describe, it, expect } from 'vitest';
import { buildGenericOptionChoiceRequestFromStep } from './resolutionChoicePrimitives';
import { decorateOptionalPaymentCost } from './optionalPaymentCostUi';

const lorcaStep = (payLabel: string) => ({
  id: 'st1', type: 'option_choice', sourceName: 'Lorca', description: 'Lorca: you may pay {B}. If you do, return it.',
  options: [{ id: 'pay_mana', label: payLabel, description: 'If you do: return it' }, { id: 'decline', label: 'Decline' }],
  optionalPaymentPrompt: true, optionalPaymentManaCost: '{B}', optionalPaymentPayChoiceId: 'pay_mana', optionalPaymentDeclineChoiceId: 'decline',
  minSelections: 0, maxSelections: 1,
});

describe('ui42 optional payment cost (Lorca)', () => {
  it('generic option modal shows the {B} cost and keeps pay_mana/decline ids', () => {
    const req: any = buildGenericOptionChoiceRequestFromStep(lorcaStep('Pay {B}') as any, 'g', false);
    expect(req.options.map((o: any) => o.id)).toEqual(['pay_mana', 'decline']);
    expect(req.options[0].label).toBe('Pay {B}');
  });
  it('appends the cost when the server label omits it', () => {
    const req: any = buildGenericOptionChoiceRequestFromStep(lorcaStep('Pay') as any, 'g', false);
    expect(req.options[0].label).toBe('Pay {B}');
    expect(req.options[1].label).toBe('Decline');
  });
  it('no-op without an optional payment cost', () => {
    const opts: any = [{ id: 'a', label: 'A' }];
    expect(decorateOptionalPaymentCost({ id: 'x' }, opts)).toBe(opts);
  });
});