import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

const LOTUS_VALE_ORACLE =
  "If this land would enter, sacrifice two untapped lands instead. If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add three mana of any one color.";

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('landWouldEnterSacrificeChoice replay semantics', () => {
  it('replays the sacrifice choice by putting Lotus Vale onto the battlefield', () => {
    const gameId = 't_lotus_vale_choice_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'land_a',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'plains_a', name: 'Plains', type_line: 'Basic Land — Plains' },
      },
      {
        id: 'land_b',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'forest_b', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'lotus_vale_1',
            name: 'Lotus Vale',
            type_line: 'Land',
            oracle_text: LOTUS_VALE_ORACLE,
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    game.applyEvent({
      type: 'playLand',
      playerId: p1,
      card: {
        id: 'lotus_vale_1',
        name: 'Lotus Vale',
        type_line: 'Land',
        oracle_text: LOTUS_VALE_ORACLE,
      },
    } as any);

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'lotus_vale_choice_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Sacrifice two lands?',
      mandatory: true,
      landWouldEnterSacrificeChoice: true,
      sacrificeCount: 2,
      sourceName: 'Lotus Vale',
      sourceId: 'lotus_vale_1',
    } as any);

    game.applyEvent({
      type: 'landWouldEnterSacrificeChoice',
      playerId: p1,
      resolvedStepId: 'lotus_vale_choice_step_1',
      sacrificePermanentIds: ['land_a', 'land_b'],
      cardName: 'Lotus Vale',
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.card?.name).toBe('Lotus Vale');

    const zones = (game.state as any).zones?.[p1];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual([]);
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['plains_a', 'forest_b']);
  });

  it('replays the decline path by moving Lotus Vale to the graveyard', () => {
    const gameId = 't_lotus_vale_decline_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'land_a',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'plains_a', name: 'Plains', type_line: 'Basic Land — Plains' },
      },
      {
        id: 'land_b',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'forest_b', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'lotus_vale_1',
            name: 'Lotus Vale',
            type_line: 'Land',
            oracle_text: LOTUS_VALE_ORACLE,
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    game.applyEvent({
      type: 'playLand',
      playerId: p1,
      card: {
        id: 'lotus_vale_1',
        name: 'Lotus Vale',
        type_line: 'Land',
        oracle_text: LOTUS_VALE_ORACLE,
      },
    } as any);

    game.applyEvent({
      type: 'landWouldEnterSacrificeChoice',
      playerId: p1,
      sacrificePermanentIds: null,
      cardName: 'Lotus Vale',
    } as any);

    expect((game.state as any).battlefield).toHaveLength(2);
    const zones = (game.state as any).zones?.[p1];
    expect((zones?.graveyard || []).map((card: any) => card.id)).toEqual(['lotus_vale_1']);
  });
});
