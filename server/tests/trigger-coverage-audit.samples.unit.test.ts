import { describe, expect, it } from 'vitest';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';

const permanent = { id: 'P1', controller: 'P1' };

const SAMPLES: Array<{ name: string; oracle_text: string; expectParsedCastTriggers: number; expectDetection: boolean }> = [
  {
    name: 'Sloppity Bilepiper',
    oracle_text: 'Jolly Gutpipes — {2}, {T}, Sacrifice a creature: The next creature spell you cast this turn has cascade. (When you next cast a creature spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)',
    expectParsedCastTriggers: 0,
    expectDetection: false,
  },
  {
    name: 'Path of Ancestry',
    oracle_text: 'This land enters tapped.\n{T}: Add one mana of any color in your commander\'s color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1. (Look at the top card of your library. You may put that card on the bottom.)',
    expectParsedCastTriggers: 0,
    expectDetection: false,
  },
  {
    name: 'Jin-Gitaxias, Progress Tyrant',
    oracle_text: 'Whenever you cast an artifact, instant, or sorcery spell, copy that spell. You may choose new targets for the copy. This ability triggers only once each turn. (A copy of a permanent spell becomes a token.)\nWhenever an opponent casts an artifact, instant, or sorcery spell, counter that spell. This ability triggers only once each turn.',
    expectParsedCastTriggers: 1,
    expectDetection: true,
  },
  {
    name: 'Codie, Vociferous Codex',
    oracle_text: 'You can\'t cast permanent spells.\n{4}, {T}: Add {W}{U}{B}{R}{G}. When you next cast a spell this turn, exile cards from the top of your library until you exile an instant or sorcery card with lesser mana value. Until end of turn, you may cast that card without paying its mana cost. Put each other card exiled this way on the bottom of your library in a random order.',
    expectParsedCastTriggers: 0,
    expectDetection: false,
  },
  {
    name: 'Long List of the Ents',
    oracle_text: 'Whenever you cast a spell of that type this turn, draw a card.',
    expectParsedCastTriggers: 1,
    expectDetection: true,
  },
];

describe('cast gap sample cards', () => {
  for (const card of SAMPLES) {
    it(`handles ${card.name}`, () => {
      const parsed = parseTriggeredAbilitiesFromText(card.oracle_text, 'SRC', 'P1', card.name);
      const castParsed = parsed.filter((t) => String(t.event).includes('spell_cast') || /\bcast\b/i.test(String(t.condition || t.triggerFilter || '')));
      const selfCast = detectSpellCastTriggers({ name: card.name, oracle_text: card.oracle_text }, permanent);
      const oppCast = detectOpponentSpellCastTriggers({ name: card.name, oracle_text: card.oracle_text }, permanent);

      expect(castParsed).toHaveLength(card.expectParsedCastTriggers);
      if (card.expectDetection) {
        expect(selfCast.length + oppCast.length).toBeGreaterThan(0);
      }
    });
  }
});
