import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import {
  classifyCopyPermanentTriggerPattern,
  isSupportedCopyPermanentTriggerPattern,
} from '../src/state/modules/trigger-copy-permanent.js';
import { parseTriggerEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

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

describe('trigger copy_permanent patterns', () => {
  it('classifies Unstable Shapeshifter ETB copy', () => {
    const steps = parseTriggerEffectSteps(
      'this creature becomes a copy of that creature, except it has this ability',
      'Unstable Shapeshifter',
    );
    expect(steps[0]).toMatchObject({ kind: 'copy_permanent' });
    expect(classifyCopyPermanentTriggerPattern(steps[0] as any)).toBe('self_from_that_creature');
    expect(isSupportedCopyPermanentTriggerPattern(steps[0]!)).toBe(true);
  });

  it('classifies Permeating Mass combat damage copy', () => {
    const steps = parseTriggerEffectSteps(
      'that creature becomes a copy of this creature.',
      'Permeating Mass',
    );
    expect(classifyCopyPermanentTriggerPattern(steps[0] as any)).toBe('that_creature_from_self');
    expect(isSupportedCopyPermanentTriggerPattern(steps[0]!)).toBe(true);
  });

  it('applies Permeating Mass copy when that_creature is provided in trigger context', () => {
    const gameId = 'permeating_mass_copy';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'mass_1',
        controller: p1,
        card: { name: 'Permeating Mass', type_line: 'Creature — Spirit', power: '1', toughness: '1' },
        power: 1,
        toughness: 1,
      },
      {
        id: 'bear_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        power: 2,
        toughness: 2,
      },
    ];

    executeTriggerEffect(
      game as any,
      p1,
      'Permeating Mass',
      'that creature becomes a copy of this creature.',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'mass_1',
        permanentId: 'mass_1',
        effectData: { targetPermanentId: 'bear_1' },
      },
    );

    const bear = (game.state as any).battlefield.find((perm: any) => perm.id === 'bear_1');
    expect(bear?.card?.name).toBe('Permeating Mass');
    expect(bear?.power).toBe(1);
  });

  it('queues Irma-style other-target copy selection', () => {
    const gameId = 'irma_copy';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'irma_1',
        controller: p1,
        card: { name: 'Irma, Part-Time Mutant', type_line: 'Creature — Human Mutant', power: '2', toughness: '2' },
        power: 2,
        toughness: 2,
      },
      {
        id: 'soldier_1',
        controller: p1,
        card: { name: 'Soldier', type_line: 'Creature — Soldier', power: '1', toughness: '1' },
        power: 1,
        toughness: 1,
      },
    ];

    ResolutionQueueManager.removeQueue(gameId);
    executeTriggerEffect(
      game as any,
      p1,
      'Irma, Part-Time Mutant',
      'irma becomes a copy of up to one other target creature you control, except her name is irma, part-time mutant and she has this ability. then put a +1/+1 counter on her.',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'irma_1',
        permanentId: 'irma_1',
      },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.some(step => step.type === ResolutionStepType.TARGET_SELECTION)).toBe(true);
  });

  describe('resolution handler E2E', () => {
    const gameId = 'irma_copy_resolution';
    const irmaEffect =
      'Irma becomes a copy of up to one other target creature you control, except her name is Irma, Part-Time Mutant and she has this ability. Then put a +1/+1 counter on her.';

    beforeAll(async () => {
      await initDb();
      initializePriorityResolutionHandler({
        to: () => ({ emit: () => {} }),
        emit: () => {},
        sockets: { sockets: new Map() },
      } as any);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    beforeEach(async () => {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
      createGameIfNotExists(gameId, 'commander', 40);
    });

    afterEach(async () => {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
    });

    it('applies Irma self-copy when target selection completes', async () => {
      const game = ensureGame(gameId)!;
      const p1 = 'p1';

      (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
      (game.state as any).battlefield = [
        {
          id: 'irma_1',
          controller: p1,
          owner: p1,
          counters: {},
          card: {
            name: 'Irma, Part-Time Mutant',
            type_line: 'Creature — Human Mutant',
            power: '2',
            toughness: '2',
          },
          power: 2,
          toughness: 2,
        },
        {
          id: 'soldier_1',
          controller: p1,
          owner: p1,
          card: {
            name: 'Soldier',
            type_line: 'Creature — Soldier',
            power: '3',
            toughness: '3',
          },
          power: 3,
          toughness: 3,
        },
      ];

      executeTriggerEffect(
        game as any,
        p1 as PlayerID,
        'Irma, Part-Time Mutant',
        irmaEffect,
        {
          type: 'triggered_ability',
          controller: p1,
          source: 'irma_1',
          permanentId: 'irma_1',
        },
      );

      const targetStep = ResolutionQueueManager
        .getStepsForPlayer(gameId, p1 as PlayerID)
        .find((step) => step.type === ResolutionStepType.TARGET_SELECTION) as any;
      expect(targetStep?.action).toBe('self_become_copy_of_creature');

      const emitted: Array<{ room?: string; event: string; payload: any }> = [];
      const { socket, handlers } = createMockSocket(p1, emitted);
      socket.rooms.add(gameId);
      const io = createMockIo(emitted, [socket]);

      registerResolutionHandlers(io, socket);
      registerInteractionHandlers(io, socket);

      await handlers.submitResolutionResponse?.({
        gameId,
        stepId: targetStep.id,
        selections: ['soldier_1'],
      });

      const irma = ensureGame(gameId)!
        .state.battlefield.find((perm: any) => perm.id === 'irma_1');
      expect(irma?.card?.name).toBe('Soldier');
      expect(irma?.power).toBe(3);
      expect(irma?.toughness).toBe(3);
      expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    });
  });
});
