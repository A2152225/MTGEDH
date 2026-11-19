import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';

describe('space sculptor replay', () => {
  it('replays assignSector and sameSectorBlocks', () => {
    const game = createInitialGameState('t_space_sculptor_replay');
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.state.battlefield = [
      { id: 'bear', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' } },
    ];
    game.state.turnNumber = 2;

    game.applyEvent({ type: 'assignSector', permanentId: 'bear', sector: 'gamma', playerId: p1 });
    game.applyEvent({ type: 'sameSectorBlocks', turn: 2, playerId: p1 });

    expect(game.state.battlefield[0].sector).toBe('gamma');
    expect(game.state.spaceSculptorSectors.bear).toBe('gamma');
    expect(game.state.sameSectorBlocksTurn).toBe(2);

    game.applyEvent({ type: 'assignSector', permanentId: 'bear', sector: null, playerId: p1 });
    expect(game.state.battlefield[0].sector).toBeUndefined();
  });
});
