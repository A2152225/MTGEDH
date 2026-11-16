import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyExileStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const HAYWIRE_MITE_ACTIVATED =
  '{G}, Sacrifice this creature: Exile target noncreature artifact or noncreature enchantment.';

function board(): GameState {
  return {
    players: [
      { id: 'p1', exile: [], graveyard: [] },
      { id: 'p2', exile: [], graveyard: [] },
    ],
    battlefield: [
      {
        id: 'sol-ring',
        controller: 'p2',
        owner: 'p2',
        card: { name: 'Sol Ring', type_line: 'Artifact' },
      },
      {
        id: 'rhystic',
        controller: 'p2',
        owner: 'p2',
        card: { name: 'Rhystic Study', type_line: 'Enchantment' },
      },
      {
        id: 'ornithopter',
        controller: 'p2',
        owner: 'p2',
        card: { name: 'Ornithopter', type_line: 'Artifact Creature — Thopter' },
      },
      {
        id: 'bear',
        controller: 'p2',
        owner: 'p2',
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ],
  } as GameState;
}

describe('Haywire Mite noncreature artifact or enchantment exile', () => {
  it('parses the or-target as artifact or enchantment, excluding creatures', () => {
    expect(
      parseSimpleBattlefieldSelector({
        kind: 'raw',
        text: 'target noncreature artifact or noncreature enchantment',
      }),
    ).toMatchObject({
      types: ['artifact', 'enchantment'],
      excludeCreature: true,
    });
    expect(
      parseSimpleBattlefieldSelector({ kind: 'raw', text: 'target noncreature artifact' }),
    ).toMatchObject({
      types: ['artifact'],
      excludeCreature: true,
    });
    expect(
      parseSimpleBattlefieldSelector({ kind: 'raw', text: 'target artifact or enchantment' }),
    ).toMatchObject({
      types: ['artifact', 'enchantment'],
    });
    expect(
      parseSimpleBattlefieldSelector({ kind: 'raw', text: 'target artifact or enchantment' })?.excludeCreature,
    ).toBeUndefined();
  });

  it('exiles the chosen noncreature artifact and leaves artifact creatures', () => {
    const ir = parseOracleTextToIR(HAYWIRE_MITE_ACTIVATED, 'Haywire Mite');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const exile = steps.find((step) => step.kind === 'exile');
    expect(exile).toBeTruthy();
    expect(String((exile as any)?.target?.text || '')).toMatch(/noncreature artifact or noncreature enchantment/i);

    const result = applyOracleIRStepsToGameState(
      board(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'mite',
        sourceName: 'Haywire Mite',
        sourceObjectType: 'ability',
        targetPermanentId: 'sol-ring',
        chosenObjectIds: ['sol-ring'],
        selectorContext: { chosenObjectIds: ['sol-ring'], targetPermanentId: 'sol-ring' },
      }),
      { allowOptional: true },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toContain('exile');
    expect(result.skippedSteps.map((step) => step.kind)).not.toContain('exile');
    expect((result.state.battlefield || []).map((perm: any) => perm.id).sort()).toEqual([
      'bear',
      'ornithopter',
      'rhystic',
    ]);
    const exileZone = (result.state.players || []).find((player: any) => player.id === 'p2')?.exile || [];
    expect(exileZone.map((card: any) => card.name)).toEqual(['Sol Ring']);
  });

  it('exiles a chosen noncreature enchantment and does not exile an artifact creature when that is the only artifact', () => {
    const state = board();
    state.battlefield = (state.battlefield || []).filter((perm: any) => perm.id !== 'sol-ring');
    const result = applyExileStep(
      state,
      {
        kind: 'exile',
        target: { kind: 'raw', text: 'target noncreature artifact or noncreature enchantment' },
        raw: 'Exile target noncreature artifact or noncreature enchantment.',
      } as any,
      {
        controllerId: 'p1',
        targetPermanentId: 'rhystic',
        selectorContext: { chosenObjectIds: ['rhystic'], targetPermanentId: 'rhystic' },
      } as any,
    );

    expect(result.applied).toBe(true);
    expect((result.state?.battlefield || []).map((perm: any) => perm.id).sort()).toEqual([
      'bear',
      'ornithopter',
    ]);
  });

  it('does not exile an artifact creature when nothing else is legal', () => {
    const state = board();
    state.battlefield = (state.battlefield || []).filter((perm: any) => perm.id === 'ornithopter');
    const result = applyExileStep(
      state,
      {
        kind: 'exile',
        target: { kind: 'raw', text: 'target noncreature artifact or noncreature enchantment' },
        raw: 'Exile target noncreature artifact or noncreature enchantment.',
      } as any,
      {
        controllerId: 'p1',
        targetPermanentId: 'ornithopter',
        selectorContext: { chosenObjectIds: ['ornithopter'], targetPermanentId: 'ornithopter' },
      } as any,
    );

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('no_deterministic_target');
    expect((state.battlefield || []).map((perm: any) => perm.id)).toEqual(['ornithopter']);
  });
});
