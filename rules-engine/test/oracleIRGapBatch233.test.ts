import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

function collectStepsFromText(text: string): ReturnType<typeof parseOracleTextToIR>['abilities'][number]['steps'] {
  const ir = parseOracleTextToIR(text, 'Batch233');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function counterState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    turnNumber: 1,
    players: [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }],
    battlefield: [
      { id: 'src', controller: p1, card: { name: 'Siege', type_line: 'Creature' }, power: 3, toughness: 3 },
      { id: 'ally', controller: p1, card: { type_line: 'Creature — Elf' }, power: 2, toughness: 2 },
      { id: 'elf2', controller: p1, card: { type_line: 'Creature — Elf' } },
      { id: 'land1', controller: p1, card: { type_line: 'Land' } },
      { id: 'cmd', controller: p1, card: { type_line: 'Legendary Creature' }, isCommander: true, power: 5, toughness: 5 },
      { id: 'aura', controller: p1, card: { type_line: 'Enchantment — Aura' }, attachedTo: 'ally' },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 233 support', () => {
  it('executes X counters on it using ctx.xValue', () => {
    const steps = collectStepsFromText('put X +1/+1 counters on it.');
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        xValue: 2,
      }),
    );
    expect(result.appliedSteps).toHaveLength(1);
    const src = result.state.battlefield?.find((entry) => entry.id === 'src') as any;
    expect(src?.counters?.['+1/+1']).toBe(2);
  });

  it('executes X counters on that creature via trigger target', () => {
    const steps = collectStepsFromText('put X +1/+1 counters on that creature.');
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        targetPermanentId: 'ally',
        xValue: 3,
      }),
    );
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(ally?.counters?.['+1/+1']).toBe(3);
  });

  it('executes X counters on enchanted permanent from aura source', () => {
    const steps = collectStepsFromText('put X +1/+1 counters on enchanted permanent.');
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'aura',
        xValue: 2,
      }),
    );
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(ally?.counters?.['+1/+1']).toBe(2);
  });

  it('executes X counters on target land you control', () => {
    const steps = collectStepsFromText('put X +1/+1 counters on target land you control.');
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        targetPermanentId: 'land1',
        xValue: 1,
      }),
    );
    const land = result.state.battlefield?.find((entry) => entry.id === 'land1') as any;
    expect(land?.counters?.['+1/+1']).toBe(1);
  });

  it('executes distribute X among target elves', () => {
    const steps = collectStepsFromText(
      'distribute X +1/+1 counters among any number of target elves.',
    );
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        xValue: 2,
        selectorContext: { chosenObjectIds: ['ally', 'elf2'] },
      }),
    );
    expect(result.appliedSteps).toHaveLength(1);
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    const elf2 = result.state.battlefield?.find((entry) => entry.id === 'elf2') as any;
    expect((ally?.counters?.['+1/+1'] ?? 0) + (elf2?.counters?.['+1/+1'] ?? 0)).toBe(2);
  });

  it('executes distribute X among other target creatures you control', () => {
    const steps = collectStepsFromText(
      'distribute X +1/+1 counters among any number of other target creatures you control.',
    );
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        xValue: 2,
        selectorContext: { chosenObjectIds: ['ally', 'elf2'] },
      }),
    );
    expect(result.appliedSteps).toHaveLength(1);
  });

  it('executes distribute X among it and commanders', () => {
    const steps = collectStepsFromText(
      'distribute X +1/+1 counters among it and any number of commanders.',
    );
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        xValue: 2,
        interactivePlayerChoices: false,
      }),
    );
    expect(result.appliedSteps).toHaveLength(1);
    const src = result.state.battlefield?.find((entry) => entry.id === 'src') as any;
    const cmd = result.state.battlefield?.find((entry) => entry.id === 'cmd') as any;
    expect((src?.counters?.['+1/+1'] ?? 0) + (cmd?.counters?.['+1/+1'] ?? 0)).toBe(2);
  });

  it('executes power-scaled counters on another target creature', () => {
    const steps = collectStepsFromText(
      "put a number of +1/+1 counters equal to this permanent's power on another target creature you control.",
    );
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        targetPermanentId: 'ally',
      }),
    );
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(ally?.counters?.['+1/+1']).toBe(3);
  });

  it('executes each of those permanents antecedent counters', () => {
    const steps = collectStepsFromText('put X +1/+1 counters on each of those permanents.');
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        xValue: 1,
        lastAntecedentBattlefieldPermanentIds: ['ally', 'elf2'],
      }),
    );
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    const elf2 = result.state.battlefield?.find((entry) => entry.id === 'elf2') as any;
    expect(ally?.counters?.['+1/+1']).toBe(1);
    expect(elf2?.counters?.['+1/+1']).toBe(1);
  });

  it('executes creatures you control with power 4 or greater pump', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'creatures you control with power 4 or greater get +2/+2 until end of turn.',
    )!;
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    const cmd = result.state.battlefield?.find((entry) => entry.id === 'cmd') as any;
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(cmd?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);
    expect(ally?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('executes each creature you control with a counter on it pump', () => {
    const state = counterState({
      battlefield: [
        { id: 'src', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, power: 1, toughness: 1 },
        { id: 'buffed', controller: 'p1' as PlayerID, card: { type_line: 'Creature' }, counters: { '+1/+1': 1 } },
        { id: 'plain', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    });
    const steps = parseBareTriggerEffectFragmentSteps(
      'each creature you control with a counter on it gets +1/+1 until end of turn.',
    )!;
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' }),
    );
    const buffed = result.state.battlefield?.find((entry) => entry.id === 'buffed') as any;
    const plain = result.state.battlefield?.find((entry) => entry.id === 'plain') as any;
    expect(buffed?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 1 && entry?.toughness === 1,
    )).toBe(true);
    expect(plain?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('executes aura this-creature pump via enchanted creature', () => {
    const steps = parseBareTriggerEffectFragmentSteps('it gets +0/+2 until end of turn.')!;
    const result = applyOracleIRStepsToGameState(
      counterState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'aura' }),
    );
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(ally?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 0 && entry?.toughness === 2,
    )).toBe(true);
  });
});
