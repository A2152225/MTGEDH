import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes';
import {
  detectOpponentEntersTappedFromBattlefield,
  resolvePermanentEntersTapped,
} from '../src/oracleIRBattlefieldEntryProposal';

function authorityStyleBattlefield(controllerId: string) {
  return [{
    id: 'authority-1',
    controller: controllerId,
    owner: controllerId,
    card: {
      id: 'authority-card',
      name: 'Static Authority',
      type_line: 'Enchantment',
      oracle_text: 'Creatures your opponents control enter the battlefield tapped.',
    },
  }];
}

describe('oracleIR battlefield entry commit', () => {
  it('puts opponent creature onto the battlefield tapped without server bridge', () => {
    const state: any = {
      players: [
        {
          id: 'p1',
          hand: [],
          graveyard: [],
          exile: [],
          library: [],
        },
        {
          id: 'p2',
          hand: [{
            id: 'hand-creature',
            name: 'Test Bear',
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
          }],
          graveyard: [],
          exile: [],
          library: [],
        },
      ],
      battlefield: authorityStyleBattlefield('p1'),
    };

    const steps: OracleEffectStep[] = [{
      kind: 'move_zone',
      raw: 'put a creature card from your hand onto the battlefield',
      what: { kind: 'raw', text: 'a creature card from your hand' },
      to: 'battlefield',
    }];

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p2' as PlayerID,
      sourceId: 'src',
      selectorContext: { chosenObjectIds: ['hand-creature'] },
      currentStepIndex: 0,
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const battlefield = (result.state as any).battlefield || [];
    const entered = battlefield.find((perm: any) => String(perm?.card?.name || '') === 'Test Bear');
    expect(entered).toBeTruthy();
    expect(entered.tapped).toBe(true);
    expect((result.state as any).players[1].hand).toHaveLength(0);
  });

  it('creates opponent token tapped through server bridge pre-commit', () => {
    const state: any = {
      players: [
        { id: 'p1', hand: [], graveyard: [], exile: [], library: [] },
        { id: 'p2', hand: [], graveyard: [], exile: [], library: [] },
      ],
      battlefield: authorityStyleBattlefield('p1'),
    };

    const steps: OracleEffectStep[] = [{
      kind: 'create_token',
      raw: 'create a 1/1 green Squirrel creature token',
      token: '1/1 green Squirrel creature token',
      amount: { kind: 'number', value: 1 },
      who: { kind: 'you' },
    } as OracleEffectStep];

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = createOracleIRServerExecutionBridge({
      state,
      ledger,
      interactivePlayerChoices: true,
      haltState,
    });

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p2' as PlayerID,
      sourceId: 'src',
      serverBridge,
      transitionHaltState: haltState,
      currentStepIndex: 0,
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const battlefield = (result.state as any).battlefield || [];
    expect(battlefield.length).toBeGreaterThanOrEqual(1);
    expect(battlefield.some((perm: any) => perm.tapped === true)).toBe(true);
    expect(haltState.halted).toBe(false);
  });

  it('puts land onto the battlefield tapped when step requests tapped entry', () => {
    const state: any = {
      players: [{
        id: 'p1',
        hand: [{
          id: 'hand-land',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
        }],
        graveyard: [],
        exile: [],
        library: [],
      }],
      battlefield: [],
    };

    const steps: OracleEffectStep[] = [{
      kind: 'move_zone',
      raw: 'put a land card from your hand onto the battlefield tapped',
      what: { kind: 'raw', text: 'a land card from your hand' },
      to: 'battlefield',
      entersTapped: true,
    }];

    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'src',
      selectorContext: { chosenObjectIds: ['hand-land'] },
      currentStepIndex: 0,
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const battlefield = (result.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0].tapped).toBe(true);
  });
});

describe('resolvePermanentEntersTapped — opponents control N lands', () => {
  const turbulentMoor = {
    name: 'Turbulent Moor',
    type_line: 'Land — Plains Swamp',
    oracle_text: 'This land enters tapped unless your opponents control eight or more lands.',
  };

  function land(id: string, controller: string) {
    return {
      id,
      controller,
      owner: controller,
      card: { id: `${id}-card`, name: 'Island', type_line: 'Basic Land — Island' },
    };
  }

  it('taps when opponents control fewer than eight lands', () => {
    const battlefield = [
      land('opp-1', 'p2'),
      land('opp-2', 'p2'),
      land('opp-3', 'p3'),
      land('opp-4', 'p3'),
    ];
    expect(resolvePermanentEntersTapped({
      battlefield,
      controllerId: 'p1',
      card: turbulentMoor,
    })).toBe(true);
  });

  it('enters untapped when opponents control eight lands', () => {
    const battlefield = Array.from({ length: 8 }, (_, i) => land(`opp-${i}`, 'p2'));
    expect(resolvePermanentEntersTapped({
      battlefield,
      controllerId: 'p1',
      card: turbulentMoor,
    })).toBe(false);
  });

  it('does not tap opponent creatures just because Turbulent Moor is on the battlefield', () => {
    expect(detectOpponentEntersTappedFromBattlefield(
      [{
        id: 'moor-1',
        controller: 'p1',
        card: turbulentMoor,
      }],
      'p2',
      { name: 'Test Bear', type_line: 'Creature — Bear' },
    )).toBe(false);
  });
});

