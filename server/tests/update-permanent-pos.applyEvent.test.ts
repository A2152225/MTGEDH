import { describe, expect, it } from 'vitest';

import { applyEvent as applyRuntimeEvent } from '../src/state/modules/applyEvent';
import { applyEvent as applyReplayEvent } from '../src/state/modules/replay';

function createPositionTestContext() {
  return {
    state: {
      battlefield: [
        {
          id: 'perm_1',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'card_1', name: 'Test Permanent' },
        },
      ],
      zones: {},
    },
    bumpSeq() {},
  } as any;
}

describe('updatePermanentPos applyEvent support', () => {
  it('runtime applyEvent stores permanent battlefield coordinates', () => {
    const ctx = createPositionTestContext();

    applyRuntimeEvent(ctx, {
      type: 'updatePermanentPos',
      permanentId: 'perm_1',
      x: 120.4,
      y: 45.6,
      z: 2.9,
    } as any);

    expect(ctx.state.battlefield[0]).toMatchObject({
      posX: 120,
      posY: 46,
      posZ: 3,
      pos: { x: 120, y: 46, z: 3 },
    });
  });

  it('replay applyEvent restores permanent battlefield coordinates', () => {
    const ctx = createPositionTestContext();

    applyReplayEvent(ctx, {
      type: 'updatePermanentPos',
      permanentId: 'perm_1',
      x: 12,
      y: 34,
    } as any);

    expect(ctx.state.battlefield[0]).toMatchObject({
      posX: 12,
      posY: 34,
      pos: { x: 12, y: 34 },
    });
    expect((ctx.state.battlefield[0] as any).posZ).toBeUndefined();
  });
});