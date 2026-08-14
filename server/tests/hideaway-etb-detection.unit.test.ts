import { describe, expect, it } from 'vitest';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

const mosswortOracle =
  'Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\n' +
  'This land enters tapped.\n' +
  '{T}: Add {G}.\n' +
  '{G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.';

describe('hideaway ETB detection', () => {
  it('queues a single hideaway_etb for Mosswort Bridge and does not also parse the reminder as a generic ETB', () => {
    const triggers = detectETBTriggers(
      {
        name: 'Mosswort Bridge',
        type_line: 'Land',
        oracle_text: mosswortOracle,
        keywords: ['Hideaway'],
      },
      { id: 'mosswort_1', controller: 'p1' },
    );

    const hideaway = triggers.filter((trigger) => trigger.triggerType === 'hideaway_etb');
    const genericEtb = triggers.filter((trigger) => trigger.triggerType === 'etb');

    expect(hideaway).toHaveLength(1);
    expect(genericEtb).toHaveLength(0);
    expect((hideaway[0] as any).hideawayCount).toBe(4);
  });

  it('still detects a real land ETB that is not hideaway reminder text', () => {
    const triggers = detectETBTriggers(
      {
        name: 'Radiant Fountain',
        type_line: 'Land',
        oracle_text: 'When this land enters, you gain 2 life.\n{T}: Add {C}.',
      },
      { id: 'fountain_1', controller: 'p1' },
    );

    expect(triggers.some((trigger) => trigger.triggerType === 'etb')).toBe(true);
    expect(triggers.some((trigger) => trigger.triggerType === 'hideaway_etb')).toBe(false);
  });
});
