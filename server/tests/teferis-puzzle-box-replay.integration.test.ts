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

describe("Teferi's Puzzle Box IR zone-move + drawCards event-log replay", () => {
  const gameId = 'test_teferis_puzzle_box_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetSocketGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetSocketGame(gameId);
  });

  it('persists hand→library bottom moves + drawCards and restores after event replay', () => {
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
      ...Array.from({ length: 2 }, (_, index) => ({
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
    seedAndApply('drawCards', { playerId: player2Id, count: 2 });

    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(3);

    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).battlefield = [
      {
        id: 'puzzle_box_perm',
        controller: player2Id,
        tapped: false,
        card: {
          id: 'puzzle_box_card',
          name: "Teferi's Puzzle Box",
          type_line: 'Artifact',
          oracle_text:
            "At the beginning of each player's draw step, that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards.",
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'puzzle_box_trigger_1',
        type: 'triggered_ability',
        controller: player2Id,
        source: 'puzzle_box_perm',
        sourceName: "Teferi's Puzzle Box",
        triggerType: 'draw_step',
        triggeringPlayer: playerId,
        description:
          'that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards.',
        effect:
          'that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards.',
        mandatory: true,
      },
    ];

    const eventStart = getEvents(gameId).length;
    resolveTopOfStack(game as any);

    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(3);
    expect(
      ((game.state as any).zones?.[playerId]?.hand || []).map((c: any) => c.id),
    ).not.toEqual(expect.arrayContaining(['p1_hand_0', 'p1_hand_1', 'p1_hand_2']));

    const newEvents = getEvents(gameId).slice(eventStart);
    const zoneMoves = newEvents.filter((event: any) => event.type === 'effectProgramZoneMove');
    const drawEvents = newEvents.filter(
      (event: any) => event.type === 'drawCards' && event.payload?.oracleIrReplayMutation === true,
    );

    expect(zoneMoves.length).toBeGreaterThanOrEqual(3);
    expect(zoneMoves.every((event: any) => event.payload?.fromZone === 'hand')).toBe(true);
    expect(zoneMoves.every((event: any) => event.payload?.toZone === 'library')).toBe(true);
    expect(zoneMoves.every((event: any) => event.payload?.libraryPlacement === 'bottom')).toBe(true);
    expect(drawEvents.length).toBeGreaterThanOrEqual(1);
    expect(drawEvents[0]?.payload?.playerId).toBe(playerId);
    expect(drawEvents[0]?.payload?.count).toBe(3);

    const liveHandIds = ((game.state as any).zones?.[playerId]?.hand || []).map((c: any) => c.id);
    const liveLib = game.libraries.get(playerId) || [];
    const liveLibIds = liveLib.map((c: any) => c.id);

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    expect(((game.state as any).zones?.[playerId]?.hand || []).map((c: any) => c.id)).toEqual(liveHandIds);
    expect((game.libraries.get(playerId) || []).map((c: any) => c.id)).toEqual(liveLibIds);
    expect(liveLibIds.slice(-3)).toEqual(expect.arrayContaining(['p1_hand_0', 'p1_hand_1', 'p1_hand_2']));
  }, 20000);
});
