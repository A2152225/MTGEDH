import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
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

async function setupGame(testGameId: string, playerId: string, opponentId: string) {
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
  (game.state as any).battlefield = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 9, red: 0, green: 0, colorless: 9 },
    [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  return game;
}

describe('cast-reanimate-spell integration (cast-side graveyard reanimation)', () => {
  const baseId = 'test_cast_reanimate_spell';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({
      to: () => ({ emit: () => {} }),
      emit: () => {},
      sockets: { sockets: new Map() },
    } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(baseId);
  });

  afterEach(async () => {
    for (const suffix of ['_reanimate', '_catacombs', '_beacon', '_restore', '_demon', '_corpse', '_noxious', '_cremate', '_necsummons', '_pulse', '_naya', '_kenrith', '_oppgy', '_fated', '_rise', '_vile']) {
      await resetGame(`${baseId}${suffix}`);
    }
    await resetGame(baseId);
  });

  it('Reanimate: casts a sorcery, lets the controller pick a creature in any graveyard, and puts it onto the battlefield under the controller', async () => {
    const testGameId = `${baseId}_reanimate`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'reanimate_1',
            name: 'Reanimate',
            mana_cost: '{B}',
            manaCost: '{B}',
            type_line: 'Sorcery',
            oracle_text: 'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.',
            colors: ['B'],
            image_uris: { small: 'https://example.com/reanimate.jpg' },
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
        graveyard: [
          {
            id: 'gy_creature_opp',
            name: 'Sengir Vampire',
            type_line: 'Creature - Vampire',
            mana_cost: '{3}{B}{B}',
            cmc: 5,
            power: '4',
            toughness: '4',
            oracle_text: 'Flying',
            image_uris: { small: 'https://example.com/sengir.jpg' },
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'reanimate_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.spellCastContext?.cardId).toBe('reanimate_1');
    const validTargetIds = (targetStep.validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toContain('gy_creature_opp');

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_creature_opp'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardId).toBe('reanimate_1');

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:black', mana: 'B', count: 1 }],
      },
    });

    expect(Array.isArray((game.state as any).stack)).toBe(true);
    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const battlefield = (game.state as any).battlefield || [];
    const reanimated = battlefield.find((perm: any) => perm?.card?.name === 'Sengir Vampire');
    expect(reanimated).toBeDefined();
    expect(reanimated.controller).toBe(playerId);
    expect(reanimated.owner).toBe(opponentId);

    const opponentGraveyard = (game.state as any).zones?.[opponentId]?.graveyard || [];
    expect(opponentGraveyard.find((card: any) => card?.id === 'gy_creature_opp')).toBeUndefined();

    // "You lose life equal to its mana value." — Sengir Vampire mana value is 5
    const p1Life =
      (game.state as any).life?.[playerId] ??
      (game.state as any).players?.find((p: any) => p?.id === playerId)?.life;
    expect(p1Life).toBe(35);
  });

  it('Beacon of Unrest: cast-side reanimation supports "artifact or creature card" multi-filter', async () => {
    const testGameId = `${baseId}_beacon`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 9, red: 0, green: 0, colorless: 9 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'beacon_1',
            name: 'Beacon of Unrest',
            mana_cost: '{3}{B}{B}',
            manaCost: '{3}{B}{B}',
            type_line: 'Sorcery',
            oracle_text:
              "Put target artifact or creature card from a graveyard onto the battlefield under your control. Shuffle Beacon of Unrest into its owner's library.",
            colors: ['B'],
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
        graveyard: [
          {
            id: 'gy_artifact_opp',
            name: 'Sol Ring',
            type_line: 'Artifact',
            mana_cost: '{1}',
            cmc: 1,
            oracle_text: '{T}: Add {C}{C}.',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'beacon_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    const validTargetIds = (targetStep.validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toContain('gy_artifact_opp');

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_artifact_opp'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:black', mana: 'B', count: 2 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 3 },
        ],
      },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const reanimated = ((game.state as any).battlefield || []).find(
      (perm: any) => perm?.card?.name === 'Sol Ring',
    );
    expect(reanimated).toBeDefined();
    expect(reanimated.controller).toBe(playerId);
    expect(reanimated.owner).toBe(opponentId);
  });

  it('Restore: cast-side reanimation supports land cards and "under its owner\'s control" clause', async () => {
    const testGameId = `${baseId}_restore`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'restore_1',
            name: 'Restore',
            mana_cost: '{1}{G}',
            manaCost: '{1}{G}',
            type_line: 'Sorcery',
            oracle_text: "Put target land card from a graveyard onto the battlefield under its owner's control.",
            colors: ['G'],
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
        graveyard: [
          {
            id: 'gy_land_opp',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '({T}: Add {G}.)',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'restore_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    const validTargetIds = (targetStep.validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toContain('gy_land_opp');

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_land_opp'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:green', mana: 'G', count: 1 },
          { permanentId: '__pool__:white', mana: 'W', count: 1 },
        ],
      },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const reanimated = ((game.state as any).battlefield || []).find(
      (perm: any) => perm?.card?.name === 'Forest',
    );
    expect(reanimated).toBeDefined();
    // "under its owner's control"
    expect(reanimated.controller).toBe(opponentId);
    expect(reanimated.owner).toBe(opponentId);
  });

  it('Tapped reanimation: spells like "Return target creature ... onto the battlefield tapped" set entersTapped', async () => {
    const testGameId = `${baseId}_demon`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 9, red: 0, green: 0, colorless: 9 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'tapped_anim_1',
            name: 'Tapped Anim Test',
            mana_cost: '{B}',
            manaCost: '{B}',
            type_line: 'Sorcery',
            oracle_text: 'Return target creature card from a graveyard to the battlefield tapped under your control.',
            colors: ['B'],
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
        graveyard: [
          {
            id: 'gy_creature_tapped',
            name: 'Walking Corpse',
            type_line: 'Creature - Zombie',
            mana_cost: '{1}{B}',
            cmc: 2,
            power: '2',
            toughness: '2',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'tapped_anim_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_creature_tapped'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: { payment: [{ permanentId: '__pool__:black', mana: 'B', count: 1 }] },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const reanimated = ((game.state as any).battlefield || []).find(
      (perm: any) => perm?.card?.name === 'Walking Corpse',
    );
    expect(reanimated).toBeDefined();
    expect(reanimated.tapped).toBe(true);
    expect(reanimated.controller).toBe(playerId);
  });

  it('Counter-bearing reanimation: "with a corpse counter on it" places counter on the reanimated creature', async () => {
    const testGameId = `${baseId}_corpse`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 9, red: 0, green: 0, colorless: 9 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'corpse_anim_1',
            name: 'Corpse Counter Test',
            mana_cost: '{B}',
            manaCost: '{B}',
            type_line: 'Sorcery',
            oracle_text:
              'Put target creature card from a graveyard onto the battlefield under your control with a corpse counter on it.',
            colors: ['B'],
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
        graveyard: [
          {
            id: 'gy_creature_corpse',
            name: 'Walking Corpse',
            type_line: 'Creature - Zombie',
            mana_cost: '{1}{B}',
            cmc: 2,
            power: '2',
            toughness: '2',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'corpse_anim_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_creature_corpse'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: { payment: [{ permanentId: '__pool__:black', mana: 'B', count: 1 }] },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const reanimated = ((game.state as any).battlefield || []).find(
      (perm: any) => perm?.card?.name === 'Walking Corpse',
    );
    expect(reanimated).toBeDefined();
    expect(reanimated.counters?.corpse).toBe(1);
  });

  it('Noxious Revival: cast-side put-on-top-of-library uses the trigger-side graveyard-to-library matcher', async () => {
    const testGameId = `${baseId}_noxious`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'noxious_1',
            name: 'Noxious Revival',
            mana_cost: '{G/P}',
            manaCost: '{G}',
            type_line: 'Instant',
            oracle_text: "Put target card from a graveyard on top of its owner's library.",
            colors: ['G'],
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
        graveyard: [
          {
            id: 'gy_target_card',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            cmc: 1,
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'noxious_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_target_card'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: { payment: [{ permanentId: '__pool__:green', mana: 'G', count: 1 }] },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const opponentLibrary = (game.state as any).zones?.[opponentId]?.library || [];
    expect(opponentLibrary[0]?.id).toBe('gy_target_card');

    const opponentGraveyard = (game.state as any).zones?.[opponentId]?.graveyard || [];
    expect(opponentGraveyard.find((card: any) => card?.id === 'gy_target_card')).toBeUndefined();
  });

  it('Cremate: cast-side exile-from-graveyard reuses the trigger-side exile matcher', async () => {
    const testGameId = `${baseId}_cremate`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'cremate_1',
            name: 'Cremate',
            mana_cost: '{B}',
            manaCost: '{B}',
            type_line: 'Instant',
            oracle_text: 'Exile target card from a graveyard. Draw a card.',
            colors: ['B'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [
          { id: 'lib_top_1', name: 'Filler', type_line: 'Instant', oracle_text: '' },
        ],
        libraryCount: 1,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_exile_card',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            cmc: 1,
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'cremate_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_exile_card'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: { payment: [{ permanentId: '__pool__:black', mana: 'B', count: 1 }] },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const opponentExile = (game.state as any).zones?.[opponentId]?.exile || [];
    expect(opponentExile.find((c: any) => c?.id === 'gy_exile_card')).toBeDefined();

    const opponentGraveyard = (game.state as any).zones?.[opponentId]?.graveyard || [];
    expect(opponentGraveyard.find((c: any) => c?.id === 'gy_exile_card')).toBeUndefined();
  });

  it('Necromantic Summons: spell mastery adds two additional +1/+1 counters when active', async () => {
    const testGameId = `${baseId}_necsummons`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'necsummons_1',
            name: 'Necromantic Summons',
            mana_cost: '{3}{B}{B}',
            manaCost: '{3}{B}{B}',
            type_line: 'Sorcery',
            oracle_text:
              'Put target creature card from a graveyard onto the battlefield under your control. Spell mastery — If there are two or more instant and/or sorcery cards in your graveyard, that creature enters with two additional +1/+1 counters on it.',
            colors: ['B'],
          },
        ],
        handCount: 1,
        // Two instants in your own graveyard => spell mastery active.
        graveyard: [
          { id: 'gy_inst_1', name: 'Counterspell', type_line: 'Instant', mana_cost: '{U}{U}', cmc: 2 },
          { id: 'gy_sorc_1', name: 'Doom Blade', type_line: 'Sorcery', mana_cost: '{1}{B}', cmc: 2 },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_target_creature',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            mana_cost: '{1}{G}',
            cmc: 2,
            power: '2',
            toughness: '2',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'necsummons_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_target_creature'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:black', mana: 'B', count: 2 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 3 },
        ],
      },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const battlefield = (game.state as any).battlefield || [];
    const reanimated = battlefield.find((perm: any) => perm?.card?.name === 'Grizzly Bears');
    expect(reanimated).toBeDefined();
    expect(reanimated.controller).toBe(playerId);
    expect(reanimated.counters?.['+1/+1']).toBe(2);
  });

  it('Pulse of Murasa: returns target creature/land card from a graveyard to its owner\'s hand and gains 4 life', async () => {
    const testGameId = `${baseId}_pulse`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'pulse_1',
            name: 'Pulse of Murasa',
            mana_cost: '{2}{G}',
            manaCost: '{2}{G}',
            type_line: 'Instant',
            oracle_text: "Return target creature or land card from a graveyard to its owner's hand. You gain 4 life.",
            colors: ['G'],
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
        graveyard: [
          {
            id: 'gy_target_pulse',
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            mana_cost: '{G}',
            cmc: 1,
            power: '1',
            toughness: '1',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).life = (game.state as any).life || {};
    (game.state as any).life[playerId] = 40;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'pulse_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_target_pulse'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:green', mana: 'G', count: 1 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 2 },
        ],
      },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const opponentHand = (game.state as any).zones?.[opponentId]?.hand || [];
    expect(opponentHand.find((c: any) => c?.id === 'gy_target_pulse')).toBeDefined();

    const opponentGraveyard = (game.state as any).zones?.[opponentId]?.graveyard || [];
    expect(opponentGraveyard.find((c: any) => c?.id === 'gy_target_pulse')).toBeUndefined();

    const p1Life =
      (game.state as any).life?.[playerId] ??
      (game.state as any).players?.find((p: any) => p?.id === playerId)?.life;
    expect(p1Life).toBe(44);
  });

  it("Kenrith-style: 'under its owner's control' reanimates the targeted creature back to its original owner", async () => {
    const testGameId = `${baseId}_kenrith`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 4 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'kenrith_spell_1',
            name: 'Kenrith Mock Reanimate',
            mana_cost: '{4}{B}',
            manaCost: '{4}{B}',
            type_line: 'Sorcery',
            oracle_text: "Put target creature card from a graveyard onto the battlefield under its owner's control.",
            colors: ['B'],
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
        graveyard: [
          {
            id: 'gy_kenrith_target',
            name: 'Serra Angel',
            type_line: 'Creature — Angel',
            mana_cost: '{3}{W}{W}',
            cmc: 5,
            power: '4',
            toughness: '4',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'kenrith_spell_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_kenrith_target'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:black', mana: 'B', count: 1 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 4 },
        ],
      },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const battlefield = (game.state as any).battlefield || [];
    const reanimated = battlefield.find((perm: any) => perm?.card?.name === 'Serra Angel');
    expect(reanimated).toBeDefined();
    // Owner is opponent (the original graveyard owner), and controller should also be opponent.
    expect(reanimated.owner).toBe(opponentId);
    expect(reanimated.controller).toBe(opponentId);

    const opponentGraveyard = (game.state as any).zones?.[opponentId]?.graveyard || [];
    expect(opponentGraveyard.find((c: any) => c?.id === 'gy_kenrith_target')).toBeUndefined();
  });

  it("Necrotic-Sliver-style: 'from an opponent's graveyard' scope reanimates target opponent's creature card under your control", async () => {
    const testGameId = `${baseId}_oppgy`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'opp_gy_spell_1',
            name: 'Mock Animate Opp Grave',
            mana_cost: '{2}{B}',
            manaCost: '{2}{B}',
            type_line: 'Sorcery',
            oracle_text: "Put target creature card from an opponent's graveyard onto the battlefield under your control.",
            colors: ['B'],
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
        graveyard: [
          {
            id: 'gy_opp_creature',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            mana_cost: '{1}{G}',
            cmc: 2,
            power: '2',
            toughness: '2',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'opp_gy_spell_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_opp_creature'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:black', mana: 'B', count: 1 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 2 },
        ],
      },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const battlefield = (game.state as any).battlefield || [];
    const reanimated = battlefield.find((perm: any) => perm?.card?.name === 'Grizzly Bears');
    expect(reanimated).toBeDefined();
    expect(reanimated.owner).toBe(opponentId);
    expect(reanimated.controller).toBe(playerId);

    const opponentGraveyard = (game.state as any).zones?.[opponentId]?.graveyard || [];
    expect(opponentGraveyard.find((c: any) => c?.id === 'gy_opp_creature')).toBeUndefined();
  });

  it("Fated Return-style: 'That creature gains indestructible.' rider grants indestructible to the reanimated creature", async () => {
    const testGameId = `${baseId}_fated`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 3, red: 0, green: 0, colorless: 5 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'fated_return_1',
            name: 'Fated Return',
            mana_cost: '{5}{B}{B}{B}',
            manaCost: '{5}{B}{B}{B}',
            type_line: 'Instant',
            oracle_text: 'Put target creature card from a graveyard onto the battlefield under your control. That creature gains indestructible. If it\u2019s your turn, scry 2.',
            colors: ['B'],
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
        graveyard: [
          {
            id: 'gy_fated_target',
            name: 'Hill Giant',
            type_line: 'Creature \u2014 Giant',
            mana_cost: '{3}{R}',
            cmc: 4,
            power: '3',
            toughness: '3',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'fated_return_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_fated_target'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:black', mana: 'B', count: 3 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 5 },
        ],
      },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const battlefield = (game.state as any).battlefield || [];
    const reanimated = battlefield.find((perm: any) => perm?.card?.name === 'Hill Giant');
    expect(reanimated).toBeDefined();
    expect(reanimated.controller).toBe(playerId);
    expect(Array.isArray(reanimated.grantedAbilities)).toBe(true);
    expect(reanimated.grantedAbilities.map((a: any) => String(a).toLowerCase())).toContain('indestructible');

    const opponentGraveyard = (game.state as any).zones?.[opponentId]?.graveyard || [];
    expect(opponentGraveyard.find((c: any) => c?.id === 'gy_fated_target')).toBeUndefined();

    // Trailing rider: "If it's your turn, scry 2." should queue a SCRY step
    // for the caster (since turnPlayer is the caster).
    const scryStep = ResolutionQueueManager.getQueue(testGameId).steps.find(
      (entry: any) => entry.type === ResolutionStepType.SCRY && String(entry.playerId) === playerId,
    ) as any;
    expect(scryStep).toBeDefined();
    expect(Number(scryStep?.scryCount ?? 0)).toBe(2);
  });

  it("Rise from the Grave-style: 'That creature is a black Zombie in addition to its other colors and types.' rider adds color and subtype", async () => {
    const testGameId = `${baseId}_rise`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 4 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'rise_grave_1',
            name: 'Rise from the Grave',
            mana_cost: '{4}{B}',
            manaCost: '{4}{B}',
            type_line: 'Sorcery',
            oracle_text: 'Put target creature card from a graveyard onto the battlefield under your control. That creature is a black Zombie in addition to its other colors and types.',
            colors: ['B'],
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
        graveyard: [
          {
            id: 'gy_rise_target',
            name: 'Grizzled Knight',
            type_line: 'Creature \u2014 Human Knight',
            mana_cost: '{2}{W}',
            cmc: 3,
            power: '2',
            toughness: '3',
            colors: ['W'],
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'rise_grave_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_rise_target'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:black', mana: 'B', count: 1 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 4 },
        ],
      },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const battlefield = (game.state as any).battlefield || [];
    const reanimated = battlefield.find((perm: any) => perm?.card?.name === 'Grizzled Knight');
    expect(reanimated).toBeDefined();
    expect(reanimated.controller).toBe(playerId);
    // Subtype "Zombie" added in addition to "Human Knight"
    expect(String(reanimated.card?.type_line || '').toLowerCase()).toContain('zombie');
    // Original subtypes preserved
    expect(String(reanimated.card?.type_line || '').toLowerCase()).toContain('knight');
    // Black color added in addition to original (white)
    expect(Array.isArray(reanimated.card?.colors)).toBe(true);
    expect(reanimated.card.colors).toContain('B');
    expect(reanimated.card.colors).toContain('W');

    const opponentGraveyard = (game.state as any).zones?.[opponentId]?.graveyard || [];
    expect(opponentGraveyard.find((c: any) => c?.id === 'gy_rise_target')).toBeUndefined();
  });

  it("Vile Rebirth-style: 'Exile target creature card from a graveyard. Create a 2/2 black Zombie creature token.' chains exile and IR-driven token creation", async () => {
    const testGameId = `${baseId}_vile`;
    const game = await setupGame(testGameId, playerId, opponentId);
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 1 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'vile_rebirth_1',
            name: 'Vile Rebirth',
            mana_cost: '{B}',
            manaCost: '{B}',
            type_line: 'Instant',
            oracle_text: "Exile target creature card from a graveyard. Create a 2/2 black Zombie creature token.",
            colors: ['B'],
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
        graveyard: [
          {
            id: 'gy_vile_target',
            name: 'Doomed Bear',
            type_line: 'Creature \u2014 Bear',
            mana_cost: '{1}{G}',
            cmc: 2,
            power: '2',
            toughness: '2',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, testGameId, emitted);
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId: testGameId, cardId: 'vile_rebirth_1' });

    let queue = ResolutionQueueManager.getQueue(testGameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(targetStep.id),
      selections: ['gy_vile_target'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(testGameId);
    const paymentStep = queue.steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:black', mana: 'B', count: 1 },
        ],
      },
    });

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    // Exile rider: card removed from opponent graveyard and now in opponent's exile
    const opponentGraveyard = (game.state as any).zones?.[opponentId]?.graveyard || [];
    expect(opponentGraveyard.find((c: any) => c?.id === 'gy_vile_target')).toBeUndefined();
    const opponentExile = (game.state as any).zones?.[opponentId]?.exile || [];
    expect(opponentExile.find((c: any) => c?.id === 'gy_vile_target')).toBeDefined();

    // Token creation rider: a 2/2 black Zombie token is on player's battlefield
    const battlefield = (game.state as any).battlefield || [];
    const zombieToken = battlefield.find(
      (perm: any) =>
        String(perm?.controller) === playerId &&
        String(perm?.card?.type_line || '').toLowerCase().includes('zombie'),
    );
    expect(zombieToken).toBeDefined();
  });
});
