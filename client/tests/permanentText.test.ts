import { describe, expect, it } from 'vitest';
import { getCombinedPermanentText } from '../src/utils/permanentText';

describe('getCombinedPermanentText', () => {
  it('merges oracle text, granted abilities, and temporary effect descriptions', () => {
    const permanent = {
      id: 'perm-1',
      controller: 'player1',
      owner: 'player1',
      card: {
        id: 'card-1',
        name: 'Skyknight Trainee',
        type_line: 'Creature — Human Knight',
        oracle_text: 'Vigilance',
      },
      grantedAbilities: ['Flying'],
      temporaryEffects: [
        { description: 'Skyknight Trainee has haste this turn.' },
      ],
    } as any;

    const text = getCombinedPermanentText(permanent);

    expect(text).toContain('vigilance');
    expect(text).toContain('flying');
    expect(text).toContain('has haste this turn');
  });
});