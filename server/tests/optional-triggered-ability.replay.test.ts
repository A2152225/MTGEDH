import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('optional triggered ability replay semantics', () => {
  it('replays the queued optional-trigger prompt during stack resolution replay', () => {
    const gameId = 't_optional_trigger_prompt_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'soul_attendant_1',
      queuedResolutionStep: {
        id: 'queued_optional_trigger_prompt_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'soul_attendant_1',
        sourceName: "Soul's Attendant",
        description: "You may: You may gain 1 life.",
        mandatory: false,
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalTriggeredAbilityPrompt: true,
        deferredTriggeredAbilityItem: {
          id: 'trigger_1',
          type: 'triggered_ability',
          controller: playerId,
          source: 'soul_attendant_1',
          sourceName: "Soul's Attendant",
          description: 'You may gain 1 life.',
          effect: 'You may gain 1 life.',
          triggerType: 'creature_etb',
          mandatory: false,
          requiresChoice: true,
          optionalTriggeredAbilityDecisionApplied: true,
        },
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_optional_trigger_prompt_1');
    expect((queue.steps[0] as any)?.optionalTriggeredAbilityPrompt).toBe(true);
  });

  it('replays an accepted optional-trigger choice by resolving the deferred trigger', () => {
    const gameId = 't_optional_trigger_choice_accept_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'soul_attendant_1',
      queuedResolutionStep: {
        id: 'queued_optional_trigger_prompt_2',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'soul_attendant_1',
        sourceName: "Soul's Attendant",
        description: "You may: You may gain 1 life.",
        mandatory: false,
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalTriggeredAbilityPrompt: true,
      },
    } as any);

    game.applyEvent({
      type: 'optionalTriggeredAbilityChoice',
      playerId,
      sourceId: 'soul_attendant_1',
      sourceName: "Soul's Attendant",
      resolvedStepId: 'queued_optional_trigger_prompt_2',
      choice: 'yes',
      deferredTriggeredAbilityItem: {
        id: 'trigger_1',
        type: 'triggered_ability',
        controller: playerId,
        source: 'soul_attendant_1',
        sourceName: "Soul's Attendant",
        description: 'You may gain 1 life.',
        effect: 'You may gain 1 life.',
        triggerType: 'creature_etb',
        mandatory: false,
        requiresChoice: true,
        optionalTriggeredAbilityDecisionApplied: true,
      },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((game.state as any).life[playerId]).toBe(41);
    expect(Array.isArray((game.state as any).stack) ? (game.state as any).stack : []).toHaveLength(0);
  });

  it('replays a declined optional-trigger choice by clearing the queued prompt only', () => {
    const gameId = 't_optional_trigger_choice_decline_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'soul_attendant_1',
      queuedResolutionStep: {
        id: 'queued_optional_trigger_prompt_3',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'soul_attendant_1',
        sourceName: "Soul's Attendant",
        description: "You may: You may gain 1 life.",
        mandatory: false,
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalTriggeredAbilityPrompt: true,
      },
    } as any);

    game.applyEvent({
      type: 'optionalTriggeredAbilityChoice',
      playerId,
      sourceId: 'soul_attendant_1',
      sourceName: "Soul's Attendant",
      resolvedStepId: 'queued_optional_trigger_prompt_3',
      choice: 'no',
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((game.state as any).life[playerId]).toBe(40);
    expect(Array.isArray((game.state as any).stack) ? (game.state as any).stack : []).toHaveLength(0);
  });
});