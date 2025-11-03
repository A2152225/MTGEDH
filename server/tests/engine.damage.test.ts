import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

describe('Rules-engine damage + SBA', () => {
  it('Wither adds -1/-1 counters and cancels with +1/+1 via SBA', () => {
    const g = createInitialGameState('eng_dmg_1');
    const pid = 'p1' as PlayerID;
    g.createToken(pid, 'Test', 1, 2, 2);
    const perm = g.state.battlefield[0];
    g.updateCounters(perm.id, { '+1/+1': +2 });
    // Apply wither 3 damage via event
    g.applyEvent({ type: 'dealDamage', targetPermanentId: perm.id, amount: 3, wither: true });
    // SBA should leave one -1/-1 and zero +1/+1
    expect(perm.counters?.['+1/+1']).toBeUndefined();
    expect(perm.counters?.['-1/-1']).toBe(1);
  });

  it('0-toughness SBA removes a 1/1 token after 1 wither damage', () => {
    const g = createInitialGameState('eng_dmg_2');
    const pid = 'p1' as PlayerID;
    g.createToken(pid, 'Test', 1, 1, 1);
    const id = g.state.battlefield[0].id;
    g.applyEvent({ type: 'dealDamage', targetPermanentId: id, amount: 1, wither: true });
    // Should be removed by SBA
    expect(g.state.battlefield.find(b => b.id === id)).toBeUndefined();
  });
});