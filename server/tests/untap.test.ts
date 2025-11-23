import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/index';
import type { PlayerID } from '../../shared/src';

describe('Untap step behavior', () => {
  it('untaps tapped permanents during controller untap step', () => {
    const g = createInitialGameState('untap_test_1');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Set p1 as active player
    g.state.turnPlayer = p1;
    g.state.phase = 'beginning' as any;
    g.state.step = 'untap' as any;

    // Create a tapped permanent for p1
    g.createToken(p1, 'Test Token', 1, 2, 2);
    const perm = g.state.battlefield[0];
    perm.tapped = true;

    expect(perm.tapped).toBe(true);

    // Trigger untap step
    g.applyUntapStep();

    expect(perm.tapped).toBe(false);
  });

  it('handles stun counters - decrements instead of untapping', () => {
    const g = createInitialGameState('untap_test_2');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.state.turnPlayer = p1;
    g.state.phase = 'beginning' as any;
    g.state.step = 'untap' as any;

    g.createToken(p1, 'Stunned Token', 1, 3, 3);
    const perm = g.state.battlefield[0];
    perm.tapped = true;
    perm.stunCounters = 1;

    g.applyUntapStep();

    expect(perm.tapped).toBe(true); // Still tapped
    expect(perm.stunCounters).toBe(0); // Counter consumed
  });

  it('handles doesNotUntapNext flag - clears flag and stays tapped', () => {
    const g = createInitialGameState('untap_test_3');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.state.turnPlayer = p1;

    g.createToken(p1, 'Frozen Token', 1, 2, 2);
    const perm = g.state.battlefield[0];
    perm.tapped = true;
    perm.doesNotUntapNext = true;

    g.applyUntapStep();

    expect(perm.tapped).toBe(true);
    expect(perm.doesNotUntapNext).toBe(false); // Flag cleared
  });

  it('handles doesNotUntapDuringUntapStep - stays tapped continuously', () => {
    const g = createInitialGameState('untap_test_4');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.state.turnPlayer = p1;

    g.createToken(p1, 'Continuous Token', 1, 2, 2);
    const perm = g.state.battlefield[0];
    perm.tapped = true;
    perm.doesNotUntapDuringUntapStep = true;

    g.applyUntapStep();

    expect(perm.tapped).toBe(true);
    expect(perm.doesNotUntapDuringUntapStep).toBe(true); // Flag persists
  });

  it('only untaps permanents controlled by active player', () => {
    const g = createInitialGameState('untap_test_5');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    g.state.turnPlayer = p1;

    // Create tapped tokens for both players
    g.createToken(p1, 'P1 Token', 1, 2, 2);
    g.createToken(p2, 'P2 Token', 1, 2, 2);
    
    g.state.battlefield[0].tapped = true;
    g.state.battlefield[1].tapped = true;

    g.applyUntapStep();

    expect(g.state.battlefield[0].tapped).toBe(false); // P1's untaps
    expect(g.state.battlefield[1].tapped).toBe(true);  // P2's stays tapped
  });
});
