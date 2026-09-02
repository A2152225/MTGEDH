import { describe, expect, it } from 'vitest';
import { sourceLeaveBattlefieldReplacementDestination } from '../src/state/modules/can-respond-handlers/canRespondGraveyardSpellPermission.js';
import { inferLeaveBattlefieldExileReplacement } from '../src/state/modules/leaveBattlefieldReplacementStamp.js';

const RIVAZ_ORACLE =
  'Menace\n{T}: Add two mana in any combination of colors. Spend this mana only to cast Dragon creature spells.\nOnce during each of your turns, you may cast a Dragon creature spell from your graveyard.\nWhenever you cast a Dragon creature spell from your graveyard, it gains "When this creature dies, exile it."';

describe('leave-battlefield exile stamp from graveyard-cast grants', () => {
  it('detects Rivaz quoted dies-exile rider on the full oracle', () => {
    expect(sourceLeaveBattlefieldReplacementDestination(RIVAZ_ORACLE)).toBe('exile');
  });

  it('infers exile when a GY-cast Dragon dies while Rivaz is on the battlefield', () => {
    const dragon = {
      id: 'dragon_1',
      controller: 'p1',
      castFromGraveyard: true,
      card: {
        id: 'dragon_spell_1',
        name: 'Scorchscale Dragon',
        type_line: 'Creature — Dragon',
        oracle_text: 'Flying',
        castFromGraveyard: true,
      },
    };
    const state = {
      battlefield: [
        {
          id: 'rivaz_1',
          controller: 'p1',
          card: {
            id: 'rivaz_card',
            name: 'Rivaz of the Claw',
            type_line: 'Legendary Creature — Lizard Warlock',
            oracle_text: RIVAZ_ORACLE,
          },
        },
      ],
    };

    expect(inferLeaveBattlefieldExileReplacement(dragon, state)?.leaveBattlefieldReplacementDestination).toBe('exile');
  });
});
