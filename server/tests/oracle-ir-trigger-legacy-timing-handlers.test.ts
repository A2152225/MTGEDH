import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyRetiredTriggerLegacyDelayedDrawAtNextUpkeep,
  applyRetiredTriggerLegacyUntapAllCreatureType,
} from '../src/state/modules/oracleIrTriggerLegacyTimingHandlers.js';
import * as triggerDelayedEffectUtils from '../src/state/modules/triggerDelayedEffectUtils.js';

describe('oracleIrTriggerLegacyTimingHandlers', () => {
  it('schedules delayed draw and stops when only library look remains', () => {
    const scheduleDelayedDrawAtNextUpkeep = vi.spyOn(
      triggerDelayedEffectUtils,
      'scheduleDelayedDrawAtNextUpkeep',
    ).mockImplementation(() => {});

    const result = applyRetiredTriggerLegacyDelayedDrawAtNextUpkeep({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'look at the top card of target player\'s library.',
      description: '{T}: Draw a card at the beginning of the next turn\'s upkeep. Look at the top card of target player\'s library.',
      descriptionForOracleFallback: '{T}: Draw a card at the beginning of the next turn\'s upkeep. Look at the top card of target player\'s library.',
      triggerItem: { source: 'perm-1' },
      state: {},
    });

    expect(result.matched).toBe(true);
    expect(result.stopProcessing).toBe(true);
    expect(scheduleDelayedDrawAtNextUpkeep).toHaveBeenCalledWith({}, expect.objectContaining({
      playerId: 'p1',
      count: 1,
    }));

    scheduleDelayedDrawAtNextUpkeep.mockRestore();
  });

  it('untaps all permanents of a creature subtype', () => {
    const ctx = { bumpSeq: vi.fn() } as any;
    const state = {
      battlefield: [{
        id: 'elf-1',
        controller: 'p1',
        tapped: true,
        card: { type_line: 'Creature — Elf' },
      }],
    };

    expect(applyRetiredTriggerLegacyUntapAllCreatureType({
      ctx,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'untap all elves you control.',
      description: 'Untap all Elves you control.',
      descriptionForOracleFallback: 'Untap all Elves you control.',
      triggerItem: {},
      state,
    })).toBe(true);

    expect(state.battlefield[0].tapped).toBe(false);
    expect(ctx.bumpSeq).toHaveBeenCalledTimes(1);
  });
});
