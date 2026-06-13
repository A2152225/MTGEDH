import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR draw transition bridge', () => {
  it('halts when dredge replacement choice is required', () => {
    const dredgeCard = {
      id: 'stinkweed_imp_1',
      name: 'Stinkweed Imp',
      oracle_text: 'Flying\nDredge 5',
      type_line: 'Creature',
    };
    const library = Array.from({ length: 6 }, (_, index) => ({
      id: `library_${index}`,
      name: `Card ${index}`,
      type_line: 'Instant',
    }));

    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [dredgeCard],
        library: [...library],
        exile: [],
      }],
      zones: {
        p1: {
          graveyard: [dredgeCard],
          libraryCount: library.length,
        },
      },
      libraries: {
        p1: [...library],
      },
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'draw',
      raw: 'draw a card',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
    }];

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: true,
      haltState,
    });

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      serverBridge,
      transitionHaltState: haltState,
      currentStepIndex: 0,
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });

    expect(haltState.halted).toBe(true);
    expect(haltState.deferred.length).toBeGreaterThan(0);
    expect((result.state as any).players[0].hand).toHaveLength(0);
    expect((result.state as any).players[0].library).toHaveLength(6);
  });
});
