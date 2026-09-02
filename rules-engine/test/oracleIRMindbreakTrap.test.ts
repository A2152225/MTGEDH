import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import type { GameState, PlayerID } from '../../shared/src/index.js';

// Oracle from mtg_data.db (is_token = 0):
const MINDBREAK_TRAP_ORACLE =
  "If an opponent cast three or more spells this turn, you may pay {0} rather than pay this spell's mana cost.\nExile any number of target spells.";

function collectSteps(oracleText: string, sourceName: string) {
  return parseOracleTextToIR(oracleText, sourceName)
    .abilities
    .flatMap((ability) => ability.steps || []);
}

describe('Mindbreak Trap exile any number of target spells', () => {
  it('parses into an exile step with no unknowns', () => {
    const ir = parseOracleTextToIR(MINDBREAK_TRAP_ORACLE, 'Mindbreak Trap');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const spellSteps = ir.abilities
      .filter((ability) => String(ability.type || '').toLowerCase() === 'spell')
      .flatMap((ability) => ability.steps || []);
    expect(steps.every((step) => step.kind !== 'unknown')).toBe(true);
    expect(spellSteps.some((step) => step.kind === 'exile')).toBe(true);
    expect(spellSteps.every((step) => !/rather than pay this spell/i.test(String((step as any).raw || '')))).toBe(true);
  });

  it('exiles every chosen stack spell, including uncounterable ones', () => {
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
          canBeCountered: false,
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
          id: 'stack_mindbreak_1',
          type: 'spell',
          controller: p1,
          owner: p1,
          card: { id: 'mindbreak_1', name: 'Mindbreak Trap', type_line: 'Instant — Trap' },
        },
      ],
      battlefield: [],
    } as unknown as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Mindbreak Trap',
      sourceId: 'stack_mindbreak_1',
      sourceObjectType: 'spell',
      targetSpellId: 'stack_warp_1',
      selectorContext: { chosenObjectIds: ['stack_warp_1', 'stack_warp_copy_1'] },
    });

    const steps = collectSteps(MINDBREAK_TRAP_ORACLE, 'Mindbreak Trap');
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });

    expect(result.appliedSteps.some((step) => step.kind === 'exile')).toBe(true);
    const stack = (result.state as any).stack || [];
    expect(stack.map((item: any) => item.id)).toEqual(['stack_mindbreak_1']);
    const owner = (result.state as any).players.find((player: any) => player.id === p2);
    expect((owner?.exile || []).map((card: any) => card.id)).toEqual(
      expect.arrayContaining(['warp_world_1', 'warp_world_copy_1']),
    );
  });

  it('exiles zero spells when no targets are bound', () => {
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
          id: 'stack_mindbreak_1',
          type: 'spell',
          controller: p1,
          owner: p1,
          card: { id: 'mindbreak_1', name: 'Mindbreak Trap', type_line: 'Instant — Trap' },
        },
      ],
      battlefield: [],
    } as unknown as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Mindbreak Trap',
      sourceId: 'stack_mindbreak_1',
      sourceObjectType: 'spell',
    });

    const steps = collectSteps(MINDBREAK_TRAP_ORACLE, 'Mindbreak Trap');
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });

    const stack = (result.state as any).stack || [];
    expect(stack.map((item: any) => item.id)).toEqual(['stack_warp_1', 'stack_mindbreak_1']);
  });

  it('reads object-shaped stacks', () => {
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
            id: 'stack_mindbreak_1',
            type: 'spell',
            controller: p1,
            owner: p1,
            card: { id: 'mindbreak_1', name: 'Mindbreak Trap', type_line: 'Instant — Trap' },
          },
        ],
      },
      battlefield: [],
    } as unknown as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Mindbreak Trap',
      sourceId: 'stack_mindbreak_1',
      sourceObjectType: 'spell',
      targetSpellId: 'stack_warp_1',
    });

    const steps = collectSteps(MINDBREAK_TRAP_ORACLE, 'Mindbreak Trap');
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });

    const objects = (result.state as any).stack?.objects || [];
    expect(objects.map((item: any) => item.id)).toEqual(['stack_mindbreak_1']);
    const owner = (result.state as any).players.find((player: any) => player.id === p2);
    expect((owner?.exile || []).map((card: any) => card.id)).toContain('warp_world_1');
  });
});
