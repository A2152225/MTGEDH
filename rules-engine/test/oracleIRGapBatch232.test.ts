import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

function combatState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  return {
    turnNumber: 1,
    turnPlayer: p1,
    players: [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }],
    battlefield: [
      { id: 'attacker', controller: p1, attacking: true, card: { type_line: 'Creature' }, power: 3, toughness: 3 },
      { id: 'ally', controller: p1, card: { type_line: 'Creature' }, power: 2, toughness: 2 },
      { id: 'blocker', controller: p2, card: { type_line: 'Creature' }, power: 1, toughness: 1 },
      { id: 'gob1', controller: p1, card: { name: 'Gob', type_line: 'Creature — Goblin' } },
      { id: 'opp', controller: p2, card: { type_line: 'Creature — Artifact' }, power: 2, toughness: 2 },
      { id: 'art-creature', controller: p2, card: { type_line: 'Artifact Creature — Construct' }, power: 4, toughness: 4 },
    ],
    combat: {
      attackers: [{ permanentId: 'attacker' }],
      blockers: [{ permanentId: 'blocker', blocking: ['attacker'] }],
    },
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 232 support', () => {
  it('parses blocking-this-creature and each-of-them compound bare fragments', () => {
    expect(parseBareTriggerEffectFragmentSteps(
      'each creature blocking this creature gets -0/-1 until end of turn.',
    )?.[0]).toMatchObject({
      kind: 'modify_pt',
      target: { kind: 'raw', text: 'each creature blocking this creature' },
      toughness: -1,
    });
    const compound = parseBareTriggerEffectFragmentSteps(
      'each of them gets +x/+x and gains vigilance until end of turn, where x is this creature\'s power.',
    );
    expect(compound).toHaveLength(2);
    expect(compound?.[0]).toMatchObject({ kind: 'modify_pt', powerUsesX: true, toughnessUsesX: true });
    expect(compound?.[1]).toMatchObject({ kind: 'grant_temporary_ability', abilities: ['vigilance'] });
  });

  it('executes combat blockers debuff via each creature blocking this creature', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'each creature blocking this creature gets -0/-1 until end of turn.',
    )!;
    const result = applyOracleIRStepsToGameState(
      combatState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'attacker' }),
    );
    expect(result.appliedSteps).toHaveLength(1);
    const blocker = result.state.battlefield?.find((entry) => entry.id === 'blocker') as any;
    expect(blocker?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 0 && entry?.toughness === -1,
    )).toBe(true);
  });

  it('executes blocking creatures global debuff', () => {
    const steps = parseBareTriggerEffectFragmentSteps('blocking creatures get -1/-1 until end of turn.')!;
    const result = applyOracleIRStepsToGameState(
      combatState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'attacker' }),
    );
    const blocker = result.state.battlefield?.find((entry) => entry.id === 'blocker') as any;
    expect(blocker?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === -1 && entry?.toughness === -1,
    )).toBe(true);
  });

  it('executes each-of-them antecedent scaled pump', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'each of them gets +x/+x until end of turn, where x is this creature\'s power.',
    )!;
    const result = applyOracleIRStepsToGameState(
      combatState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'attacker',
        lastAntecedentBattlefieldPermanentIds: ['ally', 'gob1'],
      }),
    );
    for (const id of ['ally', 'gob1']) {
      const permanent = result.state.battlefield?.find((entry) => entry.id === id) as any;
      expect(permanent?.modifiers?.some((entry: any) =>
        entry?.type === 'powerToughness' && entry?.power === 3 && entry?.toughness === 3,
      )).toBe(true);
    }
  });

  it('executes nonartifact creatures global debuff', () => {
    const steps = parseBareTriggerEffectFragmentSteps('nonartifact creatures get -2/-2 until end of turn.')!;
    const result = applyOracleIRStepsToGameState(
      combatState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'attacker' }),
    );
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    const artCreature = result.state.battlefield?.find((entry) => entry.id === 'art-creature') as any;
    expect(ally?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBe(true);
    expect(artCreature?.modifiers?.some((entry: any) => entry?.type === 'powerToughness')).toBeFalsy();
  });

  it('executes mutate-count other-creatures pump', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'other creatures you control get +x/+x until end of turn, where x is the number of times this creature has mutated.',
    )!;
    const state = combatState({
      battlefield: [
        { id: 'host', controller: 'p1' as PlayerID, mutateCount: 2, card: { type_line: 'Creature' } },
        { id: 'ally', controller: 'p1' as PlayerID, card: { type_line: 'Creature' } },
      ],
    });
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'host' }),
    );
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    expect(ally?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 2 && entry?.toughness === 2,
    )).toBe(true);
  });

  it('executes attacking-you-control scaled self pump', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'this creature gets +x/+0 until end of turn, where x is the number of attacking creatures you control.',
    )!;
    const result = applyOracleIRStepsToGameState(
      combatState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'attacker' }),
    );
    const attacker = result.state.battlefield?.find((entry) => entry.id === 'attacker') as any;
    expect(attacker?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 1 && entry?.toughness === 0,
    )).toBe(true);
  });

  it('executes goblin-scaled team pump', () => {
    const steps = parseBareTriggerEffectFragmentSteps(
      'each creature you control gets +1/+1 until end of turn for each goblin you control.',
    )!;
    const result = applyOracleIRStepsToGameState(
      combatState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'attacker' }),
    );
    const ally = result.state.battlefield?.find((entry) => entry.id === 'ally') as any;
    const gob = result.state.battlefield?.find((entry) => entry.id === 'gob1') as any;
    expect(ally?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 1 && entry?.toughness === 1,
    )).toBe(true);
    expect(gob?.modifiers?.some((entry: any) =>
      entry?.type === 'powerToughness' && entry?.power === 1 && entry?.toughness === 1,
    )).toBe(true);
  });
});
