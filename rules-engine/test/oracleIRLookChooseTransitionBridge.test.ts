import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { resolveAntecedentMovedCards } from '../src/oracleIRLedgerCardAccess';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { resolveSnapshotCountAtAntecedent } from '../src/oracleIRThisWayResolver';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR look choose from top transition bridge', () => {
  it('puts matching library card into hand via pre-commit bridge and records step ledger', () => {
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
      kind: 'look_choose_from_top',
      raw: 'look at the top three cards of your library, put a creature card from among them into your hand',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 3 },
      selectorText: 'creature',
      destination: 'hand',
      restOrder: 'any',
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
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].hand).toHaveLength(1);
    expect((result.state as any).players[0].hand[0].id).toBe('lib-2');
    expect((result.state as any).players[0].library.map((card: any) => card.id)).toEqual(['lib-1', 'lib-3']);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_choose_from_top']]) },
      0,
    )).toBe(3);
    expect(resolveAntecedentMovedCards(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_choose_from_top']]) },
    )).toHaveLength(3);
  });

  it('bridges rest to library bottom when no matching card is found', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'lib-1', name: 'Bolt', type_line: 'Instant' },
          { id: 'lib-2', name: 'Shock', type_line: 'Instant' },
          { id: 'lib-3', name: 'Island', type_line: 'Land' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'look_choose_from_top',
      raw: 'look at the top three cards of your library, put a creature card from among them into your hand',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 3 },
      selectorText: 'creature',
      destination: 'hand',
      restOrder: 'any',
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
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].hand).toHaveLength(0);
    expect((result.state as any).players[0].library.map((card: any) => card.id)).toEqual([
      'lib-1', 'lib-2', 'lib-3',
    ]);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'look_choose_from_top']]) },
      0,
    )).toBe(3);
  });
});
