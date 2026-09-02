import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

const RUPTURE_SPIRE_ETB = 'When this land enters, sacrifice it unless you pay {1}.';

function collectSteps(text: string) {
  return parseOracleTextToIR(text, 'Rupture Spire').abilities.flatMap((ability) => ability.steps || []);
}

function baseState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  return {
    turnNumber: 1,
    players: [{ id: p1, name: 'P1', hand: [], library: [], graveyard: [] }],
    battlefield: [
      { id: 'spire', controller: p1, card: { name: 'Rupture Spire', type_line: 'Land' } },
    ],
    manaPool: {
      p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    ...overrides,
  } as GameState;
}

describe('sacrifice unless you pay {N} as unless_pays_mana', () => {
  it('parses the Rupture Spire ETB as unless_pays_mana wrapping sacrifice of it', () => {
    const steps = collectSteps(RUPTURE_SPIRE_ETB);
    const tax = steps.find((step) => step.kind === 'unless_pays_mana');
    expect(tax).toMatchObject({
      kind: 'unless_pays_mana',
      who: { kind: 'you' },
      mana: '{1}',
    });
    expect((tax as any)?.steps?.[0]).toMatchObject({
      kind: 'sacrifice',
      what: { kind: 'raw', text: 'it' },
    });
    expect(steps.some((step) => step.kind === 'conditional')).toBe(false);
  });

  it('prompts when the payer has not chosen and the pool is empty', () => {
    const steps = collectSteps('sacrifice it unless you pay {1}.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'spire' }),
    );
    expect(result.appliedSteps.map((step) => step.kind)).not.toContain('sacrifice');
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
    expect(result.state.battlefield?.some((entry) => entry.id === 'spire')).toBe(true);
  });

  it('sacrifices the source when the payer declines', () => {
    const steps = collectSteps('sacrifice it unless you pay {1}.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'spire',
        unlessPaysManaChoice: 'decline',
      }),
    );
    expect(result.state.battlefield?.some((entry) => entry.id === 'spire')).toBe(false);
  });

  it('keeps the source when the payer pays {1}', () => {
    const steps = collectSteps('sacrifice it unless you pay {1}.');
    const result = applyOracleIRStepsToGameState(
      baseState({
        manaPool: {
          p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
        } as any,
      }),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'spire',
        unlessPaysManaChoice: 'pay',
      }),
    );
    expect(result.state.battlefield?.some((entry) => entry.id === 'spire')).toBe(true);
  });
});
