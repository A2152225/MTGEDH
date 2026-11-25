import { describe, expect, it } from 'vitest';
import { GamePhase, GameStep, type PlayerID } from '../../shared/src/types.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('CLEANUP advance soft-lock (stallcheck s47#143)', () => {
  it('second nextStep from CLEANUP advances the turn with empty stack/queue', () => {
    const gameId = 'cleanup_swarm_advance';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const deck = Array.from({ length: 20 }, (_, i) => ({
      id: `c_${i}`,
      name: `Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, deck);
    g.importDeckResolved(p2, deck);
    g.applyEvent({ type: 'nextTurn' });

    // Land-heavy swarm-like board (no Sundial).
    for (let i = 0; i < 40; i++) {
      (g.state.battlefield as any[]).push({
        id: `blood_${i}`,
        controller: p1,
        owner: p1,
        card: { name: 'Blood', type_line: 'Token Creature — Blood', oracle_text: '', power: '0', toughness: '1' },
        tapped: false,
      });
    }

    (g.state as any).phase = GamePhase.ENDING;
    (g.state as any).step = GameStep.CLEANUP;
    (g.state as any).priority = null;
    (g.state as any).stack = [];
    ResolutionQueueManager.removeQueue(gameId);

    const prev = g.state.turnPlayer;
    g.applyEvent({ type: 'nextStep' });
    expect(g.state.turnPlayer).not.toBe(prev);
    expect(String(g.state.step || '').toUpperCase()).toBe('UNTAP');
  });

  it('advances from CLEANUP even when a Sundial-like card is present (after proceed)', () => {
    const gameId = 'cleanup_sundial_proceed';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    const deck = Array.from({ length: 20 }, (_, i) => ({
      id: `d_${i}`,
      name: `Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, deck);
    g.importDeckResolved(p2, deck);
    g.applyEvent({ type: 'nextTurn' });

    (g.state.battlefield as any[]).push({
      id: 'sundial_1',
      controller: p1,
      owner: p1,
      card: {
        name: 'Sundial of the Infinite',
        type_line: 'Artifact',
        oracle_text: '{1}, {T}: End the turn. Activate only during your turn.',
      },
      tapped: false,
    });

    (g.state as any).phase = GamePhase.ENDING;
    (g.state as any).step = GameStep.END;
    (g.state as any).priority = p1;
    (g.state as any).stack = [];

    const prev = g.state.turnPlayer;
    g.applyEvent({ type: 'nextStep' }); // END → CLEANUP, may pause for Sundial
    expect(String(g.state.step || '').toUpperCase()).toBe('CLEANUP');

    g.applyEvent({ type: 'nextStep' }); // proceed
    expect(g.state.turnPlayer).not.toBe(prev);
  });
});
