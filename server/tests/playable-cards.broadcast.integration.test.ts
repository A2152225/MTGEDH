import { describe, expect, it } from 'vitest';

import { broadcastGame } from '../src/socket/util.js';
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

describe('broadcastGame playable card refresh', () => {
  it('replaces stale playableCards with the current post-payment eligibility', () => {
    const gameId = 'playable_cards_refresh';
    const ctx = createContext(gameId);

    Object.assign(ctx.state as any, {
      active: true,
      phase: 'precombatMain',
      step: 'MAIN1',
      turnDirection: 1,
      turnPlayer: 'p1',
      priority: 'p1',
      players: [
        { id: 'p1', seat: 1, name: 'Player 1' },
        { id: 'p2', seat: 2, name: 'Player 2' },
      ],
      stack: [],
      battlefield: [
        {
          id: 'mountain_1',
          controller: 'p1',
          tapped: true,
          card: { name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.' },
        },
        {
          id: 'mountain_2',
          controller: 'p1',
          tapped: true,
          card: { name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.' },
        },
      ],
      zones: {
        p1: {
          hand: [
            {
              id: 'spell_1',
              name: 'Goblin Raider',
              mana_cost: '{1}{R}',
              type_line: 'Creature — Goblin Warrior',
              oracle_text: '',
            },
            {
              id: 'land_1',
              name: 'Mountain',
              type_line: 'Basic Land — Mountain',
              oracle_text: '{T}: Add {R}.',
            },
          ],
          graveyard: [],
          library: [],
          exile: [],
          handCount: 2,
          graveyardCount: 0,
          exileCount: 0,
        },
        p2: {
          hand: [],
          graveyard: [],
          library: [],
          exile: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
        },
      },
      life: { p1: 40, p2: 40 },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      landsPlayedThisTurn: { p1: 0, p2: 0 },
      playableCards: ['spell_1', 'land_1'],
      canAct: true,
      canRespond: true,
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
      participants: () => [{ socketId: 'sock_1', playerId: 'p1', spectator: false }],
      viewFor: () => ({
        ...ctx.state,
        viewer: 'p1',
        playableCards: ['spell_1', 'land_1'],
        canAct: true,
        canRespond: true,
      }),
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    broadcastGame(io, game, gameId);

    const stateEvent = emitted.find((entry) => entry.room === 'sock_1' && entry.event === 'state');
    expect(stateEvent).toBeDefined();
    expect(stateEvent?.payload?.view?.playableCards).toEqual(['land_1']);
    expect(stateEvent?.payload?.view?.playableCards).not.toContain('spell_1');
  });
});