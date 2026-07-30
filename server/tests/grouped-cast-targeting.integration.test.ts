import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { castSpell } from '../src/state/modules/stackCastSpellUtils.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

const GUFF_TEXT =
  "For each player, choose target nonenchantment, nonland permanent that player controls. Those permanents' owners shuffle them into their libraries. Each player who controlled one of those permanents exiles cards from the top of their library until they exile a nonland card, then puts the rest on the bottom of their library in a random order. Each player may cast the nonland card they exiled without paying its mana cost.";

function createNoopIo() {
  return {
    to: () => ({ emit: () => undefined }),
    emit: () => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  return {
    handlers,
    socket: {
      data: { playerId, spectator: false, gameId },
      rooms: new Set([gameId]),
      on: (event: string, handler: Function) => {
        handlers[event] = handler;
      },
      emit: (event: string, payload: any) => {
        emitted.push({ event, payload });
      },
    } as any,
  };
}

function setupGame(gameId: string, includeP3Target = true) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game = ensureGame(gameId) as any;
  game.state.players = [
    { id: 'p1', name: 'Caster', spectator: false, life: 40 },
    { id: 'p2', name: 'Second', spectator: false, life: 40 },
    { id: 'p3', name: 'Third', spectator: false, life: 40 },
  ];
  game.state.turnOrder = ['p1', 'p2', 'p3'];
  game.state.phase = 'main1';
  game.state.priority = 'p1';
  game.state.zones = {
    p1: {
      hand: [{
        id: 'guff',
        name: 'Guff Rewrites History',
        mana_cost: '{2}{R}',
        type_line: 'Instant',
        oracle_text: GUFF_TEXT,
      }],
      handCount: 1,
      graveyard: [],
      exile: [],
    },
    p2: { hand: [], graveyard: [], exile: [] },
    p3: { hand: [], graveyard: [], exile: [] },
  };
  game.state.battlefield = [
    { id: 'p1_rock', owner: 'p1', controller: 'p1', card: { name: 'Rock', type_line: 'Artifact' } },
    { id: 'p2_land', owner: 'p2', controller: 'p2', card: { name: 'Land', type_line: 'Land' } },
    { id: 'p2_bear', owner: 'p2', controller: 'p2', card: { name: 'Bear', type_line: 'Creature' } },
    { id: 'p3_aura', owner: 'p3', controller: 'p3', card: { name: 'Aura', type_line: 'Enchantment' } },
    ...(includeP3Target
      ? [{ id: 'p3_walker', owner: 'p3', controller: 'p3', card: { name: 'Walker', type_line: 'Planeswalker' } }]
      : []),
  ];
  return game;
}

describe('grouped cast-time targeting', () => {
  const gameIds = new Set<string>();

  beforeAll(async () => initDb());
  afterEach(async () => {
    for (const gameId of gameIds) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
    }
    gameIds.clear();
  });

  it('queues one persisted section for every player, including the caster', async () => {
    const gameId = `test_grouped_cast_${Math.random().toString(36).slice(2)}`;
    gameIds.add(gameId);
    setupGame(gameId);
    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    registerGameActions(createNoopIo(), socket);

    await handlers.requestCastSpell({ gameId, cardId: 'guff' });

    const prompt = emitted.find((event) => event.event === 'resolutionStepPrompt')?.payload?.step
      || ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step.type === 'target_selection');
    expect(prompt?.type).toBe('target_selection');
    expect(prompt?.minTargets).toBe(3);
    expect(prompt?.maxTargets).toBe(3);
    expect(prompt?.targetGrouping?.groups.map((group: any) => group.playerId)).toEqual(['p1', 'p2', 'p3']);
    expect(prompt?.targetGrouping?.groups.map((group: any) => group.targets.map((target: any) => target.id))).toEqual([
      ['p1_rock'],
      ['p2_bear'],
      ['p3_walker'],
    ]);

    const continuation = [...getEvents(gameId)].reverse().find((event) => event.type === 'castSpellContinuation') as any;
    expect(continuation?.payload?.pendingSpellCast?.targetGrouping?.groups).toHaveLength(3);
    expect(continuation?.payload?.queuedResolutionStep?.targetGrouping?.groups).toHaveLength(3);
  });

  it('rejects the cast when any required player has no legal target', async () => {
    const gameId = `test_grouped_cast_missing_${Math.random().toString(36).slice(2)}`;
    gameIds.add(gameId);
    setupGame(gameId, false);
    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    registerGameActions(createNoopIo(), socket);

    await handlers.requestCastSpell({ gameId, cardId: 'guff' });

    expect(emitted.find((event) => event.event === 'resolutionStepPrompt')).toBeUndefined();
    expect(emitted.find((event) => event.event === 'error')?.payload).toMatchObject({
      code: 'NO_VALID_TARGETS',
    });
  });

  it('stores every target name and controller on the stack for priority decisions', () => {
    const gameId = `test_grouped_stack_display_${Math.random().toString(36).slice(2)}`;
    gameIds.add(gameId);
    const game = setupGame(gameId);

    castSpell(game, 'p1' as any, 'guff', ['p1_rock', 'p2_bear', 'p3_walker']);

    const stackItem = game.state.stack.at(-1);
    expect(stackItem.targets).toEqual(['p1_rock', 'p2_bear', 'p3_walker']);
    expect(stackItem.targetDetails).toEqual([
      expect.objectContaining({ id: 'p1_rock', name: 'Rock', controllerId: 'p1', controllerName: 'Caster' }),
      expect.objectContaining({ id: 'p2_bear', name: 'Bear', controllerId: 'p2', controllerName: 'Second' }),
      expect.objectContaining({ id: 'p3_walker', name: 'Walker', controllerId: 'p3', controllerName: 'Third' }),
    ]);
  });
});
