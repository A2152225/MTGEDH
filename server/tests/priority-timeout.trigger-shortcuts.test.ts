import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRIORITY_TIMEOUT_MS, games } from '../src/socket/socket.js';
import { clearPriorityTimer, schedulePriorityTimeout } from '../src/socket/util.js';
import { createContext } from '../src/state/context.js';
import { passPriority } from '../src/state/modules/priority.js';

function createPriorityTimeoutTestHarness(gameId: string, overrides: Record<string, unknown> = {}) {
  const ctx = createContext(gameId);
  Object.assign(ctx.state as any, {
    active: true,
    phase: 'precombatMain',
    step: 'MAIN1',
    turnDirection: 1,
    turnPlayer: 'p1',
    priority: 'p2',
    players: [
      { id: 'p1', seat: 1 },
      { id: 'p2', seat: 2 },
    ],
    stack: [
      {
        id: 'trigger_1',
        type: 'triggered_ability',
        controller: 'p2',
        source: 'soul_warden_1',
        sourceName: 'Soul Warden',
        description: 'Whenever another creature enters the battlefield, you gain 1 life.',
        mandatory: true,
      },
    ],
    zones: {
      p1: { hand: [], graveyard: [], library: [] },
      p2: {
        hand: [
          {
            id: 'bolt_1',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            mana_cost: '{R}',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
        ],
        graveyard: [],
        library: [],
      },
    },
    battlefield: [],
    manaPool: {
      p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
    },
    priorityPassedBy: new Set(['p1']),
    ...overrides,
  });

  const resolveTopOfStack = vi.fn(() => {
    (ctx.state.stack as any[]).pop();
  });

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
    passPriority: (playerId: string, isAutoPass?: boolean) => passPriority(ctx, playerId as any, isAutoPass),
    resolveTopOfStack,
  };

  const emit = vi.fn();
  const io: any = {
    to: vi.fn(() => ({ emit })),
  };

  return { ctx, game, io, resolveTopOfStack, emit };
}

describe('priority timeout trigger shortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearPriorityTimer('timeout_without_shortcut');
    clearPriorityTimer('timeout_with_yield');
    clearPriorityTimer('timeout_with_saved_shortcut');
    games.delete('timeout_without_shortcut');
    games.delete('timeout_with_yield');
    games.delete('timeout_with_saved_shortcut');
    vi.useRealTimers();
  });

  it('does not timeout auto-pass a human player with legal responses when no trigger shortcut applies', async () => {
    const { ctx, game, io, resolveTopOfStack } = createPriorityTimeoutTestHarness('timeout_without_shortcut');
    games.set(game.gameId, game);

    schedulePriorityTimeout(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(PRIORITY_TIMEOUT_MS);

    expect(resolveTopOfStack).not.toHaveBeenCalled();
    expect(ctx.state.priority).toBe('p2');
    expect(ctx.state.stack).toHaveLength(1);
  });

  it('timeout auto-passes a human player when the top trigger source is yielded', async () => {
    const { ctx, game, io, resolveTopOfStack } = createPriorityTimeoutTestHarness('timeout_with_yield', {
      yieldToTriggerSourcesForAutoPass: {
        p2: {
          soul_warden_1: {
            sourceId: 'soul_warden_1',
            sourceName: 'Soul Warden',
            enabled: true,
          },
        },
      },
    });
    games.set(game.gameId, game);

    schedulePriorityTimeout(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(PRIORITY_TIMEOUT_MS);

    expect(resolveTopOfStack).toHaveBeenCalledOnce();
    expect(ctx.state.priority).toBe('p1');
    expect(ctx.state.stack).toHaveLength(0);
  });

  it('timeout auto-passes a human player when always_resolve matches the top trigger source', async () => {
    const { ctx, game, io, resolveTopOfStack } = createPriorityTimeoutTestHarness('timeout_with_saved_shortcut', {
      triggerShortcuts: {
        p2: [
          {
            cardName: 'Soul Warden',
            playerId: 'p2',
            preference: 'always_resolve',
          },
        ],
      },
    });
    games.set(game.gameId, game);

    schedulePriorityTimeout(io, game, game.gameId);
    await vi.advanceTimersByTimeAsync(PRIORITY_TIMEOUT_MS);

    expect(resolveTopOfStack).toHaveBeenCalledOnce();
    expect(ctx.state.priority).toBe('p1');
    expect(ctx.state.stack).toHaveLength(0);
  });
});