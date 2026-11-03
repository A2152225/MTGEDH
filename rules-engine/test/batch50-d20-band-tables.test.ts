import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

// B50 regression: inline d20 result tables must run only the rolled band (previously every band ran).
const HOARDING_OGRE = 'Whenever this creature attacks, roll a d20.\n1\u20149 | Create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")\n10\u201419 | Create two Treasure tokens.\n20 | Create three Treasure tokens.';
const TREASURE_CHEST = '{4}, Sacrifice this artifact: Roll a d20.\n1 | Trapped! \u2014 You lose 3 life.\n2\u20149 | Create five Treasure tokens.\n10\u201419 | You gain 3 life and draw three cards.\n20 | Search your library for a card. If it\'s an artifact card, you may put it onto the battlefield. Otherwise, put that card into your hand. Then shuffle.';

function makeState(): any {
  const lib = Array.from({ length: 10 }, (_, i) => ({ id: `lib-${i}`, name: 'Island', type_line: 'Basic Land - Island' }));
  return {
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: lib, exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] },
    ],
    battlefield: [],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
  };
}

function run(text: string, name: string, roll: number) {
  const ir = parseOracleTextToIR(text, name);
  const ability = ir.abilities.find(a => a.steps.some(s => s.kind === 'roll_die'))!;
  const result = applyOracleIRStepsToGameState(makeState(), ability.steps, { controllerId: 'p1', sourceName: name, dieRollResult: roll } as any);
  const treasures = (result.state.battlefield || []).filter((p: any) => /treasure/i.test(String(p?.card?.name || p?.name || ''))).length;
  const p1: any = result.state.players.find((p: any) => p.id === 'p1');
  return { ability, treasures, life: p1.life, hand: (p1.hand || []).length };
}

describe('B50 inline d20 result tables', () => {
  it('parses the bands into a single die_roll_results step after the roll', () => {
    const { ability } = run(HOARDING_OGRE, 'Hoarding Ogre', 5);
    expect(ability.steps.map(s => s.kind)).toEqual(['roll_die', 'die_roll_results']);
    const table: any = ability.steps[1];
    expect(table.results.map((b: any) => [b.min, b.max])).toEqual([[1, 9], [10, 19], [20, 20]]);
  });

  it.each([[5, 1], [12, 2], [20, 3]])('Hoarding Ogre roll %i creates only %i Treasure', (roll, expected) => {
    expect(run(HOARDING_OGRE, 'Hoarding Ogre', roll).treasures).toBe(expected);
  });

  it('Treasure Chest roll 1 only loses 3 life', () => {
    const r = run(TREASURE_CHEST, 'Treasure Chest', 1);
    expect(r.life).toBe(37);
    expect(r.treasures).toBe(0);
    expect(r.hand).toBe(0);
  });

  it('Treasure Chest roll 5 only creates five Treasures', () => {
    const r = run(TREASURE_CHEST, 'Treasure Chest', 5);
    expect(r.treasures).toBe(5);
    expect(r.life).toBe(40);
    expect(r.hand).toBe(0);
  });

  it('Treasure Chest roll 12 draws three and makes no Treasures or life loss', () => {
    const r = run(TREASURE_CHEST, 'Treasure Chest', 12);
    expect(r.treasures).toBe(0);
    expect(r.hand).toBe(3);
    expect(r.life).toBeGreaterThanOrEqual(40);
  });
});
