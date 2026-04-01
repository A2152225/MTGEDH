import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

describe('Overload mode selection (integration)', () => {
  const gameId = 'test_overload_mode_selection';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('choosing normal for Vandalblast resumes into target selection instead of re-prompting overload', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'sol_ring_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: {
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
          image_uris: { small: 'https://example.com/sol-ring.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'vandalblast_1',
            name: 'Vandalblast',
            mana_cost: '{R}',
            manaCost: '{R}',
            type_line: 'Sorcery',
            oracle_text: "Destroy target artifact you don't control. Overload {4}{R}",
            image_uris: { small: 'https://example.com/vandalblast.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({ gameId, cardId: 'vandalblast_1' });

    const modeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'vandalblast_1') as any;
    expect(modeStep).toBeDefined();
    expect(modeStep.modeSelectionPurpose).toBe('overload');

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(modeStep.id),
      selections: 'normal',
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('vandalblast_1');
    expect(continueEvent?.payload?.selectedCastMode).toBe('normal');
    expect(continueEvent?.payload?.alternateCostId).toBeUndefined();

    emitted.length = 0;
    await handlers['castSpellFromHand'](continueEvent?.payload);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'vandalblast_1')).toBe(false);

    const targetStep = queue.steps.find((step: any) =>
      step.type === 'target_selection' &&
      String((step as any).sourceName || '') === 'Vandalblast'
    );
    expect(targetStep).toBeDefined();

    const errorEvent = emitted.find((event) => event.event === 'error');
    expect(errorEvent).toBeUndefined();
  });
});