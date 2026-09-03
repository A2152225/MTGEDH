import { afterEach, describe, expect, it } from 'vitest';
import {
  getActivePriorityPlayers,
  playerCannotReceivePriority,
  playerHasSeatedDeck,
} from '../src/state/modules/priorityEligibility.js';
import { queueEachPlayerMayPutLandOrDrawBatch } from '../src/state/modules/triggerLandPlayPromptUtils.js';
import { kickIdleAutoPassPendingResolutionSteps } from '../src/socket/util-handlers/autoPassIdleResolutionKick.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function seatedAi(id: string, seat: number) {
  return { id, name: id, seat, isAI: true };
}

function ghostSeat(id: string, seat: number) {
  return { id, name: 'Spectator Keep', seat };
}

function liveGameCtx(overrides: Record<string, unknown> = {}) {
  return {
    gameId: 'test_deckless_player_not_in_game',
    inactive: new Set<string>(),
    libraries: new Map([
      ['p_ai1', [{ id: 'lib_1', name: 'Island' }]],
      ['p_ai2', [{ id: 'lib_2', name: 'Forest' }]],
    ]),
    state: {
      phase: 'ending',
      step: 'END',
      turnPlayer: 'p_ai1',
      priority: 'p_ai1',
      players: [seatedAi('p_ai1', 0), seatedAi('p_ai2', 1), ghostSeat('p_ghost', 2)],
      commandZone: {
        p_ai1: { commanderIds: ['cmd_1'], commanderNames: ['Kynaios and Tiro of Meletis'] },
        p_ai2: { commanderIds: ['cmd_2'], commanderNames: ['Atraxa, Praetors\' Voice'] },
      },
      zones: {
        p_ai1: { library: [{ id: 'lib_1' }], libraryCount: 1, hand: [], handCount: 0 },
        p_ai2: { library: [{ id: 'lib_2' }], libraryCount: 1, hand: [], handCount: 0 },
        p_ghost: { library: [], libraryCount: 0, hand: [], handCount: 0 },
      },
      battlefield: [],
      ...overrides,
    },
  };
}

