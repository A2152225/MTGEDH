import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const gameId = 'test_put_that_many_counters_on_self_trigger_ir_primary';
const playerId = 'p1' as PlayerID;
const effectText = 'put that many growth counters on this enchantment';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

describe('put that many counters on self trigger (Layer 3 IR primary)', () => {
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

  it('executeTriggerEffect applies add_counter from effectData.countersPlaced via IR primary', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    games.set(gameId as any, game as any);

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'simic_ascendancy_perm',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          name: 'Simic Ascendancy',
          type_line: 'Enchantment',
          oracle_text: 'Whenever one or more +1/+1 counters are put on a creature you control, put that many growth counters on this enchantment.',
        },
      },
    ];

    executeTriggerEffect(
      game as any,
      playerId,
      'Simic Ascendancy',
      effectText,
      {
        id: 'trigger-counter-placed',
        source: 'simic_ascendancy_perm',
        sourceId: 'simic_ascendancy_perm',
        triggerType: 'counters_put_on_creature_you_control',
        triggeringPermanent: 'bear_perm',
        effectData: {
          countersPlaced: 2,
          counterType: '+1/+1',
          targetPermanentId: 'bear_perm',
        },
      },
    );

    const simic = ((game.state as any).battlefield || []).find(
      (perm: any) => perm?.id === 'simic_ascendancy_perm',
    );
    expect(simic?.counters?.growth).toBe(2);
  }, 20000);
});
