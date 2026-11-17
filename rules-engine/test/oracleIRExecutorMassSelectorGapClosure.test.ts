import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { applyDealDamageStep } from '../src/oracleIRExecutorDamageStepHandlers';
import { resolveMassBattlefieldSelector } from '../src/oracleIRExecutorMassBattlefieldSelectorResolver';
import { getMarkedDamage } from '../../shared/src/markedDamage.js';

function permanent(id: string, controller: string, typeLine: string, over: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    name: id,
    type_line: typeLine,
    power: 2,
    toughness: 5,
    card: { name: id, type_line: typeLine },
    ...over,
  };
}

function state(battlefield: any[], playerIds: string[] = ['p1', 'p2']) {
  return {
    id: 'mass-selectors',
    format: 'commander',
    players: playerIds.map((id, seat) => ({ id, name: id, seat, life: 40, library: [], hand: [], graveyard: [], exile: [] })),
    startingLife: 40,
    life: Object.fromEntries(playerIds.map((id) => [id, 40])),
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield,
    commandZone: {},
    phase: 'combat',
    active: true,
  } as any;
}

function stepsOf(text: string, name: string) {
  return (parseOracleTextToIR(text, name).abilities || []).flatMap((a) => a.steps || []);
}

function run(game: any, text: string, name: string, ctxOver: Record<string, unknown> = {}) {
  const ctx = buildOracleIRExecutionContext(
    { controllerId: 'p1', sourceId: 'src', sourceName: name } as any,
    ctxOver as any,
  );
  return applyOracleIRStepsToGameState(game, stepsOf(text, name), ctx, { allowOptional: true });
}

const counters = (game: any, id: string, name = '+1/+1') =>
  Number(((game.battlefield as any[]).find((p) => p.id === id)?.counters || {})[name] ?? 0);
const life = (game: any, id: string) => (game.players as any[]).find((p) => p.id === id).life;
const damage = (game: any, id: string) => getMarkedDamage((game.battlefield as any[]).find((p) => p.id === id));
const pt = (game: any, id: string) => {
  const perm = (game.battlefield as any[]).find((p) => p.id === id);
  return [perm?.effectivePower, perm?.effectiveToughness, perm?.temporaryPowerToughness, perm?.modifiers, perm?.powerToughnessEffects];
};

describe('each other opponent exclusion (damage)', () => {
  it('does not exclude every opponent just because eachOfThoseOpponents is bound', () => {
    const game = state([permanent('src', 'p1', 'Creature — Bear')], ['p1', 'p2', 'p3', 'p4']);
    const step = stepsOf('it deals that much damage to each other opponent.', 'Kediss').find((s) => s.kind === 'deal_damage') as any;
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p1',
        sourceId: 'src',
        sourceName: 'Kediss',
        selectorContext: { eachOfThoseOpponents: ['p2', 'p3', 'p4'], damagedPlayerId: 'p2' },
      } as any,
      { targetOpponentId: 'p2', referenceAmount: 4 } as any,
    );
    const result = applyDealDamageStep(game, step, ctx);
    expect(result.applied).toBe(true);
    const next = (result as any).state;
    expect(life(next, 'p2')).toBe(40);
    expect(life(next, 'p3')).toBe(36);
    expect(life(next, 'p4')).toBe(36);
  });
});

