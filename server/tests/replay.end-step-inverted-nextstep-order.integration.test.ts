import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/index.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const LIVE_GAME_ID = 'replay_end_step_inverted_nextstep_order';
const REPLAY_GAME_ID = 'replay_end_step_inverted_nextstep_order_replay';
const LOOKAHEAD_REPLAY_GAME_ID = 'replay_end_step_lookahead_nextstep_order_replay';

const KYNAIOS_ORACLE =
  'At the beginning of your end step, draw a card. Each player may put a land card from their hand onto the battlefield. Then each opponent who didn\'t draws a card.';

function kynaiosPermanent() {
  return {
    id: 'kynaios_perm',
    controller: 'p1',
    owner: 'p1',
    tapped: false,
    card: {
      id: 'kynaios_card',
      name: 'Kynaios and Tiro of Meletis',
      type_line: 'Legendary Creature — Human Soldier',
      oracle_text: KYNAIOS_ORACLE,
    },
  };
}

function seedReplayGame(gameId: string, step: string, phase: string) {
  const game = createInitialGameState(gameId);
  game.applyEvent({ type: 'join', playerId: 'p1', name: 'Player 1' } as any);
  game.applyEvent({ type: 'join', playerId: 'p2', name: 'Player 2' } as any);
  Object.assign(game.state as any, {
    turnPlayer: 'p1',
    activePlayer: 'p1',
    priority: 'p1',
    turnNumber: 1,
    turn: 1,
    phase,
    step,
    stack: [],
    battlefield: [kynaiosPermanent()],
    priorityPassedBy: new Set<string>(),
  });
  return game;
}

describe('replay end-step trigger nextStep ordering', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of [LIVE_GAME_ID, REPLAY_GAME_ID, LOOKAHEAD_REPLAY_GAME_ID]) {
      await deleteGame(gameId);
      ResolutionQueueManager.removeQueue(gameId);
    }
  });

  afterEach(() => {
    for (const gameId of [LIVE_GAME_ID, REPLAY_GAME_ID, LOOKAHEAD_REPLAY_GAME_ID]) {
      ResolutionQueueManager.removeQueue(gameId);
    }
  });

  it('does not double-push end-step triggers when pushTriggeredAbility precedes nextStep (live socket order)', () => {
    createGameIfNotExists(REPLAY_GAME_ID, 'commander', 40);
    const replayGame = seedReplayGame(REPLAY_GAME_ID, 'MAIN2', 'postcombatMain');

    const triggerId = 'endstep_kynaios_persisted';
    // Historical live order: nextStep() persisted the push, then appendEvent(nextStep).
    const invertedEvents = [
      {
        type: 'pushTriggeredAbility',
        triggerId,
        sourceId: 'kynaios_perm',
        controllerId: 'p1',
        sourceName: 'Kynaios and Tiro of Meletis',
        description: KYNAIOS_ORACLE,
        effect: KYNAIOS_ORACLE,
        triggerType: 'end_step',
        mandatory: true,
        requiresChoice: true,
      },
      { type: 'nextStep' },
    ];

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    replayGame.replay(invertedEvents as any);

    const stack = ((replayGame.state as any).stack || []) as any[];
    const endStepTriggers = stack.filter(
      (item: any) =>
        item?.type === 'triggered_ability' &&
        String(item?.sourceName || '').includes('Kynaios'),
    );

    expect(String((replayGame.state as any).step || '').toUpperCase()).toBe('END');
    expect(endStepTriggers).toHaveLength(1);
    expect(endStepTriggers[0].id).toBe(triggerId);
  });

  it('still uses persisted pushes when nextStep precedes pushTriggeredAbility (lookahead order)', () => {
    createGameIfNotExists(LOOKAHEAD_REPLAY_GAME_ID, 'commander', 40);
    const replayGame = seedReplayGame(LOOKAHEAD_REPLAY_GAME_ID, 'MAIN2', 'postcombatMain');

    const triggerId = 'endstep_kynaios_lookahead';
    const lookaheadEvents = [
      { type: 'nextStep' },
      {
        type: 'pushTriggeredAbility',
        triggerId,
        sourceId: 'kynaios_perm',
        controllerId: 'p1',
        sourceName: 'Kynaios and Tiro of Meletis',
        description: KYNAIOS_ORACLE,
        effect: KYNAIOS_ORACLE,
        triggerType: 'end_step',
        mandatory: true,
        requiresChoice: true,
      },
    ];

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    replayGame.replay(lookaheadEvents as any);

    const stack = ((replayGame.state as any).stack || []) as any[];
    const endStepTriggers = stack.filter(
      (item: any) =>
        item?.type === 'triggered_ability' &&
        String(item?.sourceName || '').includes('Kynaios'),
    );

    expect(String((replayGame.state as any).step || '').toUpperCase()).toBe('END');
    expect(endStepTriggers).toHaveLength(1);
    expect(endStepTriggers[0].id).toBe(triggerId);
  });
});
