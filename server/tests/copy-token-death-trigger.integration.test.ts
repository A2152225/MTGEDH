import { describe, expect, it } from 'vitest';
import { getDeathTriggers } from '../src/state/modules/triggered-abilities.js';

describe('copy token death triggers (this creature oracle)', () => {
  it('matches hydrated copy tokens with "this creature or another creature you control dies"', () => {
    const dying = {
      id: 'token-copy-zulaport',
      controller: 'p1',
      owner: 'p1',
      isToken: true,
      isCopyToken: true,
      card: {
        name: 'Zulaport Cutthroat',
        type_line: 'Creature — Human Rogue Ally',
        oracle_text:
          'Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
      },
    };
    const ctx = {
      state: {
        battlefield: [],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
      bumpSeq: () => {},
    };

    const triggers = getDeathTriggers(ctx as any, dying, 'p1');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect.toLowerCase()).toContain('each opponent loses 1 life and you gain 1 life');
    expect(triggers[0].source.controllerId).toBe('p1');
  });
});
