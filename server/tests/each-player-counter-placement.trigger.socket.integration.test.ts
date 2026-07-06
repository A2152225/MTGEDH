import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { resolveTriggeredAbilityStackItem } from '../src/state/modules/stackResolveTriggeredAbilityOrchestratorUtils.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const gameId = 'test_each_player_counter_placement_trigger_ir';
const playerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;
const effectText = 'each player may put two +1/+1 counters on a creature they control';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: () => undefined }),
    emit: () => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])) },
  } as any;
}

function createMockSocket(pid: string, gid: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId: pid, spectator: false },
    rooms: new Set<string>([gid]),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gid: string) {
  ResolutionQueueManager.removeQueue(gid);
  games.delete(gid as any);
  try {
    await deleteGame(gid);
  } catch {
    // test-only cleanup
  }
}

describe('each-player counter placement trigger (Layer 3 IR primary)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameId);
  });

  function seedGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    games.set(gameId as any, game as any);

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).activePlayer = playerId;
    (game.state as any).battlefield = [
      {
        id: 'bear',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          name: 'Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
      {
        id: 'elf',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        card: {
          name: 'Elf',
          type_line: 'Creature — Elf',
          power: '1',
          toughness: '1',
          zone: 'battlefield',
        },
      },
    ];
    return game;
  }

  it('queues APNAP counterPlacementTrigger steps for each player (not effect-program yes/no)', async () => {
    const game = seedGame();

    executeTriggerEffect(game as any, playerId, 'Agitator Ant', effectText, {
      id: 'agitator_end_step',
      source: 'agitator',
      sourceId: 'agitator',
    });

    const steps = ResolutionQueueManager.getQueue(gameId).steps;
    expect(steps.length).toBe(2);
    expect(steps.every((step) => step.type === ResolutionStepType.OPTION_CHOICE)).toBe(true);
    expect(steps.every((step) => (step as any).counterPlacementTrigger === true)).toBe(true);
    expect(steps.some((step) => (step as any).effectProgramPrompt === true)).toBe(false);
    expect(steps.map((step) => step.playerId)).toEqual([playerId, opponentId]);
    expect((steps[0] as any).options?.map((opt: any) => opt.id)).toEqual(['decline', 'bear']);
  }, 20000);

  it('resolves upkeep stack items without controller yes/no deferral (Orzhov Advokist)', async () => {
    const game = seedGame();
    const effectText = 'each player may put two +1/+1 counters on a creature they control';
    const stackItem = {
      id: 'advokist_upkeep_stack',
      type: 'triggered_ability',
      controller: playerId,
      source: 'advokist',
      sourceName: 'Orzhov Advokist',
      description: effectText,
      effect: effectText,
      triggerType: 'upkeep',
      mandatory: true,
      requiresChoice: true,
      card: {
        oracle_text:
          'At the beginning of your upkeep, each player may put two +1/+1 counters on a creature they control. ' +
          "If a player does, creatures that player controls can't attack you or planeswalkers you control until your next turn.",
      },
    };

    resolveTriggeredAbilityStackItem(game as any, {
      item: stackItem,
      controller: playerId,
      executeTriggerEffect,
    });

    const steps = ResolutionQueueManager.getQueue(gameId).steps;
    expect(steps.length).toBe(2);
    expect(steps.every((step) => (step as any).counterPlacementTrigger === true)).toBe(true);
    expect(steps.some((step) => (step as any).effectProgramPrompt === true)).toBe(false);
  }, 20000);

  it('applies +1/+1 counters when both players choose creatures', async () => {
    const game = seedGame();

    executeTriggerEffect(game as any, playerId, 'Agitator Ant', effectText, {
      id: 'agitator_end_step_resolve',
      source: 'agitator',
      sourceId: 'agitator',
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: socketP1, handlers: handlersP1 } = createMockSocket(playerId, gameId, emitted);
    const { socket: socketP2, handlers: handlersP2 } = createMockSocket(opponentId, gameId, emitted);
    const io = createMockIo(emitted, [socketP1, socketP2]);
    registerResolutionHandlers(io as any, socketP1 as any);
    registerResolutionHandlers(io as any, socketP2 as any);

    const p1Step = ResolutionQueueManager.getQueue(gameId).steps.find((step) => step.playerId === playerId)!;
    await handlersP1['submitResolutionResponse']({
      gameId,
      stepId: p1Step.id,
      selections: 'bear',
    });

    const p2Step = ResolutionQueueManager.getQueue(gameId).steps.find((step) => step.playerId === opponentId)!;
    await handlersP2['submitResolutionResponse']({
      gameId,
      stepId: p2Step.id,
      selections: 'elf',
    });

    const bear = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'bear');
    const elf = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'elf');
    expect(bear?.counters?.['+1/+1']).toBe(2);
    expect(elf?.counters?.['+1/+1']).toBe(2);
  }, 20000);
});
