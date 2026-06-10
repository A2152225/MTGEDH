import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyChooseModeStep } from '../src/oracleIRExecutorChooseModeStepHandlers.js';
import { applyLoseLifeStep } from '../src/oracleIRExecutorPlayerStepHandlers.js';
import type { GameState } from '../../shared/src/index.js';

function collectUnknowns(value: unknown): string[] {
  const unknowns: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as { kind?: string }).kind === 'unknown') {
      unknowns.push(String((node as { raw?: string }).raw ?? ''));
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'raw' || key === 'text' || key === 'effectText') continue;
      walk(child);
    }
  };
  walk(value);
  return unknowns.filter(Boolean);
}

describe('oracle IR gap batch 43', () => {
  it('parses auction high bidder lose life without unknown player fragments', () => {
    const text = "The high bidder loses life equal to the high bid and draws four cards.";
    const ir = parseOracleTextToIR(text, "Pain's Reward");
    expect(collectUnknowns(ir)).toEqual([]);
    const loseLife = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'lose_life') as any;
    expect(loseLife?.who?.kind).toBe('high_bidder');
    expect(loseLife?.amount?.raw).toBe('the high bid');
  });

  it('executes high bidder life loss in assisted context', () => {
    const step = {
      kind: 'lose_life' as const,
      who: { kind: 'high_bidder' as const },
      amount: { kind: 'reference_amount' as const, raw: 'the high bid' },
      raw: 'The high bidder loses life equal to the high bid',
    };
    const state = {
      players: [
        { id: 'p1', life: 40 },
        { id: 'p2', life: 40 },
      ],
      battlefield: [],
    } as unknown as GameState;
    const result = applyLoseLifeStep(state, step, { controllerId: 'p1', referenceAmount: 5 }, 'p1');
    expect(result.applied).toBe(true);
    expect(result.count).toBe(5);
  });

  it('repairs quoted static grants with once-per-turn reminder tails', () => {
    const text =
      'Commander creatures you own have "Whenever you cast a spell that shares a creature type with this creature, draw a card. This ability triggers only once each turn."';
    const ir = parseOracleTextToIR(text, 'Folk Hero');
    expect(collectUnknowns(ir)).toEqual([]);
    const grant = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'grant_static_ability') as any;
    expect(grant?.effectText?.[0]).not.toMatch(/triggers only once each turn/i);
  });

  it('parses centrifuge neighbor-library draw without unknown amount', () => {
    const text =
      'Visit — Each player draws a card from the library of the player to their right. You create three Treasure tokens.';
    const ir = parseOracleTextToIR(text, 'Centrifuge');
    expect(collectUnknowns(ir)).toEqual([]);
    const draw = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'draw') as any;
    expect(draw?.amount?.kind).toBe('number');
    expect(draw?.amount?.value).toBe(1);
  });

  it('parses tiebreak investigate and source-controller life loss', () => {
    const witnesses = parseOracleTextToIR(
      'Each player who controls the most creatures investigates. Then destroy all creatures.',
      'No Witnesses'
    );
    const investigate = witnesses.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'investigate') as any;
    expect(investigate?.who?.kind).toBe('each_player_who_controls_the_most');

    const xantcha = parseOracleTextToIR(
      "this permanent's controller loses 2 life and you draw a card.",
      'Xantcha, Sleeper Agent'
    );
    expect(collectUnknowns(xantcha)).toEqual([]);
    const loseLife = xantcha.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'lose_life') as any;
    expect(loseLife?.who?.kind).toBe('source_controller');
  });

  it('parses seeds of innocence controller life grant', () => {
    const ir = parseOracleTextToIR(
      'The controller of each of those artifacts gains life equal to its mana value.',
      'Seeds of Innocence'
    );
    expect(collectUnknowns(ir)).toEqual([]);
    const gain = ir.abilities.flatMap((a) => a.steps).find((s) => s.kind === 'gain_life') as any;
    expect(gain?.who?.kind).toBe('each_controller_of_those');
  });
});
