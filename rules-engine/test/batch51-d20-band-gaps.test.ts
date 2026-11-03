import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

// B51: d20 band gaps -- multi-verb bands, multi-sentence tutor band, ", then attach" tail.
const TREASURE_CHEST = '{4}, Sacrifice this artifact: Roll a d20.\n1 | Trapped! \u2014 You lose 3 life.\n2\u20149 | Create five Treasure tokens.\n10\u201419 | You gain 3 life and draw three cards.\n20 | Search your library for a card. If it\'s an artifact card, you may put it onto the battlefield. Otherwise, put that card into your hand. Then shuffle.';
const MORNINGSTAR = 'When this Equipment enters, roll a d20.\n1\u20149 | Create a 1/1 red Goblin creature token.\n10\u201420 | Create a 1/1 red Goblin creature token, then attach this Equipment to it.';
const DELINA = 'Whenever Delina attacks, choose target creature you control, then roll a d20.\n1\u201414 | Create a tapped and attacking token that\'s a copy of that creature, except it\'s not legendary and it has "At end of combat, exile this token."\n15\u201420 | Create one of those tokens. You may roll again.';

function bands(text: string, name: string): any[] {
  const ir = parseOracleTextToIR(text, name);
  const ab: any = ir.abilities.find(a => a.steps.some((s: any) => s.kind === 'die_roll_results'));
  return ab.steps.find((s: any) => s.kind === 'die_roll_results').results;
}
const kinds = (b: any) => b.steps.map((s: any) => s.kind);

function state(): any {
  const lib = Array.from({ length: 10 }, (_, i) => ({ id: 'lib-' + i, name: 'Island', type_line: 'Basic Land - Island' }));
  return {
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: lib, exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] },
    ],
    battlefield: [], stack: [], turnPlayer: 'p1', priority: 'p1',
  };
}

describe('B51 d20 band gaps', () => {
  it('Treasure Chest 10-19 parses gain_life + draw', () => {
    expect(kinds(bands(TREASURE_CHEST, 'Treasure Chest')[2])).toEqual(['gain_life', 'draw']);
  });
  it('Treasure Chest roll 12 gains 3 life and draws three', () => {
    const ab: any = parseOracleTextToIR(TREASURE_CHEST, 'Treasure Chest').abilities[0];
    const r: any = applyOracleIRStepsToGameState(state(), ab.steps, { controllerId: 'p1', sourceName: 'Treasure Chest', dieRollResult: 12 } as any);
    const p1 = r.state.players.find((p: any) => p.id === 'p1');
    expect(p1.life).toBe(43);
    expect(p1.hand.length).toBe(3);
  });
  it('Treasure Chest 20 band has no unknown steps and starts with a library search', () => {
    const b = bands(TREASURE_CHEST, 'Treasure Chest')[3];
    expect(kinds(b)).not.toContain('unknown');
    expect(kinds(b)[0]).toBe('search_library');
  });
  it('Goblin Morningstar 10-20 keeps the then-attach step', () => {
    const b = bands(MORNINGSTAR, 'Goblin Morningstar');
    expect(kinds(b[0])).toEqual(['create_token']);
    expect(kinds(b[1])).toEqual(['create_token', 'attach']);
  });
  it('Delina 15-20 does not misparse "roll again" as a static grant', () => {
    expect(kinds(bands(DELINA, 'Delina, Wild Mage')[1])).not.toContain('grant_static_ability');
  });
});
