import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { transformPermanentToFace } from '../src/state/modules/day-night.js';
import { applyRetiredTriggerLegacyGameStateOracleHooks } from '../src/state/modules/oracleIrTriggerLegacyGameStateHooks.js';
import * as triggerVentureUtils from '../src/state/modules/triggerVentureUtils.js';

vi.mock('../src/state/modules/day-night.js', () => ({
  transformPermanentToFace: vi.fn(),
}));

describe('oracleIrTriggerLegacyGameStateHooks', () => {
  it('sets monarch and continues processing', () => {
    const state = { monarch: null };

    expect(applyRetiredTriggerLegacyGameStateOracleHooks({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'you become the monarch.',
      triggerItem: {},
      state,
      triggerSourceId: 'src-1',
    })).toBe(false);

    expect(state.monarch).toBe('p1');
  });

  it('returns true after venture into the dungeon', () => {
    const resolveVentureProgress = vi.spyOn(triggerVentureUtils, 'resolveVentureProgress').mockImplementation(() => {});

    expect(applyRetiredTriggerLegacyGameStateOracleHooks({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      desc: 'venture into the dungeon.',
      triggerItem: {},
      state: {},
      triggerSourceId: 'src-1',
    })).toBe(true);

    expect(resolveVentureProgress).toHaveBeenCalledWith({}, 'p1', 'Source', 'src-1', 'dungeon');
    resolveVentureProgress.mockRestore();
  });

  it('transforms a matching double-faced permanent', () => {
    const permanent = {
      id: 'perm-1',
      controller: 'p1',
      transformed: false,
      card: {
        name: 'Test DFC',
        layout: 'transform',
        card_faces: [{ name: 'Front' }, { name: 'Back' }],
      },
    };

    expect(applyRetiredTriggerLegacyGameStateOracleHooks({
      ctx: {} as any,
      controller: 'p1' as PlayerID,
      sourceName: 'Test DFC',
      desc: 'transform.',
      triggerItem: { permanentId: 'perm-1' },
      state: { battlefield: [permanent] },
      triggerSourceId: 'src-1',
    })).toBe(true);

    expect(transformPermanentToFace).toHaveBeenCalledWith(permanent, 1);
  });
});
