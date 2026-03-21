import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
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

describe('Nykthos devotion color choice (integration)', () => {
  const gameId = 'test_nykthos_devotion_color_choice';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('pays {2}, queues a color choice, and adds mana equal to devotion to the chosen color', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).battlefield = [
      {
        id: 'nykthos_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'nykthos_card',
          name: 'Nykthos, Shrine to Nyx',
          type_line: 'Legendary Land',
          oracle_text: '{T}: Add {C}. {2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.',
        },
      },
      {
        id: 'perm_u_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'perm_u_card_1',
          name: 'Merrow Reejerey',
          mana_cost: '{2}{U}',
          type_line: 'Creature - Merfolk Soldier',
          oracle_text: '',
        },
      },
      {
        id: 'perm_u_2',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'perm_u_card_2',
          name: 'Deeproot Waters',
          mana_cost: '{2}{U}',
          type_line: 'Enchantment',
          oracle_text: '',
        },
      },
      {
        id: 'perm_u_3',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'perm_u_card_3',
          name: 'Stonybrook Banneret',
          mana_cost: '{1}{U}',
          type_line: 'Creature - Merfolk Wizard',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'nykthos_1',
      abilityId: 'nykthos_card-ability-1',
    });

    expect(Number((game.state as any).manaPool[p1].colorless || 0)).toBe(0);
    expect(Boolean(((game.state as any).battlefield || []).find((perm: any) => perm.id === 'nykthos_1')?.tapped)).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('mana_color_selection');
    expect(step.selectionKind).toBe('any_color');
    expect(step.dynamicAmountSource).toBe('devotion');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: 'blue',
    });

    expect(Number((game.state as any).manaPool[p1].blue || 0)).toBe(3);
    expect(Number((game.state as any).manaPool[p1].colorless || 0)).toBe(0);
  });
});