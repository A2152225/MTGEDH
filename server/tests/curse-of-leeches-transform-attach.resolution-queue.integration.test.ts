import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { transformPermanentToFace } from '../src/state/modules/day-night.js';

const LEECH_BACK =
  "Nightbound\nAs this permanent transforms into Leech, attach it to a player.\nAt the beginning of your upkeep, any opponent who has 3 or less life loses the game.";

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: any[], sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: any[], gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

function leechesPermanent(p1: string) {
  return {
    id: 'leeches_1',
    controller: p1,
    owner: p1,
    transformed: false,
    card: {
      name: 'Curse of Leeches',
      layout: 'transform',
      type_line: 'Enchantment — Aura Curse',
      oracle_text: 'Daybound\nEnchant player',
      card_faces: [
        { name: 'Curse of Leeches', type_line: 'Enchantment — Aura Curse', oracle_text: 'Daybound\nEnchant player' },
        { name: 'Leech', type_line: 'Creature — Leech Horror', oracle_text: LEECH_BACK, power: '4', toughness: '4' },
      ],
    },
  };
}

describe('Curse of Leeches transform-attach player choice', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_leeches_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('queues a player picker when it transforms with no chosen player, then attaches', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    (game.state as any).players = [{ id: p1, name: 'P1', life: 40 }, { id: p2, name: 'P2', life: 40 }];
    const perm = leechesPermanent(p1);
    (game.state as any).battlefield = [perm];

    transformPermanentToFace(perm, 1, game as any);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.transformAttachToPlayerChoice === true) as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('target_selection');
    expect(step.mandatory).toBe(true);
    expect((step.validTargets || []).map((t: any) => t.id).sort()).toEqual([p1, p2].sort());
    expect(perm.attachedTo).toBeUndefined();

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: [p2], cancelled: false });

    expect(perm.attachedTo).toBe(p2);
    expect(perm.enchantedPlayerId).toBe(p2);
    expect(perm.attachedToPlayerId).toBe(p2);
  });

  it('attaches immediately when a player was already chosen', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    (game.state as any).players = [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }];
    const perm = leechesPermanent(p1);
    (perm as any).chosenPlayerId = p2;
    (game.state as any).battlefield = [perm];
    transformPermanentToFace(perm, 1, game as any);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.transformAttachToPlayerChoice === true)).toBe(false);
    expect(perm.attachedTo).toBe(p2);
  });
});
