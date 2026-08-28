import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRIORITY_TIMEOUT_MS, games } from '../src/socket/socket.js';
import {
  checkAndTriggerAutoPass,
  clearPriorityTimer,
  schedulePriorityTimeout,
} from '../src/socket/util.js';
import { createContext } from '../src/state/context.js';
import { passPriority } from '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const AUTO_PASS_DELAY_MS = 150;

function createHarness(gameId: string, overrides: Record<string, unknown> = {}) {
  const ctx = createContext(gameId);
  Object.assign(ctx.state as any, {
    active: true,
    phase: 'precombatMain',
    step: 'MAIN1',
    turnDirection: 1,
    turnPlayer: 'p_opp',
    priority: 'p_human',
    players: [
      { id: 'p_opp', seat: 1, name: 'Opp', isAI: true },
      { id: 'p_human', seat: 2, name: 'Human', isAI: false },
    ],
    stack: [
      {
        id: 'murder_on_stack',
        type: 'spell',
        controller: 'p_opp',
        card: {
          id: 'murder_card',
          name: 'Murder',
          type_line: 'Instant',
          mana_cost: '{1}{B}{B}',
          oracle_text: 'Destroy target creature.',
        },
      },
    ],
    zones: {
      p_opp: { hand: [], graveyard: [], library: [] },
      p_human: {
        hand: [
          {
            id: 'rift_1',
            name: 'Cyclonic Rift',
            type_line: 'Instant',
            mana_cost: '{1}{U}',
            oracle_text:
              'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U}',
          },
        ],
        graveyard: [],
        library: [],
      },
    },
    battlefield: [
      {
        id: 'neera_1',
        controller: 'p_opp',
        card: {
          id: 'neera_card',
          name: 'Neera, Wild Mage',
          type_line: 'Legendary Creature — Human Wizard',
          oracle_text: '',
          power: '2',
          toughness: '7',
        },
      },
    ],
    manaPool: {
      p_opp: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p_human: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 1 },
    },
    priorityPassedBy: new Set(['p_opp']),
    autoPassPlayers: new Set(['p_human']),
    priorityClaimed: new Set<string>(),
    ...overrides,
  });

  const resolveTopOfStack = vi.fn(() => {
    (ctx.state.stack as any[]).pop();
  });
  const passPrioritySpy = vi.fn((playerId: string, isAutoPass?: boolean) =>
    passPriority(ctx, playerId as any, isAutoPass)
  );

  const game: any = {
    gameId,
    state: ctx.state,
    inactive: ctx.inactive,
    passesInRow: ctx.passesInRow,
    libraries: ctx.libraries,
    life: ctx.life,
    commandZone: ctx.commandZone,
    manaPool: ctx.manaPool,
    get seq() {
      return ctx.seq.value;
    },
    set seq(value: number) {
      ctx.seq.value = value;
    },
    bumpSeq: ctx.bumpSeq,
    participants: () => [],
    viewFor: () => ctx.state,
    passPriority: passPrioritySpy,
    resolveTopOfStack,
  };

  const emit = vi.fn();
  const io: any = {
    to: vi.fn(() => ({ emit })),
  };

  return { ctx, game, io, resolveTopOfStack, passPrioritySpy };
}

