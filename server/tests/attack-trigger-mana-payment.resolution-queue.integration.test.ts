import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Attack trigger mana payment via Resolution Queue (integration)', () => {
  const gameId = 'test_attack_trigger_mana_payment_resolution_queue';

  beforeAll(async () => {
    await initDb();

    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('enqueues an OPTION_CHOICE step and executes transform on pay', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    // Declare attackers validation requirements.
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';

    // Enough mana to pay {1}{G}.
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };

    // Minimal Casal-like DFC that matches the generic "you may pay {..}. If you do, transform" regex.
    (game.state as any).battlefield = [
      {
        id: 'casal_1',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Casal, Lurkwood Pathfinder',
          type_line: 'Legendary Creature — Human',
          oracle_text: 'Whenever Casal, Lurkwood Pathfinder attacks, you may pay {1}{G}. If you do, transform her.',
          image_uris: { small: 'https://example.com/casal-front.jpg' },
          card_faces: [
            {
              name: 'Casal, Lurkwood Pathfinder',
              type_line: 'Legendary Creature — Human',
              oracle_text: 'Whenever Casal, Lurkwood Pathfinder attacks, you may pay {1}{G}. If you do, transform her.',
              power: '2',
              toughness: '2',
              mana_cost: '{2}{G}',
              colors: ['G'],
            },
            {
              name: 'Casal, Pathbreaker Owlbear',
              type_line: 'Legendary Creature — Bear',
              oracle_text: 'Trample',
              power: '4',
              toughness: '4',
              mana_cost: '',
              colors: ['G'],
            },
          ],
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    expect(typeof handlers['declareAttackers']).toBe('function');

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'casal_1', targetPlayerId: p2 }],
    });

    // Should be Resolution Queue based.
    expect(emitted.some(e => e.event === 'attackTriggerManaPaymentPrompt')).toBe(false);
    expect(emitted.some(e => e.event === 'resolutionStepPrompt')).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice');
    expect(step).toBeDefined();
    expect((step as any).attackTriggerManaPaymentChoice).toBe(true);

    // Pay the mana and transform.
    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: (step as any).id, selections: 'pay_mana' });

    const perm = (game.state as any).battlefield.find((p: any) => p.id === 'casal_1');
    expect(perm).toBeDefined();
    expect(Boolean((perm as any).transformed)).toBe(true);
    expect(String((perm as any).card?.name || '').toLowerCase()).toContain('pathbreaker');

    // Mana should be consumed.
    expect((game.state as any).manaPool[p1].green + (game.state as any).manaPool[p1].colorless).toBe(0);
  });

  it('does not consume the step on insufficient mana for pay selection', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';

    // Not enough mana to pay {1}{G}.
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'casal_1',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Casal, Lurkwood Pathfinder',
          type_line: 'Legendary Creature — Human',
          oracle_text: 'Whenever Casal, Lurkwood Pathfinder attacks, you may pay {1}{G}. If you do, transform her.',
          image_uris: { small: 'https://example.com/casal-front.jpg' },
          card_faces: [
            {
              name: 'Casal, Lurkwood Pathfinder',
              type_line: 'Legendary Creature — Human',
              oracle_text: 'Whenever Casal, Lurkwood Pathfinder attacks, you may pay {1}{G}. If you do, transform her.',
              power: '2',
              toughness: '2',
              mana_cost: '{2}{G}',
              colors: ['G'],
            },
            {
              name: 'Casal, Pathbreaker Owlbear',
              type_line: 'Legendary Creature — Bear',
              oracle_text: 'Trample',
              power: '4',
              toughness: '4',
              mana_cost: '',
              colors: ['G'],
            },
          ],
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'casal_1', targetPlayerId: p2 }],
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice');
    expect(step).toBeDefined();
    expect((step as any).attackTriggerManaPaymentChoice).toBe(true);

    const stepId = String((step as any).id);

    // Attempt to pay without mana.
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay_mana' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INSUFFICIENT_MANA');

    // Step should still be pending (not consumed).
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    const stillThere = queueAfter.steps.find((s: any) => String(s.id) === stepId);
    expect(stillThere).toBeDefined();

    // Permanent should not have transformed.
    const perm = (game.state as any).battlefield.find((p: any) => p.id === 'casal_1');
    expect(Boolean((perm as any).transformed)).toBe(false);
  });

  it('queues graveyard selection for Narset-style attack triggers, exiles the chosen card, and offers a free cast of the copy', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).phase = 'combat';
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).turnNumber = 3;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: {
        hand: [],
        graveyard: [
          { id: 'gy_opt', name: 'Opt', type_line: 'Instant', mana_cost: '{U}', cmc: 1, oracle_text: 'Scry 1. Draw a card.' },
          { id: 'gy_divination', name: 'Divination', type_line: 'Sorcery', mana_cost: '{2}{U}', cmc: 3, oracle_text: 'Draw two cards.' },
          { id: 'gy_bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, oracle_text: '', power: '2', toughness: '2' },
          { id: 'gy_forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
          { id: 'gy_cryptic', name: 'Cryptic Command', type_line: 'Instant', mana_cost: '{1}{U}{U}{U}', cmc: 4, oracle_text: 'Choose two — Counter target spell; or return target permanent to its owner\'s hand; or tap all creatures your opponents control; or draw a card.' },
        ],
        exile: [],
        handCount: 0,
        graveyardCount: 5,
        exileCount: 0,
      },
    };

    (game.state as any).battlefield = [
      {
        id: 'narset_1',
        controller: p1,
        owner: p1,
        basePower: 4,
        baseToughness: 4,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'narset_card',
          name: 'Narset, Enlightened Exile',
          type_line: 'Legendary Creature — Human Monk',
          oracle_text: 'Creatures you control have prowess. Whenever Narset, Enlightened Exile attacks, exile target noncreature, nonland card with mana value less than Narset\'s power from a graveyard and copy it. You may cast the copy without paying its mana cost.',
          power: '4',
          toughness: '4',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'narset_1', targetPlayerId: p2 }],
    });

    const triggerStack = ((game.state as any).stack || []) as any[];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'narset_1',
      sourceName: 'Narset, Enlightened Exile',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetGraveyardScope: 'any',
      targetFilterExcludeTypes: ['creature', 'land'],
      targetFilterMaxManaValue: 3,
    });

    game.resolveTopOfStack();

    const selectionStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step.type === 'graveyard_selection') as any;
    expect(selectionStep).toBeDefined();
    expect((selectionStep.validTargets || []).map((entry: any) => entry.id).sort()).toEqual(['gy_divination', 'gy_opt']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(selectionStep.id),
      selections: ['gy_opt'],
      cancelled: false,
    });

    const opponentGraveyardIds = ((((game.state as any).zones?.[p2]?.graveyard) || []) as any[]).map((card: any) => String(card?.id || ''));
    const opponentExile = ((((game.state as any).zones?.[p2]?.exile) || []) as any[]);
    const playerExile = ((((game.state as any).zones?.[p1]?.exile) || []) as any[]);
    expect(opponentGraveyardIds).not.toContain('gy_opt');
    expect(opponentExile.some((card: any) => String(card?.id || '') === 'gy_opt')).toBe(true);

    const exileCopy = playerExile.find((card: any) => card?.isCopy === true && String(card?.copiedFromCardId || '') === 'gy_opt');
    expect(exileCopy).toBeDefined();
    expect(String(exileCopy?.canBePlayedBy || '')).toBe(p1);
    expect(exileCopy?.withoutPayingManaCost).toBe(true);

    const castChoiceStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step.type === 'option_choice' && String((step as any).castFromExileCardId || '') === String(exileCopy?.id || '')) as any;
    expect(castChoiceStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(castChoiceStep.id),
      selections: 'cast',
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    if (paymentStep) {
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(paymentStep.id),
        selections: { payment: [] },
        cancelled: false,
      });
    }

    const stackAfterCast = (((game.state as any).stack || []) as any[]).find((entry: any) => String(entry?.card?.name || '') === 'Opt');
    expect(stackAfterCast).toBeDefined();
    expect(stackAfterCast?.castWithoutPayingManaCost).toBe(true);
    expect(String(stackAfterCast?.card?.id || '')).toBe(String(exileCopy?.id || ''));
  });

  it('allows Narset-style copied sorceries to be cast during combat without normal timing restrictions', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).phase = 'combat';
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).turnNumber = 3;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: {
        hand: [],
        graveyard: [
          { id: 'gy_opt', name: 'Opt', type_line: 'Instant', mana_cost: '{U}', cmc: 1, oracle_text: 'Scry 1. Draw a card.' },
          { id: 'gy_divination', name: 'Divination', type_line: 'Sorcery', mana_cost: '{2}{U}', cmc: 3, oracle_text: 'Draw two cards.' },
          { id: 'gy_bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, oracle_text: '', power: '2', toughness: '2' },
          { id: 'gy_forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
          { id: 'gy_cryptic', name: 'Cryptic Command', type_line: 'Instant', mana_cost: '{1}{U}{U}{U}', cmc: 4, oracle_text: 'Choose two — Counter target spell; or return target permanent to its owner\'s hand; or tap all creatures your opponents control; or draw a card.' },
        ],
        exile: [],
        handCount: 0,
        graveyardCount: 5,
        exileCount: 0,
      },
    };

    (game.state as any).battlefield = [
      {
        id: 'narset_1',
        controller: p1,
        owner: p1,
        basePower: 4,
        baseToughness: 4,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'narset_card',
          name: 'Narset, Enlightened Exile',
          type_line: 'Legendary Creature — Human Monk',
          oracle_text: 'Creatures you control have prowess. Whenever Narset, Enlightened Exile attacks, exile target noncreature, nonland card with mana value less than Narset\'s power from a graveyard and copy it. You may cast the copy without paying its mana cost.',
          power: '4',
          toughness: '4',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'narset_1', targetPlayerId: p2 }],
    });

    game.resolveTopOfStack();

    const selectionStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step.type === 'graveyard_selection') as any;
    expect(selectionStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(selectionStep.id),
      selections: ['gy_divination'],
      cancelled: false,
    });

    const playerExile = ((((game.state as any).zones?.[p1]?.exile) || []) as any[]);
    const exileCopy = playerExile.find((card: any) => card?.isCopy === true && String(card?.copiedFromCardId || '') === 'gy_divination');
    expect(exileCopy).toBeDefined();

    const castChoiceStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step.type === 'option_choice' && String((step as any).castFromExileCardId || '') === String(exileCopy?.id || '')) as any;
    expect(castChoiceStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(castChoiceStep.id),
      selections: 'cast',
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(String(paymentStep?.manaCost || '{0}')).toContain('0');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    const sorceryTimingError = emitted.find((event) => event.event === 'error' && event.payload?.code === 'SORCERY_TIMING');
    expect(sorceryTimingError).toBeUndefined();

    const stackAfterCast = (((game.state as any).stack || []) as any[]).find((entry: any) => String(entry?.card?.name || '') === 'Divination');
    expect(stackAfterCast).toBeDefined();
    expect(stackAfterCast?.castWithoutPayingManaCost).toBe(true);
    expect(String(stackAfterCast?.card?.id || '')).toBe(String(exileCopy?.id || ''));
  });
});
