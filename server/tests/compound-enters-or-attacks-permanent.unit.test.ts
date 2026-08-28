import { describe, expect, it } from 'vitest';
import { detectAttackTriggers, detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

const permanent = { id: 'P1', controller: 'P1' };

// Oracle from mtg_data.db cards.text where is_token=0
const OVERLORD_OF_THE_HAUNTWOODS_ORACLE =
  "Impending 4—{1}{G}{G} (If you cast this spell for its impending cost, it enters with four time counters and isn't a creature until the last is removed. At the beginning of your end step, remove a time counter from it.)\nWhenever this permanent enters or attacks, create a tapped colorless land token named Everywhere that is every basic land type.";

describe('compound enters-or-attacks this permanent (Duskmourn Overlords)', () => {
  it('detectAttackTriggers returns self_enters_or_attacks for Overlord of the Hauntwoods', () => {
    const triggers = detectAttackTriggers({
      name: 'Overlord of the Hauntwoods',
      oracle_text: OVERLORD_OF_THE_HAUNTWOODS_ORACLE,
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'self_enters_or_attacks')).toBe(true);
  });

  it('detectETBTriggers still returns self_enters_or_attacks for Overlord of the Hauntwoods', () => {
    const triggers = detectETBTriggers({
      name: 'Overlord of the Hauntwoods',
      oracle_text: OVERLORD_OF_THE_HAUNTWOODS_ORACLE,
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'self_enters_or_attacks')).toBe(true);
  });
});
