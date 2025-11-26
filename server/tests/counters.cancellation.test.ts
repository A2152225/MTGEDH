import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

describe('+1/+1 and -1/-1 counters annihilation via SBA', () => {
  it('cancels pairwise when adding -1/-1 onto existing +1/+1', () => {
    const g = createInitialGameState('counters_1');
    const pid = 'p1' as PlayerID;

    g.createToken(pid, 'Test Token', 1);
    const perm = g.state.battlefield[0];

    g.updateCounters(perm.id, { '+1/+1': +2 });
    expect(perm.counters?.['+1/+1']).toBe(2);
    expect(perm.counters?.['-1/-1']).toBeUndefined();

    g.updateCounters(perm.id, { '-1/-1': +3 });
    expect(perm.counters?.['+1/+1']).toBeUndefined();
    expect(perm.counters?.['-1/-1']).toBe(1);
  });

  it('removes both if counts match after updates', () => {
    const g = createInitialGameState('counters_2');
    const pid = 'p1' as PlayerID;

    g.createToken(pid, 'Test Token', 1);
    const perm = g.state.battlefield[0];

    g.updateCounters(perm.id, { '+1/+1': +1 });
    g.updateCounters(perm.id, { '-1/-1': +1 });
    expect(perm.counters?.['+1/+1']).toBeUndefined();
    expect(perm.counters?.['-1/-1']).toBeUndefined();
    // When all counters cancel out, counters may be undefined or empty object
    expect(perm.counters === undefined || Object.keys(perm.counters).length === 0).toBe(true);
  });
});