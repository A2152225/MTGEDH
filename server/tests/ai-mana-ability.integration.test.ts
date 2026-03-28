import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
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
  } as any;
}

describe('AI mana ability integration', () => {
  const playerId = 'ai1';
  const gameId = 'test_ai_mana_ability_integration';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    games.delete(gameId as any);
    unregisterAIPlayer(gameId, playerId as any);
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

  it('sacrifices Treasure mana sources live and persists the exact mana added', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
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

    registerAIPlayer(gameId, playerId as any);
  mockAIActivatedAbilityDecision('treasure_1', 'Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), gameId, playerId as any);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.id === 'treasure_1')).toBe(false);
    const totalMana = Object.values((game.state as any).manaPool?.[playerId] || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0);
    expect(totalMana).toBe(1);

    const manaEvent = [...getEvents(gameId)].reverse().find((event: any) => event?.type === 'activateManaAbility') as any;
    expect(manaEvent?.payload?.manaColor).toMatch(/^[WUBRG]$/);
    expect(Object.values(manaEvent?.payload?.addedMana || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0)).toBe(1);

    const costEvent = [...getEvents(gameId)].reverse().find((event: any) => event?.type === 'activateBattlefieldAbility') as any;
    expect((costEvent?.payload?.sacrificedPermanents || []).map(String)).toContain('treasure_1');
  });

  it('applies pain-land life loss live and persists the mana delta', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
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
        id: 'reef_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'reef_card_1',
          name: 'Shivan Reef',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}. {T}: Add {U} or {R}. Shivan Reef deals 1 damage to you.',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);
  mockAIActivatedAbilityDecision('reef_1', 'Shivan Reef', '{T}: Add {C}. {T}: Add {U} or {R}. Shivan Reef deals 1 damage to you.');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), gameId, playerId as any);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect((game.state as any).life?.[playerId]).toBe(39);
    const totalMana = Object.values((game.state as any).manaPool?.[playerId] || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0);
    expect(totalMana).toBe(1);

    const manaEvent = [...getEvents(gameId)].reverse().find((event: any) => event?.type === 'activateManaAbility') as any;
    expect(manaEvent?.payload?.lifeLost).toBe(1);
    expect(Object.values(manaEvent?.payload?.addedMana || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0)).toBe(1);
  });
});