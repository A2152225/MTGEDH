import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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