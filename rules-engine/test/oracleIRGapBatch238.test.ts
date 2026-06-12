import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch238');
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
      { id: 'p1-c1', controller: p1, type_line: 'Creature — Bear', card: { type_line: 'Creature — Bear' } },
      { id: 'p1-c2', controller: p1, type_line: 'Creature — Elf', card: { type_line: 'Creature — Elf' } },
      { id: 'p1-c3', controller: p1, type_line: 'Creature — Human', card: { type_line: 'Creature — Human' } },
      { id: 'p2-c1', controller: p2, type_line: 'Creature — Zombie', card: { type_line: 'Creature — Zombie' } },
      { id: 'p2-c2', controller: p2, type_line: 'Creature — Goblin', card: { type_line: 'Creature — Goblin' } },
      { id: 'p2-c3', controller: p2, type_line: 'Creature — Orc', card: { type_line: 'Creature — Orc' } },
      { id: 'p3-c1', controller: p3, type_line: 'Creature — Cat', card: { type_line: 'Creature — Cat' } },
      { id: 'p3-c2', controller: p3, type_line: 'Creature — Dog', card: { type_line: 'Creature — Dog' } },
      { id: 'p3-c3', controller: p3, type_line: 'Creature — Bird', card: { type_line: 'Creature — Bird' } },
      { id: 'p4-c1', controller: p4, type_line: 'Creature — Snake', card: { type_line: 'Creature — Snake' } },
      { id: 'p4-c2', controller: p4, type_line: 'Creature — Frog', card: { type_line: 'Creature — Frog' } },
      { id: 'p4-c3', controller: p4, type_line: 'Creature — Fish', card: { type_line: 'Creature — Fish' } },
      { id: 'opp-c', controller: p2, type_line: 'Creature — Beast', card: { type_line: 'Creature — Beast' } },
      { id: 'equipped', controller: p1, type_line: 'Creature — Warrior', card: { type_line: 'Creature — Warrior' } },
      {
        id: 'hammer',
        controller: p1,
        type_line: 'Artifact — Equipment',
        attachedTo: 'equipped',
        card: { type_line: 'Artifact — Equipment' },
      },
      {
        id: 'aura-1',
        controller: p1,
        type_line: 'Enchantment — Aura',
        attachedTo: 'src',
        card: { type_line: 'Enchantment — Aura' },
      },
      {
        id: 'equip-1',
        controller: p1,
        type_line: 'Artifact — Equipment',
        attachedTo: 'src',
        card: { type_line: 'Artifact — Equipment' },
      },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 238 support', () => {
  it('sacrifices a non-demon creature without sacrificing the demon source', () => {
    const steps = collectStepsFromText(
      "Sacrifice a non-Demon creature. If you do, create a token that's a copy of this creature."
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        selectorContext: { chosenObjectIds: ['p1-c1'] },
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'impossible_action')).toBe(false);
    expect(result.state.battlefield?.some((perm: any) => perm.id === 'src')).toBe(true);
    expect(result.state.battlefield?.some((perm: any) => perm.isToken)).toBe(true);
  });

  it('creates copy tokens from attached auras and equipment', () => {
    const steps = collectStepsFromText(
      "For each aura and equipment attached to this permanent, create a token that's a copy of it attached to this permanent twin."
    );
    const twinState = applyOracleIRStepsToGameState(
      baseState(),
      [
        {
          kind: 'create_token',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          token: 'legendary 3/4 red and green human warrior creature',
          raw: 'create this permanent twin, a legendary 3/4 red and green human warrior creature token',
        } as any,
      ],
      buildOracleIRExecutionContext({ controllerId: 'p1' as PlayerID, sourceId: 'src' })
    );
    const twinId = twinState.state.battlefield?.find((perm: any) => perm.isToken && perm.id !== 'src')?.id;
    const result = applyOracleIRStepsToGameState(
      twinState.state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        lastCreatedTokenIds: twinId ? [twinId] : [],
        lastMovedBattlefieldPermanentIds: twinId ? [twinId] : [],
      } as any)
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'impossible_action')).toBe(false);
    expect(result.state.battlefield?.filter((perm: any) => perm.isToken).length).toBeGreaterThan(1);
  });

  it('modifies equipped creature after die roll', () => {
    const steps = collectStepsFromText(
      'Roll a six-sided die. That creature gets +X/+0 until end of turn, where X is the result.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'hammer',
      })
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
  });

  it('parses copy-of-it exception text without a comma before except', () => {
    const steps = collectStepsFromText(
      "Create a token that's a copy of that creature except it's an artifact in addition to its other types."
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'src',
        targetCreatureId: 'opp-c',
        targetPermanentId: 'opp-c',
        lastMovedBattlefieldPermanentIds: ['opp-c'],
      } as any)
    );
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'impossible_action')).toBe(false);
    expect(result.state.battlefield?.some((perm: any) => perm.isToken)).toBe(true);
  });
});
