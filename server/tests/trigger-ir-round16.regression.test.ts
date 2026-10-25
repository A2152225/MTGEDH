import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (text: string, name?: string) => (parseTriggerClause(text, name) as any)?.condition;

describe('round 16: mapped wordings', () => {
  it('a source deals damage to this creature', () => {
    expect(cond('Whenever a source deals damage to Phyrexian Obliterator, draw a card.', 'Phyrexian Obliterator')).toMatchObject({ event: 'dealt_damage' });
    expect(cond('Whenever a source deals damage to this creature, draw a card.')).toMatchObject({ event: 'dealt_damage' });
  });
  it('blocks or becomes blocked, plural self name', () => {
    expect(cond('Whenever enchanted creature blocks or becomes blocked, draw a card.')).toMatchObject({ event: 'blocks', pairedEvent: 'becomes_blocked' });
    expect(cond('Whenever Krang & Shredder enter or attack, draw a card.', 'Krang & Shredder')).toMatchObject({ event: 'enters', pairedEvent: 'attacks' });
  });
});

describe('round 16: legacy-runtime tail', () => {
  const legacy = [
    'Whenever you roll a 1, draw a card.',
    'Whenever you cast a spell with {X} in its mana cost, draw a card.',
    'Whenever you cast an Adventure spell, draw a card.',
    "Whenever you cast a spell you don't own, draw a card.",
    'Whenever one or more nonland cards are milled, draw a card.',
    'Whenever you put one or more +1/+1 counters on a creature you control, draw a card.',
    'Whenever one or more other creatures die, draw a card.',
  ];
  for (const text of legacy) {
    it(text, () => expect(cond(text)).toMatchObject({ legacyRuntimeOnly: true }));
  }
  it('dealt damage by ~ this turn dies', () => {
    expect(cond('Whenever a creature dealt damage by Madame Vastra this turn dies, draw a card.', 'Madame Vastra')).toMatchObject({ legacyRuntimeOnly: true });
  });
});
