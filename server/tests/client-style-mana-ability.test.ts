import { describe, expect, it } from 'vitest';

import { resolveManaAbilityActivationShape } from '../src/socket/interaction.js';
import { calculateManaProduction, resolveClientStyleManaAbilityById } from '../src/socket/util.js';

describe('client-style mana ability ids', () => {
  const templeGarden = {
    card: {
      name: 'Temple Garden',
      type_line: 'Land — Forest Plains',
      oracle_text: '{T}: Add {G} or {W}.',
    },
  };

  it('resolves battlefield UI mana ability ids to a single color', () => {
    expect(resolveClientStyleManaAbilityById('card123-mana-g-1')).toEqual({
      id: 'card123-mana-g-1',
      cost: '{T}',
      produces: ['G'],
      amount: 1,
      producesAllAtOnce: false,
    });
  });

  it('does not require a second color choice when the client already picked green', () => {
    const production = calculateManaProduction(
      { battlefield: [templeGarden] },
      templeGarden,
      'player1',
      undefined,
      'card123-mana-g-1',
    );

    expect(production.colors).toEqual(['G']);
    expect(production.requiresColorChoice).not.toBe(true);
  });

  it('resolveManaAbilityActivationShape honors the client-selected color over oracle "or" text', () => {
    const shape = resolveManaAbilityActivationShape(
      { battlefield: [templeGarden] },
      templeGarden,
      'player1',
      'card123-mana-g-1',
      '{T}: Add {G} or {W}.',
      'Add {G} or {W}.',
      '{T}',
    );

    expect(shape.produces).toEqual(['G']);
    expect(shape.baseAmount).toBe(1);
    expect(shape.producesAllAtOnce).toBe(false);
  });
});
