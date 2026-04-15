import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { initializeAIResolutionHandler } from '../src/socket/resolution.js';
import { AIEngine, AIDecisionType } from '../../rules-engine/src/AIEngine.js';

function resetTestGame(gameId: string, playerId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  unregisterAIPlayer(gameId, playerId as any);
  deleteGame(gameId);
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
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

describe('AI mana ability integration', () => {
  const playerId = 'ai1';
  const gameId = 'test_ai_mana_ability_integration';

  beforeAll(async () => {
    await initDb();
    initializeAIResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    resetTestGame(gameId, playerId);
  });

  function mockAIActivatedAbilityDecision(permanentId: string, cardName: string, abilityText: string) {
    return vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {
        activate: true,
        permanentId,
        cardName,
        abilityText,
      },
      reasoning: `Test-selected activation for ${cardName}`,
      confidence: 1,
    } as any);
  }

  function setupTestGame(suffix: string) {
    const localGameId = `${gameId}_${suffix}_${Math.random().toString(36).slice(2, 10)}`;
    resetTestGame(localGameId, playerId);
    createGameIfNotExists(localGameId, 'commander', 40);
    const game = ensureGame(localGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    return { localGameId, game };
  }

  it('sacrifices Treasure mana sources live and persists the exact mana added', async () => {
    const { localGameId, game } = setupTestGame('treasure');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'spell_1',
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
        library: [],
        libraryCount: 0,
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'treasure_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        isToken: true,
        card: {
          id: 'treasure_card_1',
          name: 'Treasure',
          type_line: 'Token Artifact — Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
        },
      },
    ];

    registerAIPlayer(localGameId, playerId as any);
    mockAIActivatedAbilityDecision('treasure_1', 'Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), localGameId, playerId as any);
      await vi.waitFor(() => {
        const totalMana = Object.values((game.state as any).manaPool?.[playerId] || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0);
        expect(totalMana).toBe(1);
      });
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.id === 'treasure_1')).toBe(false);
    const totalMana = Object.values((game.state as any).manaPool?.[playerId] || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0);
    expect(totalMana).toBe(1);

    const manaEvent = [...getEvents(localGameId)].reverse().find((event: any) => event?.type === 'activateManaAbility') as any;
  expect(['white', 'blue', 'black', 'red', 'green', 'colorless', 'W', 'U', 'B', 'R', 'G', 'C']).toContain(String(manaEvent?.payload?.manaColor || ''));
    expect(Object.values(manaEvent?.payload?.addedMana || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0)).toBe(1);
    expect(getEvents(localGameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);

    const costEvent = [...getEvents(localGameId)].reverse().find((event: any) => event?.type === 'activateBattlefieldAbility') as any;
    expect((costEvent?.payload?.sacrificedPermanents || []).map(String)).toContain('treasure_1');
  });

  it('applies self-damage mana loss live and persists the mana delta', async () => {
    const { localGameId, game } = setupTestGame('damage');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'spell_2',
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
        library: [],
        libraryCount: 0,
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'confluence_damage_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'confluence_damage_card_1',
          name: 'Mana Confluence',
          type_line: 'Land',
          oracle_text: '{T}: Add one mana of any color. Whenever Mana Confluence is tapped for mana, it deals 1 damage to you.',
        },
      },
    ];

    registerAIPlayer(localGameId, playerId as any);
    mockAIActivatedAbilityDecision('confluence_damage_1', 'Mana Confluence', '{T}: Add one mana of any color. Whenever Mana Confluence is tapped for mana, it deals 1 damage to you.');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), localGameId, playerId as any);
      await vi.waitFor(() => {
        expect((game.state as any).life?.[playerId]).toBe(39);
      });
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect((game.state as any).life?.[playerId]).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[playerId]).toBe(1);
    const totalMana = Object.values((game.state as any).manaPool?.[playerId] || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0);
    expect(totalMana).toBe(1);

    const manaEvent = [...getEvents(localGameId)].reverse().find((event: any) => event?.type === 'activateManaAbility') as any;
    expect(manaEvent?.payload?.lifeLost).toBe(1);
    expect(manaEvent?.payload?.lifeLossIsDamage).toBe(true);
    expect(Object.values(manaEvent?.payload?.addedMana || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0)).toBe(1);
    expect(getEvents(localGameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);
  });

  it('treats pay-life mana abilities as life loss without damage tracking', async () => {
    const { localGameId, game } = setupTestGame('pay_life');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'spell_3',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Scry 1. Draw a card.',
            mana_cost: '{W}',
            cmc: 1,
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'confluence_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'confluence_card_1',
          name: 'Mana Confluence',
          type_line: 'Land',
          oracle_text: '{T}, Pay 1 life: Add one mana of any color.',
        },
      },
    ];

    registerAIPlayer(localGameId, playerId as any);
    mockAIActivatedAbilityDecision('confluence_1', 'Mana Confluence', '{T}, Pay 1 life: Add one mana of any color.');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), localGameId, playerId as any);
      await vi.waitFor(() => {
        expect(Number((game.state as any).lifeLostThisTurn?.[playerId] || 0)).toBe(1);
      });
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect((game.state as any).life?.[playerId]).toBe(39);
    expect(Number((game.state as any).lifeLostThisTurn?.[playerId] || 0)).toBe(1);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[playerId] ?? 0).toBe(0);

    const manaEvent = [...getEvents(localGameId)].reverse().find((event: any) => event?.type === 'activateManaAbility') as any;
    expect(manaEvent?.payload?.lifeLost).toBeUndefined();
    expect(manaEvent?.payload?.lifeLossIsDamage).toBeUndefined();
    expect(Object.values(manaEvent?.payload?.addedMana || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0)).toBe(1);
    expect(getEvents(localGameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);

    const costEvent = [...getEvents(localGameId)].reverse().find((event: any) => event?.type === 'activateBattlefieldAbility') as any;
    expect(costEvent?.payload?.lifePaidForCost).toBe(1);
  });
});