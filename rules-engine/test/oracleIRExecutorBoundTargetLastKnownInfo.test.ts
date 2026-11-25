import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;
const p3 = 'p3' as PlayerID;

function stepsFor(text: string) {
  const ir = parseOracleTextToIR(text, 'Test Source');
  return (ir.abilities || []).flatMap((ability) => ability.steps || []);
}

function creature(id: string, controller: PlayerID, name: string, typeLine: string, power: number, toughness: number, extra: any = {}) {
  return {
    id, controller, owner: controller, tapped: false, counters: {}, basePower: power, baseToughness: toughness, ...extra,
    card: { id: `${id}_card`, name, type_line: typeLine, power: String(power), toughness: String(toughness), colors: extra.colors || [], mana_cost: '{2}', oracle_text: '' },
  };
}

function board(extra: any[] = []): GameState {
  return {
    players: [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
      { id: p3, name: 'P3', life: 40 },
    ],
    life: { [p1]: 40, [p2]: 40, [p3]: 40 },
    battlefield: [
      creature('bear', p1, 'Grizzly Bears', 'Creature — Bear', 2, 2, { colors: ['G'] }),
      creature('giant', p2, 'Hill Giant', 'Creature — Giant', 3, 3, { colors: ['R'] }),
      creature('wurm', p2, 'Craw Wurm', 'Creature — Wurm', 6, 4, { colors: ['G'] }),
      ...extra,
    ],
    stack: [],
  } as unknown as GameState;
}

function run(state: GameState, text: string, ctx: Record<string, unknown>) {
  return applyOracleIRStepsToGameState(
    state,
    stepsFor(text),
    buildOracleIRExecutionContext({ controllerId: p1, sourceName: 'Test Source', ...ctx } as any),
  );
}

const lifeOf = (state: GameState, id: PlayerID) => (state as any).life[id];
const permOf = (state: GameState, id: string) => (state.battlefield || []).find((perm: any) => perm.id === id) as any;
const damageOf = (perm: any) => Number(perm?.damageMarked ?? perm?.damage ?? 0);

describe('bound-target damage fallbacks', () => {
  it('Char: splits "4 damage to any target and 2 damage to you" into both recipients', () => {
    const result = run(board(), 'Char deals 4 damage to any target and 2 damage to you.', {
      sourceId: 'char_spell',
      sourceObjectType: 'spell',
      targetPlayerId: p2,
      selectorContext: { targetPlayerId: p2, chosenObjectIds: [p2] },
    });
    expect(result.skippedSteps).toEqual([]);
    expect(lifeOf(result.state, p2)).toBe(36);
    expect(lifeOf(result.state, p1)).toBe(38);
  });

  it('divides a fixed amount evenly among two bound targets when no division was chosen', () => {
    const result = run(board(), 'This spell deals 4 damage divided as you choose among one, two, or three targets.', {
      sourceId: 'pyrohelix',
      sourceObjectType: 'spell',
      selectorContext: { chosenObjectIds: [p2, p3] },
    });
    expect(result.skippedSteps).toEqual([]);
    expect(lifeOf(result.state, p2)).toBe(38);
    expect(lifeOf(result.state, p3)).toBe(38);
  });

  it('Fire Covenant: divides X among "any number of target creatures" and ignores non-creature ids', () => {
    const result = run(board(), 'This spell deals X damage divided as you choose among any number of target creatures.', {
      sourceId: 'covenant',
      sourceObjectType: 'spell',
      xValue: 4,
      selectorContext: { chosenObjectIds: ['giant', 'wurm'] },
    });
    expect(result.skippedSteps).toEqual([]);
    expect(damageOf(permOf(result.state, 'giant')) + damageOf(permOf(result.state, 'wurm'))).toBe(4);
    expect(damageOf(permOf(result.state, 'giant'))).toBeGreaterThan(0);
    expect(damageOf(permOf(result.state, 'wurm'))).toBeGreaterThan(0);
  });
});

