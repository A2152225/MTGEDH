import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack } from '../src/state/modules/stack.js';
import type { PlayerID } from '../../shared/src/index.js';
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

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  deleteGame(gameId);
}

const academicProbationOracle = "Choose one -\n• Choose a nonland card name. Opponents can't cast spells with the chosen name until your next turn.\n• Choose target nonland permanent. Until your next turn, it can't attack or block, and its activated abilities can't be activated.";

describe('Academic Probation', () => {
  const gameId = 'test_academic_probation';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    resetGame(gameId);
  });

  it('resumes from name mode into payment without prompting for a target', async () => {
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
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'academic_probation_1',
            name: 'Academic Probation',
            mana_cost: '{1}{W}',
            manaCost: '{1}{W}',
            type_line: 'Sorcery',
            oracle_text: academicProbationOracle,
            image_uris: { small: 'https://example.com/academic-probation.jpg' },
            colors: ['W'],
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
      [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'academic_probation_1' });

    const modeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'academic_probation_1') as any;
    expect(modeStep).toBeDefined();

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(modeStep.id),
      selections: 'mode_1',
    });

    expect(emitted.some((event) => event.event === 'castSpellFromHandContinue')).toBe(false);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step.type === 'target_selection')).toBe(false);
    expect(emitted.find((event) => event.event === 'error')).toBeUndefined();
  });

  it('resumes from permanent mode into target selection without re-prompting modes', async () => {
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
            id: 'academic_probation_1',
            name: 'Academic Probation',
            mana_cost: '{1}{W}',
            manaCost: '{1}{W}',
            type_line: 'Sorcery',
            oracle_text: academicProbationOracle,
            image_uris: { small: 'https://example.com/academic-probation.jpg' },
            colors: ['W'],
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
      [playerId]: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'academic_probation_1' });

    const modeStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'academic_probation_1') as any;
    expect(modeStep).toBeDefined();

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(modeStep.id),
      selections: 'mode_2',
    });

    expect(emitted.some((event) => event.event === 'castSpellFromHandContinue')).toBe(false);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step.type === 'mode_selection' && String((step as any).sourceId || '') === 'academic_probation_1')).toBe(false);
    expect(queue.steps.some((step: any) => step.type === 'target_selection' && String((step as any).sourceName || '') === 'Academic Probation')).toBe(true);
  });

  it('queues a spell-side card-name choice and keeps the spell on the stack', () => {
    const game = createInitialGameState('t_academic_probation_spell_choice');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).stack = [
      {
        id: 'academic_probation_stack_1',
        cardId: 'academic_probation_stack_1',
        type: 'spell',
        controller: p1,
        selectedModes: ['mode_1'],
        card: {
          id: 'academic_probation_stack_1',
          name: 'Academic Probation',
          type_line: 'Sorcery',
          oracle_text: academicProbationOracle,
        },
      },
    ];

    ResolutionQueueManager.removeQueue('t_academic_probation_spell_choice');
    resolveTopOfStack(game as any);

    const queue = ResolutionQueueManager.getQueue('t_academic_probation_spell_choice');
    expect(queue.steps.some((step: any) => step.type === 'card_name_choice' && String((step as any).spellId || '') === 'academic_probation_stack_1')).toBe(true);
    expect(((game.state as any).stack || []).length).toBe(1);
  });

  it('applies the permanent restriction mode during resolution', () => {
    const game = createInitialGameState('t_academic_probation_permanent_mode');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).turnNumber = 3;
    (game.state as any).battlefield = [
      {
        id: 'signet_1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'signet_card_1',
          name: 'Arcane Signet',
          type_line: 'Artifact',
          oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'academic_probation_stack_2',
        cardId: 'academic_probation_stack_2',
        type: 'spell',
        controller: p1,
        targets: ['signet_1'],
        selectedModes: ['mode_2'],
        card: {
          id: 'academic_probation_stack_2',
          name: 'Academic Probation',
          type_line: 'Sorcery',
          oracle_text: academicProbationOracle,
        },
      },
    ];

    resolveTopOfStack(game as any);

    const permanent = ((game.state as any).battlefield || [])[0] as any;
    expect(Array.isArray(permanent.grantedAbilities)).toBe(true);
    expect(permanent.grantedAbilities).toContain("This permanent can't attack or block (until your next turn)");
    expect(Array.isArray(permanent.untilNextTurnCantActivateAbilities)).toBe(true);
    expect(permanent.untilNextTurnCantActivateAbilities.length).toBe(1);
  });
});