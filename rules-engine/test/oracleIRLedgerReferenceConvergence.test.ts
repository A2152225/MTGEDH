import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { resolveSnapshotCountAtAntecedent } from '../src/oracleIRThisWayResolver';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR ledger reference convergence', () => {
  it('records flush-path look_top snapshots on the same ledger ref as serverBridge', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
          { id: 'lib-2', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'look_top',
      raw: 'look at the top two cards of your library',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 2 },
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
      stepLedger: ledger,
      appliedStepKinds: new Map(),
    });

    applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(ledger.size).toBeGreaterThan(0);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_top']]) },
      0,
    )).toBe(2);
  });

  it('records bridged discard snapshots on the same ledger ref as serverBridge', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [{ id: 'h1', name: 'Bolt', type_line: 'Instant' }],
        graveyard: [],
        exile: [],
        library: [],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'discard',
      raw: 'discard a card',
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
      stepLedger: ledger,
      appliedStepKinds: new Map(),
      selectorContext: { chosenObjectIds: ['h1'] },
    });

    applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'discard']]) },
      0,
    )).toBe(1);
  });
});
