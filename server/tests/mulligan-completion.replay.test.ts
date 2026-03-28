import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('mulligan completion replay semantics', () => {
  it('replays keepHand by preserving mulligan bookkeeping', () => {
    const game = createInitialGameState('t_keep_hand_replay');
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');

    (game.state as any).mulliganState = {
      [p1]: {
        hasKeptHand: false,
        mulligansTaken: 2,
        pendingBottomCount: 2,
        pendingBottomStepId: 'bottom_step_1',
      },
    };

    game.applyEvent({
      type: 'keepHand',
      playerId: p1,
      mulligansTaken: 2,
    } as any);

    expect((game.state as any).mulliganState?.[p1]).toEqual({
      hasKeptHand: true,
      mulligansTaken: 2,
      pendingBottomCount: 0,
      pendingBottomStepId: null,
    });
  });

  it('replays mulliganPutToBottom by moving cards and preserving final mulligan state', () => {
    const game = createInitialGameState('t_mulligan_put_to_bottom_replay');
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');

    game.importDeckResolved(p1, [
      { id: 'lib_1', name: 'Plains', type_line: 'Basic Land — Plains', zone: 'library' },
    ] as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'hand_1', name: 'Island', type_line: 'Basic Land — Island', zone: 'hand' },
          { id: 'hand_2', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'hand' },
          { id: 'hand_3', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'hand' },
        ],
        handCount: 3,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 1,
      },
    };
    (game.state as any).mulliganState = {
      [p1]: {
        hasKeptHand: false,
        mulligansTaken: 2,
        pendingBottomCount: 2,
        pendingBottomStepId: 'bottom_step_2',
      },
    };

    game.applyEvent({
      type: 'mulliganPutToBottom',
      playerId: p1,
      cardIds: ['hand_2', 'hand_1'],
      mulligansTaken: 2,
    } as any);

    expect(((game.state as any).zones?.[p1]?.hand || []).map((card: any) => card.id)).toEqual(['hand_3']);
    expect((game.state as any).zones?.[p1]?.handCount).toBe(1);
    expect((game.state as any).zones?.[p1]?.libraryCount).toBe(3);
    expect(game.peekTopN(p1, 10).map((card: any) => card.id)).toEqual(['lib_1', 'hand_2', 'hand_1']);
    expect((game.state as any).mulliganState?.[p1]).toEqual({
      hasKeptHand: true,
      mulligansTaken: 2,
      pendingBottomCount: 0,
      pendingBottomStepId: null,
    });
  });
});