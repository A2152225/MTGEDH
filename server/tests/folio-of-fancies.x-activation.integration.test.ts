import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
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
    rooms: { has: (_room: string) => true, add: (_room: string) => {}, delete: (_room: string) => {} } as any,
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Folio of Fancies X activation (integration)', () => {
  const gameId = 'test_folio_of_fancies_x_activation';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('uses the selected X value for cost payment and resolves the draw ability with numeric text', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 5 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    game.importDeckResolved(p1 as any, [
      { id: 'p1_lib_1', name: 'P1 Card 1', type_line: 'Artifact', oracle_text: '' },
      { id: 'p1_lib_2', name: 'P1 Card 2', type_line: 'Artifact', oracle_text: '' },
      { id: 'p1_lib_3', name: 'P1 Card 3', type_line: 'Artifact', oracle_text: '' },
    ] as any);
    game.importDeckResolved(p2 as any, [
      { id: 'p2_lib_1', name: 'P2 Card 1', type_line: 'Artifact', oracle_text: '' },
      { id: 'p2_lib_2', name: 'P2 Card 2', type_line: 'Artifact', oracle_text: '' },
      { id: 'p2_lib_3', name: 'P2 Card 3', type_line: 'Artifact', oracle_text: '' },
    ] as any);

    (game.state as any).battlefield = [
      {
        id: 'folio_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'folio_card_1',
          name: 'Folio of Fancies',
          type_line: 'Artifact',
          oracle_text: 'Players have no maximum hand size.\n{X}{X}, {T}: Each player draws X cards.\n{2}{U}, {T}: Each opponent mills cards equal to the number of cards in their hand.',
          image_uris: { small: 'https://example.com/folio.jpg' },
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'folio_1',
      abilityId: 'folio_1-ability-0',
      xValue: 2,
    });

    const folio = (game.state as any).battlefield.find((perm: any) => perm.id === 'folio_1');
    expect(Boolean(folio?.tapped)).toBe(true);
    expect((game.state as any).manaPool[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toBe('each player draws 2 cards.');
    expect(Number(stack[0]?.xValue)).toBe(2);

    const activationEvents = getEvents(gameId).filter((event: any) => String(event?.type) === 'activateBattlefieldAbility');
    expect(activationEvents.length).toBeGreaterThan(0);
    const lastActivation = activationEvents[activationEvents.length - 1] as any;
    expect(Number(lastActivation?.payload?.xValue)).toBe(2);
    expect(String(lastActivation?.payload?.abilityText || '')).toBe('each player draws 2 cards.');

    game.resolveTopOfStack();

    const p1Zones = (game.state as any).zones?.[p1];
    const p2Zones = (game.state as any).zones?.[p2];
    expect(Array.isArray(p1Zones?.hand)).toBe(true);
    expect(Array.isArray(p2Zones?.hand)).toBe(true);
    expect(p1Zones.hand).toHaveLength(2);
    expect(p2Zones.hand).toHaveLength(2);
    expect(Number(p1Zones.libraryCount)).toBe(1);
    expect(Number(p2Zones.libraryCount)).toBe(1);

    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});