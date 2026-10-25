import { describe, expect, it } from 'vitest';
import { detectCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { detectLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';

function perm(id: string, controller: string, card: Record<string, unknown>) {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_card', name: id, ...card } };
}

const humility = () => perm('Humility', 'p2', {
  type_line: 'Enchantment', oracle_text: 'All creatures lose all abilities and have base power and toughness 1/1.',
});

describe('detect* functions read the live game state for ability suppression', () => {
  const drawer = perm('Card Watcher', 'p1', { type_line: 'Creature \u2014 Human', power: '1', toughness: '1', oracle_text: 'Whenever you draw a card, you gain 1 life.' });
  const lifeWatcher = perm('Life Watcher', 'p1', { type_line: 'Creature \u2014 Human', power: '1', toughness: '1', oracle_text: 'Whenever an opponent loses life, you gain 1 life.' });

  it('fire without Humility on the battlefield', () => {
    expect(detectCardDrawTriggers(drawer.card, drawer, { battlefield: [drawer] }).length).toBeGreaterThan(0);
    expect(detectLifeLossTriggers(lifeWatcher.card, lifeWatcher, { battlefield: [lifeWatcher] }).length).toBeGreaterThan(0);
  });

  it('return nothing when the passed state has Humility', () => {
    expect(detectCardDrawTriggers(drawer.card, drawer, { battlefield: [drawer, humility()] })).toEqual([]);
    expect(detectLifeLossTriggers(lifeWatcher.card, lifeWatcher, { battlefield: [lifeWatcher, humility()] })).toEqual([]);
  });
});
