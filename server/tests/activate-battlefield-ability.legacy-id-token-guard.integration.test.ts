import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

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
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

function setupGame(gameId: string, battlefield: any[], manaPool?: Partial<Record<'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless', number>>) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);

  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerId = 'p1';
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).manaPool = {
    [playerId]: {
      white: manaPool?.white || 0,
      blue: manaPool?.blue || 0,
      black: manaPool?.black || 0,
      red: manaPool?.red || 0,
      green: manaPool?.green || 0,
      colorless: manaPool?.colorless || 0,
    },
  };
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      library: [{ id: `${gameId}_draw_1`, name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
      libraryCount: 1,
    },
  };
  (game.state as any).battlefield = battlefield;

  const emitted: Array<{ room?: string; event: string; payload: any }> = [];
  const { socket, handlers } = createMockSocket(playerId, emitted);
  socket.rooms.add(gameId);
  const io = createMockIo(emitted, [socket]);

  registerResolutionHandlers(io as any, socket as any);
  registerInteractionHandlers(io as any, socket as any);

  return { game, playerId, emitted, handlers };
}

function expectGenericDrawActivation(game: any, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
  const errorEvent = emitted.find((entry) => entry.event === 'error');
  expect(errorEvent).toBeUndefined();

  const queue = ResolutionQueueManager.getQueue(gameId);
  expect(queue.steps).toHaveLength(0);

  const stack = (game.state as any).stack || [];
  expect(stack).toHaveLength(1);
  expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');
}