describe('subtype team selectors', () => {
  it('each other Dragon creature you control puts counters on other Dragons only', () => {
    const game = state([
      permanent('src', 'p1', 'Creature — Dragon'),
      permanent('d2', 'p1', 'Creature — Dragon'),
      permanent('d3', 'p1', 'Creature — Dragon'),
      permanent('theirs', 'p2', 'Creature — Dragon'),
      permanent('bear', 'p1', 'Creature — Bear'),
    ]);
    const result = run(game, 'put a +1/+1 counter on each other Dragon creature you control.', 'Stormwing Dragon');
    expect(counters(result.state, 'd2')).toBe(1);
    expect(counters(result.state, 'd3')).toBe(1);
    expect(counters(result.state, 'src')).toBe(0);
    expect(counters(result.state, 'theirs')).toBe(0);
    expect(counters(result.state, 'bear')).toBe(0);
    expect(result.appliedSteps.map((s) => s.kind)).toEqual(['add_counter']);
  });

  it('each other Merfolk and/or Knight you control matches either subtype and skips the source', () => {
    const game = state([
      permanent('src', 'p1', 'Creature — Merfolk Knight'),
      permanent('m', 'p1', 'Creature — Merfolk Wizard'),
      permanent('k', 'p1', 'Creature — Human Knight'),
      permanent('x', 'p1', 'Creature — Human Cleric'),
    ]);
    const result = run(game, 'put a +1/+1 counter on each other Merfolk and/or Knight you control.', 'Wave-Knight');
    expect(counters(result.state, 'm')).toBe(1);
    expect(counters(result.state, 'k')).toBe(1);
    expect(counters(result.state, 'x')).toBe(0);
    expect(counters(result.state, 'src')).toBe(0);
  });

  it("each creature you control that's an Ape or a Monkey", () => {
    const game = state([
      permanent('src', 'p1', 'Legendary Creature — Ape'),
      permanent('monkey', 'p1', 'Creature — Monkey'),
      permanent('bear', 'p1', 'Creature — Bear'),
    ]);
    const result = run(game, "put a +1/+1 counter on each creature you control that's an Ape or a Monkey.", 'Kibo');
    expect(counters(result.state, 'src')).toBe(1);
    expect(counters(result.state, 'monkey')).toBe(1);
    expect(counters(result.state, 'bear')).toBe(0);
  });

  it('plural team text singularizes: other Humans / Elves / Rats', () => {
    const game = state([
      permanent('src', 'p1', 'Creature — Human Soldier'),
      permanent('h2', 'p1', 'Creature — Human Cleric'),
      permanent('elf', 'p2', 'Creature — Elf Druid'),
      permanent('rat', 'p1', 'Creature — Rat'),
    ]);
    const ctx = buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: 'Captain' } as any);
    const ids = (text: string) =>
      (resolveMassBattlefieldSelector(game, text, ctx) || []).map((perm: any) => perm.id);
    expect(ids('other Humans you control')).toEqual(['h2']);
    expect(ids('Elf creatures')).toEqual(['elf']);
    expect(ids('other Rats you control')).toEqual(['rat']);
  });

  it('other Humans you control get +1/+1 applies to the plural team', () => {
    const game = state([
      permanent('src', 'p1', 'Creature — Human Soldier'),
      permanent('h2', 'p1', 'Creature — Human Cleric'),
      permanent('bear', 'p1', 'Creature — Bear'),
    ]);
    const result = run(game, 'other Humans you control get +1/+1 until end of turn.', 'Hamlet Captain');
    expect(result.appliedSteps.map((s) => s.kind)).toEqual(['modify_pt']);
    expect(JSON.stringify(pt(result.state, 'h2'))).not.toBe(JSON.stringify(pt(game, 'h2')));
    expect(JSON.stringify(pt(result.state, 'bear'))).toBe(JSON.stringify(pt(game, 'bear')));
    expect(JSON.stringify(pt(result.state, 'src'))).toBe(JSON.stringify(pt(game, 'src')));
  });

  it('a fully understood mass selector with no matches is a no-op, not a gap', () => {
    const game = state([permanent('src', 'p1', 'Creature — Dragon')]);
    const result = run(game, 'put a +1/+1 counter on each other Dragon creature you control.', 'Lonely Dragon');
    expect(result.skippedSteps).toEqual([]);
    expect(counters(result.state, 'src')).toBe(0);
  });
});

describe('combat and counter-qualified mass selectors', () => {
  it('each creature blocking it takes the damage', () => {
    const game = state([
      permanent('src', 'p1', 'Creature — Goblin', { attacking: true, blockedBy: [{ blockerId: 'blk' }] }),
      permanent('blk', 'p2', 'Creature — Bear', { blocking: ['src'], isBlocking: true }),
      permanent('idle', 'p2', 'Creature — Bear'),
    ]);
    const result = run(game, 'it deals 2 damage to each creature blocking it.', 'Battle-Scarred Goblin');
    expect(damage(result.state, 'blk')).toBe(2);
    expect(damage(result.state, 'idle')).toBe(0);
  });

  it('each creature you control with a +1/+1 counter on it', () => {
    const game = state([
      permanent('src', 'p1', 'Creature — Soldier'),
      permanent('buffed', 'p1', 'Creature — Soldier', { counters: { '+1/+1': 1 } }),
      permanent('theirs', 'p2', 'Creature — Soldier', { counters: { '+1/+1': 1 } }),
    ]);
    const result = run(game, 'put a +1/+1 counter on each creature you control with a +1/+1 counter on it.', 'Patron');
    expect(counters(result.state, 'buffed')).toBe(2);
    expect(counters(result.state, 'src')).toBe(0);
    expect(counters(result.state, 'theirs')).toBe(1);
  });

  it('compound counters: each creature you control and a loyalty counter on each planeswalker you control', () => {
    const game = state([
      permanent('src', 'p1', 'Creature — Soldier'),
      permanent('pw', 'p1', 'Legendary Planeswalker — Test', { counters: { loyalty: 3 } }),
    ]);
    const result = run(
      game,
      'put a +1/+1 counter on each creature you control and a loyalty counter on each planeswalker you control.',
      'Brokers Ascendancy',
    );
    expect(counters(result.state, 'src')).toBe(1);
    expect(counters(result.state, 'pw', 'loyalty')).toBe(4);
  });
});
