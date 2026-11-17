import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { applyDealDamageStep } from '../src/oracleIRExecutorDamageStepHandlers';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser';
import { getMarkedDamage } from '../../shared/src/markedDamage.js';

function creature(id: string, controller: string, over: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    name: id,
    type_line: 'Creature — Bear',
    power: 2,
    toughness: 9,
    card: { name: id, type_line: 'Creature — Bear' },
    ...over,
  };
}

function state(battlefield: any[], playerIds: string[] = ['p1', 'p2']) {
  return {
    id: 'damage-recipients',
    format: 'commander',
    players: playerIds.map((id, seat) => ({
      id,
      name: id,
      seat,
      life: 40,
      library: [],
      hand: [],
      graveyard: [],
      exile: [],
    })),
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

function dealDamageStep(text: string, name = 'Source') {
  const steps = (parseOracleTextToIR(text, name).abilities || []).flatMap((a) => a.steps || []);
  const step = steps.find((s) => s.kind === 'deal_damage');
  if (!step) throw new Error(`no deal_damage step for: ${text}`);
  return step as any;
}

const life = (game: any, id: string) => (game.players as any[]).find((p) => p.id === id).life;
const damage = (game: any, id: string) =>
  getMarkedDamage((game.battlefield as any[]).find((p) => p.id === id));

describe('deal_damage recipient gap closures', () => {
  it('each other opponent excludes the already damaged opponent', () => {
    const game = state([creature('src', 'p1')], ['p1', 'p2', 'p3', 'p4']);
    const step = dealDamageStep('it deals that much damage to each other opponent.', 'Kediss');
    const ctx = buildOracleIRExecutionContext(
      { controllerId: 'p1', sourceId: 'src', sourceName: 'Kediss' } as any,
      { targetOpponentId: 'p2', referenceAmount: 5 } as any,
    );
    const result = applyDealDamageStep(game, step, ctx);
    expect(result.applied).toBe(true);
    const next = (result as any).state;
    expect(life(next, 'p2')).toBe(40);
    expect(life(next, 'p3')).toBe(35);
    expect(life(next, 'p4')).toBe(35);
    expect(life(next, 'p1')).toBe(40);
  });

  it('any other target is a player choice, not an unsupported target', () => {
    const game = state([creature('src', 'p1')]);
    const step = dealDamageStep('he deals that much damage to any other target.', 'Panther');
    const ctx = buildOracleIRExecutionContext(
      { controllerId: 'p1', sourceId: 'src', sourceName: 'Panther' } as any,
      { referenceAmount: 4 } as any,
    );
    const result = applyDealDamageStep(game, step, ctx);
    expect(result.applied).toBe(false);
    expect((result as any).reason).toBe('player_choice_required');
  });

  it('parses nonlegendary / nonwhite / blocking / keyword-none creature selectors', () => {
    expect(parseSimpleBattlefieldSelector({ kind: 'raw', text: 'each nonlegendary creature' })).toMatchObject({
      types: ['creature'],
      typeLineTermsNoneOf: ['legendary'],
    });
    expect(parseSimpleBattlefieldSelector({ kind: 'raw', text: 'each nonwhite creature' })).toMatchObject({
      types: ['creature'],
      colorsNoneOf: ['W'],
    });
    expect(parseSimpleBattlefieldSelector({ kind: 'raw', text: 'each blocking creature' })).toMatchObject({
      types: ['creature'],
      blockingOnly: true,
    });
    expect(
      parseSimpleBattlefieldSelector({
        kind: 'raw',
        text: "each creature that doesn't have first strike, double strike, vigilance, or haste",
      }),
    ).toMatchObject({ types: ['creature'], keywordsNone: ['first strike', 'double strike', 'vigilance', 'haste'] });
    // Existing reserved forms keep their old parse.
    expect(parseSimpleBattlefieldSelector({ kind: 'raw', text: 'each noncreature artifact' })).toMatchObject({
      excludeCreature: true,
    });
  });

  it('each nonlegendary creature damages only nonlegendary creatures', () => {
    const game = state([
      creature('src', 'p1', { toughness: 20 }),
      creature('plain', 'p2'),
      creature('legend', 'p2', { type_line: 'Legendary Creature — Bear', card: { type_line: 'Legendary Creature — Bear' } }),
    ]);
    const step = dealDamageStep('it deals 7 damage to each nonlegendary creature.', 'Hammer');
    const result = applyDealDamageStep(
      game,
      step,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: 'Hammer' } as any),
    );
    expect(result.applied).toBe(true);
    const next = (result as any).state;
    expect(damage(next, 'plain')).toBe(7);
    expect(damage(next, 'src')).toBe(7);
    expect(damage(next, 'legend')).toBe(0);
  });

  it('each nonwhite creature damages only nonwhite creatures', () => {
    const game = state([
      creature('src', 'p1', { colors: ['W'] }),
      creature('white', 'p2', { colors: ['W'] }),
      creature('red', 'p2', { colors: ['R'] }),
      creature('colorless', 'p2'),
    ]);
    const step = dealDamageStep('Oros deals 3 damage to each nonwhite creature.', 'Oros, the Avenger');
    const result = applyDealDamageStep(
      game,
      step,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: 'Oros, the Avenger' } as any),
    );
    expect(result.applied).toBe(true);
    const next = (result as any).state;
    expect(damage(next, 'white')).toBe(0);
    expect(damage(next, 'src')).toBe(0);
    expect(damage(next, 'red')).toBe(3);
    expect(damage(next, 'colorless')).toBe(3);
  });

  it('each blocking creature damages only blockers (damage equal to its power)', () => {
    const game = state([
      creature('src', 'p1', { power: 4, attacking: true }),
      creature('blocker-a', 'p2', { blocking: ['src'] }),
      creature('blocker-b', 'p2', { blocking: true }),
      creature('idle', 'p2'),
    ]);
    const step = dealDamageStep('it deals damage equal to its power to each blocking creature.', 'Electryte');
    const result = applyDealDamageStep(
      game,
      step,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: 'Electryte' } as any),
    );
    expect(result.applied).toBe(true);
    const next = (result as any).state;
    expect(damage(next, 'blocker-a')).toBe(4);
    expect(damage(next, 'blocker-b')).toBe(4);
    expect(damage(next, 'idle')).toBe(0);
  });

  it('each creature that does not have a listed keyword is damaged', () => {
    const game = state([
      creature('src', 'p1', { keywords: ['haste'] }),
      creature('fs', 'p2', { keywords: ['first strike'] }),
      creature('vig', 'p2', { keywords: ['vigilance'] }),
      creature('plain', 'p2'),
    ]);
    const step = dealDamageStep(
      "it deals 2 damage to each creature that doesn't have first strike, double strike, vigilance, or haste.",
      'Sweeper',
    );
    const result = applyDealDamageStep(
      game,
      step,
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'src', sourceName: 'Sweeper' } as any),
    );
    expect(result.applied).toBe(true);
    const next = (result as any).state;
    expect(damage(next, 'plain')).toBe(2);
    expect(damage(next, 'fs')).toBe(0);
    expect(damage(next, 'vig')).toBe(0);
    expect(damage(next, 'src')).toBe(0);
  });

  it('each other creature defending player controls skips the creature already damaged', () => {
    const game = state([
      { id: 'equip', controller: 'p1', owner: 'p1', type_line: 'Artifact — Equipment', card: { name: 'Gama', type_line: 'Artifact — Equipment' } },
      creature('mine', 'p1'),
      creature('blocker', 'p2', { blocking: ['mine'] }),
      creature('other-1', 'p2'),
      creature('other-2', 'p2'),
    ]);
    const step = dealDamageStep(
      'this Equipment deals that much damage to each other creature defending player controls.',
      'Kusari-Gama',
    );
    const ctx = buildOracleIRExecutionContext(
      { controllerId: 'p1', sourceId: 'equip', sourceName: 'Kusari-Gama' } as any,
      { targetOpponentId: 'p2', targetCreatureId: 'blocker', referenceAmount: 3 } as any,
    );
    const result = applyDealDamageStep(game, step, ctx);
    expect(result.applied).toBe(true);
    const next = (result as any).state;
    expect(damage(next, 'blocker')).toBe(0);
    expect(damage(next, 'other-1')).toBe(3);
    expect(damage(next, 'other-2')).toBe(3);
    expect(damage(next, 'mine')).toBe(0);
  });
});

