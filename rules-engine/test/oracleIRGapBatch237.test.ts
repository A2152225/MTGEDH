import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { evaluateModifyPtWhereX } from '../src/oracleIRExecutorModifyPtWhereEvaluator';
import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch237');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function baseState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    turnNumber: 1,
    players: [
      { id: p1, name: 'P1', hand: [], library: [], graveyard: [] },
      { id: p2, name: 'P2', hand: [], library: [], graveyard: [] },
    ],
    battlefield: [
      { id: 'src', controller: p1, type_line: 'Creature', card: { type_line: 'Creature' } },
      { id: 'p1-c', controller: p1, type_line: 'Creature — Bear', card: { type_line: 'Creature — Bear' } },
      { id: 'p2-c', controller: p2, type_line: 'Creature — Zombie', card: { type_line: 'Creature — Zombie' } },
      { id: 'wizard-1', controller: p1, type_line: 'Creature — Human Wizard', card: { type_line: 'Creature — Human Wizard' } },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 237 support', () => {
  it('executes each player sacrifices a creature of their choice with one pick per player', () => {
    const steps = parseBareTriggerEffectFragmentSteps('each player sacrifices a creature of their choice') || [];
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        selectorContext: { chosenObjectIds: ['p1-c', 'p2-c'] },
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
    expect(result.state.battlefield?.some((perm: any) => perm.id === 'p1-c')).toBe(false);
    expect(result.state.battlefield?.some((perm: any) => perm.id === 'p2-c')).toBe(false);
  });

  it('executes lose life equal to sacrificed permanent mana value from context snapshot', () => {
    const steps = collectStepsFromText(
      'each opponent loses life equal to the mana value of the sacrificed permanent'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        lastSacrificedPermanents: [
          { id: 'sac-1', typeLine: 'artifact', manaValue: 5, mana_value: 5, cmc: 5, colors: [] },
        ],
      } as any)
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unknown_amount')).toBe(false);
    const p2 = result.state.players?.find((player) => player.id === 'p2') as any;
    expect(Number(p2?.life)).toBeLessThan(40);
  });

  it('applies all creatures -X/-X where X is sacrificed creature toughness', () => {
    const steps = collectStepsFromText(
      "all creatures get -X/-X until end of turn, where X is the sacrificed creature's toughness."
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        lastSacrificedPermanents: [
          { id: 'sac-1', typeLine: 'creature — bear', toughness: 4, power: 2, colors: ['G'] },
        ],
      } as any)
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unsupported_where_clause')).toBe(false);
    expect((result.appliedSteps || []).length).toBeGreaterThan(0);
  });

  it('creates token copy of that wizard from bound wizard target', () => {
    const steps = collectStepsFromText("create a token that's a copy of that wizard.");
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        selectorContext: { chosenObjectIds: ['wizard-1'] },
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'impossible_action')).toBe(false);
  });

  it('evaluates where X is the result minus 1 from die roll state', () => {
    const state = baseState({
      lastDieRoll: { result: 5 },
      lastDieRollByPlayer: { p1: { result: 5 } },
    } as Partial<GameState>);
    const whereX = evaluateModifyPtWhereX(
      state,
      'p1' as PlayerID,
      'x is the result minus 1',
      'src',
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    expect(whereX).toBe(4);
  });

  it('creates myriad-style token copies for each other opponent', () => {
    const steps = collectStepsFromText(
      "For each opponent other than defending player, create a token that's a copy of it. Those tokens enter tapped and attacking. Exile them at end of combat."
    );
    const state = baseState({
      players: [
        { id: 'p1', name: 'P1', hand: [], library: [], graveyard: [] },
        { id: 'p2', name: 'P2', hand: [], library: [], graveyard: [] },
        { id: 'p3', name: 'P3', hand: [], library: [], graveyard: [] },
        { id: 'p4', name: 'P4', hand: [], library: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'src',
          controller: 'p1',
          type_line: 'Legendary Creature — Human Ninja',
          card: { type_line: 'Legendary Creature — Human Ninja' },
        },
      ],
    } as Partial<GameState>);
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        selectorContext: { targetOpponentId: 'p2' as PlayerID, chosenObjectIds: ['src'] },
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'impossible_action')).toBe(false);
    expect((result.state.battlefield || []).filter((perm: any) => perm.isToken).length).toBeGreaterThan(0);
  });
});
