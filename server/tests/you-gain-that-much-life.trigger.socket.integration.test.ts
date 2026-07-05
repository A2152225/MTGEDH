import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const gameId = 'test_you_gain_that_much_life_trigger_ir_primary';
const playerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;
const oracleText = 'Whenever an opponent loses life, you gain that much life.';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

describe('you gain that much life trigger (Layer 3 IR primary)', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetGame();
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame();
  });

  it('executeTriggerEffect applies gain_life from effectData.lifeLost via IR primary', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    games.set(gameId as any, game as any);

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 36 },
    ];
    (game.state as any).life = { [playerId]: 40, [opponentId]: 36 };
    (game.state as any).battlefield = [
      {
        id: 'exquisite_blood_perm',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          name: 'Exquisite Blood',
          type_line: 'Enchantment',
          oracle_text: oracleText,
        },
      },
    ];

    executeTriggerEffect(
      game as any,
      playerId,
      'Exquisite Blood',
      'you gain that much life',
      {
        id: 'trigger-life-loss',
        source: 'exquisite_blood_perm',
        sourceId: 'exquisite_blood_perm',
        triggerType: 'opponent_loses_life',
        triggeringPlayer: opponentId,
        effectData: {
          losingPlayerId: opponentId,
          lifeLost: 4,
        },
      },
    );

    expect((game.state as any).life?.[playerId]).toBe(44);
    expect((game.state as any).players.find((p: any) => p.id === playerId)?.life).toBe(44);
  }, 20000);
});
