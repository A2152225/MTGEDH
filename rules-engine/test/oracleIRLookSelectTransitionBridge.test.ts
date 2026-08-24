import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { resolveAntecedentMovedCards } from '../src/oracleIRLedgerCardAccess';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { resolveSnapshotCountAtAntecedent } from '../src/oracleIRThisWayResolver';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR look select top transition bridge', () => {
  it('puts chosen library cards into hand via pre-commit bridge and records step ledger', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
          { id: 'lib-2', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
          { id: 'lib-3', name: 'Island', type_line: 'Land' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'look_select_top',
      raw: 'look at the top two cards of your library, put them into your hand',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 2 },
      choose: { kind: 'number', value: 2 },
      destination: 'hand',
      restDestination: 'graveyard',
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
    expect((result.state as any).players[0].library).toHaveLength(1);
    expect((result.state as any).players[0].hand).toHaveLength(2);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_select_top']]) },
      0,
    )).toBe(2);
    expect(resolveAntecedentMovedCards(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_select_top']]) },
    )).toHaveLength(2);
  });

  it('puts player-selected library cards into hand via pre-commit bridge', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
          { id: 'lib-2', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
          { id: 'lib-3', name: 'Island', type_line: 'Land' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'look_select_top',
      raw: 'look at the top three cards of your library, put one of them into your hand',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 3 },
      choose: { kind: 'number', value: 1 },
      destination: 'hand',
      restDestination: 'library',
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
      selectorContext: { chosenObjectIds: ['lib-2'] },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].hand).toHaveLength(1);
    expect((result.state as any).players[0].hand[0].id).toBe('lib-2');
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_select_top']]) },
      0,
    )).toBe(3);
  });

  it('puts chosen cards on library top via pre-commit bridge', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
          { id: 'lib-2', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
          { id: 'lib-3', name: 'Island', type_line: 'Land' },
          { id: 'lib-4', name: 'Forest', type_line: 'Land' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'look_select_top',
      raw: 'look at the top three cards of your library, put two of them on top of your library',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 3 },
      choose: { kind: 'number', value: 2 },
      destination: 'library_top',
      restDestination: 'library',
    }];

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: false,
      haltState,
    });

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      serverBridge,
      transitionHaltState: haltState,
      stepLedger: ledger,
      appliedStepKinds: new Map(),
      interactivePlayerChoices: false,
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].library.map((card: any) => card.id)).toEqual([
      'lib-1',
      'lib-2',
      'lib-4',
      'lib-3',
    ]);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_select_top']]) },
      0,
    )).toBe(3);
  });

  it('puts unchosen looked cards into graveyard via pre-commit bridge for rest', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
          { id: 'lib-2', name: 'Bear', type_line: 'Creature — Bear', power: 2, toughness: 2 },
          { id: 'lib-3', name: 'Island', type_line: 'Land' },
          { id: 'lib-4', name: 'Forest', type_line: 'Land' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'look_select_top',
      raw: 'look at the top three cards of your library, put one of them into your hand',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 3 },
      choose: { kind: 'number', value: 1 },
      destination: 'hand',
      restDestination: 'graveyard',
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
      selectorContext: { chosenObjectIds: ['lib-2'] },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].hand).toHaveLength(1);
    expect((result.state as any).players[0].hand[0].id).toBe('lib-2');
    expect((result.state as any).players[0].graveyard.map((card: any) => card.id).sort()).toEqual(['lib-1', 'lib-3']);
    expect((result.state as any).players[0].library).toHaveLength(1);
    expect((result.state as any).players[0].library[0].id).toBe('lib-4');
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_select_top']]) },
      0,
    )).toBe(3);
  });
});
