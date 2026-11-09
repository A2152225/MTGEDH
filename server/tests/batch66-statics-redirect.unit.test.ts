import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { applyBatch66DamageRedirect } from '../src/state/modules/replacementBatch66DamageRedirect.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { permanentHasMustAttackRequirement } from '../../rules-engine/src/attackRestrictionText.js';
import { getContinuousGrantedAbilitiesForPermanent, syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { setResolvingSpellSource } from '../src/state/modules/replacementResolvingSpellSource.js';
import { getQualifierBlockRestrictionReason } from '../src/socket/combat-handlers/combatQualifierBlockRestriction.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2' },
}) as any;

describe('batch66 statics and redirect', () => {
  it('Delney power-at-most block evasion grant', () => {
    const line = "Creatures you control with power 2 or less can't be blocked by creatures with power 3 or greater.";
    const delney = P('Delney, Streetwise Lookout', line);
    const specs = parseStaticEffectSpecsFromOraclePermanent(delney);
    expect(specs.some((s) => (s.condition as any)?.kind === 'target_power_at_most'
      && (s.condition as any)?.power === 2
      && Array.isArray(s.grant.abilities)
      && s.grant.abilities!.some((a) => /power 3 or greater/.test(a)))).toBe(true);

    const small = { id: 'small', controller: 'p1', card: { name: 'Scout', type_line: 'Creature — Human', power: '1', toughness: '1', oracle_text: '' } };
    const bigBlocker = { id: 'big', controller: 'p2', card: { name: 'Ogre', type_line: 'Creature — Ogre', power: '4', toughness: '4', oracle_text: '' }, power: 4 };
    const state: any = { battlefield: [delney, small], turnPlayer: 'p1', players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(state);
    const grants = getContinuousGrantedAbilitiesForPermanent(small as any, state);
    expect(grants.some((g) => /can't be blocked by creatures with power 3 or greater/.test(g))).toBe(true);
    const reason = getQualifierBlockRestrictionReason(
      small as any,
      bigBlocker as any,
      grants,
      { blockerPower: 4, blockerToughness: 4 },
    );
    expect(reason).toBeTruthy();
    expect(classifyStaticCensusLine(line, 'Delney, Streetwise Lookout')?.system).toMatch(/block evasion|batch66/i);
  });

  it('Goblin Rabblemaster other Goblins must attack', () => {
    const line = 'Other Goblin creatures you control attack each combat if able.';
    const rabble = P('Goblin Rabblemaster', line, 'Creature — Goblin Warrior');
    const goblin = {
      id: 'gob', controller: 'p1',
      card: { name: 'Raging Goblin', type_line: 'Creature — Goblin', oracle_text: 'Haste', power: '1', toughness: '1' },
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(rabble);
    expect(specs.some((s) => s.scope.kind === 'other_creatures_you_control'
      && (s.condition as any)?.creatureType === 'goblin')).toBe(true);

    const bf = [rabble, goblin];
    expect(permanentHasMustAttackRequirement(goblin, bf)).toBe(true);
    expect(permanentHasMustAttackRequirement(rabble, bf)).toBe(false);
    expect(classifyStaticCensusLine(line, 'Goblin Rabblemaster')?.system).toMatch(/attack each combat|batch66/i);
  });

  it('Harsh Judgment chosen-color IS damage redirect', () => {
    const line = 'If an instant or sorcery spell of the chosen color would deal damage to you, it deals that damage to its controller instead.';
    const harsh = {
      ...P('Harsh Judgment', line, 'Enchantment'),
      chosenColor: 'red',
    };
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [harsh] });
    expect(specs.some((s) => String(s.effectId || '').includes('chosen-color-is-damage-redirect'))).toBe(true);

    const state: any = {
      battlefield: [harsh],
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      life: { p1: 40, p2: 40 },
      stack: [{ id: 'spell-1', controller: 'p2', card: { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', colors: ['R'] } }],
    };
    setResolvingSpellSource(state, {
      id: 'spell-1',
      cardId: 'bolt',
      card: { name: 'Lightning Bolt', type_line: 'Instant', colors: ['R'] },
      targets: ['p1'],
    });
    const result = applyBatch66DamageRedirect(state, 3, 'p2', 'p1', 'spell-1');
    expect(result?.amount).toBe(0);
    expect(state.life.p2).toBe(37);
    expect(state.life.p1).toBe(40);
    expect(classifyStaticCensusLine(line, 'Harsh Judgment')?.system).toMatch(/redirect|Batch66/i);
  });

  it('Quina frog token replacement', () => {
    const line = 'If one or more tokens would be created under your control, those tokens plus a 1/1 green Frog creature token are created instead.';
    const specs = collectReplacementEffectSpecsFromState({
      battlefield: [P('Quina, Qu Gourmet', line)],
    });
    expect(specs.some((s) => s.effectId === 'controller-extra-frog')).toBe(true);
    expect(classifyStaticCensusLine(line, 'Quina, Qu Gourmet')?.system).toMatch(/frog|TokenOracle/i);
  });
});
