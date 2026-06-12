import { describe, expect, it } from 'vitest';

import { resolveOnCastSpellTriggerDescription } from '../src/state/modules/onCastSpellTriggerUtils.js';

describe('resolveOnCastSpellTriggerDescription', () => {
  it('parses Kozilek draw-four from oracle text without Eldrazi name table', () => {
    const card = {
      name: 'Generic Eldrazi Titan',
      type_line: 'Legendary Creature — Eldrazi',
      oracle_text:
        'When you cast this spell, draw four cards.\n'
        + 'Annihilator 4 (Whenever this creature attacks, defending player sacrifices four permanents.)\n'
        + 'When Kozilek, Butcher of Truth is put into a graveyard from anywhere, its controller shuffles it into their library.',
    };

    const resolved = resolveOnCastSpellTriggerDescription(card, null);
    expect(resolved).toEqual({
      description: 'When you cast this spell, draw four cards',
      effect: 'When you cast this spell, draw four cards',
    });
  });

  it('falls back to Eldrazi table for Emrakul extra-turn wording', () => {
    const card = {
      name: 'Emrakul, the Aeons Torn',
      type_line: 'Legendary Creature — Eldrazi',
      oracle_text: "This spell can't be countered. Take an extra turn after this one.",
    };

    const resolved = resolveOnCastSpellTriggerDescription(card, {
      permanentId: '',
      cardName: 'Emrakul, the Aeons Torn',
      castTrigger: "This spell can't be countered. Take an extra turn after this one",
    });
    expect(resolved?.description).toContain('extra turn');
  });
});
