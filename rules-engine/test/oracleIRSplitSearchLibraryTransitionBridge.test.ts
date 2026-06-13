import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { inferSplitLibrarySearchPlan } from '../src/oracleIRSplitLibrarySearch';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { resolveSnapshotCountAtAntecedent } from '../src/oracleIRThisWayResolver';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR split search library transition bridge', () => {
  it('infers split-destination plan from cultivate-style oracle text', () => {
    const plan = inferSplitLibrarySearchPlan(
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    );
    expect(plan).toEqual({
      splitDestination: true,
      toBattlefield: 1,
      toHand: 1,
      entersTapped: true,
    });
  });

  it('puts split search selections onto battlefield and hand via pre-commit bridge', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'p1', name: 'Plains', type_line: 'Basic Land — Plains' },
          { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'search_library',
      raw: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'basic land' },
      destination: 'battlefield',
      revealFound: true,
      entersTapped: true,
      shuffle: true,
      maxResults: 2,
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
      selectorContext: {
        chosenObjectIds: ['f1', 'p1'],
        splitAssignments: { toBattlefield: ['f1'], toHand: ['p1'] },
      },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].hand).toHaveLength(1);
    expect((result.state as any).players[0].hand[0].id).toBe('p1');
    expect((result.state as any).battlefield).toHaveLength(1);
    expect((result.state as any).battlefield[0].card.id).toBe('f1');
    expect((result.state as any).battlefield[0].tapped).toBe(true);
    expect((result.state as any).players[0].library).toHaveLength(1);
    expect((result.state as any).players[0].library[0].id).toBe('bolt');
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'search_library']]) },
      0,
    )).toBe(2);
  });

  it('requires player choice for split search when all matches fit within maxResults', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [
          { id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'p1', name: 'Plains', type_line: 'Basic Land — Plains' },
        ],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'search_library',
      raw: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'basic land' },
      destination: 'battlefield',
      revealFound: true,
      entersTapped: true,
      shuffle: true,
      maxResults: 2,
    }];

    const result = applyOracleIRStepsToGameState(state, steps, buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
    }), { allowOptional: true });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
    expect((result.state as any).players[0].library).toHaveLength(2);
    expect((result.state as any).battlefield).toHaveLength(0);
  });
});
