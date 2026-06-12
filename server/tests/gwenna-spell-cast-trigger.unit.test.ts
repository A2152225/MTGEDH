import { describe, expect, it } from 'vitest';

import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';

describe('Gwenna spell-cast trigger detection', () => {
  const permanent = { id: 'perm_gwenna', controller: 'p1' };

  it('requires creature spells with power 5 or greater', () => {
    const triggers = detectSpellCastTriggers(
      {
        name: 'Gwenna, Eyes of Gaea',
        oracle_text:
          '{T}: Add two mana in any combination of colors. Spend this mana only to cast creature spells or activate abilities of creature sources.\nWhenever you cast a creature spell with power 5 or greater, put a +1/+1 counter on Gwenna and untap it.',
      },
      permanent,
    );

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.spellCondition).toBe('creature');
    expect(triggers[0]?.minSpellPower).toBe(5);
    expect(triggers[0]?.effect).toMatch(/put a \+1\/\+1 counter on Gwenna and untap it/i);
  });
});
