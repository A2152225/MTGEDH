import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
import { objectCurrentlyHasKeyword } from '../src/oracleIRExecutorConditionalStepSpellCastFlagOrKeyword';

const CUT_PROPULSION =
  'Target creature deals damage to itself equal to its power. If that creature has flying, it deals twice that much damage to itself instead.';
const STONESPLITTER_BOLT =
  'Stonesplitter Bolt deals X damage to target creature or planeswalker. If this spell was bargained, it deals twice X damage to that permanent instead.';
const TORCH_THE_TOWER =
  'Torch the Tower deals 2 damage to target creature or planeswalker. If this spell was bargained, instead it deals 3 damage to that permanent and you scry 1.';

function creature(id: string, controller: string, power: string, toughness: string, extra: Record<string, unknown> = {}, oracleText = '') {
  return {
    id,
    controller,
    owner: controller,
    counters: {},
    card: { name: id, type_line: 'Creature - Test', power, toughness, oracle_text: oracleText },
    ...extra,
  };
}

function run(text: string, name: string, battlefield: any[], ctxExtra: Record<string, unknown>) {
  const steps = parseOracleTextToIR(text, name).abilities.flatMap((ability: any) => ability.steps);
  const state: any = {
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
    life: { p1: 40, p2: 40 },
    battlefield,
    turnNumber: 2,
  };
  const result: any = applyOracleIRStepsToGameState(state, steps as any, {
    controllerId: 'p1',
    sourceId: 'spell1',
    sourceName: name,
    ...ctxExtra,
  } as any);
  return { steps, result, damage: (id: string) => Number(result.state.battlefield.find((p: any) => p.id === id)?.markedDamage ?? 0) };
}

const target = (id: string) => ({ targetCreatureId: id, targetPermanentId: id, selectorContext: { targetCreatureId: id, targetPermanentId: id, chosenObjectIds: [id] } });

