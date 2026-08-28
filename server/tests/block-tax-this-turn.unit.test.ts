import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectBlockTax } from '../src/state/modules/staticEffectSpecAttackYouTax.js';
import { collectThisTurnBlockTax } from '../src/state/modules/staticEffectSpecBlockTaxThisTurn.js';
import { runTurnStepCleanup } from '../src/state/modules/turn-handlers/turnStepCleanup.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const WAR_CADENCE_ORACLE =
  "{X}{R}: This turn, creatures can't block unless their controller pays {X} for each blocking creature they control.";

function collectGrantSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || [])
    .filter((step) => step.kind === 'grant_static_ability');
}

describe('this-turn block tax (War Cadence lastingEffects)', () => {
  it('idle War Cadence does not tax from StaticEffectSpec or lastingEffects', () => {
    const idle = {
      battlefield: [{
        id: 'cadence_1',
        controller: 'p1',
        card: { name: 'War Cadence', type_line: 'Enchantment', oracle_text: WAR_CADENCE_ORACLE },
      }],
    };

    expect(collectBlockTax(idle).cost).toBe(0);
    expect(collectThisTurnBlockTax(idle)).toEqual({ cost: 0, sources: [] });
  });

  it('stamped global amount 3 costs 3 per unique blocker', () => {
    const state = {
      lastingEffects: [{
        type: 'blockTaxGeneric',
        duration: 'this_turn',
        amount: 3,
        global: true,
        source: 'War Cadence',
      }],
    };

    expect(collectThisTurnBlockTax(state)).toEqual({
      cost: 3,
      sources: ['War Cadence'],
    });
    expect(collectBlockTax(state)).toEqual({
      cost: 3,
      sources: ['War Cadence'],
    });
  });

  it('cleanup expires this_turn blockTaxGeneric but keeps until_your_next_turn', () => {
    const thisTurn = {
      type: 'blockTaxGeneric',
      duration: 'this_turn',
      amount: 3,
      global: true,
      source: 'War Cadence',
    };
    const missingDuration = {
      type: 'blockTaxGeneric',
      amount: 1,
      global: true,
      source: 'Custom Missing Duration Tax',
    };
    const untilNext = {
      type: 'blockTaxGeneric',
      duration: 'until_your_next_turn',
      amount: 2,
      global: true,
      source: 'Until Next Block Tax',
    };
    const ctx: any = {
      gameId: '',
      state: {
        turnPlayer: 'p1',
        phase: 'ending',
        step: 'CLEANUP',
        stack: [],
        players: [{ id: 'p1', name: 'P1', spectator: false, life: 40 }],
        zones: { p1: { hand: [], handCount: 0 } },
        battlefield: [],
        lastingEffects: [thisTurn, missingDuration, untilNext],
      },
      bumpSeq: () => {},
    };

    const result = runTurnStepCleanup(ctx, false);
    expect(result.shouldCallNextTurn).toBe(true);
    expect(ctx.state.lastingEffects).toEqual([untilNext]);
    expect(collectThisTurnBlockTax(ctx.state).cost).toBe(2);
  });

  it('IR apply of War Cadence activation with xValue=3 stamps collector 3 per blocker', () => {
    const grants = collectGrantSteps(WAR_CADENCE_ORACLE, 'War Cadence')
      .filter((step) => String((step as { duration?: string }).duration || '') === 'this_turn');
    expect(grants.length).toBeGreaterThan(0);

    const result = applyOracleIRStepsToGameState(
      {
        id: 'war-cadence-this-turn',
        format: 'commander',
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] },
          { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
        ],
        battlefield: [{
          id: 'cadence_1',
          controller: 'p1',
          card: { name: 'War Cadence', type_line: 'Enchantment', oracle_text: WAR_CADENCE_ORACLE },
        }],
        stack: [],
        turnPlayer: 'p1',
        priority: 'p1',
        active: true,
      } as any,
      grants,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'cadence_1',
        sourceName: 'War Cadence',
        sourceObjectType: 'ability',
        xValue: 3,
      } as any),
    );

    expect(result.appliedSteps.map((step) => step.kind)).toContain('grant_static_ability');
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'blockTaxGeneric',
        duration: 'this_turn',
        amount: 3,
        global: true,
        source: 'War Cadence',
      }),
    ]);
    expect(collectBlockTax(result.state as any).cost).toBe(3);
  });
});
