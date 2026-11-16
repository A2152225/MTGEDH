import { beforeAll, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/index.js';
import { ensureGame } from '../src/socket/util.js';
import { tryHandleDieRollNudgeChoice } from '../src/state/modules/dieRollNudgePrompt.js';

/**
 * Paying 1 life to change a die result has to come back from dieRollNudgeResolve.
 * Reloading replays that event onto the pre-choice life total and roll.
 */

describe('die roll nudge survives reload', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('replays dieRollNudgeResolve once', () => {
    const gameId = `die-nudge-${Date.now()}`;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const night = {
      id: 'night',
      controller: 'p1',
      card: { name: 'Night Shift of the Living Dead', type_line: 'Enchantment', oracle_text: 'After you roll a die, you may pay 1 life.' },
    };
    const state = game.state as any;
    state.players = [{ id: 'p1', name: 'P1', life: 40 }];
    state.life = { p1: 40 };
    state.startingLife = 40;
    state.turnNumber = 2;
    state.battlefield = [night];
    state.lastDieRoll = { playerId: 'p1', sides: 6, result: 4, followupsFired: true };
    const beforeBattlefield = JSON.parse(JSON.stringify(state.battlefield));

    const handled = tryHandleDieRollNudgeChoice(
      { to: () => ({ emit: () => {} }) } as any,
      game,
      gameId,
      {
        id: 'step-nudge',
        dieRollNudge: true,
        playerId: 'p1',
        sourceName: 'Night Shift of the Living Dead',
        dieRollNudgeKind: 'life',
        dieRollNudgeLife: 1,
        dieRollNudgeOnce: true,
        dieRollNudgePermanentId: 'night',
        dieResult: 4,
      },
      { playerId: 'p1', selections: ['increase'] } as any,
    );
    expect(handled).toBe(true);
    expect(state.life.p1).toBe(39);
    expect(state.lastDieRoll.result).toBe(5);

    const saved = getEvents(gameId).filter((event: any) => event.type === 'dieRollNudgeResolve');
    expect(saved).toHaveLength(1);

    const replayGame = createInitialGameState(`${gameId}_replay`);
    const replayState = replayGame.state as any;
    replayState.players = [{ id: 'p1', name: 'P1', life: 40 }];
    replayState.life = { p1: 40 };
    replayState.startingLife = 40;
    replayState.turnNumber = 2;
    replayState.battlefield = beforeBattlefield;
    replayState.lastDieRoll = { playerId: 'p1', sides: 6, result: 4 };
    replayGame.replay!(saved.map((event: any) => ({ type: event.type, ...(event.payload || {}) })) as any);

    expect(replayState.life.p1).toBe(39);
    expect(replayState.lastDieRoll.result).toBe(5);
    expect(replayState.players[0].life).toBe(39);
  });
});
