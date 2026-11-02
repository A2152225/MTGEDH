import { describe, expect, it } from 'vitest';
import { CANNOT_PAY_COST_REASON, handCastAffordabilityReason } from './handCastAffordability';

describe('handCastAffordabilityReason', () => {
  it('blocks a hand card missing from playableCards', () => {
    expect(handCastAffordabilityReason(['bears'], 'throne')).toBe(CANNOT_PAY_COST_REASON);
    expect(handCastAffordabilityReason([], 'throne')).toBe(CANNOT_PAY_COST_REASON);
  });
  it('allows a hand card listed in playableCards', () => {
    expect(handCastAffordabilityReason(['bears', 'throne'], 'throne')).toBeNull();
  });
  it('does not block when the server sent no list or the card has no id', () => {
    expect(handCastAffordabilityReason(undefined, 'throne')).toBeNull();
    expect(handCastAffordabilityReason(['bears'], '')).toBeNull();
  });
});