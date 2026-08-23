import { describe, expect, it } from 'vitest';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { evaluateAnyPlayerMayStep } from '../../rules-engine/src/oracleIRExecutorAnyPlayerMayStep.js';
import { applyGainControlStep } from '../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import { applyRemoveCounterStep } from '../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';
import {
  getActiveNextSpellCostReduction,
  grantNextSpellCostReduction,
  consumeNextSpellCostReductionAfterCast,
} from '../src/state/modules/nextSpellCostReduction.js';

function stepsFor(clause: string, name: string) {
  const ir = parseOracleTextToIR(`When you cast this spell, ${clause}.`, name);
  return ir.abilities.flatMap((a: any) => a.steps || []);
}

describe('on-cast leftovers: any-player-may tax', () => {
  it('parses Dash Hopes-style any-player life tax as any_player_may + counter', () => {
    const steps = stepsFor(
      'any player may pay 5 life. If a player does, counter Dash Hopes',
      'Dash Hopes',
    );
    const tax = steps.find((s: any) => s.kind === 'any_player_may');
    expect(tax).toBeTruthy();
    expect((tax as any).payment).toEqual({ kind: 'life', amount: 5 });
    expect(Array.isArray((tax as any).steps)).toBe(true);
    expect((tax as any).steps.some((s: any) => s.kind === 'counter_spell')).toBe(true);
  });

  it('parses Temporal Extortion half-life and Phantasmagorian discard taxes', () => {
    const half = stepsFor(
      'any player may pay half their life, rounded up. If a player does, counter Temporal Extortion',
      'Temporal Extortion',
    ).find((s: any) => s.kind === 'any_player_may');
    expect((half as any)?.payment?.kind).toBe('half_life_rounded_up');

    const discard = stepsFor(
      'any player may discard three cards. If a player does, counter Phantasmagorian',
      'Phantasmagorian',
    ).find((s: any) => s.kind === 'any_player_may');
    expect((discard as any)?.payment).toEqual({ kind: 'discard', amount: 3 });
  });

  it('parses Brain Gorgers sacrifice tax', () => {
    const tax = stepsFor(
      'any player may sacrifice a creature of their choice. If a player does, counter Brain Gorgers',
      'Brain Gorgers',
    ).find((s: any) => s.kind === 'any_player_may');
    expect(tax).toBeTruthy();
    expect((tax as any).payment?.kind).toBe('sacrifice');
  });

  it('evaluateAnyPlayerMayStep applies nested counter only when a player pays', () => {
    const state: any = {
      activePlayer: 'p1',
      players: [
        { id: 'p1', life: 20, hand: [] },
        { id: 'p2', life: 20, hand: [] },
      ],
      battlefield: [],
      stack: [{ id: 'spell1', type: 'spell', controller: 'p1' }],
    };
    const step: any = {
      kind: 'any_player_may',
      payment: { kind: 'life', amount: 5 },
      steps: [{ kind: 'counter_spell', target: { kind: 'raw', text: 'this spell' }, raw: 'counter this spell' }],
      raw: 'any player may pay 5 life. If a player does, counter this spell',
    };

    const needsChoice = evaluateAnyPlayerMayStep(state, step, buildOracleIRExecutionContext({ controllerId: 'p1' }) as any);
    expect(needsChoice.applied).toBe(false);
    expect((needsChoice as any).reason).toBe('player_choice_required');

    const paid = evaluateAnyPlayerMayStep(
      state,
      step,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        anyPlayerMayChoice: 'pay',
        anyPlayerMayPayerId: 'p2',
      } as any) as any,
    );
    expect(paid.applied).toBe(true);
    expect((paid as any).shouldApplyNestedSteps).toBe(true);
    expect((paid as any).state.players.find((p: any) => p.id === 'p2').life).toBe(15);

    const declinedAll = evaluateAnyPlayerMayStep(
      state,
      step,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        anyPlayerMayChoice: 'decline',
        anyPlayerMayPayerId: 'p1',
        anyPlayerMayDeclinedPlayerIds: ['p1', 'p2'],
      } as any) as any,
    );
    expect(declinedAll.applied).toBe(true);
    expect((declinedAll as any).shouldApplyNestedSteps).toBe(false);
  });
});

