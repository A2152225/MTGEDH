import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

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

function seedDirectAbilityCopyBoard(game: any, playerId: string) {
  const triggeringStackId = 'stack_trade_relay_ability_replay_1';
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).stack = [
    {
      id: triggeringStackId,
      type: 'ability',
      controller: playerId,
      source: 'trade_relay_1',
      sourceName: 'Trade Relay',
      card: { id: 'trade_relay_card_1', name: 'Trade Relay', type_line: 'Artifact' },
      abilityText: '{2}, {T}: Exchange control of two target permanents that share a card type.',
      targets: ['player_relic_1', 'opponent_relic_1'],
    },
  ];
  (game.state as any).battlefield = [
    {
      id: 'rings_1',
      controller: playerId,
      card: { name: 'Rings of Brighthearth', type_line: 'Legendary Artifact' },
    },
  ];
  return triggeringStackId;
}

describe('Oracle IR trigger copy ability replay integration', () => {
  const gameId = 'test_oracle_ir_trigger_copy_ability_replay';
  const playerId = 'p1';

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

  it('persists copyTriggeredAbilityResolve events and replays IR ability copies', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const triggeringStackId = seedDirectAbilityCopyBoard(game, playerId);
    const effectText = 'copy that ability. You may choose new targets for the copy.';

    (game as any).io = { to: () => ({ emit: () => undefined }) };
    const eventStart = getEvents(gameId).length;

    executeTriggerEffect(
      game as any,
      playerId,
      'Rings of Brighthearth',
      effectText,
      {
        id: 'rings_trigger_replay_1',
        permanentId: 'rings_1',
        source: 'rings_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.type).toBe('ability');
    expect(copies[0]?.copiedBySourceName).toBe('Rings of Brighthearth');

    const replayEvents = toReplayEvents(gameId, eventStart);
    const copyEvents = replayEvents.filter((event: any) => event.type === 'copyTriggeredAbilityResolve');
    expect(copyEvents).toHaveLength(1);
    expect(copyEvents[0]).toEqual(
      expect.objectContaining({
        type: 'copyTriggeredAbilityResolve',
        sourceName: 'Rings of Brighthearth',
        controllerId: playerId,
        triggeringStackItemId: triggeringStackId,
        copiedStackItemId: copies[0]?.id,
        paid: true,
      }),
    );

    const replayGame = createInitialGameState(`${gameId}_replay`);
    seedDirectAbilityCopyBoard(replayGame, playerId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    const replayStackItems = getStackItems((replayGame.state as any).stack);
    const replayCopies = replayStackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(replayCopies).toHaveLength(1);
    expect(replayCopies[0]?.type).toBe('ability');
    expect(replayCopies[0]?.copiedBySourceName).toBe('Rings of Brighthearth');
    expect(replayStackItems.some((item: any) => item?.id === triggeringStackId)).toBe(true);
  });
});
