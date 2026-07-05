import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const gameId = 'test_token_counters_trigger_ir_primary';
const playerId = 'p1' as PlayerID;
const effectText = 'You get three token counters.';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

describe('token counters trigger (Layer 3 IR primary)', () => {
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

  it('executeTriggerEffect applies add_player_counter via IR primary', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    games.set(gameId as any, game as any);

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'tokenator_perm',
        controller: playerId,
        owner: playerId,
        card: {
          name: 'The Tokenator',
          type_line: 'Creature',
          oracle_text: 'Whenever you cast a creature spell, you get three token counters.',
        },
      },
    ];

    executeTriggerEffect(
      game as any,
      playerId,
      'The Tokenator',
      effectText,
      {
        id: 'trigger-token-counters',
        source: 'tokenator_perm',
        sourceId: 'tokenator_perm',
        triggerType: 'cast_creature_spell',
      },
    );

    expect((game.state as any).tokenCounters?.[playerId]).toBe(3);
    expect((game.state as any).tokenCounterCount?.[playerId]).toBe(3);
  }, 20000);
});
