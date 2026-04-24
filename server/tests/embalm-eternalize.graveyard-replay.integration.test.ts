import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

async function resetGame(gameId: string) {
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('embalm and eternalize graveyard replay semantics (integration)', () => {
  const gameId = 'test_embalm_eternalize_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('live embalm exiles the original card and creates a token copy', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'embalm_card_1',
            name: 'Sacred Cat',
            type_line: 'Creature - Cat',
            oracle_text: 'Lifelink\nEmbalm {W}',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'embalm_card_1',
      abilityId: 'embalm',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('embalm_card_1');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(Boolean(battlefield[0]?.isToken)).toBe(true);
    expect(String(battlefield[0]?.card?.name || '')).toBe('Sacred Cat');
    expect(String(battlefield[0]?.card?.type_line || '')).toBe('Creature - Zombie Cat');
    expect(battlefield[0]?.card?.colors).toEqual(['W']);
    expect(battlefield[0]?.card?.mana_cost).toBeUndefined();
    expect(battlefield[0]?.card?.cmc).toBe(0);
    expect(battlefield[0]?.basePower).toBe(1);
    expect(battlefield[0]?.baseToughness).toBe(1);
    expect(Boolean(battlefield[0]?.summoningSickness)).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays eternalize by exiling the original card and rebuilding the 4/4 token copy', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'eternalize_card_1',
            name: 'Champion of Wits',
            type_line: 'Creature - Naga Wizard',
            oracle_text: 'When Champion of Wits enters, you may draw cards.\nEternalize {5}{U}{U}',
            power: '2',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 5 },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'eternalize_card_1',
      abilityId: 'eternalize',
      manaCost: '{5}{U}{U}',
      createdPermanentIds: ['token_eternalize_live_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('eternalize_card_1');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('token_eternalize_live_1');
    expect(Boolean(battlefield[0]?.isToken)).toBe(true);
    expect(String(battlefield[0]?.card?.name || '')).toBe('Champion of Wits');
    expect(String(battlefield[0]?.card?.type_line || '')).toBe('Creature - Zombie Naga Wizard');
    expect(battlefield[0]?.card?.colors).toEqual(['B']);
    expect(battlefield[0]?.card?.mana_cost).toBeUndefined();
    expect(battlefield[0]?.card?.cmc).toBe(0);
    expect(battlefield[0]?.card?.power).toBe('4');
    expect(battlefield[0]?.card?.toughness).toBe('4');
    expect(battlefield[0]?.basePower).toBe(4);
    expect(battlefield[0]?.baseToughness).toBe(4);
    expect(Boolean(battlefield[0]?.summoningSickness)).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('live eternalize queues and persists the token\'s self ETB trigger', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'eternalize_card_2',
            name: 'Champion of Wits',
            type_line: 'Creature - Naga Wizard',
            oracle_text: 'When Champion of Wits enters, you may draw cards.\nEternalize {5}{U}{U}',
            power: '2',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 5 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [];

    const eventStart = getEvents(gameId).length;
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'eternalize_card_2',
      abilityId: 'eternalize',
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]?.source).toBe(battlefield[0]?.id);
    expect(String((game.state as any).stack[0]?.sourceName || '')).toBe('Champion of Wits');

    const triggerEvents = getEvents(gameId).slice(eventStart);
    const persistedTrigger = triggerEvents.find((event: any) => event.type === 'pushTriggeredAbility') as any;
    expect(persistedTrigger).toBeTruthy();
    expect(String(persistedTrigger?.payload?.sourceId || '')).toBe(String(battlefield[0]?.id || ''));
    expect(String(persistedTrigger?.payload?.sourceName || '')).toBe('Champion of Wits');
  });

  it('queues and persists external ETB watcher triggers for live embalm token entries', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'embalm_card_2',
            name: 'Sacred Cat',
            type_line: 'Creature - Cat',
            oracle_text: 'Lifelink\nEmbalm {W}',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'soul_warden_perm_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'soul_warden_card_2',
          name: 'Soul Warden',
          type_line: 'Creature - Human Cleric',
          oracle_text: 'Whenever another creature enters the battlefield, you gain 1 life.',
          power: '1',
          toughness: '1',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [];

    const eventStart = getEvents(gameId).length;
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'embalm_card_2',
      abilityId: 'embalm',
    });

    const liveTrigger = ((game.state as any).stack || []).find((item: any) => item?.source === 'soul_warden_perm_2') as any;
    expect(liveTrigger).toBeTruthy();
    expect(liveTrigger).toMatchObject({
      sourceName: 'Soul Warden',
      triggerType: 'creature_etb',
    });

    const persistedTrigger = getEvents(gameId)
      .slice(eventStart)
      .find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.sourceId === 'soul_warden_perm_2') as any;
    expect(persistedTrigger).toBeTruthy();
    expect(persistedTrigger.payload).toMatchObject({
      sourceId: 'soul_warden_perm_2',
      permanentId: 'soul_warden_perm_2',
      sourceName: 'Soul Warden',
      triggerType: 'creature_etb',
    });
  });

  it('replays external ETB watcher triggers after embalm rebuilds the token entry', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'embalm_card_replay_1',
            name: 'Sacred Cat',
            type_line: 'Creature - Cat',
            oracle_text: 'Lifelink\nEmbalm {W}',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'soul_warden_perm_replay_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'soul_warden_card_replay_1',
          name: 'Soul Warden',
          type_line: 'Creature - Human Cleric',
          oracle_text: 'Whenever another creature enters the battlefield, you gain 1 life.',
          power: '1',
          toughness: '1',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'embalm_card_replay_1',
      abilityId: 'embalm',
      manaCost: '{W}',
      createdPermanentIds: ['token_embalm_replay_1'],
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'soul_warden_embalm_trigger_replay_1',
      sourceId: 'soul_warden_perm_replay_1',
      permanentId: 'soul_warden_perm_replay_1',
      sourceName: 'Soul Warden',
      controllerId: playerId,
      description: 'you gain 1 life.',
      triggerType: 'creature_etb',
      effect: 'Whenever another creature enters the battlefield, you gain 1 life.',
      mandatory: true,
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((permanent: any) => permanent?.id === 'token_embalm_replay_1')).toBeTruthy();

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      id: 'soul_warden_embalm_trigger_replay_1',
      source: 'soul_warden_perm_replay_1',
      sourceName: 'Soul Warden',
      triggerType: 'creature_etb',
      description: 'you gain 1 life.',
    });
  });

  it('falls back to deterministic embalm token ids for legacy events without created ids', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'embalm_card_1',
            name: 'Sacred Cat',
            type_line: 'Creature - Cat',
            oracle_text: 'Lifelink\nEmbalm {W}',
            power: '1',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'embalm_card_1',
      abilityId: 'embalm',
      manaCost: '{W}',
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).toMatch(/^token_embalm_/);
    expect(battlefield[0]?.id).not.toBe('token_eternalize_live_1');
    expect(String(battlefield[0]?.card?.name || '')).toBe('Sacred Cat');
    expect(String(battlefield[0]?.card?.type_line || '')).toBe('Creature - Zombie Cat');
    expect(battlefield[0]?.card?.colors).toEqual(['W']);
    expect(battlefield[0]?.card?.mana_cost).toBeUndefined();
    expect(battlefield[0]?.card?.cmc).toBe(0);
  });
});