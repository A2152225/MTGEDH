import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('moxDiamondChoice replay semantics', () => {
  it('replays the discard choice by preserving the live battlefield permanent id', () => {
    const game = createInitialGameState('t_mox_diamond_choice_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).stack = [
      {
        id: 'stack_mox_1',
        controller: p1,
        card: {
          id: 'mox_diamond_card',
          name: 'Mox Diamond',
          type_line: 'Artifact',
          oracle_text: 'If Mox Diamond would enter the battlefield, you may discard a land card instead. If you do, put Mox Diamond onto the battlefield. If you don’t, put it into its owner\'s graveyard.',
          zone: 'stack',
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'land_1',
            name: 'Plains',
            type_line: 'Basic Land — Plains',
            oracle_text: '({T}: Add {W}.)',
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };

    game.applyEvent({
      type: 'moxDiamondChoice',
      playerId: p1,
      stackItemId: 'stack_mox_1',
      discardLandId: 'land_1',
      cardName: 'Mox Diamond',
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('stack_mox_1');
    expect(battlefield[0]?.card?.name).toBe('Mox Diamond');

    const zones = (game.state as any).zones?.[p1];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual([]);
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['land_1']);
  });

  it('replays the decline path by moving Mox Diamond from the stack to the graveyard', () => {
    const game = createInitialGameState('t_mox_diamond_choice_decline_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).stack = [
      {
        id: 'stack_mox_2',
        controller: p1,
        card: {
          id: 'mox_diamond_card_2',
          name: 'Mox Diamond',
          type_line: 'Artifact',
          oracle_text: 'If Mox Diamond would enter the battlefield, you may discard a land card instead. If you do, put Mox Diamond onto the battlefield. If you don’t, put it into its owner\'s graveyard.',
          zone: 'stack',
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };

    game.applyEvent({
      type: 'moxDiamondChoice',
      playerId: p1,
      stackItemId: 'stack_mox_2',
      discardLandId: null,
      cardName: 'Mox Diamond',
    } as any);

    expect((game.state as any).battlefield || []).toHaveLength(0);
    expect(((game.state as any).zones?.[p1]?.graveyard || []).map((card: any) => card.name)).toEqual(['Mox Diamond']);
  });
});