describe('up to X targets where X is the number of times kicked', () => {
  const text = 'he deals damage equal to his power to each of up to X targets, where X is the number of times he was kicked.';

  it('is a no-op for an unkicked source', () => {
    const game = state([creature('batroc', 'p1', { power: 3, kickedTimes: 0 })]);
    const result = applyDealDamageStep(
      game,
      dealDamageStep(text, 'Batroc'),
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'batroc', sourceName: 'Batroc' } as any),
    );
    expect(result.applied).toBe(true);
    expect(life((result as any).state, 'p2')).toBe(40);
  });

  it('requires a target choice when kicked and nothing is chosen yet', () => {
    const game = state([creature('batroc', 'p1', { power: 3, kickedTimes: 2 })]);
    const result = applyDealDamageStep(
      game,
      dealDamageStep(text, 'Batroc'),
      buildOracleIRExecutionContext({ controllerId: 'p1', sourceId: 'batroc', sourceName: 'Batroc' } as any),
    );
    expect(result.applied).toBe(false);
    expect((result as any).reason).toBe('player_choice_required');
  });

  it('damages each chosen player and creature up to X', () => {
    const game = state([creature('batroc', 'p1', { power: 3, kickedTimes: 2 }), creature('victim', 'p2')]);
    const result = applyDealDamageStep(
      game,
      dealDamageStep(text, 'Batroc'),
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'batroc',
        sourceName: 'Batroc',
        selectorContext: { chosenObjectIds: ['p2', 'victim', 'p1'] },
      } as any),
    );
    expect(result.applied).toBe(true);
    const next = (result as any).state;
    expect(life(next, 'p2')).toBe(37);
    expect(damage(next, 'victim')).toBe(3);
    // Only two targets (X = 2): the third chosen id is ignored.
    expect(life(next, 'p1')).toBe(40);
  });
});
