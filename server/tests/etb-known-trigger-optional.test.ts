import { describe, expect, it } from 'vitest';

import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

describe('known ETB trigger optionality', () => {
  it("marks Soul's Attendant as an optional creature_etb trigger", () => {
    const card = {
      id: 'attendant_card',
      name: "Soul's Attendant",
      type_line: 'Creature — Human Cleric',
      oracle_text: 'Whenever another creature enters the battlefield, you may gain 1 life.',
    };
    const permanent = {
      id: 'attendant_perm',
      controller: 'p1',
      card,
    };

    const triggers = detectETBTriggers(card, permanent);
    const trigger = triggers.find(entry => entry.triggerType === 'creature_etb');

    expect(trigger).toBeDefined();
    expect(trigger?.mandatory).toBe(false);
    expect(trigger?.requiresChoice).toBe(true);
  });

  it('keeps Soul Warden as a mandatory creature_etb trigger', () => {
    const card = {
      id: 'warden_card',
      name: 'Soul Warden',
      type_line: 'Creature — Human Cleric',
      oracle_text: 'Whenever another creature enters the battlefield, you gain 1 life.',
    };
    const permanent = {
      id: 'warden_perm',
      controller: 'p1',
      card,
    };

    const triggers = detectETBTriggers(card, permanent);
    const trigger = triggers.find(entry => entry.triggerType === 'creature_etb');

    expect(trigger).toBeDefined();
    expect(trigger?.mandatory).toBe(true);
    expect(trigger?.requiresChoice).not.toBe(true);
  });
});