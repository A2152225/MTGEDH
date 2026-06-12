import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseSacrificeWhat } from '../src/oracleIRExecutorBattlefieldStepHandlers';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch239');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function baseState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  const p3 = 'p3' as PlayerID;
  const p4 = 'p4' as PlayerID;
  return {
    turnNumber: 1,
    players: [
      { id: p1, name: 'P1', hand: [], library: [], graveyard: [] },
      { id: p2, name: 'P2', hand: [], library: [], graveyard: [] },
      { id: p3, name: 'P3', hand: [], library: [], graveyard: [] },
      { id: p4, name: 'P4', hand: [], library: [], graveyard: [] },
    ],
    battlefield: [
      { id: 'src', controller: p1, type_line: 'Creature — Demon', card: { type_line: 'Creature — Demon' } },
      { id: 'p1-food', controller: p1, isToken: true, type_line: 'Token Artifact — Food', card: { type_line: 'Token Artifact — Food' } },
      { id: 'p1-blood-1', controller: p1, isToken: true, type_line: 'Token Artifact — Blood', card: { type_line: 'Token Artifact — Blood' } },
      { id: 'p1-blood-2', controller: p1, isToken: true, type_line: 'Token Artifact — Blood', card: { type_line: 'Token Artifact — Blood' } },
      { id: 'p1-homunculus', controller: p1, type_line: 'Creature — Homunculus', card: { type_line: 'Creature — Homunculus' } },
      { id: 'p1-swamp-1', controller: p1, type_line: 'Basic Land — Swamp', card: { type_line: 'Basic Land — Swamp' } },
      { id: 'p1-swamp-2', controller: p1, type_line: 'Basic Land — Swamp', card: { type_line: 'Basic Land — Swamp' } },
      { id: 'p1-mountain', controller: p1, type_line: 'Basic Land — Mountain', card: { type_line: 'Basic Land — Mountain' } },
      { id: 'p1-powerstone', controller: p1, isToken: true, type_line: 'Token Artifact — Powerstone', card: { type_line: 'Token Artifact — Powerstone' } },
      { id: 'p1-egg', controller: p1, isToken: true, type_line: 'Token Creature — Egg', card: { type_line: 'Token Creature — Egg' } },
      { id: 'p2-small', controller: p2, power: 2, toughness: 2, type_line: 'Creature — Bear', card: { type_line: 'Creature — Bear', power: '2', toughness: '2' } },
      { id: 'p2-big', controller: p2, power: 6, toughness: 6, type_line: 'Creature — Giant', card: { type_line: 'Creature — Giant', power: '6', toughness: '6' } },
      { id: 'p3-creature', controller: p3, type_line: 'Creature — Zombie', card: { type_line: 'Creature — Zombie' } },
      { id: 'p4-creature', controller: p4, type_line: 'Creature — Elf', card: { type_line: 'Creature — Elf' } },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 239 support', () => {
  it('parses greatest-power opponent sacrifice selectors', () => {
    const parsed = parseSacrificeWhat({
      kind: 'raw',
      text: 'a creature with the greatest power among creatures they control',
    });
    expect(parsed).toMatchObject({
      mode: 'count',
      count: 1,
      type: 'creature',
      greatestPowerAmongControlled: true,
    });
  });

  it('parses plural basic land sacrifices as lands', () => {
    expect(parseSacrificeWhat({ kind: 'raw', text: 'two swamps' })).toMatchObject({
      mode: 'count',
      count: 2,
      type: 'land',
      subtype: 'swamp',
    });
  });

  it('sacrifices a homunculus', () => {
    const steps = collectStepsFromText('Sacrifice a homunculus.');
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield?.some((perm: any) => perm.id === 'p1-homunculus')).toBe(false);
  });

  it('each opponent sacrifices a creature', () => {
    const steps = collectStepsFromText('Each opponent sacrifices a creature.');
    const state = baseState({
      battlefield: [
        { id: 'src', controller: 'p1', type_line: 'Creature — Demon', card: { type_line: 'Creature — Demon' } },
        { id: 'p2-creature', controller: 'p2', type_line: 'Creature — Bear', card: { type_line: 'Creature — Bear' } },
        { id: 'p3-creature', controller: 'p3', type_line: 'Creature — Zombie', card: { type_line: 'Creature — Zombie' } },
        { id: 'p4-creature', controller: 'p4', type_line: 'Creature — Elf', card: { type_line: 'Creature — Elf' } },
      ],
    });
    const result = applyOracleIRStepsToGameState(
      state,
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield?.some((perm: any) => perm.controller === 'p2')).toBe(false);
    expect(result.state.battlefield?.some((perm: any) => perm.controller === 'p3')).toBe(false);
    expect(result.state.battlefield?.some((perm: any) => perm.controller === 'p4')).toBe(false);
  });

  it('each opponent sacrifices their greatest-power creature', () => {
    const steps = collectStepsFromText(
      'Each opponent sacrifices a creature with the greatest power among creatures they control.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield?.some((perm: any) => perm.id === 'p2-big')).toBe(false);
    expect(result.state.battlefield?.some((perm: any) => perm.id === 'p2-small')).toBe(true);
  });

  it('evaluates if you cannot after a successful swamp sacrifice', () => {
    const steps = collectStepsFromText(
      "Sacrifice two Swamps. If you can't, tap this creature."
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield?.find((perm: any) => perm.id === 'src')?.tapped).not.toBe(true);
  });
});
