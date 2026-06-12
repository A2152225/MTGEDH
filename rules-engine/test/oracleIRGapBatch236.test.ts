import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { evaluateModifyPtWhereX } from '../src/oracleIRExecutorModifyPtWhereEvaluator';
import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch236');
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
      { id: 'src', controller: p1, card: { type_line: 'Creature' } },
      { id: 'elf-1', controller: p1, type_line: 'Creature — Elf', card: { type_line: 'Creature — Elf' } },
      { id: 'elf-2', controller: p1, type_line: 'Creature — Elf Warrior', card: { type_line: 'Creature — Elf Warrior' } },
      { id: 'land-1', controller: p1, type_line: 'Basic Land — Island', card: { type_line: 'Basic Land — Island' } },
      { id: 'p1-c', controller: p1, type_line: 'Creature — Bear', card: { type_line: 'Creature — Bear' } },
      { id: 'p2-c', controller: p2, type_line: 'Creature — Zombie', card: { type_line: 'Creature — Zombie' } },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 236 support', () => {
  it('parses each player sacrifices a creature of their choice as sacrifice', () => {
    const steps = parseBareTriggerEffectFragmentSteps('each player sacrifices a creature of their choice');
    expect(steps).not.toBeNull();
    expect(steps?.[0]?.kind).toBe('sacrifice');
    expect((steps?.[0] as any).who?.kind).toBe('each_player');
  });

  it('executes distribute counters among target elves without deterministic-target gap', () => {
    const steps = collectStepsFromText('distribute X +1/+1 counters among any number of target elves');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        xValue: 2,
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
    const elfOne = result.state.battlefield?.find((perm: any) => perm.id === 'elf-1') as any;
    expect(Number(elfOne?.counters?.['+1/+1'] || 0)).toBeGreaterThan(0);
  });

  it('executes skip next untap for that land', () => {
    const steps = collectStepsFromText("that land doesn't untap during its controller's next untap step");
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        targetPermanentId: 'land-1',
        selectorContext: { targetPermanentId: 'land-1', chosenObjectIds: ['land-1'] },
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
    const land = result.state.battlefield?.find((perm: any) => perm.id === 'land-1') as any;
    expect(land?.temporaryEffects?.some((effect: any) => /untap/i.test(String(effect?.description || '')))).toBe(true);
  });

  it('executes each player sacrifices a creature of their choice with bound targets', () => {
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

  it('applies modify_pt where x is devotion to red', () => {
    const steps = collectStepsFromText(
      'it gets +X/+0 until end of turn, where X is your devotion to red.'
    );
    const state = baseState({
      battlefield: [
        { id: 'src', controller: 'p1', type_line: 'Creature', card: { type_line: 'Creature', mana_cost: '{R}' } },
        {
          id: 'red-perm',
          controller: 'p1',
          type_line: 'Artifact',
          mana_cost: '{R}{R}',
          card: { type_line: 'Artifact', mana_cost: '{R}{R}' },
        },
      ],
    } as Partial<GameState>);
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        targetCreatureId: 'src',
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'no_applicable_targets')).toBe(false);
  });

  it('creates wolf tokens using sacrificed creature toughness reference', () => {
    const steps = collectStepsFromText(
      "create X 2/2 green Wolf creature tokens, where X is the sacrificed creature's toughness."
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        xValue: 2,
        lastSacrificedPermanents: [
          { id: 'sac-1', type_line: 'Creature', toughness: 4, power: 2, cmc: 3 },
        ],
      } as any)
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'unknown_amount')).toBe(false);
    expect((result.appliedSteps || []).length).toBeGreaterThan(0);
  });

  it('creates a token copy of this creature', () => {
    const steps = collectStepsFromText("create a token that's a copy of this creature instead.");
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'impossible_action')).toBe(false);
    expect((result.state.battlefield || []).some((perm: any) => perm.isToken)).toBe(true);
  });

  it('creates a token copy of that wizard', () => {
    const steps = collectStepsFromText("create a token that's a copy of that wizard.");
    const state = baseState({
      battlefield: [
        { id: 'src', controller: 'p1', card: { type_line: 'Creature' } },
        {
          id: 'wizard-1',
          controller: 'p1',
          type_line: 'Creature — Human Wizard',
          card: { type_line: 'Creature — Human Wizard' },
        },
      ],
    } as Partial<GameState>);
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        selectorContext: { chosenObjectIds: ['wizard-1'] },
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'impossible_action')).toBe(false);
  });

  it('resolves elf distribute targets without bound elf ids', () => {
    const steps = collectStepsFromText('distribute two +1/+1 counters among any number of target elves');
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
  });

  it('evaluates greatest power among tapped creatures your opponents control', () => {
    const state = baseState({
      battlefield: [
        { id: 'src', controller: 'p1', type_line: 'Creature', card: { type_line: 'Creature' } },
        {
          id: 'p2-c',
          controller: 'p2',
          tapped: true,
          power: 6,
          toughness: 2,
          type_line: 'Creature — Beast',
          card: { type_line: 'Creature — Beast', power: '6', toughness: '2' },
        },
      ],
    } as Partial<GameState>);
    const whereX = evaluateModifyPtWhereX(
      state,
      'p1' as PlayerID,
      'x is the greatest power among tapped creatures your opponents control',
      'src',
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    expect(whereX).toBe(6);
  });
});
