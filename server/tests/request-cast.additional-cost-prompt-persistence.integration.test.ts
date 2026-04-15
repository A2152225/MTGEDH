import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
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

function setupBaseGame(testGameId: string, playerId = 'p1', opponentId = 'p2') {
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
  (game.state as any).battlefield = [];
  return game;
}

describe('requestCastSpell additional-cost prompt persistence (integration)', () => {
  const gameId = 'test_request_cast_additional_cost_prompt_persistence';
  const playerId = 'p1';
  const opponentId = 'p2';
  const derivedGameIds = [
    `${gameId}_payment`,
    `${gameId}_blight_notarget_choice`,
    `${gameId}_blight_targeted_choice`,
    `${gameId}_blight_notarget_paymana`,
    `${gameId}_blight_targeted_target`,
    `${gameId}_blight_followup_target`,
  ];

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    for (const derivedGameId of derivedGameIds) {
      await resetGame(derivedGameId);
    }
  });

  afterEach(async () => {
    await resetGame(gameId);
    for (const derivedGameId of derivedGameIds) {
      await resetGame(derivedGameId);
    }
  });

  it('persists queued mana payment prompts for no-target spells', async () => {
    const testGameId = `${gameId}_payment`;
    const game = setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'divination_1',
            name: 'Divination',
            mana_cost: '{2}{U}',
            manaCost: '{2}{U}',
            type_line: 'Sorcery',
            oracle_text: 'Draw two cards.',
            image_uris: { small: 'https://example.com/divination.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'divination_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((step: any) => step.type === 'mana_payment_choice') as any;
    expect(paymentStep?.spellPaymentRequired).toBe(true);

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('divination_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('divination_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mana_payment_choice');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.spellPaymentRequired).toBe(true);
  });

  it('persists queued blight-or-pay prompts for no-target spells', async () => {
    const testGameId = `${gameId}_blight_notarget_choice`;
    const game = setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Runeclaw Bear', type_line: 'Creature - Bear', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'blight_draw_1',
            name: 'Blighted Insight',
            mana_cost: '{1}{B}',
            manaCost: '{1}{B}',
            type_line: 'Sorcery',
            oracle_text: 'As an additional cost to cast this spell, blight 1 or pay {3}. Draw a card.',
            image_uris: { small: 'https://example.com/blighted-insight.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'blight_draw_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const choiceStep = queue.steps.find((step: any) => step.type === 'option_choice') as any;
    expect(choiceStep?.spellAdditionalCostBlightOrPay).toBe(true);

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('blight_draw_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('blight_draw_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.pendingPaymentAfterAdditionalCost).toBe(true);
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('option_choice');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.spellAdditionalCostBlightOrPay).toBe(true);
  });

  it('persists ordered blight choice and spell target prompts for targeted spells', async () => {
    const testGameId = `${gameId}_blight_targeted_choice`;
    const game = setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Runeclaw Bear', type_line: 'Creature - Bear', oracle_text: '' },
      },
      {
        id: 'sol_ring_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'blight_blast_1',
            name: 'Blight Blast',
            mana_cost: '{1}{B}',
            manaCost: '{1}{B}',
            type_line: 'Sorcery',
            oracle_text: 'As an additional cost to cast this spell, blight 1 or pay {3}. Destroy target artifact.',
            image_uris: { small: 'https://example.com/blight-blast.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'blight_blast_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    expect(queue.steps).toHaveLength(2);
    expect((queue.steps[0] as any)?.spellAdditionalCostBlightOrPay).toBe(true);
    expect((queue.steps[1] as any)?.type).toBe('target_selection');
    expect(String((queue.steps[1] as any)?.targetDescription || '').toLowerCase()).toContain('target artifact');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation' && Array.isArray((event as any)?.payload?.queuedResolutionSteps)) as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('blight_blast_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('blight_blast_1');
    expect(queuedCastEvent?.payload?.queuedResolutionSteps).toHaveLength(2);
    expect(queuedCastEvent?.payload?.queuedResolutionSteps?.[0]?.spellAdditionalCostBlightOrPay).toBe(true);
    expect(String(queuedCastEvent?.payload?.queuedResolutionSteps?.[1]?.targetDescription || '').toLowerCase()).toContain('target artifact');
  });

  it('persists the follow-up payment prompt after choosing pay-mana for a no-target blight spell', async () => {
    const testGameId = `${gameId}_blight_notarget_paymana`;
    const game = setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Runeclaw Bear', type_line: 'Creature - Bear', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'blight_draw_2',
            name: 'Blighted Insight',
            mana_cost: '{1}{B}',
            manaCost: '{1}{B}',
            type_line: 'Sorcery',
            oracle_text: 'As an additional cost to cast this spell, blight 1 or pay {3}. Draw a card.',
            image_uris: { small: 'https://example.com/blighted-insight.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'blight_draw_2' });

    const choiceStep = ResolutionQueueManager.getQueue(testGameId).steps.find((step: any) => step.type === 'option_choice') as any;
    expect(choiceStep?.spellAdditionalCostBlightOrPay).toBe(true);

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(choiceStep.id),
      selections: 'pay_mana_cost',
    });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((step: any) => step.type === 'mana_payment_choice' && (step as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) =>
      event.type === 'castSpellContinuation'
      && Boolean((event as any)?.payload?.queuedResolutionStep?.spellPaymentRequired)
      && String((event as any)?.payload?.effectId || '') === String((paymentStep as any)?.effectId || '')
    ) as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('blight_draw_2');
    expect(queuedCastEvent?.payload?.effectId).toBe(String((paymentStep as any)?.effectId || ''));
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.spellPaymentRequired).toBe(true);
  });

  it('persists ordered blight target-selection and spell target prompts for targeted spells', async () => {
    const testGameId = `${gameId}_blight_targeted_target`;
    const game = setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Runeclaw Bear', type_line: 'Creature - Bear', oracle_text: '' },
      },
      {
        id: 'sol_ring_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'blight_blast_2',
            name: 'Blight Blast',
            mana_cost: '{1}{B}',
            manaCost: '{1}{B}',
            type_line: 'Sorcery',
            oracle_text: 'As an additional cost to cast this spell, blight 1. Destroy target artifact.',
            image_uris: { small: 'https://example.com/blight-blast.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'blight_blast_2' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    expect(queue.steps).toHaveLength(2);
    expect((queue.steps[0] as any)?.keywordBlight).toBe(true);
    expect(String((queue.steps[0] as any)?.keywordBlightStage || '')).toBe('cast_additional_cost');
    expect(String((queue.steps[1] as any)?.targetDescription || '').toLowerCase()).toContain('target artifact');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation' && Array.isArray((event as any)?.payload?.queuedResolutionSteps)) as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('blight_blast_2');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('blight_blast_2');
    expect(queuedCastEvent?.payload?.queuedResolutionSteps).toHaveLength(2);
    expect(queuedCastEvent?.payload?.queuedResolutionSteps?.[0]?.keywordBlight).toBe(true);
    expect(String(queuedCastEvent?.payload?.queuedResolutionSteps?.[1]?.targetDescription || '').toLowerCase()).toContain('target artifact');
  });

  it('persists the follow-up blight target step after choosing blight for a targeted spell', async () => {
    const testGameId = `${gameId}_blight_followup_target`;
    const game = setupBaseGame(testGameId, playerId, opponentId);
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { name: 'Runeclaw Bear', type_line: 'Creature - Bear', oracle_text: '' },
      },
      {
        id: 'sol_ring_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'blight_blast_3',
            name: 'Blight Blast',
            mana_cost: '{1}{B}',
            manaCost: '{1}{B}',
            type_line: 'Sorcery',
            oracle_text: 'As an additional cost to cast this spell, blight 1 or pay {3}. Destroy target artifact.',
            image_uris: { small: 'https://example.com/blight-blast.jpg' },
          },
        ],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'blight_blast_3' });

    const choiceStep = ResolutionQueueManager.getQueue(testGameId).steps.find((step: any) => step.type === 'option_choice') as any;
    expect(choiceStep?.spellAdditionalCostBlightOrPay).toBe(true);

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(choiceStep.id),
      selections: 'blight_cost',
    });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const blightStep = queue.steps.find((step: any) => (step as any).keywordBlight === true && String((step as any).keywordBlightStage || '') === 'cast_additional_cost') as any;
    expect(blightStep).toBeDefined();

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation' && Boolean((event as any)?.payload?.queuedResolutionStep?.keywordBlight)) as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('blight_blast_3');
    expect(queuedCastEvent?.payload?.effectId).toBe(String((blightStep as any)?.keywordBlightEffectId || ''));
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.keywordBlight).toBe(true);
    expect(String(queuedCastEvent?.payload?.queuedResolutionStep?.keywordBlightStage || '')).toBe('cast_additional_cost');
  });
});