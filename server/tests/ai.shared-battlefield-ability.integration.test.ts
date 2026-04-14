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
});