describe('deckless seats are not in the current player list after pre-game', () => {
  const gameId = 'test_deckless_player_not_in_game';

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('treats a post-pregame seat with no commander or library as out', () => {
    const ctx = liveGameCtx();
    expect(playerHasSeatedDeck(ctx.state.players[0], ctx)).toBe(true);
    expect(playerHasSeatedDeck(ctx.state.players[2], ctx)).toBe(false);
    expect(playerCannotReceivePriority(ctx.state.players[2], ctx)).toBe(true);
    expect(getActivePriorityPlayers(ctx).map((entry) => entry.id)).toEqual(['p_ai1', 'p_ai2']);
  });

  it('still includes deckless seats during pre-game', () => {
    const ctx = liveGameCtx({ phase: 'pre_game' });
    expect(playerCannotReceivePriority(ctx.state.players[2], ctx)).toBe(false);
    expect(getActivePriorityPlayers(ctx).map((entry) => entry.id)).toEqual(['p_ai1', 'p_ai2', 'p_ghost']);
  });

  it('does not drop mill-out players who still have commander identity', () => {
    const ctx = liveGameCtx();
    ctx.state.zones.p_ai2.library = [];
    ctx.state.zones.p_ai2.libraryCount = 0;
    ctx.libraries.set('p_ai2', []);
    expect(playerHasSeatedDeck(ctx.state.players[1], ctx)).toBe(true);
    expect(getActivePriorityPlayers(ctx).map((entry) => entry.id)).toEqual(['p_ai1', 'p_ai2']);
  });

  it('does not treat empty fixtures as ghosts when nobody has a deck', () => {
    const ctx = {
      state: {
        phase: 'precombatMain',
        players: [
          { id: 'p1', name: 'P1', seat: 0 },
          { id: 'p2', name: 'P2', seat: 1 },
        ],
      },
    };
    expect(getActivePriorityPlayers(ctx).map((entry) => entry.id)).toEqual(['p1', 'p2']);
  });

  it('does not ghost an empty human when the only other seat is an empty AI', () => {
    const ctx = {
      state: {
        phase: 'precombatMain',
        players: [
          { id: 'p_human', name: 'Human', seat: 0 },
          { id: 'p_opp', name: 'Opp', seat: 1, isAI: true },
        ],
        zones: {
          p_human: { hand: [], graveyard: [], library: [] },
          p_opp: { hand: [], graveyard: [], library: [] },
        },
        battlefield: [],
      },
    };
    expect(playerCannotReceivePriority(ctx.state.players[0], ctx)).toBe(false);
    expect(getActivePriorityPlayers(ctx).map((entry) => entry.id)).toEqual(['p_human', 'p_opp']);
  });

  it('does not ghost an empty player when another seat only has a hand', () => {
    const ctx = {
      state: {
        phase: 'precombatMain',
        players: [
          { id: 'p1', name: 'P1', seat: 0 },
          { id: 'p2', name: 'P2', seat: 1 },
        ],
        zones: {
          p1: { hand: [], graveyard: [], library: [] },
          p2: {
            hand: [{ id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant' }],
            graveyard: [],
            library: [],
          },
        },
        battlefield: [],
      },
    };
    expect(playerHasSeatedDeck(ctx.state.players[1], ctx)).toBe(true);
    expect(playerCannotReceivePriority(ctx.state.players[0], ctx)).toBe(false);
    expect(getActivePriorityPlayers(ctx).map((entry) => entry.id)).toEqual(['p1', 'p2']);
  });

  it('does not ghost empty-fixture opponents when one player has a battlefield permanent', () => {
    const ctx = {
      state: {
        phase: 'precombatMain',
        players: [
          { id: 'p1', name: 'P1', seat: 0 },
          { id: 'p2', name: 'P2', seat: 1 },
        ],
        battlefield: [{ id: 'perm_1', controller: 'p1', card: { name: 'Bear' } }],
        zones: {
          p1: { library: [], libraryCount: 0, hand: [], handCount: 0 },
          p2: { library: [], libraryCount: 0, hand: [], handCount: 0 },
        },
      },
    };
    expect(playerHasSeatedDeck(ctx.state.players[0], ctx)).toBe(true);
    expect(playerHasSeatedDeck(ctx.state.players[1], ctx)).toBe(false);
    expect(playerCannotReceivePriority(ctx.state.players[1], ctx)).toBe(false);
    expect(getActivePriorityPlayers(ctx).map((entry) => entry.id)).toEqual(['p1', 'p2']);
  });

  it('keeps a graveyard-only seat living when another player has a library', () => {
    const ctx = {
      libraries: new Map([
        ['p2', [{ id: 'lib_2', name: 'Island' }]],
      ]),
      state: {
        phase: 'precombatMain',
        players: [
          { id: 'p1', name: 'P1', seat: 0 },
          { id: 'p2', name: 'P2', seat: 1 },
        ],
        battlefield: [],
        zones: {
          p1: {
            library: [],
            libraryCount: 0,
            hand: [],
            handCount: 0,
            graveyard: [{ id: 'gy_1', name: 'Consider' }],
            graveyardCount: 1,
          },
          p2: { library: [{ id: 'lib_2' }], libraryCount: 1, hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
        },
      },
    };
    expect(playerHasSeatedDeck(ctx.state.players[0], ctx)).toBe(true);
    expect(playerCannotReceivePriority(ctx.state.players[0], ctx)).toBe(false);
    expect(getActivePriorityPlayers(ctx).map((entry) => entry.id)).toEqual(['p1', 'p2']);
  });

  it('queues Kynaios land/draw choices only for living players', () => {
    const ctx = liveGameCtx();
    expect(queueEachPlayerMayPutLandOrDrawBatch(ctx as any, {
      sourceController: 'p_ai1',
      sourceName: 'Kynaios and Tiro of Meletis',
      batchId: 'kynaios_batch',
    })).toBe(true);

    const playerIds = ResolutionQueueManager.getQueue(gameId).steps
      .filter((step: any) => step.type === ResolutionStepType.KYNAIOS_CHOICE)
      .map((step: any) => step.playerId);
    expect(playerIds).toEqual(['p_ai1', 'p_ai2']);
  });

  it('cancels leftover Kynaios prompts owned by a deckless seat', () => {
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.KYNAIOS_CHOICE,
      playerId: 'p_ghost',
      description: 'ghost',
      mandatory: false,
    } as any);
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.KYNAIOS_CHOICE,
      playerId: 'p_ai1',
      description: 'ai',
      mandatory: false,
    } as any);

    const game = {
      ...liveGameCtx(),
      state: {
        ...liveGameCtx().state,
        players: [
          { ...seatedAi('p_ai1', 0), isAI: true },
          ghostSeat('p_ghost', 2),
        ],
      },
    };

    kickIdleAutoPassPendingResolutionSteps({} as any, game as any, gameId);

    const pending = ResolutionQueueManager.getQueue(gameId).steps
      .filter((step: any) => String(step?.status || '').toLowerCase() !== 'cancelled');
    expect(pending.every((step: any) => step.playerId !== 'p_ghost')).toBe(true);
    expect(pending.some((step: any) => step.playerId === 'p_ai1')).toBe(true);
  });
});
