import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

// B52: generic "(you may) roll again" bands + Goblin Morningstar attach execution.
const MORNINGSTAR = 'When this Equipment enters, roll a d20.\n1\u20149 | Create a 1/1 red Goblin creature token.\n10\u201420 | Create a 1/1 red Goblin creature token, then attach this Equipment to it.';
const DELINA_ROLL = 'Roll a d20.\n1\u201414 | You gain 1 life.\n15\u201420 | You gain 2 life. You may roll again.';
const MANDATORY = 'Roll a d20.\n1\u201410 | You gain 1 life.\n11\u201420 | You gain 5 life. Roll again.';

function state(extra: any[] = []): any {
  return {
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] },
    ],
    battlefield: extra, stack: [], turnPlayer: 'p1', priority: 'p1',
  };
}
const steps = (t: string, n: string) => (parseOracleTextToIR(t, n).abilities[0] as any).steps;
const life = (r: any) => r.state.players.find((p: any) => p.id === 'p1').life;

describe('B52 roll again', () => {
  it('parses optional and mandatory roll-again flags', () => {
    const t: any = steps(DELINA_ROLL, 'X').find((s: any) => s.kind === 'die_roll_results');
    expect(t.results[1].rollAgain).toBe('optional');
    expect(t.results[1].steps.map((s: any) => s.kind)).toEqual(['gain_life']);
    expect((steps(MANDATORY, 'X').find((s: any) => s.kind === 'die_roll_results') as any).results[1].rollAgain).toBe('mandatory');
  });
  it('Delina band keeps the token copy step and flags roll again', () => {
    const D = 'Whenever Delina attacks, choose target creature you control, then roll a d20.\n1\u201414 | Create a tapped and attacking token that\'s a copy of that creature, except it\'s not legendary and it has "At end of combat, exile this token."\n15\u201420 | Create one of those tokens. You may roll again.';
    const ab: any = parseOracleTextToIR(D, 'Delina, Wild Mage').abilities.find((a: any) => a.steps.some((s: any) => s.kind === 'die_roll_results'));
    const b = ab.steps.find((s: any) => s.kind === 'die_roll_results').results[1];
    expect(b.rollAgain).toBe('optional');
    expect(b.steps.map((s: any) => s.kind)).not.toContain('unknown');
  });
  it('optional roll again not accepted applies once and records the offer', () => {
    const r: any = applyOracleIRStepsToGameState(state(), steps(DELINA_ROLL, 'X'), { controllerId: 'p1', dieRollResult: 16 } as any);
    expect(life(r)).toBe(42);
    expect(r.state.pendingDieRollAgain).toMatchObject({ playerId: 'p1', sides: 20 });
  });
  it('optional roll again accepted re-rolls until a non-again band', () => {
    const r: any = applyOracleIRStepsToGameState(state(), steps(DELINA_ROLL, 'X'), { controllerId: 'p1', dieRollResult: 16, dieRollAgainResults: [20, 3], dieRollAgainAccept: true } as any);
    expect(life(r)).toBe(45);
    expect(r.state.lastDieRoll.result).toBe(3);
  });
  it('mandatory roll again re-rolls without a choice', () => {
    const r: any = applyOracleIRStepsToGameState(state(), steps(MANDATORY, 'X'), { controllerId: 'p1', dieRollResult: 12, dieRollAgainResults: [4] } as any);
    expect(life(r)).toBe(46);
  });
});

describe('B52 Goblin Morningstar attach execution', () => {
  it('attaches the Equipment to the created Goblin token', () => {
    const eq = { id: 'gm', controller: 'p1', owner: 'p1', card: { id: 'gm', name: 'Goblin Morningstar', type_line: 'Artifact - Equipment', oracle_text: MORNINGSTAR } };
    const r: any = applyOracleIRStepsToGameState(state([eq]), steps(MORNINGSTAR, 'Goblin Morningstar'), { controllerId: 'p1', sourceId: 'gm', sourceName: 'Goblin Morningstar', dieRollResult: 15 } as any);
    const tokens = r.state.battlefield.filter((p: any) => p.isToken);
    expect(tokens.length).toBe(1);
    const gm = r.state.battlefield.find((p: any) => p.id === 'gm');
    expect(gm.attachedTo).toBe(tokens[0].id);
  });
});
