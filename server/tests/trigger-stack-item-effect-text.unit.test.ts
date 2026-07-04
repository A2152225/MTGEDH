import { describe, expect, it } from 'vitest';

import { resolveTriggerStackItemEffectText } from '../src/state/modules/triggerStackItemEffectText.js';

describe('resolveTriggerStackItemEffectText', () => {
  it('prefers explicit effect over description', () => {
    expect(resolveTriggerStackItemEffectText({
      effect: 'put a charge counter on Door of Destinies',
      description: 'Whenever you cast a Merfolk spell, put a charge counter on Door of Destinies. Creatures you control...',
      triggerType: 'cast_creature_type',
    })).toBe('put a charge counter on Door of Destinies');
  });

  it('parses tribal cast_creature_type description when effect is missing (G1 regression)', () => {
    expect(resolveTriggerStackItemEffectText({
      description: 'Whenever you cast a Merfolk spell, put a charge counter on Door of Destinies',
      triggerType: 'cast_creature_type',
    })).toBe('put a charge counter on Door of Destinies');
  });

  it('strips merged static lord text when effect is missing (G1 regression)', () => {
    const parsed = resolveTriggerStackItemEffectText({
      description:
        'Whenever you cast a spell of the chosen type, put a charge counter on this artifact. Creatures you control of the chosen type get +1/+1 for each charge counter on this artifact.',
      triggerType: 'cast_creature_type',
    });
    expect(parsed).toBe('put a charge counter on this artifact');
    expect(parsed).not.toMatch(/get \+1\/\+1/i);
  });

  it('falls back to description for non cast_creature_type triggers', () => {
    expect(resolveTriggerStackItemEffectText({
      description: 'draw a card',
      triggerType: 'draw',
    })).toBe('draw a card');
  });

  it('hydrates truncated trigger fragments from card oracle text', () => {
    const kynaiosOracle =
      "At the beginning of your end step, draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.";

    expect(resolveTriggerStackItemEffectText({
      sourceName: 'Kynaios and Tiro of Meletis',
      description: 'draw a card.',
      triggerType: 'end_step',
      permanentId: 'kynaios_perm_1',
    }, {
      state: {
        battlefield: [{
          id: 'kynaios_perm_1',
          card: { name: 'Kynaios and Tiro of Meletis', oracle_text: kynaiosOracle },
        }],
      },
    })).toBe(
      "draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.",
    );
  });
});
