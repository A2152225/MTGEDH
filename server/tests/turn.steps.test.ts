import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase, GameStep } from '../../shared/src';

describe('Turn step engine basics', () => {
  it('advances steps with untap and draw automation, and maps phases for main steps', () => {
    const g = createInitialGameState('t_steps_1');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Set up libraries for both players so draw step can actually draw
    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    // Start of game: nextTurn sets BEGINNING/UNTAP for p2 (since turnPlayer starts as p1 on join)
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UNTAP);

    // Put a tapped token for p2, then nextStep should untap it
    g.createToken(g.state.turnPlayer, 'Test', 1, 2, 2);
    const permId = g.state.battlefield[0].id;
    g.state.battlefield[0].tapped = true;

    g.applyEvent({ type: 'nextStep' }); // UPKEEP
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UPKEEP);
    // Untap was applied when we entered UNTAP, so token is untapped now
    const perm = g.state.battlefield.find(p => p.id === permId)!;
    expect(perm.tapped).toBe(false);

    // Capture hand count BEFORE entering draw step (draw happens when entering DRAW)
    const startHand = g.state.zones?.[g.state.turnPlayer]?.handCount ?? 0;
    g.applyEvent({ type: 'nextStep' }); // DRAW - card is drawn here
    expect(g.state.step).toBe(GameStep.DRAW);

    g.applyEvent({ type: 'nextStep' }); // MAIN1
    expect(g.state.phase).toBe(GamePhase.PRECOMBAT_MAIN);
    expect(g.state.step).toBe(GameStep.MAIN1);
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
    expect(g.state.phase).toBe(GamePhase.POSTCOMBAT_MAIN);
    expect(g.state.step).toBe(GameStep.MAIN2);

    g.applyEvent({ type: 'nextStep' }); // END
    expect(g.state.phase).toBe(GamePhase.ENDING);
    expect(g.state.step).toBe(GameStep.END);

    // When advancing from END step with no discard needed and no Sundial effect,
    // cleanup step auto-advances to next turn (Rule 514.3 - no priority during cleanup)
    const prevTurnPlayer = g.state.turnPlayer;
    g.applyEvent({ type: 'nextStep' }); // CLEANUP -> auto-advances to next turn
    expect(g.state.turnPlayer).not.toBe(prevTurnPlayer);
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UNTAP);
  });

  it('pauses at cleanup step when Sundial of the Infinite is on battlefield', () => {
    const g = createInitialGameState('t_steps_sundial');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Set up libraries for both players
    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    // Start of game
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p2);

    // Add Sundial of the Infinite to player 2's battlefield
    g.state.battlefield.push({
      id: 'sundial_1',
      controller: p2,
      card: {
        id: 'sundial_card',
        name: 'Sundial of the Infinite',
        type_line: 'Artifact',
        oracle_text: '{1}, {T}: End the turn. Activate only during your turn.',
        mana_cost: '{2}',
      },
      tapped: false,
    } as any);

    // Advance to END step
    g.applyEvent({ type: 'nextStep' }); // UPKEEP
    g.applyEvent({ type: 'nextStep' }); // DRAW
    g.applyEvent({ type: 'nextStep' }); // MAIN1
    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS
    g.applyEvent({ type: 'nextStep' }); // DAMAGE
    g.applyEvent({ type: 'nextStep' }); // END_COMBAT
    g.applyEvent({ type: 'nextStep' }); // MAIN2
    g.applyEvent({ type: 'nextStep' }); // END

    expect(g.state.phase).toBe(GamePhase.ENDING);
    expect(g.state.step).toBe(GameStep.END);

    // When advancing from END step with Sundial available, should pause at CLEANUP
    // to give player a chance to use it
    const prevTurnPlayer = g.state.turnPlayer;
    g.applyEvent({ type: 'nextStep' }); // Should stay at CLEANUP
    
    expect(g.state.turnPlayer).toBe(prevTurnPlayer); // Same player's turn
    expect(g.state.phase).toBe(GamePhase.ENDING);
    expect(g.state.step).toBe(GameStep.CLEANUP); // Paused at cleanup

    // Now if player decides to pass (not use Sundial), another nextStep should advance
    g.applyEvent({ type: 'nextStep' }); // Now should advance to next turn
    expect(g.state.turnPlayer).not.toBe(prevTurnPlayer);
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UNTAP);
  });
});