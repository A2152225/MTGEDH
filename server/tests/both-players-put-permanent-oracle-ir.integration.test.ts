import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: () => undefined }),
    emit: () => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

describe('both players put permanent oracle IR integration', () => {
  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(async () => {
    ResolutionQueueManager.removeQueue('test_both_players_put_permanent');
    games.delete('test_both_players_put_permanent' as any);
    await deleteGame('test_both_players_put_permanent');
  });

  it('queues land-play prompts for controller and target player under IR primary', () => {
    const gameId = 'test_both_players_put_permanent';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    game.importDeckResolved(p1, [] as any);
    game.importDeckResolved(p2, [] as any);

    const ctx = game as any;
    ctx.state.zones[p1].hand = [{
      id: 'forest_1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      zone: 'hand',
    }];
    ctx.state.zones[p1].handCount = 1;
    ctx.state.zones[p2].hand = [{
      id: 'island_1',
      name: 'Island',
      type_line: 'Basic Land — Island',
      zone: 'hand',
    }];
    ctx.state.zones[p2].handCount = 1;

    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Test Source',
      'you and that player may each put a permanent card from your hand onto the battlefield.',
      {
        id: 'both_players_put_permanent_trigger',
        type: 'triggered_ability',
        controller: p1,
        targetPlayerId: p2,
        sourceId: 'src_1',
      },
    );

    expect((ctx.state.zones[p1].hand || []).map((card: any) => card?.id)).toEqual(['forest_1']);
    expect((ctx.state.zones[p2].hand || []).map((card: any) => card?.id)).toEqual(['island_1']);

    const queueSteps = ResolutionQueueManager.getQueue(gameId).steps;
    const kynaiosSteps = queueSteps.filter((step) => step.type === ResolutionStepType.KYNAIOS_CHOICE);
    expect(kynaiosSteps).toHaveLength(2);
    expect(kynaiosSteps.map((step: any) => step.playerId).sort()).toEqual([p1, p2].sort());
    expect(kynaiosSteps.every((step: any) => String(step.description || '').match(/put a land card from your hand/i))).toBe(true);
  });
});
