import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

let tempDir: string | null = null;

function writeLookupSources(payload: { oracleCards: any[]; atomicData?: Record<string, any[]> }): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtgedh-card-name-choice-'));
  fs.writeFileSync(path.join(tempDir, 'oracle-cards.json'), JSON.stringify(payload.oracleCards));
  fs.writeFileSync(path.join(tempDir, 'AtomicCards.json'), JSON.stringify({ data: payload.atomicData || {} }));

  process.env.CARD_LOOKUP_SQLITE_FILE = path.join(tempDir, 'card-lookup.sqlite');
  process.env.CARD_LOOKUP_ORACLE_FILE = path.join(tempDir, 'oracle-cards.json');
  process.env.CARD_LOOKUP_ATOMIC_FILE = path.join(tempDir, 'AtomicCards.json');
}

describe('CARD_NAME_CHOICE local validation fallback (integration)', () => {
  const gameId = 'test_card_name_choice_local_validation';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    try {
      const localLookup = await import('../src/services/localCardLookup.js');
      localLookup.resetLocalCardLookupForTests();
    } catch {
      // ignore cleanup failures
    }

    delete process.env.CARD_LOOKUP_SQLITE_FILE;
    delete process.env.CARD_LOOKUP_ORACLE_FILE;
    delete process.env.CARD_LOOKUP_ATOMIC_FILE;

    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('rejects arbitrary text and canonicalizes indexed card names when candidateNames are absent', async () => {
    writeLookupSources({
      oracleCards: [
        {
          id: 'black-lotus',
          name: 'Black Lotus',
          type_line: 'Artifact',
        },
        {
          id: 'sol-ring',
          name: 'Sol Ring',
          type_line: 'Artifact',
        },
      ],
    });

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    const permanentId = 'perm1';
    (game.state as any).battlefield = [{ id: permanentId, controllerId: p1, name: 'Pithing Needle' }];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.CARD_NAME_CHOICE,
      playerId: p1 as any,
      description: 'Choose a card name',
      mandatory: true,
      permanentId,
      cardName: 'Pithing Needle',
      restrictionText: 'card',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry.type === 'card_name_choice');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'X' });

    const invalidSelectionError = emitted.find(e => e.event === 'error');
    expect(invalidSelectionError?.payload?.code).toBe('INVALID_SELECTION');
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry.id) === stepId)).toBe(true);

    emitted.length = 0;
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'black lotus' });

    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry.id) === stepId)).toBe(false);
    expect((game.state as any).battlefield[0]?.chosenCardName).toBe('Black Lotus');
  });
});