describe('CR 608.2h last-known information', () => {
  const departed = {
    id: 'gone', controller: p1, owner: p1, basePower: 2, baseToughness: 1, counters: { '+1/+1': 2 },
    card: { name: 'Departed', type_line: 'Creature — Human Berserker', power: '2', toughness: '1' },
  };
  const lkiCtx = { sourceId: 'gone', sourceObjectType: 'ability', sourceLastKnownPermanent: departed };

  it('"it deals damage equal to its power to any target" uses the departed source power, not the target', () => {
    const result = run(board(), 'it deals damage equal to its power to any target.', {
      ...lkiCtx,
      targetPermanentId: 'wurm',
      targetCreatureId: 'wurm',
      selectorContext: { targetPermanentId: 'wurm', targetCreatureId: 'wurm', chosenObjectIds: ['wurm'] },
    });
    expect(result.skippedSteps).toEqual([]);
    expect(damageOf(permOf(result.state, 'wurm'))).toBe(4);
  });

  it('"you gain life equal to its power" reads last-known power', () => {
    const result = run(board(), 'you gain life equal to its power.', lkiCtx);
    expect(result.skippedSteps).toEqual([]);
    expect(lifeOf(result.state, p1)).toBe(44);
  });

  it('"create an X/X ... where X is this creature\'s power" reads last-known power', () => {
    const result = run(board(), "create an X/X black Horror creature token, where X is this creature's power.", lkiCtx);
    expect(result.skippedSteps).toEqual([]);
    const token = (result.state.battlefield || []).find((perm: any) => /horror/i.test(String(perm?.card?.name || perm?.name || ''))) as any;
    expect(token).toBeTruthy();
    expect(Number(token.basePower ?? token.card?.power)).toBe(4);
  });

  it('"put its counters on target creature you control" moves the last-known counters', () => {
    const result = run(board(), 'put its counters on target creature you control.', {
      ...lkiCtx,
      targetPermanentId: 'bear',
      targetCreatureId: 'bear',
      selectorContext: { targetPermanentId: 'bear', targetCreatureId: 'bear', chosenObjectIds: ['bear'] },
    });
    expect(result.skippedSteps).toEqual([]);
    expect(permOf(result.state, 'bear').counters['+1/+1']).toBe(2);
  });

  it('a live source wins over a stale last-known snapshot', () => {
    const live = creature('gone', p1, 'Departed', 'Creature — Human Berserker', 5, 5);
    const result = run(board([live]), 'you gain life equal to its power.', lkiCtx);
    expect(lifeOf(result.state, p1)).toBe(45);
  });

  it('"move a +1/+1 counter from this creature onto target creature" uses the live source', () => {
    const src = creature('src', p1, 'Simic Fluxmage', 'Creature — Merfolk Mutant', 1, 2, { counters: { '+1/+1': 2 } });
    const result = run(board([src]), 'Move a +1/+1 counter from this creature onto target creature.', {
      sourceId: 'src',
      sourceObjectType: 'ability',
      targetPermanentId: 'bear',
      targetCreatureId: 'bear',
      selectorContext: { targetPermanentId: 'bear', targetCreatureId: 'bear', chosenObjectIds: ['bear'] },
    });
    expect(result.skippedSteps).toEqual([]);
    expect(permOf(result.state, 'bear').counters['+1/+1']).toBe(1);
    expect(permOf(result.state, 'src').counters['+1/+1']).toBe(1);
  });

  it('Thud: "damage equal to the sacrificed creature\'s power" reads the cost snapshot', () => {
    const result = run(board(), "This spell deals damage equal to the sacrificed creature's power to any target.", {
      sourceId: 'thud',
      sourceObjectType: 'spell',
      targetPlayerId: p2,
      selectorContext: { targetPlayerId: p2, chosenObjectIds: [p2] },
      lastSacrificedPermanents: [
        { id: 'fodder', name: 'Fodder', typeLine: 'creature — giant', type_line: 'Creature — Giant', power: 5, toughness: 5, manaValue: 4, colors: [] },
      ],
    });
    expect(result.skippedSteps).toEqual([]);
    expect(lifeOf(result.state, p2)).toBe(35);
  });
});
