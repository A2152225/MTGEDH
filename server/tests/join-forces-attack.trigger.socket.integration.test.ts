import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const gameId = 'test_join_forces_attack_trigger_ir_primary';
const playerId = 'p1' as PlayerID;
const oracleText = `Flying, trample
Join forces — Whenever this creature attacks or blocks, each player starting with you may pay any amount of mana. This creature gets +X/+0 until end of turn, where X is the total amount of mana paid this way.`;

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

describe('join forces attack trigger (Layer 3 IR primary)', () => {
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

  it('executeTriggerEffect queues JOIN_FORCES steps for join_forces_attack triggers', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    games.set(gameId as any, game as any);

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'dragon_perm',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          name: 'Mana-Charged Dragon',
          type_line: 'Creature — Dragon',
          oracle_text: oracleText,
        },
      },
      {
        id: 'land_p1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Mountain', type_line: 'Basic Land — Mountain' },
      },
      {
        id: 'land_p2',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: { name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];

    executeTriggerEffect(
      game as any,
      playerId,
      'Mana-Charged Dragon',
      oracleText,
      {
        id: 'trigger-join-forces',
        source: 'dragon_perm',
        permanentId: 'dragon_perm',
        triggerType: 'join_forces_attack',
        value: { isJoinForces: true },
      },
    );

    const joinSteps = ResolutionQueueManager.getQueue(gameId).steps.filter(
      (step) => step.type === ResolutionStepType.JOIN_FORCES,
    );
    expect(joinSteps).toHaveLength(2);
    expect(joinSteps.map((step: any) => step.playerId)).toEqual(expect.arrayContaining([playerId, 'p2']));
    expect(joinSteps.every((step: any) => step.cardName === 'Mana-Charged Dragon')).toBe(true);
    expect(joinSteps.every((step: any) => String(step.effectDescription || '').includes('Join forces'))).toBe(true);
    expect(joinSteps.find((step: any) => step.playerId === playerId)?.isInitiator).toBe(true);
  }, 20000);
});
