import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacyGenericSearchLibrary,
  applyRetiredTriggerLegacyProteanHulkSearch,
} from '../src/state/modules/oracleIrTriggerLegacySearchHandlers.js';
import * as triggerLibrarySearchUtils from '../src/state/modules/triggerLibrarySearchUtils.js';

describe('oracleIrTriggerLegacySearchHandlers', () => {
  it('queues Protean Hulk search via library search util', () => {
    const enqueueLibrarySearchStep = vi.spyOn(triggerLibrarySearchUtils, 'enqueueLibrarySearchStep').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyProteanHulkSearch({
      ctx: { gameId: 'g1' } as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Protean Hulk',
      desc: 'Search your library for any number of creature cards with total mana value 6 or less and put them onto the battlefield.',
      triggerItem: { source: 'hulk-1' },
      state: {},
    })).toBe(true);

    expect(enqueueLibrarySearchStep).toHaveBeenCalledWith(
      expect.anything(),
      'p1',
      expect.objectContaining({
        maxTotalManaValue: 6,
        destination: 'battlefield',
        filter: { types: ['creature'] },
      }),
    );

    enqueueLibrarySearchStep.mockRestore();
  });

  it('returns false for non-matching search text', () => {
    expect(applyRetiredTriggerLegacyGenericSearchLibrary({
      ctx: { gameId: 'g1', libraries: new Map([['p1', []]]) } as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'Draw a card.',
      triggerItem: {},
      state: { players: [{ id: 'p1' }] },
    })).toBe(false);
  });

  it('skips generic search when library is empty', () => {
    expect(applyRetiredTriggerLegacyGenericSearchLibrary({
      ctx: { gameId: 'g1', libraries: new Map([['p1', []]]) } as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Rampant Growth',
      desc: 'Search your library for a basic land card, put it onto the battlefield, then shuffle.',
      triggerItem: {},
      state: { players: [{ id: 'p1' }] },
    })).toBe(true);
  });
});
