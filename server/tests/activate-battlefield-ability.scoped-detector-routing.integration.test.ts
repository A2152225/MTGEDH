import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('activateBattlefieldAbility detector routing uses selected ability text (integration)', () => {
  const gameId = 'test_activate_battlefield_ability_scoped_detector_routing';
  const trackedGameIds = [
    gameId,
    `${gameId}_sacrifice_draw`,
    `${gameId}_move_counter`,
    `${gameId}_crew`,
    `${gameId}_station`,
    `${gameId}_equip`,
    `${gameId}_grant_ability`,
    `${gameId}_graveyard_exile`,
    `${gameId}_graveyard_exile_resolve`,
    `${gameId}_graveyard_hand`,
    `${gameId}_graveyard_hand_battle`,
    `${gameId}_graveyard_hand_permanent`,
    `${gameId}_graveyard_hand_mana_value`,
    `${gameId}_sokrates_grant`,
    `${gameId}_fight`,
    `${gameId}_tap_untap`,
    `${gameId}_graveyard_library`,
    `${gameId}_graveyard_library_top`,
    `${gameId}_graveyard_library_top_mana_value`,
    `${gameId}_graveyard_library_top_own_graveyard`,
    `${gameId}_graveyard_battlefield`,
    `${gameId}_graveyard_battlefield_owner`,
    `${gameId}_graveyard_battlefield_tapped`,
    `${gameId}_graveyard_battlefield_counter`,
    `${gameId}_graveyard_battlefield_mana_value`,
    `${gameId}_graveyard_battlefield_total_power`,
    `${gameId}_control_change`,
  ];

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const trackedGameId of trackedGameIds) {
      await resetGame(trackedGameId);
    }
  });

  afterEach(async () => {
    for (const trackedGameId of trackedGameIds) {
      await resetGame(trackedGameId);
    }
  });

  it('does not let a later counter ability hijack an earlier generic ability activation', async () => {
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'split_1',
          name: 'Split Focus Engine',
          type_line: 'Artifact',
          oracle_text: '{T}: Draw a card.\n{2}: Put a +1/+1 counter on target creature.',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'creature_card_1',
          name: 'Test Bear',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const source = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'src_1');
    expect(Boolean(source?.tapped)).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.type)).toBe('ability');
    expect(String(stack[0]?.source)).toBe('src_1');
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');
    expect(String(stack[0]?.description || '').toLowerCase()).not.toContain('+1/+1 counter');
  });

  it('does not let a later sacrifice-to-draw ability hijack an earlier generic ability activation', async () => {
    const sacrificeDrawGameId = `${gameId}_sacrifice_draw`;
    await resetGame(sacrificeDrawGameId);

    createGameIfNotExists(sacrificeDrawGameId, 'commander', 40);
    const game = ensureGame(sacrificeDrawGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_2', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'src_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'split_2',
          name: 'Forked Canopy Device',
          type_line: 'Artifact',
          oracle_text: '{T}: Draw a card.\n{1}, {T}, Sacrifice Forked Canopy Device: Draw a card.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(sacrificeDrawGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: sacrificeDrawGameId, permanentId: 'src_2', abilityId: 'src_2-ability-0' });

    const queue = ResolutionQueueManager.getQueue(sacrificeDrawGameId);
    expect(queue.steps).toHaveLength(0);

    const sourceStillOnBattlefield = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'src_2');
    expect(sourceStillOnBattlefield).toBeDefined();
    expect(Boolean(sourceStillOnBattlefield?.tapped)).toBe(true);

    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(graveyard).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');
  });

  it('routes a generic move-counter ability through COUNTER_MOVEMENT without relying on the legacy fallback branch', async () => {
    const moveCounterGameId = `${gameId}_move_counter`;
    await resetGame(moveCounterGameId);

    createGameIfNotExists(moveCounterGameId, 'commander', 40);
    const game = ensureGame(moveCounterGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'nest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 1 },
        card: {
          id: 'nesting_grounds_1',
          name: 'Nesting Grounds',
          type_line: 'Land',
          oracle_text: '{1}, {T}: Move a counter from target permanent you control onto a second target permanent.',
        },
      },
      {
        id: 'perm_with_counter',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 2 },
        card: {
          id: 'counter_source_1',
          name: 'Charged Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
      {
        id: 'perm_target',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'counter_target_1',
          name: 'Empty Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(moveCounterGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: moveCounterGameId, permanentId: 'nest_1', abilityId: 'nest_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(moveCounterGameId);
    expect(queue.steps).toHaveLength(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('counter_movement');
    expect(step.sourceId).toBe('nest_1');

    const sourcePermanent = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'nest_1');
    expect(Boolean(sourcePermanent?.tapped)).toBe(true);
  });

  it('does not let crew hijack a Vehicle\'s separate generic activated ability', async () => {
    const crewGameId = `${gameId}_crew`;
    await resetGame(crewGameId);

    createGameIfNotExists(crewGameId, 'commander', 40);
    const game = ensureGame(crewGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_crew_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'vehicle_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'vehicle_card_1',
          name: 'Survey Skiff',
          type_line: 'Artifact — Vehicle',
          oracle_text: '{T}: Draw a card.\nCrew 3.',
        },
      },
      {
        id: 'crew_helper_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'crew_helper_card_1',
          name: 'Test Driver',
          type_line: 'Creature — Pilot',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(crewGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: crewGameId, permanentId: 'vehicle_1', abilityId: 'vehicle_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(crewGameId);
    expect(queue.steps).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');

    const vehicle = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'vehicle_1');
    expect(Boolean(vehicle?.tapped)).toBe(true);
  });

  it('does not let station hijack a Spacecraft\'s separate generic activated ability', async () => {
    const stationGameId = `${gameId}_station`;
    await resetGame(stationGameId);

    createGameIfNotExists(stationGameId, 'commander', 40);
    const game = ensureGame(stationGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_station_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'spacecraft_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'spacecraft_card_1',
          name: 'Cartographer Shuttle',
          type_line: 'Artifact — Spacecraft',
          oracle_text: '{T}: Draw a card.\nStation 3\n3+ | This becomes an artifact creature.',
        },
      },
      {
        id: 'station_helper_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'station_helper_card_1',
          name: 'Test Astronaut',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(stationGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: stationGameId, permanentId: 'spacecraft_1', abilityId: 'spacecraft_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(stationGameId);
    expect(queue.steps).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');

    const spacecraft = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'spacecraft_1');
    expect(Boolean(spacecraft?.tapped)).toBe(true);
  });

  it('does not let equip hijack an Equipment\'s separate generic activated ability', async () => {
    const equipGameId = `${gameId}_equip`;
    await resetGame(equipGameId);

    createGameIfNotExists(equipGameId, 'commander', 40);
    const game = ensureGame(equipGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_equip_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'equipment_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'equipment_card_1',
          name: 'Survey Blade',
          type_line: 'Artifact — Equipment',
          oracle_text: '{T}: Draw a card.\nEquip {2}',
        },
      },
      {
        id: 'equip_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'equip_target_card_1',
          name: 'Test Soldier',
          type_line: 'Creature — Soldier',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(equipGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: equipGameId, permanentId: 'equipment_1', abilityId: 'equipment_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(equipGameId);
    expect(queue.steps).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');

    const equipment = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'equipment_1');
    expect(Boolean(equipment?.tapped)).toBe(true);
  });

  it('does not let a later grant-ability ability hijack an earlier generic ability activation', async () => {
    const grantAbilityGameId = `${gameId}_grant_ability`;
    await resetGame(grantAbilityGameId);

    createGameIfNotExists(grantAbilityGameId, 'commander', 40);
    const game = ensureGame(grantAbilityGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_grant_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'grant_source_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'grant_source_card_1',
          name: 'Battlefield Tutor',
          type_line: 'Artifact',
          oracle_text: '{T}: Draw a card.\n{1}: Target creature you control gains flying until end of turn.',
        },
      },
      {
        id: 'grant_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'grant_target_card_1',
          name: 'Test Falcon',
          type_line: 'Creature — Bird',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(grantAbilityGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: grantAbilityGameId, permanentId: 'grant_source_1', abilityId: 'grant_source_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(grantAbilityGameId);
    expect(queue.steps).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');
    expect(String(stack[0]?.description || '').toLowerCase()).not.toContain('gains flying');
  });

  it('does not let a later graveyard-exile ability hijack an earlier generic ability activation', async () => {
    const exileGameId = `${gameId}_graveyard_exile`;
    await resetGame(exileGameId);

    createGameIfNotExists(exileGameId, 'commander', 40);
    const game = ensureGame(exileGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [{ id: 'gy_1', name: 'Own Card', type_line: 'Instant', zone: 'graveyard' }],
        graveyardCount: 1,
        library: [{ id: 'drawn_exile_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
      player_2: {
        hand: [],
        handCount: 0,
        graveyard: [{ id: 'gy_2', name: 'Opp Card', type_line: 'Sorcery', zone: 'graveyard' }],
        graveyardCount: 1,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'exile_source_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'exile_source_card_1',
          name: 'Tomb Archivist',
          type_line: 'Artifact Creature',
          oracle_text: '{T}: Draw a card.\n{1}: Exile target card from a graveyard.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(exileGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: exileGameId, permanentId: 'exile_source_1', abilityId: 'exile_source_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(exileGameId);
    expect(queue.steps).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');
    expect(String(stack[0]?.description || '').toLowerCase()).not.toContain('exile target card');
  });

  it('queues target selection for leading-clause grant abilities and keeps unrestricted creature targets', async () => {
    const sokratesGameId = `${gameId}_sokrates_grant`;
    await resetGame(sokratesGameId);

    createGameIfNotExists(sokratesGameId, 'commander', 40);
    const game = ensureGame(sokratesGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'sokrates_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'sokrates_card_1',
          name: 'Sokrates, Athenian Teacher',
          type_line: 'Legendary Creature — Human Advisor',
          oracle_text: 'Defender\nSokrates has hexproof as long as it\'s untapped.\nSokratic Dialogue — {T}: Until end of turn, target creature gains "If this creature would deal combat damage to a player, prevent that damage. This creature\'s controller and that player each draw half that many cards, rounded down."',
        },
      },
      {
        id: 'own_creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'own_creature_card_1',
          name: 'Student',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
      {
        id: 'opp_creature_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'opp_creature_card_1',
          name: 'Opponent Creature',
          type_line: 'Creature — Beast',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(sokratesGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: sokratesGameId, permanentId: 'sokrates_1', abilityId: 'sokrates_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(sokratesGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(
      expect.objectContaining({
        type: 'target_selection',
        battlefieldAbilityTargetSelection: true,
        targetDescription: 'creature',
      })
    );

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toEqual(expect.arrayContaining(['own_creature_1', 'opp_creature_1']));
    expect(((game.state as any).stack || [])).toHaveLength(0);
  });

  it('does not let a later fight ability hijack an earlier generic ability activation', async () => {
    const fightGameId = `${gameId}_fight`;
    await resetGame(fightGameId);

    createGameIfNotExists(fightGameId, 'commander', 40);
    const game = ensureGame(fightGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_fight_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'fight_source_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'fight_source_card_1',
          name: 'Arena Prototype',
          type_line: 'Creature — Construct',
          oracle_text: '{T}: Draw a card.\n{1}: This creature fights target creature you don\'t control.',
        },
      },
      {
        id: 'opp_creature_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'opp_creature_card_1',
          name: 'Enemy Bear',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(fightGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: fightGameId, permanentId: 'fight_source_1', abilityId: 'fight_source_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(fightGameId);
    expect(queue.steps).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');
    expect(String(stack[0]?.description || '').toLowerCase()).not.toContain('fights');
  });

  it('does not let a later tap-untap ability hijack an earlier generic ability activation', async () => {
    const tapUntapGameId = `${gameId}_tap_untap`;
    await resetGame(tapUntapGameId);

    createGameIfNotExists(tapUntapGameId, 'commander', 40);
    const game = ensureGame(tapUntapGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_tap_untap_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'tap_source_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'tap_source_card_1',
          name: 'Tinker Relay',
          type_line: 'Artifact Creature',
          oracle_text: '{T}: Draw a card.\n{1}: Tap target artifact.',
        },
      },
      {
        id: 'artifact_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'artifact_target_card_1',
          name: 'Test Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(tapUntapGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: tapUntapGameId, permanentId: 'tap_source_1', abilityId: 'tap_source_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(tapUntapGameId);
    expect(queue.steps).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');
    expect(String(stack[0]?.description || '').toLowerCase()).not.toContain('tap target artifact');
  });

  it('routes graveyard-to-library abilities through the selected ability text and preserves graveyard targeting', async () => {
    const gyLibraryGameId = `${gameId}_graveyard_library`;
    await resetGame(gyLibraryGameId);

    createGameIfNotExists(gyLibraryGameId, 'commander', 40);
    const game = ensureGame(gyLibraryGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'opp_artifact_1', name: 'Scrap Memory', type_line: 'Artifact', zone: 'graveyard' },
          { id: 'opp_creature_1', name: 'Wrong Type', type_line: 'Creature', zone: 'graveyard' },
        ],
        graveyardCount: 2,
        library: [{ id: 'opp_library_top_1', name: 'Top Library Card', type_line: 'Sorcery', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, (game.state as any).zones[opponentId].library);
    (game.state as any).battlefield = [
      {
        id: 'archivist_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'archivist_card_1',
          name: 'Keeper of the Cadence',
          type_line: 'Artifact Creature',
          oracle_text: '{3}: Put target artifact, instant, or sorcery card from a graveyard on the bottom of its owner\'s library.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyLibraryGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyLibraryGameId, permanentId: 'archivist_1', abilityId: 'archivist_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyLibraryGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(
      expect.objectContaining({
        type: 'target_selection',
        battlefieldAbilityTargetSelection: true,
        targetDescription: 'target artifact, instant, or sorcery card in a graveyard',
      })
    );
    expect(((queue.steps[0] as any).targetTypes || []).map((targetType: any) => String(targetType)).sort()).toEqual([
      'graveyard_artifact_card',
      'graveyard_instant_card',
      'graveyard_sorcery_card',
    ]);

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toEqual(['opp_artifact_1']);
    expect(((game.state as any).stack || [])).toHaveLength(0);

    await handlers['submitResolutionResponse']({
      gameId: gyLibraryGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_artifact_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('owner');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_creature_1']);
    expect((opponentZones?.library || []).map((card: any) => String(card?.id || ''))).toEqual([
      'opp_library_top_1',
      'opp_artifact_1',
    ]);
    expect(Array.from((game as any).libraries.get(opponentId) || []).map((card: any) => String(card?.id || ''))).toEqual([
      'opp_library_top_1',
      'opp_artifact_1',
    ]);
  });

  it('routes graveyard-to-top-of-library abilities through the selected ability text and preserves graveyard targeting', async () => {
    const gyLibraryTopGameId = `${gameId}_graveyard_library_top`;
    await resetGame(gyLibraryTopGameId);

    createGameIfNotExists(gyLibraryTopGameId, 'commander', 40);
    const game = ensureGame(gyLibraryTopGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'opp_target_1', name: 'Recovered Spell', type_line: 'Instant', zone: 'graveyard' },
          { id: 'opp_target_2', name: 'Second Target', type_line: 'Creature', zone: 'graveyard' },
        ],
        graveyardCount: 2,
        library: [{ id: 'opp_library_top_existing_1', name: 'Existing Top Card', type_line: 'Sorcery', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, (game.state as any).zones[opponentId].library);
    (game.state as any).battlefield = [
      {
        id: 'top_archivist_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'top_archivist_card_1',
          name: 'Top Archivist',
          type_line: 'Artifact Creature',
          oracle_text: '{1}, {T}: Put target card from a graveyard on top of its owner\'s library.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyLibraryTopGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyLibraryTopGameId, permanentId: 'top_archivist_1', abilityId: 'top_archivist_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyLibraryTopGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(
      expect.objectContaining({
        type: 'target_selection',
        battlefieldAbilityTargetSelection: true,
        targetDescription: 'target card in a graveyard',
      })
    );

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id)).sort();
    expect(validTargetIds).toEqual(['opp_target_1', 'opp_target_2']);
    expect(((game.state as any).stack || [])).toHaveLength(0);

    await handlers['submitResolutionResponse']({
      gameId: gyLibraryTopGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_target_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('top of its owner');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_target_2']);
    expect((opponentZones?.library || []).map((card: any) => String(card?.id || ''))).toEqual([
      'opp_target_1',
      'opp_library_top_existing_1',
    ]);
    expect(Array.from((game as any).libraries.get(opponentId) || []).map((card: any) => String(card?.id || ''))).toEqual([
      'opp_target_1',
      'opp_library_top_existing_1',
    ]);
  });

  it('filters mana-value-limited graveyard-to-top-of-library abilities through the selected ability text', async () => {
    const gyLibraryTopManaValueGameId = `${gameId}_graveyard_library_top_mana_value`;
    await resetGame(gyLibraryTopManaValueGameId);

    createGameIfNotExists(gyLibraryTopManaValueGameId, 'commander', 40);
    const game = ensureGame(gyLibraryTopManaValueGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'opp_top_mv_target_1', name: 'Recovered Adept', type_line: 'Creature', mana_cost: '{1}{U}', zone: 'graveyard' },
          { id: 'opp_top_mv_target_2', name: 'Too Costly', type_line: 'Creature', mana_cost: '{4}{U}', zone: 'graveyard' },
        ],
        graveyardCount: 2,
        library: [{ id: 'opp_library_top_mv_existing_1', name: 'Existing Top Card', type_line: 'Sorcery', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, (game.state as any).zones[opponentId].library);
    (game.state as any).battlefield = [
      {
        id: 'top_archivist_mv_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'top_archivist_mv_card_1',
          name: 'Measured Archivist',
          type_line: 'Artifact Creature',
          oracle_text: '{2}: Put target creature card with mana value 2 or less from a graveyard on top of its owner\'s library.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyLibraryTopManaValueGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyLibraryTopManaValueGameId, permanentId: 'top_archivist_mv_1', abilityId: 'top_archivist_mv_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyLibraryTopManaValueGameId);
    expect(queue.steps).toHaveLength(1);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id))).toEqual(['opp_top_mv_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: gyLibraryTopManaValueGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_top_mv_target_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('mana value 2 or less');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_top_mv_target_2']);
    expect((opponentZones?.library || []).map((card: any) => String(card?.id || ''))).toEqual([
      'opp_top_mv_target_1',
      'opp_library_top_mv_existing_1',
    ]);
  });

  it('routes own-graveyard top-of-library abilities through the selected ability text', async () => {
    const gyLibraryTopOwnGameId = `${gameId}_graveyard_library_top_own_graveyard`;
    await resetGame(gyLibraryTopOwnGameId);

    createGameIfNotExists(gyLibraryTopOwnGameId, 'commander', 40);
    const game = ensureGame(gyLibraryTopOwnGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'own_top_mv_target_1', name: 'Recovered Adept', type_line: 'Creature', mana_cost: '{1}{U}', zone: 'graveyard' },
          { id: 'own_top_mv_target_2', name: 'Too Costly', type_line: 'Creature', mana_cost: '{4}{U}', zone: 'graveyard' },
        ],
        graveyardCount: 2,
        library: [{ id: 'own_library_top_existing_1', name: 'Existing Top Card', type_line: 'Sorcery', zone: 'library' }],
        libraryCount: 1,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries.set(playerId, (game.state as any).zones[playerId].library);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).battlefield = [
      {
        id: 'top_archivist_own_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'top_archivist_own_card_1',
          name: 'Personal Archivist',
          type_line: 'Artifact Creature',
          oracle_text: '{2}: Put target creature card with mana value 2 or less from your graveyard on top of your library.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyLibraryTopOwnGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyLibraryTopOwnGameId, permanentId: 'top_archivist_own_1', abilityId: 'top_archivist_own_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyLibraryTopOwnGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(
      expect.objectContaining({
        type: 'target_selection',
        battlefieldAbilityTargetSelection: true,
        targetDescription: 'target creature card in your graveyard with mana value 2 or less',
      })
    );
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id))).toEqual(['own_top_mv_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: gyLibraryTopOwnGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['own_top_mv_target_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('from your graveyard');

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['own_top_mv_target_2']);
    expect((playerZones?.library || []).map((card: any) => String(card?.id || ''))).toEqual([
      'own_top_mv_target_1',
      'own_library_top_existing_1',
    ]);
  });

  it('routes graveyard-to-battlefield abilities through the selected ability text and preserves graveyard targeting', async () => {
    const gyBattlefieldGameId = `${gameId}_graveyard_battlefield`;
    await resetGame(gyBattlefieldGameId);

    createGameIfNotExists(gyBattlefieldGameId, 'commander', 40);
    const game = ensureGame(gyBattlefieldGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'opp_creature_1',
            name: 'Recovered Titan',
            type_line: 'Creature - Giant',
            power: '6',
            toughness: '6',
            zone: 'graveyard',
          },
          {
            id: 'opp_wrong_type_1',
            name: 'Spent Ritual',
            type_line: 'Instant',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).battlefield = [
      {
        id: 'gravecaller_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'gravecaller_card_1',
          name: 'Gravecaller Engine',
          type_line: 'Artifact',
          oracle_text: '{3}: Return target creature card from a graveyard to the battlefield under your control.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyBattlefieldGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyBattlefieldGameId, permanentId: 'gravecaller_1', abilityId: 'gravecaller_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyBattlefieldGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(
      expect.objectContaining({
        type: 'target_selection',
        battlefieldAbilityTargetSelection: true,
      })
    );
    expect(String((queue.steps[0] as any).targetDescription || '').toLowerCase()).toContain('graveyard');

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toEqual(['opp_creature_1']);
    expect(((game.state as any).stack || [])).toHaveLength(0);

    await handlers['submitResolutionResponse']({
      gameId: gyBattlefieldGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_creature_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('to the battlefield under your control');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_wrong_type_1']);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'opp_creature_1'
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: opponentId,
      tapped: false,
      summoningSickness: true,
    });
    expect(String(returnedPermanent?.card?.zone || '')).toBe('battlefield');
  });

  it('routes graveyard-to-battlefield owner-control abilities through the selected ability text', async () => {
    const gyBattlefieldOwnerGameId = `${gameId}_graveyard_battlefield_owner`;
    await resetGame(gyBattlefieldOwnerGameId);

    createGameIfNotExists(gyBattlefieldOwnerGameId, 'commander', 40);
    const game = ensureGame(gyBattlefieldOwnerGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 4 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'opp_creature_owner_1',
            name: 'Returned Subject',
            type_line: 'Creature - Knight',
            power: '3',
            toughness: '3',
            zone: 'graveyard',
          },
          {
            id: 'opp_wrong_type_owner_1',
            name: 'Wrong Spell',
            type_line: 'Instant',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).battlefield = [
      {
        id: 'kenrith_like_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'kenrith_like_card_1',
          name: 'Kenrith-like Engine',
          type_line: 'Creature - Human Noble',
          oracle_text: '{4}{B}: Put target creature card from a graveyard onto the battlefield under its owner\'s control.',
          power: '5',
          toughness: '5',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyBattlefieldOwnerGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyBattlefieldOwnerGameId, permanentId: 'kenrith_like_1', abilityId: 'kenrith_like_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyBattlefieldOwnerGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(
      expect.objectContaining({
        type: 'target_selection',
        battlefieldAbilityTargetSelection: true,
      })
    );

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toEqual(['opp_creature_owner_1']);

    await handlers['submitResolutionResponse']({
      gameId: gyBattlefieldOwnerGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_creature_owner_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain("under its owner's control");

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_wrong_type_owner_1']);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'opp_creature_owner_1'
    );
    expect(returnedPermanent).toMatchObject({
      controller: opponentId,
      owner: opponentId,
      tapped: false,
      summoningSickness: true,
    });
  });

  it('routes graveyard-to-battlefield tapped abilities through the selected ability text', async () => {
    const gyBattlefieldTappedGameId = `${gameId}_graveyard_battlefield_tapped`;
    await resetGame(gyBattlefieldTappedGameId);

    createGameIfNotExists(gyBattlefieldTappedGameId, 'commander', 40);
    const game = ensureGame(gyBattlefieldTappedGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'opp_creature_tapped_1',
            name: 'Tapped Return Target',
            type_line: 'Creature - Horror',
            power: '4',
            toughness: '4',
            zone: 'graveyard',
          },
          {
            id: 'opp_wrong_type_tapped_1',
            name: 'Wrong Target',
            type_line: 'Sorcery',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).battlefield = [
      {
        id: 'tapped_gravecaller_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'tapped_gravecaller_card_1',
          name: 'Tapped Gravecaller',
          type_line: 'Artifact',
          oracle_text: '{3}: Put target creature card from a graveyard onto the battlefield tapped under your control.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyBattlefieldTappedGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyBattlefieldTappedGameId, permanentId: 'tapped_gravecaller_1', abilityId: 'tapped_gravecaller_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyBattlefieldTappedGameId);
    expect(queue.steps).toHaveLength(1);

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toEqual(['opp_creature_tapped_1']);

    await handlers['submitResolutionResponse']({
      gameId: gyBattlefieldTappedGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_creature_tapped_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('battlefield tapped under your control');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_wrong_type_tapped_1']);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'opp_creature_tapped_1'
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: opponentId,
      tapped: true,
      summoningSickness: true,
    });
  });

  it('routes graveyard-to-battlefield counter-bearing abilities through the selected ability text', async () => {
    const gyBattlefieldCounterGameId = `${gameId}_graveyard_battlefield_counter`;
    await resetGame(gyBattlefieldCounterGameId);

    createGameIfNotExists(gyBattlefieldCounterGameId, 'commander', 40);
    const game = ensureGame(gyBattlefieldCounterGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'opp_creature_counter_1',
            name: 'Counter Return Target',
            type_line: 'Creature - Zombie',
            power: '2',
            toughness: '2',
            zone: 'graveyard',
          },
          {
            id: 'opp_wrong_type_counter_1',
            name: 'Off-Type Target',
            type_line: 'Instant',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).battlefield = [
      {
        id: 'counter_gravecaller_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'counter_gravecaller_card_1',
          name: 'Counter Gravecaller',
          type_line: 'Artifact',
          oracle_text: '{3}: Put target creature card from a graveyard onto the battlefield under your control with a finality counter on it.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyBattlefieldCounterGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyBattlefieldCounterGameId, permanentId: 'counter_gravecaller_1', abilityId: 'counter_gravecaller_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyBattlefieldCounterGameId);
    expect(queue.steps).toHaveLength(1);

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toEqual(['opp_creature_counter_1']);

    await handlers['submitResolutionResponse']({
      gameId: gyBattlefieldCounterGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_creature_counter_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('with a finality counter on it');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_wrong_type_counter_1']);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'opp_creature_counter_1'
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: opponentId,
      tapped: false,
      summoningSickness: true,
    });
    expect((returnedPermanent?.counters || {}).finality).toBe(1);
  });

  it('filters mana-value-limited graveyard-to-battlefield abilities through the selected ability text', async () => {
    const gyBattlefieldManaValueGameId = `${gameId}_graveyard_battlefield_mana_value`;
    await resetGame(gyBattlefieldManaValueGameId);

    createGameIfNotExists(gyBattlefieldManaValueGameId, 'commander', 40);
    const game = ensureGame(gyBattlefieldManaValueGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'opp_creature_mv4_1',
            name: 'Valid Mana Value Target',
            type_line: 'Creature - Construct',
            mana_cost: '{3}{U}',
            zone: 'graveyard',
            power: '4',
            toughness: '4',
          },
          {
            id: 'opp_creature_mv5_1',
            name: 'Too Large Target',
            type_line: 'Creature - Construct',
            mana_cost: '{4}{U}',
            zone: 'graveyard',
            power: '5',
            toughness: '5',
          },
        ],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).battlefield = [
      {
        id: 'mv_gravecaller_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'mv_gravecaller_card_1',
          name: 'Mana-Limited Gravecaller',
          type_line: 'Artifact',
          oracle_text: '{3}: Put target creature card with mana value 4 or less from a graveyard onto the battlefield under your control with a finality counter on it.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyBattlefieldManaValueGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyBattlefieldManaValueGameId, permanentId: 'mv_gravecaller_1', abilityId: 'mv_gravecaller_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyBattlefieldManaValueGameId);
    expect(queue.steps).toHaveLength(1);

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toEqual(['opp_creature_mv4_1']);
    expect(String((queue.steps[0] as any).targetDescription || '').toLowerCase()).toContain('mana value 4 or less');

    await handlers['submitResolutionResponse']({
      gameId: gyBattlefieldManaValueGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_creature_mv4_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('mana value 4 or less');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_creature_mv5_1']);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'opp_creature_mv4_1'
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: opponentId,
      tapped: false,
      summoningSickness: true,
    });
    expect((returnedPermanent?.counters || {}).finality).toBe(1);
  });

  it('filters exact-mana-value graveyard-to-battlefield abilities through the selected ability text', async () => {
    const gyBattlefieldExactManaValueGameId = `${gameId}_graveyard_battlefield_exact_mana_value`;
    await resetGame(gyBattlefieldExactManaValueGameId);

    createGameIfNotExists(gyBattlefieldExactManaValueGameId, 'commander', 40);
    const game = ensureGame(gyBattlefieldExactManaValueGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'opp_creature_mv1_exact_1',
            name: 'Exact Pup',
            type_line: 'Creature - Dog',
            mana_cost: '{W}',
            zone: 'graveyard',
            power: '1',
            toughness: '1',
          },
          {
            id: 'opp_creature_mv2_exact_1',
            name: 'Too Costly Target',
            type_line: 'Creature - Cat',
            mana_cost: '{1}{W}',
            zone: 'graveyard',
            power: '2',
            toughness: '2',
          },
        ],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).battlefield = [
      {
        id: 'exact_mv_gravecaller_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'exact_mv_gravecaller_card_1',
          name: 'Exact Mana Gravecaller',
          type_line: 'Artifact',
          oracle_text: '{3}: Put target creature card with mana value 1 from a graveyard onto the battlefield under your control.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyBattlefieldExactManaValueGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyBattlefieldExactManaValueGameId, permanentId: 'exact_mv_gravecaller_1', abilityId: 'exact_mv_gravecaller_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyBattlefieldExactManaValueGameId);
    expect(queue.steps).toHaveLength(1);

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toEqual(['opp_creature_mv1_exact_1']);
    expect(String((queue.steps[0] as any).targetDescription || '').toLowerCase()).toContain('mana value 1');
    expect(String((queue.steps[0] as any).targetDescription || '').toLowerCase()).not.toContain('or less');

    await handlers['submitResolutionResponse']({
      gameId: gyBattlefieldExactManaValueGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_creature_mv1_exact_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('mana value 1');
    expect(String(stack[0]?.description || '').toLowerCase()).not.toContain('or less');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_creature_mv2_exact_1']);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'opp_creature_mv1_exact_1'
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: opponentId,
      tapped: false,
      summoningSickness: true,
    });
  });

  it('filters chosen-X graveyard-to-battlefield abilities with mana value or greater through the selected ability text', async () => {
    const gyBattlefieldChosenXGreaterGameId = `${gameId}_graveyard_battlefield_chosen_x_greater`;
    await resetGame(gyBattlefieldChosenXGreaterGameId);

    createGameIfNotExists(gyBattlefieldChosenXGreaterGameId, 'commander', 40);
    const game = ensureGame(gyBattlefieldChosenXGreaterGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'opp_creature_mv1_x_greater_1',
            name: 'Too Small Target',
            type_line: 'Creature - Dog',
            mana_cost: '{W}',
            zone: 'graveyard',
            power: '1',
            toughness: '1',
          },
          {
            id: 'opp_creature_mv3_x_greater_1',
            name: 'Chosen X Target',
            type_line: 'Creature - Cat',
            mana_cost: '{2}{W}',
            zone: 'graveyard',
            power: '3',
            toughness: '3',
          },
        ],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).battlefield = [
      {
        id: 'x_greater_gravecaller_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'x_greater_gravecaller_card_1',
          name: 'Chosen X Gravecaller',
          type_line: 'Artifact',
          oracle_text: '{X}: Put target creature card with mana value X or greater from a graveyard onto the battlefield under your control.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyBattlefieldChosenXGreaterGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: gyBattlefieldChosenXGreaterGameId,
      permanentId: 'x_greater_gravecaller_1',
      abilityId: 'x_greater_gravecaller_1-ability-0',
      xValue: 2,
    });

    const queue = ResolutionQueueManager.getQueue(gyBattlefieldChosenXGreaterGameId);
    expect(queue.steps).toHaveLength(1);

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds).toEqual(['opp_creature_mv3_x_greater_1']);
    expect(String((queue.steps[0] as any).targetDescription || '').toLowerCase()).toContain('mana value 2 or greater');

    await handlers['submitResolutionResponse']({
      gameId: gyBattlefieldChosenXGreaterGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_creature_mv3_x_greater_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('mana value 2 or greater');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_creature_mv1_x_greater_1']);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'opp_creature_mv3_x_greater_1'
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: opponentId,
      tapped: false,
      summoningSickness: true,
    });
  });

  it('routes total-power-limited graveyard-to-battlefield abilities through the selected ability text', async () => {
    const gyBattlefieldTotalPowerGameId = `${gameId}_graveyard_battlefield_total_power`;
    await resetGame(gyBattlefieldTotalPowerGameId);

    createGameIfNotExists(gyBattlefieldTotalPowerGameId, 'commander', 40);
    const game = ensureGame(gyBattlefieldTotalPowerGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_total_power_3',
            name: 'Three Power Return',
            type_line: 'Creature - Horror',
            zone: 'graveyard',
            power: '3',
            toughness: '3',
          },
          {
            id: 'gy_total_power_1',
            name: 'One Power Return',
            type_line: 'Creature - Spirit',
            zone: 'graveyard',
            power: '1',
            toughness: '1',
          },
          {
            id: 'gy_total_power_2',
            name: 'Two Power Return',
            type_line: 'Creature - Zombie',
            zone: 'graveyard',
            power: '2',
            toughness: '2',
          },
          {
            id: 'gy_total_power_5',
            name: 'Too Large Single Target',
            type_line: 'Creature - Giant',
            zone: 'graveyard',
            power: '5',
            toughness: '5',
          },
          {
            id: 'gy_total_power_spell',
            name: 'Wrong Type Spell',
            type_line: 'Sorcery',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 5,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).battlefield = [
      {
        id: 'total_power_gravecaller_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'total_power_gravecaller_card_1',
          name: 'Total Power Gravecaller',
          type_line: 'Artifact',
          oracle_text: '{3}: Return any number of target creature cards with total power 4 or less from your graveyard to the battlefield.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyBattlefieldTotalPowerGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyBattlefieldTotalPowerGameId, permanentId: 'total_power_gravecaller_1', abilityId: 'total_power_gravecaller_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyBattlefieldTotalPowerGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(
      expect.objectContaining({
        type: 'graveyard_selection',
        battlefieldAbilityTargetSelection: true,
        totalPowerLimit: 4,
      })
    );
    expect(String((queue.steps[0] as any).targetDescription || '').toLowerCase()).toContain('total power 4 or less');

    const validTargetIds = ((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id));
    expect(validTargetIds.sort()).toEqual([
      'gy_total_power_1',
      'gy_total_power_2',
      'gy_total_power_3',
    ]);

    await handlers['submitResolutionResponse']({
      gameId: gyBattlefieldTotalPowerGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['gy_total_power_3', 'gy_total_power_2'],
      cancelled: false,
    });

    const totalPowerError = emitted.find((event) => event.event === 'error' && event.payload?.code === 'INVALID_TOTAL_POWER');
    expect(totalPowerError?.payload?.message).toContain('5');
    expect(ResolutionQueueManager.getQueue(gyBattlefieldTotalPowerGameId).steps).toHaveLength(1);

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId: gyBattlefieldTotalPowerGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['gy_total_power_3', 'gy_total_power_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('total power 4 or less');
    expect((stack[0]?.targets || []).map((targetId: any) => String(targetId))).toEqual(['gy_total_power_3', 'gy_total_power_1']);

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual([
      'gy_total_power_2',
      'gy_total_power_5',
      'gy_total_power_spell',
    ]);

    const returnedPermanents = ((game.state as any).battlefield || []).filter((perm: any) =>
      ['gy_total_power_3', 'gy_total_power_1'].includes(String(perm?.card?.id || ''))
    );
    expect(returnedPermanents).toHaveLength(2);
    expect(returnedPermanents.map((perm: any) => String(perm?.controller || '')).sort()).toEqual([playerId, playerId]);
    expect(returnedPermanents.every((perm: any) => perm?.summoningSickness === true)).toBe(true);
  });

  it('resolves typed graveyard-exile activations through the selected ability text', async () => {
    const gyExileResolveGameId = `${gameId}_graveyard_exile_resolve`;
    await resetGame(gyExileResolveGameId);

    createGameIfNotExists(gyExileResolveGameId, 'commander', 40);
    const game = ensureGame(gyExileResolveGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [{ id: 'own_nonartifact_1', name: 'Own Spell', type_line: 'Instant', zone: 'graveyard' }],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'opp_artifact_1', name: 'Target Relic', type_line: 'Artifact', zone: 'graveyard' },
          { id: 'opp_nonartifact_1', name: 'Wrong Type', type_line: 'Creature', zone: 'graveyard' },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'conversion_chamber_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'conversion_chamber_card_1',
          name: 'Conversion Chamber',
          type_line: 'Artifact',
          oracle_text: '{2}, {T}: Exile target artifact card from a graveyard.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyExileResolveGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyExileResolveGameId, permanentId: 'conversion_chamber_1', abilityId: 'conversion_chamber_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyExileResolveGameId);
    expect(queue.steps).toHaveLength(1);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id))).toEqual(['opp_artifact_1']);
    expect((game.state as any).manaPool[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    expect(Boolean((game.state as any).battlefield.find((perm: any) => perm.id === 'conversion_chamber_1')?.tapped)).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId: gyExileResolveGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_artifact_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toBe('exile target artifact card from a graveyard.');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_nonartifact_1']);
    expect((opponentZones?.exile || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_artifact_1']);
  });

  it('resolves typed graveyard-to-hand activations through the selected ability text', async () => {
    const gyHandGameId = `${gameId}_graveyard_hand`;
    await resetGame(gyHandGameId);

    createGameIfNotExists(gyHandGameId, 'commander', 40);
    const game = ensureGame(gyHandGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [{ id: 'own_wrong_type_1', name: 'Own Spell', type_line: 'Instant', zone: 'graveyard' }],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'opp_creature_1', name: 'Returned Horror', type_line: 'Creature — Horror', zone: 'graveyard' },
          { id: 'opp_wrong_type_1', name: 'Wrong Type', type_line: 'Artifact', zone: 'graveyard' },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'revel_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'revel_card_1',
          name: "Endbringer's Revel",
          type_line: 'Artifact',
          oracle_text: '{4}: Return target creature card from a graveyard to its owner\'s hand.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyHandGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyHandGameId, permanentId: 'revel_1', abilityId: 'revel_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyHandGameId);
    expect(queue.steps).toHaveLength(1);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id))).toEqual(['opp_creature_1']);

    await handlers['submitResolutionResponse']({
      gameId: gyHandGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_creature_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toBe("return target creature card from a graveyard to its owner's hand.");

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_wrong_type_1']);
    expect((opponentZones?.hand || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_creature_1']);
    expect(opponentZones?.handCount).toBe(1);
  });

  it('resolves battle-card graveyard-to-hand activations through the shared parsed target path', async () => {
    const gyHandBattleGameId = `${gameId}_graveyard_hand_battle`;
    await resetGame(gyHandBattleGameId);

    createGameIfNotExists(gyHandBattleGameId, 'commander', 40);
    const game = ensureGame(gyHandBattleGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'own_battle_target_1', name: 'Recovered Siege', type_line: 'Battle — Siege', zone: 'graveyard' },
          { id: 'own_nonbattle_target_1', name: 'Loose Thought', type_line: 'Instant', zone: 'graveyard' },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'siege_reclaimer_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'siege_reclaimer_card_1',
          name: 'Siege Reclaimer',
          type_line: 'Artifact Creature',
          oracle_text: '{2}: Return target battle card from your graveyard to your hand.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyHandBattleGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyHandBattleGameId, permanentId: 'siege_reclaimer_1', abilityId: 'siege_reclaimer_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyHandBattleGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(
      expect.objectContaining({
        type: 'target_selection',
        battlefieldAbilityTargetSelection: true,
        targetDescription: 'target battle card in your graveyard',
      })
    );
    expect(((queue.steps[0] as any).targetTypes || []).map((targetType: any) => String(targetType))).toEqual(['graveyard_battle_card']);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id))).toEqual(['own_battle_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: gyHandBattleGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['own_battle_target_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toBe('return target battle card from your graveyard to your hand.');

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['own_nonbattle_target_1']);
    expect((playerZones?.hand || []).map((card: any) => String(card?.id || ''))).toEqual(['own_battle_target_1']);
    expect(playerZones?.handCount).toBe(1);
  });

  it('filters permanent-only graveyard-to-hand activations through the shared parsed target path', async () => {
    const gyHandPermanentGameId = `${gameId}_graveyard_hand_permanent`;
    await resetGame(gyHandPermanentGameId);

    createGameIfNotExists(gyHandPermanentGameId, 'commander', 40);
    const game = ensureGame(gyHandPermanentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'own_perm_target_1', name: 'Recovered Relic', type_line: 'Artifact', zone: 'graveyard' },
          { id: 'own_nonperm_target_1', name: 'Loose Thought', type_line: 'Instant', zone: 'graveyard' },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'reclaimer_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'reclaimer_card_1',
          name: 'Vault Reclaimer',
          type_line: 'Artifact Creature',
          oracle_text: '{2}: Return target permanent card from your graveyard to your hand.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyHandPermanentGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyHandPermanentGameId, permanentId: 'reclaimer_1', abilityId: 'reclaimer_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyHandPermanentGameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(
      expect.objectContaining({
        type: 'target_selection',
        battlefieldAbilityTargetSelection: true,
        targetDescription: 'target permanent card in your graveyard',
      })
    );
    expect(((queue.steps[0] as any).targetTypes || []).map((targetType: any) => String(targetType))).toEqual(['graveyard_permanent_card']);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id))).toEqual(['own_perm_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: gyHandPermanentGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['own_perm_target_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toBe('return target permanent card from your graveyard to your hand.');

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['own_nonperm_target_1']);
    expect((playerZones?.hand || []).map((card: any) => String(card?.id || ''))).toEqual(['own_perm_target_1']);
    expect(playerZones?.handCount).toBe(1);
  });

  it('filters mana-value-limited graveyard-to-hand activations through the selected ability text', async () => {
    const gyHandManaValueGameId = `${gameId}_graveyard_hand_mana_value`;
    await resetGame(gyHandManaValueGameId);

    createGameIfNotExists(gyHandManaValueGameId, 'commander', 40);
    const game = ensureGame(gyHandManaValueGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          { id: 'opp_hand_mv_target_1', name: 'Returned Scout', type_line: 'Creature', mana_cost: '{2}{B}', zone: 'graveyard' },
          { id: 'opp_hand_mv_target_2', name: 'Huge Horror', type_line: 'Creature', mana_cost: '{5}{B}', zone: 'graveyard' },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'revel_mv_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'revel_mv_card_1',
          name: 'Measured Revel',
          type_line: 'Artifact',
          oracle_text: '{3}: Return target creature card with mana value 3 or less from a graveyard to its owner\'s hand.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gyHandManaValueGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: gyHandManaValueGameId, permanentId: 'revel_mv_1', abilityId: 'revel_mv_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gyHandManaValueGameId);
    expect(queue.steps).toHaveLength(1);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => String(target?.id))).toEqual(['opp_hand_mv_target_1']);

    await handlers['submitResolutionResponse']({
      gameId: gyHandManaValueGameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['opp_hand_mv_target_1'],
      cancelled: false,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('mana value 3 or less');

    game.resolveTopOfStack();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_hand_mv_target_2']);
    expect((opponentZones?.hand || []).map((card: any) => String(card?.id || ''))).toEqual(['opp_hand_mv_target_1']);
    expect(opponentZones?.handCount).toBe(1);
  });

  it('does not let control-change routing hijack an unrelated generic activation just because the permanent id contains control', async () => {
    const controlGameId = `${gameId}_control_change`;
    await resetGame(controlGameId);

    createGameIfNotExists(controlGameId, 'commander', 40);
    const game = ensureGame(controlGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_control_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'control_device_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'control_device_card_1',
          name: 'Control Device',
          type_line: 'Artifact',
          oracle_text: '{T}: Draw a card.\n{T}: Draw two cards. Target opponent gains control of Control Device.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(controlGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: controlGameId, permanentId: 'control_device_1', abilityId: 'control_device_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(controlGameId);
    expect(queue.steps).toHaveLength(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('draw a card');

    const source = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'control_device_1');
    expect(source?.controller).toBe(playerId);
    expect(Boolean(source?.tapped)).toBe(true);
  });
});