describe('activateBattlefieldAbility legacy id token guards (integration)', () => {
  const gameIdPrefix = 'test_activate_battlefield_legacy_id_tokens';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameIdPrefix);
    games.delete(gameIdPrefix as any);
  });

  it('does not let animate token matching hijack an unrelated generic activation on Mutavault', async () => {
    const gameId = `${gameIdPrefix}_animate`;
    const permanentId = 'mutavault_animate_1';
    const { game, emitted, handlers } = setupGame(gameId, [
      {
        id: permanentId,
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'mutavault_card_1',
          name: 'Mutavault',
          type_line: 'Land',
          oracle_text: '{T}: Draw a card.\n{1}: Mutavault becomes a 2/2 creature with all creature types until end of turn. It\'s still a land.',
        },
      },
    ]);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-0` });

    expectGenericDrawActivation(game, emitted, gameId);
    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === permanentId);
    expect(Boolean(permanent?.animatedUntilEOT)).toBe(false);
  });

  it('does not let hybrid-mana token matching hijack an unrelated generic activation on Graven Cairns', async () => {
    const gameId = `${gameIdPrefix}_hybrid`;
    const permanentId = 'graven-cairns_hybrid-mana_1';
    const { game, emitted, handlers } = setupGame(gameId, [
      {
        id: permanentId,
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'graven_cairns_card_1',
          name: 'Graven Cairns',
          type_line: 'Land',
          oracle_text: '{T}: Draw a card.\n{B/R}, {T}: Add {B}{B}, {B}{R}, or {R}{R}.',
        },
      },
    ]);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-0` });

    expectGenericDrawActivation(game, emitted, gameId);
  });

  it('does not let storage add-counter token matching hijack an unrelated generic activation on Calciform Pools', async () => {
    const gameId = `${gameIdPrefix}_storage_add`;
    const permanentId = 'calciform_add-counter_1';
    const { game, emitted, handlers } = setupGame(gameId, [
      {
        id: permanentId,
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        counters: {},
        card: {
          id: 'calciform_card_add_1',
          name: 'Calciform Pools',
          type_line: 'Land',
          oracle_text: '{T}: Draw a card.\n{1}, {T}: Put a storage counter on Calciform Pools.\n{T}, Remove X storage counters from Calciform Pools: Add X mana in any combination of {W} and/or {U}.',
        },
      },
    ]);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-0` });

    expectGenericDrawActivation(game, emitted, gameId);
    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === permanentId);
    expect(Number(permanent?.counters?.storage || 0)).toBe(0);
  });

  it('does not let storage remove-counters token matching hijack an unrelated generic activation on Calciform Pools', async () => {
    const gameId = `${gameIdPrefix}_storage_remove`;
    const permanentId = 'calciform_remove-counters_1';
    const { game, emitted, handlers } = setupGame(gameId, [
      {
        id: permanentId,
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        counters: {},
        card: {
          id: 'calciform_card_remove_1',
          name: 'Calciform Pools',
          type_line: 'Land',
          oracle_text: '{T}: Draw a card.\n{1}, {T}: Put a storage counter on Calciform Pools.\n{T}, Remove X storage counters from Calciform Pools: Add X mana in any combination of {W} and/or {U}.',
        },
      },
    ]);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-0` });

    expectGenericDrawActivation(game, emitted, gameId);
  });

  it('does not let hideaway token matching hijack an unrelated generic activation on Windbrisk Heights', async () => {
    const gameId = `${gameIdPrefix}_hideaway`;
    const permanentId = 'windbrisk_play-hideaway_1';
    const { game, emitted, handlers } = setupGame(gameId, [
      {
        id: permanentId,
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'windbrisk_card_1',
          name: 'Windbrisk Heights',
          type_line: 'Land',
          oracle_text: '{T}: Draw a card.\n{W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.',
        },
      },
    ]);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-0` });

    expectGenericDrawActivation(game, emitted, gameId);
  });

  it('does not let fetch token matching hijack an unrelated generic activation on a fetch-style land', async () => {
    const gameId = `${gameIdPrefix}_fetch`;
    const permanentId = 'test-fetch-land_1';
    const { game, emitted, handlers } = setupGame(gameId, [
      {
        id: permanentId,
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'test_fetch_card_1',
          name: 'Test Fetchland',
          type_line: 'Land',
          oracle_text: '{T}: Draw a card.\n{2}, {T}, Sacrifice Test Fetchland: Search your library for a land card, put it onto the battlefield tapped, then shuffle.',
        },
      },
    ]);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-0` });

    expectGenericDrawActivation(game, emitted, gameId);
    expect((game.state as any).battlefield).toHaveLength(1);
  });

  it('does not let native_ prefix matching hijack an unrelated generic battlefield activation', async () => {
    const gameId = `${gameIdPrefix}_native_prefix`;
    const permanentId = 'native_relay_1';
    const { game, emitted, handlers } = setupGame(gameId, [
      {
        id: permanentId,
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'native_relay_card_1',
          name: 'Native Relay',
          type_line: 'Artifact',
          oracle_text: '{T}: Draw a card.',
        },
      },
    ]);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-0` });

    expectGenericDrawActivation(game, emitted, gameId);
    expect(Number((game.state as any).manaPool?.p1?.colorless || 0)).toBe(0);
  });

  it('does not let tap-mana prefix matching hijack an unrelated generic battlefield activation', async () => {
    const gameId = `${gameIdPrefix}_tap_mana_prefix`;
    const permanentId = 'tap-mana_relay_1';
    const { game, emitted, handlers } = setupGame(gameId, [
      {
        id: permanentId,
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'tap_mana_relay_card_1',
          name: 'Tap Mana Relay',
          type_line: 'Artifact',
          oracle_text: '{T}: Draw a card.',
        },
      },
    ]);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-0` });

    expectGenericDrawActivation(game, emitted, gameId);
    expect(Number((game.state as any).manaPool?.p1?.colorless || 0)).toBe(0);
  });

  it('does not let pw-ability prefix matching hijack an unrelated generic battlefield activation', async () => {
    const gameId = `${gameIdPrefix}_pw_prefix`;
    const permanentId = 'pw-ability-relay_1';
    const { game, emitted, handlers } = setupGame(gameId, [
      {
        id: permanentId,
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'pw_relay_card_1',
          name: 'Pseudo Walker Relay',
          type_line: 'Artifact',
          oracle_text: '{T}: Draw a card.',
        },
      },
    ]);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-0` });

    expectGenericDrawActivation(game, emitted, gameId);
  });

  it('does not let upgrade token matching override the selected generic upgrade ability index', async () => {
    const gameId = `${gameIdPrefix}_upgrade`;
    const permanentId = 'figure-becomes-warrior_1';
    const { game, emitted, handlers, playerId } = setupGame(
      gameId,
      [
        {
          id: permanentId,
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'figure_card_1',
            name: 'Figure of Destiny',
            type_line: 'Creature - Kithkin Spirit',
            oracle_text: '{R/W}: Figure of Destiny becomes a 2/2 Kithkin Spirit.\n{R/W}{R/W}{R/W}: If Figure of Destiny is a Spirit, it becomes a 4/4 Kithkin Spirit Warrior.\n{R/W}{R/W}{R/W}{R/W}{R/W}{R/W}: If Figure of Destiny is a Warrior, it becomes an 8/8 Kithkin Spirit Warrior Avatar with flying and first strike.',
          },
          typeAdditions: ['Spirit'],
        },
      ],
      { white: 3 },
    );

    await handlers['activateBattlefieldAbility']({ gameId, permanentId, abilityId: `${permanentId}-ability-1` });

    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(errorEvent).toBeUndefined();

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '')).toContain('4/4');
    expect(Number((game.state as any).manaPool?.[playerId]?.white || 0)).toBe(0);
  });
});