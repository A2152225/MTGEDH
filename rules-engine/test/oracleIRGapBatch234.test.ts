import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch234');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function baseState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    turnNumber: 1,
    players: [
      {
        id: p1,
        name: 'P1',
        hand: [
          { id: 'h1', card: { type_line: 'Instant' } },
          { id: 'h2', card: { type_line: 'Creature — Pirate' } },
        ],
        library: [{ id: 'lib1', card: { type_line: 'Basic Land — Plains' } }],
        graveyard: Array.from({ length: 21 }, (_, index) => ({
          id: `gy-${index}`,
          card: { type_line: 'Creature' },
        })),
      },
      {
        id: p2,
        name: 'P2',
        hand: [{ id: 'oh1', card: { type_line: 'Creature' } }],
      },
    ],
    battlefield: [
      { id: 'src', controller: p1, card: { type_line: 'Creature' }, power: 3, toughness: 3 },
      { id: 'ally', controller: p1, card: { type_line: 'Creature' }, power: 1, toughness: 1 },
      { id: 'opp', controller: p2, card: { type_line: 'Creature' }, power: 5, toughness: 5 },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 234 support', () => {
  it('evaluates scaled unless-pay sacrifice when declined', () => {
    const steps = collectStepsFromText('sacrifice this creature unless you pay {1} for each card in your hand.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        unlessPaysManaChoice: 'decline',
      }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
    expect(result.state.battlefield?.some((entry) => entry.id === 'src')).toBe(false);
  });

  it('skips scaled unless-pay sacrifice when paid', () => {
    const steps = collectStepsFromText('sacrifice this creature unless you pay {1} for each card in your hand.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        unlessPaysManaChoice: 'pay',
      }),
    );
    expect(result.state.battlefield?.some((entry) => entry.id === 'src')).toBe(true);
  });

  it('evaluates +1/+1 counter scaled unless-pay on source', () => {
    const state = baseState({
      battlefield: [
        {
          id: 'src',
          controller: 'p1' as PlayerID,
          card: { type_line: 'Creature' },
          counters: { '+1/+1': 2 },
        },
      ],
    });
    const steps = collectStepsFromText(
      'put a +1/+1 counter on this creature, then sacrifice this creature unless you pay {1} for each +1/+1 counter on it.',
    );
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        unlessPaysManaChoice: 'pay',
      }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
    expect(result.state.battlefield?.some((entry) => entry.id === 'src')).toBe(true);
  });

  it('evaluates other-creature scaled unless-pay', () => {
    const steps = collectStepsFromText(
      'sacrifice this creature unless you pay {1} for each other creature you control.',
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        unlessPaysManaChoice: 'decline',
      }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('skips shuffle conditional when library search did not occur', () => {
    const steps = collectStepsFromText('if you search your library this way, shuffle.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        searchedLibraryThisWay: false,
      }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
    expect(result.appliedSteps.some((step) => step.kind === 'shuffle_library')).toBe(false);
  });

  it('evaluates graveyard size conditional', () => {
    const steps = collectStepsFromText('if a graveyard has twenty or more cards in it, draw three cards instead.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
    expect(result.appliedSteps.some((step) => step.kind === 'draw')).toBe(true);
  });

  it('evaluates this creature entered this turn discard unless', () => {
    const state = baseState({
      battlefield: [
        { id: 'src', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, enteredThisTurn: true },
      ],
    });
    const steps = collectStepsFromText('discard a card unless this creature entered this turn.');
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
    expect((result.state.players?.[0] as any)?.hand?.length).toBe(2);
  });

  it('evaluates library-origin draw rider', () => {
    const steps = collectStepsFromText(
      'draw a card. if it entered from your library or was cast from your library, draw two cards instead.',
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
    expect(result.appliedSteps.filter((step) => step.kind === 'draw').length).toBeGreaterThan(0);
  });

  it('evaluates opponent nonland discard unless', () => {
    const steps = collectStepsFromText(
      'each opponent discards two cards unless they discard a nonland card.',
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('evaluates pirate discard unless', () => {
    const steps = collectStepsFromText('discard two cards unless you discard a pirate card.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('evaluates power-2-or-less control discard unless', () => {
    const steps = collectStepsFromText(
      'discard a card unless you control another creature with power 2 or less.',
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });
});
