import { describe, it, expect } from 'vitest';
import { emitPendingDamageTriggers } from '../src/socket/game-actions.js';
import { flushPendingDamageTriggersAfterStepAdvance } from '../src/socket/step-advance.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

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
  } as any;
}

describe('Pending damage triggers (emission)', () => {
  it('does not emit when there are no pending triggers', () => {
    const gameId = 'game_1';
    ResolutionQueueManager.clearAllSteps(gameId);

    const emitted = emitPendingDamageTriggers(
      {} as any,
      {
        state: {
          battlefield: [],
          pendingDamageTriggers: {},
        },
      } as any,
      gameId
    );

    expect(emitted).toBe(0);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(0);
  });

  it('enqueues one TARGET_SELECTION step per queued trigger with source image when present', () => {
    const gameId = 'game_2';
    ResolutionQueueManager.clearAllSteps(gameId);

    const game = {
      state: {
        players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
        battlefield: [
          {
            id: 'src_1',
            card: {
              name: 'Brash Taunter',
              image_uris: { small: 'https://example.com/small.jpg' },
              type_line: 'Creature — Goblin',
            },
          },
          {
            id: 'perm_1',
            controller: 'p2',
            card: {
              name: 'Grizzly Bears',
              type_line: 'Creature — Bear',
              image_uris: { small: 'https://example.com/bears.jpg' },
            },
          },
        ],
        pendingDamageTriggers: {
          trig_1: {
            sourceId: 'src_1',
            sourceName: 'Brash Taunter',
            controller: 'p1',
            damageAmount: 5,
            targetType: 'any',
            targetRestriction: 'any target',
          },
        },
      },
    } as any;

    const emitted = emitPendingDamageTriggers({} as any, game, gameId);

    expect(emitted).toBe(1);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    const step = queue.steps[0] as any;

    expect(step.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(step.playerId).toBe('p1');
    expect(step.sourceId).toBe('src_1');
    expect(step.sourceName).toBe('Brash Taunter');
    expect(step.sourceImage).toBe('https://example.com/small.jpg');
    expect(step.damageReceivedTrigger).toBe(true);
    expect(step.damageTrigger?.triggerId).toBe('trig_1');
    expect(step.damageTrigger?.damageAmount).toBe(5);
    expect(Array.isArray(step.validTargets)).toBe(true);
    expect(step.validTargets.length).toBeGreaterThan(0);
  });

  it('offers opponents and planeswalkers for opponent-or-planeswalker damage triggers', () => {
    const gameId = 'game_wall_of_souls_emit';
    ResolutionQueueManager.clearAllSteps(gameId);

    const game = {
      state: {
        players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
        battlefield: [
          {
            id: 'src_wall',
            controller: 'p1',
            card: {
              name: 'Wall of Souls',
              type_line: 'Creature — Wall',
            },
          },
          {
            id: 'pw_1',
            controller: 'p1',
            card: {
              name: 'Liliana of the Veil',
              type_line: 'Legendary Planeswalker — Liliana',
            },
          },
          {
            id: 'creature_1',
            controller: 'p2',
            card: {
              name: 'Grizzly Bears',
              type_line: 'Creature — Bear',
            },
          },
        ],
        pendingDamageTriggers: {
          trig_wall: {
            sourceId: 'src_wall',
            sourceName: 'Wall of Souls',
            controller: 'p1',
            damageAmount: 3,
            targetType: 'opponent_or_planeswalker',
            targetRestriction: 'opponent or planeswalker',
          },
        },
      },
    } as any;

    const emitted = emitPendingDamageTriggers({} as any, game, gameId);
    expect(emitted).toBe(1);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.targetDescription).toBe('target opponent or planeswalker');
    expect(step.validTargets.map((t: any) => t.id)).toContain('p2');
    expect(step.validTargets.map((t: any) => t.id)).toContain('pw_1');
    expect(step.validTargets.map((t: any) => t.id)).not.toContain('p1');
    expect(step.validTargets.map((t: any) => t.id)).not.toContain('creature_1');
  });

  it('auto-resolves combat-damage life-gain triggers without creating a target step', () => {
    const gameId = 'game_wall_of_essence_emit';
    ResolutionQueueManager.clearAllSteps(gameId);

    const game = {
      state: {
        players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
        startingLife: 40,
        life: { p1: 40, p2: 40 },
        battlefield: [
          {
            id: 'src_essence',
            controller: 'p1',
            card: {
              name: 'Wall of Essence',
              type_line: 'Creature — Wall',
            },
          },
        ],
        pendingDamageTriggers: {
          trig_essence: {
            sourceId: 'src_essence',
            sourceName: 'Wall of Essence',
            controller: 'p1',
            damageAmount: 4,
            targetType: 'none',
            effect: 'You gain that much life',
            effectMode: 'gain_life',
          },
        },
      },
    } as any;

    const emitted = emitPendingDamageTriggers(createNoopIo(), game, gameId);
    expect(emitted).toBe(1);
    expect((game.state as any).life.p1).toBe(44);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(0);
  });

  it('auto-resolves Souls of the Faultless using the recorded attacking player', () => {
    const gameId = 'game_souls_faultless_emit';
    ResolutionQueueManager.clearAllSteps(gameId);

    const game = {
      state: {
        players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
        startingLife: 40,
        life: { p1: 40, p2: 40 },
        battlefield: [
          {
            id: 'src_souls',
            controller: 'p1',
            card: {
              name: 'Souls of the Faultless',
              type_line: 'Creature — Spirit',
            },
          },
        ],
        pendingDamageTriggers: {
          trig_souls: {
            sourceId: 'src_souls',
            sourceName: 'Souls of the Faultless',
            controller: 'p1',
            damageAmount: 3,
            targetType: 'none',
            effect: 'You gain that much life and attacking player loses that much life',
            effectMode: 'gain_life_and_attacking_player_loses_life',
            attackingPlayerId: 'p2',
          },
        },
      },
    } as any;

    const emitted = emitPendingDamageTriggers(createNoopIo(), game, gameId);
    expect(emitted).toBe(1);
    expect((game.state as any).life.p1).toBe(43);
    expect((game.state as any).life.p2).toBe(37);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(0);
  });

  it('flushes queued damage trigger prompts immediately after a step advance', () => {
    const gameId = 'game_damage_trigger_step_advance';
    ResolutionQueueManager.clearAllSteps(gameId);

    const game = {
      nextStep: () => {
        (game.state as any).pendingDamageTriggers = {
          trig_wall: {
            sourceId: 'src_wall',
            sourceName: 'Wall of Souls',
            controller: 'p1',
            damageAmount: 3,
            targetType: 'opponent_or_planeswalker',
            targetRestriction: 'opponent or planeswalker',
          },
        };
      },
      state: {
        players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
        battlefield: [
          {
            id: 'src_wall',
            controller: 'p1',
            card: {
              name: 'Wall of Souls',
              type_line: 'Creature — Wall',
            },
          },
          {
            id: 'pw_1',
            controller: 'p1',
            card: {
              name: 'Liliana of the Veil',
              type_line: 'Legendary Planeswalker — Liliana',
            },
          },
        ],
      },
    } as any;

    game.nextStep();
    const emitted = flushPendingDamageTriggersAfterStepAdvance(createNoopIo(), game, gameId);

    expect(emitted).toBe(1);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(step.sourceName).toBe('Wall of Souls');
    expect(step.targetDescription).toBe('target opponent or planeswalker');
  });
});
