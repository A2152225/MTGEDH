import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';
import { buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { moveTargetedCardFromGraveyard } from '../src/oracleIRExecutorZoneOps';

describe('oracleIR move_zone transition bridge', () => {
  it('returns a graveyard card to hand through pre-commit zone-change bridge', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [],
        graveyard: [{ id: 'gy-1', name: 'Returned Card', type_line: 'Creature — Human' }],
        exile: [],
        library: [],
      }],
      battlefield: [],
    };

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

    const result = moveTargetedCardFromGraveyard(
      state,
      'p1' as PlayerID,
      'gy-1',
      { cardType: 'any' },
      'hand',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { ctx, stepKind: 'move_zone' },
    );

    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') return;

    expect(haltState.halted).toBe(false);
    expect((result.state as any).players[0].graveyard).toHaveLength(0);
    expect((result.state as any).players[0].hand).toHaveLength(1);
    expect((result.state as any).players[0].hand[0].id).toBe('gy-1');
    expect(ledger.get(0)?.length).toBeGreaterThan(0);
  });
});
