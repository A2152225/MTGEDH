import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/index';
import type { PlayerID, KnownCardRef } from '../../shared/src';

describe('Turn step engine basics', () => {
  it('advances steps with untap and draw automation, and maps phases for main steps', () => {
    const g = createInitialGameState('t_steps_1');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Start of game: nextTurn sets BEGINNING/UNTAP for p2 (since turnPlayer starts as p1 on join)
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.phase).toBe('beginning');
    expect(g.state.step).toBe('untap');

    // Put a tapped token for p2, then nextStep should untap it
    g.createToken(g.state.turnPlayer, 'Test', 1, 2, 2);
    const permId = g.state.battlefield[0].id;
    g.state.battlefield[0].tapped = true;

    g.applyEvent({ type: 'nextStep' }); // UPKEEP
    expect(g.state.phase).toBe('beginning');
    expect(g.state.step).toBe('upkeep');
    // Untap was applied when we entered UNTAP, so token is untapped now
    const perm = g.state.battlefield.find(p => p.id === permId)!;
    expect(perm.tapped).toBe(false);

    g.applyEvent({ type: 'nextStep' }); // DRAW
    expect(g.state.step).toBe('draw');

    const startHand = g.state.zones?.[g.state.turnPlayer]?.handCount ?? 0;
    g.applyEvent({ type: 'nextStep' }); // MAIN1
    expect(g.state.phase).toBe('precombatMain');
    expect(g.state.step).toBe('main');
    const afterHand = g.state.zones?.[g.state.turnPlayer]?.handCount ?? 0;
    expect(afterHand).toBe(startHand + 1);

    // Advance to MAIN2 and then END/CLEANUP then turn rolls
    // Skip through combat micro-steps
    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS
    g.applyEvent({ type: 'nextStep' }); // DAMAGE
    g.applyEvent({ type: 'nextStep' }); // END_COMBAT
    g.applyEvent({ type: 'nextStep' }); // MAIN2
    expect(g.state.phase).toBe('postcombatMain');
    expect(g.state.step).toBe('main');

    g.applyEvent({ type: 'nextStep' }); // END
    expect(g.state.phase).toBe('ending');
    expect(g.state.step).toBe('endStep');

    g.applyEvent({ type: 'nextStep' }); // CLEANUP
    expect(g.state.step).toBe('cleanup');

    const prevTurnPlayer = g.state.turnPlayer;
    g.applyEvent({ type: 'nextStep' }); // rolls to next turn (UNTAP)
    expect(g.state.turnPlayer).not.toBe(prevTurnPlayer);
    expect(g.state.phase).toBe('beginning');
    expect(g.state.step).toBe('untap');
  });
});