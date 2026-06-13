import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR damage transition bridge', () => {
  it('applies shield counter replacement before committing damage', () => {
    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [] }],
      battlefield: [{
        id: 'perm-1',
        controller: 'p1',
        owner: 'p1',
        power: 2,
        toughness: 2,
        counters: { shield: 1 },
        card: {
          id: 'card-1',
          name: 'Shielded Creature',
          type_line: 'Creature — Human',
          power: '2',
          toughness: '2',
        },
      }],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'deal_damage',
      raw: 'deal 3 damage to target creature',
      amount: { kind: 'number', value: 3 },
      target: { kind: 'raw', text: 'target creature' },
      source: { kind: 'raw', text: 'this spell' },
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
      targetPermanentId: 'perm-1',
      selectorContext: { targetPermanentId: 'perm-1', chosenObjectIds: ['perm-1'] },
      serverBridge,
      transitionHaltState: haltState,
      currentStepIndex: 0,
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const permanent = (result.state as any).battlefield[0];

    expect(haltState.halted).toBe(false);
    expect(permanent.counters.shield).toBe(1);
    expect(permanent.toughness).toBe(2);
    expect(permanent.power).toBe(2);
    expect(permanent.damage).toBeUndefined();
  });
});
