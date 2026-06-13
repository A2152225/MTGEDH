import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';
import { resolveCountExiledThisWay } from '../src/oracleIRThisWayResolver';

describe('oracleIR exile top transition bridge', () => {
  it('exiles library top via pre-commit bridge and records step ledger', () => {
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
      kind: 'exile_top',
      raw: 'exile the top two cards of your library',
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
    expect((result.state as any).players[0].library).toHaveLength(1);
    expect((result.state as any).players[0].exile).toHaveLength(2);
    expect(resolveCountExiledThisWay(
      { ...ctx, stepLedger: ledger, currentStepIndex: 1, appliedStepKinds: new Map([[0, 'exile_top']]) },
      0,
    )).toBe(2);
  });

  it('halts when exiling a commander from library top requires replacement choice', () => {
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
      kind: 'exile_top',
      raw: 'exile the top card of your library',
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
    expect((result.state as any).players[0].exile).toHaveLength(0);
  });
});
