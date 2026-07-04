import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';
import { persistEffectProgramReplayMutationsFromRun } from '../src/state/effects/effectProgramReplayMutationPersistence.js';

describe('effect program replay mutation persistence', () => {
  beforeEach(() => {
    vi.mocked(appendEvent).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('persists adjustLife from oracle_ir_execution replayMutations', () => {
    const ctx = {
      gameId: 'game_1',
      seq: 12,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: { life: { p1: 41 } },
    };

    persistEffectProgramReplayMutationsFromRun(
      ctx as any,
      [{
        type: 'oracle_ir_execution',
        stepId: 'step_1',
        appliedStepKinds: ['gain_life'],
        skippedStepKinds: [],
        automationGapCount: 0,
        pendingOptionalStepCount: 0,
        execution: {
          state: ctx.state,
          log: [],
          appliedSteps: [],
          skippedSteps: [],
          automationGaps: [],
          pendingOptionalSteps: [],
          replayMutations: [{ kind: 'adjustLife', playerId: 'p1', delta: 1 }],
        },
      }],
      { controller: 'p1' as any, sourceName: 'Auriok Champion', sourceId: 'auriok_1' },
    );

    expect(appendEvent).toHaveBeenCalledWith('game_1', 12, 'adjustLife', {
      playerId: 'p1',
      delta: 1,
      effectProgramSourceId: 'auriok_1',
      effectProgramSourceName: 'Auriok Champion',
      effectProgramMutation: true,
    });
    expect(ctx.bumpSeq).toHaveBeenCalledTimes(1);
  });

  it('persists mill events from replayMutations', () => {
    const ctx = {
      gameId: 'game_mill',
      seq: 3,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: {},
    };

    persistEffectProgramReplayMutationsFromRun(
      ctx as any,
      [{
        type: 'oracle_ir_execution',
        stepId: 'step_mill',
        appliedStepKinds: ['mill'],
        skippedStepKinds: [],
        automationGapCount: 0,
        pendingOptionalStepCount: 0,
        execution: {
          state: ctx.state,
          log: [],
          appliedSteps: [],
          skippedSteps: [],
          automationGaps: [],
          pendingOptionalSteps: [],
          replayMutations: [{ kind: 'mill', playerId: 'p2', count: 2 }],
        },
      }],
      { controller: 'p1' as any, sourceName: 'Glimpse the Unthinkable', sourceId: 'glimpse_1' },
    );

    expect(appendEvent).toHaveBeenCalledWith('game_mill', 3, 'mill', {
      playerId: 'p2',
      count: 2,
      effectProgramSourceId: 'glimpse_1',
      effectProgramSourceName: 'Glimpse the Unthinkable',
      effectProgramMutation: true,
    });
  });

  it('persists createToken executeEffect events from replayMutations', () => {
    const ctx = {
      gameId: 'game_token',
      seq: 7,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: {},
    };

    persistEffectProgramReplayMutationsFromRun(
      ctx as any,
      [{
        type: 'oracle_ir_execution',
        stepId: 'step_token',
        appliedStepKinds: ['create_token'],
        skippedStepKinds: [],
        automationGapCount: 0,
        pendingOptionalStepCount: 0,
        execution: {
          state: ctx.state,
          log: [],
          appliedSteps: [],
          skippedSteps: [],
          automationGaps: [],
          pendingOptionalSteps: [],
          replayMutations: [{
            kind: 'createToken',
            controllerId: 'p1',
            tokenData: {
              id: 'token_soldier_1',
              name: 'Soldier',
              typeLine: 'Creature — Soldier',
              power: 1,
              toughness: 1,
              colors: ['W'],
              abilities: ['haste'],
              hasHaste: true,
            },
          }],
        },
      }],
      { controller: 'p1' as any, sourceName: 'Call the Coppercoats', sourceId: 'coppercoats_1' },
    );

    expect(appendEvent).toHaveBeenCalledWith('game_token', 7, 'executeEffect', {
      effectType: 'createToken',
      controllerId: 'p1',
      tokenData: {
        id: 'token_soldier_1',
        name: 'Soldier',
        typeLine: 'Creature — Soldier',
        power: 1,
        toughness: 1,
        colors: ['W'],
        abilities: ['haste'],
        hasHaste: true,
      },
      effectProgramSourceId: 'coppercoats_1',
      effectProgramSourceName: 'Call the Coppercoats',
      effectProgramMutation: true,
    });
  });

  it('persists discardEffect from replayMutations', () => {
    const ctx = {
      gameId: 'game_discard',
      seq: 9,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: {},
    };

    persistEffectProgramReplayMutationsFromRun(
      ctx as any,
      [{
        type: 'oracle_ir_execution',
        stepId: 'step_discard',
        appliedStepKinds: ['discard'],
        skippedStepKinds: [],
        automationGapCount: 0,
        pendingOptionalStepCount: 0,
        execution: {
          state: ctx.state,
          log: [],
          appliedSteps: [],
          skippedSteps: [],
          automationGaps: [],
          pendingOptionalSteps: [],
          replayMutations: [{
            kind: 'discardEffect',
            playerId: 'p1',
            cardIds: ['hand-1'],
            destination: 'graveyard',
          }],
        },
      }],
      { controller: 'p1' as any, sourceName: 'Thoughtseize', sourceId: 'thoughtseize_1' },
    );

    expect(appendEvent).toHaveBeenCalledWith('game_discard', 9, 'discardEffect', {
      playerId: 'p1',
      cardIds: ['hand-1'],
      destination: 'graveyard',
      effectProgramSourceId: 'thoughtseize_1',
      effectProgramSourceName: 'Thoughtseize',
      effectProgramMutation: true,
    });
  });
});
