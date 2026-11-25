import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { parseColorQualifiedClassSpec } from '../src/oracleIRExecutorModifyPtClassUtils.js';

describe('Tomb of the Spirit Dragon — colorless creature life', () => {
  it('parses colorless as a color-qualified class spec', () => {
    const spec = parseColorQualifiedClassSpec('colorless creature', (value) => String(value || '').trim().toLowerCase() || null);
    expect(spec).toEqual({ classes: ['creature'], colorlessOnly: true });
  });

  it('gains 1 life per colorless creature you control', () => {
    const ir = parseOracleTextToIR(
      '{2}, {T}: You gain 1 life for each colorless creature you control.',
      'Tomb of the Spirit Dragon',
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.map((step) => step.kind)).toEqual(['gain_life']);

    const state = {
      players: [{ id: 'p1', life: 40, hand: [], library: [], graveyard: [], exile: [] }],
      battlefield: [
        {
          id: 'tomb',
          controller: 'p1',
          owner: 'p1',
          colors: [],
          card: { name: 'Tomb of the Spirit Dragon', type_line: 'Land', colors: [] },
        },
        {
          id: 'myr',
          controller: 'p1',
          owner: 'p1',
          colors: [],
          card: { name: 'Alpha Myr', type_line: 'Artifact Creature — Myr', colors: [] },
        },
        {
          id: 'bear',
          controller: 'p1',
          owner: 'p1',
          colors: ['G'],
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', colors: ['G'] },
        },
      ],
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'tomb',
        sourceName: 'Tomb of the Spirit Dragon',
        sourceObjectType: 'ability',
      } as any),
      { allowOptional: true },
    );

    expect(result.skippedSteps.some((step) => step.kind === 'gain_life')).toBe(false);
    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['gain_life']);
    const p1 = (result.state.players || []).find((player: any) => player.id === 'p1') as any;
    expect(Number(p1?.life)).toBe(41);
  });
});
