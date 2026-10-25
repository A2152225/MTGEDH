import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';
import { recordDeclarativeTypeAdditions, seedContinuousTypeAdditionsForStaticPass } from '../src/state/modules/staticEffectSpecCreatureTypePass';
import { getCreatureTypesNow } from '../src/state/creatureTypeNow';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';

const perm = (id: string, controller: string, name: string, type_line: string, oracle_text = '') =>
  ({ id, controller, owner: controller, counters: {}, card: { id, name, type_line, oracle_text, power: '2', toughness: '2' } }) as any;

describe('global grants', () => {
  it('Concordant Crossroads grants haste to all creatures', () => {
    const cc = perm('cc', 'p1', 'Concordant Crossroads', 'World Enchantment', 'All creatures have haste.');
    const specs = parseStaticEffectSpecsFromOraclePermanent(cc as any);
    expect(specs.some((s: any) => s.scope?.kind === 'all_creatures' && s.grant.abilities?.includes('haste'))).toBe(true);
    const opp = perm('b', 'p2', 'Bear', 'Creature \u2014 Bear');
    expect(getContinuousGrantedAbilitiesForPermanent(opp, { battlefield: [cc, opp] } as any).join('|')).toContain('haste');
  });
  it('"are all colors" and self "is all colors"', () => {
    const tc = perm('tc', 'p1', 'Transguild Courier', 'Artifact Creature \u2014 Golem', 'Transguild Courier is all colors.');
    expect(parseStaticEffectSpecsFromOraclePermanent(tc as any).some((s: any) => s.scope?.kind === 'self' && (s.grant.colorAdditions || []).length === 5)).toBe(true);
    const g = perm('g', 'p1', 'X', 'Enchantment', 'Creatures you control are all colors.');
    expect(parseStaticEffectSpecsFromOraclePermanent(g as any).some((s: any) => s.scope?.kind === 'creatures_you_control' && (s.grant.colorAdditions || []).length === 5)).toBe(true);
    const t = perm('t', 'p1', 'X', 'Instant', 'Target creature is all colors until end of turn.');
    expect(parseStaticEffectSpecsFromOraclePermanent(t as any).filter((s: any) => s.grant.colorAdditions).length).toBe(0);
  });
});

describe('Goddric type loss', () => {
  it('spec flags creature-type replacement and getCreatureTypesNow drops printed types', () => {
    const god = perm('god', 'p1', 'Goddric, Cloaked Reveler', 'Legendary Creature \u2014 Human Noble',
      'Haste\nCelebration \u2014 As long as two or more nonland permanents entered the battlefield under your control this turn, Goddric is a Dragon with base power and toughness 4/4, flying, and "{R}: Dragons you control get +1/+0 until end of turn."');
    const typeSpec: any = parseStaticEffectSpecsFromOraclePermanent(god as any).find((s: any) => s.grant.typeAdditions?.includes('Dragon'));
    expect(typeSpec?.grant.loseOtherCreatureTypes).toBe(true);
    const result = { typeAdditions: new Map<string, string[]>() };
    seedContinuousTypeAdditionsForStaticPass([god], result.typeAdditions);
    recordDeclarativeTypeAdditions(result, god, typeSpec.grant.typeAdditions, true);
    expect([...getCreatureTypesNow(god)]).toEqual(['dragon']);
    seedContinuousTypeAdditionsForStaticPass([god], new Map());
    expect([...getCreatureTypesNow(god)].sort()).toEqual(['human', 'noble']);
  });
});
