import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { applyLookTopStep } from '../src/oracleIRExecutorPlayerStepHandlers';
import type { OracleEffectStep } from '../src/oracleIR';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';
import { resolveAntecedentMovedCards } from '../src/oracleIRLedgerCardAccess';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { resolveSnapshotCountAtAntecedent } from '../src/oracleIRThisWayResolver';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR look reveal observation ledger', () => {
  it('records look_top library observations via server bridge without zone mutation', () => {
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

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].library).toHaveLength(2);
    expect(ledger.size).toBeGreaterThan(0);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_top']]) },
      0,
    )).toBe(2);
    expect(resolveAntecedentMovedCards(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_top']]) },
    )).toHaveLength(2);

    const direct = applyLookTopStep(state, steps[0], {
      ...ctx,
      currentStepIndex: 0,
    });
    expect(direct.skipLedgerFlush).toBe(true);
  });

  it('records reveal_top observations and supports ledger-first creature conditional', () => {
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
      kind: 'reveal_top',
      raw: 'reveal the top card of your library',
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
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);

    const conditionalCtx = {
      ...ctx,
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'reveal_top']]),
    };

    expect(evaluateExtendedConditionalClause({
      state,
      ctx: conditionalCtx,
      controllerId: 'p1' as PlayerID,
      normalizedRaw: 'you reveal a creature card this way',
      lastActionOutcome: { kind: 'applied', stepKind: 'reveal_top' },
    })).toBe(false);

    const creatureTopState: any = {
      ...state,
      players: [{
        ...state.players[0],
        library: [
          { id: 'lib-2', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
        ],
      }],
    };

    const ledger2 = createEmptyStepLedger();
    const haltState2: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge2 = createOracleIRServerExecutionBridge({
      state: creatureTopState,
      ledger: ledger2,
      interactivePlayerChoices: true,
      haltState: haltState2,
    });
    const ctx2 = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      serverBridge: serverBridge2,
      transitionHaltState: haltState2,
      stepLedger: ledger2,
      appliedStepKinds: new Map(),
    });
    const revealResult = applyOracleIRStepsToGameState(creatureTopState, steps, ctx2, { allowOptional: true });
    expect(revealResult.state).toBeTruthy();

    expect(evaluateExtendedConditionalClause({
      state: creatureTopState,
      ctx: {
        ...ctx2,
        stepLedger: ledger2,
        currentStepIndex: 1,
        appliedStepKinds: new Map([[0, 'reveal_top']]),
      },
      controllerId: 'p1' as PlayerID,
      normalizedRaw: 'you reveal a creature card this way',
      lastActionOutcome: { kind: 'applied', stepKind: 'reveal_top' },
    })).toBe(true);
  });
});
