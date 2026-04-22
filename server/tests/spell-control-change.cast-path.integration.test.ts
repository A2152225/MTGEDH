import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { setPermanentPrepared } from '../src/state/modules/prepared.js';
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

async function setupBaseGame(testGameId: string, playerId = 'p1', opponentId = 'p2') {
  await resetGame(testGameId);
  createGameIfNotExists(testGameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(testGameId);
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
  return game;
}

function buildPreparedCard() {
  return {
    id: 'prepared_control_change_card',
    name: 'Prepared Host // Sudden Recall',
    layout: 'prepare',
    mana_cost: '{2}{U} // {1}{U}',
    type_line: 'Creature — Human Advisor // Instant',
    colors: ['U'],
    color_identity: ['U'],
    card_faces: [
      {
        name: 'Prepared Host',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
        power: '2',
        toughness: '3',
      },
      {
        name: 'Sudden Recall',
        mana_cost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Return target creature to its owner\'s hand.',
      },
    ],
  };
}

describe('spell control change cast path (integration)', () => {
  const gameId = 'test_spell_control_change_cast_path';
  const playerId = 'p1';
  const opponentId = 'p2';
  const derivedGameIds = [
    `${gameId}_donate`,
    `${gameId}_exchange_explicit`,
  ];

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    for (const derivedGameId of derivedGameIds) {
      await resetGame(derivedGameId);
    }
  });

  it('casts and resolves Harmless Offering through mixed target selection', async () => {
    const testGameId = `${gameId}_donate`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const preparedCard = buildPreparedCard();
    const preparedPermanent = {
      id: 'prepared_offering_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      summoningSickness: false,
      counters: {},
      card: {
        ...preparedCard,
        name: 'Prepared Host',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: preparedCard.card_faces[0].oracle_text,
        power: '2',
        toughness: '3',
        zone: 'battlefield',
      },
    } as any;

    (game.state as any).battlefield = [preparedPermanent];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'harmless_offering_1',
            name: 'Harmless Offering',
            mana_cost: '{2}{R}',
            manaCost: '{2}{R}',
            type_line: 'Sorcery',
            oracle_text: 'Target opponent gains control of target permanent you control.',
            image_uris: { small: 'https://example.com/harmless-offering.jpg' },
            colors: ['R'],
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
    setPermanentPrepared((game.state as any), preparedPermanent);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'harmless_offering_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    let targetSteps = queue.steps.filter((entry: any) => entry.type === 'target_selection') as any[];
    expect(targetSteps).toHaveLength(2);

    const opponentStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target opponent')) as any;
    const permanentStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target permanent you control')) as any;
    expect(opponentStep).toBeDefined();
    expect(permanentStep).toBeDefined();

    await handlers.submitResolutionResponse({ gameId: testGameId, stepId: String(opponentStep.id), selections: [opponentId] });
    await handlers.submitResolutionResponse({ gameId: testGameId, stepId: String(permanentStep.id), selections: ['prepared_offering_perm'] });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    await handlers.completeCastSpell({
      gameId: testGameId,
      cardId: 'harmless_offering_1',
      effectId: String(paymentStep.effectId),
    });

    expect((game.state as any).stack).toHaveLength(1);
    game.resolveTopOfStack();

    const donatedPermanent = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'prepared_offering_perm');
    expect(donatedPermanent?.controller).toBe(opponentId);
    expect(donatedPermanent?.summoningSickness).toBe(true);
    expect((game.state as any).zones[playerId].exile).toHaveLength(0);
    expect((game.state as any).zones[opponentId].exile).toHaveLength(1);
    expect((game.state as any).zones[opponentId].exile[0]).toMatchObject({
      canBePlayedBy: opponentId,
      preparedSourcePermanentId: 'prepared_offering_perm',
    });
  });

  it('casts and resolves explicit exchange control text through scoped target selection', async () => {
    const testGameId = `${gameId}_exchange_explicit`;
    const game = await setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const preparedCard = buildPreparedCard();
    const preparedPermanent = {
      id: 'prepared_exchange_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      summoningSickness: false,
      counters: {},
      card: {
        ...preparedCard,
        name: 'Prepared Host',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: preparedCard.card_faces[0].oracle_text,
        power: '2',
        toughness: '3',
        zone: 'battlefield',
      },
    } as any;

    (game.state as any).battlefield = [
      preparedPermanent,
      {
        id: 'exchange_target_2',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'exchange_target_card_2',
          name: 'Exchange Target',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'swap_contrivance_1',
            name: 'Swap Contrivance',
            mana_cost: '{2}{U}',
            manaCost: '{2}{U}',
            type_line: 'Sorcery',
            oracle_text: 'Exchange control of target creature you control and target creature an opponent controls.',
            image_uris: { small: 'https://example.com/swap-contrivance.jpg' },
            colors: ['U'],
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
    setPermanentPrepared((game.state as any), preparedPermanent);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'swap_contrivance_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    let targetSteps = queue.steps.filter((entry: any) => entry.type === 'target_selection') as any[];
    expect(targetSteps).toHaveLength(2);

    const firstStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target creature you control')) as any;
    const secondStep = targetSteps.find((step: any) => String(step.targetDescription || '').toLowerCase().includes('target creature an opponent controls')) as any;
    expect(firstStep).toBeDefined();
    expect(secondStep).toBeDefined();

    await handlers.submitResolutionResponse({ gameId: testGameId, stepId: String(firstStep.id), selections: ['prepared_exchange_perm'] });
    await handlers.submitResolutionResponse({ gameId: testGameId, stepId: String(secondStep.id), selections: ['exchange_target_2'] });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    await handlers.completeCastSpell({
      gameId: testGameId,
      cardId: 'swap_contrivance_1',
      effectId: String(paymentStep.effectId),
    });

    expect((game.state as any).stack).toHaveLength(1);
    game.resolveTopOfStack();

    const firstTarget = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'prepared_exchange_perm');
    const secondTarget = ((game.state as any).battlefield || []).find((perm: any) => perm && perm.id === 'exchange_target_2');
    expect(firstTarget?.controller).toBe(opponentId);
    expect(secondTarget?.controller).toBe(playerId);
    expect(firstTarget?.summoningSickness).toBe(true);
    expect(secondTarget?.summoningSickness).toBe(true);
    expect((game.state as any).zones[playerId].exile).toHaveLength(0);
    expect((game.state as any).zones[opponentId].exile).toHaveLength(1);
    expect((game.state as any).zones[opponentId].exile[0]).toMatchObject({
      canBePlayedBy: opponentId,
      preparedSourcePermanentId: 'prepared_exchange_perm',
    });
  });
});