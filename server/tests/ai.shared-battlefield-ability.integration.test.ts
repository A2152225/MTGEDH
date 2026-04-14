import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import * as interactionModule from '../src/socket/interaction.js';
import { initializeAIResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { AIEngine, AIDecisionType } from '../../rules-engine/src/AIEngine.js';

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
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

describe('AI shared battlefield ability surface', () => {
  const playerId = 'ai1';
  const gameId = 'test_ai_shared_battlefield_ability_surface';

  beforeAll(async () => {
    await initDb();
    initializeAIResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    games.delete(gameId as any);
    unregisterAIPlayer(gameId, playerId as any);
  });

  function mockAIActivatedAbilityDecision(
    permanentId: string,
    cardName: string,
    abilityText: string,
    actionOverrides: Record<string, unknown> = {},
  ) {
    return vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {
        activate: true,
        permanentId,
        cardName,
        abilityText,
        ...actionOverrides,
      },
      reasoning: `Test-selected activation for ${cardName}`,
      confidence: 1,
    } as any);
  }

  function createScheduledTimeoutDrain() {
    const callbacks: Array<() => void> = [];
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback: any) => {
      if (typeof callback === 'function') {
        callbacks.push(callback as () => void);
      }
      return 0 as any;
    });

    return {
      async drain(maxPasses: number = 20) {
        for (let pass = 0; pass < maxPasses; pass += 1) {
          while (callbacks.length > 0) {
            const callback = callbacks.shift();
            callback?.();
          }

          await Promise.resolve();
          await Promise.resolve();

          if (callbacks.length === 0) {
            return;
          }
        }

        throw new Error('Exceeded scheduled timeout drain limit');
      },
      restore() {
        setTimeoutSpy.mockRestore();
      },
    };
  }

  it('routes a non-mana choice on a multi-ability permanent through the shared battlefield handler', async () => {
    const localGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    games.delete(localGameId as any);
    unregisterAIPlayer(localGameId, playerId as any);

    createGameIfNotExists(localGameId, 'commander', 40);
    const game = ensureGame(localGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).activePlayer = playerId;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'opt_1',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Scry 1. Draw a card.',
            mana_cost: '{U}',
            cmc: 1,
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        library: [
          {
            id: 'drawn_1',
            name: 'Drawn Card',
            type_line: 'Artifact',
            oracle_text: '',
            zone: 'library',
          },
        ],
        libraryCount: 1,
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'sphere_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'sphere_card_1',
          name: "Commander's Sphere",
          type_line: 'Artifact',
          oracle_text: "{T}: Add one mana of any color in your commander's color identity.\nSacrifice Commander's Sphere: Draw a card.",
        },
      },
    ];

    registerAIPlayer(localGameId, playerId as any);
    mockAIActivatedAbilityDecision('sphere_1', "Commander's Sphere", "Sacrifice Commander's Sphere: Draw a card.");

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), localGameId, playerId as any);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((entry: any) => entry.id === 'sphere_1')).toBeUndefined();

    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(graveyard).toHaveLength(1);
    expect(String(graveyard[0]?.name || '')).toBe("Commander's Sphere");

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
  expect(hand).toHaveLength(2);
  expect(hand.some((card: any) => String(card?.name || '') === 'Drawn Card')).toBe(true);

    expect(getEvents(localGameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);
  });

  it('routes a generic stack-based draw activation through the shared battlefield handler', async () => {
    const localGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    games.delete(localGameId as any);
    unregisterAIPlayer(localGameId, playerId as any);

    createGameIfNotExists(localGameId, 'commander', 40);
    const game = ensureGame(localGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [
          {
            id: 'drawn_1',
            name: 'Drawn Card',
            type_line: 'Instant',
            oracle_text: 'Draw a card.',
            zone: 'library',
          },
        ],
        libraryCount: 1,
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'tome_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'tome_card',
          name: 'Arcane Encyclopedia',
          type_line: 'Artifact',
          oracle_text: '{3}, {T}: Draw a card.',
        },
      },
    ];

    registerAIPlayer(localGameId, playerId as any);
    mockAIActivatedAbilityDecision('tome_1', 'Arcane Encyclopedia', '{3}, {T}: Draw a card.');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), localGameId, playerId as any);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect((game.state as any).battlefield[0]?.tapped).toBe(true);
    expect((game.state as any).manaPool[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.type || '')).toBe('ability');
    expect(String(stack[0]?.source || '')).toBe('tome_1');
    expect(String(stack[0]?.description || '')).toBe('draw a card.');
    expect(String(stack[0]?.activatedAbilityText || '').toLowerCase()).toBe('{3}, {t}: draw a card.');

    const persisted = [...getEvents(localGameId)].reverse().find((event: any) =>
      event?.type === 'activateBattlefieldAbility'
      && event?.payload?.permanentId === 'tome_1'
    ) as any;
    expect(persisted).toBeTruthy();
    expect(String(persisted?.payload?.activatedAbilityText || '').toLowerCase()).toBe('{3}, {t}: draw a card.');
    expect(Boolean(persisted?.payload?.usesStack)).toBe(true);
    expect(getEvents(localGameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);
  });

  it('persists legacy fallback activations through activateBattlefieldAbility when shared activation does not progress', async () => {
    const localGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    games.delete(localGameId as any);
    unregisterAIPlayer(localGameId, playerId as any);

    createGameIfNotExists(localGameId, 'commander', 40);
    const game = ensureGame(localGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'fallback_tome_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'fallback_tome_card',
          name: 'Arcane Encyclopedia',
          type_line: 'Artifact',
          oracle_text: '{3}, {T}: Draw a card.',
        },
      },
    ];

    registerAIPlayer(localGameId, playerId as any);
    vi.spyOn(interactionModule, 'registerInteractionHandlers').mockImplementation((_io: any, socket: any) => {
      socket.on('activateBattlefieldAbility', async () => {});
    });
    mockAIActivatedAbilityDecision(
      'fallback_tome_1',
      'Arcane Encyclopedia',
      '{3}, {T}: Draw a card.',
    );

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), localGameId, playerId as any);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect((game.state as any).battlefield[0]?.tapped).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.type || '')).toBe('ability');
    expect(String(stack[0]?.source || '')).toBe('fallback_tome_1');
    expect(String(stack[0]?.activatedAbilityText || '').toLowerCase()).toBe('{3}, {t}: draw a card.');

    const persisted = [...getEvents(localGameId)].reverse().find((event: any) =>
      event?.type === 'activateBattlefieldAbility'
      && event?.payload?.permanentId === 'fallback_tome_1'
    ) as any;
    expect(persisted).toBeTruthy();
    expect(String(persisted?.payload?.abilityType || '')).toBe('generic');
    expect(Boolean(persisted?.payload?.usesStack)).toBe(true);
    expect(getEvents(localGameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);
  });

  it('routes untargeted planeswalker loyalty activations through the shared battlefield handler', async () => {
    const localGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    games.delete(localGameId as any);
    unregisterAIPlayer(localGameId, playerId as any);

    createGameIfNotExists(localGameId, 'commander', 40);
    const game = ensureGame(localGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).activePlayer = playerId;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'jace_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: { loyalty: 3 },
        loyalty: 3,
        card: {
          id: 'jace_card',
          name: 'Jace Beleren',
          type_line: 'Legendary Planeswalker — Jace',
          oracle_text: '+2: Each player draws a card.\n-1: Target player draws a card.\n-10: Target player mills twenty cards.',
        },
      },
    ];

    registerAIPlayer(localGameId, playerId as any);
    mockAIActivatedAbilityDecision('jace_1', 'Jace Beleren', '+2: Each player draws a card.');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), localGameId, playerId as any);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    const planeswalker = (game.state as any).battlefield.find((entry: any) => entry.id === 'jace_1');
    expect(planeswalker?.counters?.loyalty).toBe(5);
    expect(planeswalker?.loyalty).toBe(5);
    expect(planeswalker?.loyaltyActivationsThisTurn).toBe(1);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toBe('each player draws a card.');
    expect(String(stack[0]?.activatedAbilityText || '').toLowerCase()).toBe('+2: each player draws a card.');
    expect(Number(stack[0]?.planeswalker?.abilityIndex ?? -1)).toBe(0);

    expect(getEvents(localGameId).some((event: any) => event?.type === 'activatePlaneswalkerAbility')).toBe(true);
    expect(getEvents(localGameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);
  });

  it('routes targeted planeswalker loyalty activations through shared target selection and resolution', async () => {
    const localGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    games.delete(localGameId as any);
    unregisterAIPlayer(localGameId, playerId as any);
    ResolutionQueueManager.removeQueue(localGameId);

    createGameIfNotExists(localGameId, 'commander', 40);
    const game = ensureGame(localGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, isAI: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, opp1: 40 };
    (game.state as any).activePlayer = playerId;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
      },
      opp1: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'jace_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: { loyalty: 3 },
        loyalty: 3,
        card: {
          id: 'jace_target_card',
          name: 'Jace Beleren',
          type_line: 'Legendary Planeswalker — Jace',
          oracle_text: '+2: Each player draws a card.\n-1: Target player draws a card.\n-10: Target player mills twenty cards.',
        },
      },
    ];

    registerAIPlayer(localGameId, playerId as any);
    mockAIActivatedAbilityDecision('jace_2', 'Jace Beleren', '-1: Target player draws a card.');

    const scheduled = createScheduledTimeoutDrain();
    try {
      await handleAIPriority(createNoopIo(), localGameId, playerId as any);
      await scheduled.drain();
    } finally {
      scheduled.restore();
    }

    const queue = ResolutionQueueManager.getQueue(localGameId);
    expect(queue.steps.some((entry: any) => String((entry as any).type || '').toLowerCase() === 'target_selection')).toBe(false);
    const completedTargetStep = queue.completedSteps.find((entry: any) =>
      String((entry as any)?.type || '').toLowerCase() === 'target_selection' &&
      String((entry as any)?.sourceId || '') === 'jace_2' &&
      Boolean((entry as any)?.planeswalkerAbility)
    ) as any;
    expect(completedTargetStep).toBeDefined();
    expect(completedTargetStep?.response?.selections).toEqual([playerId]);

    const planeswalker = (game.state as any).battlefield.find((entry: any) => entry.id === 'jace_2');
    expect(planeswalker?.counters?.loyalty).toBe(2);
    expect(planeswalker?.loyalty).toBe(2);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.targets).toEqual([playerId]);
    expect(String(stack[0]?.description || '')).toBe('target player draws a card.');
    expect(String(stack[0]?.activatedAbilityText || '').toLowerCase()).toBe('-1: target player draws a card.');
    expect(Number(stack[0]?.planeswalker?.abilityIndex ?? -1)).toBe(1);

    expect(getEvents(localGameId).some((event: any) => event?.type === 'activatePlaneswalkerAbility')).toBe(true);
    expect(getEvents(localGameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);
  });
});