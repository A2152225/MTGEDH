import { describe, expect, it } from 'vitest';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { deriveCastUsedManaFromPermanentSource } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/gameState.js';

const BARRACKS_CARD = {
  name: 'Thousand Moons Smithy // Barracks of the Thousand',
  layout: 'transform',
  card_faces: [
    {
      name: 'Thousand Moons Smithy',
      oracle_text: 'At the beginning of your first main phase, you may tap five untapped artifacts and/or creatures you control. If you do, transform Thousand Moons Smithy.',
    },
    {
      name: 'Barracks of the Thousand',
      oracle_text:
        '(Transforms from Thousand Moons Smithy.)\n{T}: Add {W}.\nWhenever you cast an artifact or creature spell using mana produced by Barracks of the Thousand, create a white Gnome Soldier artifact creature token with "This token\'s power and toughness are each equal to the number of artifacts and/or creatures you control."',
    },
  ],
};

describe('Barracks of the Thousand spell-cast trigger', () => {
  it('detects the cast trigger from the transformed back face', () => {
    const permanent = {
      id: 'barracks_1',
      controller: 'p1',
      transformed: true,
      card: BARRACKS_CARD,
    };

    const triggers = detectSpellCastTriggers(BARRACKS_CARD, permanent);
    expect(triggers.some((trigger) => trigger.spellCondition === 'artifact_or_creature')).toBe(true);
    expect(triggers.some((trigger) => trigger.requiresManaFromPermanentId === 'barracks_1')).toBe(true);
  });

  it('detects mana spent from the barracks source via payment evidence', () => {
    const game = createInitialGameState('barracks_mana_source');
    const used = deriveCastUsedManaFromPermanentSource(game.state, 'p1', 'barracks_1', {
      poolBeforePayment: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      consumed: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      manaProducedByPermanentBeforePayment: {
        barracks_1: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      manaPayment: [{ permanentId: 'barracks_1', mana: 'W', count: 1 }],
    });

    expect(used).toBe(true);
  });
});
