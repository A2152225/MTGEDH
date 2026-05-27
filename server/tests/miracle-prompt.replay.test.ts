import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('miraclePromptResolve replay semantics', () => {
  it('replays decline by clearing the prompt and first-drawn flags', () => {
    const gameId = 't_miracle_prompt_decline_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'miracle_1',
        name: 'Terminus',
        type_line: 'Sorcery',
        oracle_text: 'Put all creatures on the bottom of their owners\' libraries. Miracle {W}',
        isFirstDrawnThisTurn: true,
        drawnAt: 100,
      },
    ];
    zones.handCount = 1;

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      sourceId: 'miracle_1',
      sourceName: 'Terminus',
      description: 'Miracle: You may cast Terminus for {W}.',
      mandatory: false,
      options: [
        { id: 'cast_miracle', label: 'Cast for Miracle ({W})' },
        { id: 'decline', label: "Don't cast" },
      ],
      miraclePrompt: true,
      miracleCardId: 'miracle_1',
      miracleCost: '{W}',
    } as any);
    ResolutionQueueManager.activateStep(gameId, step.id);

    game.applyEvent({
      type: 'miraclePromptResolve',
      playerId: p1,
      sourceId: 'miracle_1',
      sourceName: 'Terminus',
      resolvedStepId: step.id,
      miracleCardId: 'miracle_1',
      miracleCost: '{W}',
      choiceId: 'decline',
      accepted: false,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.miraclePrompt).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.miraclePrompt === true)).toBe(false);
    expect(zones.hand[0].isFirstDrawnThisTurn).toBeUndefined();
    expect(zones.hand[0].drawnAt).toBeUndefined();

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays accepted prompts by clearing the prompt while leaving cast-state mutation to cast events', () => {
    const gameId = 't_miracle_prompt_accept_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const zones = (game.state as any).zones[p1];
    zones.hand = [
      { id: 'miracle_1', name: 'Terminus', type_line: 'Sorcery', isFirstDrawnThisTurn: true, drawnAt: 100 },
    ];
    zones.handCount = 1;

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      sourceId: 'miracle_1',
      sourceName: 'Terminus',
      miraclePrompt: true,
      miracleCardId: 'miracle_1',
      miracleCost: '{W}',
      options: [{ id: 'cast_miracle', label: 'Cast for Miracle ({W})' }],
    } as any);
    ResolutionQueueManager.activateStep(gameId, step.id);

    game.applyEvent({
      type: 'miraclePromptResolve',
      playerId: p1,
      sourceId: 'miracle_1',
      sourceName: 'Terminus',
      resolvedStepId: step.id,
      miracleCardId: 'miracle_1',
      miracleCost: '{W}',
      choiceId: 'cast_miracle',
      accepted: true,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect((queue.steps || []).some((entry: any) => entry?.miraclePrompt === true)).toBe(false);
    expect(zones.hand[0].isFirstDrawnThisTurn).toBe(true);
    expect(zones.hand[0].drawnAt).toBe(100);

    ResolutionQueueManager.removeQueue(gameId);
  });
});