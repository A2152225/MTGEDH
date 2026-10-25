import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';

const perm = (name: string, oracle_text: string, type_line = 'Creature') =>
  ({ id: 'src', controller: 'p1', owner: 'p1', counters: {}, card: { id: 'src', name, type_line, oracle_text } }) as any;

describe('phase 5 static spec parsers', () => {
  it('typed lord without "other" produces a spec', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(perm('X', 'Sliver creatures you control get +3/+3.'));
    expect(specs.some((s: any) => s.scope?.creatureType === 'sliver' && s.grant?.power === 3)).toBe(true);
  });
  it('type list splits into non-double-counting specs', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(perm('X', 'Elves and Goblins you control get +1/+1.')) as any[];
    const lords = specs.filter((s) => String(s.id).includes('subtype-list-lord'));
    expect(lords.length).toBe(2);
    expect(JSON.stringify(lords[1])).toContain('target_lacks_creature_type');
  });
  it('monarch-conditioned lord', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(perm('X', "As long as you're the monarch, Knights you control get +1/+1.")) as any[];
    expect(JSON.stringify(specs)).toContain('source_controller_is_monarch');
  });
  it('global type addition is a layer 4 spec', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(perm('Mycosynth Lattice', 'All permanents are artifacts in addition to their other types.', 'Artifact')) as any[];
    const g = specs.find((s) => String(s.id).includes('global-type-addition'));
    expect(g?.grant?.typeAdditions).toEqual(['Artifact']);
    expect(g?.scope?.kind).toBe('all_permanents');
  });
});
