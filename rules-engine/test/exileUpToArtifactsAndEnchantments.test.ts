import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyExileStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const SYLVAN_ORACLE =
  'Exile up to two target artifacts and/or enchantments. Basic landcycling {2} ({2}, Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.)';

describe('Exile up to N target artifacts and/or enchantments', () => {
  it('exiles bound artifact and enchantment targets', () => {
    const state = {
      players: [{ id: 'p1', exile: [] }],
      battlefield: [
        { id: 'sol-ring', controller: 'p2', card: { name: 'Sol Ring', type_line: 'Artifact' } },
        { id: 'rhystic', controller: 'p2', card: { name: 'Rhystic Study', type_line: 'Enchantment' } },
        { id: 'bear', controller: 'p2', card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' } },
      ],
    } as GameState;

    const result = applyExileStep(
      state,
      {
        kind: 'exile',
        target: { kind: 'raw', text: 'up to two target artifacts and/or enchantments' },
        raw: 'Exile up to two target artifacts and/or enchantments',
      } as any,
      {
        controllerId: 'p1',
        selectorContext: { chosenObjectIds: ['sol-ring', 'rhystic'] },
      } as any,
    );

    expect(result.applied).toBe(true);
    expect(result.reason).toBeUndefined();
    expect((result.state?.battlefield || []).map((perm: any) => perm.id)).toEqual(['bear']);
  });

  it('succeeds with zero chosen targets', () => {
    const state = {
      players: [{ id: 'p1', exile: [] }],
      battlefield: [
        { id: 'sol-ring', controller: 'p2', card: { name: 'Sol Ring', type_line: 'Artifact' } },
      ],
    } as GameState;

    const result = applyExileStep(
      state,
      {
        kind: 'exile',
        target: { kind: 'raw', text: 'up to two target artifacts and/or enchantments' },
        raw: 'Exile up to two target artifacts and/or enchantments',
      } as any,
      {
        controllerId: 'p1',
        selectorContext: { chosenObjectIds: [] },
      } as any,
    );

    expect(result.applied).toBe(true);
    expect(result.reason).toBeUndefined();
    expect((result.state?.battlefield || []).map((perm: any) => perm.id)).toEqual(['sol-ring']);
  });

  it('applies Sylvan Reclamation spell IR from bound targets', () => {
    const ir = parseOracleTextToIR(SYLVAN_ORACLE, 'Sylvan Reclamation');
    const exileAbility = ir.abilities.find((ability) =>
      ability.steps.some((step) => step.kind === 'exile'),
    );
    expect(exileAbility).toBeTruthy();

    const start = {
      players: [{ id: 'p1', exile: [], graveyard: [] }],
      battlefield: [
        { id: 'sol-ring', controller: 'p2', card: { name: 'Sol Ring', type_line: 'Artifact' } },
        { id: 'bear', controller: 'p2', card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' } },
      ],
    } as any;

    const result = applyOracleIRStepsToGameState(
      start,
      exileAbility!.steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceName: 'Sylvan Reclamation',
        chosenObjectIds: ['sol-ring'],
        selectorContext: { chosenObjectIds: ['sol-ring'] },
      }),
      { allowOptional: true },
    );

    expect(result.appliedSteps.some((step) => step.kind === 'exile')).toBe(true);
    expect(result.skippedSteps.some((step) => step.kind === 'exile')).toBe(false);
    expect((result.state.battlefield || []).map((perm: any) => perm.id)).toEqual(['bear']);
  });
});