describe('Smart Pass own-stack bypass', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const id of [
      'smart_pass_opp_spell',
      'smart_pass_own_spell',
      'smart_pass_own_spell_pending_choice',
      'smart_pass_rest_of_turn',
      'smart_pass_timeout_opp',
      'smart_pass_missing_controller',
      'smart_pass_empty_stack_opp_turn',
      'smart_pass_empty_stack_for_turn',
      'smart_pass_empty_pref_opp_spell',
      'loop_drain_empty_main',
      'loop_drain_own_spell',
    ]) {
      clearPriorityTimer(id);
      games.delete(id);
      ResolutionQueueManager.removeQueue(id);
    }
    vi.useRealTimers();
  });

  it('does not Smart Pass past an opponent spell when the human can respond', async () => {
    const { ctx, game, io, resolveTopOfStack } = createHarness('smart_pass_opp_spell');
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 50);

    expect(resolveTopOfStack).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');
    expect(ctx.state.stack).toHaveLength(1);
    expect((ctx.state.priorityPassedBy as Set<string>).has('p_human')).toBe(false);
  });

  it('passes an empty stack on an opponent turn when the preference is enabled', async () => {
    const { ctx, game, io, passPrioritySpy } = createHarness('smart_pass_empty_stack_opp_turn', {
      stack: [],
      priorityPassedBy: new Set<string>(),
      autoPassEmptyStackOnOpponentsTurn: { p_human: true },
    });
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(50);

    expect(passPrioritySpy).toHaveBeenCalledWith('p_human', true);
    expect(ctx.state.priority).toBe('p_opp');
  });

  it('still stops for an opponent spell when empty-stack passing is enabled', async () => {
    const { ctx, game, io, resolveTopOfStack } = createHarness('smart_pass_empty_pref_opp_spell', {
      autoPassEmptyStackOnOpponentsTurn: { p_human: true },
    });
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 50);

    expect(resolveTopOfStack).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');
    expect(ctx.state.stack).toHaveLength(1);
  });

  it('supports a per-turn empty-stack pass without passing a non-empty stack', async () => {
    const { ctx, game, io, passPrioritySpy } = createHarness('smart_pass_empty_stack_for_turn', {
      stack: [],
      priorityPassedBy: new Set<string>(),
      autoPassEmptyStackOnOpponentsTurn: {},
      autoPassEmptyStackForTurn: { p_human: true },
    });
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(50);

    expect(passPrioritySpy).toHaveBeenCalledWith('p_human', true);
    expect(ctx.state.priority).toBe('p_opp');
  });

  it('Smart Pass drains the human\'s own top stack object despite floating mana', async () => {
    const { ctx, game, io, resolveTopOfStack } = createHarness('smart_pass_own_spell', {
      turnPlayer: 'p_human',
      stack: [
        {
          id: 'bolt_own',
          type: 'spell',
          controller: 'p_human',
          card: {
            id: 'bolt_card',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
        },
      ],
      zones: {
        p_opp: { hand: [], graveyard: [], library: [] },
        p_human: {
          hand: [
            {
              id: 'rift_1',
              name: 'Cyclonic Rift',
              type_line: 'Instant',
              mana_cost: '{1}{U}',
              oracle_text:
                'Return target nonland permanent you don\'t control to its owner\'s hand.',
            },
          ],
          graveyard: [],
          library: [],
        },
      },
      priorityPassedBy: new Set<string>(),
    });
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 50);

    // Own-stack Smart Pass bypasses idle checks and drains through to resolution.
    // priorityPassedBy is cleared once the stack object resolves.
    expect(resolveTopOfStack).toHaveBeenCalled();
    expect(ctx.state.stack).toHaveLength(0);
  });

  it('does not Smart Pass an own spell while a non-payment resolution prompt is open', async () => {
    const gameId = 'smart_pass_own_spell_pending_choice';
    const { ctx, game, io, resolveTopOfStack } = createHarness(gameId, {
      turnPlayer: 'p_human',
      stack: [
        {
          id: 'mindmoil_own',
          type: 'spell',
          controller: 'p_human',
          card: {
            id: 'mindmoil_card',
            name: 'Mindmoil',
            type_line: 'Enchantment',
            mana_cost: '{4}{R}',
            oracle_text: 'Whenever you cast a spell, put the cards in your hand on the bottom of your library in any order, then draw that many cards.',
          },
        },
      ],
      priorityPassedBy: new Set<string>(),
    });
    games.set(game.gameId, game);

    const queued = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p_human' as any,
      description: "Neera, Wild Mage: Put Mindmoil on the bottom of its owner's library and reveal until a nonland card?",
      mandatory: false,
      options: [
        { id: 'yes', label: 'Use ability' },
        { id: 'no', label: 'Decline' },
      ],
    } as any);
    // Live prompts can lose status in persisted copies; still block Smart Pass.
    (queued as any).status = undefined;

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 50);

    expect(resolveTopOfStack).not.toHaveBeenCalled();
    expect(ctx.state.stack).toHaveLength(1);
    expect(ctx.state.stack[0].id).toBe('mindmoil_own');
  });

  it('autoPassForTurn still drains opponent spells', async () => {
    const { ctx, game, io, resolveTopOfStack } = createHarness('smart_pass_rest_of_turn', {
      autoPassPlayers: new Set<string>(),
      autoPassForTurn: { p_human: true },
    });
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    // Rest-of-turn skips the human delay.
    await vi.advanceTimersByTimeAsync(50);

    expect(resolveTopOfStack).toHaveBeenCalled();
    expect(ctx.state.stack).toHaveLength(0);
  });

  it('loop stack-drain does not empty-stack auto-pass on the active main phase', async () => {
    const { ctx, game, io, passPrioritySpy } = createHarness('loop_drain_empty_main', {
      turnPlayer: 'p_human',
      priority: 'p_human',
      phase: 'postcombatMain',
      step: 'MAIN2',
      stack: [],
      priorityPassedBy: new Set<string>(),
      autoPassPlayers: new Set<string>(),
      loopShortcutStackDrain: { p_human: true },
      landsPlayedThisTurn: { p_human: 0 },
      zones: {
        p_opp: { hand: [], graveyard: [], library: [] },
        p_human: {
          hand: [
            {
              id: 'island_1',
              name: 'Island',
              type_line: 'Basic Land — Island',
              oracle_text: '{T}: Add {U}.',
            },
          ],
          graveyard: [],
          library: [],
        },
      },
    });
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 50);

    expect(passPrioritySpy).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');
  });

  it('loop stack-drain still drains a non-empty stack', async () => {
    const { ctx, game, io, resolveTopOfStack } = createHarness('loop_drain_own_spell', {
      turnPlayer: 'p_human',
      autoPassPlayers: new Set<string>(),
      loopShortcutStackDrain: { p_human: true },
      priorityPassedBy: new Set<string>(),
      stack: [
        {
          id: 'bolt_own',
          type: 'spell',
          controller: 'p_human',
          card: {
            id: 'bolt_card',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
        },
      ],
    });
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(50);

    expect(resolveTopOfStack).toHaveBeenCalled();
    expect(ctx.state.stack).toHaveLength(0);
  });

  it('timeout does not auto-pass past an opponent spell under Smart Pass when responses exist', async () => {
    const { ctx, game, io, resolveTopOfStack } = createHarness('smart_pass_timeout_opp');
    games.set(game.gameId, game);

    schedulePriorityTimeout(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(PRIORITY_TIMEOUT_MS);

    expect(resolveTopOfStack).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');
    expect(ctx.state.stack).toHaveLength(1);
  });

  it('fails closed when top stack controller metadata is missing', async () => {
    const { ctx, game, io, resolveTopOfStack } = createHarness('smart_pass_missing_controller', {
      stack: [
        {
          id: 'orphan_spell',
          type: 'spell',
          // no controller
          card: {
            id: 'murder_card',
            name: 'Murder',
            type_line: 'Instant',
            mana_cost: '{1}{B}{B}',
            oracle_text: 'Destroy target creature.',
          },
        },
      ],
    });
    games.set(game.gameId, game);

    checkAndTriggerAutoPass(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(AUTO_PASS_DELAY_MS + 50);

    expect(resolveTopOfStack).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p_human');
    expect((ctx.state.priorityPassedBy as Set<string>).has('p_human')).toBe(false);
  });
});
