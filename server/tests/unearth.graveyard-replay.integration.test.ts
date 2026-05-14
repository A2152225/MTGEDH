import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';

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

describe('unearth graveyard replay semantics (integration)', () => {
  const gameId = 'test_unearth_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('returns the card from graveyard to battlefield marked as unearthed during live activation', async () => {
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
            id: 'unearth_card_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).turnNumber = 3;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'unearth_card_1',
      abilityId: 'unearth',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.card?.id).toBe('unearth_card_1');
    expect(Boolean(battlefield[0]?.wasUnearthed)).toBe(true);
    expect(Boolean(battlefield[0]?.unearthed)).toBe(true);
    expect(Boolean(battlefield[0]?.card?.wasUnearthed)).toBe(true);
    const pendingLiveUnearthExile = ((game.state as any).pendingExileAtNextEndStep || []) as any[];
    expect(pendingLiveUnearthExile).toEqual(expect.arrayContaining([
      {
        permanentId: String(battlefield[0]?.id || ''),
        fireAtTurnNumber: 3,
        sourceName: 'Hellspark Elemental',
        createdBy: playerId,
      },
    ]));
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('exiles an unearthed creature if it leaves the battlefield early for hand', async () => {
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
            id: 'unearth_card_leave_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).turnNumber = 3;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'unearth_card_leave_1',
      abilityId: 'unearth',
    });

    const unearthedPermanentId = String(((game.state as any).battlefield || [])[0]?.id || '');
    expect(unearthedPermanentId).toBeTruthy();

    expect(movePermanentToHand(game as any, unearthedPermanentId)).toBe(true);

    const zones = (game.state as any).zones?.[playerId];
    expect((game.state as any).battlefield || []).toHaveLength(0);
    expect(zones?.handCount).toBe(0);
    expect(zones?.hand || []).toHaveLength(0);
    expect(zones?.graveyardCount).toBe(0);
    expect((zones?.graveyard || []).map((card: any) => card?.id)).not.toContain('unearth_card_leave_1');
    expect((zones?.exile || []).map((card: any) => card?.id)).toContain('unearth_card_leave_1');
  });

  it('uses a battlefield-granted unearth cost for live activation', async () => {
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
            id: 'granted_unearth_artifact_1',
            name: 'Scrapwork Automaton',
            type_line: 'Artifact Creature - Construct',
            oracle_text: 'When this creature enters, draw a card.',
            power: '2',
            toughness: '2',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mishra_grant_1',
        controller: playerId,
        tapped: false,
        card: {
          name: 'Mishra, Tamer of Mak Fawa',
          type_line: 'Legendary Creature - Human Artificer',
          oracle_text: 'Each artifact card in your graveyard has unearth {1}{B}{R}.',
        },
      },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 4;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'granted_unearth_artifact_1',
      abilityId: 'unearth',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    const battlefield = (game.state as any).battlefield || [];
    const unearthed = battlefield.find((perm: any) => perm?.card?.id === 'granted_unearth_artifact_1');
    expect(unearthed).toBeTruthy();
    expect(Boolean(unearthed?.wasUnearthed)).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    const activateEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'activateGraveyardAbility') as any;
    expect(activateEvent?.payload?.manaCost).toBe('{1}{B}{R}');
    expect(activateEvent?.payload?.createdPermanentIds).toEqual([unearthed?.id]);
  });

  it('queues and persists self ETB triggers for live unearth battlefield returns', async () => {
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
            id: 'unearth_card_2',
            name: 'Unearthed Visionary',
            type_line: 'Creature - Elemental Wizard',
            oracle_text: 'When Unearthed Visionary enters, draw a card.\nUnearth {1}{R}',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
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
      cardId: 'unearth_card_2',
      abilityId: 'unearth',
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect((game.state as any).stack).toHaveLength(1);
    expect(String((game.state as any).stack[0]?.source || '')).toBe(String(battlefield[0]?.id || ''));

    const persistedTrigger = getEvents(gameId)
      .slice(eventStart)
      .find((event: any) => event.type === 'pushTriggeredAbility') as any;
    expect(persistedTrigger).toBeTruthy();
    expect(String(persistedTrigger?.payload?.sourceId || '')).toBe(String(battlefield[0]?.id || ''));
    expect(String(persistedTrigger?.payload?.sourceName || '')).toBe('Unearthed Visionary');
  });

  it('queues and persists external ETB watcher triggers for live unearth battlefield returns', async () => {
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
            id: 'unearth_card_3',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'soul_warden_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'soul_warden_card_1',
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
      cardId: 'unearth_card_3',
      abilityId: 'unearth',
    });

    const liveTrigger = ((game.state as any).stack || []).find((item: any) => item?.source === 'soul_warden_perm_1') as any;
    expect(liveTrigger).toBeTruthy();
    expect(liveTrigger).toMatchObject({
      sourceName: 'Soul Warden',
      triggerType: 'creature_etb',
    });

    const persistedTrigger = getEvents(gameId)
      .slice(eventStart)
      .find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.sourceId === 'soul_warden_perm_1') as any;
    expect(persistedTrigger).toBeTruthy();
    expect(persistedTrigger.payload).toMatchObject({
      sourceId: 'soul_warden_perm_1',
      permanentId: 'soul_warden_perm_1',
      sourceName: 'Soul Warden',
      triggerType: 'creature_etb',
    });
  });

  it('queues and resolves the delayed unearth exile at the next end step', async () => {
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
            id: 'unearth_card_delayed_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 5;
    (game.state as any).turn = 5;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).pendingExileAtNextEndStep = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'unearth_card_delayed_1',
      abilityId: 'unearth',
    });

    const unearthedPermanentId = String(((game.state as any).battlefield || [])[0]?.id || '');
    expect(unearthedPermanentId).toBeTruthy();

    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];

    game.nextStep();

    expect((game.state as any).step).toBe('END');
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      sourceName: 'Hellspark Elemental',
      description: 'Exile them.',
      effect: 'Exile them.',
      delayedAction: 'exile',
      delayedPermanentIds: [unearthedPermanentId],
    });

    game.resolveTopOfStack();

    expect((((game.state as any).battlefield || []) as any[]).some((perm: any) => String(perm?.id || '') === unearthedPermanentId)).toBe(false);
    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => String(card?.id || ''))).toContain('unearth_card_delayed_1');
    expect((((game.state as any).pendingExileAtNextEndStep || []) as any[]).some(
      (entry: any) => String(entry?.permanentId || '') === unearthedPermanentId,
    )).toBe(false);
  });

  it('requires sorcery-speed timing for live unearth activation', async () => {
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
            id: 'unearth_timing_card_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).stack = [
      {
        id: 'unearth_stack_spell_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'unearth_stack_spell_card_1',
          name: 'Shock',
          type_line: 'Instant',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'unearth_timing_card_1',
      abilityId: 'unearth',
    });

    const errorEntry = emitted.filter((entry) => entry.event === 'error').at(-1);
    expect(errorEntry?.payload?.code).toBe('SORCERY_SPEED_ONLY');

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(1);
    expect(((game.state as any).battlefield || []).length).toBe(0);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 });
  });

  it('replays unearth by rebuilding the battlefield permanent with unearthed markers', () => {
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
            id: 'unearth_card_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).turnNumber = 4;
    (game.state as any).phase = 'main';

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'unearth_card_1',
      abilityId: 'unearth',
      manaCost: '{1}{R}',
      createdPermanentIds: ['perm_unearth_live_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('perm_unearth_live_1');
    expect(battlefield[0]?.card?.id).toBe('unearth_card_1');
    expect(Boolean(battlefield[0]?.wasUnearthed)).toBe(true);
    expect(Boolean(battlefield[0]?.unearthed)).toBe(true);
    expect(Boolean(battlefield[0]?.card?.wasUnearthed)).toBe(true);
    const pendingReplayUnearthExile = ((game.state as any).pendingExileAtNextEndStep || []) as any[];
    expect(pendingReplayUnearthExile).toEqual(expect.arrayContaining([
      {
        permanentId: 'perm_unearth_live_1',
        fireAtTurnNumber: 4,
        sourceName: 'Hellspark Elemental',
        createdBy: playerId,
      },
    ]));
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays the delayed unearth exile through the next end step', () => {
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
            id: 'unearth_card_replay_delayed_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 6;
    (game.state as any).turn = 6;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).pendingExileAtNextEndStep = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'unearth_card_replay_delayed_1',
      abilityId: 'unearth',
      manaCost: '{1}{R}',
      createdPermanentIds: ['perm_unearth_replay_delayed_1'],
    });

    expect((((game.state as any).pendingExileAtNextEndStep || []) as any[]).some(
      (entry: any) => String(entry?.permanentId || '') === 'perm_unearth_replay_delayed_1',
    )).toBe(true);

    (game.state as any).phase = 'postcombatMain';
    (game.state as any).step = 'MAIN2';
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];

    game.nextStep();

    expect((game.state as any).step).toBe('END');
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      sourceName: 'Hellspark Elemental',
      description: 'Exile them.',
      effect: 'Exile them.',
      delayedAction: 'exile',
      delayedPermanentIds: ['perm_unearth_replay_delayed_1'],
    });

    game.resolveTopOfStack();

    expect((((game.state as any).battlefield || []) as any[]).some(
      (perm: any) => String(perm?.id || '') === 'perm_unearth_replay_delayed_1',
    )).toBe(false);
    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => String(card?.id || ''))).toContain('unearth_card_replay_delayed_1');
    expect((((game.state as any).pendingExileAtNextEndStep || []) as any[]).some(
      (entry: any) => String(entry?.permanentId || '') === 'perm_unearth_replay_delayed_1',
    )).toBe(false);
  });

  it('replays persisted unearth life payments on non-cast graveyard branches', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'unearth_card_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'unearth_card_1',
      abilityId: 'unearth',
      manaCost: '{1}{R}',
      lifePaidForCost: 2,
      createdPermanentIds: ['perm_unearth_live_2'],
    });

    expect((game.state as any).life?.[playerId]).toBe(38);
    expect((game.state as any).lifeLostThisTurn?.[playerId]).toBe(2);
    expect((game.state as any).battlefield[0]?.id).toBe('perm_unearth_live_2');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('falls back to deterministic unearth permanent ids for legacy events without created ids', () => {
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
            id: 'unearth_card_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'unearth_card_1',
      abilityId: 'unearth',
      manaCost: '{1}{R}',
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).toMatch(/^perm_/);
    expect(battlefield[0]?.id).not.toBe('perm_unearth_live_1');
  });
});