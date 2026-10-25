import { describe, expect, it } from 'vitest';
import { computePermanentRulesStatus } from '../src/state/modules/viewPermanentRulesStatus.js';
// Imported first for module init order; the breakdown is read directly so recomputed specs do not replace the fixtures.
import { computePtBreakdown, describeCondition } from '../src/state/modules/viewPermanentPtBreakdown.js';
void computePermanentRulesStatus;

const c = (name: string, type_line: string, oracle_text: string, extra: any = {}) => ({ name, type_line, oracle_text, ...extra });

describe('P/T breakdown for the view', () => {
  it('Renata shows devotion', () => {
    const renata: any = { id: 'r', controller: 'p1', card: c('Renata, Called to the Hunt', 'Legendary Enchantment Creature \u2014 God', "Renata, Called to the Hunt's power is equal to your devotion to green.", { mana_cost: '{2}{G}', toughness: '4' }) };
    const elf: any = { id: 'e', controller: 'p1', card: c('Elf', 'Creature \u2014 Elf', '', { mana_cost: '{G}{G}' }) };
    const lines = computePtBreakdown(renata, { battlefield: [renata, elf] }) || [];
    expect(lines[0]).toMatchObject({ kind: 'devotion', text: 'Power = devotion to green (3)' });
  });
  it('Tarmogoyf shows the graveyard count with its scope', () => {
    const goyf: any = { id: 'g', controller: 'p1', card: c('Tarmogoyf', 'Creature \u2014 Lhurgoyf', "Tarmogoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.") };
    const state: any = { battlefield: [goyf], zones: { p1: { graveyard: [{ type_line: 'Instant' }] }, p2: { graveyard: [{ type_line: 'Artifact Creature \u2014 Golem' }] } } };
    expect(computePtBreakdown(goyf, state)?.[0].text).toBe('Number of card types among cards in all graveyards: 3 (toughness +1)');
  });
  it('counter-scaled and Otherwise specs', () => {
    const host: any = { id: 'h', controller: 'p1', card: c('Bear', 'Creature \u2014 Bear', '', { colors: ['G'] }) };
    const sigil: any = { id: 's', controller: 'p1', attachedTo: 'h', counters: { charge: 3 }, card: c('Sigil', 'Artifact \u2014 Equipment', '') };
    const state: any = { battlefield: [host, sigil], _derivedStaticEffectSpecs: [
      { id: 's:c', scope: { kind: 'self' }, sourcePermanentId: 'h', effectSourcePermanentId: 's', sourceName: 'Sigil', grant: { power: 1, toughness: 0, countBasis: 'source_counters', countCounterType: 'charge', countOnEffectSource: true } },
      { id: 'h:o', scope: { kind: 'self' }, sourcePermanentId: 'h', sourceName: 'Bear', grant: { power: -1, toughness: -1 }, condition: { kind: 'target_lacks_type', cardType: 'creature' }, conditionNegated: true },
    ] };
    const t = (computePtBreakdown(host, state) || []).map((l) => l.text);
    expect(t).toEqual(['Sigil: +1/+0 \u00d7 3 charge counters on Sigil = +3/+0', "Bear: -1/-1 otherwise (unless it isn't a creature) (active)"]);
  });
  it('counter-scaled lord line and readable conditions', () => {
    const lord: any = { id: 'l', controller: 'p1', counters: { '+1/+1': 2 }, card: { name: 'Lord', type_line: 'Creature \u2014 Elf', oracle_text: '' } };
    const elf: any = { id: 'e', controller: 'p1', card: { name: 'Elf', type_line: 'Creature \u2014 Elf', oracle_text: '' } };
    const state: any = { battlefield: [lord, elf], _derivedStaticEffectSpecs: [
      { id: 'l:x', scope: { kind: 'other_creatures_you_control', creatureType: 'Elf' }, sourcePermanentId: 'l', sourceController: 'p1', sourceName: 'Lord', grant: { power: 1, toughness: 1, countBasis: 'source_counters', countCounterType: '+1/+1' } }] };
    expect(computePtBreakdown(elf, state)?.[0].text).toBe('Lord: +1/+1 \u00d7 2 +1/+1 counters on Lord = +2/+2');
    expect(computePtBreakdown(lord, state)).toBeUndefined();
    expect(describeCondition({ kind: 'opponent_controls_matching', color: 'black', cardType: 'permanent' })).toBe('an opponent controls a black permanent');
    expect(describeCondition({ kind: 'target_is_tapped' })).toBe('it is tapped');
  });
});
