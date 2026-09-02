import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

describe("Winter's Chill may-pay {1} or {2}", () => {
  const oracle =
    "Choose X target attacking creatures. For each of those creatures, its controller may pay {1} or {2}. If that player doesn't, destroy that creature at end of combat. If that player pays only {1}, prevent all combat damage that would be dealt to and dealt by that creature this combat.";

  it('parses may-pay options plus decline delayed destroy and pays-only prevent', () => {
    const steps = parseOracleTextToIR(oracle, "Winter's Chill").abilities.flatMap((ability) => ability.steps || []);
    const unlessPay = steps.find((step) => step.kind === 'unless_pays_mana') as
      | Extract<(typeof steps)[number], { kind: 'unless_pays_mana' }>
      | undefined;
    expect(unlessPay?.manaOptions).toEqual(['{1}', '{2}']);
    expect(unlessPay?.forEachPermanentText).toMatch(/those creatures/i);
    expect(unlessPay?.steps?.some((step) => step.kind === 'schedule_delayed_battlefield_action')).toBe(true);
    expect(unlessPay?.paidSteps?.some((step) => step.kind === 'prevent_damage' || step.kind === 'conditional')).toBe(true);
  });

  it('schedules end-of-combat destroy when the controller declines', () => {
    const steps = parseOracleTextToIR(oracle, "Winter's Chill").abilities.flatMap((ability) => ability.steps || []);
    const state = {
      players: [
        { id: 'p_you', seat: 0, library: [], hand: [], graveyard: [] },
        { id: 'p_victim', seat: 1, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'bear',
          controller: 'p_victim',
          attacking: 'p_you',
          card: { name: 'Bear', type_line: 'Creature — Bear' },
        },
      ],
      stack: [],
      manaPool: {
        p_victim: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    } as any;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: "Winter's Chill",
      unlessPaysManaChoice: 'decline',
      selectorContext: { chosenObjectIds: ['bear'] },
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.appliedSteps.map((step) => step.kind)).toContain('schedule_delayed_battlefield_action');
    expect(result.appliedSteps.map((step) => step.kind)).not.toContain('prevent_damage');
  });

  it('prevents to-and-by combat damage when the controller pays only {1}', () => {
    const steps = parseOracleTextToIR(oracle, "Winter's Chill").abilities.flatMap((ability) => ability.steps || []);
    const state = {
      players: [
        { id: 'p_you', seat: 0, library: [], hand: [], graveyard: [] },
        { id: 'p_victim', seat: 1, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'bear',
          controller: 'p_victim',
          attacking: 'p_you',
          card: { name: 'Bear', type_line: 'Creature — Bear' },
        },
      ],
      stack: [],
      manaPool: {
        p_victim: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      },
    } as any;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: "Winter's Chill",
      unlessPaysManaChoice: 'pay',
      unlessPaysManaAmount: '{1}',
      selectorContext: { chosenObjectIds: ['bear'], unlessPaysManaChoice: 'pay', unlessPaysManaAmount: '{1}' },
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const kinds = result.appliedSteps.map((step) => step.kind);
    expect(kinds).toContain('prevent_damage');
    expect(kinds).not.toContain('schedule_delayed_battlefield_action');
  });
});

describe('pay any amount of energy then unless-pay', () => {
  it('stamps energy paid this way so Aether Spike scales the unless cost', () => {
    const oracle =
      'Choose target spell. You get {E}{E} (two energy counters), then you may pay any amount of {E}. Counter that spell unless its controller pays {1} for each {E} paid this way.';
    const steps = parseOracleTextToIR(oracle, 'Aether Spike').abilities.flatMap((ability) => ability.steps || []);
    expect(steps.map((step) => step.kind)).toContain('pay_energy');
    const state = {
      players: [
        { id: 'p_you', seat: 0, library: [], hand: [], graveyard: [], energy: 0 },
        { id: 'p_victim', seat: 1, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [],
      stack: [
        {
          id: 'spell-victim',
          type: 'spell',
          controller: 'p_victim',
          owner: 'p_victim',
          card: { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
        },
      ],
      manaPool: {
        p_victim: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    } as any;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Aether Spike',
      targetSpellId: 'spell-victim',
      energyPaidThisWay: 2,
      unlessPaysManaChoice: 'decline',
    } as any);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.appliedSteps.map((step) => step.kind)).toContain('pay_energy');
    expect(result.appliedSteps.map((step) => step.kind)).toContain('counter_spell');
    expect(result.state.stack).toEqual([]);
  });

  it('stamps energy paid this way so Galvanic Discharge deals that much damage', () => {
    const oracle =
      'Choose target creature or planeswalker. You get {E}{E}{E} (three energy counters), then you may pay any amount of {E}. Galvanic Discharge deals that much damage to that permanent.';
    const steps = parseOracleTextToIR(oracle, 'Galvanic Discharge').abilities.flatMap((ability) => ability.steps || []);
    expect(steps.map((step) => step.kind)).toContain('pay_energy');
    expect(steps.map((step) => step.kind)).toContain('deal_damage');
    const state = {
      players: [
        { id: 'p_you', seat: 0, library: [], hand: [], graveyard: [], energy: 0 },
        { id: 'p_victim', seat: 1, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'bear',
          controller: 'p_victim',
          card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
          power: 2,
          toughness: 2,
        },
      ],
      stack: [],
    } as any;
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_you',
      sourceName: 'Galvanic Discharge',
      targetPermanentId: 'bear',
      energyPaidThisWay: 3,
      selectorContext: { chosenObjectIds: ['bear'], targetPermanentId: 'bear' },
    } as any);
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    expect(result.appliedSteps.map((step) => step.kind)).toContain('pay_energy');
    expect(result.appliedSteps.map((step) => step.kind)).toContain('deal_damage');
    const bear = result.state.battlefield.find((entry: any) => entry.id === 'bear');
    const marked = Number(bear?.markedDamage ?? bear?.damageMarked ?? 0);
    expect(marked).toBeGreaterThanOrEqual(3);
  });
});
