import { describe, expect, it } from 'vitest';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

describe('Sakura-Tribe Elder ETB regression', () => {
  it('does not fire a land-tutor ETB for the sacrifice activated ability', () => {
    const triggers = detectETBTriggers(
      {
        name: 'Sakura-Tribe Elder',
        type_line: 'Creature — Snake Shaman',
        oracle_text:
          'Sacrifice Sakura-Tribe Elder: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
      },
      { id: 'perm_ste' },
    );

    expect(triggers.filter((trigger) => trigger.triggerType === 'etb')).toHaveLength(0);
  });
});