describe('"deals twice that much / twice X ... instead" replacement damage', () => {
  it('folds Cut Propulsion into one conditional with the base damage as the else branch', () => {
    const steps = parseOracleTextToIR(CUT_PROPULSION, 'Cut Propulsion').abilities.flatMap((a: any) => a.steps);
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('conditional');
    expect((steps[0] as any).elseSteps).toHaveLength(1);
    expect((steps[0] as any).steps[0].amount).toMatchObject({ kind: 'object_stat', stat: 'power', multiplier: 2 });
  });

  it('Cut Propulsion deals double its current power to a flier (once, not 1x + 2x)', () => {
    const flier = creature('flier', 'p2', '3', '9', { keywords: ['Flying'], card: { name: 'flier', type_line: 'Creature - Bird', power: '3', toughness: '9', oracle_text: 'Flying' } });
    const { damage } = run(CUT_PROPULSION, 'Cut Propulsion', [flier], target('flier'));
    expect(damage('flier')).toBe(6);
  });

  it('Cut Propulsion doubles the flier\'s pumped power, not its printed power', () => {
    const flier = creature('flier', 'p2', '3', '20', {
      keywords: ['Flying'],
      counters: { '+1/+1': 2 },
      card: { name: 'flier', type_line: 'Creature - Bird', power: '3', toughness: '20', oracle_text: 'Flying' },
    });
    const { damage } = run(CUT_PROPULSION, 'Cut Propulsion', [flier], target('flier'));
    expect(damage('flier')).toBe(10);
  });

  it('Cut Propulsion variant "flying or reach": doubles for either keyword, 1x otherwise (never skipped)', () => {
    const text = 'Target creature deals damage to itself equal to its power. If that creature has flying or reach, it deals twice that much damage to itself instead.';
    const flier = creature('c', 'p2', '3', '9', {}, 'Flying');
    const reacher = creature('c', 'p2', '3', '9', {}, 'Reach');
    const plain = creature('c', 'p2', '3', '9');
    expect(run(text, 'Variant', [flier], target('c')).damage('c')).toBe(6);
    expect(run(text, 'Variant', [reacher], target('c')).damage('c')).toBe(6);
    expect(run(text, 'Variant', [plain], target('c')).damage('c')).toBe(3);
  });

  it('Cut Propulsion deals only 1x to a creature without flying', () => {
    const ground = creature('ground', 'p2', '3', '9');
    const { damage } = run(CUT_PROPULSION, 'Cut Propulsion', [ground], target('ground'));
    expect(damage('ground')).toBe(3);
  });

  it('does not treat "flying" in reminder text or an unrelated line as having flying', () => {
    const ground = creature('ground', 'p2', '3', '9', {
      card: { name: 'ground', type_line: 'Creature - Test', power: '3', toughness: '9', oracle_text: 'Creatures with flying can\'t block this creature.' },
    });
    expect(objectCurrentlyHasKeyword(ground, 'flying')).toBe(false);
    expect(objectCurrentlyHasKeyword({ keywords: ['Flying'] }, 'flying')).toBe(true);
    expect(objectCurrentlyHasKeyword({ card: { oracle_text: 'Flying, vigilance' } }, 'flying')).toBe(true);
    expect(objectCurrentlyHasKeyword({ grantedAbilities: ['Flying'] }, 'flying')).toBe(true);
  });

  it('Stonesplitter Bolt deals X normally and 2X (not 3X) when bargained', () => {
    const plain = run(STONESPLITTER_BOLT, 'Stonesplitter Bolt', [creature('t', 'p2', '3', '30')], { xValue: 3, wasBargained: false, ...target('t') });
    expect(plain.damage('t')).toBe(3);
    const bargained = run(STONESPLITTER_BOLT, 'Stonesplitter Bolt', [creature('t', 'p2', '3', '30')], { xValue: 3, wasBargained: true, ...target('t') });
    expect(bargained.damage('t')).toBe(6);
  });

  it('Torch the Tower deals 2, or 3 (not 5) when bargained', () => {
    const plain = run(TORCH_THE_TOWER, 'Torch the Tower', [creature('t', 'p2', '3', '30')], { wasBargained: false, ...target('t') });
    expect(plain.damage('t')).toBe(2);
    const bargained = run(TORCH_THE_TOWER, 'Torch the Tower', [creature('t', 'p2', '3', '30')], { wasBargained: true, ...target('t') });
    expect(bargained.damage('t')).toBe(3);
  });

  it('keeps unrelated "instead" damage clauses unfolded when the source/target differ', () => {
    const steps = parseOracleTextToIR(
      'Test Bolt deals 2 damage to target creature. If this spell was bargained, it deals 3 damage to each opponent instead.',
      'Test Bolt',
    ).abilities.flatMap((a: any) => a.steps);
    expect(steps.filter((s: any) => s.kind === 'deal_damage').length).toBe(1);
  });
});
describe('residual and threshold "instead" damage clauses', () => {
  const CHOCOBO_KICK =
    "Target creature you control deals damage equal to its power to target creature you don't control. If this spell was kicked, the creature you control deals twice that much damage instead.";
  const SHATTERSKULL =
    'Shatterskull Smashing deals X damage divided as you choose among up to two target creatures and/or planeswalkers. If X is 6 or more, Shatterskull Smashing deals twice X damage divided as you choose among them instead.';

  it('Chocobo Kick lowers the kicked clause into a conditional instead of an unparsed residual', () => {
    const steps = parseOracleTextToIR(CHOCOBO_KICK, 'Chocobo Kick').abilities.flatMap((a: any) => a.steps);
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe('conditional');
    expect((steps[0] as any).steps[0].amount).toMatchObject({ kind: 'object_stat', multiplier: 2 });
    expect((steps[0] as any).elseSteps[0].amount).toMatchObject({ kind: 'object_stat' });
  });

  it('Shatterskull Smashing folds X-is-6-or-more into replace-not-add', () => {
    const steps = parseOracleTextToIR(SHATTERSKULL, 'Shatterskull Smashing').abilities.flatMap((a: any) => a.steps);
    expect(steps).toHaveLength(1);
    expect((steps[0] as any).elseSteps).toHaveLength(1);
  });

  it('Shatterskull condition follows X (5 is not enough, 6 is)', () => {
    const cond = { kind: 'if', raw: 'X is 6 or more' } as any;
    const base = { controllerId: 'p1', sourceId: 's' } as any;
    const evalWith = (xValue: number) =>
      evaluateConditionalWrapperCondition({
        condition: cond, nextState: { battlefield: [], players: [] } as any, controllerId: 'p1' as any,
        ctx: { ...base, xValue }, lastActionOutcome: undefined, lastStepOutcome: undefined,
        lastConditionalEvaluation: undefined, pendingSteps: [], lastMovedCards: [], lastDiscardedCards: [],
        lastCreatedTokenIds: [], lastExcessDamageDealtThisWay: undefined,
      } as any);
    expect(evalWith(5)).toBe(false);
    expect(evalWith(6)).toBe(true);
  });

  it('Chocobo Kick deals the creature\'s power, or twice that if kicked (not 3x)', () => {
    const bf = () => [creature('mine', 'p1', '3', '3'), creature('theirs', 'p2', '2', '30')];
    const ctx = { targetCreatureId: 'theirs', targetPermanentId: 'theirs', selectorContext: { targetCreatureId: 'theirs', chosenObjectIds: ['mine', 'theirs'] } };
    const plain = run(CHOCOBO_KICK, 'Chocobo Kick', bf(), { sourceObjectType: 'spell', ...ctx });
    const kicked = run(CHOCOBO_KICK, 'Chocobo Kick', bf(), { sourceObjectType: 'spell', wasKicked: true, ...ctx });
    // Kicked is exactly double the unkicked amount (replace, not add).
    expect(plain.damage('theirs')).toBeGreaterThan(0);
    expect(kicked.damage('theirs')).toBe(plain.damage('theirs') * 2);
  });
});