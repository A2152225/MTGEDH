import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

function seedDelayedDrawGame(gameId: string) {
  const playerId = 'p1';
  const opponentId = 'p2';

  createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const drawCard = {
    id: 'draw_card_1',
    name: 'Delayed Draw Card',
    type_line: 'Instant',
    oracle_text: 'Draw a card.',
  };

  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).turnNumber = 1;
  (game.state as any).turn = 1;
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN1';
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 1 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
  };
  (game.state as any).battlefield = [];
  (game.state as any).stack = [];
  (game as any).libraries.set(playerId, [{ ...drawCard }]);
  (game as any).libraries.set(opponentId, []);

  return { game, playerId, opponentId };
}

describe('delayed next-upkeep draw triggers (integration)', () => {
  const gameId = 'test_delayed_next_upkeep_draw';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('schedules Mishra\'s Bauble-style draw for the next upkeep instead of drawing immediately', () => {
    const { game, playerId, opponentId } = seedDelayedDrawGame(gameId);
    const abilityText = "{T}, Sacrifice Mishra's Bauble: Look at the top card of target player's library. Draw a card at the beginning of the next turn's upkeep.";

    (game.state as any).stack.push({
      id: 'bauble_ability_1',
      type: 'ability',
      controller: playerId,
      source: 'bauble_perm_1',
      sourceName: "Mishra's Bauble",
      description: "Look at the top card of target player's library. Draw a card at the beginning of the next turn's upkeep.",
      activatedAbilityText: abilityText,
      targets: [opponentId],
    });

    game.resolveTopOfStack();

    expect(((game.state as any).zones[playerId].hand || [])).toHaveLength(0);
    expect(((game as any).libraries.get(playerId) || [])).toHaveLength(1);

    const pendingDraws = (game.state as any).pendingDelayedDrawsAtNextUpkeep || [];
    expect(pendingDraws).toHaveLength(1);
    expect(pendingDraws[0]).toEqual(expect.objectContaining({
      playerId,
      sourceName: "Mishra's Bauble",
      count: 1,
      fireAtTurnNumber: 2,
      fireAtStep: 'upkeep',
    }));

    const scheduleEvents = getEvents(gameId).filter((event: any) => event?.type === 'scheduleDelayedDrawAtNextUpkeep');
    expect(scheduleEvents).toHaveLength(1);

    game.nextTurn();
    game.nextStep();

    expect((game.state as any).turnPlayer).toBe(opponentId);
    expect((game.state as any).step).toBe('UPKEEP');
    expect(((game.state as any).pendingDelayedDrawsAtNextUpkeep || [])).toHaveLength(0);

    const upkeepStack = (game.state as any).stack || [];
    expect(upkeepStack).toHaveLength(1);
    expect(upkeepStack[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      controller: playerId,
      sourceName: "Mishra's Bauble",
      triggerType: 'upkeep',
      effect: 'Draw a card.',
    }));

    game.resolveTopOfStack();

    expect(((game.state as any).zones[playerId].hand || []).map((card: any) => card.id)).toEqual(['draw_card_1']);
    expect(((game as any).libraries.get(playerId) || [])).toHaveLength(0);
  });

  it('replays scheduled delayed upkeep draw entries idempotently', () => {
    const { game, playerId } = seedDelayedDrawGame(gameId);

    game.applyEvent({
      type: 'scheduleDelayedDrawAtNextUpkeep',
      playerId,
      sourceName: "Mishra's Bauble",
      entries: [{
        scheduleId: 'delayed_draw_replay_1',
        playerId,
        createdBy: playerId,
        sourceId: 'bauble_perm_1',
        sourceName: "Mishra's Bauble",
        count: 1,
        fireAtTurnNumber: 2,
        fireAtStep: 'upkeep',
      }],
    } as any);
    game.applyEvent({
      type: 'scheduleDelayedDrawAtNextUpkeep',
      playerId,
      sourceName: "Mishra's Bauble",
      entries: [{
        scheduleId: 'delayed_draw_replay_1',
        playerId,
        createdBy: playerId,
        sourceId: 'bauble_perm_1',
        sourceName: "Mishra's Bauble",
        count: 1,
        fireAtTurnNumber: 2,
        fireAtStep: 'upkeep',
      }],
    } as any);

    const pendingDraws = (game.state as any).pendingDelayedDrawsAtNextUpkeep || [];
    expect(pendingDraws).toHaveLength(1);
    expect(pendingDraws[0]).toEqual(expect.objectContaining({
      scheduleId: 'delayed_draw_replay_1',
      playerId,
      sourceName: "Mishra's Bauble",
      count: 1,
      fireAtTurnNumber: 2,
    }));
  });
});