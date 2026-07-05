import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const gameIdSimple = 'test_energy_gain_trigger_ir_primary_simple';
const gameIdCompound = 'test_energy_gain_trigger_ir_primary_compound';
const playerId = 'p1' as PlayerID;

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

describe('energy gain trigger (Layer 3 IR primary)', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetGame(gameIdSimple);
    await resetGame(gameIdCompound);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameIdSimple);
    await resetGame(gameIdCompound);
  });

  it('executeTriggerEffect applies add_player_counter energy from bare trigger fragment', async () => {
    createGameIfNotExists(gameIdSimple, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameIdSimple);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameIdSimple;
    games.set(gameIdSimple as any, game as any);

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'guide_perm',
        controller: playerId,
        owner: playerId,
        card: {
          name: 'Guide of Souls',
          type_line: 'Creature',
          oracle_text: 'Whenever another creature you control enters, you get two {E}.',
        },
      },
    ];

    executeTriggerEffect(
      game as any,
      playerId,
      'Guide of Souls',
      'You get two {E}.',
      {
        id: 'trigger-energy',
        source: 'guide_perm',
        sourceId: 'guide_perm',
        triggerType: 'another_creature_enters',
      },
    );

    expect((game.state as any).energy?.[playerId]).toBe(2);
    expect((game.state as any).energyCount?.[playerId]).toBe(2);
  }, 20000);

  it('executeTriggerEffect applies gain_life and energy for compound trigger fragments', async () => {
    createGameIfNotExists(gameIdCompound, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameIdCompound);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameIdCompound;
    games.set(gameIdCompound as any, game as any);

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'guide_perm',
        controller: playerId,
        owner: playerId,
        card: { name: 'Guide of Souls', type_line: 'Creature' },
      },
    ];

    executeTriggerEffect(
      game as any,
      playerId,
      'Guide of Souls',
      'You gain 2 life and get two {E}.',
      {
        id: 'trigger-energy-life',
        source: 'guide_perm',
        sourceId: 'guide_perm',
      },
    );

    expect((game.state as any).life?.[playerId]).toBe(42);
    expect((game.state as any).energy?.[playerId]).toBe(2);
  }, 20000);
});
