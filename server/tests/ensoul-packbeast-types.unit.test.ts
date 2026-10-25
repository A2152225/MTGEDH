import { expect, it } from 'vitest';
import { parseIntrinsicAlsoCreatureTypes } from '../src/state/modules/intrinsicAlsoCreatureTypes';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec';
import { isCreature } from '../src/rules-engine/staticEffects-handlers/staticEffectsScanHelpers';
import { isCurrentlyCreature } from '../src/socket/combat-handlers/combatLegalityGates';
import { isCreatureNow } from '../src/state/creatureTypeNow';
import { isCurrentlyCreature as reIs } from '../../rules-engine/src/actions/combat-handlers/combatLegalityHelpers';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness';
it('Ensoul Artifact host is a creature for every helper; Packbeast is also a Wizard for lords', () => {
  const rock: any = { id: 'r', controller: 'p1', owner: 'p1', counters: {}, card: { id: 'r', name: 'Mind Stone', type_line: 'Artifact', oracle_text: '{T}: Add {C}.' } };
  const ea: any = { id: 'e', controller: 'p1', owner: 'p1', counters: {}, attachedTo: 'r', card: { id: 'e', name: 'Ensoul Artifact', type_line: 'Enchantment \u2014 Aura', oracle_text: 'Enchant artifact\nEnchanted artifact is a creature with base power and toughness 5/5 in addition to its other types.' } };
  const pack: any = { id: 'k', controller: 'p1', owner: 'p1', counters: {}, card: { id: 'k', name: 'Stonework Packbeast', type_line: 'Artifact Creature \u2014 Golem', oracle_text: 'Stonework Packbeast is also a Cleric, Rogue, Warrior, and Wizard.\n{2}: Add one mana of any color.', power: '2', toughness: '2' } };
  const lord: any = { id: 'l', controller: 'p1', owner: 'p1', counters: {}, card: { id: 'l', name: 'Lord', type_line: 'Creature \u2014 Human', oracle_text: 'Other Wizard creatures you control get +1/+1.', power: '1', toughness: '1' } };
  const s: any = { battlefield: [rock, ea, pack, lord], stack: [], players: [{ id: 'p1' }], life: { p1: 40 }, zones: {} };
  syncDerivedContinuousEffects(s);
  expect(isCreature(rock)).toBe(true);
  expect(isCurrentlyCreature(rock, s.battlefield, 'p1')).toBe(true);
  expect(isCreatureNow(rock)).toBe(true);
  expect(reIs(rock)).toBe(true);
  expect(pack.continuousTypeAdditions).toEqual(['Cleric', 'Rogue', 'Warrior', 'Wizard']);
  expect(getCurrentPowerToughness(pack, s)).toEqual({ power: 3, toughness: 3 });
});

it('is-also parser ignores non-creature-type and other-name lines', () => {
  expect(parseIntrinsicAlsoCreatureTypes('Foo is also a Cleric and Rogue.', 'Foo')).toEqual(['Cleric', 'Rogue']);
  expect(parseIntrinsicAlsoCreatureTypes('Bar is also a Wizard.', 'Foo')).toEqual([]);
  expect(parseIntrinsicAlsoCreatureTypes('Foo is also a land.', 'Foo')).toEqual([]);
});
