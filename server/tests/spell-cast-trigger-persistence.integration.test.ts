import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, gameId, spectator: false },
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

function setupCastingGame(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    p1: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
    p2: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };

  return game;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('cast spell trigger persistence (integration)', () => {
  const merrowGameId = 'test_spell_cast_trigger_persistence_merrow';
  const rhysticGameId = 'test_spell_cast_trigger_persistence_rhystic';
  const vegaHandGameId = 'test_spell_cast_trigger_persistence_vega_hand';
  const vegaExileGameId = 'test_spell_cast_trigger_persistence_vega_exile';
  const appaHandGameId = 'test_spell_cast_trigger_persistence_appa_hand';
  const appaExileGameId = 'test_spell_cast_trigger_persistence_appa_exile';
  const grafkeeperFlashbackGameId = 'test_spell_cast_trigger_persistence_grafkeeper_flashback';
  const rhysticFlashbackGameId = 'test_spell_cast_trigger_persistence_rhystic_flashback';
  const ominousRoostFlashbackGameId = 'test_spell_cast_trigger_persistence_ominous_roost_flashback';
  const resetGameIds = [merrowGameId, rhysticGameId, vegaHandGameId, vegaExileGameId, appaHandGameId, appaExileGameId, grafkeeperFlashbackGameId, rhysticFlashbackGameId, ominousRoostFlashbackGameId];

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of resetGameIds) {
      await resetGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of resetGameIds) {
      await resetGame(gameId);
    }
  });

  it('persists targeted spell-cast triggers as pushTriggeredAbility events', async () => {
    const game = setupCastingGame(merrowGameId);
    (game.state as any).battlefield = [
      {
        id: 'reejerey_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'reejerey_card',
          name: 'Merrow Reejerey',
          type_line: 'Creature — Merfolk Soldier',
          oracle_text: 'Whenever you cast a Merfolk spell, you may tap or untap target permanent.',
        },
      },
      {
        id: 'target_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'target_perm_card',
          name: 'Test Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];
    (game.state as any).zones.p1.hand = [
      {
        id: 'merfolk_spell_1',
        name: 'Judge of Currents',
        mana_cost: '{0}',
        manaCost: '{0}',
        type_line: 'Creature — Merfolk Wizard',
        oracle_text: 'Whenever a Merfolk you control becomes tapped, you may gain 1 life.',
      },
    ];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', merrowGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId: merrowGameId,
      cardId: 'merfolk_spell_1',
      targets: [],
    });

    const triggerPushEvents = getEvents(merrowGameId).filter((event) => String(event?.type) === 'pushTriggeredAbility');
    expect(triggerPushEvents.length).toBeGreaterThan(0);

    const merrowTriggerEvent = triggerPushEvents.find(
      (event: any) => String(event?.payload?.sourceName || '') === 'Merrow Reejerey'
    ) as any;
    expect(merrowTriggerEvent).toBeDefined();
    expect(merrowTriggerEvent.payload).toMatchObject({
      sourceName: 'Merrow Reejerey',
      triggerType: 'cast_creature_type',
      mandatory: false,
      requiresTarget: true,
      targetType: 'permanent',
    });

    const persistedTrigger = ((game.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Merrow Reejerey'
    );
    expect(persistedTrigger).toMatchObject({
      requiresTarget: true,
      targetType: 'permanent',
    });
  });

  it('persists opponent spell-cast triggers as pushTriggeredAbility events', async () => {
    const game = setupCastingGame(rhysticGameId);
    (game.state as any).battlefield = [
      {
        id: 'rhystic_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'rhystic_card',
          name: 'Rhystic Study',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      },
    ];
    (game.state as any).zones.p1.hand = [
      {
        id: 'noncreature_spell_1',
        name: 'Test Insight',
        mana_cost: '{0}',
        manaCost: '{0}',
        type_line: 'Sorcery',
        oracle_text: 'Draw a card.',
      },
    ];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', rhysticGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId: rhysticGameId,
      cardId: 'noncreature_spell_1',
      targets: [],
    });

    const triggerPushEvents = getEvents(rhysticGameId).filter((event) => String(event?.type) === 'pushTriggeredAbility');
    expect(triggerPushEvents.length).toBeGreaterThan(0);

    const rhysticTriggerEvent = triggerPushEvents.find(
      (event: any) => String(event?.payload?.sourceName || '') === 'Rhystic Study'
    ) as any;
    expect(rhysticTriggerEvent).toBeDefined();
    expect(rhysticTriggerEvent.payload).toMatchObject({
      sourceName: 'Rhystic Study',
      triggerType: 'rhystic_study',
      targetPlayer: 'p1',
      triggeringPlayer: 'p1',
      effectData: {
        casterId: 'p1',
      },
    });

    const persistedTrigger = ((game.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Rhystic Study'
    );
    expect(persistedTrigger).toMatchObject({
      targetPlayer: 'p1',
      triggeringPlayer: 'p1',
      effectData: expect.objectContaining({
        casterId: 'p1',
      }),
    });
  });

  it('does not fire from-anywhere-other-than-hand triggers on ordinary hand casts', async () => {
    const game = setupCastingGame(vegaHandGameId);
    (game.state as any).battlefield = [
      {
        id: 'vega_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'vega_card',
          name: 'Vega, the Watcher',
          type_line: 'Legendary Creature — Bird Spirit',
          oracle_text: 'Flying\nWhenever you cast a spell from anywhere other than your hand, draw a card.',
        },
      },
    ];
    (game.state as any).zones.p1.hand = [
      {
        id: 'hand_spell_1',
        name: 'Hand Insight',
        mana_cost: '',
        manaCost: '{0}',
        type_line: 'Sorcery',
        oracle_text: 'Draw a card.',
      },
    ];
    (game.state as any).zones.p1.handCount = 1;
    (game.state as any).zones.p1.libraryCount = 1;
    (game as any).libraries = new Map([
      ['p1', [
        {
          id: 'library_draw_1',
          name: 'Library Draw',
          type_line: 'Instant',
          oracle_text: 'Draw a card.',
        },
      ]],
      ['p2', []],
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', vegaHandGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId: vegaHandGameId,
      cardId: 'hand_spell_1',
      targets: [],
    });

    expect((game.state as any).zones.p1.handCount).toBe(0);
    expect((((game.state as any).zones.p1.hand) || []).map((card: any) => card.id)).not.toContain('library_draw_1');
    expect((game.state as any).zones.p1.libraryCount).toBe(1);
  });

  it('fires from-anywhere-other-than-hand triggers on exile casts', async () => {
    const game = setupCastingGame(vegaExileGameId);
    (game.state as any).battlefield = [
      {
        id: 'vega_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'vega_card',
          name: 'Vega, the Watcher',
          type_line: 'Legendary Creature — Bird Spirit',
          oracle_text: 'Flying\nWhenever you cast a spell from anywhere other than your hand, draw a card.',
        },
      },
    ];
    (game.state as any).playableFromExile = { p1: { exile_spell_1: 999 } };
    (game.state as any).zones.p1.exile = [
      {
        id: 'exile_spell_1',
        name: 'Exile Insight',
        mana_cost: '',
        manaCost: '{0}',
        type_line: 'Sorcery',
        oracle_text: 'Draw a card.',
        zone: 'exile',
      },
    ];
    (game.state as any).zones.p1.exileCount = 1;
    (game.state as any).zones.p1.libraryCount = 1;
    (game as any).libraries = new Map([
      ['p1', [
        {
          id: 'library_draw_1',
          name: 'Library Draw',
          type_line: 'Instant',
          oracle_text: 'Draw a card.',
        },
      ]],
      ['p2', []],
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', vegaExileGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId: vegaExileGameId,
      cardId: 'exile_spell_1',
      fromZone: 'exile',
      targets: [],
    });

    expect((game.state as any).zones.p1.handCount).toBe(1);
    expect((((game.state as any).zones.p1.hand) || []).map((card: any) => card.id)).toContain('library_draw_1');
    expect((game.state as any).zones.p1.libraryCount).toBe(0);
  });

  it('does not fire cast-from-exile triggers on ordinary hand casts', async () => {
    const game = setupCastingGame(appaHandGameId);
    (game.state as any).battlefield = [
      {
        id: 'appa_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'appa_card',
          name: 'Appa, Steadfast Guardian',
          type_line: 'Legendary Creature — Bison Ally',
          oracle_text: 'Flash\nFlying\nWhenever you cast a spell from exile, create a 1/1 white Ally creature token.',
        },
      },
    ];
    (game.state as any).zones.p1.hand = [
      {
        id: 'hand_spell_1',
        name: 'Hand Insight',
        mana_cost: '',
        manaCost: '{0}',
        type_line: 'Sorcery',
        oracle_text: 'Draw a card.',
      },
    ];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', appaHandGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId: appaHandGameId,
      cardId: 'hand_spell_1',
      targets: [],
    });

    expect(((game.state as any).battlefield || []).filter((perm: any) => String(perm?.controller || '') === 'p1')).toHaveLength(1);
  });

  it('fires cast-from-exile triggers on exile casts', async () => {
    const game = setupCastingGame(appaExileGameId);
    (game.state as any).battlefield = [
      {
        id: 'appa_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'appa_card',
          name: 'Appa, Steadfast Guardian',
          type_line: 'Legendary Creature — Bison Ally',
          oracle_text: 'Flash\nFlying\nWhenever you cast a spell from exile, create a 1/1 white Ally creature token.',
        },
      },
    ];
    (game.state as any).playableFromExile = { p1: { exile_spell_1: 999 } };
    (game.state as any).zones.p1.exile = [
      {
        id: 'exile_spell_1',
        name: 'Exile Insight',
        mana_cost: '',
        manaCost: '{0}',
        type_line: 'Sorcery',
        oracle_text: 'Draw a card.',
        zone: 'exile',
      },
    ];
    (game.state as any).zones.p1.exileCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', appaExileGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId: appaExileGameId,
      cardId: 'exile_spell_1',
      fromZone: 'exile',
      targets: [],
    });

    const playerPermanents = ((game.state as any).battlefield || []).filter((perm: any) => String(perm?.controller || '') === 'p1');
    expect(playerPermanents).toHaveLength(2);
    const tokenPermanent = playerPermanents.find((perm: any) => (perm as any)?.isToken === true);
    expect(tokenPermanent).toBeDefined();
    expect(String((tokenPermanent as any)?.card?.name || '')).toContain('Ally');
    expect(String((tokenPermanent as any)?.card?.type_line || '')).toContain('Ally');
  });

  it('persists cast-from-graveyard targeted triggers on graveyard casts', async () => {
    const game = setupCastingGame(grafkeeperFlashbackGameId);
    (game.state as any).battlefield = [
      {
        id: 'grafkeeper_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'grafkeeper_card',
          name: 'Devoted Grafkeeper',
          type_line: 'Creature — Human Peasant',
          oracle_text: 'Whenever you cast a spell from your graveyard, tap target creature you don\'t control.\nDisturb {1}{W}{U}',
        },
      },
      {
        id: 'enemy_creature_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'enemy_creature_card',
          name: 'Enemy Bear',
          type_line: 'Creature — Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).manaPool = {
      p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones.p1.graveyard = [
      {
        id: 'flashback_spell_1',
        name: 'Think Twice',
        mana_cost: '{1}{U}',
        manaCost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Draw a card.\nFlashback {U}.',
        zone: 'graveyard',
      },
    ];
    (game.state as any).zones.p1.graveyardCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', grafkeeperFlashbackGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: grafkeeperFlashbackGameId,
      cardId: 'flashback_spell_1',
      abilityId: 'flashback',
    });

    const triggerPushEvents = getEvents(grafkeeperFlashbackGameId).filter((event) => String(event?.type) === 'pushTriggeredAbility');
    const grafkeeperTriggerEvent = triggerPushEvents.find(
      (event: any) => String(event?.payload?.sourceName || '') === 'Devoted Grafkeeper'
    ) as any;
    expect(grafkeeperTriggerEvent).toBeDefined();
    expect(grafkeeperTriggerEvent.payload).toMatchObject({
      sourceName: 'Devoted Grafkeeper',
      triggerType: 'cast_creature_type',
      mandatory: true,
      requiresTarget: true,
      targetType: 'permanent',
    });

    const persistedTrigger = ((game.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Devoted Grafkeeper'
    );
    expect(persistedTrigger).toMatchObject({
      requiresTarget: true,
      targetType: 'permanent',
    });
  });

  it('persists opponent spell-cast triggers on graveyard casts', async () => {
    const game = setupCastingGame(rhysticFlashbackGameId);
    (game.state as any).battlefield = [
      {
        id: 'rhystic_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'rhystic_card',
          name: 'Rhystic Study',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      },
    ];
    (game.state as any).manaPool = {
      p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones.p1.graveyard = [
      {
        id: 'flashback_spell_1',
        name: 'Think Twice',
        mana_cost: '{1}{U}',
        manaCost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Draw a card.\nFlashback {U}.',
        zone: 'graveyard',
      },
    ];
    (game.state as any).zones.p1.graveyardCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', rhysticFlashbackGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: rhysticFlashbackGameId,
      cardId: 'flashback_spell_1',
      abilityId: 'flashback',
    });

    const triggerPushEvents = getEvents(rhysticFlashbackGameId).filter((event) => String(event?.type) === 'pushTriggeredAbility');
    const rhysticTriggerEvent = triggerPushEvents.find(
      (event: any) => String(event?.payload?.sourceName || '') === 'Rhystic Study'
    ) as any;
    expect(rhysticTriggerEvent).toBeDefined();
    expect(rhysticTriggerEvent.payload).toMatchObject({
      sourceName: 'Rhystic Study',
      triggerType: 'rhystic_study',
      targetPlayer: 'p1',
      triggeringPlayer: 'p1',
      effectData: {
        casterId: 'p1',
      },
    });
  });

  it('creates typed graveyard-cast tokens with keyword text', async () => {
    const game = setupCastingGame(ominousRoostFlashbackGameId);
    (game.state as any).battlefield = [
      {
        id: 'ominous_roost_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'ominous_roost_card',
          name: 'Ominous Roost',
          type_line: 'Enchantment',
          oracle_text: 'When this enchantment enters and whenever you cast a spell from your graveyard, create a 1/1 blue Bird creature token with flying and "This token can block only creatures with flying."',
        },
      },
    ];
    (game.state as any).manaPool = {
      p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones.p1.graveyard = [
      {
        id: 'flashback_spell_1',
        name: 'Think Twice',
        mana_cost: '{1}{U}',
        manaCost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Draw a card.\nFlashback {U}.',
        zone: 'graveyard',
      },
    ];
    (game.state as any).zones.p1.graveyardCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', ominousRoostFlashbackGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId: ominousRoostFlashbackGameId,
      cardId: 'flashback_spell_1',
      abilityId: 'flashback',
    });

    const playerPermanents = ((game.state as any).battlefield || []).filter((perm: any) => String(perm?.controller || '') === 'p1');
    expect(playerPermanents).toHaveLength(2);
    const tokenPermanent = playerPermanents.find((perm: any) => (perm as any)?.isToken === true);
    expect(tokenPermanent).toBeDefined();
    expect(String((tokenPermanent as any)?.card?.name || '')).toContain('Bird');
    expect(String((tokenPermanent as any)?.card?.type_line || '')).toContain('Bird');
    expect(String((tokenPermanent as any)?.card?.oracle_text || '')).toContain('Flying');
  });
});
