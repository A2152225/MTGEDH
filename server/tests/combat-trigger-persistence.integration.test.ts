import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ensureGame } from '../src/socket/util.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import type { PlayerID } from '../../shared/src';

async function resetGame(gameId: string) {
  games.delete(gameId as any);
  await deleteGame(gameId);
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

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('combat trigger persistence', () => {
  const trackedGameIds = new Set<string>();

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  it('persists attack trigger stack pushes as pushTriggeredAbility events', async () => {
    const gameId = `test_combat_trigger_persistence_${Date.now()}`;
    trackedGameIds.add(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).phase = 'combat';
    (game.state as any).priority = p1;
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_1',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'attacker_card_1',
          name: 'Signal Scout',
          type_line: 'Creature — Scout',
          oracle_text: 'Whenever ~ attacks, draw a card.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'attacker_1', targetPlayerId: p2 }],
    });

    const stack = (game.state as any).stack || [];
    expect(stack.some((item: any) => item?.type === 'triggered_ability' && String(item?.sourceName || '') === 'Signal Scout')).toBe(true);

    const events = getEvents(gameId);
    const triggerEvent = events.find((event) => event.type === 'pushTriggeredAbility');
    expect(triggerEvent).toBeTruthy();
    expect((triggerEvent as any).payload).toMatchObject({
      sourceName: 'Signal Scout',
      controllerId: p1,
      description: 'draw a card.',
      effect: 'draw a card.',
      triggerType: 'attacks',
      triggeringPlayer: p1,
    });
  });

  it('orders simultaneous attack triggers by APNAP before stack push', async () => {
    const gameId = `test_combat_attack_trigger_apnap_${Date.now()}`;
    trackedGameIds.add(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).phase = 'combat';
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p3]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'attack_apnap_attacker',
        controller: p1,
        owner: p1,
        basePower: 3,
        baseToughness: 3,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'attack_apnap_attacker_card',
          name: 'Attack APNAP Attacker',
          type_line: 'Creature - Soldier',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
      {
        id: 'p3_attack_aura',
        controller: p3,
        owner: p3,
        attachedTo: 'attack_apnap_attacker',
        tapped: false,
        card: {
          id: 'p3_attack_aura_card',
          name: 'P3 Attack Aura',
          type_line: 'Enchantment - Aura',
          oracle_text: 'Whenever enchanted creature attacks, scry 1.',
        },
      },
      {
        id: 'p2_attack_aura',
        controller: p2,
        owner: p2,
        attachedTo: 'attack_apnap_attacker',
        tapped: false,
        card: {
          id: 'p2_attack_aura_card',
          name: 'P2 Attack Aura',
          type_line: 'Enchantment - Aura',
          oracle_text: 'Whenever enchanted creature attacks, gain 1 life.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'attack_apnap_attacker', targetPlayerId: p2 }],
    });

    const attackTriggers = ((game.state as any).stack || []).filter((item: any) =>
      item?.type === 'triggered_ability' && String(item?.sourceName || '').includes('Attack Aura')
    );
    expect(attackTriggers.map((item: any) => item.sourceName)).toEqual([
      'P2 Attack Aura',
      'P3 Attack Aura',
    ]);
    expect(attackTriggers.map((item: any) => item.controller)).toEqual([p2, p3]);

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && String(event?.payload?.sourceName || '').includes('Attack Aura')
    );
    expect(triggerEvents.map((event: any) => event.payload?.sourceName)).toEqual([
      'P2 Attack Aura',
      'P3 Attack Aura',
    ]);
    expect(triggerEvents.map((event: any) => event.payload?.controllerId)).toEqual([p2, p3]);
  });

  it('orders controlled-combat tap triggers by APNAP before stack push', async () => {
    const gameId = `test_controlled_combat_tap_trigger_apnap_${Date.now()}`;
    trackedGameIds.add(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';
    const p4 = 'p4';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
      { id: p4, name: 'P4', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40, [p4]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).phase = 'combat';
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p3]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p4]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'p3_tap_attacker',
        controller: p3,
        owner: p3,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'p3_tap_attacker_card',
          name: 'P3 Tap Attacker',
          type_line: 'Creature - Wizard',
          oracle_text: 'Whenever this creature becomes tapped, scry 1.',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'p2_tap_attacker',
        controller: p2,
        owner: p2,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'p2_tap_attacker_card',
          name: 'P2 Tap Attacker',
          type_line: 'Creature - Wizard',
          oracle_text: 'Whenever this creature becomes tapped, draw a card.',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io as any, socket as any);

    await handlers['applyCombatControl']({
      gameId,
      sourceId: 'master_warcraft',
      sourceName: 'Master Warcraft',
      controlsAttackers: true,
      controlsBlockers: false,
    });

    await handlers['declareControlledAttackers']({
      gameId,
      attackers: [
        { creatureId: 'p3_tap_attacker', targetPlayerId: p4 },
        { creatureId: 'p2_tap_attacker', targetPlayerId: p4 },
      ],
    });

    const tapTriggers = ((game.state as any).stack || []).filter((item: any) =>
      item?.type === 'triggered_ability' && String(item?.sourceName || '').includes('Tap Attacker')
    );
    expect(tapTriggers.map((item: any) => item.sourceName)).toEqual([
      'P2 Tap Attacker',
      'P3 Tap Attacker',
    ]);
    expect(tapTriggers.map((item: any) => item.controller)).toEqual([p2, p3]);

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && String(event?.payload?.sourceName || '').includes('Tap Attacker')
    );
    expect(triggerEvents.map((event: any) => event.payload?.sourceName)).toEqual([
      'P2 Tap Attacker',
      'P3 Tap Attacker',
    ]);
    expect(triggerEvents.map((event: any) => event.payload?.controllerId)).toEqual([p2, p3]);
  });

  it('queues controlled-combat attack triggers in APNAP order before stack push', async () => {
    const gameId = `test_controlled_combat_attack_trigger_apnap_${Date.now()}`;
    trackedGameIds.add(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';
    const p4 = 'p4';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
      { id: p4, name: 'P4', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40, [p4]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).phase = 'combat';
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p3]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p4]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'p3_attack_attacker',
        controller: p3,
        owner: p3,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'p3_attack_attacker_card',
          name: 'P3 Attack Attacker',
          type_line: 'Creature - Wizard',
          oracle_text: 'Whenever ~ attacks, scry 1.',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'p2_attack_attacker',
        controller: p2,
        owner: p2,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'p2_attack_attacker_card',
          name: 'P2 Attack Attacker',
          type_line: 'Creature - Wizard',
          oracle_text: 'Whenever ~ attacks, draw a card.',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io as any, socket as any);

    await handlers['applyCombatControl']({
      gameId,
      sourceId: 'master_warcraft',
      sourceName: 'Master Warcraft',
      controlsAttackers: true,
      controlsBlockers: false,
    });

    await handlers['declareControlledAttackers']({
      gameId,
      attackers: [
        { creatureId: 'p3_attack_attacker', targetPlayerId: p4 },
        { creatureId: 'p2_attack_attacker', targetPlayerId: p4 },
      ],
    });

    const attackTriggers = ((game.state as any).stack || []).filter((item: any) =>
      item?.type === 'triggered_ability' && String(item?.sourceName || '').includes('Attack Attacker')
    );
    expect(attackTriggers.map((item: any) => item.sourceName)).toEqual([
      'P2 Attack Attacker',
      'P3 Attack Attacker',
    ]);
    expect(attackTriggers.map((item: any) => item.controller)).toEqual([p2, p3]);

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && String(event?.payload?.sourceName || '').includes('Attack Attacker')
    );
    expect(triggerEvents.map((event: any) => event.payload?.sourceName)).toEqual([
      'P2 Attack Attacker',
      'P3 Attack Attacker',
    ]);
    expect(triggerEvents.map((event: any) => event.payload?.controllerId)).toEqual([p2, p3]);
  });

  it('replays persisted combat trigger metadata including value and defending player', () => {
    const game = createInitialGameState('t_combat_trigger_replay');
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'combat_trigger_1',
      sourceId: 'attacker_1',
      sourceName: 'Signal Scout',
      controllerId: p1,
      description: 'Signal Scout gets +2/+0 until end of turn.',
      triggerType: 'attacks',
      effect: 'Signal Scout gets +2/+0 until end of turn.',
      mandatory: true,
      value: 2,
      targetPlayer: 'p2',
      defendingPlayer: 'p2',
      triggeringPlayer: p1,
      damagedPlayerId: 'p2',
      attackingPlayerId: p1,
      damageAmount: 3,
      damageSourcePermanentIds: ['attacker_1'],
      damageIncludedWarriorSource: false,
    } as any);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      id: 'combat_trigger_1',
      sourceName: 'Signal Scout',
      value: 2,
      targetPlayer: 'p2',
      defendingPlayer: 'p2',
      triggeringPlayer: p1,
      damagedPlayerId: 'p2',
      attackingPlayerId: p1,
      damageAmount: 3,
      damageSourcePermanentIds: ['attacker_1'],
      damageIncludedWarriorSource: false,
    });
  });

  it('persists combat damage trigger stack pushes as pushTriggeredAbility events', async () => {
    const gameId = `test_combat_damage_trigger_persistence_${Date.now()}`;
    trackedGameIds.add(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'declareBlockers';
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'damage_attacker_1',
        controller: p1,
        owner: p1,
        basePower: 3,
        baseToughness: 3,
        tapped: true,
        summoningSickness: false,
        attacking: p2,
        blockedBy: [],
        card: {
          id: 'damage_attacker_card_1',
          name: 'Damage Scout',
          type_line: 'Creature — Scout',
          oracle_text: 'Whenever ~ deals combat damage to a player, draw a card.',
          power: '3',
          toughness: '3',
        },
      },
    ];

    game.applyEvent({ type: 'nextStep' });

    const stack = (game.state as any).stack || [];
    expect(stack.some((item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Damage Scout')).toBe(true);

    const events = getEvents(gameId);
    const triggerEvent = events.find((event) => event.type === 'pushTriggeredAbility' && (event as any).payload?.sourceName === 'Damage Scout');
    expect(triggerEvent).toBeTruthy();
    expect((triggerEvent as any).payload).toMatchObject({
      sourceName: 'Damage Scout',
      controllerId: p1,
      description: 'draw a card',
      effect: 'draw a card',
      triggerType: 'deals_combat_damage',
      targetPlayer: p2,
      defendingPlayer: p2,
      damagedPlayerId: p2,
      damageAmount: 3,
      effectData: {
        sourcePermanentId: 'damage_attacker_1',
        damagedPlayerId: p2,
        damageAmount: 3,
      },
    });
  });

  it('orders simultaneous defender combat damage triggers by APNAP before stack push', async () => {
    const gameId = `test_combat_damage_trigger_apnap_${Date.now()}`;
    trackedGameIds.add(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'declareBlockers';
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p3]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_to_p3',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        tapped: true,
        summoningSickness: false,
        attacking: p3,
        blockedBy: [],
        card: {
          id: 'attacker_to_p3_card',
          name: 'Attacker To P3',
          type_line: 'Creature - Soldier',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'attacker_to_p2',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        tapped: true,
        summoningSickness: false,
        attacking: p2,
        blockedBy: [],
        card: {
          id: 'attacker_to_p2_card',
          name: 'Attacker To P2',
          type_line: 'Creature - Soldier',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'p3_damage_receiver',
        controller: p3,
        owner: p3,
        tapped: false,
        counters: {},
        card: {
          id: 'p3_damage_receiver_card',
          name: 'P3 Damage Receiver',
          type_line: 'Artifact',
          oracle_text: "Whenever you're dealt combat damage, draw a card.",
        },
      },
      {
        id: 'p2_damage_receiver',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'p2_damage_receiver_card',
          name: 'P2 Damage Receiver',
          type_line: 'Artifact',
          oracle_text: "Whenever you're dealt combat damage, draw a card.",
        },
      },
    ];

    game.applyEvent({ type: 'nextStep' });

    const combatDamageTriggers = ((game.state as any).stack || []).filter((item: any) =>
      item?.type === 'triggered_ability' && String(item?.sourceName || '').includes('Damage Receiver')
    );
    expect(combatDamageTriggers.map((item: any) => item.sourceName)).toEqual([
      'P2 Damage Receiver',
      'P3 Damage Receiver',
    ]);

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && String(event?.payload?.sourceName || '').includes('Damage Receiver')
    );
    expect(triggerEvents.map((event: any) => event.payload?.sourceName)).toEqual([
      'P2 Damage Receiver',
      'P3 Damage Receiver',
    ]);
  });

  it('orders simultaneous batched combat damage triggers by APNAP before stack push', async () => {
    const gameId = `test_batched_combat_damage_trigger_apnap_${Date.now()}`;
    trackedGameIds.add(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'declareBlockers';
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p3]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_from_p3',
        controller: p3,
        owner: p3,
        basePower: 2,
        baseToughness: 2,
        tapped: true,
        summoningSickness: false,
        attacking: p1,
        blockedBy: [],
        card: {
          id: 'attacker_from_p3_card',
          name: 'Attacker From P3',
          type_line: 'Creature - Soldier',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'attacker_from_p2',
        controller: p2,
        owner: p2,
        basePower: 2,
        baseToughness: 2,
        tapped: true,
        summoningSickness: false,
        attacking: p1,
        blockedBy: [],
        card: {
          id: 'attacker_from_p2_card',
          name: 'Attacker From P2',
          type_line: 'Creature - Soldier',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'p3_batched_trigger',
        controller: p3,
        owner: p3,
        tapped: false,
        counters: {},
        card: {
          id: 'p3_batched_trigger_card',
          name: 'P3 Batched Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever one or more creatures you control deal combat damage to a player, create a Treasure token.',
        },
      },
      {
        id: 'p2_batched_trigger',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'p2_batched_trigger_card',
          name: 'P2 Batched Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever one or more creatures you control deal combat damage to a player, create a Treasure token.',
        },
      },
    ];

    game.applyEvent({ type: 'nextStep' });

    const combatDamageTriggers = ((game.state as any).stack || []).filter((item: any) =>
      item?.type === 'triggered_ability' && String(item?.sourceName || '').includes('Batched Trigger')
    );
    expect(combatDamageTriggers.map((item: any) => item.sourceName)).toEqual([
      'P2 Batched Trigger',
      'P3 Batched Trigger',
    ]);
    expect(combatDamageTriggers.map((item: any) => item.controller)).toEqual([p2, p3]);

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && String(event?.payload?.sourceName || '').includes('Batched Trigger')
    );
    expect(triggerEvents.map((event: any) => event.payload?.sourceName)).toEqual([
      'P2 Batched Trigger',
      'P3 Batched Trigger',
    ]);
    expect(triggerEvents.map((event: any) => event.payload?.triggerType)).toEqual([
      'creatures_deal_combat_damage_batched',
      'creatures_deal_combat_damage_batched',
    ]);
  });

  it('grants Agent of the Shadow Thieves attack trigger to a battlefield commander flagged with isCommander', async () => {
    const gameId = `test_agent_background_attack_trigger_${Date.now()}`;
    trackedGameIds.add(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).phase = 'combat';
    (game.state as any).priority = p1;
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'baeloth_1',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        isCommander: true,
        counters: {},
        temporaryAbilities: [],
        basePower: 2,
        baseToughness: 5,
        card: {
          id: 'baeloth_card_1',
          name: 'Baeloth Barrityl, Entertainer',
          type_line: 'Legendary Creature — Elf Shaman',
          oracle_text: 'Choose a Background',
          power: '2',
          toughness: '5',
        },
      },
      {
        id: 'agent_1',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'agent_card_1',
          name: 'Agent of the Shadow Thieves',
          type_line: 'Legendary Enchantment — Background',
          oracle_text: 'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn."',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'baeloth_1', targetPlayerId: p2 }],
    });

    const stack = (game.state as any).stack || [];
    const trigger = stack.find(
      (item: any) => item?.type === 'triggered_ability' && item?.source === 'baeloth_1'
    );
    expect(trigger).toBeTruthy();
    expect(String(trigger?.description || '').toLowerCase()).toContain('put a +1/+1 counter on this creature');
    expect(trigger?.defendingPlayer).toBe(p2);

    game.resolveTopOfStack();

    const baeloth = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'baeloth_1');
    expect(baeloth?.counters?.['+1/+1']).toBe(1);
    expect(Array.isArray(baeloth?.temporaryAbilities) ? baeloth.temporaryAbilities : []).toEqual(
      expect.arrayContaining(['deathtouch', 'indestructible'])
    );
  });
});
