import { describe, it, expect } from 'vitest';
import '../src/state/modules/viewPermanentRulesStatus';
import { computeCopyInfo, computeEffectiveLandTypeLine, computeConditionalStatics } from '../src/state/modules/viewPermanentCharacteristics';

describe('view characteristics (round 9)', () => {
  it('reports the copied name, type line and P/T with Metamorph additions', () => {
    const perm: any = { id: 'm', copiedFromPermanentId: 'g', preCopyCardSnapshot: { name: 'Phyrexian Metamorph' },
      card: { name: 'Grizzly Bears', type_line: 'Artifact Creature \u2014 Bear', power: '2', toughness: '2' },
      copyEntryExceptions: { addCardTypes: ['Artifact'], addSubtypes: [], notLegendary: false, abilities: [] } };
    expect(computeCopyInfo(perm)).toEqual({ name: 'Grizzly Bears', typeLine: 'Artifact Creature \u2014 Bear', power: '2', toughness: '2', originalName: 'Phyrexian Metamorph', additions: ['Artifact'] });
    expect(computeCopyInfo({ id: 'x', card: { name: 'A' } })).toBeUndefined();
  });
  it('shows Evil Presence land types', () => {
    const land: any = { id: 'l', controller: 'p1', card: { name: 'Forest', type_line: 'Basic Land \u2014 Forest' } };
    const aura: any = { id: 'a', controller: 'p2', attachedTo: 'l', card: { name: 'Evil Presence', type_line: 'Enchantment \u2014 Aura', oracle_text: 'Enchant land\nEnchanted land is a Swamp.' } };
    const state: any = { battlefield: [land, aura] };
    expect(computeEffectiveLandTypeLine(land, state)).toBe('Basic Land \u2014 Swamp');
    expect(computeEffectiveLandTypeLine(land, { battlefield: [land] })).toBeUndefined();
  });
  it('shows every basic land type under Leyline of the Guildpact', () => {
    const land: any = { id: 'l', controller: 'p1', card: { name: 'Wastes', type_line: 'Basic Land' } };
    const ley: any = { id: 'y', controller: 'p1', card: { name: 'Leyline of the Guildpact', type_line: 'Enchantment', oracle_text: 'Each nonland permanent you control is all colors.\nLands you control are every basic land type in addition to their other types.' } };
    const line = computeEffectiveLandTypeLine(land, { battlefield: [land, ley] })!;
    for (const t of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) expect(line).toContain(t);
    expect(line.startsWith('Basic Land \u2014 ')).toBe(true);
    const opp: any = { ...land, id: 'o', controller: 'p2' };
    expect(computeEffectiveLandTypeLine(opp, { battlefield: [opp, ley] })).toBeUndefined();
  });
  it('reports commander/life statics on and off', () => {
    const perm: any = { id: 'b', controller: 'p1', card: { name: 'Bhaal' } };
    const spec = { id: 's', sourcePermanentId: 'b', sourceController: 'p1', sourceName: 'Bhaal', scope: { kind: 'self' }, grant: { abilities: ['Indestructible'] }, condition: { kind: 'source_controller_life_at_most_half_starting' } };
    const mk = (life: number) => { const s: any = { battlefield: [perm], life: { p1: life }, startingLife: 40 }; Object.defineProperty(s, '_derivedStaticEffectSpecs', { value: [spec] }); return s; };
    expect(computeConditionalStatics(perm, mk(15))).toEqual([{ sourceName: 'Bhaal', text: 'Indestructible for it while your life is at most half your starting life', active: true }]);
    expect(computeConditionalStatics(perm, mk(30))![0].active).toBe(false);
  });
});
