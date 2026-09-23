from pathlib import Path

# Test 1: Empower Jace condition + targeting
test1 = Path(r"D:/Git/MTGEDH/rules-engine/test/empowerJaceRuntime.unit.test.ts")
test1.write_text(r'''import { describe, expect, it } from 'vitest';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
import { resolveDeterministicArmyCreatureSelection } from '../src/oracleIRExecutorBattlefieldArmySelection';
import { lowerEmpowerJaceKeywordAbilities } from '../src/oracleIRParserPostprocessEmpowerJaceKeyword';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function baseState(battlefield: any[]) {
  return {
    id: 'game1',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] },
    ],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield,
    commandZone: {},
    phase: 'main',
    active: true,
  } as any;
}

function jaceToken(id: string, controller = 'p1') {
  return {
    id,
    controller,
    owner: controller,
    name: 'Jace',
    isToken: true,
    type_line: 'Token Planeswalker — Jace',
    card: {
      id: `${id}_card`,
      name: 'Jace',
      type_line: 'Token Planeswalker — Jace',
      isToken: true,
    },
    counters: { loyalty: 0 },
  };
}

function armyToken(id: string, controller = 'p1') {
  return {
    id,
    controller,
    owner: controller,
    name: 'Zombie Army',
    isToken: true,
    type_line: 'Token Creature — Zombie Army',
    card: {
      id: `${id}_card`,
      name: 'Zombie Army',
      type_line: 'Token Creature — Zombie Army',
      isToken: true,
    },
    counters: {},
  };
}

describe('Empower Jace runtime polish (CR 701.71)', () => {
  it('lowers Empower Jace N into create-if-missing + loyalty-counter steps', () => {
    const abilities = lowerEmpowerJaceKeywordAbilities([
      {
        text: 'Empower Jace 2',
        effectText: 'Empower Jace 2',
        steps: [{ kind: 'unknown', raw: 'Empower Jace 2' } as any],
      } as any,
    ]);
    expect(abilities[0].steps.map((step: any) => step.kind)).toEqual(['conditional', 'add_counter']);
    expect(String((abilities[0].steps[0] as any).condition?.raw || '')).toMatch(/jace planeswalker token/i);
    expect(String((abilities[0].steps[1] as any).target?.text || '')).toMatch(/jace planeswalker token you control/i);
  });

  it('evaluates "you don\'t control a Jace planeswalker token" as true when absent', () => {
    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: "you don't control a Jace planeswalker token" } as any,
      nextState: baseState([]),
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
    });
    expect(result).toBe(true);
  });

  it('evaluates "you don\'t control a Jace planeswalker token" as false when one exists', () => {
    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: "you don't control a Jace planeswalker token" } as any,
      nextState: baseState([jaceToken('jace1')]),
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
    });
    expect(result).toBe(false);
  });

  it('does not treat a non-token Jace planeswalker as satisfying the token control check', () => {
    const nontokenJace = {
      id: 'jace_card',
      controller: 'p1',
      owner: 'p1',
      name: 'Jace, the Mind Sculptor',
      isToken: false,
      type_line: 'Legendary Planeswalker — Jace',
      card: {
        id: 'jace_card_ref',
        name: 'Jace, the Mind Sculptor',
        type_line: 'Legendary Planeswalker — Jace',
      },
      counters: { loyalty: 3 },
    };
    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: "you don't control a Jace planeswalker token" } as any,
      nextState: baseState([nontokenJace]),
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1' } as any,
      lastActionOutcome: null,
    });
    expect(result).toBe(true);
  });

  it('also evaluates Amass-style "you don\'t control an Army creature"', () => {
    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "you don't control an Army creature" } as any,
        nextState: baseState([]),
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: null,
      }),
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "you don't control an Army creature" } as any,
        nextState: baseState([armyToken('army1')]),
        controllerId: 'p1' as any,
        ctx: { controllerId: 'p1' } as any,
        lastActionOutcome: null,
      }),
    ).toBe(false);
  });

  it('deterministically targets the sole Jace planeswalker token you control', () => {
    const battlefield = [jaceToken('jace1'), armyToken('army1')];
    const matches = resolveDeterministicArmyCreatureSelection(
      battlefield as any,
      { kind: 'raw', text: 'Jace planeswalker token you control' },
      { controllerId: 'p1' } as any,
    );
    expect(matches).not.toBeNull();
    expect(matches!.map((perm: any) => perm.id)).toEqual(['jace1']);
  });

  it('returns no deterministic target when multiple Jace planeswalker tokens exist', () => {
    const battlefield = [jaceToken('jace1'), jaceToken('jace2')];
    const matches = resolveDeterministicArmyCreatureSelection(
      battlefield as any,
      { kind: 'raw', text: 'Jace planeswalker token you control' },
      { controllerId: 'p1' } as any,
    );
    expect(matches).toEqual([]);
  });
});
''', encoding='utf-8', newline='\n')
print('wrote', test1)
