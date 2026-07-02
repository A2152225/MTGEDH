import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';

vi.mock('../src/state/modules/resolutionPromptEvents.js', () => ({
  queueResolveTopOfStackPrompt: vi.fn(),
}));

import {
  applyRetiredTriggerLegacyOptionalDiscardThenDraw,
  applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit,
} from '../src/state/modules/oracleIrTriggerLegacyCombinedHandlers.js';
import { queueResolveTopOfStackPrompt } from '../src/state/modules/resolutionPromptEvents.js';

describe('oracleIrTriggerLegacyCombinedHandlers', () => {
  it('queues optional discard-then-draw choice', () => {
    vi.mocked(queueResolveTopOfStackPrompt).mockClear();

    expect(applyRetiredTriggerLegacyOptionalDiscardThenDraw({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'You may discard a card. If you do, draw a card.',
      description: 'You may discard a card. If you do, draw a card.',
      triggerItem: { source: 'perm-1' },
      state: {},
    })).toBe(true);

    expect(queueResolveTopOfStackPrompt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueResolveTopOfStackPrompt).mock.calls[0][1].optionalDiscardThenDrawChoice).toBe(true);
  });

  it('queues sacrifice-another-permanent-for-benefit choice', () => {
    vi.mocked(queueResolveTopOfStackPrompt).mockClear();

    expect(applyRetiredTriggerLegacySacrificeAnotherPermanentForBenefit({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'You may sacrifice another permanent. If you do, you gain one life and draw a card.',
      description: 'You may sacrifice another permanent. If you do, you gain one life and draw a card.',
      triggerItem: { source: 'perm-1' },
      state: {},
    })).toBe(true);

    expect(queueResolveTopOfStackPrompt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueResolveTopOfStackPrompt).mock.calls[0][1].sacrificeAnotherPermanentForBenefitChoice).toBe(true);
  });
});
