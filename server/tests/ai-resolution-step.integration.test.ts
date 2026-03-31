import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';

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

describe('AI resolution-step integration', () => {
  const gameId = 'test_ai_resolution_step_integration';
  const playerId = 'ai1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    unregisterAIPlayer(gameId, playerId as any);
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
});