import { describe, expect, it } from 'vitest';
import { handFacePlayModes } from './handFacePlayModes';

describe('handFacePlayModes', () => {
  it('casts a transforming creature whose back face is a land', () => {
    expect(handFacePlayModes({
      name: 'Ojer Taq, Deepest Foundation // Temple of Civilization',
      layout: 'transform',
      type_line: 'Legendary Creature — God // Land',
      card_faces: [
        { type_line: 'Legendary Creature — God' },
        { type_line: 'Land' },
      ],
    } as any)).toEqual({ canPlayAsLand: false, canCastAsSpell: true });
  });

  it('offers both actions for a spell // land modal DFC', () => {
    expect(handFacePlayModes({
      layout: 'modal_dfc',
      type_line: 'Instant // Land',
      card_faces: [{ type_line: 'Instant' }, { type_line: 'Land' }],
    })).toEqual({ canPlayAsLand: true, canCastAsSpell: true });
  });

  it('keeps single-faced lands and spells as before', () => {
    expect(handFacePlayModes({ type_line: 'Basic Land — Plains' })).toEqual({ canPlayAsLand: true, canCastAsSpell: false });
    expect(handFacePlayModes({ type_line: 'Legendary Land' })).toEqual({ canPlayAsLand: true, canCastAsSpell: false });
    expect(handFacePlayModes({ type_line: 'Enchantment' })).toEqual({ canPlayAsLand: false, canCastAsSpell: true });
  });
});
