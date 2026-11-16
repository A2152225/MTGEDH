import { describe, expect, it } from 'vitest';
import { applyStateBasedActions } from '../src/rules-engine/index.js';

describe('applyStateBasedActions life desync (704.5a)', () => {
  it('marks playersLost when player.life is <=0 even if state.life map is stale', () => {
    const state = {
      players: [
        { id: 'p1', life: 40 },
        { id: 'p2', life: 0 },
        { id: 'p3', life: -3 },
      ],
      life: { p1: 40, p2: 12, p3: 8 },
      battlefield: [],
    };
    const res = applyStateBasedActions(state as any);
    expect(res.playersLost).toEqual(expect.arrayContaining(['p2', 'p3']));
    expect(res.playersLost).not.toContain('p1');
  });

  it('marks playersLost when state.life map is <=0 even if player.life is stale', () => {
    const state = {
      players: [
        { id: 'p1', life: 40 },
        { id: 'p2', life: 15 },
      ],
      life: { p1: 40, p2: 0 },
      battlefield: [],
    };
    const res = applyStateBasedActions(state as any);
    expect(res.playersLost).toContain('p2');
  });
});
