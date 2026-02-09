import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { handleKynaiosChoiceResponse } from '../src/state/resolution/handlers/kynaiosChoice.js';

function makeIoStub() {
  const emit = vi.fn();
  return {
    emit,
    io: {
      to: vi.fn(() => ({ emit })),
    },
  };
}

describe('KynaiosChoice resolution', () => {
  const deps = { getPlayerName: (_game: any, pid: any) => String(pid) };

  beforeEach(() => {
    // Ensure no queue bleed between tests.
    ResolutionQueueManager.removeQueue('g1');
    ResolutionQueueManager.removeQueue('g2');
  });

  afterEach(() => {
    ResolutionQueueManager.removeQueue('g1');
    ResolutionQueueManager.removeQueue('g2');
  });

  it('delays opponent draws until all choices complete ("then" clause)', () => {
    const { io } = makeIoStub();
    const gameId = 'g1';

    const game: any = {
      state: {
        zones: {
          A: { hand: [{ id: 'a-land', name: 'Forest', type_line: 'Land', zone: 'hand' }], handCount: 1 },
          B: { hand: [{ id: 'b-land', name: 'Plains', type_line: 'Land', zone: 'hand' }], handCount: 1 },
          C: { hand: [], handCount: 0 },
        },
        battlefield: [],
        pendingDraws: {},
      },
    };

    const batchId = 'batch-1';
    const configs: any[] = [
      {
        type: ResolutionStepType.KYNAIOS_CHOICE,
        playerId: 'A',
        description: 'A choice',
        mandatory: false,
        sourceName: 'Kynaios and Tiro of Meletis',
        kynaiosBatchId: batchId,
        isController: true,
        sourceController: 'A',
        canPlayLand: true,
        landsInHand: [{ id: 'a-land', name: 'Forest' }],
        options: ['play_land', 'decline'],
      },
      {
        type: ResolutionStepType.KYNAIOS_CHOICE,
        playerId: 'B',
        description: 'B choice',
        mandatory: false,
        sourceName: 'Kynaios and Tiro of Meletis',
        kynaiosBatchId: batchId,
        isController: false,
        sourceController: 'A',
        canPlayLand: true,
        landsInHand: [{ id: 'b-land', name: 'Plains' }],
        options: ['play_land', 'draw_card'],
      },
      {
        type: ResolutionStepType.KYNAIOS_CHOICE,
        playerId: 'C',
        description: 'C choice',
        mandatory: false,
        sourceName: 'Kynaios and Tiro of Meletis',
        kynaiosBatchId: batchId,
        isController: false,
        sourceController: 'A',
        canPlayLand: false,
        landsInHand: [],
        options: ['play_land', 'draw_card'],
      },
    ];

    const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, configs, ['A', 'B', 'C'], 'A');
    const stepA = steps.find((s) => s.playerId === 'A')!;
    const stepB = steps.find((s) => s.playerId === 'B')!;
    const stepC = steps.find((s) => s.playerId === 'C')!;

    // B chooses to draw (but should not draw until the batch is finished)
    const respB: any = { stepId: stepB.id, playerId: 'B', selections: { choice: 'draw_card' }, cancelled: false, timestamp: Date.now() };
    const completedB = ResolutionQueueManager.completeStep(gameId, stepB.id, respB)!;
    handleKynaiosChoiceResponse(io, game, gameId, completedB as any, respB, deps);

    expect(game.state.pendingDraws.B || 0).toBe(0);

    // C also chooses to draw
    const respC: any = { stepId: stepC.id, playerId: 'C', selections: { choice: 'draw_card' }, cancelled: false, timestamp: Date.now() };
    const completedC = ResolutionQueueManager.completeStep(gameId, stepC.id, respC)!;
    handleKynaiosChoiceResponse(io, game, gameId, completedC as any, respC, deps);

    expect(game.state.pendingDraws.C || 0).toBe(0);

    // A (controller) declines to put a land
    const respA: any = { stepId: stepA.id, playerId: 'A', selections: { choice: 'decline' }, cancelled: false, timestamp: Date.now() };
    const completedA = ResolutionQueueManager.completeStep(gameId, stepA.id, respA)!;
    handleKynaiosChoiceResponse(io, game, gameId, completedA as any, respA, deps);

    // Now the "then" clause applies
    expect(game.state.pendingDraws.B || 0).toBe(1);
    expect(game.state.pendingDraws.C || 0).toBe(1);
    expect(game.state.pendingDraws.A || 0).toBe(0);
  });

  it('does not grant a draw to an opponent who put a land onto the battlefield', () => {
    const { io } = makeIoStub();
    const gameId = 'g2';

    const game: any = {
      state: {
        zones: {
          A: { hand: [], handCount: 0 },
          B: { hand: [{ id: 'b-land', name: 'Plains', type_line: 'Land', zone: 'hand' }], handCount: 1 },
        },
        battlefield: [],
        pendingDraws: {},
      },
    };

    const batchId = 'batch-2';
    const configs: any[] = [
      {
        type: ResolutionStepType.KYNAIOS_CHOICE,
        playerId: 'A',
        description: 'A choice',
        mandatory: false,
        sourceName: 'Kynaios and Tiro of Meletis',
        kynaiosBatchId: batchId,
        isController: true,
        sourceController: 'A',
        canPlayLand: false,
        landsInHand: [],
        options: ['play_land', 'decline'],
      },
      {
        type: ResolutionStepType.KYNAIOS_CHOICE,
        playerId: 'B',
        description: 'B choice',
        mandatory: false,
        sourceName: 'Kynaios and Tiro of Meletis',
        kynaiosBatchId: batchId,
        isController: false,
        sourceController: 'A',
        canPlayLand: true,
        landsInHand: [{ id: 'b-land', name: 'Plains' }],
        options: ['play_land', 'draw_card'],
      },
    ];

    const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, configs, ['A', 'B'], 'A');
    const stepA = steps.find((s) => s.playerId === 'A')!;
    const stepB = steps.find((s) => s.playerId === 'B')!;

    const respB: any = {
      stepId: stepB.id,
      playerId: 'B',
      selections: { choice: 'play_land', landCardId: 'b-land' },
      cancelled: false,
      timestamp: Date.now(),
    };
    const completedB = ResolutionQueueManager.completeStep(gameId, stepB.id, respB)!;
    handleKynaiosChoiceResponse(io, game, gameId, completedB as any, respB, deps);

    // Land moved immediately
    expect(game.state.zones.B.handCount).toBe(0);
    expect(game.state.battlefield.length).toBe(1);
    expect(game.state.battlefield[0].controller).toBe('B');
    expect(game.state.battlefield[0].card?.name).toBe('Plains');

    const respA: any = { stepId: stepA.id, playerId: 'A', selections: { choice: 'decline' }, cancelled: false, timestamp: Date.now() };
    const completedA = ResolutionQueueManager.completeStep(gameId, stepA.id, respA)!;
    handleKynaiosChoiceResponse(io, game, gameId, completedA as any, respA, deps);

    // No draw for B since they put a land
    expect(game.state.pendingDraws.B || 0).toBe(0);
  });
});
