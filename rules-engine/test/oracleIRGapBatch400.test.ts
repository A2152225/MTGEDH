import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.ts';

describe('oracle IR gap batch400 — station charge counters on Planet', () => {
  it('puts charge counters equal to stationed creature power on this Planet', () => {
    const ir = parseOracleTextToIR(
      'Put charge counters equal to its power on this Planet.',
      'Adagia, Windswept Bastion',
    );
    const step = ir.abilities?.[0]?.steps?.[0];
    expect(step?.kind).toBe('add_counter');

    const state = {
      players: [{ id: 'p1', library: [], hand: [], graveyard: [], exile: [] }],
      battlefield: [
        {
          id: 'bf-source',
          controller: 'p1',
          owner: 'p1',
          card: { id: 'bf-source-card', name: 'Adagia, Windswept Bastion', type_line: 'Land — Planet' },
          type_line: 'Land — Planet',
          counters: {},
        },
      ],
    } as any;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId: 'p1',
      sourceId: 'bf-source',
      sourceName: 'Adagia, Windswept Bastion',
      referenceAmount: 5,
      stationedCreaturePower: 5,
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_target')).toBe(false);
    expect(result.skippedSteps?.length || 0).toBe(0);
    const planet = result.state.battlefield?.find((perm: any) => perm.id === 'bf-source');
    expect(planet?.counters?.charge).toBe(5);
  });
});
