import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';
import { evalPhase5StaticCondition } from '../src/state/modules/staticEffectSpecPhase5Eval';

const perm = (name: string, oracle_text: string, extra: any = {}, type_line = 'Creature') =>
  ({ id: 'src', controller: 'p1', owner: 'p1', counters: {}, ...extra, card: { id: 'src', name, type_line, oracle_text } }) as any;

describe('phase 5 round 2 parsers', () => {
  it('chosen-mode bullets become option-conditioned specs', () => {
    const text = 'As this enchantment enters, choose Jeskai or Temur.\n\u2022 Jeskai \u2014 Creature tokens you control have lifelink and haste.\n\u2022 Temur \u2014 Creatures you control get +1/+0 and have trample and haste.';
    const p = perm('Frostcliff Siege', text, { chosenOption: 'Temur' }, 'Enchantment');
    const specs = parseStaticEffectSpecsFromOraclePermanent(p) as any[];
    const cm = specs.filter((s) => String(s.id).includes(':chosen-mode:'));
    expect(cm.length).toBeGreaterThan(0);
    const gate = (s: any) => (s.conditions || []).find((c: any) => c.kind === 'source_chose_option');
    const temur = cm.find((s) => gate(s)?.option?.toLowerCase() === 'temur');
    expect(temur).toBeTruthy();
    expect(evalPhase5StaticCondition(gate(temur), p, temur, [p])).toBe(true);
    const jeskai = cm.find((s) => gate(s)?.option?.toLowerCase() === 'jeskai');
    if (jeskai) expect(evalPhase5StaticCondition(gate(jeskai), p, jeskai, [p])).toBe(false);
  });
  it('for each counter on source uses source_counters count basis', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(perm('X', 'Goblins you control get +1/+0 for each charge counter on this artifact.', {}, 'Artifact')) as any[];
    expect(JSON.stringify(specs)).toContain('source_counters');
  });
  it('five-type list lord produces one spec per type', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(perm('Khod', 'Other Homarids, Camarids, Cephalids, Nautilids, and Merfolk you control get +1/+1.')) as any[];
    expect(specs.filter((s) => String(s.id).includes('subtype-list-lord')).length).toBeGreaterThanOrEqual(5);
  });
  it('permanents you control subject grants abilities', () => {
    const specs = parseStaticEffectSpecsFromOraclePermanent(perm('X', "As long as you're the monarch, permanents you control have hexproof.")) as any[];
    expect(JSON.stringify(specs)).toContain('permanents_you_control');
  });
});
