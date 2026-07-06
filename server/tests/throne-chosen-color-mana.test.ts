import { describe, expect, it } from 'vitest';
import { getManaAbilitiesForPermanent, resolvePermanentChosenColorSymbol } from '../src/state/modules/mana-abilities.js';
import { calculateManaProduction } from '../src/socket/util.js';

const THRONE_ORACLE = [
  'As Throne of Eldraine enters the battlefield, choose a color.',
  '{T}: Add four mana of the chosen color.',
  '{3}, {T}: Draw two cards. Spend only mana of the chosen color to activate this ability.',
].join('\n');

describe('Throne of Eldraine chosen-color mana', () => {
  const throneCard = {
    id: 'throne-card',
    name: 'Throne of Eldraine',
    type_line: 'Legendary Artifact',
    oracle_text: THRONE_ORACLE,
  };

  const permanent = {
    id: 'perm_throne',
    card: throneCard,
    controller: 'p1',
    chosenColor: 'white',
  };

  const gameState = { battlefield: [permanent], players: [] };

  it('reads ETB chosen color as a mana symbol', () => {
    expect(resolvePermanentChosenColorSymbol(permanent)).toBe('W');
  });

  it('registers native_chosen_color for four white mana when color is set', () => {
    const abilities = getManaAbilitiesForPermanent(gameState, permanent, 'p1');
    const chosen = abilities.find((ability) => ability.id === 'native_chosen_color');
    expect(chosen).toBeDefined();
    expect(chosen?.produces).toEqual(['W']);
    expect(chosen?.amount).toBe(4);
  });

  it('calculateManaProduction uses permanent chosen color without re-prompting', () => {
    const production = calculateManaProduction(
      gameState,
      permanent,
      'p1',
      undefined,
      `${throneCard.id}-ability-0`,
    );
    expect(production.colors).toEqual(['W']);
    expect(production.baseAmount).toBe(4);
    expect(production.requiresColorChoice).not.toBe(true);
  });
});
