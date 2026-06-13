import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { evaluateModifyPtWhereX } from '../src/oracleIRExecutorModifyPtWhereEvaluator';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { resolveSnapshotCountAtAntecedent } from '../src/oracleIRThisWayResolver';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR scry surveil observation ledger', () => {
  it('records scry library observations on choice-deferred server path', () => {
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
      kind: 'scry',
      raw: 'scry 2',
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
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
    expect((result.state as any).players[0].library).toHaveLength(2);
    expect(ledger.size).toBeGreaterThan(0);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'scry']]) },
      0,
    )).toBe(2);
  });

  it('records surveil library observations on choice-deferred server path', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'surveil',
      raw: 'surveil 1',
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

    applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'surveil']]) },
      0,
    )).toBe(1);
  });

  it('resolves scry where-X from ledger after choice-deferred observation flush', () => {
    const ledger = createEmptyStepLedger();
    ledger.set(0, [
      {
        objectId: 'lib-1',
        name: 'Bolt',
        typeLine: 'Instant',
        zone: 'library',
        ownerId: 'p1',
        controllerId: 'p1',
        affectedByStepIndex: 0,
        transitionId: 'ir-scry-0',
        transitionKind: 'zone-change',
        colors: [],
      },
      {
        objectId: 'lib-2',
        name: 'Bear',
        typeLine: 'Creature — Bear',
        zone: 'library',
        ownerId: 'p1',
        controllerId: 'p1',
        affectedByStepIndex: 0,
        transitionId: 'ir-scry-0',
        transitionKind: 'zone-change',
        colors: [],
        power: 2,
        toughness: 2,
      },
    ] as any);

    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [] }],
      battlefield: [],
    };

    const step = {
      kind: 'modify_pt',
      raw: 'where X is the number of cards looked at while scrying this way',
      target: { kind: 'raw', text: 'target creature' },
      power: 1,
      toughness: 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      thisWayAntecedentStepIndex: 0,
      thisWayAntecedentStepKind: 'scry',
    } as OracleEffectStep;

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      stepLedger: ledger,
      currentStepIndex: 1,
      appliedStepKinds: new Map([[0, 'scry']]),
    });

    expect(evaluateModifyPtWhereX(
      state,
      'p1',
      'X is the number of cards looked at while scrying this way',
      undefined,
      ctx,
      undefined,
      0,
      step,
    )).toBe(2);
  });
});
