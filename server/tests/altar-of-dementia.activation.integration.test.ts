/**
 * Altar of Dementia: sacrifice a creature, then choose a player to mill.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

function createNoopIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: { has: () => true, add: () => {}, delete: () => {} } as any,
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Altar of Dementia activation', () => {
  const gameId = 'test_altar_of_dementia_activation';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((r) => setTimeout(r, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('parses mill amount as sacrificed creature power', () => {
    const ir = parseOracleTextToIR(
      "Target player mills cards equal to the sacrificed creature's power.",
      'Altar of Dementia',
    );
    const mill = ir.abilities?.[0]?.steps?.find((s: any) => s.kind === 'mill');
    expect(mill).toMatchObject({
      kind: 'mill',
      who: { kind: 'target_player' },
      amount: { kind: 'object_stat', subject: 'the_sacrificed_creature', stat: 'power' },
    });
  });

  it('after sacrifice cost, queues player mill target selection with tapped sacrifice options', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game.state as any).players = [
      { id: playerId, name: 'You', spectator: false, life: 40 },
      { id: opponentId, name: 'Opp', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], library: Array.from({ length: 20 }, (_, i) => ({ id: `lib1_${i}` })), graveyard: [] },
      [opponentId]: { hand: [], library: Array.from({ length: 20 }, (_, i) => ({ id: `lib2_${i}` })), graveyard: [] },
    };
    (game.state as any).battlefield = [
      {
        id: 'altar_1',
        controller: playerId,
        owner: playerId,
        card: {
          id: 'altar_card',
          name: 'Altar of Dementia',
          type_line: 'Artifact',
          oracle_text: "Sacrifice a creature: Target player mills cards equal to the sacrificed creature's power.",
        },
      },
      {
        id: 'merfolk_ready',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'm1',
          name: 'Merfolk Token',
          type_line: 'Creature — Merfolk',
          power: '1',
          toughness: '1',
          oracle_text: '',
        },
      },
      {
        id: 'merfolk_tapped',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: {
          id: 'm2',
          name: 'Merfolk Token',
          type_line: 'Creature — Merfolk',
          power: '1',
          toughness: '1',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms = new Set([gameId]);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket);
    registerResolutionHandlers(io as any, socket);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'altar_1',
      abilityId: 'altar-ability-0',
    });

    const sacrificeStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (s: any) => s.sacrificeAbilityAsCost === true,
    );
    expect(sacrificeStep).toBeDefined();
    const sacrificeTargets = (sacrificeStep as any).validTargets || [];
    expect(sacrificeTargets.some((t: any) => t.id === 'merfolk_tapped' && t.tapped === true)).toBe(true);
    expect(sacrificeTargets.some((t: any) => t.id === 'merfolk_ready' && t.tapped === false)).toBe(true);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: sacrificeStep!.id,
      selections: ['merfolk_tapped'],
      cancelled: false,
    });

    const playerTargetStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (s: any) => s.battlefieldAbilityTargetSelection === true && s.status !== 'completed',
    );
    expect(playerTargetStep).toBeDefined();
    expect((playerTargetStep as any).targetTypes).toContain('player');
    const playerIds = ((playerTargetStep as any).validTargets || []).map((t: any) => t.id);
    expect(playerIds).toEqual(expect.arrayContaining([playerId, opponentId]));
    expect((playerTargetStep as any).lastSacrificedPermanents?.[0]?.id).toBe('merfolk_tapped');
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});
