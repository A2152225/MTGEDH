import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('attach equipment to permanent (integration)', () => {
  const gameId = 'test_attach_equipment_to_permanent';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('reattaches the chosen equipment from a previous creature to the target permanent', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'old_target',
        controller: p1,
        owner: p1,
        attachedEquipment: ['equip_1'],
        isEquipped: true,
        card: { name: 'Old Creature', type_line: 'Creature — Test' },
      },
      {
        id: 'new_target',
        controller: p1,
        owner: p1,
        attachedEquipment: [],
        isEquipped: false,
        card: { name: 'Kor Soldier', type_line: 'Token Creature — Kor Soldier' },
      },
      {
        id: 'equip_1',
        controller: p1,
        owner: p1,
        attachedTo: 'old_target',
        card: { name: 'Sword of Testing', type_line: 'Artifact — Equipment' },
      },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: You may attach an Equipment you control to the created Kor Soldier token.',
      mandatory: false,
      sourceName: 'Source',
      options: [
        { id: 'attach', label: 'Attach an Equipment' },
        { id: 'decline', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      attachEquipmentToPermanentChoice: true,
      attachEquipmentToPermanentTargetPermanentId: 'new_target',
      attachEquipmentToPermanentController: p1,
      attachEquipmentToPermanentSourceName: 'Source',
      attachEquipmentToPermanentTargetName: 'Kor Soldier token',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'attach' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).attachEquipmentToPermanentSelectEquipment).toBe(true);

    await handlers['submitResolutionResponse']({ gameId, stepId: (queue.steps[0] as any).id, selections: ['equip_1'] });

    const battlefield = (game.state as any).battlefield || [];
    const oldTarget = battlefield.find((perm: any) => perm.id === 'old_target');
    const newTarget = battlefield.find((perm: any) => perm.id === 'new_target');
    const equipment = battlefield.find((perm: any) => perm.id === 'equip_1');

    expect(oldTarget.attachedEquipment || []).toEqual([]);
    expect(oldTarget.isEquipped).toBe(false);
    expect(equipment.attachedTo).toBe('new_target');
    expect(newTarget.attachedEquipment || []).toEqual(['equip_1']);
    expect(newTarget.isEquipped).toBe(true);
  });
});