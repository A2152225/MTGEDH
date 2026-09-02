import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import {
  chooseAISpellPaymentSelections,
  cleanupGameAI,
  handleAIResolutionStep,
  registerAIPlayer,
} from '../src/socket/ai.js';
import { findCastableSpells } from '../src/socket/ai-handlers/aiFindCastableSpells.js';
import { isAIFailedSpellCastCard } from '../src/socket/ai-handlers/aiLandAuraCommander.js';
import { games } from '../src/socket/socket.js';
import { calculateManaProduction, ensureGame } from '../src/socket/util.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const playerId = 'ai1';
const trackedGameIds: string[] = [];

const SCION = {
  id: 'scion_card_1',
  name: 'Scion of Calamity',
  type_line: 'Creature — Dinosaur',
  mana_cost: '{3}{G}{G}',
  oracle_text:
    "Myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token copy that's tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)\nWhenever this creature deals combat damage to a player, destroy target artifact or enchantment that player controls.",
};

const YAVIMAYA_ORACLE = 'Each land is a Forest in addition to its other land types.';
const PATH_ORACLE =
  "This land enters tapped.\n{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.";

async function cleanupTrackedGame(gameId: string) {
  cleanupGameAI(gameId);
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createTestGameId(label: string): string {
  const gameId = `test_ai_yavimaya_scion_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: {
      sockets: new Map(),
    },
    in: (_room: string) => ({
      fetchSockets: async () => [],
    }),
  } as any;
}

function seedAiGame(game: any) {
  (game.state as any).players = [
    { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
  (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnCount = 4;
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).commandZone = {
    [playerId]: {
      commanderCards: [{ name: 'Gishath, Sun\'s Avatar', color_identity: ['R', 'G', 'W'] }],
    },
  };
  (game.state as any).zones = {
    [playerId]: {
      hand: [SCION],
      handCount: 1,
      graveyard: [],
      graveyardCount: 0,
      library: [],
      libraryCount: 0,
      exile: [],
      exileCount: 0,
    },
  };
}

function landPermanent(id: string, name: string, typeLine: string, oracleText: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller: playerId,
    owner: playerId,
    tapped: false,
    summoningSickness: false,
    counters: {},
    ...extra,
    card: {
      id: `${id}_card`,
      name,
      type_line: typeLine,
      oracle_text: oracleText,
    },
  };
}

describe('AI Yavimaya / Scion of Calamity payment', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of trackedGameIds.splice(0, trackedGameIds.length)) {
      await cleanupTrackedGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds.splice(0, trackedGameIds.length)) {
      await cleanupTrackedGame(gameId);
    }
  });

  it('lets a Mountain tap for {G} while Yavimaya, Cradle of Growth is on the battlefield', () => {
    const gameId = createTestGameId('mountain_g');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    seedAiGame(game);

    const mountain = landPermanent('mountain_1', 'Mountain', 'Basic Land — Mountain', '{T}: Add {R}.');
    const yavimaya = landPermanent(
      'yavimaya_1',
      'Yavimaya, Cradle of Growth',
      'Legendary Land',
      YAVIMAYA_ORACLE,
    );
    (game.state as any).battlefield = [mountain, yavimaya];

    const produced = calculateManaProduction(game.state, mountain, playerId, 'G');
    expect(produced.colors.map((color) => String(color).toUpperCase())).toContain('G');
    expect(Number(produced.totalAmount || 0)).toBeGreaterThanOrEqual(1);
  });

  it('assembles {3}{G}{G} from Mountains-as-Forests plus Path / Sunpetal / Bugenhagen', async () => {
    const gameId = createTestGameId('scion_board');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    seedAiGame(game);

    (game.state as any).pendingSpellCasts = {
      cast_scion_1: {
        cardId: SCION.id,
        cardName: SCION.name,
        card: SCION,
        playerId,
      },
    };
    (game.state as any).battlefield = [
      landPermanent('mountain_1', 'Mountain', 'Basic Land — Mountain', '{T}: Add {R}.'),
      landPermanent('mountain_2', 'Mountain', 'Basic Land — Mountain', '{T}: Add {R}.'),
      {
        id: 'bugenhagen_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'bugenhagen_card_1',
          name: 'Bugenhagen, Wise Elder',
          type_line: 'Legendary Creature — Human Shaman',
          mana_cost: '{1}{G}',
          oracle_text:
            'Reach\nAt the beginning of your upkeep, if you control a creature with power 7 or greater, draw a card.\n{T}: Add one mana of any color.',
        },
      },
      landPermanent('path_1', 'Path of Ancestry', 'Land', PATH_ORACLE),
      landPermanent(
        'sunpetal_1',
        'Sunpetal Grove',
        'Land',
        'This land enters tapped unless you control a Forest or a Plains.\n{T}: Add {G} or {W}.',
      ),
      landPermanent('yavimaya_1', 'Yavimaya, Cradle of Growth', 'Legendary Land', YAVIMAYA_ORACLE, { tapped: true }),
      {
        id: 'ixalli_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: true,
        counters: {},
        card: {
          id: 'ixalli_card_1',
          name: "Ixalli's Lorekeeper",
          type_line: 'Creature — Human Druid',
          mana_cost: '{G}',
          oracle_text:
            '{T}: Add one mana of any color. Spend this mana only to cast a Dinosaur spell or activate an ability of a Dinosaur source.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{3}{G}{G}',
      totalManaCost: '{3}{G}{G}',
      effectId: 'cast_scion_1',
      cardId: SCION.id,
      card: SCION,
      spellPaymentRequired: true,
    });

    expect(plan).not.toBeNull();
    const payment = plan?.payment || [];
    expect(payment.length).toBeGreaterThanOrEqual(5);
    const greenTaps = payment.filter((entry) => String(entry.mana || '').toUpperCase() === 'G');
    expect(greenTaps.length).toBeGreaterThanOrEqual(2);
    expect(payment.some((entry) => entry.permanentId === 'mountain_1' || entry.permanentId === 'mountain_2')).toBe(true);
  });

  it('remembers a cancelled AI spell payment so the same card is not retried this turn', async () => {
    const gameId = createTestGameId('cancel_memory');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    seedAiGame(game);
    (game.state as any).battlefield = [];
    (game.state as any).pendingSpellCasts = {
      cast_scion_cancel: {
        cardId: SCION.id,
        cardName: SCION.name,
        card: SCION,
        playerId,
      },
    };

    const emitted: Array<{ event: string; payload: any }> = [];
    const socket = {
      id: `${playerId}_socket`,
      data: { playerId, spectator: false, gameId },
      rooms: new Set<string>([gameId]),
      on: () => undefined,
      emit: (event: string, payload: any) => {
        emitted.push({ event, payload });
      },
    } as any;
    const io = {
      to: (_room: string) => ({
        emit: (event: string, payload: any) => {
          emitted.push({ event, payload });
        },
      }),
      emit: (event: string, payload: any) => {
        emitted.push({ event, payload });
      },
      in: (_room: string) => ({
        fetchSockets: async () => [socket],
      }),
      sockets: { sockets: new Map([[socket.id, socket]]) },
    } as any;

    initializePriorityResolutionHandler(io);
    registerResolutionHandlers(io, socket);
    registerGameActions(io, socket);
    registerAIPlayer(gameId, playerId as any, 'AI', 0.5);

    const paymentStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId,
      sourceId: SCION.id,
      sourceName: SCION.name,
      description: `Pay costs to cast ${SCION.name}.`,
      mandatory: true,
      spellPaymentRequired: true,
      cardId: SCION.id,
      cardName: SCION.name,
      manaCost: '{3}{G}{G}',
      effectId: 'cast_scion_cancel',
    } as any);

    await handleAIResolutionStep(io, gameId, playerId as any, paymentStep);

    expect(isAIFailedSpellCastCard(game, playerId, SCION.id)).toBe(true);

    (game.state as any).battlefield = [
      landPermanent('forest_1', 'Forest', 'Basic Land — Forest', '{T}: Add {G}.'),
      landPermanent('forest_2', 'Forest', 'Basic Land — Forest', '{T}: Add {G}.'),
      landPermanent('forest_3', 'Forest', 'Basic Land — Forest', '{T}: Add {G}.'),
      landPermanent('forest_4', 'Forest', 'Basic Land — Forest', '{T}: Add {G}.'),
      landPermanent('forest_5', 'Forest', 'Basic Land — Forest', '{T}: Add {G}.'),
    ];
    const stillOffered = findCastableSpells(game, playerId as any).some(
      (candidate) => String(candidate.card?.id || '') === SCION.id,
    );
    expect(stillOffered).toBe(false);
  });
});
