import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { applyEvent } from '../src/state/modules/applyEvent';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
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
            name: "Greymond, Avacyn's Stalwart",
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
        name: "Greymond, Avacyn's Stalwart",
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
        description: "Choose 2 for Greymond, Avacyn's Stalwart: first strike, vigilance, lifelink",
        mandatory: true,
        sourceId: 'greymond_perm',
        sourceName: "Greymond, Avacyn's Stalwart",
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
    expect(battlefield[0]?.card?.name).toBe("Greymond, Avacyn's Stalwart");
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

    ResolutionQueueManager.removeQueue('t_option_choice_replay_single');
    ResolutionQueueManager.addStep('t_option_choice_replay_single', {
      id: 'option_choice_step_single',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Choose flying or first strike',
      mandatory: true,
      permanentId: 'adaptive_1',
      sourceId: 'adaptive_1',
      options: ['flying', 'first strike'],
    } as any);

    game.applyEvent({
      type: 'optionChoice',
      playerId: p1,
      permanentId: 'adaptive_1',
      chosenOptions: ['flying'],
      resolvedStepId: 'option_choice_step_single',
    } as any);

    const permanent = ((game.state as any).battlefield || [])[0];
    expect((permanent as any).chosenOption).toBe('flying');
    expect((permanent as any).chosenOptions).toBeUndefined();
    expect(
      ResolutionQueueManager.getQueue('t_option_choice_replay_single').steps.some(
        (entry: any) => String(entry?.id || '') === 'option_choice_step_single',
      ),
    ).toBe(false);
    ResolutionQueueManager.removeQueue('t_option_choice_replay_single');
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
          name: "Greymond, Avacyn's Stalwart",
          type_line: 'Legendary Creature',
        },
      },
    ];

    ResolutionQueueManager.removeQueue('t_option_choice_replay_multi');
    ResolutionQueueManager.addStep('t_option_choice_replay_multi', {
      id: 'option_choice_step_multi',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Choose 2 abilities',
      mandatory: true,
      permanentId: 'greymond_1',
      sourceId: 'greymond_1',
      options: ['first strike', 'vigilance', 'lifelink'],
      minSelections: 2,
      maxSelections: 2,
    } as any);

    game.applyEvent({
      type: 'optionChoice',
      playerId: p1,
      permanentId: 'greymond_1',
      chosenOptions: ['first strike', 'vigilance'],
      resolvedStepId: 'option_choice_step_multi',
    } as any);

    const permanent = ((game.state as any).battlefield || [])[0];
    expect((permanent as any).chosenOptions).toEqual(['first strike', 'vigilance']);
    expect((permanent as any).chosenOption).toBeUndefined();
    expect(
      ResolutionQueueManager.getQueue('t_option_choice_replay_multi').steps.some(
        (entry: any) => String(entry?.id || '') === 'option_choice_step_multi',
      ),
    ).toBe(false);
    ResolutionQueueManager.removeQueue('t_option_choice_replay_multi');
  });

  it('clears a matching OPTION_CHOICE queue step by resolvedStepId without touching myriad prompts', () => {
    const gameId = 't_option_choice_replay_queue_cleanup';
    const ctx: any = {
      gameId,
      state: {
        players: [{ id: 'p1', name: 'P1', spectator: false, life: 40 }],
        battlefield: [
          {
            id: 'adaptive_1',
            controller: 'p1',
            owner: 'p1',
            card: { id: 'adaptive_card', name: 'Adaptive Automaton', type_line: 'Artifact Creature' },
          },
        ],
        stack: [],
        zones: {},
      },
      bumpSeq() {},
    };

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'option_choice_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      description: 'Choose flying or first strike',
      mandatory: true,
      permanentId: 'adaptive_1',
      sourceId: 'adaptive_1',
      options: ['flying', 'first strike'],
    } as any);
    ResolutionQueueManager.addStep(gameId, {
      id: 'myriad_choice_step_keep',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      description: 'Choose Myriad opponents',
      mandatory: false,
      myriadChoice: true,
      permanentId: 'adaptive_1',
    } as any);

    applyEvent(ctx, {
      type: 'optionChoice',
      playerId: 'p1',
      permanentId: 'adaptive_1',
      chosenOptions: ['flying'],
      resolvedStepId: 'option_choice_step_1',
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry?.id || '') === 'option_choice_step_1')).toBe(false);
    expect(queue.steps.some((entry: any) => String(entry?.id || '') === 'myriad_choice_step_keep')).toBe(true);
    expect((ctx.state.battlefield[0] as any).chosenOption).toBe('flying');
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('falls back to clearing OPTION_CHOICE by player/permanent when resolvedStepId is missing', () => {
    const gameId = 't_option_choice_replay_fallback_cleanup';
    const ctx: any = {
      gameId,
      state: {
        players: [{ id: 'p1', name: 'P1', spectator: false, life: 40 }],
        battlefield: [
          {
            id: 'adaptive_1',
            controller: 'p1',
            owner: 'p1',
            card: { id: 'adaptive_card', name: 'Adaptive Automaton', type_line: 'Artifact Creature' },
          },
        ],
        stack: [],
        zones: {},
      },
      bumpSeq() {},
    };

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'option_choice_legacy_step',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      description: 'Choose flying or first strike',
      mandatory: true,
      permanentId: 'adaptive_1',
      sourceId: 'adaptive_1',
      options: ['flying', 'first strike'],
    } as any);
    ResolutionQueueManager.addStep(gameId, {
      id: 'myriad_choice_step_keep',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      description: 'Choose Myriad opponents',
      mandatory: false,
      myriadChoice: true,
      permanentId: 'adaptive_1',
    } as any);

    applyEvent(ctx, {
      type: 'optionChoice',
      playerId: 'p1',
      permanentId: 'adaptive_1',
      chosenOptions: ['first strike'],
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry?.id || '') === 'option_choice_legacy_step')).toBe(false);
    expect(queue.steps.some((entry: any) => String(entry?.id || '') === 'myriad_choice_step_keep')).toBe(true);
    expect((ctx.state.battlefield[0] as any).chosenOption).toBe('first strike');
    ResolutionQueueManager.removeQueue(gameId);
  });
});
