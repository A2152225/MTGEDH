import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('option choice replay semantics', () => {
  it('replays hand-to-battlefield moves before queued enters choices resolve', () => {
    const game = createInitialGameState('t_option_choice_replay_put_from_hand');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'greymond_card',
            name: 'Greymond, Avacyn\'s Stalwart',
            type_line: 'Legendary Creature — Human Noble',
            power: '5',
            toughness: '5',
            oracle_text: 'As Greymond enters, choose two abilities from among first strike, vigilance, and lifelink.',
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'putCardFromHandOntoBattlefield',
      playerId: p1,
      cardId: 'greymond_card',
      permanentId: 'greymond_perm',
      tappedAndAttacking: false,
      card: {
        id: 'greymond_card',
        name: 'Greymond, Avacyn\'s Stalwart',
        type_line: 'Legendary Creature — Human Noble',
        power: '5',
        toughness: '5',
        oracle_text: 'As Greymond enters, choose two abilities from among first strike, vigilance, and lifelink.',
      },
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'greymond_perm',
      queuedResolutionStep: {
        id: 'queued_greymond_enter_1',
        type: 'option_choice',
        playerId: p1,
        description: 'Choose 2 for Greymond, Avacyn\'s Stalwart: first strike, vigilance, lifelink',
        mandatory: true,
        sourceId: 'greymond_perm',
        sourceName: 'Greymond, Avacyn\'s Stalwart',
        options: ['first strike', 'vigilance', 'lifelink'],
        minSelections: 2,
        maxSelections: 2,
        permanentId: 'greymond_perm',
      },
    } as any);

    const hand = ((game.state as any).zones?.[p1]?.hand || []).map((card: any) => card.id);
    expect(hand).toEqual([]);
    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('greymond_perm');
    expect(battlefield[0]?.card?.name).toBe('Greymond, Avacyn\'s Stalwart');
    const queue = ResolutionQueueManager.getQueue('t_option_choice_replay_put_from_hand');
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe('option_choice');
    expect((queue.steps[0] as any)?.permanentId).toBe('greymond_perm');
  });

  it('replays a single chosen option from the persisted chosenOptions payload', () => {
    const game = createInitialGameState('t_option_choice_replay_single');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'adaptive_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'adaptive_card',
          name: 'Adaptive Automaton',
          type_line: 'Artifact Creature',
        },
      },
    ];

    game.applyEvent({
      type: 'optionChoice',
      playerId: p1,
      permanentId: 'adaptive_1',
      chosenOptions: ['flying'],
    } as any);

    const permanent = ((game.state as any).battlefield || [])[0];
    expect((permanent as any).chosenOption).toBe('flying');
    expect((permanent as any).chosenOptions).toBeUndefined();
  });

  it('replays multiple chosen options onto chosenOptions', () => {
    const game = createInitialGameState('t_option_choice_replay_multi');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'greymond_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'greymond_card',
          name: 'Greymond, Avacyn\'s Stalwart',
          type_line: 'Legendary Creature',
        },
      },
    ];

    game.applyEvent({
      type: 'optionChoice',
      playerId: p1,
      permanentId: 'greymond_1',
      chosenOptions: ['first strike', 'vigilance'],
    } as any);

    const permanent = ((game.state as any).battlefield || [])[0];
    expect((permanent as any).chosenOptions).toEqual(['first strike', 'vigilance']);
    expect((permanent as any).chosenOption).toBeUndefined();
  });
});