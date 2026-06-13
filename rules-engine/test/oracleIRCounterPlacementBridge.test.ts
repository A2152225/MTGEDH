import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR counter placement bridge', () => {
  it('applies counter modification replacements before committing counters', () => {
    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [] }],
      battlefield: [
        {
          id: 'target-1',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          card: {
            id: 'target-card',
            name: 'Counter Target',
            type_line: 'Creature — Human',
            oracle_text: '',
          },
        },
        {
          id: 'doubling-season',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'doubling-season-card',
            name: 'Doubling Season',
            type_line: 'Enchantment',
            oracle_text: 'If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.',
          },
        },
        {
          id: 'hardened-scales',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'hardened-scales-card',
            name: 'Hardened Scales',
            type_line: 'Enchantment',
            oracle_text: 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.',
          },
        },
      ],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'add_counter',
      raw: 'Put two +1/+1 counters on target creature',
      target: { kind: 'raw', text: 'target creature' },
      counter: '+1/+1',
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
      targetCreatureId: 'target-1',
      selectorContext: { targetPermanentId: 'target-1', chosenObjectIds: ['target-1'] },
      serverBridge,
      transitionHaltState: haltState,
      currentStepIndex: 0,
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const target = (result.state as any).battlefield.find((perm: any) => perm.id === 'target-1');

    expect(haltState.halted).toBe(false);
    expect(target.counters['+1/+1']).toBe(6);
    expect(ledger.get(0)?.length).toBeGreaterThan(0);
  });
});
