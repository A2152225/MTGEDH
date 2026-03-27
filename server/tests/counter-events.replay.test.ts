import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('counter event replay semantics', () => {
  it('replays counter_moved by moving one counter between permanents', () => {
    const game = createInitialGameState('t_counter_moved_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'source_perm',
        controller: p1,
        owner: p1,
        counters: { charge: 2 },
        card: { id: 'source_card', name: 'Source', type_line: 'Artifact' },
      },
      {
        id: 'target_perm',
        controller: p1,
        owner: p1,
        counters: { charge: 1 },
        card: { id: 'target_card', name: 'Target', type_line: 'Artifact' },
      },
    ];

    game.applyEvent({
      type: 'counter_moved',
      playerId: p1,
      sourcePermanentId: 'source_perm',
      targetPermanentId: 'target_perm',
      counterType: 'charge',
      source: 'Power Conduit',
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    const source = battlefield.find((perm: any) => perm.id === 'source_perm');
    const target = battlefield.find((perm: any) => perm.id === 'target_perm');
    expect(source?.counters).toEqual({ charge: 1 });
    expect(target?.counters).toEqual({ charge: 2 });
  });

  it('replays counterTargetChosen by adding a counter to the chosen permanent', () => {
    const game = createInitialGameState('t_counter_target_chosen_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'target_perm',
        controller: p1,
        owner: p1,
        counters: {},
        card: { id: 'target_card', name: 'Target', type_line: 'Creature' },
      },
    ];

    game.applyEvent({
      type: 'counterTargetChosen',
      playerId: p1,
      sourceName: 'Basri Ket',
      targetId: 'target_perm',
      targetName: 'Target',
      counterType: '+1/+1',
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    const target = battlefield.find((perm: any) => perm.id === 'target_perm');
    expect(target?.counters).toEqual({ '+1/+1': 1 });
  });
});