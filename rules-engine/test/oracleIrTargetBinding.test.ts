import { describe, expect, it } from 'vitest';

import { inferOracleIrTargetBinding, resolveOracleIrBoundTargetSpellId } from '../src/oracleIrTargetBinding';

describe('inferOracleIrTargetBinding', () => {
  const state = {
    players: [
      { id: 'p1', graveyard: [{ id: 'gy_card', name: 'Dead Guy' }] },
      { id: 'p2', hand: [], graveyard: [], library: [], exile: [] },
    ],
    battlefield: [
      {
        id: 'perm_creature',
        controller: 'p2',
        card: { type_line: 'Creature — Beast' },
      },
      {
        id: 'perm_artifact',
        controller: 'p1',
        card: { type_line: 'Artifact' },
      },
    ],
    stack: [{ id: 'stack_spell', controller: 'p1', card: { name: 'Counterspell' } }],
  };

  it('binds battlefield creatures to permanent and creature ids', () => {
    expect(inferOracleIrTargetBinding(state, ['perm_creature'], 'p1')).toEqual({
      targetPermanentId: 'perm_creature',
      targetCreatureId: 'perm_creature',
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      chosenObjectIds: ['perm_creature'],
    });
  });

  it('binds noncreature permanents without targetCreatureId', () => {
    expect(inferOracleIrTargetBinding(state, ['perm_artifact'], 'p1')).toEqual({
      targetPermanentId: 'perm_artifact',
      targetPlayerId: 'p1',
      chosenObjectIds: ['perm_artifact'],
    });
  });

  it('binds stack spell targets', () => {
    expect(inferOracleIrTargetBinding(state, ['stack_spell'], 'p1')).toEqual({
      targetSpellId: 'stack_spell',
      chosenObjectIds: ['stack_spell'],
    });
  });

  it('binds graveyard card targets via chosenObjectIds', () => {
    expect(inferOracleIrTargetBinding(state, ['gy_card'], 'p1')).toEqual({
      chosenObjectIds: ['gy_card'],
    });
  });

  it('marks opponent player targets separately from caster', () => {
    expect(inferOracleIrTargetBinding(state, ['p2'], 'p1')).toEqual({
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      chosenObjectIds: ['p2'],
    });
  });

  it('resolveOracleIrBoundTargetSpellId reads top-level or selectorContext', () => {
    expect(resolveOracleIrBoundTargetSpellId({ targetSpellId: 'stack_spell' })).toBe('stack_spell');
    expect(resolveOracleIrBoundTargetSpellId({ selectorContext: { targetSpellId: 'stack_spell' } })).toBe(
      'stack_spell',
    );
    expect(resolveOracleIrBoundTargetSpellId(undefined)).toBe('');
  });

  it('omits targetPlayerId when multi-target permanents have different controllers', () => {
    const multiTargetState = {
      ...state,
      battlefield: [
        {
          id: 'perm_v1',
          controller: 'p2',
          card: { type_line: 'Creature — Beast' },
        },
        {
          id: 'perm_o1',
          controller: 'p1',
          card: { type_line: 'Creature — Elf' },
        },
      ],
    };
    expect(inferOracleIrTargetBinding(multiTargetState, ['perm_v1', 'perm_o1'], 'p1')).toEqual({
      targetPermanentId: 'perm_v1',
      targetCreatureId: 'perm_v1',
      chosenObjectIds: ['perm_v1', 'perm_o1'],
    });
  });

  it('binds shared targetPlayerId when all multi-target permanents share a controller', () => {
    const multiTargetState = {
      ...state,
      battlefield: [
        {
          id: 'perm_v1',
          controller: 'p2',
          card: { type_line: 'Creature — Beast' },
        },
        {
          id: 'perm_v2',
          controller: 'p2',
          card: { type_line: 'Creature — Elf' },
        },
      ],
    };
    expect(inferOracleIrTargetBinding(multiTargetState, ['perm_v1', 'perm_v2'], 'p1')).toEqual({
      targetPermanentId: 'perm_v1',
      targetCreatureId: 'perm_v1',
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      chosenObjectIds: ['perm_v1', 'perm_v2'],
    });
  });
});
