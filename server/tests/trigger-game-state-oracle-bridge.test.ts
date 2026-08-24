import { describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { transformPermanentToFace } from '../src/state/modules/day-night.js';
import { bridgeGameStateOracleEffectsAfterOracleIR } from '../src/state/modules/triggerGameStateOracleBridgeUtils.js';
import * as triggerVentureUtils from '../src/state/modules/triggerVentureUtils.js';

vi.mock('../src/state/modules/day-night.js', () => ({
  transformPermanentToFace: vi.fn(),
}));

describe('triggerGameStateOracleBridgeUtils', () => {
  it('sets monarch when effect text includes become the monarch', () => {
    const state = { monarch: null };

    bridgeGameStateOracleEffectsAfterOracleIR({} as any, state, {
      appliedSteps: [],
      skippedSteps: [],
      state,
      log: [],
    } as any, {
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      triggerItem: { id: 'trig-1' },
      effectText: 'you become the monarch.',
    });

    expect(state.monarch).toBe('p1');
  });

  it('queues initiative venture after take_initiative IR step', () => {
    const queueInitiativeVentureTrigger = vi.spyOn(triggerVentureUtils, 'queueInitiativeVentureTrigger').mockImplementation(() => {});
    const state = { initiative: 'p1' };

    bridgeGameStateOracleEffectsAfterOracleIR({} as any, state, {
      appliedSteps: [{ kind: 'take_initiative', raw: 'Take the initiative.' }],
      skippedSteps: [],
      state,
      log: [],
    } as any, {
      controller: 'p1' as PlayerID,
      sourceName: 'Source',
      sourceId: 'src-1',
      triggerItem: { id: 'trig-1' },
    });

    expect(queueInitiativeVentureTrigger).toHaveBeenCalledWith({}, 'p1', 'src-1');
    queueInitiativeVentureTrigger.mockRestore();
  });

  it('transforms a matching double-faced permanent from effect text', () => {
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

    bridgeGameStateOracleEffectsAfterOracleIR({} as any, { battlefield: [permanent] }, {
      appliedSteps: [],
      skippedSteps: [],
      state: { battlefield: [permanent] },
      log: [],
    } as any, {
      controller: 'p1' as PlayerID,
      sourceName: 'Test DFC',
      triggerItem: { permanentId: 'perm-1' },
      effectText: 'transform.',
    });

    expect(transformPermanentToFace).toHaveBeenCalledWith(permanent, 1, expect.anything());
  });
});
