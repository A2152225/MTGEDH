import { describe, it, expect } from 'vitest';
import { parseActivatedAbilities } from '../src/utils/activatedAbilityParser';

// Issue #47: Caretaker's Talent level-up was highlighted/usable at instant speed.
describe('Class level-up timing (issue #47)', () => {
  it('parses "{W}: Level 2" as a sorcery-speed ability', () => {
    const card: any = {
      id: 'caretaker',
      name: "Caretaker's Talent",
      type_line: 'Enchantment - Class',
      oracle_text: "(Gain the next level as a sorcery to add its ability.)\nWhenever one or more tokens you control enter, draw a card. This ability triggers only once each turn.\n{W}: Level 2\nWhen this Class becomes level 2, create a token that's a copy of target token you control.\n{3}{W}: Level 3\nCreature tokens you control get +2/+2.",
    };
    const abilities = parseActivatedAbilities(card);
    const levels = abilities.filter((a: any) => /level\s+\d/i.test(String(a.effect || a.description || a.label || '')));
    expect(levels.length).toBeGreaterThan(0);
    for (const ability of levels) expect(ability.timingRestriction).toBe('sorcery');
  });
});
