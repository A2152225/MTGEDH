import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';
import { resolveCardCountDiscardedThisWay } from '../src/oracleIRThisWayResolver';

describe('oracleIR card zone transition bridge', () => {
  it('discards hand via pre-commit bridge and records step ledger', () => {
    const state: any = {
      players: [
        {
          id: 'p1',
          hand: [
            { id: 'h1', name: 'Bolt', type_line: 'Instant' },
            { id: 'h2', name: 'Shock', type_line: 'Instant' },
          ],
          graveyard: [],
          exile: [],
          library: [],
        },
        {
          id: 'p2',
          hand: [{ id: 'h3', name: 'Island', type_line: 'Land' }],
          graveyard: [],
          exile: [],
          library: [],
        },
      ],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'discard',
      raw: 'discard two cards',
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
    expect((result.state as any).players[0].hand).toHaveLength(0);
    expect((result.state as any).players[0].graveyard).toHaveLength(2);
    expect(resolveCardCountDiscardedThisWay(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'discard']]) },
      0,
    )).toBe(2);
  });

  it('halts when milling a commander requires zone replacement choice', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [{
          id: 'cmd-lib',
          name: 'Test Commander',
          type_line: 'Legendary Creature — Human',
          isCommander: true,
        }],
        commandZone: [],
      }],
      battlefield: [],
      commanderIds: ['cmd-lib'],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'mill',
      raw: 'mill a card',
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
    expect((result.state as any).players[0].library).toHaveLength(1);
    expect((result.state as any).players[0].graveyard).toHaveLength(0);
  });
});
