import { describe, expect, it } from 'vitest';

import { applyPermanentKeywordGrantFromText } from '../src/state/modules/triggerReanimationRiders.js';

const AGENT_ORACLE =
  'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn."';

describe('triggerReanimationRiders keyword grants', () => {
  it('does not self-grant keywords from commander-grant background oracle text', () => {
    const background = {
      id: 'bg_1',
      grantedAbilities: [] as string[],
      card: {
        name: 'Agent of the Shadow Thieves',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: AGENT_ORACLE,
      },
    };

    const applied = applyPermanentKeywordGrantFromText(
      background,
      'Agent of the Shadow Thieves',
      AGENT_ORACLE,
    );

    expect(applied).toBe(false);
    expect(background.grantedAbilities).toEqual([]);
  });

  it('does not self-grant modal choose-one keywords from Kogla and Yidaro oracle', () => {
    const koglaOracle =
      'When Kogla and Yidaro enters, choose one —\n' +
      '\u2022 It gains trample and haste until end of turn.\n' +
      '\u2022 It fights target creature you don\'t control.\n' +
      '{2}{R}{G}, Discard this card: Destroy up to one target artifact or enchantment. Shuffle this card into your library from your graveyard, then draw a card.';
    const kogla = {
      id: 'kogla-1',
      grantedAbilities: [] as string[],
      summoningSickness: true,
      card: {
        name: 'Kogla and Yidaro',
        type_line: 'Legendary Creature — Ape Dinosaur Turtle',
        oracle_text: koglaOracle,
      },
    };

    const applied = applyPermanentKeywordGrantFromText(
      kogla,
      'Kogla and Yidaro',
      koglaOracle,
    );

    expect(applied).toBe(false);
    expect(kogla.grantedAbilities).toEqual([]);
    expect(kogla.summoningSickness).toBe(true);
  });
});
