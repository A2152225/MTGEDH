import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe("Belbe's Portal chosen-type activation (integration)", () => {
  const gameId = 'test_belbes_portal_activation';
  const trackedGameIds = new Set<string>();

  async function resetGame(id: string) {
    ResolutionQueueManager.removeQueue(id);
    games.delete(id as any);
    await deleteGame(id);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    trackedGameIds.clear();
    await resetGame(gameId);
  });

  afterEach(async () => {
    for (const trackedGameId of trackedGameIds) {
      await resetGame(trackedGameId);
    }
  });

  it('puts a matching creature from hand onto the battlefield when the ability resolves', async () => {
    const persistentGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    trackedGameIds.add(persistentGameId);
    await resetGame(persistentGameId);

    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const portalOracle =
      "As Belbe's Portal enters the battlefield, choose a creature type.\n"
      + '{3}, {T}: You may put a creature card of the chosen type from your hand onto the battlefield.';

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).battlefield = [
      {
        id: 'portal_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        chosenCreatureType: 'Goblin',
        card: {
          id: 'portal_card_1',
          name: "Belbe's Portal",
          type_line: 'Artifact',
          oracle_text: portalOracle,
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'gob_hand_1',
            name: 'Goblin Guide',
            type_line: 'Creature — Goblin Scout',
            power: '2',
            toughness: '2',
          },
          {
            id: 'elf_hand_1',
            name: 'Elvish Mystic',
            type_line: 'Creature — Elf Druid',
            power: '1',
            toughness: '1',
          },
        ],
        graveyard: [],
        exile: [],
        library: [],
        handCount: 2,
        graveyardCount: 0,
        exileCount: 0,
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(persistentGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: persistentGameId,
      permanentId: 'portal_1',
      abilityId: 'portal_card_1-ability-0',
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);
    expect((game.state as any).battlefield?.find((perm: any) => perm.id === 'portal_1')?.tapped).toBe(true);

    game.resolveTopOfStack();

    const modalStep = ResolutionQueueManager.getQueue(persistentGameId).steps[0] as any;
    expect(modalStep?.type).toBe('modal_choice');
    expect(modalStep?.putFromHandData?.validCardIds).toContain('gob_hand_1');
    expect(modalStep?.putFromHandData?.validCardIds).not.toContain('elf_hand_1');

    await handlers['submitResolutionResponse']({
      gameId: persistentGameId,
      stepId: String(modalStep.id),
      selections: ['gob_hand_1'],
    });

    const goblinOnBattlefield = ((game.state as any).battlefield || []).find((perm: any) => perm?.card?.name === 'Goblin Guide');
    expect(goblinOnBattlefield).toBeTruthy();
    expect(((game.state as any).zones?.[playerId]?.hand || []).some((card: any) => card?.id === 'gob_hand_1')).toBe(false);
  });
});
