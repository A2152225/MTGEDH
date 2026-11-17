import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../src/oracleIRExecutor';

const JHOIRA_TEXT =
  'Whenever Jhoira enters or attacks, target opponent reveals cards from the top of their library until they reveal a historic permanent card. You put that card onto the battlefield under your control and lose life equal to that permanent\'s mana value. That player puts the rest of the revealed cards on the bottom of their library in a random order. (Artifacts, legendaries, and Sagas are historic.)';

function libCard(id: string, type_line: string, mv: number) {
  return { id, name: id, type_line, mana_value: mv, cmc: mv };
}

function state(library: any[]) {
  return {
    id: 'jhoira',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library, hand: [], graveyard: [], exile: [] },
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [
      {
        id: 'jhoira',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Legendary Creature — Human Pilot',
        card: { name: 'Jhoira, Weatherlight Corsair', type_line: 'Legendary Creature — Human Pilot' },
      },
    ],
    commandZone: {},
    phase: 'combat',
    active: true,
  } as any;
}

function jhoiraSteps() {
  const ir = parseOracleTextToIR(JHOIRA_TEXT, 'Jhoira, Weatherlight Corsair');
  return (ir.abilities || []).flatMap((a) => a.steps || []);
}

describe('target opponent reveals until historic permanent (Jhoira)', () => {
  it('parses to a single look_choose_from_top that enters under your control', () => {
    const steps = jhoiraSteps();
    expect(steps.map((s) => s.kind)).toEqual(['look_choose_from_top']);
    const step = steps[0] as any;
    expect(step.who).toEqual({ kind: 'target_opponent' });
    expect(step.destination).toBe('battlefield');
    expect(step.putUnderYourControl).toBe(true);
    expect(step.loseLifeEqualToManaValue).toBe(true);
    expect(step.selectorText).toBe('historic permanent');
  });

  it('puts the first historic permanent under your control, loses life equal to MV, bottoms the rest', () => {
    const game = state([
      libCard('bear', 'Creature — Bear', 2),
      libCard('bolt', 'Instant', 1),
      libCard('relic', 'Artifact — Equipment', 3),
      libCard('after', 'Legendary Creature — Elf', 5),
    ]);
    const result = applyOracleIRStepsToGameState(
      game,
      jhoiraSteps(),
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'jhoira',
        sourceName: 'Jhoira, Weatherlight Corsair',
        selectorContext: { targetOpponentId: 'p2' },
      } as any),
    );
    expect(result.appliedSteps.map((s) => s.kind)).toEqual(['look_choose_from_top']);
    const entered = (result.state.battlefield as any[]).find((p) => p.id === 'relic' || p.card?.id === 'relic');
    expect(entered).toBeTruthy();
    expect(entered.controller).toBe('p1');
    expect(String(entered.owner)).toBe('p2');
    expect((result.state.players as any[]).find((p) => p.id === 'p1').life).toBe(37);
    const p2 = (result.state.players as any[]).find((p) => p.id === 'p2');
    expect(p2.library.map((c: any) => c.id).sort()).toEqual(['after', 'bear', 'bolt']);
    // Unrevealed card stays on top; the revealed non-matches go to the bottom.
    expect(p2.library[0].id).toBe('after');
  });

  it('does not lose life when the revealed library has no historic permanent', () => {
    const game = state([libCard('bear', 'Creature — Bear', 2), libCard('bolt', 'Instant', 1)]);
    const result = applyOracleIRStepsToGameState(
      game,
      jhoiraSteps(),
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'jhoira',
        sourceName: 'Jhoira, Weatherlight Corsair',
        selectorContext: { targetOpponentId: 'p2' },
      } as any),
    );
    expect((result.state.players as any[]).find((p) => p.id === 'p1').life).toBe(40);
    expect((result.state.battlefield as any[]).length).toBe(1);
  });
});
