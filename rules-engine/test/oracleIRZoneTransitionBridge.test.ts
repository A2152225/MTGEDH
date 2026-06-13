import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';

describe('oracleIR zone transition bridge', () => {
  it('exiles permanents with leave-battlefield replacement instead of graveyard on destroy', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [],
        exile: [],
        library: [],
      }],
      battlefield: [{
        id: 'perm-1',
        controller: 'p1',
        owner: 'p1',
        leaveBattlefieldReplacementDestination: 'exile',
        card: {
          id: 'card-1',
          name: 'Marked Traveler',
          type_line: 'Creature — Spirit',
          power: '2',
          toughness: '2',
          leaveBattlefieldReplacementDestination: 'exile',
          oracle_text: 'If this creature would leave the battlefield, exile it instead of putting it anywhere else.',
        },
        power: 2,
        toughness: 2,
      }],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'destroy',
      raw: 'destroy target creature',
      target: { kind: 'raw', text: 'target creature' },
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
    expect((result.state as any).battlefield).toHaveLength(0);
    expect((result.state as any).players[0].graveyard).toHaveLength(0);
    expect((result.state as any).players[0].exile).toHaveLength(1);
    expect(haltState.halted).toBe(false);
  });

  it('halts when replacement choice is required', () => {
    const state: any = {
      players: [{ id: 'p1', hand: [], graveyard: [], exile: [], library: [], commandZone: [] }],
      battlefield: [{
        id: 'cmd-1',
        controller: 'p1',
        owner: 'p1',
        isCommander: true,
        card: {
          id: 'cmd-card',
          name: 'Test Commander',
          type_line: 'Legendary Creature — Human',
          isCommander: true,
        },
      }],
      commanderIds: ['cmd-card'],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'destroy',
      raw: 'destroy target creature',
      target: { kind: 'raw', text: 'target creature' },
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
      targetPermanentId: 'cmd-1',
      selectorContext: { targetPermanentId: 'cmd-1', chosenObjectIds: ['cmd-1'] },
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
    expect((result.state as any).battlefield).toHaveLength(1);
    expect((result.skippedSteps || []).length + (result.automationGaps || []).length).toBeGreaterThan(0);
  });
});
