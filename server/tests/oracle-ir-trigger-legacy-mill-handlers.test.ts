import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacyThatPermanentControllerMills,
  applyRetiredTriggerLegacyTargetPlayerMills,
} from '../src/state/modules/oracleIrTriggerLegacyMillHandlers.js';

describe('oracleIrTriggerLegacyMillHandlers (targeted)', () => {
  it('retired that-permanent-controller mill defers to IR uncategorized fallback', () => {
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
    })).toBe(false);
  });

  it('retired target-player mill defers to IR uncategorized fallback', () => {
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
    })).toBe(false);
  });
});
