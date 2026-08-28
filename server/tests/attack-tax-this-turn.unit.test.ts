import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectThisTurnAttackTaxForAttacker } from '../src/state/modules/staticEffectSpecAttackTaxThisTurn.js';
import { collectAttackYouTaxForDefender } from '../src/state/modules/staticEffectSpecAttackYouTax.js';
import { runTurnStepCleanup } from '../src/state/modules/turn-handlers/turnStepCleanup.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0.
const WAR_TAX_ORACLE =
  "{X}{U}: This turn, creatures can't attack unless their controller pays {X} for each attacking creature they control.";

function collectGrantSteps(text: string, name: string) {
  const ir = parseOracleTextToIR(text, name);
  return (ir.abilities || []).flatMap((ability) => ability.steps || [])
    .filter((step) => step.kind === 'grant_static_ability');
}

describe('this-turn attack tax (War Tax lastingEffects)', () => {
  it('idle War Tax does not tax from StaticEffectSpec or lastingEffects', () => {
    const idle = {
      battlefield: [{
        id: 'tax_1',
        controller: 'p2',
        card: { name: 'War Tax', type_line: 'Enchantment', oracle_text: WAR_TAX_ORACLE },
      }],
    };

    expect(collectAttackYouTaxForDefender(idle, 'p2').cost).toBe(0);
    expect(collectAttackYouTaxForDefender(idle, 'p1').cost).toBe(0);
    expect(collectThisTurnAttackTaxForAttacker(idle, 'p1')).toEqual({ cost: 0, sources: [] });
    expect(collectThisTurnAttackTaxForAttacker(idle, 'p2')).toEqual({ cost: 0, sources: [] });
  });

  it('stamped global amount 3 costs 3 per attacker vs anyone', () => {
    const state = {
      lastingEffects: [{
        type: 'attackTaxGeneric',
        duration: 'this_turn',
        amount: 3,
        global: true,
        source: 'War Tax',
      }],
    };

    expect(collectThisTurnAttackTaxForAttacker(state, 'p1')).toEqual({
      cost: 3,
      sources: ['War Tax'],
    });
    expect(collectThisTurnAttackTaxForAttacker(state, 'p2')).toEqual({
      cost: 3,
      sources: ['War Tax'],
    });
    expect(collectThisTurnAttackTaxForAttacker(state, 'p3')).toEqual({
      cost: 3,
      sources: ['War Tax'],
    });
  });

  it('attack-you stamps tax only the stamped defender', () => {
    const state = {
      lastingEffects: [{
        type: 'attackTaxGeneric',
        duration: 'until_your_next_turn',
        amount: 2,
        defenderId: 'p2',
        global: false,
        source: 'Forbidding Spirit',
      }],
    };

    expect(collectThisTurnAttackTaxForAttacker(state, 'p2')).toEqual({
      cost: 2,
      sources: ['Forbidding Spirit'],
    });
    expect(collectThisTurnAttackTaxForAttacker(state, 'p1')).toEqual({ cost: 0, sources: [] });
    expect(collectThisTurnAttackTaxForAttacker(state, 'p3')).toEqual({ cost: 0, sources: [] });
  });

  it('cleanup expires this_turn attackTaxGeneric but keeps until_your_next_turn', () => {
    const thisTurn = {
      type: 'attackTaxGeneric',
      duration: 'this_turn',
      amount: 3,
      global: true,
      source: 'War Tax',
    };
    const missingDuration = {
      type: 'attackTaxGeneric',
      amount: 1,
      global: true,
      source: 'Custom Missing Duration Tax',
    };
    const untilNext = {
      type: 'attackTaxGeneric',
      duration: 'until_your_next_turn',
      amount: 2,
      defenderId: 'p2',
      global: false,
      source: 'Forbidding Spirit',
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
    expect(collectThisTurnAttackTaxForAttacker(ctx.state, 'p2').cost).toBe(2);
    expect(collectThisTurnAttackTaxForAttacker(ctx.state, 'p1').cost).toBe(0);
  });

  it('IR apply of War Tax activation with xValue=3 stamps collector 3 per attacker', () => {
    const grants = collectGrantSteps(WAR_TAX_ORACLE, 'War Tax')
      .filter((step) => String((step as { duration?: string }).duration || '') === 'this_turn');
    expect(grants.length).toBeGreaterThan(0);

    const result = applyOracleIRStepsToGameState(
      {
        id: 'war-tax-this-turn',
        format: 'commander',
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] },
          { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
        ],
        battlefield: [{
          id: 'tax_1',
          controller: 'p1',
          card: { name: 'War Tax', type_line: 'Enchantment', oracle_text: WAR_TAX_ORACLE },
        }],
        stack: [],
        turnPlayer: 'p1',
        priority: 'p1',
        active: true,
      } as any,
      grants,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'tax_1',
        sourceName: 'War Tax',
        sourceObjectType: 'ability',
        xValue: 3,
      } as any),
    );

    expect(result.appliedSteps.map((step) => step.kind)).toContain('grant_static_ability');
    expect((result.state as any).lastingEffects).toEqual([
      expect.objectContaining({
        type: 'attackTaxGeneric',
        duration: 'this_turn',
        amount: 3,
        global: true,
        source: 'War Tax',
      }),
    ]);
    expect(collectAttackYouTaxForDefender(result.state as any, 'p2').cost).toBe(0);
    expect(collectThisTurnAttackTaxForAttacker(result.state as any, 'p1').cost).toBe(3);
    expect(collectThisTurnAttackTaxForAttacker(result.state as any, 'p2').cost).toBe(3);
  });
});
