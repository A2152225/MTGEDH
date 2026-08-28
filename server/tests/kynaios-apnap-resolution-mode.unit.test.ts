import { describe, expect, it, afterEach } from 'vitest';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { enterResolutionModeIfQueuePending } from '../src/state/modules/priority.js';
import { runTurnStepCleanup } from '../src/state/modules/turn-handlers/turnStepCleanup.js';
import { shouldAutoResolveResolutionStep } from '../src/socket/resolution-handlers/resolutionAutoResolveGate.js';

describe('Kynaios APNAP resolution-mode and cleanup bounce guards', () => {
  const gameId = 'test_kynaios_apnap_resolution_mode';

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('enters resolution mode when an APNAP batch queues more than one step', () => {
    const ctx: any = {
      gameId,
      state: {
        priority: 'p1',
        turnPlayer: 'p1',
        players: [
          { id: 'p1', name: 'P1', spectator: false, life: 40 },
          { id: 'p2', name: 'P2', spectator: false, life: 40 },
          { id: 'p3', name: 'P3', spectator: false, life: 40 },
          { id: 'p4', name: 'P4', spectator: false, life: 40 },
        ],
      },
      bumpSeq: () => {},
    };

    ResolutionQueueManager.addStepsWithAPNAP(
      gameId,
      [
        { type: ResolutionStepType.KYNAIOS_CHOICE, playerId: 'p1', description: 'p1', mandatory: false },
        { type: ResolutionStepType.KYNAIOS_CHOICE, playerId: 'p2', description: 'p2', mandatory: false },
        { type: ResolutionStepType.KYNAIOS_CHOICE, playerId: 'p3', description: 'p3', mandatory: false },
        { type: ResolutionStepType.KYNAIOS_CHOICE, playerId: 'p4', description: 'p4', mandatory: false },
      ] as any,
      ['p1', 'p2', 'p3', 'p4'],
      'p1',
    );

    const summary = ResolutionQueueManager.getPendingSummary(gameId);
    expect(summary.pendingCount).toBe(4);
    expect(enterResolutionModeIfQueuePending(ctx, gameId)).toBe(true);
    expect(ctx.state.priority).toBeNull();
  });

  it('auto-resolves kynaios immediately for AI, not for idle auto-pass humans', () => {
    const game: any = {
      state: {
        turnPlayer: 'p1',
        priority: 'p2',
        phase: 'ending',
        step: 'END',
        stack: [],
        autoPassPlayers: new Set(['p2']),
        players: [
          { id: 'p1', name: 'AI', isAI: true, spectator: false, life: 40 },
          { id: 'p2', name: 'IdleAutoPass', spectator: false, life: 40 },
          { id: 'p3', name: 'Human', spectator: false, life: 40 },
        ],
        zones: {
          p2: { hand: [], handCount: 0 },
          p3: { hand: [], handCount: 0 },
        },
        battlefield: [],
      },
    };

    expect(shouldAutoResolveResolutionStep(game, 'p1')).toBe(true);
    expect(shouldAutoResolveResolutionStep(game, 'p2')).toBe(false);
    expect(shouldAutoResolveResolutionStep(game, 'p3')).toBe(false);
  });

  it('does not finish cleanup while the stack still has a bounce trigger', () => {
    const ctx: any = {
      gameId,
      state: {
        turnPlayer: 'p1',
        phase: 'ending',
        step: 'CLEANUP',
        stack: [{ id: 'bounce_1', type: 'triggered_ability', triggerType: 'etb_bounce_land' }],
        players: [{ id: 'p1', name: 'P1', spectator: false, life: 40 }],
        zones: { p1: { hand: [], handCount: 0 } },
        battlefield: [],
      },
      bumpSeq: () => {},
    };

    const result = runTurnStepCleanup(ctx, false);
    expect(result.shouldCallNextTurn).toBe(false);
    expect(ctx.state.stack).toHaveLength(1);
  });
});
