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

  it('does not highlight Baeloth when Homeward Path, Training Center, and Izzet Signet only make three mana total', () => {
    const gameId = 'playable_cards_baeloth_signet';
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
        { id: 'p3', seat: 3, name: 'Player 3' },
      ],
      stack: [],
      battlefield: [
        {
          id: 'homeward_path_1',
          controller: 'p1',
          tapped: false,
          card: { name: 'Homeward Path', type_line: 'Land', oracle_text: '{T}: Add {C}.' },
        },
        {
          id: 'training_center_1',
          controller: 'p1',
          tapped: false,
          card: {
            name: 'Training Center',
            type_line: 'Land',
            oracle_text: '{T}: Add {C}.\n{T}: Add {U} or {R}. Activate only if you have two or more opponents.',
          },
        },
        {
          id: 'izzet_signet_1',
          controller: 'p1',
          tapped: false,
          card: { name: 'Izzet Signet', type_line: 'Artifact', oracle_text: '{1}, {T}: Add {U}{R}.' },
        },
      ],
      zones: {
        p1: {
          hand: [
            {
              id: 'baeloth_1',
              name: 'Baeloth Barrityl, Entertainer',
              mana_cost: '{4}{R}',
              type_line: 'Legendary Creature — Human Warrior',
              oracle_text: 'Creatures your opponents control with power less than Baeloth Barrityl, Entertainer are goaded.',
            },
          ],
          graveyard: [],
          library: [],
          exile: [],
          handCount: 1,
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
        p3: {
          hand: [],
          graveyard: [],
          library: [],
          exile: [],
          handCount: 0,
          graveyardCount: 0,
          exileCount: 0,
        },
      },
      life: { p1: 40, p2: 40, p3: 40 },
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p3: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      landsPlayedThisTurn: { p1: 0, p2: 0, p3: 0 },
      playableCards: ['baeloth_1'],
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
        playableCards: ['baeloth_1'],
        canAct: true,
        canRespond: true,
      }),
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    broadcastGame(io, game, gameId);

    const stateEvent = emitted.find((entry) => entry.room === 'sock_1' && entry.event === 'state');
    expect(stateEvent).toBeDefined();
    expect(stateEvent?.payload?.view?.playableCards).not.toContain('baeloth_1');
  });

  it('does not highlight multi-mana hand spells after casting an any-color rock with all lands tapped', () => {
    const gameId = 'playable_cards_waterskin_after_cast';
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
          id: 'swamp_1',
          controller: 'p1',
          tapped: true,
          card: { name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '{T}: Add {B}.' },
        },
        {
          id: 'forest_1',
          controller: 'p1',
          tapped: true,
          card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
        },
        {
          id: 'waterskin_1',
          controller: 'p1',
          tapped: false,
          card: { name: "Bender's Waterskin", type_line: 'Artifact', oracle_text: '{T}: Add one mana of any color.' },
        },
      ],
      zones: {
        p1: {
          hand: [
            {
              id: 'agitator_ant_1',
              name: 'Agitator Ant',
              mana_cost: '{2}{R}',
              type_line: 'Creature — Insect',
              oracle_text: 'At the beginning of your end step, each player may put two +1/+1 counters on a creature they control.',
            },
            {
              id: 'backlash_1',
              name: 'Backlash',
              mana_cost: '{1}{R}',
              type_line: 'Instant',
              oracle_text: 'Tap target untapped creature. That creature deals damage equal to its power to its controller.',
            },
            {
              id: 'plate_1',
              name: 'Darksteel Plate',
              mana_cost: '{3}',
              type_line: 'Artifact — Equipment',
              oracle_text: 'Indestructible\nEquip {2}',
            },
          ],
          graveyard: [],
          library: [],
          exile: [],
          handCount: 3,
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
      playableCards: ['agitator_ant_1', 'backlash_1', 'plate_1'],
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
        playableCards: ['agitator_ant_1', 'backlash_1', 'plate_1'],
        canAct: true,
        canRespond: true,
      }),
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    broadcastGame(io, game, gameId);

    const stateEvent = emitted.find((entry) => entry.room === 'sock_1' && entry.event === 'state');
    expect(stateEvent).toBeDefined();
    expect(stateEvent?.payload?.view?.playableCards).not.toContain('agitator_ant_1');
    expect(stateEvent?.payload?.view?.playableCards).not.toContain('backlash_1');
    expect(stateEvent?.payload?.view?.playableCards).not.toContain('plate_1');
  });
});