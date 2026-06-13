import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { resolveSnapshotCountAtAntecedent } from '../src/oracleIRThisWayResolver';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR exile named cards transition bridge', () => {
  it('exiles matching cards from hand and graveyard via pre-commit bridge and records step ledger', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [{ id: 'h1', name: 'Lightning Bolt', type_line: 'Instant' }],
        graveyard: [{ id: 'g1', name: 'Lightning Bolt', type_line: 'Instant' }],
        library: [],
        exile: [],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'exile_named_cards_from_zones',
      raw: 'exile all cards named Lightning Bolt from your graveyard and hand',
      who: { kind: 'you' },
      zones: ['graveyard', 'hand', 'library'],
      nameSource: 'chosen_card_name',
      maxResults: 'any_number',
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
      selectorContext: { chosenCardName: 'Lightning Bolt' },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].hand).toHaveLength(0);
    expect((result.state as any).players[0].graveyard).toHaveLength(0);
    expect((result.state as any).players[0].exile).toHaveLength(2);
    expect(resolveSnapshotCountAtAntecedent(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'exile_named_cards_from_zones']]) },
      0,
    )).toBe(2);
  });
});
