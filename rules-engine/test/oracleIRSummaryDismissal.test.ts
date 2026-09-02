import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import type { GameState, PlayerID } from '../../shared/src/index.js';

// Oracle from mtg_data.db (is_token = 0): "Exile all other spells and counter all abilities."
const SUMMARY_DISMISSAL_ORACLE = 'Exile all other spells and counter all abilities.';

function collectSteps(oracleText: string, sourceName: string) {
  return parseOracleTextToIR(oracleText, sourceName)
    .abilities
    .flatMap((ability) => ability.steps || []);
}

describe('Summary Dismissal exile other spells and counter abilities', () => {
  it('parses into counter_spell steps with no unknowns', () => {
    const steps = collectSteps(SUMMARY_DISMISSAL_ORACLE, 'Summary Dismissal');
    expect(steps.every((step) => step.kind !== 'unknown')).toBe(true);
    expect(steps.some((step) => step.kind === 'counter_spell')).toBe(true);
  });

  it('exiles other spells, counters abilities, and leaves itself on the stack', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        { id: p1, life: 40, hand: [], library: [], graveyard: [], exile: [] },
        { id: p2, life: 40, hand: [], library: [], graveyard: [], exile: [] },
      ],
      stack: [
        {
          id: 'stack_warp_1',
          type: 'spell',
          controller: p2,
          owner: p2,
          card: { id: 'warp_world_1', name: 'Warp World', type_line: 'Sorcery' },
        },
        {
          id: 'stack_trigger_1',
          type: 'triggered_ability',
          controller: p1,
          description: 'Whenever a player casts a spell, copy it.',
        },
        {
          id: 'stack_summary_1',
          type: 'spell',
          controller: p1,
          owner: p1,
          card: { id: 'summary_1', name: 'Summary Dismissal', type_line: 'Instant' },
        },
      ],
      battlefield: [],
    } as unknown as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Summary Dismissal',
      sourceId: 'stack_summary_1',
      sourceObjectType: 'spell',
    });

    const steps = collectSteps(SUMMARY_DISMISSAL_ORACLE, 'Summary Dismissal');
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });

    expect(result.appliedSteps.some((step) => step.kind === 'counter_spell')).toBe(true);
    const stack = (result.state as any).stack || [];
    expect(stack.map((item: any) => item.id)).toEqual(['stack_summary_1']);
    const owner = (result.state as any).players.find((player: any) => player.id === p2);
    expect((owner?.exile || []).map((card: any) => card.id)).toContain('warp_world_1');
    expect((owner?.graveyard || []).map((card: any) => card.id)).not.toContain('warp_world_1');
  });

  it('still wipes every other spell when a leftover targetSpellId is bound', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        { id: p1, life: 40, hand: [], library: [], graveyard: [], exile: [] },
        { id: p2, life: 40, hand: [], library: [], graveyard: [], exile: [] },
      ],
      stack: [
        {
          id: 'stack_warp_1',
          type: 'spell',
          controller: p2,
          owner: p2,
          card: { id: 'warp_world_1', name: 'Warp World', type_line: 'Sorcery' },
        },
        {
          id: 'stack_warp_copy_1',
          type: 'spell',
          controller: p1,
          owner: p2,
          isCopy: true,
          card: { id: 'warp_world_copy_1', name: 'Warp World', type_line: 'Sorcery' },
        },
        {
          id: 'stack_trigger_1',
          type: 'triggered_ability',
          controller: p1,
          description: 'Whenever a player casts a spell, copy it.',
        },
      ],
      battlefield: [],
    } as unknown as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Summary Dismissal',
      sourceId: 'stack_summary_1',
      sourceObjectType: 'spell',
      targetSpellId: 'stack_warp_1',
    });

    const steps = collectSteps(SUMMARY_DISMISSAL_ORACLE, 'Summary Dismissal');
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });

    const stack = (result.state as any).stack || [];
    expect(stack).toEqual([]);
    const owner = (result.state as any).players.find((player: any) => player.id === p2);
    expect((owner?.exile || []).map((card: any) => card.id)).toEqual(
      expect.arrayContaining(['warp_world_1', 'warp_world_copy_1']),
    );
  });

  it('reads object-shaped stacks and leaves the resolving spell', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        { id: p1, life: 40, hand: [], library: [], graveyard: [], exile: [] },
        { id: p2, life: 40, hand: [], library: [], graveyard: [], exile: [] },
      ],
      stack: {
        objects: [
          {
            id: 'stack_warp_1',
            type: 'spell',
            controller: p2,
            owner: p2,
            card: { id: 'warp_world_1', name: 'Warp World', type_line: 'Sorcery' },
          },
          {
            id: 'stack_summary_1',
            type: 'spell',
            controller: p1,
            owner: p1,
            card: { id: 'summary_1', name: 'Summary Dismissal', type_line: 'Instant' },
          },
        ],
      },
      battlefield: [],
    } as unknown as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Summary Dismissal',
      sourceId: 'stack_summary_1',
      sourceObjectType: 'spell',
    });

    const steps = collectSteps(SUMMARY_DISMISSAL_ORACLE, 'Summary Dismissal');
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });

    const objects = (result.state as any).stack?.objects || [];
    expect(objects.map((item: any) => item.id)).toEqual(['stack_summary_1']);
    const owner = (result.state as any).players.find((player: any) => player.id === p2);
    expect((owner?.exile || []).map((card: any) => card.id)).toContain('warp_world_1');
  });
});
