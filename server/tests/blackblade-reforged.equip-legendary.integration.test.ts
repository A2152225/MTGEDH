import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/gameState.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
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

describe('Blackblade Reforged legendary equip (integration)', () => {
  const gameId = 'test_blackblade_reforged_legendary_equip';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues equip payment after targeting and preserves unselected floating mana', async () => {
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 3 },
    };
    (game.state as any).battlefield = [
      {
        id: 'blackblade_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'blackblade_card_1',
          name: 'Blackblade Reforged',
          type_line: 'Legendary Artifact - Equipment',
          oracle_text: 'Equipped creature gets +1/+1 for each land you control. Equip legendary creature {3}. Equip {7}',
        },
      },
      {
        id: 'commander_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        isCommander: true,
        card: {
          id: 'commander_card_1',
          name: 'Baeloth Barrityl, Entertainer',
          type_line: 'Legendary Creature - Elf Shaman',
          oracle_text: 'Choose a Background',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature - Cat',
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

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'blackblade_1',
      abilityId: 'blackblade_card_1-equip-0',
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.abilityType).toBe('equip');
    expect(step.equipCost).toBe('{3}');
    expect(step.validTargets.map((target: any) => target.id)).toEqual(['commander_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['commander_1'],
    });

    const paymentPrompt = emitted
      .filter((entry) => entry.event === 'resolutionStepPrompt')
      .map((entry) => entry.payload)
      .find((payload: any) => String(payload?.step?.type || '') === 'mana_payment_choice');
    expect(paymentPrompt?.step).toEqual(
      expect.objectContaining({
        activationPaymentChoice: true,
        activationPaymentContext: 'battlefield_targeted',
        confirmLabel: 'Pay and Activate',
        manaCost: '{3}',
      })
    );

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.activationPaymentChoice).toBe(true);
    expect(paymentStep.activationPaymentContext).toBe('battlefield_targeted');
    expect(paymentStep.manaCost).toBe('{3}');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:colorless', mana: 'C', count: 3 }],
      },
    });

    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);
    expect((game.state as any).manaPool?.[playerId]?.red).toBe(1);
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.abilityType).toBe('equip');
    expect(stack[0]?.equipParams?.targetCreatureId).toBe('commander_1');
  });

  it('persists resolved equip attachments so restore rebuilds attached and equipped state', async () => {
    const persistentGameId = `${gameId}_persisted_attach_${Math.random().toString(36).slice(2, 10)}`;
    ResolutionQueueManager.removeQueue(persistentGameId);
    games.delete(persistentGameId as any);

    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
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
    (game.state as any).battlefield = [
      {
        id: 'equipment_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'equipment_card_1',
          name: 'Test Sword',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Equip {2}',
          zone: 'battlefield',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        attachedEquipment: [],
        isEquipped: false,
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature - Cat',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(persistentGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: persistentGameId,
      permanentId: 'equipment_1',
      abilityId: 'equipment_card_1-equip-0',
    });

    const targetStep = ResolutionQueueManager.getQueue(persistentGameId).steps[0] as any;
    await handlers['submitResolutionResponse']({
      gameId: persistentGameId,
      stepId: String(targetStep.id),
      selections: ['creature_1'],
    });

    const paymentStep = ResolutionQueueManager.getQueue(persistentGameId).steps[0] as any;
    await handlers['submitResolutionResponse']({
      gameId: persistentGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:colorless', mana: 'C', count: 2 }],
      },
    });

    expect(Array.isArray((game.state as any).stack)).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    const equipment = (game.state as any).battlefield.find((entry: any) => entry.id === 'equipment_1');
    const creature = (game.state as any).battlefield.find((entry: any) => entry.id === 'creature_1');
    expect(equipment?.attachedTo).toBe('creature_1');
    expect(creature?.attachedEquipment || []).toContain('equipment_1');
    expect(Boolean(creature?.isEquipped)).toBe(true);

    const persisted = [...getEvents(persistentGameId)].reverse().find((event: any) => event.type === 'equipPermanent') as any;
    expect(persisted?.payload?.equipmentId).toBe('equipment_1');
    expect(persisted?.payload?.targetCreatureId).toBe('creature_1');

    const replayGame = createInitialGameState(`${persistentGameId}_replay`);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    (replayGame.state as any).battlefield = [
      {
        id: 'equipment_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'equipment_card_1',
          name: 'Test Sword',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Equip {2}',
          zone: 'battlefield',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        attachedEquipment: [],
        isEquipped: false,
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature - Cat',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];

    replayGame.applyEvent({ type: 'equipPermanent', ...(persisted.payload || {}) } as any);

    const replayEquipment = (replayGame.state as any).battlefield.find((entry: any) => entry.id === 'equipment_1');
    const replayCreature = (replayGame.state as any).battlefield.find((entry: any) => entry.id === 'creature_1');
    expect(replayEquipment?.attachedTo).toBe('creature_1');
    expect(replayCreature?.attachedEquipment || []).toContain('equipment_1');
    expect(Boolean(replayCreature?.isEquipped)).toBe(true);
  });

  it('persists tapped payment sources for equip activations so replay restores mana-source taps', async () => {
    const persistentGameId = `${gameId}_persisted_payment_taps_${Math.random().toString(36).slice(2, 10)}`;
    ResolutionQueueManager.removeQueue(persistentGameId);
    games.delete(persistentGameId as any);

    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
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
    (game.state as any).battlefield = [
      {
        id: 'equipment_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'equipment_card_1',
          name: 'Test Sword',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Equip {2}',
          zone: 'battlefield',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        attachedEquipment: [],
        isEquipped: false,
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature - Cat',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
      {
        id: 'wastes_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'wastes_card_1',
          name: 'Wastes',
          type_line: 'Basic Land',
          oracle_text: '{T}: Add {C}.',
          zone: 'battlefield',
        },
      },
      {
        id: 'wastes_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'wastes_card_2',
          name: 'Wastes',
          type_line: 'Basic Land',
          oracle_text: '{T}: Add {C}.',
          zone: 'battlefield',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(persistentGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: persistentGameId,
      permanentId: 'equipment_1',
      abilityId: 'equipment_card_1-equip-0',
    });

    const targetStep = ResolutionQueueManager.getQueue(persistentGameId).steps[0] as any;
    await handlers['submitResolutionResponse']({
      gameId: persistentGameId,
      stepId: String(targetStep.id),
      selections: ['creature_1'],
    });

    const paymentStep = ResolutionQueueManager.getQueue(persistentGameId).steps[0] as any;
    await handlers['submitResolutionResponse']({
      gameId: persistentGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: 'wastes_1', mana: 'C', count: 1 },
          { permanentId: 'wastes_2', mana: 'C', count: 1 },
        ],
      },
    });

    const persisted = [...getEvents(persistentGameId)].reverse().find((event: any) => event.type === 'activateBattlefieldAbility') as any;
    expect(persisted?.payload?.tappedPermanents || []).toEqual(expect.arrayContaining(['wastes_1', 'wastes_2']));

    const replayGame = createInitialGameState(`${persistentGameId}_replay`);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    (replayGame.state as any).battlefield = [
      {
        id: 'equipment_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'equipment_card_1',
          name: 'Test Sword',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Equip {2}',
          zone: 'battlefield',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        attachedEquipment: [],
        isEquipped: false,
        card: {
          id: 'creature_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature - Cat',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
      {
        id: 'wastes_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'wastes_card_1',
          name: 'Wastes',
          type_line: 'Basic Land',
          oracle_text: '{T}: Add {C}.',
          zone: 'battlefield',
        },
      },
      {
        id: 'wastes_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'wastes_card_2',
          name: 'Wastes',
          type_line: 'Basic Land',
          oracle_text: '{T}: Add {C}.',
          zone: 'battlefield',
        },
      },
    ];

    replayGame.applyEvent({ type: 'activateBattlefieldAbility', ...(persisted?.payload || {}) } as any);

    const replayWastes1 = (replayGame.state as any).battlefield.find((entry: any) => entry.id === 'wastes_1');
    const replayWastes2 = (replayGame.state as any).battlefield.find((entry: any) => entry.id === 'wastes_2');
    expect(Boolean(replayWastes1?.tapped)).toBe(true);
    expect(Boolean(replayWastes2?.tapped)).toBe(true);
  });
});