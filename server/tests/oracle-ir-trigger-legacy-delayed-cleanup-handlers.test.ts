import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { applyDelayedCleanupTriggersFromMetadata } from '../src/state/modules/triggerDelayedCleanupUtils.js';

describe('triggerDelayedCleanupUtils draw action', () => {
  it('draws cards when delayedAction is draw', () => {
    const drawCard = { id: 'draw_card_1', name: 'Card', type_line: 'Instant' };
    const playerId = 'p1' as PlayerID;
    const state: any = {
      zones: {
        [playerId]: { hand: [], handCount: 0, libraryCount: 1 },
      },
    };
    const ctx: any = {
      state,
      libraries: new Map([[playerId, [{ ...drawCard }]]]),
      bumpSeq: () => {},
    };

    const handled = applyDelayedCleanupTriggersFromMetadata({
      ctx,
      controller: playerId,
      sourceName: "Mishra's Bauble",
      triggerItem: {
        delayedAction: 'draw',
        delayedDrawCount: 1,
        delayedSourceName: "Mishra's Bauble",
      },
      state,
    });

    expect(handled).toBe(true);
    expect(state.zones[playerId].hand.map((c: any) => c.id)).toEqual(['draw_card_1']);
    expect(ctx.libraries.get(playerId)).toHaveLength(0);
  });
});
