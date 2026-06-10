import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacyThatPermanentControllerMills,
  applyRetiredTriggerLegacyTargetPlayerMills,
} from '../src/state/modules/oracleIrTriggerLegacyMillHandlers.js';
import * as triggerMillFromEffectUtils from '../src/state/modules/triggerMillFromEffectUtils.js';

describe('oracleIrTriggerLegacyMillHandlers (targeted)', () => {
  it("mills that permanent's controller via trigger mill helper", () => {
    const millPlayerCardsFromTrigger = vi.spyOn(triggerMillFromEffectUtils, 'millPlayerCardsFromTrigger').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyThatPermanentControllerMills({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: "That permanent's controller mills two cards.",
      opponents: [{ id: 'p2' }],
      state: {},
      triggerItem: {
        source: 'perm-1',
        effectData: { untappedPermanentController: 'p2' },
      },
    })).toBe(true);

    expect(millPlayerCardsFromTrigger).toHaveBeenCalledWith({}, 'p1', 'p2', 2, 'Source');
    millPlayerCardsFromTrigger.mockRestore();
  });

  it('mills target player via trigger mill helper', () => {
    const millPlayerCardsFromTrigger = vi.spyOn(triggerMillFromEffectUtils, 'millPlayerCardsFromTrigger').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyTargetPlayerMills({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'Target player mills three cards.',
      opponents: [{ id: 'p2' }],
      state: {},
      triggerItem: {
        source: 'perm-1',
        targets: ['p2'],
      },
    })).toBe(true);

    expect(millPlayerCardsFromTrigger).toHaveBeenCalledWith({}, 'p1', 'p2', 3, 'Source');
    millPlayerCardsFromTrigger.mockRestore();
  });
});
