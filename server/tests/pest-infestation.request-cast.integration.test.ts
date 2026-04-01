import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[]) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emitted.push({ room, event, payload });
      },
    }),
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    sockets: { sockets: new Map(sockets.map((socket) => [socket.id || socket.data.playerId, socket])) },
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId: string,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `${playerId}_socket`,
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

describe('Pest Infestation request-cast flow', () => {
  const gameId = 'test_pest_infestation_request_cast';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('chooses X before targets and pays the expanded XX mana cost', async () => {
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
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `forest_${index + 1}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      })),
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
      {
        id: 'rhystic_study_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: {
          name: 'Rhystic Study',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
          image_uris: { small: 'https://example.com/rhystic-study.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'pest_infestation_1',
            name: 'Pest Infestation',
            mana_cost: '{X}{X}{G}',
            manaCost: '{X}{X}{G}',
            type_line: 'Sorcery',
            oracle_text: 'Destroy up to X target artifacts and/or enchantments. Create twice X 1/1 black and green Pest creature tokens with "When this creature dies, you gain 1 life."',
            image_uris: { small: 'https://example.com/pest-infestation.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'pest_infestation_1' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    const xStep = queue.steps.find((entry: any) => entry.type === 'x_value_selection') as any;
    expect(xStep).toBeDefined();
    expect(xStep.spellCastXSelection).toBe(true);
    expect(xStep.xCount).toBe(2);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(xStep.id),
      selections: { xValue: 2 },
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === 'target_selection' && (entry as any).spellCastContext?.cardId === 'pest_infestation_1') as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.minTargets).toBe(0);
    expect(targetStep.maxTargets).toBe(2);
    expect(targetStep.spellCastContext?.manaCost).toBe('{4}{G}');
    expect((targetStep.validTargets || []).map((target: any) => target.id).sort()).toEqual(['rhystic_study_1', 'sol_ring_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['sol_ring_1', 'rhystic_study_1'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.manaCost).toBe('{4}{G}');
    expect(paymentStep.xValue).toBe(2);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: 'forest_1', mana: 'G', count: 1 },
          { permanentId: 'forest_2', mana: 'G', count: 1 },
          { permanentId: 'forest_3', mana: 'G', count: 1 },
          { permanentId: 'forest_4', mana: 'G', count: 1 },
          { permanentId: 'forest_5', mana: 'G', count: 1 },
        ],
      },
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('pest_infestation_1');

    emitted.length = 0;
    await handlers['completeCastSpell'](continueEvent?.payload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const castError = emitted.find((event) => event.event === 'error');
    expect(castError).toBeUndefined();

    const stackNames = ((game.state as any).stack || []).map((entry: any) => entry.card?.name || entry.sourceName || entry.id);
    expect(stackNames).toContain('Pest Infestation');

    const handIds = (((game.state as any).zones?.[playerId]?.hand) || []).map((card: any) => card.id);
    expect(handIds).not.toContain('pest_infestation_1');
  });
});