describe('on-cast leftovers: gain-control prompts', () => {
  it('repairs Obligator-style compound gain-control into control + untap + haste', () => {
    const steps = stepsFor(
      'you may pay {1}{C}. If you do, gain control of target creature until end of turn, untap that creature, and it gains haste until end of turn',
      'Eldrazi Obligator',
    );
    const conditional = steps.find((s: any) => s.kind === 'conditional');
    const nested = ((conditional as any)?.steps || steps) as any[];
    const gain = nested.find((s: any) => s.kind === 'gain_control');
    expect(gain).toBeTruthy();
    expect(String((gain as any).what?.text || '')).toMatch(/^target creature$/i);
    expect((gain as any).duration).toBe('until_end_of_turn');
    expect(nested.some((s: any) => s.kind === 'tap_or_untap' && s.mode === 'untap')).toBe(true);
  });

  it('Flayer/Beast metadata requires a creature target', () => {
    const meta = inferTriggeredAbilityTargetMetadata(
      'gain control of target creature until end of turn. Untap that creature.',
    );
    expect(meta.requiresTarget).toBe(true);
    expect(meta.targetType).toBe('creature');
  });

  it('applyGainControlStep transfers control of the chosen creature until EOT', () => {
    const result = applyGainControlStep(
      {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          { id: 'c1', controller: 'p2', type_line: 'Creature — Eldrazi', summoningSickness: false },
        ],
        controlChangeEffects: [],
      } as any,
      {
        kind: 'gain_control',
        what: { kind: 'raw', text: 'target creature' },
        newController: { kind: 'you' },
        duration: 'until_end_of_turn',
        raw: 'gain control of target creature until end of turn',
      } as any,
      { controllerId: 'p1', targetPermanentId: 'c1', sourceName: 'Flayer of Loyalties' } as any,
    );
    expect(result.applied).toBe(true);
    expect((result.state as any).battlefield.find((p: any) => p.id === 'c1').controller).toBe('p1');
    expect(Array.isArray((result.state as any).controlChangeEffects)).toBe(true);
    expect((result.state as any).controlChangeEffects.length).toBeGreaterThan(0);
  });

  it('Hideous Taskmaster for-each-opponent sets multi maxTargets', () => {
    const meta = inferTriggeredAbilityTargetMetadata(
      'for each opponent, gain control of up to one target creature that player controls until end of turn',
      {
        controllerId: 'p1',
        gameState: { players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }] },
      },
    );
    expect(meta.requiresTarget).toBe(true);
    expect(meta.minTargets).toBe(0);
    expect(meta.maxTargets).toBe(3);
  });
});

describe('on-cast leftovers: Mutated Cultist remove-counters cost-reduce', () => {
  it('parses remove-all-counters + next-spell cost reduce steps', () => {
    const steps = stepsFor(
      'remove all counters from up to one target permanent or opponent. The next spell you cast this turn costs {1} less to cast for each counter removed this way',
      'Mutated Cultist',
    );
    const remove = steps.find((s: any) => s.kind === 'remove_counter');
    const reduce = steps.find((s: any) => s.kind === 'grant_next_spell_cost_reduction');
    expect(remove).toBeTruthy();
    expect((remove as any).amount?.kind).toBe('all');
    expect((remove as any).counter).toBe('any');
    expect(reduce).toBeTruthy();
    expect((reduce as any).perCountersRemoved).toBe(true);
  });

  it('remove_counter any clears all counters and tracks countersRemovedThisWay', () => {
    const ctx: any = buildOracleIRExecutionContext({
      controllerId: 'p1',
      targetPermanentId: 'c1',
    });
    const result = applyRemoveCounterStep(
      {
        battlefield: [
          {
            id: 'c1',
            controller: 'p2',
            type_line: 'Creature — Horror',
            counters: { '+1/+1': 3, 'stun': 2 },
          },
        ],
        players: [{ id: 'p1' }, { id: 'p2' }],
      } as any,
      {
        kind: 'remove_counter',
        amount: { kind: 'all' },
        counter: 'any',
        target: { kind: 'raw', text: 'up to one target permanent or opponent' },
        optional: true,
        raw: 'remove all counters from up to one target permanent or opponent',
      } as any,
      ctx,
    );
    expect(result.applied).toBe(true);
    expect(ctx.countersRemovedThisWay).toBe(5);
    const perm = (result.state as any).battlefield.find((p: any) => p.id === 'c1');
    expect(Number(perm.counters['+1/+1'] || 0)).toBe(0);
    expect(Number(perm.counters.stun || 0)).toBe(0);
  });

  it('next-spell cost reduction grants are consumable', () => {
    const state: any = { turnNumber: 2, nextSpellCostReductionGrants: [] };
    grantNextSpellCostReduction(state, 'p1' as any, 5, 'Mutated Cultist');
    expect(getActiveNextSpellCostReduction(state, 'p1' as any)).toBe(5);
    expect(consumeNextSpellCostReductionAfterCast(state, 'p1' as any)).toBe(5);
    expect(getActiveNextSpellCostReduction(state, 'p1' as any)).toBe(0);
  });

  it('infers permanent-or-player targeting metadata', () => {
    const meta = inferTriggeredAbilityTargetMetadata(
      'remove all counters from up to one target permanent or opponent',
    );
    expect(meta.requiresTarget).toBe(true);
    expect(meta.minTargets).toBe(0);
    expect(meta.maxTargets).toBe(1);
    expect(meta.targetType).toBe('permanent or player');
  });
});


