import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { appendEvent, createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, transformDbEventsForReplay } from '../src/socket/util.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const playerId = 'p1' as PlayerID;
const player2Id = 'p2' as PlayerID;

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetSocketGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

describe('Windfall IR discardEffect event-log replay', () => {
  const gameId = 'test_windfall_discard_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(gameId);
  });

  it('persists per-player discardEffect + drawCards and restores hands after event replay', () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    (game as any).gameId = gameId;

    const p1Deck = [
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `p1_hand_${index}`,
        name: `P1 Hand ${index}`,
        type_line: 'Instant',
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `p1_lib_${index}`,
        name: `P1 Library ${index}`,
        type_line: 'Instant',
      })),
    ];
    const p2Deck = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `p2_hand_${index}`,
        name: `P2 Hand ${index}`,
        type_line: 'Instant',
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `p2_lib_${index}`,
        name: `P2 Library ${index}`,
        type_line: 'Instant',
      })),
    ];

    let seq = 0;
    const seedAndApply = (type: string, payload: Record<string, unknown>) => {
      appendEvent(gameId, seq++, type, payload);
      game.applyEvent({ type, ...payload } as any);
    };

    seedAndApply('join', { playerId, name: 'P1' });
    seedAndApply('join', { playerId: player2Id, name: 'P2' });
    seedAndApply('deckImportResolved', { playerId, cards: p1Deck });
    seedAndApply('deckImportResolved', { playerId: player2Id, cards: p2Deck });
    seedAndApply('drawCards', { playerId, count: 3 });
    seedAndApply('drawCards', { playerId: player2Id, count: 5 });

    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(3);
    expect((game.state as any).zones?.[player2Id]?.hand).toHaveLength(5);

    (game.state as any).stack = [
      {
        id: 'windfall_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'windfall_1',
          name: 'Windfall',
          type_line: 'Instant',
          oracle_text:
            'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.',
          mana_cost: '{2}{U}{U}',
        },
        targets: [],
      },
    ];

    const eventStart = getEvents(gameId).length;
    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(5);
    expect((game.state as any).zones?.[player2Id]?.hand).toHaveLength(5);

    const newEvents = getEvents(gameId).slice(eventStart);
    const discardEvents = newEvents.filter((event: any) => event.type === 'discardEffect');
    const drawEvents = newEvents.filter(
      (event: any) => event.type === 'drawCards' && event.payload?.oracleIrReplayMutation === true,
    );

    expect(discardEvents.length).toBeGreaterThanOrEqual(2);
    expect(discardEvents.map((event: any) => event.payload?.playerId).sort()).toEqual(
      [playerId, player2Id].sort(),
    );
    expect(
      discardEvents.find((event: any) => event.payload?.playerId === playerId)?.payload?.cardIds,
    ).toEqual(expect.arrayContaining(['p1_hand_0', 'p1_hand_1', 'p1_hand_2']));
    expect(
      discardEvents.find((event: any) => event.payload?.playerId === player2Id)?.payload?.cardIds,
    ).toEqual(expect.arrayContaining(['p2_hand_0', 'p2_hand_1', 'p2_hand_2', 'p2_hand_3', 'p2_hand_4']));
    expect(drawEvents.length).toBeGreaterThanOrEqual(2);

    const liveHandIds = {
      p1: ((game.state as any).zones?.[playerId]?.hand || []).map((c: any) => c.id),
      p2: ((game.state as any).zones?.[player2Id]?.hand || []).map((c: any) => c.id),
    };
    const liveGyIds = {
      p1: ((game.state as any).zones?.[playerId]?.graveyard || []).map((c: any) => c.id),
      p2: ((game.state as any).zones?.[player2Id]?.graveyard || []).map((c: any) => c.id),
    };

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    expect(((game.state as any).zones?.[playerId]?.hand || []).map((c: any) => c.id)).toEqual(liveHandIds.p1);
    expect(((game.state as any).zones?.[player2Id]?.hand || []).map((c: any) => c.id)).toEqual(liveHandIds.p2);
    expect(((game.state as any).zones?.[playerId]?.graveyard || []).map((c: any) => c.id))
      .toEqual(expect.arrayContaining(liveGyIds.p1.filter((id: string) => id !== 'windfall_1')));
    expect(((game.state as any).zones?.[player2Id]?.graveyard || []).map((c: any) => c.id))
      .toEqual(expect.arrayContaining(liveGyIds.p2));
    expect(((game.state as any).zones?.[playerId]?.hand || []).map((c: any) => c.id))
      .not.toEqual(expect.arrayContaining(['p1_hand_0', 'p1_hand_1', 'p1_hand_2']));
  }, 20000);
});
