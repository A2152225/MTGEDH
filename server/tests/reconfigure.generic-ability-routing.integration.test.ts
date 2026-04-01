import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { isCreatureNow } from '../src/state/creatureTypeNow.js';
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

describe('Reconfigure generic ability routing (integration)', () => {
  const gameId = 'test_reconfigure_generic_activation';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('routes parser-emitted reconfigure attach and unattach ids through live server handling', async () => {
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
    };
    (game.state as any).battlefield = [
      {
        id: 'reconfig_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'reconfig_card_1',
          name: 'Rabbit Battery',
          type_line: 'Artifact Creature - Equipment Rabbit',
          oracle_text: 'Equipped creature gets +1/+1 and has haste.\nReconfigure {1}',
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'target_card_1',
          name: 'Bear Cub',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(persistentGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    const reconfigurePermanent = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'reconfig_1');
    expect(isCreatureNow(reconfigurePermanent)).toBe(true);

    await handlers['activateBattlefieldAbility']({ gameId: persistentGameId, permanentId: 'reconfig_1', abilityId: 'reconfig_card_1-reconfigure-attach-0' });

    const queue = ResolutionQueueManager.getQueue(persistentGameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.abilityType).toBe('reconfigure_attach');
    expect(step.validTargets).toHaveLength(1);
    expect(step.validTargets[0]?.id).toBe('target_1');

    await handlers['submitResolutionResponse']({ gameId: persistentGameId, stepId: step.id, selections: ['target_1'] });

    const paymentStep = ResolutionQueueManager.getQueue(persistentGameId).steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.activationPaymentChoice).toBe(true);
    expect(paymentStep.manaCost).toBe('{1}');

    await handlers['submitResolutionResponse']({
      gameId: persistentGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:colorless', mana: 'C', count: 1 }],
      },
    });

    const stackAfterAttach = (game.state as any).stack || [];
    expect(stackAfterAttach).toHaveLength(1);
    expect(stackAfterAttach[0]?.abilityType).toBe('reconfigure_attach');
    expect(stackAfterAttach[0]?.reconfigureParams?.targetCreatureId).toBe('target_1');
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(3);

    game.resolveTopOfStack();

    const attachedReconfigurePermanent = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'reconfig_1');
    const targetCreature = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'target_1');
    expect(attachedReconfigurePermanent?.attachedTo).toBe('target_1');
    expect(targetCreature?.attachedEquipment).toContain('reconfig_1');
    expect(isCreatureNow(attachedReconfigurePermanent)).toBe(false);

    const persistedAttach = [...getEvents(persistentGameId)].reverse().find((event: any) => event.type === 'reconfigurePermanent') as any;
    expect(persistedAttach?.payload?.reconfigureId).toBe('reconfig_1');
    expect(persistedAttach?.payload?.targetCreatureId).toBe('target_1');

    const replayAttachGame = createInitialGameState(`${persistentGameId}_attach_replay`);
    replayAttachGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    (replayAttachGame.state as any).battlefield = [
      {
        id: 'reconfig_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'reconfig_card_1',
          name: 'Rabbit Battery',
          type_line: 'Artifact Creature - Equipment Rabbit',
          oracle_text: 'Equipped creature gets +1/+1 and has haste.\nReconfigure {1}',
          zone: 'battlefield',
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        attachedEquipment: [],
        isEquipped: false,
        card: {
          id: 'target_card_1',
          name: 'Bear Cub',
          type_line: 'Creature - Bear',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];

    replayAttachGame.applyEvent({ type: 'reconfigurePermanent', ...(persistedAttach.payload || {}) } as any);

    const replayAttachedReconfigurePermanent = ((replayAttachGame.state as any).battlefield || []).find((entry: any) => entry.id === 'reconfig_1');
    const replayAttachTarget = ((replayAttachGame.state as any).battlefield || []).find((entry: any) => entry.id === 'target_1');
    expect(replayAttachedReconfigurePermanent?.attachedTo).toBe('target_1');
    expect(replayAttachTarget?.attachedEquipment || []).toContain('reconfig_1');
    expect(Boolean(replayAttachTarget?.isEquipped)).toBe(true);

    await handlers['activateBattlefieldAbility']({ gameId: persistentGameId, permanentId: 'reconfig_1', abilityId: 'reconfig_card_1-reconfigure-unattach-1' });

    const stackAfterUnattach = (game.state as any).stack || [];
    expect(stackAfterUnattach).toHaveLength(1);
    expect(stackAfterUnattach[0]?.abilityType).toBe('reconfigure_unattach');
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(2);

    game.resolveTopOfStack();

    const unattachedReconfigurePermanent = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'reconfig_1');
    const refreshedTargetCreature = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'target_1');
    expect(unattachedReconfigurePermanent?.attachedTo).toBeUndefined();
    expect(refreshedTargetCreature?.attachedEquipment || []).not.toContain('reconfig_1');
    expect(isCreatureNow(unattachedReconfigurePermanent)).toBe(true);

    const persistedUnattach = [...getEvents(persistentGameId)].reverse().find((event: any) => event.type === 'reconfigureUnattachPermanent') as any;
    expect(persistedUnattach?.payload?.reconfigureId).toBe('reconfig_1');

    const replayUnattachGame = createInitialGameState(`${persistentGameId}_unattach_replay`);
    replayUnattachGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    (replayUnattachGame.state as any).battlefield = [
      {
        id: 'reconfig_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        attachedTo: 'target_1',
        counters: {},
        card: {
          id: 'reconfig_card_1',
          name: 'Rabbit Battery',
          type_line: 'Artifact Creature - Equipment Rabbit',
          oracle_text: 'Equipped creature gets +1/+1 and has haste.\nReconfigure {1}',
          zone: 'battlefield',
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        attachedEquipment: ['reconfig_1'],
        isEquipped: true,
        card: {
          id: 'target_card_1',
          name: 'Bear Cub',
          type_line: 'Creature - Bear',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];

    replayUnattachGame.applyEvent({ type: 'reconfigureUnattachPermanent', ...(persistedUnattach.payload || {}) } as any);

    const replayUnattachedReconfigurePermanent = ((replayUnattachGame.state as any).battlefield || []).find((entry: any) => entry.id === 'reconfig_1');
    const replayUnattachTarget = ((replayUnattachGame.state as any).battlefield || []).find((entry: any) => entry.id === 'target_1');
    expect(replayUnattachedReconfigurePermanent?.attachedTo).toBeUndefined();
    expect(replayUnattachTarget?.attachedEquipment || []).not.toContain('reconfig_1');
    expect(Boolean(replayUnattachTarget?.isEquipped)).toBe(false);
  });
});