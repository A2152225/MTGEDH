import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { grantsStaticFreeHandCasts } from '../src/freeHandCastGrant';
import type { GameState } from '../../shared/src/index.js';

// Quoted from mtg_data.db (is_token = 0).
const YUSRI_ORACLE =
  'Flying\nWhenever Yusri attacks, choose a number between 1 and 5. Flip that many coins. For each flip you win, draw a card. For each flip you lose, Yusri deals 2 damage to you. If you won five flips this way, you may cast spells from your hand this turn without paying their mana costs.';

function attackSteps() {
  const ir = parseOracleTextToIR(YUSRI_ORACLE, "Yusri, Fortune's Flame");
  const attack = (ir.abilities || []).find((ability) =>
    String(ability.type || '').toLowerCase().includes('trigger')
    || /attacks/i.test(String(ability.raw || ability.text || '')),
  ) || ir.abilities?.find((ability) => (ability.steps || []).some((step) => step.kind === 'choose_number' || step.kind === 'flip_coin'));
  return attack?.steps || [];
}

function makeState(hand: unknown[] = []): GameState {
  return {
    id: 'yusri-fortune-flame',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }, { id: 'c5' }], hand, graveyard: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
    ],
    battlefield: [{
      id: 'yusri_1',
      controller: 'p1',
      owner: 'p1',
      card: { id: 'yusri_card', name: "Yusri, Fortune's Flame", oracle_text: YUSRI_ORACLE, type_line: 'Legendary Creature — Efreet' },
    }],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    turn: 1,
    active: true,
  } as unknown as GameState;
}

describe("Yusri, Fortune's Flame oracle IR", () => {
  it('does not treat the five-flip rider as a static Omniscience grant', () => {
    expect(grantsStaticFreeHandCasts(YUSRI_ORACLE)).toBe(false);
    expect(grantsStaticFreeHandCasts('You may cast spells from your hand without paying their mana costs.')).toBe(true);
  });

  it('parses choose 1-5, flip that many, per-flip draw/damage, and the five-win free-cast rider', () => {
    const steps = attackSteps();
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    expect(steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'choose_number', min: 1, max: 5 }),
      expect.objectContaining({ kind: 'flip_coin', count: 'that_many' }),
      expect.objectContaining({ kind: 'draw' }),
      expect.objectContaining({ kind: 'deal_damage' }),
      expect.objectContaining({
        kind: 'conditional',
        condition: expect.objectContaining({ raw: expect.stringMatching(/won five flips this way/i) }),
      }),
    ]));
  });

  it('grants this-turn free hand casts only after five winning flips', () => {
    const steps = attackSteps();
    const fiveWins = applyOracleIRStepsToGameState(
      makeState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'yusri_1',
        sourceName: "Yusri, Fortune's Flame",
        sourceObjectType: 'ability',
        chosenNumber: 5,
        selectorContext: { chosenNumber: 5 },
        wonCoinFlip: true,
      } as any),
    );
    const fiveWinEffects = ((fiveWins.state as any).lastingEffects || [])
      .filter((entry: any) => entry?.type === 'freeHandCastsThisTurn');
    expect(fiveWinEffects).toEqual([
      expect.objectContaining({
        type: 'freeHandCastsThisTurn',
        controllerId: 'p1',
        duration: 'this_turn',
      }),
    ]);
    expect((fiveWins.state as any).lastCoinFlip?.winCount).toBe(5);

    const fourFlips = applyOracleIRStepsToGameState(
      makeState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'yusri_1',
        sourceName: "Yusri, Fortune's Flame",
        sourceObjectType: 'ability',
        chosenNumber: 4,
        selectorContext: { chosenNumber: 4 },
        wonCoinFlip: true,
      } as any),
    );
    expect(((fourFlips.state as any).lastingEffects || []).some((entry: any) => entry?.type === 'freeHandCastsThisTurn'))
      .toBe(false);
  });
});
