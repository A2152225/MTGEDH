import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

// Oracle text (Court of Ambition, cmr/114):
// "When this enchantment enters, you become the monarch.
// At the beginning of your upkeep, each opponent loses 3 life unless they discard a card.
// If you're the monarch, instead each opponent loses 6 life unless they discard two cards."
const upkeepOracle =
  'At the beginning of your upkeep, each opponent loses 3 life unless they discard a card. ' +
  "If you're the monarch, instead each opponent loses 6 life unless they discard two cards.";

function collectUpkeepSteps() {
  const ir = parseOracleTextToIR(upkeepOracle, 'Court of Ambition');
  const upkeepAbility = ir.abilities.find((ability) => /beginning of your upkeep/i.test(String(ability.text || '')));
  return upkeepAbility?.steps || [];
}

function baseState(overrides?: Partial<GameState> & { monarch?: string; opponentHandSize?: number }): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  const opponentHandSize = overrides?.opponentHandSize ?? 3;
  return {
    turnNumber: 3,
    monarch: overrides?.monarch,
    players: [
      { id: p1, name: 'P1', life: 40, hand: [] },
      {
        id: p2,
        name: 'P2',
        life: 40,
        hand: Array.from({ length: opponentHandSize }, (_, index) => ({
          id: `p2-h${index}`,
          card: { id: `p2-h${index}-card`, name: `Card ${index}`, type_line: 'Instant' },
        })),
      },
    ],
    battlefield: [],
    ...overrides,
  } as unknown as GameState;
}

describe('Court of Ambition unless-discards + monarch-instead conditional', () => {
  it('parses into a single conditional with unless_discards steps and elseSteps', () => {
    const steps = collectUpkeepSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'if', raw: "you're the monarch" },
    });

    const conditional = steps[0] as any;
    expect(conditional.steps).toEqual([
      expect.objectContaining({
        kind: 'unless_discards',
        who: { kind: 'each_opponent' },
        amount: 2,
        steps: [expect.objectContaining({ kind: 'lose_life', amount: { kind: 'number', value: 6 } })],
      }),
    ]);
    expect(conditional.elseSteps).toEqual([
      expect.objectContaining({
        kind: 'unless_discards',
        who: { kind: 'each_opponent' },
        amount: 1,
        steps: [expect.objectContaining({ kind: 'lose_life', amount: { kind: 'number', value: 3 } })],
      }),
    ]);
  });

  it('not monarch + opponent discards its only card: no life loss', () => {
    const steps = collectUpkeepSteps();
    const state = baseState({ monarch: 'p2', opponentHandSize: 1 });

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'court-1',
        sourceName: 'Court of Ambition',
        targetOpponentId: 'p2' as PlayerID,
        unlessDiscardsChoice: 'discard',
      }),
    );

    const p2 = (result.state as any).players.find((entry: any) => entry.id === 'p2');
    expect(p2.life).toBe(40);
    expect(p2.hand.length).toBe(0);
    expect(result.appliedSteps.some((step) => step.kind === 'conditional')).toBe(true);
  });

  it('not monarch + opponent chooses to discard but has more cards than needed: surfaces a discard card-selection gap', () => {
    const steps = collectUpkeepSteps();
    const state = baseState({ monarch: 'p2', opponentHandSize: 3 });

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'court-1b',
        sourceName: 'Court of Ambition',
        targetOpponentId: 'p2' as PlayerID,
        unlessDiscardsChoice: 'discard',
      }),
    );

    const p2 = (result.state as any).players.find((entry: any) => entry.id === 'p2');
    expect(p2.life).toBe(40);
    expect(p2.hand.length).toBe(3);
    // The unless_discards wrapper delegates to the ordinary discard automation gap (card
    // selection), rather than surfacing itself as unresolved, once the discard/decline choice
    // is already bound.
    expect(result.automationGaps?.some((gap) =>
      gap.reasonCode === 'player_choice_required' && gap.stepKind === 'discard'
    )).toBe(true);
  });

  it('not monarch + opponent declines to discard: loses 3 life', () => {
    const steps = collectUpkeepSteps();
    const state = baseState({ monarch: 'p2' });

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'court-2',
        sourceName: 'Court of Ambition',
        targetOpponentId: 'p2' as PlayerID,
        unlessDiscardsChoice: 'decline',
      }),
    );

    const p2 = (result.state as any).players.find((entry: any) => entry.id === 'p2');
    expect(p2.life).toBe(37);
    expect(p2.hand.length).toBe(3);
  });

  it('monarch + opponent discards its two cards: no life loss', () => {
    const steps = collectUpkeepSteps();
    const state = baseState({ monarch: 'p1', opponentHandSize: 2 });

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'court-3',
        sourceName: 'Court of Ambition',
        targetOpponentId: 'p2' as PlayerID,
        unlessDiscardsChoice: 'discard',
      }),
    );

    const p2 = (result.state as any).players.find((entry: any) => entry.id === 'p2');
    expect(p2.life).toBe(40);
    expect(p2.hand.length).toBe(0);
  });

  it('monarch + opponent declines to discard: loses 6 life', () => {
    const steps = collectUpkeepSteps();
    const state = baseState({ monarch: 'p1' });

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'court-4',
        sourceName: 'Court of Ambition',
        targetOpponentId: 'p2' as PlayerID,
        unlessDiscardsChoice: 'decline',
      }),
    );

    const p2 = (result.state as any).players.find((entry: any) => entry.id === 'p2');
    expect(p2.life).toBe(34);
    expect(p2.hand.length).toBe(3);
  });

  it('monarch + opponent has an empty hand: forced life loss without a choice', () => {
    const steps = collectUpkeepSteps();
    const state = baseState({ monarch: 'p1', opponentHandSize: 0 });

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'court-5',
        sourceName: 'Court of Ambition',
        targetOpponentId: 'p2' as PlayerID,
      }),
    );

    const p2 = (result.state as any).players.find((entry: any) => entry.id === 'p2');
    expect(p2.life).toBe(34);
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(false);
  });

  it('not monarch + opponent has not made a discard-or-decline choice: automation gap', () => {
    const steps = collectUpkeepSteps();
    const state = baseState({ monarch: 'p2' });

    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'court-6',
        sourceName: 'Court of Ambition',
        targetOpponentId: 'p2' as PlayerID,
      }),
    );

    expect(result.automationGaps?.some((gap) =>
      gap.reasonCode === 'player_choice_required' && gap.stepKind === 'unless_discards'
    )).toBe(true);
  });
});
