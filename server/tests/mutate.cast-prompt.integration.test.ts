import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions, requestCastSpellForSocket } from '../src/socket/game-actions.js';
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Mutate cast prompt persistence (integration)', () => {
  const gameId = 'test_mutate_cast_prompt_persistence';
  const p1 = 'p1';
  const trackedGameIds = new Set<string>();

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    for (const trackedGameId of trackedGameIds) {
      await resetGame(trackedGameId);
    }
    trackedGameIds.clear();
  });

  function seedMutateGame(testGameId: string) {
    trackedGameIds.add(testGameId);
    createGameIfNotExists(testGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(testGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).phase = 'main1';
    (game.state as any).priority = p1;
    (game.state as any).battlefield = [
      {
        id: 'host_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'host_card_1',
          name: 'Mutation Host',
          type_line: 'Creature - Beast',
          oracle_text: 'Vigilance',
          power: '2',
          toughness: '2',
          image_uris: { small: 'https://example.com/host.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'mutate_1',
            name: 'Gemrazer',
            mana_cost: '{3}{G}',
            type_line: 'Creature - Beast',
            oracle_text: 'Mutate {1}{G}{G}\nReach, trample\nWhenever this creature mutates, destroy target artifact or enchantment an opponent controls.',
            image_uris: { small: 'https://example.com/gemrazer.jpg' },
            zone: 'hand',
            power: '4',
            toughness: '4',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    return game;
  }

  it('persists the mutate cast-mode prompt before a mode is chosen', async () => {
    const testGameId = `${gameId}_mode_${Math.random().toString(36).slice(2, 10)}`;
    seedMutateGame(testGameId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, testGameId, emitted);
    const io = createNoopIo();

    registerGameActions(io as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'mutate_1' });

    const prompt = emitted.find((event) => event.event === 'resolutionStepPrompt');
    expect(prompt?.payload?.step?.type).toBe('option_choice');

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const modeStep = queue.steps.find((step: any) => step?.type === 'option_choice') as any;
    expect(modeStep?.mutateCastModeChoice).toBe(true);
    expect(modeStep?.mutateCardId).toBe('mutate_1');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('mutate_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast).toBeUndefined();
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('option_choice');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.mutateCastModeChoice).toBe(true);
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.mutateCardId).toBe('mutate_1');
    expect(String(queuedCastEvent?.payload?.queuedResolutionStep?.mutateCost || '').toLowerCase()).toBe('{1}{g}{g}');
  });

  it('persists the forced mutate target prompt with pending cast state', async () => {
    const testGameId = `${gameId}_target_${Math.random().toString(36).slice(2, 10)}`;
    seedMutateGame(testGameId);
    const game = ensureGame(testGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket } = createMockSocket(p1, testGameId, emitted);

    await requestCastSpellForSocket(createNoopIo() as any, socket as any, {
      gameId: testGameId,
      cardId: 'mutate_1',
    }, {
      forcedAlternateCostId: 'mutate',
      skipMutateModePrompt: true,
    });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const mutateStep = queue.steps.find((step: any) => step?.type === 'mutate_target_selection') as any;
    expect(mutateStep).toBeDefined();
    expect(mutateStep?.effectId).toBeTruthy();
    expect(mutateStep?.validTargets?.[0]?.id).toBe('host_1');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('mutate_1');
    expect(queuedCastEvent?.payload?.effectId).toBe(String(mutateStep?.effectId || ''));
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('mutate_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.forcedAlternateCostId).toBe('mutate');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.validTargetIds).toEqual(['host_1']);
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mutate_target_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.effectId).toBe(String(mutateStep?.effectId || ''));
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.validTargets?.[0]?.id).toBe('host_1');
  });
});