import { describe, expect, it } from 'vitest';

import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { evaluateModifyPtWhereX } from '../src/oracleIRExecutorModifyPtWhereEvaluator.js';

const WOLF =
  'All nonartifact creatures get -X/-X until end of turn, where X is the number of artifact creatures you control.';

function makeState(battlefield: any[]) {
  return {
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] },
    ],
    battlefield,
    priority: 'p1',
    turnPlayer: 'p1',
    stack: [],
  } as any;
}

describe('Battle of Wolf 359 mass -X/-X', () => {
  it('counts artifact creatures you control for where-X', () => {
    const state = makeState([
      {
        id: 'art1',
        controller: 'p1',
        type_line: 'Artifact Creature — Borg',
        cardType: 'Artifact Creature',
        power: 1,
        toughness: 1,
      },
      {
        id: 'art2',
        controller: 'p1',
        type_line: 'Artifact Creature — Golem',
        cardType: 'Artifact Creature',
        power: 3,
        toughness: 3,
      },
      {
        id: 'plain',
        controller: 'p1',
        type_line: 'Creature — Human',
        cardType: 'Creature',
        power: 2,
        toughness: 2,
      },
    ]);
    expect(
      evaluateModifyPtWhereX(state, 'p1', 'X is the number of artifact creatures you control'),
    ).toBe(2);
  });

  it('applies -X/-X to all nonartifact creatures', () => {
    const ir = parseOracleTextToIR(WOLF, 'Battle of Wolf 359');
    const steps = ir.abilities[0]?.steps ?? [];
    const start = makeState([
      {
        id: 'art1',
        controller: 'p1',
        type_line: 'Artifact Creature — Borg',
        cardType: 'Artifact Creature',
        power: 1,
        toughness: 1,
        counters: {},
      },
      {
        id: 'art2',
        controller: 'p1',
        type_line: 'Artifact Creature — Golem',
        cardType: 'Artifact Creature',
        power: 3,
        toughness: 3,
        counters: {},
      },
      {
        id: 'merfolk',
        controller: 'p2',
        type_line: 'Creature — Merfolk',
        cardType: 'Creature',
        power: 2,
        toughness: 2,
        counters: {},
      },
    ]);

    const result = applyOracleIRStepsToGameState(start, steps, {
      controllerId: 'p1',
      sourceId: 'art1',
    });
    expect(result.appliedSteps.some((s) => s.kind === 'modify_pt')).toBe(true);

    const merfolk = (result.state.battlefield || []).find((p: any) => p.id === 'merfolk') as any;
    const ptMod = (Array.isArray(merfolk?.modifiers) ? merfolk.modifiers : []).find(
      (m: any) => m?.type === 'powerToughness',
    );
    expect(ptMod?.power).toBe(-2);
    expect(ptMod?.toughness).toBe(-2);

    const artCreature = (result.state.battlefield || []).find((p: any) => p.id === 'art2') as any;
    const artMod = (Array.isArray(artCreature?.modifiers) ? artCreature.modifiers : []).find(
      (m: any) => m?.type === 'powerToughness',
    );
    expect(artMod).toBeUndefined();
  });
});
