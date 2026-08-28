import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from '../src/oracleIR';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const controllerId = 'p1' as PlayerID;

const RAL_EFFECT = 'put a loyalty counter on Ral';
const RAL_NAME = 'Ral, Crackling Wit';

function ralState(loyalty = 4): GameState {
  return {
    players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
    battlefield: [
      {
        id: 'ral-1',
        name: RAL_NAME,
        controller: controllerId,
        owner: controllerId,
        type_line: 'Legendary Planeswalker — Ral',
        counters: { loyalty },
        card: {
          id: 'ral-card',
          name: RAL_NAME,
          type_line: 'Legendary Planeswalker — Ral',
        },
      },
    ],
  } as GameState;
}

describe('named self loyalty counters (Ral, Crackling Wit)', () => {
  it('parses the trigger effect as add_counter on this permanent', () => {
    const ir = parseOracleTextToIR(RAL_EFFECT, RAL_NAME);
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'add_counter');
    expect(step).toMatchObject({
      kind: 'add_counter',
      counter: 'loyalty',
      amount: { kind: 'number', value: 1 },
    });
    expect(String((step as any)?.target?.text || '')).toMatch(/this permanent/i);
  });

  it('applies parsed Ral loyalty-counter trigger to the source planeswalker', () => {
    const ir = parseOracleTextToIR(RAL_EFFECT, RAL_NAME);
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const result = applyOracleIRStepsToGameState(ralState(4), steps, {
      controllerId,
      sourceId: 'ral-1',
      sourceName: RAL_NAME,
    });

    expect(result.skippedSteps?.some((step) => step.kind === 'add_counter')).toBe(false);
    expect(result.appliedSteps?.some((step) => step.kind === 'add_counter')).toBe(true);
    const ral = (result.state?.battlefield || []).find((perm: any) => perm.id === 'ral-1') as any;
    expect(Number(ral?.counters?.loyalty || 0)).toBe(5);
  });

  it('resolves unre-written "on Ral" add_counter to the source planeswalker', () => {
    const steps: OracleEffectStep[] = [
      {
        kind: 'add_counter',
        raw: 'put a loyalty counter on Ral',
        counter: 'loyalty',
        amount: { kind: 'number', value: 1 },
        target: { kind: 'raw', text: 'Ral' },
      },
    ];
    const result = applyOracleIRStepsToGameState(ralState(1), steps, {
      controllerId,
      sourceId: 'ral-1',
      sourceName: RAL_NAME,
    });

    expect(result.skippedSteps?.some((step) => step.kind === 'add_counter')).toBe(false);
    expect(result.appliedSteps?.some((step) => step.kind === 'add_counter')).toBe(true);
    const ral = (result.state?.battlefield || []).find((perm: any) => perm.id === 'ral-1') as any;
    expect(Number(ral?.counters?.loyalty || 0)).toBe(2);
  });
});
