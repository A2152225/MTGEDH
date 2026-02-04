import { describe, expect, it } from 'vitest';

import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: targeting clauses prefer refs.stackItem', () => {
  it('"if it targets a creature you control with the chosen name" works from refs.stackItem', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          { id: 'perm_src', controller: 'p1', card: { name: 'Source', type_line: 'Creature' } },
          { id: 'perm_bob', controller: 'p1', card: { name: 'Bob', type_line: 'Creature' } },
          { id: 'perm_alice', controller: 'p1', card: { name: 'Alice', type_line: 'Creature' } },
          { id: 'perm_opp', controller: 'p2', card: { name: 'Bob', type_line: 'Creature' } },
        ],
      },
    };

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it targets a creature you control with the chosen name',
        { id: 'perm_src', controller: 'p1', card: { name: 'Source' } } as any,
        {
          chosenName: 'Bob',
          stackItem: { targets: ['perm_bob'] },
        } as any
      )
    ).toBe(true);

    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it targets a creature you control with the chosen name',
        { id: 'perm_src', controller: 'p1', card: { name: 'Source' } } as any,
        {
          chosenName: 'Bob',
          stackItem: { targets: ['perm_alice'] },
        } as any
      )
    ).toBe(false);

    // Unknown target id => conservative null.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it targets a creature you control with the chosen name',
        { id: 'perm_src', controller: 'p1', card: { name: 'Source' } } as any,
        {
          chosenName: 'Bob',
          stackItem: { targets: ['perm_missing'] },
        } as any
      )
    ).toBe(null);
  });

  it('"if it targets one or more other permanents you control" works from refs.stackItem', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [
          { id: 'perm_src', controller: 'p1', card: { name: 'Source', type_line: 'Artifact' } },
          { id: 'perm_other', controller: 'p1', card: { name: 'Other', type_line: 'Artifact' } },
          { id: 'perm_opp', controller: 'p2', card: { name: 'Opp', type_line: 'Artifact' } },
        ],
      },
    };

    // Targets another permanent you control => true.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it targets one or more other permanents you control',
        { id: 'perm_src', controller: 'p1', card: { name: 'Source' } } as any,
        { stackItem: { targets: ['perm_other'] } } as any
      )
    ).toBe(true);

    // Only targets itself => false.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it targets one or more other permanents you control',
        { id: 'perm_src', controller: 'p1', card: { name: 'Source' } } as any,
        { stackItem: { targets: ['perm_src'] } } as any
      )
    ).toBe(false);

    // Unknown target id => conservative null.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it targets one or more other permanents you control',
        { id: 'perm_src', controller: 'p1', card: { name: 'Source' } } as any,
        { stackItem: { targets: ['perm_missing'] } } as any
      )
    ).toBe(null);

    // Works without sourcePermanent when refs provides the source permanent id.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it targets one or more other permanents you control',
        null as any,
        { sourcePermanentId: 'perm_src', stackItem: { targets: ['perm_other'] } } as any
      )
    ).toBe(true);

    // Without sourcePermanent, still excludes itself.
    expect(
      evaluateInterveningIfClause(
        g,
        'p1',
        'if it targets one or more other permanents you control',
        null as any,
        { sourcePermanentId: 'perm_src', stackItem: { targets: ['perm_src'] } } as any
      )
    ).toBe(false);
  });
});
