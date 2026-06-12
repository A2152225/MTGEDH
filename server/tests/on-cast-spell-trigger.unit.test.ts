import { describe, expect, it } from 'vitest';

import { detectCastTrigger } from '../../rules-engine/src/cards/castTriggers.js';
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

    const resolved = resolveOnCastSpellTriggerDescription(card);
    expect(resolved).toEqual({
      description: 'When you cast this spell, draw four cards',
      effect: 'When you cast this spell, draw four cards',
    });
  });

  it('parses Emrakul extra-turn shorthand from oracle text without name table', () => {
    const card = {
      name: 'Emrakul, the Aeons Torn',
      type_line: 'Legendary Creature — Eldrazi',
      oracle_text: "This spell can't be countered. Take an extra turn after this one.",
    };

    const resolved = resolveOnCastSpellTriggerDescription(card);
    expect(resolved?.description).toContain('extra turn');
    expect(resolved?.effect).toContain('extra turn');
  });

  it('parses standard Ulamog destroy-permanent on-cast from oracle text', () => {
    const card = {
      name: 'Ulamog, the Infinite Gyre',
      type_line: 'Legendary Creature — Eldrazi',
      oracle_text: 'When you cast this spell, destroy target permanent.',
    };

    const resolved = resolveOnCastSpellTriggerDescription(card);
    expect(resolved?.description).toMatch(/destroy target permanent/i);
  });
});

describe('detectCastTrigger Eldrazi patterns', () => {
  it('detects Emrakul extra turn without explicit when-you-cast clause', () => {
    const info = detectCastTrigger("This spell can't be countered. Take an extra turn after this one.");
    expect(info.hasCastTrigger).toBe(true);
    expect(info.triggerType).toBe('self_cast');
    expect(String(info.effect || '')).toMatch(/extra turn/i);
  });
});
