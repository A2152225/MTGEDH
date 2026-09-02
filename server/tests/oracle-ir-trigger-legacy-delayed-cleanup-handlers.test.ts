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

  it('destroys bound permanents when delayedAction is destroy', () => {
    const playerId = 'p1' as PlayerID;
    const state: any = {
      battlefield: [
        {
          id: 'equipped_1',
          controller: 'p2',
          owner: 'p2',
          card: {
            id: 'equipped_1_card',
            name: 'Bear',
            type_line: 'Creature — Bear',
            oracle_text: '',
          },
        },
      ],
      stack: [],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: {
        p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
        p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      },
    };
    const ctx: any = {
      state,
      bumpSeq: () => {},
      commandZone: {},
    };

    const handled = applyDelayedCleanupTriggersFromMetadata({
      ctx,
      controller: playerId,
      sourceName: 'Corrosive Ooze',
      triggerItem: {
        delayedAction: 'destroy',
        delayedPermanentIds: ['equipped_1'],
        delayedSourceName: 'Corrosive Ooze',
      },
      state,
    });

    expect(handled).toBe(true);
    expect(state.battlefield).toHaveLength(0);
    expect(state.zones.p2.graveyard.map((c: any) => c.id)).toEqual(['equipped_1_card']);
  });
});
