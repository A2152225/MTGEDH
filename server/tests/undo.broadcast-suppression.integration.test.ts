import { describe, expect, it, vi } from 'vitest';

import { broadcastGame, suppressAutomationOnNextBroadcast } from '../src/socket/util.js';
import { createContext } from '../src/state/context.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map(),
    },
  } as any;
}

describe('undo broadcast automation suppression', () => {
  it('skips exactly one human auto-pass broadcast after suppression', () => {
    const gameId = 'undo_broadcast_suppression';
    const ctx = createContext(gameId);

    Object.assign(ctx.state as any, {
      active: true,
      phase: 'precombatMain',
      step: 'MAIN1',
      turn: 3,
      turnDirection: 1,
      turnPlayer: 'p1',
      priority: 'p1',
      players: [
        { id: 'p1', seat: 1, name: 'Player 1', isAI: false },
        { id: 'p2', seat: 2, name: 'Player 2', isAI: false },
      ],
      stack: [],
      battlefield: [],
      zones: {
        p1: { hand: [], graveyard: [], library: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
        p2: { hand: [], graveyard: [], library: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      },
      life: { p1: 40, p2: 40 },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      landsPlayedThisTurn: { p1: 0, p2: 0 },
      autoPassPlayers: new Set<string>(),
      autoPassForTurn: { p1: true },
      priorityClaimed: new Set<string>(),
    });

    const passPriority = vi.fn(() => ({ changed: false, resolvedNow: false, advanceStep: false }));

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
      passPriority,
      participants: () => [{ socketId: 'sock_1', playerId: 'p1', spectator: false }],
      viewFor: () => ({
        ...ctx.state,
        viewer: 'p1',
      }),
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    suppressAutomationOnNextBroadcast(game);
    broadcastGame(io, game, gameId);

    expect(passPriority).not.toHaveBeenCalled();
    expect((game.state as any)._suppressAutomationOnNextBroadcast).toBeUndefined();

    broadcastGame(io, game, gameId);

    expect(passPriority).toHaveBeenCalledTimes(1);

    const stateEvents = emitted.filter((entry) => entry.room === 'sock_1' && entry.event === 'state');
    expect(stateEvents).toHaveLength(2);
  });
});