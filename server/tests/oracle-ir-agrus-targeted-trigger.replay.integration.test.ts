import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';
import {
  persistTargetedTriggeredStackItems,
  triggerPermanentTargetedTriggersFromAbility,
} from '../src/state/modules/triggers/targeted.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function toReplayEvents(gameId: string, startIndex = 0) {
  return getEvents(gameId)
    .slice(startIndex)
    .map((event: any) =>
      event?.payload && typeof event.payload === 'object'
        ? { type: event.type, ...(event.payload as Record<string, unknown>) }
        : { type: event.type },
    );
}

function seedAgrusTargetedBoard(game: any, playerId: string) {
  const triggeringStackId = 'stack_shock_trooper_targeted_replay_1';
  const agrusOracleText =
    'Whenever Agrus Kos becomes the target of an ability that targets only it, you may pay {1}{R/W}. If you do, copy that ability for each other creature you control that ability could target.';

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).battlefield = [
    {
      id: 'agrus_1',
      controller: playerId,
      card: {
        name: 'Agrus Kos, Eternal Soldier',
        type_line: 'Legendary Creature — Soldier',
        oracle_text: agrusOracleText,
      },
    },
    {
      id: 'shock_trooper_1',
      controller: playerId,
      card: { name: 'Shock Trooper', type_line: 'Creature — Human Soldier' },
    },
  ];
  (game.state as any).stack = [
    {
      id: triggeringStackId,
      type: 'ability',
      controller: playerId,
      source: 'shock_trooper_1',
      sourceName: 'Shock Trooper',
      abilityText: '{R}: Target creature gets +1/+0 until end of turn.',
      targets: ['agrus_1'],
    },
  ];

  return triggeringStackId;
}

describe('Oracle IR Agrus targeted trigger replay', () => {
  const gameId = 'test_oracle_ir_agrus_targeted_trigger_replay';
  const playerId = 'p1' as PlayerID;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  it('persists pushTriggeredAbility with targeted metadata and replays onto stack', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const triggeringStackId = seedAgrusTargetedBoard(game, playerId);
    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();

    const eventStart = getEvents(gameId).length;

    const targetedTriggers = triggerPermanentTargetedTriggersFromAbility(game as any, {
      activatedBy: playerId,
      sourcePermanentId: 'shock_trooper_1',
      stackItemId: triggeringStackId,
      targetIds: ['agrus_1'],
    });
    persistTargetedTriggeredStackItems(gameId, game, targetedTriggers);

    expect(targetedTriggers).toHaveLength(1);
    expect(getStackItems((game.state as any).stack).some((item: any) => item?.triggerType === 'targeted')).toBe(true);

    const replayEvents = toReplayEvents(gameId, eventStart);
    const pushEvents = replayEvents.filter((event: any) => event.type === 'pushTriggeredAbility');
    expect(pushEvents).toHaveLength(1);
    expect(pushEvents[0]).toEqual(
      expect.objectContaining({
        type: 'pushTriggeredAbility',
        triggerType: 'targeted',
        sourceName: 'Agrus Kos, Eternal Soldier',
        controllerId: playerId,
        triggeringStackItemId: triggeringStackId,
        triggeringPlayer: playerId,
        mandatory: false,
      }),
    );
    expect(String(pushEvents[0]?.description || '')).toContain('copy that ability');
    expect(pushEvents[0]?.effectData).toEqual(
      expect.objectContaining({
        triggeringStackItemId: triggeringStackId,
        targetedPermanentId: 'agrus_1',
        activatedAbilitySourcePermanentId: 'shock_trooper_1',
      }),
    );

    const replayGame = createInitialGameState(`${gameId}_replay`);
    seedAgrusTargetedBoard(replayGame, playerId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    const replayStackItems = getStackItems((replayGame.state as any).stack);
    const replayTrigger = replayStackItems.find((item: any) => item?.triggerType === 'targeted');
    expect(replayTrigger).toBeDefined();
    expect(replayTrigger?.sourceName).toBe('Agrus Kos, Eternal Soldier');
    expect(replayTrigger?.triggeringStackItemId).toBe(triggeringStackId);
    expect(String(replayTrigger?.description || '')).toContain('copy that ability');
    expect(replayStackItems.some((item: any) => item?.id === triggeringStackId)).toBe(true);
  });
});
