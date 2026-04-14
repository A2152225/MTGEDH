import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { cleanupGameAI, handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
import { initializeAIResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { AIEngine, AIDecisionType } from '../../rules-engine/src/AIEngine.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

const trackedGameIds: string[] = [];
const playerId = 'ai1';

function createTestGameId(label: string): string {
  const gameId = `test_ai_shared_battlefield_followup_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

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

describe('AI shared battlefield follow-up integration', () => {
  beforeAll(async () => {
    await initDb();
    initializeAIResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    trackedGameIds.length = 0;
  });

  afterEach(() => {
    for (const gameId of trackedGameIds) {
      cleanupGameAI(gameId);
      unregisterAIPlayer(gameId, playerId as any);
      games.delete(gameId as any);
    }
  });

  it('routes Humble Defector through shared targeting and resolution without legacy activateAbility persistence', async () => {
    const gameId = createTestGameId('humble_defector');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const libraryCards = [
      { id: 'drawn_1', name: 'Card One', type_line: 'Instant', oracle_text: 'Draw a card.' },
      { id: 'drawn_2', name: 'Card Two', type_line: 'Sorcery', oracle_text: 'Scry 1.' },
    ];

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, isAI: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, opp1: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [...libraryCards],
        libraryCount: libraryCards.length,
        exile: [],
        exileCount: 0,
      },
      opp1: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([[playerId, [...libraryCards]], ['opp1', []]]);
    (game.state as any).battlefield = [
      {
        id: 'humble_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'humble_card',
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);
    mockAIActivatedAbilityDecision(
      'humble_1',
      'Humble Defector',
      '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
    );

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), gameId, playerId as any);
      await vi.waitFor(() => {
        const humbleDefector = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === 'humble_1');
        expect((game.state as any).zones?.[playerId]?.hand || []).toHaveLength(2);
        expect(humbleDefector?.controller).toBe('opp1');
      });
    } finally {
      setTimeoutSpy.mockRestore();
    }

    const humbleDefector = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === 'humble_1');
    expect(humbleDefector?.controller).toBe('opp1');
    expect(humbleDefector?.tapped).toBe(true);
    expect(humbleDefector?.summoningSickness).toBe(true);
    expect((game.state as any).zones?.[playerId]?.hand || []).toHaveLength(2);
    expect(getEvents(gameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);
    expect(getEvents(gameId).some((event: any) => event?.type === 'activateBattlefieldAbility')).toBe(true);
  });

  it('routes Polluted Delta through shared fetchland activation and AI library search without legacy activateAbility persistence', async () => {
    const gameId = createTestGameId('polluted_delta');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const libraryCards = [
      {
        id: 'island_1',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '{T}: Add {U}.',
      },
      {
        id: 'mountain_1',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '{T}: Add {R}.',
      },
    ];

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [...libraryCards],
        libraryCount: libraryCards.length,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([[playerId, [...libraryCards]]]);
    (game.state as any).battlefield = [
      {
        id: 'delta_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'delta_card',
          name: 'Polluted Delta',
          type_line: 'Land',
          oracle_text: '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);
    mockAIActivatedAbilityDecision(
      'delta_1',
      'Polluted Delta',
      '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
    );

    const scheduledTimeouts = createScheduledTimeoutDrain();
    try {
      await handleAIPriority(createNoopIo(), gameId, playerId as any);
      await scheduledTimeouts.drain();
    } finally {
      scheduledTimeouts.restore();
    }

    await vi.waitFor(() => {
      const battlefieldNames = ((game.state as any).battlefield || []).map((perm: any) => String(perm?.card?.name || ''));
      expect(battlefieldNames).toContain('Island');
      expect((((game.state as any).zones?.[playerId]?.graveyard) || []).map((card: any) => String(card?.name || ''))).toContain('Polluted Delta');
    });

    const battlefieldNames = ((game.state as any).battlefield || []).map((perm: any) => String(perm?.card?.name || ''));
    expect(battlefieldNames).toContain('Island');
    expect(battlefieldNames).not.toContain('Polluted Delta');
    expect((((game.state as any).zones?.[playerId]?.graveyard) || []).map((card: any) => String(card?.name || ''))).toContain('Polluted Delta');
    expect((game.state as any).life?.[playerId]).toBe(39);
    expect((game.state as any).lifeLostThisTurn?.[playerId]).toBe(1);
    expect(getEvents(gameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);
    expect(getEvents(gameId).some((event: any) => event?.type === 'activateFetchland')).toBe(true);
  });
});