import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIEngine, AIDecisionType } from '../../rules-engine/src/AIEngine.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { canAct, getCastableCommanderCandidates, getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { buildDurableCommandZonePermission, buildDurableLibraryPermission, buildDurablePlayableFromExilePermission } from '../src/state/modules/durable-permissions.js';
import { cleanupGameAI, handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

async function cleanupTrackedGame(gameId: string) {
  cleanupGameAI(gameId);
  unregisterAIPlayer(gameId, playerId as any);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
  } as any;
}

const trackedGameIds: string[] = [];
const playerId = 'ai1';

function createTestGameId(label: string): string {
  const gameId = `test_ai_shared_spell_surface_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

describe('AI shared spell-surface integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    trackedGameIds.length = 0;
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await cleanupTrackedGame(gameId);
    }
  });

  it('does not cast a spell whose name is prohibited by the shared chosen-name restriction model', async () => {
    const gameId = createTestGameId('chosen_name');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = 'opp1';
    (game.state as any).activePlayer = 'opp1';
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).commandZone = {
      [playerId]: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
      opp1: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
    };
    (game.state as any).battlefield = [
      {
        id: 'island_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'island_card_1',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '{T}: Add {U}.',
        },
      },
      {
        id: 'nevermore_1',
        controller: 'opp1',
        owner: 'opp1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        chosenCardName: 'Opt',
        card: {
          id: 'nevermore_card',
          name: 'Nevermore',
          type_line: 'Enchantment',
          oracle_text: "As Nevermore enters, choose a nonland card name. Spells with the chosen name can't be cast.",
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'opt_hand',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Scry 1, then draw a card.',
            mana_cost: '{U}',
            cmc: 1,
            zone: 'hand',
          },
        ],
        handCount: 1,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      opp1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    registerAIPlayer(gameId, playerId as any);

    vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {},
      reasoning: 'No activated ability available',
      confidence: 1,
    } as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect((game.state as any).stack || []).toEqual([]);
    expect(Object.values((game.state as any).pendingSpellCasts || {})).toEqual([]);
    expect(((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => String(card?.id || ''))).toEqual(['opt_hand']);
  });

  it('marks a reduced-cost hand spell as available through the shared spell surface and canAct', async () => {
    const gameId = createTestGameId('cost_reduction');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).landsPlayedThisTurn = { [playerId]: 1 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).commandZone = {
      [playerId]: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
      opp1: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
    };
    (game.state as any).battlefield = [
      {
        id: 'mountain_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'mountain_card_1',
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
      {
        id: 'ruby_medallion_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'ruby_medallion_card',
          name: 'Ruby Medallion',
          type_line: 'Artifact',
          oracle_text: 'Red spells you cast cost {1} less to cast.',
        },
      },
      {
        id: 'sol_ring_1',
        controller: 'opp1',
        owner: 'opp1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'sol_ring_card_1',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'shatter_1',
            name: 'Shatter',
            type_line: 'Instant',
            oracle_text: 'Destroy target artifact.',
            mana_cost: '{1}{R}',
            cmc: 2,
            zone: 'hand',
          },
          {
            id: 'dummy_spell_1',
            name: 'Dummy Spell 1',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
            mana_cost: '{9}',
            zone: 'hand',
          },
          {
            id: 'dummy_spell_2',
            name: 'Dummy Spell 2',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
            mana_cost: '{9}',
            zone: 'hand',
          },
          {
            id: 'dummy_spell_3',
            name: 'Dummy Spell 3',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
            mana_cost: '{9}',
            zone: 'hand',
          },
          {
            id: 'dummy_spell_4',
            name: 'Dummy Spell 4',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
            mana_cost: '{9}',
            zone: 'hand',
          },
          {
            id: 'dummy_spell_5',
            name: 'Dummy Spell 5',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
            mana_cost: '{9}',
            zone: 'hand',
          },
          {
            id: 'dummy_spell_6',
            name: 'Dummy Spell 6',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
            mana_cost: '{9}',
            zone: 'hand',
          },
          {
            id: 'dummy_spell_7',
            name: 'Dummy Spell 7',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
            mana_cost: '{9}',
            zone: 'hand',
          },
        ],
        handCount: 8,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      opp1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const sharedCandidates = getCastableSpellCandidates({
      state: game.state,
      libraries: (game as any).libraries,
    } as any, playerId as any, {
      mode: 'main',
      skipIgnoredCards: true,
      allowAlternateCosts: false,
      allowUnknownCostFallback: false,
    });

    expect(sharedCandidates.some((candidate) => String(candidate.card?.id || '') === 'shatter_1')).toBe(true);

    expect(canAct({
      state: game.state,
      libraries: (game as any).libraries,
    } as any, playerId as any)).toBe(true);
  });

  it('surfaces graveyard flashback and card-specific exile casts through the shared spell candidate helper', async () => {
    const gameId = createTestGameId('graveyard_exile_candidates');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).turnNumber = 3;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).commandZone = {
      [playerId]: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
      opp1: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
    };
    (game.state as any).playableFromExile = {
      [playerId]: { impulse_opt_1: 3 },
    };
    (game.state as any).battlefield = [
      {
        id: 'island_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'island_card_1',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '{T}: Add {U}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'deep_analysis_1',
            name: 'Think Twice',
            type_line: 'Instant',
            oracle_text: 'Draw a card. Flashback {U}.',
            mana_cost: '{1}{U}',
            cmc: 2,
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [
          {
            id: 'impulse_opt_1',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Scry 1, then draw a card.',
            mana_cost: '{U}',
            cmc: 1,
            zone: 'exile',
          },
        ],
        exileCount: 1,
      },
      opp1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const sharedCandidates = getCastableSpellCandidates({
      state: game.state,
      libraries: (game as any).libraries,
    } as any, playerId as any, {
      mode: 'main',
      skipIgnoredCards: true,
      allowAlternateCosts: false,
      allowUnknownCostFallback: false,
    });

    const graveyardCandidate = sharedCandidates.find((candidate) => String(candidate.card?.id || '') === 'deep_analysis_1');
    const exileCandidate = sharedCandidates.find((candidate) => String(candidate.card?.id || '') === 'impulse_opt_1');

    expect(graveyardCandidate).toEqual(expect.objectContaining({
      sourceZone: 'graveyard',
      castMethod: 'flashback',
      card: expect.objectContaining({ id: 'deep_analysis_1' }),
    }));
    expect(String(graveyardCandidate?.manaCost || '')).toMatch(/^\{u\}$/i);

    expect(exileCandidate).toEqual(expect.objectContaining({
      sourceZone: 'exile',
      castMethod: 'playable_from_exile',
      card: expect.objectContaining({ id: 'impulse_opt_1' }),
      manaCost: '{U}',
    }));

    expect(canAct({
      state: game.state,
      libraries: (game as any).libraries,
    } as any, playerId as any)).toBe(true);
  });

  it('routes durable free exile-cast permissions through the shared AI cast request flow', async () => {
    const gameId = createTestGameId('durable_exile_free_cast');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnNumber = 8;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).commandZone = {
      [playerId]: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
      opp1: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
    };
    (game.state as any).battlefield = [];
    (game.state as any).durablePermissions = [
      buildDurablePlayableFromExilePermission({
        playerId,
        cardIds: ['divination_exile_1'],
        action: 'cast',
        duration: 'this_turn',
        turnApplied: 8,
        expiresAtTurn: 8,
        sourceName: 'Free Exile Test',
        costMode: 'without_paying_mana_cost',
      }),
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [
          {
            id: 'divination_exile_1',
            name: 'Divination',
            type_line: 'Sorcery',
            oracle_text: 'Draw two cards.',
            mana_cost: '{2}{U}',
            cmc: 3,
            zone: 'exile',
          },
        ],
        exileCount: 1,
      },
      opp1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const sharedCandidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      skipIgnoredCards: true,
      allowAlternateCosts: false,
      allowUnknownCostFallback: false,
    });

    expect(sharedCandidates.find((candidate) => String(candidate.card?.id || '') === 'divination_exile_1')).toEqual(
      expect.objectContaining({
        sourceZone: 'exile',
        castMethod: 'playable_from_exile',
        payability: 'normal',
        manaCost: '',
      }),
    );

    registerAIPlayer(gameId, playerId as any);
    vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {},
      reasoning: 'No activated ability available',
      confidence: 1,
    } as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const pendingCast = Object.values((game.state as any).pendingSpellCasts || {}).find((entry: any) =>
      String(entry?.cardId || '') === 'divination_exile_1'
    ) as any;
    expect(pendingCast).toEqual(expect.objectContaining({
      cardId: 'divination_exile_1',
      fromZone: 'exile',
      manaCost: '{0}',
      rawManaCost: '{0}',
      castWithoutPayingManaCost: true,
    }));
  });

  it('uses durable flexible-mana exile permissions in the AI shared payment simulation', async () => {
    const gameId = createTestGameId('durable_exile_flexible_mana');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnNumber = 9;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).commandZone = {
      [playerId]: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
      opp1: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
    };
    (game.state as any).battlefield = [];
    (game.state as any).durablePermissions = [
      buildDurablePlayableFromExilePermission({
        playerId,
        cardIds: ['red_cantrip_exile_1'],
        action: 'cast',
        duration: 'this_turn',
        turnApplied: 9,
        expiresAtTurn: 9,
        sourceName: 'Flexible Exile Test',
        spendManaAsThoughAnyType: true,
      }),
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [
          {
            id: 'red_cantrip_exile_1',
            name: 'Red Cantrip',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
            mana_cost: '{R}',
            cmc: 1,
            zone: 'exile',
          },
        ],
        exileCount: 1,
      },
      opp1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const sharedCandidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      skipIgnoredCards: true,
      allowAlternateCosts: false,
      allowUnknownCostFallback: false,
    });

    expect(sharedCandidates.find((candidate) => String(candidate.card?.id || '') === 'red_cantrip_exile_1')).toEqual(
      expect.objectContaining({
        sourceZone: 'exile',
        castMethod: 'playable_from_exile',
        spendManaAsThoughAnyType: true,
        payableCost: expect.objectContaining({
          generic: 1,
          colors: expect.objectContaining({ R: 0 }),
        }),
      }),
    );

    registerAIPlayer(gameId, playerId as any);
    vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {},
      reasoning: 'No activated ability available',
      confidence: 1,
    } as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const pendingCast = Object.values((game.state as any).pendingSpellCasts || {}).find((entry: any) =>
      String(entry?.cardId || '') === 'red_cantrip_exile_1'
    ) as any;
    expect(pendingCast).toEqual(expect.objectContaining({
      cardId: 'red_cantrip_exile_1',
      fromZone: 'exile',
      manaCost: '{R}',
      rawManaCost: '{R}',
    }));
  });

  it('routes durable free top-library cast permissions through the shared AI cast request flow', async () => {
    const gameId = createTestGameId('durable_library_free_cast');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnNumber = 10;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).commandZone = {
      [playerId]: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
      opp1: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
    };
    (game.state as any).battlefield = [];
    (game.state as any).durablePermissions = [
      buildDurableLibraryPermission({
        playerId,
        action: 'cast',
        duration: 'this_turn',
        turnApplied: 10,
        expiresAtTurn: 10,
        sourceName: 'Free Library Test',
        costMode: 'without_paying_mana_cost',
        typeLineIncludes: ['sorcery'],
      }),
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      opp1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'divination_library_1',
          name: 'Divination',
          type_line: 'Sorcery',
          oracle_text: 'Draw two cards.',
          mana_cost: '{2}{U}',
          cmc: 3,
          zone: 'library',
        },
      ]],
      ['opp1', []],
    ]);

    const sharedCandidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      skipIgnoredCards: true,
      allowAlternateCosts: false,
      allowUnknownCostFallback: false,
    });

    expect(sharedCandidates.find((candidate) => String(candidate.card?.id || '') === 'divination_library_1')).toEqual(
      expect.objectContaining({
        sourceZone: 'library',
        castMethod: 'normal',
        payability: 'normal',
        manaCost: '',
        libraryPermissionCostMode: 'without_paying_mana_cost',
      }),
    );

    registerAIPlayer(gameId, playerId as any);
    vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {},
      reasoning: 'No activated ability available',
      confidence: 1,
    } as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const pendingCast = Object.values((game.state as any).pendingSpellCasts || {}).find((entry: any) =>
      String(entry?.cardId || '') === 'divination_library_1'
    ) as any;
    expect(pendingCast).toEqual(expect.objectContaining({
      cardId: 'divination_library_1',
      fromZone: 'library',
      manaCost: '{0}',
      rawManaCost: '{0}',
      castWithoutPayingManaCost: true,
    }));
  });

  it('uses durable flexible-mana top-library permissions in the AI shared payment simulation', async () => {
    const gameId = createTestGameId('durable_library_flexible_mana');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnNumber = 11;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).commandZone = {
      [playerId]: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
      opp1: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
    };
    (game.state as any).battlefield = [];
    (game.state as any).durablePermissions = [
      buildDurableLibraryPermission({
        playerId,
        action: 'cast',
        duration: 'this_turn',
        turnApplied: 11,
        expiresAtTurn: 11,
        sourceName: 'Flexible Library Test',
        spendManaAsThoughAnyType: true,
        typeLineIncludes: ['sorcery'],
      }),
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      opp1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'red_cantrip_library_1',
          name: 'Red Cantrip',
          type_line: 'Sorcery',
          oracle_text: 'Draw a card.',
          mana_cost: '{R}',
          cmc: 1,
          zone: 'library',
        },
      ]],
      ['opp1', []],
    ]);

    const sharedCandidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      skipIgnoredCards: true,
      allowAlternateCosts: false,
      allowUnknownCostFallback: false,
    });

    expect(sharedCandidates.find((candidate) => String(candidate.card?.id || '') === 'red_cantrip_library_1')).toEqual(
      expect.objectContaining({
        sourceZone: 'library',
        castMethod: 'normal',
        spendManaAsThoughAnyType: true,
        payableCost: expect.objectContaining({
          generic: 1,
          colors: expect.objectContaining({ R: 0 }),
        }),
      }),
    );

    registerAIPlayer(gameId, playerId as any);
    vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {},
      reasoning: 'No activated ability available',
      confidence: 1,
    } as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const pendingCast = Object.values((game.state as any).pendingSpellCasts || {}).find((entry: any) =>
      String(entry?.cardId || '') === 'red_cantrip_library_1'
    ) as any;
    expect(pendingCast).toEqual(expect.objectContaining({
      cardId: 'red_cantrip_library_1',
      fromZone: 'library',
      manaCost: '{R}',
      rawManaCost: '{R}',
    }));
  });

  it('routes commander casts through the shared spell request flow instead of a manual AI-only commander branch', async () => {
    const gameId = createTestGameId('commander_request_flow');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).landsPlayedThisTurn = { [playerId]: 1 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mountain_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'mountain_card_1',
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
      {
        id: 'ruby_medallion_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'ruby_medallion_card',
          name: 'Ruby Medallion',
          type_line: 'Artifact',
          oracle_text: 'Red spells you cast cost {1} less to cast.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'shock_1',
            name: 'Shock',
            type_line: 'Instant',
            oracle_text: 'Shock deals 2 damage to any target.',
            mana_cost: '{R}',
            cmc: 1,
            zone: 'hand',
          },
        ],
        handCount: 1,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      opp1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).commandZone = {
      [playerId]: {
        commanderIds: ['cmd_red'],
        commanderCards: [
          {
            id: 'cmd_red',
            name: 'Red Commander',
            type_line: 'Legendary Creature — Warrior',
            mana_cost: '{1}{R}',
            oracle_text: '',
          },
        ],
        inCommandZone: ['cmd_red'],
        taxById: { cmd_red: 0 },
      },
      opp1: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
    };

    const sharedCommanderCandidates = getCastableCommanderCandidates({
      state: game.state,
      libraries: (game as any).libraries,
    } as any, playerId as any);
    expect(sharedCommanderCandidates.map((candidate) => candidate.commanderId)).toEqual(['cmd_red']);

    registerAIPlayer(gameId, playerId as any);

    vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {},
      reasoning: 'No activated ability available',
      confidence: 1,
    } as any);

    const io = createNoopIo();
    await handleAIPriority(io, gameId, playerId as any);

    expect((game.state as any).stack).toEqual([]);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'mountain_1')?.tapped).toBe(false);
    expect(((game.state as any).commandZone?.[playerId]?.inCommandZone || [])).toContain('cmd_red');
    expect((game.state as any).commandZone?.[playerId]?.taxById?.cmd_red).toBe(0);
    expect(
      Object.values((game.state as any).pendingSpellCasts || {}).some((entry: any) =>
        String(entry?.playerId || '') === playerId &&
        String(entry?.cardId || '') === 'cmd_red' &&
        String(entry?.fromZone || '') === 'command'
      )
    ).toBe(true);
  });

  it('uses durable flexible-mana command-zone permissions in the AI commander payment simulation', async () => {
    const gameId = createTestGameId('commander_flexible_mana');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnNumber = 11;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).landsPlayedThisTurn = { [playerId]: 1 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      opp1: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).commandZone = {
      [playerId]: {
        commanderIds: ['cmd_red_flexible'],
        commanderCards: [
          {
            id: 'cmd_red_flexible',
            name: 'Flexible Red Commander',
            type_line: 'Legendary Creature — Warrior',
            mana_cost: '{R}',
            oracle_text: '',
          },
        ],
        inCommandZone: ['cmd_red_flexible'],
        taxById: { cmd_red_flexible: 0 },
      },
      opp1: { commanderIds: [], commanderCards: [], inCommandZone: [], taxById: {} },
    };
    (game.state as any).durablePermissions = [
      buildDurableCommandZonePermission({
        playerId,
        cardIds: ['cmd_red_flexible'],
        action: 'cast',
        duration: 'this_turn',
        turnApplied: 11,
        expiresAtTurn: 11,
        sourceName: 'Flexible Command Test',
        spendManaAsThoughAnyType: true,
      }),
    ];

    const sharedCommanderCandidates = getCastableCommanderCandidates({
      state: game.state,
      libraries: (game as any).libraries,
    } as any, playerId as any);
    expect(sharedCommanderCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        commanderId: 'cmd_red_flexible',
        spendManaAsThoughAnyType: true,
        payableCost: expect.objectContaining({
          generic: 1,
          colors: expect.objectContaining({ R: 0 }),
        }),
      }),
    ]));

    registerAIPlayer(gameId, playerId as any);
    vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {},
      reasoning: 'No activated ability available',
      confidence: 1,
    } as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect(
      Object.values((game.state as any).pendingSpellCasts || {}).some((entry: any) =>
        String(entry?.playerId || '') === playerId &&
        String(entry?.cardId || '') === 'cmd_red_flexible' &&
        String(entry?.fromZone || '') === 'command'
      )
    ).toBe(true);
  });
});