import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/index.js', () => ({
  appendEvent: vi.fn(),
}));

import { appendEvent } from '../src/db/index.js';
import { persistEffectProgramReplayMutationsFromRun, persistOracleIrReplayMutationsFromExecution } from '../src/state/effects/effectProgramReplayMutationPersistence.js';
import { persistOracleIrCompoundDrawAfterResolution } from '../src/state/modules/oracleIrTransitionPipeline.js';

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

  it('persists direct IR execution replayMutations with oracleIrReplayMutation payload', () => {
    const ctx = {
      gameId: 'game_ir',
      seq: 4,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: {},
    };

    persistOracleIrReplayMutationsFromExecution(
      ctx as any,
      {
        state: ctx.state,
        log: [],
        appliedSteps: [],
        skippedSteps: [],
        automationGaps: [],
        pendingOptionalSteps: [],
        replayMutations: [{ kind: 'mill', playerId: 'p2', count: 1 }],
      } as any,
      { sourceId: 'spell_1', sourceName: 'Thought Scour' },
    );

    expect(appendEvent).toHaveBeenCalledWith('game_ir', 4, 'mill', {
      playerId: 'p2',
      count: 1,
      oracleIrSourceId: 'spell_1',
      oracleIrSourceName: 'Thought Scour',
      oracleIrReplayMutation: true,
    });
  });

  it('skips compound draw fallback when replayMutations already include drawCards', () => {
    const ctx = {
      gameId: 'game_compound_draw_skip',
      seq: 5,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: {
        zones: {
          p1: {
            hand: [{ id: 'old_1' }, { id: 'new_1' }],
          },
        },
      },
    };

    persistOracleIrCompoundDrawAfterResolution(ctx as any, {
      controller: 'p1',
      result: {
        state: ctx.state,
        log: [],
        appliedSteps: [{ kind: 'draw' }],
        skippedSteps: [],
        automationGaps: [],
        pendingOptionalSteps: [],
        replayMutations: [{ kind: 'drawCards', playerId: 'p1', count: 1 }],
      } as any,
      sourceId: 'opt_1',
      sourceName: 'Opt',
      handIdsBefore: new Set(['old_1']),
    });

    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('persists compound draw fallback with drawnCardIds when replayMutations omit drawCards', () => {
    const ctx = {
      gameId: 'game_compound_draw_fallback',
      seq: 6,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: {
        zones: {
          p1: {
            hand: [{ id: 'old_1' }, { id: 'new_1' }],
          },
        },
      },
    };

    persistOracleIrCompoundDrawAfterResolution(ctx as any, {
      controller: 'p1',
      result: {
        state: ctx.state,
        log: [],
        appliedSteps: [{ kind: 'draw' }],
        skippedSteps: [],
        automationGaps: [],
        pendingOptionalSteps: [],
        replayMutations: [],
      } as any,
      sourceId: 'opt_1',
      sourceName: 'Opt',
      handIdsBefore: new Set(['old_1']),
    });

    expect(appendEvent).toHaveBeenCalledWith('game_compound_draw_fallback', 6, 'drawCards', {
      playerId: 'p1',
      count: 1,
      oracleIrCompoundResume: true,
      drawnCardIds: ['new_1'],
      oracleIrSourceId: 'opt_1',
      oracleIrSourceName: 'Opt',
    });
  });

  it('persists shuffleLibrary events from replayMutations with shuffledLibraryIds', () => {
    const ctx = {
      gameId: 'game_shuffle',
      seq: 8,
      isReplaying: false,
      bumpSeq: vi.fn(),
      state: {},
    };

    persistOracleIrReplayMutationsFromExecution(
      ctx as any,
      {
        state: ctx.state,
        log: [],
        appliedSteps: [],
        skippedSteps: [],
        automationGaps: [],
        pendingOptionalSteps: [],
        replayMutations: [{
          kind: 'shuffleLibrary',
          playerId: 'p1',
          shuffledLibraryIds: ['c2', 'c1'],
        }],
      } as any,
      { sourceId: 'kodama_1', sourceName: "Kodama's Reach" },
    );

    expect(appendEvent).toHaveBeenCalledWith('game_shuffle', 8, 'shuffleLibrary', {
      playerId: 'p1',
      shuffledLibraryIds: ['c2', 'c1'],
      oracleIrSourceId: 'kodama_1',
      oracleIrSourceName: "Kodama's Reach",
      oracleIrReplayMutation: true,
    });
  });
});
