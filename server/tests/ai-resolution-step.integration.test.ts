import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializeAIResolutionHandler } from '../src/socket/resolution.js';
import { broadcastGame, ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { cleanupGameAI, handleAIPriority, registerAIPlayer } from '../src/socket/ai.js';

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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('AI resolution-step integration', () => {
  const gameId = 'test_ai_resolution_step_integration';
  const playerId = 'ai1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    cleanupGameAI(gameId);
    await resetGame(gameId);
  });

  afterEach(async () => {
    cleanupGameAI(gameId);
    await resetGame(gameId);
  });

  it('routes active target-selection steps through AI priority handling and chooses the best target', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Combo Opponent', spectator: false, life: 40 },
      { id: 'opp2', name: 'Big Creature Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'scepter',
        controller: 'opp1',
        owner: 'opp1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'c1',
          name: 'Isochron Scepter',
          type_line: 'Artifact',
          oracle_text: 'Imprint — When Isochron Scepter enters the battlefield, you may exile an instant card with mana value 2 or less from your hand.',
        },
      },
      {
        id: 'beater',
        controller: 'opp2',
        owner: 'opp2',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'c2',
          name: 'Ancient Brontodon',
          type_line: 'Creature — Dinosaur',
          oracle_text: '',
          power: '9',
          toughness: '9',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: playerId as any,
      description: 'Choose target permanent.',
      mandatory: true,
      sourceId: 'spell1',
      sourceName: 'Beast Within',
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'target permanent',
      validTargets: [
        { id: 'scepter', label: 'Isochron Scepter' },
        { id: 'beater', label: 'Ancient Brontodon' },
      ],
      spellCastContext: {
        cardId: 'spell1',
        cardName: 'Beast Within',
        manaCost: '{2}{G}',
        playerId,
        effectId: 'effect1',
        oracleText: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
      },
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['scepter']);
  });

  it('auto-resolves AI target-selection steps from the shared resolution queue handler', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Combo Opponent', spectator: false, life: 40 },
        { id: 'opp2', name: 'Big Creature Opponent', spectator: false, life: 40 },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'main';
      (game.state as any).step = 'precombat_main';
      (game.state as any).stack = [];
      (game.state as any).zones = {
        [playerId]: {
          hand: [],
          library: [],
          graveyard: [],
          exile: [],
        },
      };
      (game.state as any).battlefield = [
        {
          id: 'scepter',
          controller: 'opp1',
          owner: 'opp1',
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'c1',
            name: 'Isochron Scepter',
            type_line: 'Artifact',
            oracle_text: 'Imprint — When Isochron Scepter enters the battlefield, you may exile an instant card with mana value 2 or less from your hand.',
          },
        },
        {
          id: 'beater',
          controller: 'opp2',
          owner: 'opp2',
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'c2',
            name: 'Ancient Brontodon',
            type_line: 'Creature — Dinosaur',
            oracle_text: '',
            power: '9',
            toughness: '9',
          },
        },
      ];

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: playerId as any,
        description: 'Choose target permanent.',
        mandatory: true,
        sourceId: 'spell1',
        sourceName: 'Beast Within',
        targetTypes: ['permanent'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'target permanent',
        validTargets: [
          { id: 'scepter', label: 'Isochron Scepter' },
          { id: 'beater', label: 'Ancient Brontodon' },
        ],
        spellCastContext: {
          cardId: 'spell1',
          cardName: 'Beast Within',
          manaCost: '{2}{G}',
          playerId,
          effectId: 'effect1',
          oracleText: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
        },
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual(['scepter']);
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('routes active graveyard-card target-selection steps through AI priority handling and chooses the best reanimation target', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        library: [],
        exile: [],
        graveyard: [
          {
            id: 'solemn_gy',
            name: 'Solemn Simulacrum',
            type_line: 'Artifact Creature — Golem',
            oracle_text: 'When Solemn Simulacrum enters the battlefield, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle. When Solemn Simulacrum dies, you may draw a card.',
            mana_cost: '{4}',
            cmc: 4,
          },
          {
            id: 'bear_gy',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            oracle_text: '',
            mana_cost: '{1}{G}',
            cmc: 2,
          },
        ],
      },
      opp1: {
        hand: [],
        library: [],
        exile: [],
        graveyard: [],
      },
    };
    (game.state as any).battlefield = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: playerId as any,
      description: 'Choose target creature card in your graveyard.',
      mandatory: true,
      sourceId: 'reanimate_spell',
      sourceName: 'Reanimate Lesson',
      targetTypes: ['graveyard_creature_card'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'target creature card in your graveyard',
      validTargets: [
        { id: 'bear_gy', label: 'Grizzly Bears', description: 'graveyard_card' },
        { id: 'solemn_gy', label: 'Solemn Simulacrum', description: 'graveyard_card' },
      ],
      spellCastContext: {
        cardId: 'reanimate_spell',
        cardName: 'Reanimate Lesson',
        manaCost: '{3}{W}',
        playerId,
        effectId: 'effect_reanimate',
        oracleText: 'Return target creature card from your graveyard to the battlefield.',
      },
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['solemn_gy']);
  });

  it('routes active opponent graveyard-selection steps through AI priority handling and exiles the strongest opposing card', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        library: [],
        exile: [],
        graveyard: [],
      },
      opp1: {
        hand: [],
        library: [],
        exile: [],
        graveyard: [
          {
            id: 'opp_tutor_gy',
            name: 'Demonic Tutor',
            type_line: 'Sorcery',
            oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.',
            mana_cost: '{1}{B}',
            cmc: 2,
          },
          {
            id: 'opp_bear_gy',
            name: 'Runeclaw Bear',
            type_line: 'Creature — Bear',
            oracle_text: '',
            mana_cost: '{1}{G}',
            cmc: 2,
          },
        ],
      },
    };
    (game.state as any).battlefield = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.GRAVEYARD_SELECTION,
      playerId: playerId as any,
      description: 'Choose a card to exile from an opponent\'s graveyard.',
      mandatory: true,
      sourceId: 'lantern_effect',
      sourceName: 'Soul-Guide Lantern',
      effectId: 'grave_hate_effect',
      targetPlayerId: 'opp1',
      minTargets: 1,
      maxTargets: 1,
      destination: 'exile',
      validTargets: [
        { id: 'opp_bear_gy', name: 'Runeclaw Bear', typeLine: 'Creature — Bear' },
        { id: 'opp_tutor_gy', name: 'Demonic Tutor', typeLine: 'Sorcery' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['opp_tutor_gy']);
  });

  it('routes active library-search steps through AI priority handling and submits the best card choice', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        library: [],
        exile: [],
        graveyard: [],
      },
      opp1: {
        hand: [],
        library: [],
        exile: [],
        graveyard: [],
      },
    };
    (game.state as any).battlefield = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: playerId as any,
      description: 'Search your library for a card.',
      mandatory: true,
      sourceId: 'tutor_spell',
      sourceName: 'Wishful Tutor',
      searchCriteria: 'a card',
      minSelections: 1,
      maxSelections: 1,
      destination: 'hand',
      reveal: false,
      shuffleAfter: true,
      availableCards: [
        {
          id: 'scepter_lib',
          name: 'Isochron Scepter',
          type_line: 'Artifact',
          oracle_text: 'Imprint — When Isochron Scepter enters the battlefield, you may exile an instant card with mana value 2 or less from your hand.',
          mana_cost: '{2}',
          cmc: 2,
        },
        {
          id: 'bear_lib',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          mana_cost: '{1}{G}',
          cmc: 2,
        },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['scepter_lib']);
  });

  it('routes active player-choice steps through AI priority handling and selects the strongest legal opponent', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent One', spectator: false, life: 40 },
      { id: 'opp2', name: 'Opponent Two', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], library: [], exile: [], graveyard: [] },
      opp1: { hand: [], library: [], exile: [], graveyard: [] },
      opp2: { hand: [], library: [], exile: [], graveyard: [] },
    };
    (game.state as any).battlefield = [
      {
        id: 'combo_piece',
        controller: 'opp2',
        owner: 'opp2',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'combo_piece_card',
          name: 'Isochron Scepter',
          type_line: 'Artifact',
          oracle_text: 'Imprint — When Isochron Scepter enters the battlefield, you may exile an instant card with mana value 2 or less from your hand.',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.PLAYER_CHOICE,
      playerId: playerId as any,
      description: 'Choose an opponent.',
      mandatory: true,
      sourceId: 'humble_1',
      sourceName: 'Humble Defector',
      opponentOnly: true,
      players: [
        { id: 'opp1', name: 'Opponent One', isOpponent: true, isSelf: false },
        { id: 'opp2', name: 'Opponent Two', isOpponent: true, isSelf: false },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['opp2']);
  });

  it('routes active color-choice steps through AI priority handling and submits a legal color', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], library: [], exile: [], graveyard: [] },
    };
    (game.state as any).battlefield = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.COLOR_CHOICE,
      playerId: playerId as any,
      description: 'Choose a color.',
      mandatory: true,
      permanentId: 'gauntlet_1',
      cardName: 'Gauntlet of Power',
      colors: ['blue', 'black'],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['blue']);
  });

  it('routes active creature-type-choice steps through AI priority handling and selects the dominant tribe', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'elf_hand_1',
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            oracle_text: '{T}: Add {G}.',
          },
        ],
        library: [
          {
            id: 'elf_lib_1',
            name: 'Elvish Mystic',
            type_line: 'Creature — Elf Druid',
            oracle_text: '{T}: Add {G}.',
          },
          {
            id: 'elf_lib_2',
            name: 'Elvish Archdruid',
            type_line: 'Creature — Elf Druid',
            oracle_text: 'Other Elf creatures you control get +1/+1.',
          },
          {
            id: 'goblin_lib_1',
            name: 'Goblin Piker',
            type_line: 'Creature — Goblin Warrior',
            oracle_text: '',
          },
        ],
        graveyard: [],
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'elf_battlefield_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'elf_battlefield_card_1',
          name: 'Elvish Visionary',
          type_line: 'Creature — Elf Shaman',
          oracle_text: 'When Elvish Visionary enters, draw a card.',
          power: '1',
          toughness: '1',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.CREATURE_TYPE_CHOICE,
      playerId: playerId as any,
      description: 'Choose a creature type for Cavern of Souls.',
      mandatory: true,
      sourceId: 'cavern_1',
      sourceName: 'Cavern of Souls',
      permanentId: 'cavern_1',
      cardName: 'Cavern of Souls',
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['Elf']);
  });

  it('routes active kynaios-choice steps through AI priority handling and chooses to play a land when available', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
          },
        ],
        handCount: 1,
        library: [],
        graveyard: [],
        exile: [],
      },
    };
    (game.state as any).battlefield = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.KYNAIOS_CHOICE,
      playerId: playerId as any,
      description: 'Kynaios choice',
      mandatory: true,
      landPlayOrFallbackIsController: true,
      landPlayOrFallbackSourceController: playerId,
      landPlayOrFallbackCanPlayLand: true,
      landPlayOrFallbackLandsInHand: [{ id: 'forest_1', name: 'Forest' }],
      landPlayOrFallbackOptions: ['play_land', 'decline'],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({ choice: 'play_land', landCardId: 'forest_1' });
  });

  it('routes active card-name-choice steps through AI priority handling and selects a visible opposing threat from the candidate list', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], library: [], exile: [], graveyard: [] },
      opp1: { hand: [], library: [], exile: [], graveyard: [] },
    };
    (game.state as any).battlefield = [
      {
        id: 'opp_ring',
        controller: 'opp1',
        owner: 'opp1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'sol_ring_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.CARD_NAME_CHOICE,
      playerId: playerId as any,
      description: 'Name a nonland card.',
      mandatory: true,
      sourceId: 'academic_1',
      sourceName: 'Academic Probation',
      spellId: 'academic_stack_1',
      restrictionText: 'nonland card',
      candidateNames: ['Llanowar Elves', 'Sol Ring'],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['Sol Ring']);
  });

  it('routes active opening-hand-actions steps through AI priority handling and keeps all legal opening hand permanents', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'PRE_GAME';
    (game.state as any).step = 'PRE_GAME';
    (game.state as any).startingPlayerId = 'opp1';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'leyline_1',
            name: 'Leyline of Anticipation',
            type_line: 'Enchantment',
            oracle_text: 'If Leyline of Anticipation is in your opening hand, you may begin the game with it on the battlefield.',
          },
          {
            id: 'gemstone_1',
            name: 'Gemstone Caverns',
            type_line: 'Legendary Land',
            oracle_text: "If Gemstone Caverns is in your opening hand and you're not playing first, you may begin the game with it on the battlefield with a luck counter on it.",
          },
          {
            id: 'filler_1',
            name: 'Hill Giant',
            type_line: 'Creature — Giant',
            oracle_text: '',
          },
        ],
        handCount: 3,
        library: [],
        graveyard: [],
        exile: [],
      },
      opp1: { hand: [], library: [], graveyard: [], exile: [] },
    };

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPENING_HAND_ACTIONS,
      playerId: playerId as any,
      description: 'Opening hand actions',
      mandatory: false,
      leylineCount: 2,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['leyline_1', 'gemstone_1']);
  });

  it('routes active upkeep-sacrifice steps through AI priority handling and sacrifices the least valuable creature', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'upkeep';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'commander_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        isCommander: true,
        card: {
          id: 'cmd1',
          name: 'Test Commander',
          type_line: 'Legendary Creature — Angel',
          oracle_text: 'Flying',
          power: '5',
          toughness: '5',
        },
      },
      {
        id: 'mana_dork',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'dork1',
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'soldier_token',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        isToken: true,
        card: {
          id: 'token1',
          name: 'Soldier',
          type_line: 'Token Creature — Soldier',
          oracle_text: '',
          power: '1',
          toughness: '1',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.UPKEEP_SACRIFICE,
      playerId: playerId as any,
      description: 'Sacrifice a creature.',
      mandatory: true,
      sourceId: 'monument_1',
      sourceName: 'Eldrazi Monument',
      creatures: [
        { id: 'commander_1', name: 'Test Commander', power: '5', toughness: '5' },
        { id: 'mana_dork', name: 'Llanowar Elves', power: '1', toughness: '1' },
        { id: 'soldier_token', name: 'Soldier', power: '1', toughness: '1' },
      ],
      sourceToSacrifice: { id: 'monument_1', name: 'Eldrazi Monument' },
      allowSourceSacrifice: true,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({ type: 'creature', creatureId: 'soldier_token' });
  });

  it('routes active return-controlled-permanent steps through AI priority handling and returns the least valuable legal permanent', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'bounce_source',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'bounce_source_card',
          name: 'Simic Growth Chamber',
          type_line: 'Land',
          oracle_text: '{T}: Add {G}{U}.',
        },
      },
      {
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'forest_1_card',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
      {
        id: 'mana_dork',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'mana_dork_card',
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
          power: '1',
          toughness: '1',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE,
      playerId: playerId as any,
      description: 'Return a permanent you control to its owner\'s hand.',
      mandatory: true,
      sourceId: 'bounce_source',
      sourceName: 'Simic Growth Chamber',
      returnControlledPermanentChoice: true,
      returnControlledPermanentSourceName: 'Simic Growth Chamber',
      returnControlledPermanentDestination: 'hand',
      returnControlledPermanentOptions: [
        { permanentId: 'bounce_source', cardName: 'Simic Growth Chamber' },
        { permanentId: 'forest_1', cardName: 'Forest' },
        { permanentId: 'mana_dork', cardName: 'Llanowar Elves' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toBe('mana_dork');
  });

  it('routes active scry steps through AI priority handling and submits a legal keep-top partition', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const cards = [
      {
        id: 'cultivate_1',
        name: 'Cultivate',
        type_line: 'Sorcery',
        oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
        cmc: 3,
      },
      {
        id: 'forest_1',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '',
        cmc: 0,
      },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SCRY,
      playerId: playerId as any,
      description: 'Scry 2',
      mandatory: true,
      scryCount: 2,
      cards,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      keepTopOrder: cards,
      bottomOrder: [],
    });
  });

  it('routes active surveil steps through AI priority handling and sends lands to the graveyard', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const spellCard = {
      id: 'arcane_signet_1',
      name: 'Arcane Signet',
      type_line: 'Artifact',
      oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
      cmc: 2,
    };
    const landCard = {
      id: 'swamp_1',
      name: 'Swamp',
      type_line: 'Basic Land — Swamp',
      oracle_text: '',
      cmc: 0,
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SURVEIL,
      playerId: playerId as any,
      description: 'Surveil 2',
      mandatory: true,
      surveilCount: 2,
      cards: [spellCard, landCard],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      keepTopOrder: [spellCard],
      toGraveyard: [landCard],
    });
  });

  it('routes active bottom-order steps through AI priority handling and submits a full ordering', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const cards = [
      { id: 'bottom_a', name: 'Card A', type_line: 'Sorcery' },
      { id: 'bottom_b', name: 'Card B', type_line: 'Instant' },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.BOTTOM_ORDER,
      playerId: playerId as any,
      description: 'Put these cards on the bottom in any order.',
      mandatory: true,
      cards,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      bottomOrder: cards,
    });
  });

  it('routes active Lim-Dul\'s Vault steps through AI priority handling and keeps the current five-card order', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const cards = [
      { id: 'vault_a', name: 'Card A', type_line: 'Instant' },
      { id: 'vault_b', name: 'Card B', type_line: 'Sorcery' },
      { id: 'vault_c', name: 'Card C', type_line: 'Artifact' },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIM_DULS_VAULT,
      playerId: playerId as any,
      description: 'Choose whether to continue with Lim-Dul\'s Vault.',
      mandatory: true,
      cards,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      action: 'finish',
      orderedIds: ['vault_a', 'vault_b', 'vault_c'],
    });
  });

  it('routes active Dance with Calamity steps through AI priority handling and keeps exiling while only lands are revealed', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DANCE_WITH_CALAMITY,
      playerId: playerId as any,
      description: 'Dance with Calamity reveal step.',
      mandatory: true,
      exiledCards: [
        { id: 'mountain_1', name: 'Mountain', type_line: 'Basic Land — Mountain', cmc: 0 },
      ],
      totalManaValue: 0,
      canContinue: true,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      action: 'continue',
    });
  });

  it('routes active Dance with Calamity cast steps through AI priority handling and orders spells by mana value', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const spellCards = [
      { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'wrath_1', name: 'Wrath of God', type_line: 'Sorcery', cmc: 4 },
      { id: 'signet_1', name: 'Arcane Signet', type_line: 'Artifact', cmc: 2 },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DANCE_WITH_CALAMITY_CAST,
      playerId: playerId as any,
      description: 'Choose the order to cast exiled spells.',
      mandatory: true,
      spellCards,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      orderedSpellIds: ['wrath_1', 'signet_1', 'bolt_1'],
    });
  });

  it('routes active hand-to-bottom steps through AI priority handling and chooses the last cards in hand', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          { id: 'hand_a', name: 'Card A' },
          { id: 'hand_b', name: 'Card B' },
          { id: 'hand_c', name: 'Card C' },
        ],
        library: [],
        graveyard: [],
        exile: [],
      },
    };

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.HAND_TO_BOTTOM,
      playerId: playerId as any,
      description: 'Put two cards from your hand on the bottom of your library.',
      mandatory: true,
      cardsToBottom: 2,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['hand_b', 'hand_c']);
  });

  it('routes active fateseal steps through AI priority handling and submits a legal partition', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const cards = [
      { id: 'fate_a', name: 'Card A' },
      { id: 'fate_b', name: 'Card B' },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.FATESEAL,
      playerId: playerId as any,
      description: 'Fateseal 2',
      mandatory: true,
      opponentId: 'opp1',
      cards,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      keepTopOrder: cards,
      bottomOrder: [],
    });
  });

  it('routes active clash steps through AI priority handling and keeps the revealed card on top', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.CLASH,
      playerId: playerId as any,
      description: 'Choose whether to put the revealed card on the bottom.',
      mandatory: true,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      putOnBottom: false,
    });
  });

  it('routes active vote steps through AI priority handling and selects the first valid option', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.VOTE,
      playerId: playerId as any,
      description: 'Vote for grace or condemnation.',
      mandatory: true,
      choices: ['grace', 'condemnation'],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      choice: 'grace',
      voteCount: 1,
    });
  });

  it('routes active two-pile split steps through AI priority handling and alternates cards between piles', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TWO_PILE_SPLIT,
      playerId: playerId as any,
      description: 'Separate these cards into two piles.',
      mandatory: true,
      items: [
        { id: 'split_a', name: 'Card A' },
        { id: 'split_b', name: 'Card B' },
        { id: 'split_c', name: 'Card C' },
        { id: 'split_d', name: 'Card D' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      pileA: ['split_a', 'split_c'],
      pileB: ['split_b', 'split_d'],
    });
  });

  it('routes active riot-choice steps through AI priority handling and chooses the counter mode', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.RIOT_CHOICE,
      playerId: playerId as any,
      description: 'Riot - choose counter or haste.',
      mandatory: true,
      options: [{ id: 'counter' }, { id: 'haste' }],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['counter']);
  });

  it('routes active unleash-choice steps through AI priority handling and chooses the counter mode', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.UNLEASH_CHOICE,
      playerId: playerId as any,
      description: 'Unleash - choose counter or none.',
      mandatory: false,
      options: [{ id: 'counter' }, { id: 'none' }],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['counter']);
  });

  it('routes active fabricate-choice steps through AI priority handling and prefers tokens for larger fabricate values', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.FABRICATE_CHOICE,
      playerId: playerId as any,
      description: 'Fabricate 2 - choose counters or tokens.',
      mandatory: true,
      value: 2,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['tokens']);
  });

  it('routes active tribute-choice steps through AI priority handling and declines tribute', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TRIBUTE_CHOICE,
      playerId: playerId as any,
      description: 'Choose whether to pay tribute.',
      mandatory: true,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['decline']);
  });

  it('routes active extort-payment steps through AI priority handling and skips the payment', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.EXTORT_PAYMENT,
      playerId: playerId as any,
      description: 'Choose whether to pay for extort.',
      mandatory: false,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['skip']);
  });

  it('routes active generic keyword-choice steps through AI priority handling and selects the first option', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.KEYWORD_CHOICE,
      playerId: playerId as any,
      description: 'Choose a keyword option.',
      mandatory: true,
      options: [{ id: 'alpha' }, { id: 'beta' }],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['alpha']);
  });

  it('routes active exploit-choice steps through AI priority handling and sacrifices the weakest creature', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.EXPLOIT_CHOICE,
      playerId: playerId as any,
      description: 'Choose a creature to exploit.',
      mandatory: false,
      creatures: [
        { id: 'exploit_big', name: 'Big', power: '4', toughness: '4' },
        { id: 'exploit_small', name: 'Small', power: '1', toughness: '1' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['exploit_small']);
  });

  it('routes active backup-choice steps through AI priority handling and prefers the strongest other creature', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.BACKUP_CHOICE,
      playerId: playerId as any,
      description: 'Choose a creature for backup.',
      mandatory: true,
      sourceId: 'backup_source',
      targets: [
        { id: 'backup_source', name: 'Source', power: '3', toughness: '3' },
        { id: 'backup_target_1', name: 'Target 1', power: '2', toughness: '2' },
        { id: 'backup_target_2', name: 'Target 2', power: '5', toughness: '5' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['backup_target_2']);
  });

  it('routes active mentor-target steps through AI priority handling and picks the lowest-power target', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MENTOR_TARGET,
      playerId: playerId as any,
      description: 'Choose a mentor target.',
      mandatory: false,
      targets: [
        { id: 'mentor_small', name: 'Small', power: '1', toughness: '3' },
        { id: 'mentor_big', name: 'Big', power: '3', toughness: '3' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['mentor_small']);
  });

  it('routes active enlist-choice steps through AI priority handling and taps the highest-power creature', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'declare_attackers';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.ENLIST_CHOICE,
      playerId: playerId as any,
      description: 'Choose a creature to enlist.',
      mandatory: false,
      creatures: [
        { id: 'enlist_small', name: 'Small', power: '1', toughness: '4' },
        { id: 'enlist_big', name: 'Big', power: '4', toughness: '4' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['enlist_big']);
  });

  it('routes active modular-choice steps through AI priority handling and chooses the strongest artifact creature', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MODULAR_CHOICE,
      playerId: playerId as any,
      description: 'Choose an artifact creature for modular counters.',
      mandatory: true,
      targets: [
        { id: 'modular_small', name: 'Small', power: '1', toughness: '1' },
        { id: 'modular_big', name: 'Big', power: '4', toughness: '4' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['modular_big']);
  });

  it('routes active soulshift-target steps through AI priority handling and returns the highest mana value spirit', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SOULSHIFT_TARGET,
      playerId: playerId as any,
      description: 'Return a Spirit card from your graveyard.',
      mandatory: false,
      spirits: [
        { id: 'spirit_small', name: 'Small Spirit', cmc: 2 },
        { id: 'spirit_big', name: 'Big Spirit', cmc: 5 },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['spirit_big']);
  });

  it('routes active join-forces steps through AI priority handling and contributes zero mana', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.JOIN_FORCES,
      playerId: playerId as any,
      description: 'Contribute mana to Join Forces.',
      mandatory: false,
      availableMana: 5,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toBe(0);
  });

  it('routes active counter-target steps through AI priority handling and chooses the first valid target', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.COUNTER_TARGET,
      playerId: playerId as any,
      description: 'Choose a target for counters.',
      mandatory: true,
      validTargets: [
        { id: 'counter_first', label: 'First' },
        { id: 'counter_second', label: 'Second' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['counter_first']);
  });

  it('routes active station-creature-selection steps through AI priority handling and chooses the highest-power creature', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.STATION_CREATURE_SELECTION,
      playerId: playerId as any,
      description: 'Choose a creature to station with.',
      mandatory: false,
      creatures: [
        { id: 'station_small', name: 'Small', power: '1', toughness: '4' },
        { id: 'station_big', name: 'Big', power: '4', toughness: '4' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['station_big']);
  });

  it('routes active life-payment steps through AI priority handling and pays the minimum amount', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIFE_PAYMENT,
      playerId: playerId as any,
      description: 'Pay any amount of life.',
      mandatory: true,
      minPayment: 2,
      maxPayment: 7,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toBe(2);
  });

  it('routes active additional-cost-payment steps through AI priority handling and chooses the first legal cards', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
      playerId: playerId as any,
      description: 'Discard two cards as an additional cost.',
      mandatory: true,
      costType: 'discard',
      amount: 2,
      availableCards: [
        { id: 'cost_a', name: 'Card A' },
        { id: 'cost_b', name: 'Card B' },
        { id: 'cost_c', name: 'Card C' },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['cost_a', 'cost_b']);
  });

  it('routes active squad-cost-payment steps through AI priority handling and declines extra squad payments', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.SQUAD_COST_PAYMENT,
      playerId: playerId as any,
      description: 'Choose how many times to pay squad.',
      mandatory: false,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toBe(0);
  });

  it('routes active explore-decision steps through AI priority handling and bins nonlands', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.EXPLORE_DECISION,
      playerId: playerId as any,
      description: 'Choose whether to put the explored card into the graveyard.',
      mandatory: true,
      permanentId: 'explorer_1',
      isLand: false,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      permanentId: 'explorer_1',
      toGraveyard: true,
    });
  });

  it('routes active batch-explore-decision steps through AI priority handling and applies the same land heuristic per explore', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.BATCH_EXPLORE_DECISION,
      playerId: playerId as any,
      description: 'Choose results for multiple explore triggers.',
      mandatory: true,
      explores: [
        { permanentId: 'explore_land', isLand: true },
        { permanentId: 'explore_spell', isLand: false },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      decisions: [
        { permanentId: 'explore_land', toGraveyard: false },
        { permanentId: 'explore_spell', toGraveyard: true },
      ],
    });
  });

  it('routes active tempting-offer steps through AI priority handling and declines the offer', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TEMPTING_OFFER,
      playerId: playerId as any,
      description: 'Do you accept the tempting offer?',
      mandatory: false,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toBe(false);
  });

  it('routes active activated-ability steps through AI priority handling and auto-resolves with an empty payload', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.ACTIVATED_ABILITY,
      playerId: playerId as any,
      description: 'Resolve an activated ability.',
      mandatory: true,
      permanentId: 'perm1',
      abilityType: 'test',
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual([]);
  });

  it('routes active cascade steps through AI priority handling and casts the hit card when present', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.CASCADE,
      playerId: playerId as any,
      description: 'Choose whether to cast the cascade card.',
      mandatory: false,
      hitCard: { id: 'cascade_hit', name: 'Free Spell' },
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toBe(true);
  });

  it('routes active ponder-effect steps through AI priority handling and keeps the current order without shuffling', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const cards = [
      { id: 'ponder_a', name: 'Card A' },
      { id: 'ponder_b', name: 'Card B' },
      { id: 'ponder_c', name: 'Card C' },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.PONDER_EFFECT,
      playerId: playerId as any,
      description: 'Resolve Ponder.',
      mandatory: true,
      cards,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      newOrder: ['ponder_a', 'ponder_b', 'ponder_c'],
      shouldShuffle: false,
    });
  });

  it('routes active devour-selection steps through AI priority handling and declines to sacrifice creatures', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DEVOUR_SELECTION,
      playerId: playerId as any,
      description: 'Choose creatures to devour.',
      mandatory: false,
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual([]);
  });

  it('routes active fight-target steps through AI priority handling and picks the first valid opposing creature', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'fight_source',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'fight_source_card', name: 'Source', type_line: 'Creature — Test', power: '2', toughness: '2' },
      },
      {
        id: 'fight_target',
        controller: 'opp1',
        owner: 'opp1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'fight_target_card', name: 'Target', type_line: 'Creature — Test', power: '3', toughness: '3' },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.FIGHT_TARGET,
      playerId: playerId as any,
      description: 'Choose a creature to fight.',
      mandatory: true,
      sourceId: 'fight_source',
      targetFilter: { controller: 'opponent', excludeSource: true },
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['fight_target']);
  });

  it('routes active tap-untap-target steps through AI priority handling and selects legal targets with the requested action', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'tap_target',
        controller: 'opp1',
        owner: 'opp1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'tap_target_card', name: 'Target', type_line: 'Creature — Test', power: '2', toughness: '2' },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TAP_UNTAP_TARGET,
      playerId: playerId as any,
      description: 'Tap target creature.',
      mandatory: true,
      action: 'tap',
      targetCount: 1,
      targetFilter: { controller: 'opponent', types: ['creature'], tapStatus: 'untapped' },
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      targetIds: ['tap_target'],
      action: 'tap',
    });
  });

  it('routes active counter-movement steps through AI priority handling and moves a legal counter to another permanent', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'counter_source',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: { '+1/+1': 2 },
        card: { id: 'counter_source_card', name: 'Source', type_line: 'Creature — Test', power: '2', toughness: '2' },
      },
      {
        id: 'counter_target_perm',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'counter_target_card', name: 'Target', type_line: 'Creature — Test', power: '1', toughness: '1' },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.COUNTER_MOVEMENT,
      playerId: playerId as any,
      description: 'Move a counter.',
      mandatory: true,
      sourceFilter: { controller: 'you' },
      targetFilter: { controller: 'you', excludeSource: true },
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual({
      sourcePermanentId: 'counter_source',
      targetPermanentId: 'counter_target_perm',
      counterType: '+1/+1',
    });
  });

  it('routes active proliferate steps through AI priority handling and selects beneficial targets', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.PROLIFERATE,
      playerId: playerId as any,
      description: 'Choose permanents and players to proliferate.',
      mandatory: false,
      availableTargets: [
        { id: 'own_perm', controller: playerId, isPlayer: false, counters: { '+1/+1': 1 } },
        { id: 'opp_player', isPlayer: true, counters: { poison: 1 } },
        { id: 'opp_perm', controller: 'opp1', isPlayer: false, counters: { '-1/-1': 1 } },
        { id: 'neutral_perm', controller: playerId, isPlayer: false, counters: {} },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['own_perm', 'opp_player', 'opp_perm']);
  });

  it('routes active mana-payment-choice steps through AI priority handling and uses the existing payment helper', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const solRingCard = {
      id: 'sol_ring_1',
      name: 'Sol Ring',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
      mana_cost: '{1}',
      cmc: 1,
      zone: 'hand',
    };

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, opp1: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'forest_card_1',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ ...solRingCard }],
        handCount: 1,
        library: [],
        graveyard: [],
        exile: [],
      },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).pendingSpellCasts = {
      effect_sol_ring: {
        cardId: 'sol_ring_1',
        cardName: 'Sol Ring',
        manaCost: '{1}',
        playerId,
        validTargetIds: [],
        targets: [],
        card: { ...solRingCard },
      },
    };

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: playerId as any,
      description: 'Pay mana for Sol Ring.',
      mandatory: true,
      sourceId: 'effect_sol_ring',
      sourceName: 'Sol Ring',
      cardId: 'sol_ring_1',
      cardName: 'Sol Ring',
      effectId: 'effect_sol_ring',
      spellPaymentRequired: true,
      manaCost: '{1}',
      totalManaCost: '{1}',
      targets: [],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.cancelled).toBe(false);
    expect(completed?.response?.selections).toEqual({
      payment: [{ permanentId: 'forest_1', mana: 'G', abilityId: 'forest_card_1-ability-0' }],
    });
  });

  it('routes active mutate-target-selection steps through AI priority handling and submits a host choice', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const mutateCard = {
      id: 'mutate_1',
      name: 'Migratory Greathorn',
      type_line: 'Creature — Beast',
      oracle_text: 'Mutate {2}{G}',
      mana_cost: '{3}{G}',
      cmc: 4,
      zone: 'hand',
    };

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, opp1: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'host_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'host_card_1',
          name: 'Essence Symbiote',
          type_line: 'Creature — Beast',
          oracle_text: 'Whenever a creature you control mutates, put a +1/+1 counter on that creature.',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ ...mutateCard }],
        handCount: 1,
        library: [],
        graveyard: [],
        exile: [],
      },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).pendingSpellCasts = {
      effect_mutate_1: {
        cardId: 'mutate_1',
        cardName: 'Migratory Greathorn',
        manaCost: '{2}{G}',
        playerId,
        validTargetIds: ['host_1'],
        targets: [],
        card: { ...mutateCard },
      },
    };

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MUTATE_TARGET_SELECTION,
      playerId: playerId as any,
      description: 'Choose a mutate target.',
      mandatory: true,
      effectId: 'effect_mutate_1',
      cardId: 'mutate_1',
      cardName: 'Migratory Greathorn',
      mutateCost: '{2}{G}',
      validTargets: [
        {
          id: 'host_1',
          name: 'Essence Symbiote',
          typeLine: 'Creature — Beast',
          power: '2',
          toughness: '2',
          controller: playerId,
          owner: playerId,
        },
      ],
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.cancelled).toBe(false);
    expect(completed?.response?.selections).toEqual({ targetPermanentId: 'host_1', onTop: true });
  });

  it('auto-resolves AI mutate target selection from the shared resolution queue handler and queues mutate payment', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      const mutateCard = {
        id: 'mutate_1',
        name: 'Migratory Greathorn',
        type_line: 'Creature — Beast',
        oracle_text: 'Mutate {2}{G}',
        mana_cost: '{3}{G}',
        cmc: 4,
        zone: 'hand',
      };

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
      ];
      (game.state as any).life = { [playerId]: 40, opp1: 40 };
      (game.state as any).turnPlayer = playerId;
      (game.state as any).activePlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'main';
      (game.state as any).step = 'precombat_main';
      (game.state as any).stack = [];
      (game.state as any).battlefield = [
        {
          id: 'host_1',
          controller: playerId,
          owner: playerId,
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'host_card_1',
            name: 'Essence Symbiote',
            type_line: 'Creature — Beast',
            oracle_text: 'Whenever a creature you control mutates, put a +1/+1 counter on that creature.',
            power: '2',
            toughness: '2',
          },
        },
      ];
      (game.state as any).zones = {
        [playerId]: {
          hand: [{ ...mutateCard }],
          handCount: 1,
          library: [],
          graveyard: [],
          exile: [],
        },
        opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      };
      (game.state as any).pendingSpellCasts = {
        effect_mutate_1: {
          cardId: 'mutate_1',
          cardName: 'Migratory Greathorn',
          manaCost: '{2}{G}',
          playerId,
          validTargetIds: ['host_1'],
          targets: [],
          card: { ...mutateCard },
        },
      };

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MUTATE_TARGET_SELECTION,
        playerId: playerId as any,
        description: 'Choose a mutate target.',
        mandatory: true,
        effectId: 'effect_mutate_1',
        cardId: 'mutate_1',
        cardName: 'Migratory Greathorn',
        mutateCost: '{2}{G}',
        validTargets: [
          {
            id: 'host_1',
            name: 'Essence Symbiote',
            typeLine: 'Creature — Beast',
            power: '2',
            toughness: '2',
            controller: playerId,
            owner: playerId,
          },
        ],
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual({ targetPermanentId: 'host_1', onTop: true });

        const pendingCast = (game.state as any).pendingSpellCasts?.effect_mutate_1;
        expect(pendingCast?.mutateTarget).toBe('host_1');
        expect(pendingCast?.mutateOnTop).toBe(true);
        expect(pendingCast?.forcedAlternateCostId).toBe('mutate');

        const paymentStep = queue.steps.find((entry: any) => entry?.type === 'mana_payment_choice');
        expect(paymentStep).toBeDefined();
        expect(paymentStep?.effectId).toBe('effect_mutate_1');
        expect(paymentStep?.manaCost).toBe('{2}{G}');
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI opening hand actions from the shared resolution queue handler and moves legal cards onto the battlefield', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'PRE_GAME';
      (game.state as any).step = 'PRE_GAME';
      (game.state as any).startingPlayerId = 'opp1';
      (game.state as any).stack = [];
      (game.state as any).battlefield = [];
      (game.state as any).zones = {
        [playerId]: {
          hand: [
            {
              id: 'leyline_1',
              name: 'Leyline of Anticipation',
              type_line: 'Enchantment',
              oracle_text: 'If Leyline of Anticipation is in your opening hand, you may begin the game with it on the battlefield.',
            },
            {
              id: 'gemstone_1',
              name: 'Gemstone Caverns',
              type_line: 'Legendary Land',
              oracle_text: "If Gemstone Caverns is in your opening hand and you're not playing first, you may begin the game with it on the battlefield with a luck counter on it.",
            },
            {
              id: 'filler_1',
              name: 'Hill Giant',
              type_line: 'Creature — Giant',
              oracle_text: '',
            },
          ],
          handCount: 3,
          library: [],
          graveyard: [],
          exile: [],
        },
        opp1: { hand: [], library: [], graveyard: [], exile: [] },
      };

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPENING_HAND_ACTIONS,
        playerId: playerId as any,
        description: 'Opening hand actions',
        mandatory: false,
        leylineCount: 2,
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual(['leyline_1', 'gemstone_1']);

        expect((game.state as any).zones?.[playerId]?.hand.map((card: any) => String(card?.id))).toEqual(['filler_1']);
        expect((game.state as any).zones?.[playerId]?.handCount).toBe(1);
        expect(((game.state as any).battlefield || []).map((permanent: any) => String(permanent?.id))).toEqual(['leyline_1', 'gemstone_1']);

        const gemstone = ((game.state as any).battlefield || []).find((permanent: any) => String(permanent?.id) === 'gemstone_1');
        expect(gemstone?.counters).toEqual({ luck: 1 });
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI card-name-choice steps from the shared resolution queue handler and stores the chosen name on the spell', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'main';
      (game.state as any).step = 'precombat_main';
      (game.state as any).zones = {
        [playerId]: { hand: [], library: [], exile: [], graveyard: [] },
        opp1: { hand: [], library: [], exile: [], graveyard: [] },
      };
      (game.state as any).battlefield = [
        {
          id: 'opp_ring',
          controller: 'opp1',
          owner: 'opp1',
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'sol_ring_card',
            name: 'Sol Ring',
            type_line: 'Artifact',
            oracle_text: '{T}: Add {C}{C}.',
          },
        },
      ];
      (game.state as any).stack = [
        {
          id: 'academic_stack_1',
          controller: playerId,
          type: 'spell',
          card: {
            id: 'academic_card_1',
            name: 'Academic Probation',
            type_line: 'Sorcery',
            oracle_text: 'Choose a nonland card name.',
          },
        },
      ];

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.CARD_NAME_CHOICE,
        playerId: playerId as any,
        description: 'Name a nonland card.',
        mandatory: true,
        sourceId: 'academic_1',
        sourceName: 'Academic Probation',
        spellId: 'academic_stack_1',
        restrictionText: 'nonland card',
        candidateNames: ['Llanowar Elves', 'Sol Ring'],
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual(['Sol Ring']);
        expect((game.state as any).stack?.[0]?.chosenCardName).toBe('Sol Ring');
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI gift cast choice from the shared resolution queue handler and resumes the promised-gift cast flow', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
      ];
      (game.state as any).startingLife = 40;
      (game.state as any).life = { [playerId]: 40, opp1: 40 };
      (game.state as any).phase = 'precombatMain';
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).stack = [
        {
          id: 'stack_creature',
          type: 'spell',
          controller: 'opp1',
          card: { id: 'stack_creature_card', name: 'Runeclaw Bear', type_line: 'Creature — Bear', oracle_text: '' },
        },
        {
          id: 'stack_artifact',
          type: 'spell',
          controller: 'opp1',
          card: { id: 'stack_artifact_card', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
        },
      ];
      (game.state as any).zones = {
        [playerId]: {
          hand: [
            {
              id: 'long_river_pull_1',
              name: "Long River's Pull",
              mana_cost: '{U}{U}',
              type_line: 'Instant',
              oracle_text: 'Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nCounter target creature spell. If the gift was promised, instead counter target spell.',
              image_uris: { small: 'https://example.com/long-river-pull.jpg' },
            },
          ],
          handCount: 1,
          exile: [],
          exileCount: 0,
          graveyard: [],
          graveyardCount: 0,
        },
        opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      };

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: playerId as any,
        sourceId: 'long_river_pull_1',
        sourceName: "Long River's Pull",
        description: "Choose whether to promise a gift as you cast Long River's Pull.",
        mandatory: true,
        options: [
          { id: 'gift:none', label: 'Cast without promising a gift' },
          { id: 'gift:opp1', label: 'Promise a card to Opponent' },
        ],
        minSelections: 1,
        maxSelections: 1,
        giftCastChoice: true,
        giftCardId: 'long_river_pull_1',
        giftCardName: "Long River's Pull",
        giftType: 'a card',
        giftFromZone: 'hand',
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual(['gift:opp1']);

        const completedTargetStep = queue.completedSteps.find((entry: any) => entry.type === 'target_selection') as any;
        expect(completedTargetStep).toBeDefined();
        expect((completedTargetStep.validTargets || []).map((entry: any) => String(entry?.id || ''))).toEqual(
          expect.arrayContaining(['stack_creature', 'stack_artifact']),
        );
        expect((completedTargetStep.response?.selections || []).length).toBeGreaterThan(0);
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI spell-cast X selections and continues the cast', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'precombatMain';
      (game.state as any).step = 'MAIN1';
      (game.state as any).stack = [];
      (game.state as any).manaPool = {
        [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      };
      (game.state as any).battlefield = [
        {
          id: 'plains_1',
          controller: playerId,
          owner: playerId,
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'plains_card_1',
            name: 'Plains',
            type_line: 'Basic Land — Plains',
            oracle_text: '{T}: Add {W}.',
          },
        },
        {
          id: 'plains_2',
          controller: playerId,
          owner: playerId,
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'plains_card_2',
            name: 'Plains',
            type_line: 'Basic Land — Plains',
            oracle_text: '{T}: Add {W}.',
          },
        },
      ];
      (game.state as any).zones = {
        [playerId]: {
          hand: [
            {
              id: 'martial_coup_1',
              name: 'Martial Coup',
              mana_cost: '{X}{W}{W}',
              manaCost: '{X}{W}{W}',
              type_line: 'Sorcery',
              oracle_text: 'Create X 1/1 white Soldier creature tokens. If X is 5 or more, destroy all other creatures.',
            },
          ],
          handCount: 1,
          library: [],
          graveyard: [],
          exile: [],
        },
        opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      };

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.X_VALUE_SELECTION,
        playerId: playerId as any,
        description: 'Choose X for Martial Coup.',
        mandatory: true,
        sourceId: 'martial_coup_1',
        sourceName: 'Martial Coup',
        minValue: 0,
        maxValue: 20,
        xCount: 1,
        spellCastXSelection: true,
        spellCardId: 'martial_coup_1',
        spellFromZone: 'hand',
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toBe(0);

        const hand = (((game.state as any).zones?.[playerId]?.hand) || []).map((card: any) => String(card?.id || ''));
        expect(hand).not.toContain('martial_coup_1');

        const stackNames = (((game.state as any).stack) || []).map((entry: any) => String(entry?.card?.name || entry?.sourceName || ''));
        expect(stackNames).toContain('Martial Coup');
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI mode-selection steps from the shared resolution queue handler using the live overload heuristic', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'precombatMain';
      (game.state as any).step = 'MAIN1';
      (game.state as any).stack = [];
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
          id: 'mountain_2',
          controller: playerId,
          owner: playerId,
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'mountain_card_2',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'mountain_3',
          controller: playerId,
          owner: playerId,
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'mountain_card_3',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'mountain_4',
          controller: playerId,
          owner: playerId,
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'mountain_card_4',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'mountain_5',
          controller: playerId,
          owner: playerId,
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'mountain_card_5',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'artifact_1',
          controller: 'opp1',
          owner: 'opp1',
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'artifact_card_1',
            name: 'Sol Ring',
            type_line: 'Artifact',
            oracle_text: '',
          },
        },
        {
          id: 'artifact_2',
          controller: 'opp1',
          owner: 'opp1',
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'artifact_card_2',
            name: 'Arcane Signet',
            type_line: 'Artifact',
            oracle_text: '',
          },
        },
      ];
      (game.state as any).zones = {
        [playerId]: {
          hand: [
            {
              id: 'vandalblast_1',
              name: 'Vandalblast',
              mana_cost: '{R}',
              manaCost: '{R}',
              type_line: 'Sorcery',
              oracle_text: "Destroy target artifact you don't control.\nOverload {4}{R}",
            },
          ],
          handCount: 1,
          library: [],
          graveyard: [],
          exile: [],
        },
        opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      };

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MODE_SELECTION,
        playerId: playerId as any,
        description: 'Choose normal or overload.',
        mandatory: true,
        sourceId: 'vandalblast_1',
        sourceName: 'Vandalblast',
        modes: [
          { id: 'normal', label: 'Normal' },
          { id: 'overload', label: 'Overload' },
        ],
        minModes: 1,
        maxModes: 1,
        allowDuplicates: false,
        modeSelectionPurpose: 'overload',
        castSpellFromHandArgs: {
          cardId: 'vandalblast_1',
          fromZone: 'hand',
        },
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual(['overload']);
        expect(completed?.response?.cancelled).toBe(false);
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI player-choice steps from the shared resolution queue handler using the live threat heuristic', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Opponent One', spectator: false, life: 40 },
        { id: 'opp2', name: 'Opponent Two', spectator: false, life: 40 },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'main';
      (game.state as any).step = 'precombat_main';
      (game.state as any).stack = [];
      (game.state as any).zones = {
        [playerId]: { hand: [], library: [], exile: [], graveyard: [] },
        opp1: { hand: [], library: [], exile: [], graveyard: [] },
        opp2: { hand: [], library: [], exile: [], graveyard: [] },
      };
      (game.state as any).battlefield = [
        {
          id: 'combo_piece',
          controller: 'opp2',
          owner: 'opp2',
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'combo_piece_card',
            name: 'Isochron Scepter',
            type_line: 'Artifact',
            oracle_text: 'Imprint — When Isochron Scepter enters the battlefield, you may exile an instant card with mana value 2 or less from your hand.',
          },
        },
      ];

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId: playerId as any,
        description: 'Choose an opponent.',
        mandatory: true,
        sourceId: 'humble_1',
        sourceName: 'Humble Defector',
        opponentOnly: true,
        players: [
          { id: 'opp1', name: 'Opponent One', isOpponent: true, isSelf: false },
          { id: 'opp2', name: 'Opponent Two', isOpponent: true, isSelf: false },
        ],
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual(['opp2']);
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI color-choice steps from the shared resolution queue handler using the live mana heuristic', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'main';
      (game.state as any).step = 'precombat_main';
      (game.state as any).stack = [];
      (game.state as any).manaPool = {
        [playerId]: { white: 0, blue: 0, black: 2, red: 0, green: 0, colorless: 0 },
      };
      (game.state as any).zones = {
        [playerId]: { hand: [], library: [], exile: [], graveyard: [] },
      };
      (game.state as any).battlefield = [];

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.COLOR_CHOICE,
        playerId: playerId as any,
        description: 'Choose a color.',
        mandatory: true,
        permanentId: 'gauntlet_1',
        cardName: 'Gauntlet of Power',
        colors: ['blue', 'black'],
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual(['blue']);
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI creature-type-choice steps from the shared resolution queue handler using the live tribe heuristic', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'main';
      (game.state as any).step = 'precombat_main';
      (game.state as any).stack = [];
      (game.state as any).zones = {
        [playerId]: {
          hand: [
            {
              id: 'elf_hand_1',
              name: 'Llanowar Elves',
              type_line: 'Creature — Elf Druid',
              oracle_text: '{T}: Add {G}.',
            },
          ],
          library: [
            {
              id: 'elf_lib_1',
              name: 'Elvish Mystic',
              type_line: 'Creature — Elf Druid',
              oracle_text: '{T}: Add {G}.',
            },
            {
              id: 'elf_lib_2',
              name: 'Elvish Archdruid',
              type_line: 'Creature — Elf Druid',
              oracle_text: 'Other Elf creatures you control get +1/+1.',
            },
            {
              id: 'goblin_lib_1',
              name: 'Goblin Piker',
              type_line: 'Creature — Goblin Warrior',
              oracle_text: '',
            },
          ],
          graveyard: [],
          exile: [],
        },
      };
      (game.state as any).battlefield = [
        {
          id: 'elf_battlefield_1',
          controller: playerId,
          owner: playerId,
          tapped: false,
          summoningSickness: false,
          counters: {},
          card: {
            id: 'elf_battlefield_card_1',
            name: 'Elvish Visionary',
            type_line: 'Creature — Elf Shaman',
            oracle_text: 'When Elvish Visionary enters, draw a card.',
            power: '1',
            toughness: '1',
          },
        },
      ];

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.CREATURE_TYPE_CHOICE,
        playerId: playerId as any,
        description: 'Choose a creature type for Cavern of Souls.',
        mandatory: true,
        sourceId: 'cavern_1',
        sourceName: 'Cavern of Souls',
        permanentId: 'cavern_1',
        cardName: 'Cavern of Souls',
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual(['Elf']);
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI kynaios-choice steps from the shared resolution queue handler and plays the available land', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      ];
      (game.state as any).startingLife = 40;
      (game.state as any).life = { [playerId]: 40 };
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'main';
      (game.state as any).step = 'precombat_main';
      (game.state as any).stack = [];
      (game.state as any).zones = {
        [playerId]: {
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
          hand: [
            {
              id: 'forest_1',
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '{T}: Add {G}.',
            },
          ],
          handCount: 1,
          library: [],
          libraryCount: 0,
        },
      };
      (game.state as any).battlefield = [];

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.KYNAIOS_CHOICE,
        playerId: playerId as any,
        description: 'Kynaios choice',
        mandatory: true,
        kynaiosBatchId: 'batch_kynaios_shared_ai',
        landPlayOrFallbackIsController: true,
        landPlayOrFallbackSourceController: playerId,
        landPlayOrFallbackCanPlayLand: true,
        landPlayOrFallbackLandsInHand: [{ id: 'forest_1', name: 'Forest' }],
        landPlayOrFallbackOptions: ['play_land', 'decline'],
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual({ choice: 'play_land', landCardId: 'forest_1' });

        const handIds = (((game.state as any).zones?.[playerId]?.hand) || []).map((card: any) => String(card?.id || ''));
        expect(handIds).not.toContain('forest_1');

        const battlefieldNames = (((game.state as any).battlefield) || []).map((perm: any) => String(perm?.card?.name || ''));
        expect(battlefieldNames).toContain('Forest');
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('auto-resolves AI trigger-order steps from the shared resolution queue handler', async () => {
    const io = createNoopIo();
    const aiHandler = initializeAIResolutionHandler(io as any);

    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'beginning';
      (game.state as any).step = 'upkeep';
      (game.state as any).stack = [
        { id: 'trigger_1', type: 'triggered_ability', controller: playerId },
        { id: 'trigger_2', type: 'triggered_ability', controller: playerId },
      ];

      const step = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TRIGGER_ORDER,
        playerId: playerId as any,
        description: 'Order triggers',
        mandatory: true,
        triggers: [
          { id: 'trigger_1', sourceName: 'First Trigger', effect: 'a' },
          { id: 'trigger_2', sourceName: 'Second Trigger', effect: 'b' },
        ],
        requireAll: true,
      } as any);

      await vi.waitFor(() => {
        const queue = ResolutionQueueManager.getQueue(gameId);
        expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);

        const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
        expect(completed?.response?.selections).toEqual(['trigger_1', 'trigger_2']);

        const stackIds = ((game.state as any).stack || []).map((entry: any) => String(entry?.id || ''));
        expect(stackIds).toEqual(['trigger_2', 'trigger_1']);
      });
    } finally {
      ResolutionQueueManager.off(aiHandler);
    }
  });

  it('advances out of untap instead of passing priority repeatedly', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).battlefield = [];

    registerAIPlayer(gameId, playerId as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect(String((game.state as any).step || '').toUpperCase()).toBe('UPKEEP');
    expect(String((game.state as any).phase || '').toLowerCase()).toBe('beginning');
  });

  it('deduplicates repeated broadcast-triggered AI untap handling', async () => {
    vi.useFakeTimers();
    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
        { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).activePlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).phase = 'beginning';
      (game.state as any).step = 'UNTAP';
      (game.state as any).stack = [];
      (game.state as any).zones = {
        [playerId]: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
        opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      };
      (game.state as any).battlefield = [];

      registerAIPlayer(gameId, playerId as any);

      const io = createNoopIo();
      broadcastGame(io, game, gameId);
      broadcastGame(io, game, gameId);
      broadcastGame(io, game, gameId);

      // One broadcast-triggered AI reaction plus the scheduled priority handoff.
      await vi.advanceTimersByTimeAsync(600);

      expect(String((game.state as any).step || '').toUpperCase()).toBe('UPKEEP');
      expect(String((game.state as any).phase || '').toLowerCase()).toBe('beginning');
      expect((game.state as any).priority).toBe('opp1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes priority instead of retrying a stale duplicate land already on the battlefield', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const duplicateLand = {
      id: 'dup_land_card',
      name: 'Myriad Landscape',
      type_line: 'Land',
      oracle_text: 'Myriad Landscape enters the battlefield tapped.\n{T}: Add {C}.',
    };

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombatmain';
    (game.state as any).step = 'main1';
    (game.state as any).stack = [];
    (game.state as any).landsPlayedThisTurn = {};
    (game.state as any).zones = {
      [playerId]: { hand: [duplicateLand], handCount: 1, library: [], graveyard: [], exile: [] },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_dup_land',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { ...duplicateLand },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect((game.state as any).priority).toBe('opp1');
    expect((game.state as any).battlefield).toHaveLength(1);
  });

  it('deduplicates repeated broadcast-triggered human auto-pass scheduling', async () => {
    vi.useFakeTimers();
    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: 'human1', name: 'Human 1', spectator: false, life: 40, isAI: false },
        { id: 'human2', name: 'Human 2', spectator: false, life: 40, isAI: false },
      ];
      (game.state as any).turnPlayer = 'human1';
      (game.state as any).activePlayer = 'human1';
      (game.state as any).priority = 'human1';
      (game.state as any).phase = 'beginning';
      (game.state as any).step = 'UPKEEP';
      (game.state as any).stack = [];
      (game.state as any).battlefield = [];
      (game.state as any).autoPassPlayers = new Set(['human1']);
      (game.state as any).zones = {
        human1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
        human2: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      };

      const io = createNoopIo();
      const timeoutSpy = vi.spyOn(global, 'setTimeout');
      try {
        broadcastGame(io, game, gameId);
        broadcastGame(io, game, gameId);
        broadcastGame(io, game, gameId);

        const autoPassTimeouts = timeoutSpy.mock.calls.filter((call) => call[1] === 150);
        expect(autoPassTimeouts).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(200);
        expect((game.state as any).priority).toBe('human2');
      } finally {
        timeoutSpy.mockRestore();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-pass a human defender who can flash in a blocker after attackers are declared', async () => {
    vi.useFakeTimers();
    try {
      createGameIfNotExists(gameId, 'commander', 40);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'Attacking AI', spectator: false, life: 40, isAI: true },
        { id: 'human_def', name: 'Human Defender', spectator: false, life: 40, isAI: false },
      ];
      (game.state as any).turnPlayer = playerId;
      (game.state as any).activePlayer = playerId;
      (game.state as any).priority = 'human_def';
      (game.state as any).phase = 'combat';
      (game.state as any).step = 'DECLARE_ATTACKERS';
      (game.state as any).stack = [];
      (game.state as any).battlefield = [
        {
          id: 'attacker_1',
          controller: playerId,
          owner: playerId,
          tapped: true,
          summoningSickness: false,
          attacking: 'human_def',
          counters: {},
          card: {
            id: 'attacker_card_1',
            name: 'Goblin Raider',
            type_line: 'Creature — Goblin Warrior',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        },
      ];
      (game.state as any).autoPassPlayers = new Set(['human_def']);
      (game.state as any).zones = {
        [playerId]: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
        human_def: {
          hand: [
            {
              id: 'flash_blocker',
              name: 'Ambush Viper',
              type_line: 'Creature — Snake',
              mana_cost: '{1}{G}',
              oracle_text: 'Flash\nDeathtouch',
            },
          ],
          handCount: 1,
          library: [],
          graveyard: [],
          exile: [],
        },
      };
      (game.state as any).manaPool = {
        [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        human_def: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      };

      const io = createNoopIo();
      broadcastGame(io, game, gameId);

      await vi.advanceTimersByTimeAsync(200);

      expect((game.state as any).priority).toBe('human_def');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let the attacking AI declare blockers for itself', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'Attacking AI', spectator: false, life: 40, isAI: true },
      { id: 'def_ai', name: 'Defending AI', spectator: false, life: 40, isAI: true },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_BLOCKERS';
    (game.state as any).stack = [];
    (game.state as any).blockersDeclaredBy = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      def_ai: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        attacking: 'def_ai',
        counters: {},
        card: {
          id: 'attacker_card_1',
          name: 'Goblin Raider',
          type_line: 'Creature — Goblin Warrior',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);
    registerAIPlayer(gameId, 'def_ai' as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect(((game.state as any).blockersDeclaredBy || [])).not.toContain(playerId);

    (game.state as any).priority = 'def_ai';
    await handleAIPriority(createNoopIo(), gameId, 'def_ai' as any);

    expect(((game.state as any).blockersDeclaredBy || [])).not.toContain(playerId);
    expect(String((game.state as any).step || '').toUpperCase()).not.toBe('DECLARE_BLOCKERS');
  });

  it('does not wait on a human defender with no blockers during declare blockers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'Attacking AI', spectator: false, life: 40, isAI: true },
      { id: 'human_def', name: 'Human Defender', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_BLOCKERS';
    (game.state as any).stack = [];
    (game.state as any).blockersDeclaredBy = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      human_def: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        attacking: 'human_def',
        counters: {},
        card: {
          id: 'attacker_card_1',
          name: 'Goblin Raider',
          type_line: 'Creature — Goblin Warrior',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect(
      String((game.state as any).step || '').toUpperCase() !== 'DECLARE_BLOCKERS' ||
        (game.state as any).priority === 'human_def',
    ).toBe(true);
  });

  it('passes priority when an AI defender still needs to declare blockers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'Attacking AI', spectator: false, life: 40, isAI: true },
      { id: 'def_ai', name: 'Defending AI', spectator: false, life: 40, isAI: true },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_BLOCKERS';
    (game.state as any).stack = [];
    (game.state as any).blockersDeclaredBy = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      def_ai: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        attacking: 'def_ai',
        counters: {},
        card: {
          id: 'attacker_card_1',
          name: 'Goblin Raider',
          type_line: 'Creature — Goblin Warrior',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'blocker_1',
        controller: 'def_ai',
        owner: 'def_ai',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'blocker_card_1',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);
    registerAIPlayer(gameId, 'def_ai' as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect((game.state as any).priority).toBe('def_ai');
  });

  it('advances out of declare attackers when the AI chooses no attackers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'Attacking AI', spectator: false, life: 40, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_ATTACKERS';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).battlefield = [];

    registerAIPlayer(gameId, playerId as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect(String((game.state as any).step || '').toUpperCase()).not.toBe('DECLARE_ATTACKERS');
    expect((game.state as any).attackedPlayersThisTurnByPlayer?.[playerId] || []).toEqual([]);
  });

  it('does not synchronously chain multiple step advances after one AI auto-pass', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).autoPassPlayers = new Set([playerId, 'opp1']);
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, library: [{ id: 'draw1', name: 'Draw Step Card' }], graveyard: [], exile: [] },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };

    registerAIPlayer(gameId, playerId as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect(String((game.state as any).phase || '').toLowerCase()).toBe('beginning');
    expect(String((game.state as any).step || '').toUpperCase()).toBe('DRAW');
  });

  it('routes active option-choice steps through AI priority handling and submits the chosen option', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
        graveyard: [],
        exile: [],
      },
    };

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as any,
      description: 'You may draw a card.',
      mandatory: true,
      sourceId: 'may1',
      sourceName: 'Test Source',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
      minSelections: 1,
      maxSelections: 1,
      mayAbilityPrompt: true,
      effectText: 'draw a card',
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['no']);
    expect(completed?.response?.cancelled).toBe(true);
  });

  it('routes active gift cast option-choice steps through AI priority handling and promises the gift to an opponent', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'long_river_pull_1',
            name: "Long River's Pull",
            mana_cost: '{U}{U}',
            type_line: 'Instant',
            oracle_text: 'Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nCounter target creature spell. If the gift was promised, instead counter target spell.',
          },
        ],
        library: [],
        graveyard: [],
        exile: [],
      },
      opp1: { hand: [], library: [], graveyard: [], exile: [] },
    };

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as any,
      description: "Choose whether to promise a gift as you cast Long River's Pull.",
      mandatory: true,
      sourceId: 'long_river_pull_1',
      sourceName: "Long River's Pull",
      options: [
        { id: 'gift:none', label: 'Cast without promising a gift' },
        { id: 'gift:opp1', label: 'Promise a card to Opponent' },
      ],
      minSelections: 1,
      maxSelections: 1,
      giftCastChoice: true,
      giftCardId: 'long_river_pull_1',
      giftCardName: "Long River's Pull",
      giftType: 'a card',
      giftFromZone: 'hand',
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['gift:opp1']);
    expect(completed?.response?.cancelled).toBe(false);
  });

  it('plays shock lands through the shared option-choice flow instead of pre-paying life inline', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 18, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 18, opp1: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'hallowed_fountain_1',
            name: 'Hallowed Fountain',
            type_line: 'Land — Plains Island',
            oracle_text: '({T}: Add {W} or {U}.)\nAs Hallowed Fountain enters, you may pay 2 life. If you don\'t, it enters tapped.',
            zone: 'hand',
            image_uris: { small: 'hf.jpg' },
          },
        ],
        handCount: 1,
        library: [],
        graveyard: [],
        exile: [],
      },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };

    registerAIPlayer(gameId, playerId as any);

    const timeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), gameId, playerId as any);
    } finally {
      timeoutSpy.mockRestore();
    }

    const queue = ResolutionQueueManager.getQueue(gameId);
    const shockChoiceStep = queue.steps.find((entry: any) => (entry as any).shockLandChoice === true) as any;
    expect(shockChoiceStep).toBeDefined();
    expect((game.state as any).life?.[playerId]).toBe(18);

    const permanent = ((game.state as any).battlefield || []).find((entry: any) => entry.card?.id === 'hallowed_fountain_1');
    expect(permanent).toBeDefined();
  });

  it('starts spell casting through the shared requestCastSpell flow', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, opp1: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).landsPlayedThisTurn = { [playerId]: 1 };
    (game.state as any).manaPool = { [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
    (game.state as any).battlefield = [
      {
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'forest_card_1', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
      },
      {
        id: 'forest_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'forest_card_2', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
      },
      {
        id: 'forest_3',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'forest_card_3', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
      },
      {
        id: 'target_artifact',
        controller: 'opp1',
        owner: 'opp1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: { id: 'target_artifact_card', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'beast_within_1',
            name: 'Beast Within',
            type_line: 'Instant',
            oracle_text: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
            mana_cost: '{2}{G}',
            zone: 'hand',
            image_uris: { small: 'beast_within.jpg' },
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
        graveyard: [],
        exile: [],
      },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };

    registerAIPlayer(gameId, playerId as any);

    const timeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), gameId, playerId as any);
    } finally {
      timeoutSpy.mockRestore();
    }

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetSelectionStep = queue.steps.find((entry: any) => String((entry as any).type || '').toLowerCase() === 'target_selection') as any;
    expect(targetSelectionStep).toBeDefined();
    expect(String(targetSelectionStep?.sourceName || '')).toBe('Beast Within');
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('routes active mode-selection steps through AI priority handling and submits the chosen mode', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
      },
    };
    (game.state as any).battlefield = [
      { controller: playerId, card: { type_line: 'Basic Land — Forest' } },
      { controller: playerId, card: { type_line: 'Basic Land — Island' } },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MODE_SELECTION,
      playerId: playerId as any,
      description: 'Choose land or nonland.',
      mandatory: true,
      sourceId: 'harvest1',
      sourceName: 'Abundant Harvest',
      modes: [
        { id: 'land', label: 'Land' },
        { id: 'nonland', label: 'Nonland' },
      ],
      minModes: 1,
      maxModes: 1,
      allowDuplicates: false,
      modeSelectionPurpose: 'abundantChoice',
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['land']);
  });

  it('routes active modal-choice steps through AI priority handling and uses modal-specific heuristics', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'commander_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        isCommander: true,
        card: {
          id: 'cmd1',
          name: 'Test Commander',
          type_line: 'Legendary Creature — Soldier',
          oracle_text: '',
          power: '6',
          toughness: '6',
          keywords: [],
        },
      },
    ];

    registerAIPlayer(gameId, playerId as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MODAL_CHOICE,
      playerId: playerId as any,
      description: 'Choose a counter type to put on Test Commander.',
      mandatory: true,
      sourceId: 'ability1',
      sourceName: 'Elspeth Resplendent',
      options: [
        { id: 'vigilance', label: 'Vigilance' },
        { id: 'reach', label: 'Reach' },
        { id: 'trample', label: 'Trample' },
      ],
      minSelections: 1,
      maxSelections: 1,
      keywordCounterChoiceData: {
        targetPermanentId: 'commander_1',
        targetName: 'Test Commander',
        allowedKeywords: ['vigilance', 'reach', 'trample'],
      },
    } as any);

    ResolutionQueueManager.activateStep(gameId, step.id);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    const completed = queue.completedSteps.find((entry: any) => String(entry.id) === String(step.id));
    expect(completed?.response?.selections).toEqual(['trample']);
  });

  it('auto-resolves AI spell payment and completes the cast server-side', async () => {
    const io = createNoopIo();
    initializeAIResolutionHandler(io as any);

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const solRingCard = {
      id: 'sol_ring_1',
      name: 'Sol Ring',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
      mana_cost: '{1}',
      cmc: 1,
      zone: 'hand',
    };

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, opp1: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'forest_card_1',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ ...solRingCard }],
        handCount: 1,
        library: [],
        graveyard: [],
        exile: [],
      },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).pendingSpellCasts = {
      effect_sol_ring: {
        cardId: 'sol_ring_1',
        cardName: 'Sol Ring',
        manaCost: '{1}',
        playerId,
        validTargetIds: [],
        targets: [],
        card: { ...solRingCard },
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: playerId as any,
      description: 'Pay mana for Sol Ring.',
      mandatory: true,
      sourceId: 'effect_sol_ring',
      sourceName: 'Sol Ring',
      cardId: 'sol_ring_1',
      cardName: 'Sol Ring',
      effectId: 'effect_sol_ring',
      spellPaymentRequired: true,
      manaCost: '{1}',
      totalManaCost: '{1}',
      targets: [],
    } as any);

    await vi.waitFor(() => {
      const hand = (game.state as any).zones?.[playerId]?.hand || [];
      const stack = (game.state as any).stack || [];
      const forest = ((game.state as any).battlefield || []).find((entry: any) => String(entry.id) === 'forest_1');

      expect(hand.some((card: any) => String(card?.id || '') === 'sol_ring_1')).toBe(false);
      expect(stack.some((entry: any) => String(entry?.card?.name || '') === 'Sol Ring')).toBe(true);
      expect(forest?.tapped).toBe(true);
      expect((game.state as any).pendingSpellCasts?.effect_sol_ring).toBeUndefined();
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const completed = queue.completedSteps.find((entry: any) => String(entry?.sourceId || '') === 'effect_sol_ring');
    expect(completed?.response?.cancelled).toBe(false);
    expect(completed?.response?.selections).toEqual({
      payment: [{ permanentId: 'forest_1', mana: 'G', abilityId: 'forest_card_1-ability-0' }],
    });
  });

  it('uses the selected payment abilityId when duplicate-color mana abilities have different costs', async () => {
    const io = createNoopIo();
    initializeAIResolutionHandler(io as any);

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const ponderCard = {
      id: 'ponder_1',
      name: 'Ponder',
      type_line: 'Sorcery',
      oracle_text: 'Look at the top three cards of your library, then put them back in any order. You may shuffle your library. Draw a card.',
      mana_cost: '{U}',
      cmc: 1,
      zone: 'hand',
    };

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, opp1: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'prism_cache_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'prism_cache_card_1',
          name: 'Prism Cache',
          type_line: 'Artifact',
          oracle_text: 'Sacrifice Prism Cache: Add {U} or {B}.\n{T}: Add {U}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ ...ponderCard }],
        handCount: 1,
        library: [],
        graveyard: [],
        exile: [],
      },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).pendingSpellCasts = {
      effect_ponder: {
        cardId: 'ponder_1',
        cardName: 'Ponder',
        manaCost: '{U}',
        playerId,
        validTargetIds: [],
        targets: [],
        card: { ...ponderCard },
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: playerId as any,
      description: 'Pay mana for Ponder.',
      mandatory: true,
      sourceId: 'effect_ponder',
      sourceName: 'Ponder',
      cardId: 'ponder_1',
      cardName: 'Ponder',
      effectId: 'effect_ponder',
      spellPaymentRequired: true,
      manaCost: '{U}',
      totalManaCost: '{U}',
      targets: [],
    } as any);

    await vi.waitFor(() => {
      const hand = (game.state as any).zones?.[playerId]?.hand || [];
      const stack = (game.state as any).stack || [];
      const battlefield = (game.state as any).battlefield || [];
      const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
      const prismCache = battlefield.find((entry: any) => String(entry.id) === 'prism_cache_1');

      expect(hand.some((card: any) => String(card?.id || '') === 'ponder_1')).toBe(false);
      expect(stack.some((entry: any) => String(entry?.card?.name || '') === 'Ponder')).toBe(true);
      expect(prismCache).toBeTruthy();
      expect(prismCache?.tapped).toBe(true);
      expect(graveyard.some((card: any) => String(card?.name || '') === 'Prism Cache')).toBe(false);
      expect((game.state as any).life?.[playerId]).toBe(40);
      expect((game.state as any).pendingSpellCasts?.effect_ponder).toBeUndefined();
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const completed = queue.completedSteps.find((entry: any) => String(entry?.sourceId || '') === 'effect_ponder');
    expect(completed?.response?.cancelled).toBe(false);
    expect(completed?.response?.selections).toEqual({
      payment: [{ permanentId: 'prism_cache_1', mana: 'U', abilityId: 'prism_cache_card_1-ability-1' }],
    });
  });

  it('preserves excess mana when the selected payment ability line produces more than the spell spends', async () => {
    const io = createNoopIo();
    initializeAIResolutionHandler(io as any);

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const ponderCard = {
      id: 'ponder_1',
      name: 'Ponder',
      type_line: 'Sorcery',
      oracle_text: 'Look at the top three cards of your library, then put them back in any order. You may shuffle your library. Draw a card.',
      mana_cost: '{U}',
      cmc: 1,
      zone: 'hand',
    };

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40, isAI: true },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, opp1: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'azure_dynamo_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'azure_dynamo_card_1',
          name: 'Azure Dynamo',
          type_line: 'Artifact',
          oracle_text: 'Sacrifice this artifact: Add {U}.\n{T}: Add {U}{U}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ ...ponderCard }],
        handCount: 1,
        library: [],
        graveyard: [],
        exile: [],
      },
      opp1: { hand: [], handCount: 0, library: [], graveyard: [], exile: [] },
    };
    (game.state as any).pendingSpellCasts = {
      effect_ponder: {
        cardId: 'ponder_1',
        cardName: 'Ponder',
        manaCost: '{U}',
        playerId,
        validTargetIds: [],
        targets: [],
        card: { ...ponderCard },
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: playerId as any,
      description: 'Pay mana for Ponder.',
      mandatory: true,
      sourceId: 'effect_ponder',
      sourceName: 'Ponder',
      cardId: 'ponder_1',
      cardName: 'Ponder',
      effectId: 'effect_ponder',
      spellPaymentRequired: true,
      manaCost: '{U}',
      totalManaCost: '{U}',
      targets: [],
    } as any);

    await vi.waitFor(() => {
      const hand = (game.state as any).zones?.[playerId]?.hand || [];
      const stack = (game.state as any).stack || [];
      const battlefield = (game.state as any).battlefield || [];
      const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
      const azureDynamo = battlefield.find((entry: any) => String(entry.id) === 'azure_dynamo_1');

      expect(hand.some((card: any) => String(card?.id || '') === 'ponder_1')).toBe(false);
      expect(stack.some((entry: any) => String(entry?.card?.name || '') === 'Ponder')).toBe(true);
      expect(azureDynamo).toBeTruthy();
      expect(azureDynamo?.tapped).toBe(true);
      expect(graveyard.some((card: any) => String(card?.name || '') === 'Azure Dynamo')).toBe(false);
      expect((game.state as any).manaPool?.[playerId]?.blue).toBe(1);
      expect((game.state as any).pendingSpellCasts?.effect_ponder).toBeUndefined();
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const completed = queue.completedSteps.find((entry: any) => String(entry?.sourceId || '') === 'effect_ponder');
    expect(completed?.response?.cancelled).toBe(false);
    expect(completed?.response?.selections).toEqual({
      payment: [{ permanentId: 'azure_dynamo_1', mana: 'U', count: 1, abilityId: 'azure_dynamo_card_1-ability-1' }],
    });
  });
});