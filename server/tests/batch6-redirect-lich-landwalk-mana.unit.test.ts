import { describe, expect, it } from 'vitest';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { readOracleManaRetentionEffects } from '../src/state/modules/turn-handlers/turnManaRetentionOracle.js';
import { assignsCombatDamageAsThoughUnblocked } from '../src/state/modules/turn-handlers/combatAssignAsThoughUnblocked.js';
import { landwalkIgnoredByBattlefield } from '../../shared/src/combatLandwalkOverrides.js';

const p = (id: string, c: string, name: string, o: string, t = 'Creature') => ({ id, controller: c, owner: c, card: { name, oracle_text: o, type_line: t } });
const specs = (bf: any[], extra: any = {}) => collectReplacementEffectSpecsFromState({ battlefield: bf, ...extra });

describe('batch 6 leftovers', () => {
  it('Pariah redirect spec', () => {
    const s = specs([p('pa', 'p1', 'Pariah', 'Enchant creature\nAll damage that would be dealt to you is dealt to enchanted creature instead.', 'Enchantment - Aura')]);
    expect(s.find((x) => x.event === 'damage-redirect')?.metadata).toMatchObject({ redirectTo: 'attached' });
  });
  it('Phantom counter-removal prevention', () => {
    const s = specs([p('ph', 'p1', 'Phantom Centaur', 'If damage would be dealt to Phantom Centaur, prevent that damage. Remove a +1/+1 counter from Phantom Centaur.')]);
    expect(s.find((x) => x.event === 'damage-prevention-cost')?.metadata).toMatchObject({ counter: '+1/+1', removeMode: 'one' });
  });
  it('Lich gain life -> draw', () => {
    const s = specs([p('l', 'p1', 'Lich', 'If you would gain life, draw that many cards instead.', 'Enchantment')]);
    expect(s.some((x) => x.event === 'life-gain-draw')).toBe(true);
  });
  it('Kumano damaged-by-source exile scoped to damaged objects', () => {
    const s = specs([p('k', 'p1', 'Kumano Faces Kakkazan', 'If a creature dealt damage by Kumano Faces Kakkazan this turn would die, exile it instead.')], { creaturesDamagedByThisCreatureThisTurn: { k: { v: true } } });
    expect(s.find((x) => x.effectId === 'damaged-by-source-die-exile-instead')?.metadata).toMatchObject({ damagedObjectIds: ['v'] });
  });
  it('unspent mana becomes colorless', () => {
    const r = readOracleManaRetentionEffects([p('k', 'p1', 'Kruphix', 'If you would lose unspent mana, that mana becomes colorless instead.')], 'p1');
    expect(r[0]).toMatchObject({ type: 'becomes_colorless' });
  });
  it('assign as though unblocked + landwalk override', () => {
    expect(assignsCombatDamageAsThoughUnblocked(p('t', 'p1', 'Thorn Elemental', "You may have Thorn Elemental assign its combat damage as though it weren't blocked."), [])).toBe(true);
    expect(assignsCombatDamageAsThoughUnblocked(p('b', 'p1', 'Bear', ''), [])).toBe(false);
    const staff = p('s', 'p2', 'Staff of the Ages', "Creatures with landwalk abilities can be blocked as though they didn't have those abilities.", 'Artifact');
    expect(landwalkIgnoredByBattlefield([staff] as any, 'swampwalk')).toBe(true);
    expect(landwalkIgnoredByBattlefield([] as any, 'swampwalk')).toBe(false);
  });
});
