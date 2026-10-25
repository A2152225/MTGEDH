import { describe, expect, it } from 'vitest';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectDeathTriggers } from '../src/state/modules/triggers/death-detection.js';

const NURTURER = { name: 'Scaled Nurturer', type_line: 'Creature - Human Monk', oracle_text: '{T}: Add {G}. When you spend this mana to cast a Dragon creature spell, you gain 2 life.' };
const LAPIS = { name: 'Lapis Orb of Dragonkind', type_line: 'Artifact', oracle_text: '{T}: Add {U}. When you spend this mana to cast a Dragon creature spell, scry 2.' };

describe('round 28: spend-this-mana Dragon triggers', () => {
  it('detects Scaled Nurturer as a Dragon tribal trigger gated on its own mana', () => {
    const triggers = detectSpellCastTriggers(NURTURER, { id: 'sn1', controller: 'p1', card: NURTURER });
    const t = triggers.filter((x) => x.requiresManaFromPermanentId === 'sn1');
    expect(t).toHaveLength(1);
    expect(t[0].spellCondition).toBe('tribal_type');
    expect(t[0].tribalType).toBe('dragon');
    expect(t[0].effect).toBe('you gain 2 life');
    expect(t[0].mandatory).toBe(true);
  });
  it('detects Lapis Orb scry rider', () => {
    const t = detectSpellCastTriggers(LAPIS, { id: 'lo1', controller: 'p1', card: LAPIS }).filter((x) => x.requiresManaFromPermanentId === 'lo1');
    expect(t).toHaveLength(1);
    expect(t[0].effect).toBe('scry 2');
  });
});

describe('round 28: Wicked Role put-into-graveyard trigger', () => {
  it.each([
    'When this token is put into a graveyard, each opponent loses 1 life.',
    'Enchant creature you control\nEnchanted creature gets +1/+1.\nWhen this Aura is put into a graveyard, each opponent loses 1 life.',
  ])('detects %s', (text) => {
    const card = { name: 'Wicked Role', type_line: 'Token Enchantment - Aura Role', oracle_text: text };
    const t = detectDeathTriggers(card, { id: 'wr1', controller: 'p1', isToken: true, card });
    expect(t).toHaveLength(1);
    expect(t[0].effect).toMatch(/^each opponent loses 1 life/);
  });
  it('does not treat "from anywhere" as a battlefield trigger', () => {
    const card = { name: 'X', type_line: 'Creature', oracle_text: 'When this creature is put into a graveyard from anywhere, draw a card.' };
    expect(detectDeathTriggers(card, { id: 'x1', controller: 'p1', card }).filter((t) => t.triggerType === 'dies')).toHaveLength(0);
  });
});