describe('any_player_may payment selection (no auto-pick)', () => {
  it('discard pay without card ids does not auto-discard front-of-hand', () => {
    const state: any = {
      activePlayer: 'p1',
      players: [
        { id: 'p1', life: 20, hand: [] },
        {
          id: 'p2',
          life: 20,
          hand: [
            { id: 'h1', name: 'Alpha' },
            { id: 'h2', name: 'Bravo' },
            { id: 'h3', name: 'Charlie' },
            { id: 'h4', name: 'Delta' },
          ],
          graveyard: [],
        },
      ],
      battlefield: [],
      stack: [{ id: 'spell1', type: 'spell', controller: 'p1' }],
    };
    const step: any = {
      kind: 'any_player_may',
      payment: { kind: 'discard', amount: 3 },
      steps: [{ kind: 'counter_spell', target: { kind: 'raw', text: 'this spell' }, raw: 'counter this spell' }],
      raw: 'any player may discard three cards. If a player does, counter this spell',
    };

    const unpaid = evaluateAnyPlayerMayStep(
      state,
      step,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        anyPlayerMayChoice: 'pay',
        anyPlayerMayPayerId: 'p2',
      } as any) as any,
    );
    expect(unpaid.applied).toBe(false);
    expect((unpaid as any).reason).toBe('player_choice_required');
    expect(state.players.find((p: any) => p.id === 'p2').hand).toHaveLength(4);

    const paid = evaluateAnyPlayerMayStep(
      state,
      step,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        anyPlayerMayChoice: 'pay',
        anyPlayerMayPayerId: 'p2',
        selectorContext: {
          anyPlayerMayChoice: 'pay',
          anyPlayerMayPayerId: 'p2',
          anyPlayerMayDiscardCardIds: ['h2', 'h4', 'h3'],
        },
      } as any) as any,
    );
    expect(paid.applied).toBe(true);
    expect((paid as any).shouldApplyNestedSteps).toBe(true);
    const p2 = (paid as any).state.players.find((p: any) => p.id === 'p2');
    expect(p2.hand.map((c: any) => c.id)).toEqual(['h1']);
    expect(p2.graveyard.map((c: any) => c.id).sort()).toEqual(['h2', 'h3', 'h4']);
  });

  it('sacrifice pay without permanent id does not auto-pick first creature', () => {
    const state: any = {
      activePlayer: 'p1',
      players: [
        { id: 'p1', life: 20, hand: [], graveyard: [] },
        { id: 'p2', life: 20, hand: [], graveyard: [] },
      ],
      battlefield: [
        { id: 'c_first', controller: 'p2', owner: 'p2', type_line: 'Creature - Beast', card: { name: 'First', type_line: 'Creature - Beast' } },
        { id: 'c_pick', controller: 'p2', owner: 'p2', type_line: 'Creature - Horror', card: { name: 'Pick Me', type_line: 'Creature - Horror' } },
      ],
      stack: [{ id: 'spell1', type: 'spell', controller: 'p1' }],
    };
    const step: any = {
      kind: 'any_player_may',
      payment: { kind: 'sacrifice', what: 'a creature of their choice' },
      steps: [{ kind: 'counter_spell', target: { kind: 'raw', text: 'this spell' }, raw: 'counter this spell' }],
      raw: 'any player may sacrifice a creature of their choice. If a player does, counter this spell',
    };

    const unpaid = evaluateAnyPlayerMayStep(
      state,
      step,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        anyPlayerMayChoice: 'pay',
        anyPlayerMayPayerId: 'p2',
      } as any) as any,
    );
    expect(unpaid.applied).toBe(false);
    expect((unpaid as any).reason).toBe('player_choice_required');
    expect(state.battlefield).toHaveLength(2);

    const paid = evaluateAnyPlayerMayStep(
      state,
      step,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        anyPlayerMayChoice: 'pay',
        anyPlayerMayPayerId: 'p2',
        selectorContext: {
          anyPlayerMayChoice: 'pay',
          anyPlayerMayPayerId: 'p2',
          anyPlayerMaySacrificePermanentId: 'c_pick',
        },
      } as any) as any,
    );
    expect(paid.applied).toBe(true);
    expect((paid as any).shouldApplyNestedSteps).toBe(true);
    expect((paid as any).state.battlefield.map((p: any) => p.id)).toEqual(['c_first']);
  });
});
