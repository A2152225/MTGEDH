import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import GameManager from '../src/GameManager.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import {
  applyOracleIRStepsOnServer,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const thassaEtbEffect =
  'look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.';

const thassaLookStep = {
  kind: 'look_select_top',
  who: { kind: 'you' },
  amount: { kind: 'x' },
  whereX: { kind: 'where', raw: 'your devotion to blue' },
  choose: { kind: 'number', value: 1 },
  chooseMin: 0,
  destination: 'library_top',
  restDestination: 'library',
  restRandomOrder: true,
  optional: true,
  raw:
    'look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order',
} as const;

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  GameManager.deleteGame(gameId);
}

function seedThassaBoard(gameId: string) {
  const game = createInitialGameState(gameId);
  const playerId = 'p1' as PlayerID;
  game.applyEvent!({ type: 'join', playerId, name: 'P1' } as any);
  (game as any).gameId = gameId;

  const library = [
    { id: 'top_card', name: 'Top Card', type_line: 'Instant', oracle_text: '' },
    { id: 'mid_card', name: 'Mid Card', type_line: 'Creature — Merfolk', oracle_text: '' },
    { id: 'bottom_card', name: 'Bottom Card', type_line: 'Land', oracle_text: '' },
    { id: 'deep_card', name: 'Deep Card', type_line: 'Sorcery', oracle_text: '' },
    { id: 'last_card', name: 'Last Card', type_line: 'Artifact', oracle_text: '' },
  ];

  (game.state as any).battlefield = [
    {
      id: 'oracle_1',
      controller: playerId,
      owner: playerId,
      card: {
        id: 'oracle_card',
        name: "Thassa's Oracle",
        type_line: 'Creature — Merfolk Wizard',
        mana_cost: '{U}{U}',
        oracle_text:
          "When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.",
      },
    },
    {
      id: 'lord_1',
      controller: playerId,
      owner: playerId,
      card: {
        id: 'lord_card',
        name: 'Lord of Atlantis',
        type_line: 'Creature — Merfolk',
        mana_cost: '{U}{U}',
        oracle_text: 'Other Merfolk creatures get +1/+1 and have islandwalk.',
      },
    },
  ];

  const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
  player.library = library.map((card) => ({ ...card, zone: 'library' }));
  (game as any).libraries = new Map([[playerId, library.map((card) => ({ ...card }))]]);
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      libraryCount: library.length,
    },
  };

  games.set(gameId, game as any);
  ResolutionQueueManager.removeQueue(gameId);
  return { game, playerId, library };
}

describe("Thassa's Oracle ETB library search socket integration", () => {
  const gameId = 'thassa_oracle_etb_socket';
  const playerId = 'p1' as PlayerID;

  beforeAll(async () => {
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameId);
  });

  it('queues effect-program may-choice on ETB and applies devotion library look after socket yes', async () => {
    const { game, library } = seedThassaBoard(gameId);
    const libraryBefore = library.map((card) => card.id);

    executeTriggerEffect(
      game as any,
      playerId,
      "Thassa's Oracle",
      thassaEtbEffect,
      {
        type: 'triggered_ability',
        controller: playerId,
        source: 'oracle_1',
        permanentId: 'oracle_1',
        id: 'thassa_etb',
        triggerType: 'etb',
      },
    );

    const optionStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any)?.effectProgramPrompt === true);
    expect(optionStep).toBeTruthy();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);

    await handlers.submitResolutionResponse?.({
      gameId,
      stepId: String(optionStep!.id),
      selections: ['yes'],
      cancelled: false,
    });

    const refreshed = games.get(gameId)!;
    const libraryAfter = ((refreshed as any).libraries.get(playerId) || []).map((card: any) => card.id);
    expect(libraryAfter).toHaveLength(libraryBefore.length);
    expect(libraryAfter).not.toEqual(libraryBefore);
    expect((refreshed.state as any).winCondition).toBeUndefined();
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues LIBRARY_SEARCH for look_select_top and applies top selection via socket', async () => {
    const { game } = seedThassaBoard(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'oracle_1',
      sourceName: "Thassa's Oracle",
    });

    applyOracleIRStepsOnServer(
      game as any,
      (game as any).state,
      [thassaLookStep as any],
      irCtx,
      { allowOptional: false },
      { controller: playerId, sourceId: 'oracle_1', sourceName: "Thassa's Oracle" },
    );

    const searchStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect((searchStep as any)?.destination).toBe('top');
    expect((searchStep as any)?.maxSelections).toBe(1);
    expect(String((searchStep as any)?.oracleIrChoiceStepJson || '')).toContain('look_select_top');
    expect((searchStep as any)?.availableCards?.length).toBe(4);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);

    await handlers.submitResolutionResponse?.({
      gameId,
      stepId: String(searchStep!.id),
      selections: ['mid_card'],
      cancelled: false,
    });

    const refreshed = games.get(gameId)!;
    const libraryIds = ((refreshed as any).libraries.get(playerId) || []).map((card: any) => card.id);
    expect(libraryIds[0]).toBe('mid_card');
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
