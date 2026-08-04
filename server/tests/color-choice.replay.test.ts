import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addActiveColorStep(gameId: string, playerId: PlayerID, extra: Record<string, any>) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.COLOR_CHOICE,
    playerId,
    description: 'Choose a color.',
    mandatory: true,
    ...extra,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

function expectColorStepCleared(gameId: string) {
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  expect(queue.activeStep?.type).not.toBe(ResolutionStepType.COLOR_CHOICE);
  expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.COLOR_CHOICE)).toBe(false);
}

describe('color choice replay semantics', () => {
  it('replays spell color choices onto the unresolved stack item', () => {
    const gameId = 't_spell_color_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const step = addActiveColorStep(gameId, p1, { spellId: 'spell_stack_1' });

    (game.state as any).stack = [
      {
        id: 'spell_stack_1',
        cardId: 'spell_stack_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'spell_stack_1',
          name: 'Brave the Elements',
          type_line: 'Instant',
          oracle_text: 'Choose a color. White creatures you control gain protection from the chosen color until end of turn.',
        },
      },
    ];

    game.applyEvent({
      type: 'colorChoice',
      playerId: p1,
      resolvedStepId: step.id,
      resolvedStepType: ResolutionStepType.COLOR_CHOICE,
      spellId: 'spell_stack_1',
      cardName: 'Brave the Elements',
      color: 'white',
    } as any);

    expect(((game.state as any).stack || [])[0]?.chosenColor).toBe('white');
    expectColorStepCleared(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays permanent color choices onto the chosen permanent', () => {
    const gameId = 't_permanent_color_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const step = addActiveColorStep(gameId, p1, { permanentId: 'caged_sun_1' });

    (game.state as any).battlefield = [
      {
        id: 'caged_sun_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'caged_sun_card',
          name: 'Caged Sun',
          type_line: 'Artifact',
        },
      },
    ];

    game.applyEvent({
      type: 'colorChoice',
      playerId: p1,
      resolvedStepId: step.id,
      resolvedStepType: ResolutionStepType.COLOR_CHOICE,
      permanentId: 'caged_sun_1',
      cardName: 'Caged Sun',
      color: 'blue',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenColor).toBe('blue');
    expectColorStepCleared(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('prefers permanentId over a stale stack spell when replaying ETB color choices', () => {
    const gameId = 't_permanent_color_choice_ignores_stale_stack';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const step = addActiveColorStep(gameId, p1, { permanentId: 'thriving_grove_1' });

    (game.state as any).stack = [
      {
        id: 'stale_myrel_stack',
        type: 'spell',
        controller: p1,
        card: {
          id: 'myrel_card',
          name: 'Myrel, Shield of Argive',
          type_line: 'Legendary Creature — Human Soldier',
        },
      },
    ];
    (game.state as any).battlefield = [
      {
        id: 'thriving_grove_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'thriving_grove_card',
          name: 'Thriving Grove',
          type_line: 'Land',
          oracle_text: 'As Thriving Grove enters, choose a color other than green.',
        },
      },
    ];

    // Permanent ETB events omit spellId; empty-string stack matching used to hit orphans.
    game.applyEvent({
      type: 'colorChoice',
      playerId: p1,
      resolvedStepId: step.id,
      resolvedStepType: ResolutionStepType.COLOR_CHOICE,
      permanentId: 'thriving_grove_1',
      cardName: 'Thriving Grove',
      color: 'red',
    } as any);

    expect(((game.state as any).battlefield || [])[0]?.chosenColor).toBe('red');
    expect(((game.state as any).stack || [])[0]?.chosenColor).toBeUndefined();
    expectColorStepCleared(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });
});