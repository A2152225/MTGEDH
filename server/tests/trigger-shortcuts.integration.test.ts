import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerAutomationHandlers } from '../src/socket/automation.js';
import { games } from '../src/socket/socket.js';
import { clearPriorityTimer, broadcastGame } from '../src/socket/util.js';
import { createContext } from '../src/state/context.js';
import { passPriority } from '../src/state/modules/priority.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: vi.fn((room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    })),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data,
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

function createTriggerShortcutHarness(gameId: string, overrides: Record<string, unknown> = {}) {
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
    autoPassPlayers: new Set(['p2']),
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

  return { ctx, game, resolveTopOfStack };
}

describe('trigger shortcut integration', () => {
  afterEach(() => {
    clearPriorityTimer('trigger_shortcut_handler');
    clearPriorityTimer('trigger_shortcut_broadcast');
    games.delete('trigger_shortcut_handler');
    games.delete('trigger_shortcut_broadcast');
  });

  it('yieldToTriggerSource immediately re-evaluates current priority through the automation socket handler', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { ctx, game, resolveTopOfStack } = createTriggerShortcutHarness('trigger_shortcut_handler');
    games.set(game.gameId, game);

    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket({ playerId: 'p2', spectator: false, gameId: game.gameId }, emitted);
    socket.rooms.add(game.gameId);
    registerAutomationHandlers(io as any, socket as any);

    handlers['yieldToTriggerSource']({
      gameId: game.gameId,
      sourceId: 'soul_warden_1',
      sourceName: 'Soul Warden',
    });

    await vi.waitFor(() => {
      expect(resolveTopOfStack).toHaveBeenCalledOnce();
    });

    expect(ctx.state.stack).toHaveLength(0);
    expect(ctx.state.priority).toBe('p1');
    expect((ctx.state as any).yieldToTriggerSourcesForAutoPass?.p2?.soul_warden_1?.enabled).toBe(true);
    expect(emitted.some(entry => entry.room === game.gameId && entry.event === 'state')).toBe(true);
  });

  it('broadcastGame auto-passes the current priority holder for saved always_resolve triggers', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { ctx, game, resolveTopOfStack } = createTriggerShortcutHarness('trigger_shortcut_broadcast', {
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
    const io = createMockIo(emitted);

    broadcastGame(io, game, game.gameId);

    await vi.waitFor(() => {
      expect(resolveTopOfStack).toHaveBeenCalledOnce();
    });

    expect(ctx.state.stack).toHaveLength(0);
    expect(ctx.state.priority).toBe('p1');
    expect(emitted.some(entry => entry.room === game.gameId && entry.event === 'state')).toBe(true);
  });
});