import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import {
  applyBatch112ManaProduction,
  applyBatch112PowerToughness,
  batch112CombatDamageAmount,
  batch112DestroyReplacement,
  batch112GlobalWither,
  batch112GrantsRetrace,
  batch112WardCost,
} from '../src/state/modules/batch112Apply.js';
import { applyLookOneRestGraveyard } from '../src/state/modules/batch112Draw.js';
import { parseEchoNonManaCost } from '../src/state/modules/echoNonManaCostParse.js';
import { parsePlaneswalkerAbilities } from '../src/state/modules/triggers/planeswalker-loyalty.js';

function perm(id: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller: 'p1',
    owner: 'p1',
    card: { name, oracle_text: oracle, type_line: 'Creature — Bear', power: '2', toughness: '2' },
    ...extra,
  };
}

describe('batch 112 leftover statics and replacements', () => {
  it('parses a static spec for graveyard power, retrace, and experience ward', () => {
    const goyf = "Necrogoyf's power is equal to the number of creature cards in all graveyards.";
    const six = 'During your turn, nonland permanent cards in your graveyard have retrace.';
    const ward = 'Minthara has ward {X}, where X is the number of experience counters you have.';
    expect(parseStaticEffectSpecsFromOraclePermanent(perm('g', 'Necrogoyf', goyf) as any).some((spec: any) => spec.grant?.abilities?.includes('gy_creature_power'))).toBe(true);
    expect(parseStaticEffectSpecsFromOraclePermanent(perm('s', 'Six', six) as any).some((spec: any) => spec.grant?.abilities?.includes('retrace'))).toBe(true);
    expect(parseStaticEffectSpecsFromOraclePermanent(perm('m', 'Minthara', ward) as any).some((spec: any) => spec.grant?.abilities?.includes('ward_experience'))).toBe(true);
    expect(parseStaticEffectSpecsFromOraclePermanent(perm('ras', 'Rasputin Dreamweaver', "Rasputin can't have more than seven dream counters on it.") as any).some((spec: any) => spec.grant?.abilities?.includes('counter_cap'))).toBe(true);
  });

  it('sets power from graveyard creatures and from half an opponent life total', () => {
    const goyf = perm('g', 'Necrogoyf', "Necrogoyf's power is equal to the number of creature cards in all graveyards.");
    const state = {
      battlefield: [goyf],
      zones: { p1: { graveyard: [{ type_line: 'Creature — Bear' }, { type_line: 'Instant' }] }, p2: { graveyard: [{ type_line: 'Creature — Zombie' }] } },
    };
    expect(applyBatch112PowerToughness(goyf, state, 0, 4).power).toBe(2);

    const malignus = perm('mal', 'Malignus', "Malignus's power and toughness are each equal to half the highest life total among your opponents, rounded up.");
    const lives = { battlefield: [malignus], players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 17 }], life: { p1: 20, p2: 17 } };
    expect(applyBatch112PowerToughness(malignus, lives, 1, 1)).toEqual({ power: 9, toughness: 9 });
  });

  it('replaces land mana with the printed color', () => {
    const darkness = perm('d', 'Infernal Darkness', 'If a land is tapped for mana, it produces {B} instead of any other type.', {
      card: { name: 'Infernal Darkness', oracle_text: 'If a land is tapped for mana, it produces {B} instead of any other type.', type_line: 'Enchantment' },
    });
    const forest = perm('f', 'Forest', '', { card: { name: 'Forest', oracle_text: '', type_line: 'Basic Land — Forest' } });
    const info = applyBatch112ManaProduction({ colors: ['G'], totalAmount: 1, baseAmount: 1 }, { battlefield: [darkness, forest] }, forest, 'p1');
    expect(info.colors).toEqual(['B']);
  });

  it('collects the look-one draw and enchanted-to-hand replacements', () => {
    const lich = perm('u', 'Underrealm Lich', 'If you would draw a card, instead look at the top three cards of your library, then put one into your hand and the rest into your graveyard.');
    const mark = perm('mark', "Necromancer's Magemark", "If a creature you control that's enchanted would die, return it to its owner's hand instead.", {
      card: { name: "Necromancer's Magemark", oracle_text: "If a creature you control that's enchanted would die, return it to its owner's hand instead.", type_line: 'Enchantment — Aura' },
    });
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [lich, mark] } as any);
    expect(specs.some((spec) => spec.effectId === 'look-one-rest-graveyard')).toBe(true);
    expect(specs.some((spec) => spec.effectId === 'enchanted-die-to-hand' && spec.instead?.redirectZone === 'hand')).toBe(true);
  });

  it('puts one looked-at card in hand and the rest in the graveyard', () => {
    const state: any = { zones: { p1: { library: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], hand: [], graveyard: [] } } };
    const ctx: any = { state };
    applyLookOneRestGraveyard(ctx, 'p1', 3, 'b');
    expect(state.zones.p1.hand.map((card: any) => card.id)).toEqual(['b']);
    expect(state.zones.p1.graveyard.map((card: any) => card.id)).toEqual(['a', 'c']);
    expect(state.zones.p1.library.map((card: any) => card.id)).toEqual(['d']);
  });

  it('parses echo sacrifice lands, global wither, and negative combat damage', () => {
    expect(parseEchoNonManaCost('Echo—Sacrifice two lands.')).toEqual({ cost: { kind: 'sacrifice-lands', count: 2 }, label: 'Sacrifice 2 lands' });
    const torment = perm('t', 'Everlasting Torment', 'All damage is dealt as though its source had wither.');
    expect(batch112GlobalWither({ battlefield: [torment] })).toBe(true);
    const loot = perm('loot', 'Loot, the Anomaly', "If Loot's power is negative, he assigns combat damage as though his power were positive.");
    expect(batch112CombatDamageAmount(loot, -3)).toBe(3);
  });

  it('parses die-gated loyalty, grants retrace, ward, and turns destroy into healing', () => {
    const comet = parsePlaneswalkerAbilities({
      name: 'Comet, Stellar Pup',
      type_line: 'Legendary Planeswalker — Comet',
      oracle_text: '1 or 2 — [+2], then create two 1/1 green Squirrel creature tokens.\n4 or 5 — Comet deals damage equal to the number of loyalty counters on him to a creature or player, then [−2].\n6 — [+1], and you may activate this ability two more times this turn.',
    }, { id: 'comet' });
    expect(comet?.abilities.some((ability) => ability.dieRollMin === 1 && ability.dieRollMax === 2 && ability.cost === 2)).toBe(true);
    expect(comet?.abilities.some((ability) => ability.dieRollMin === 4 && ability.dieRollMax === 5 && ability.cost === -2)).toBe(true);
    expect(parseStaticEffectSpecsFromOraclePermanent(perm('tyvar', 'Tyvar the Bellicose', 'Each creature you control has "Whenever a mana ability of this creature resolves, put a +1/+1 counter on it."') as any).some((spec: any) => spec.grant?.abilities?.includes('mana_ability_grant'))).toBe(true);

    const six = perm('six', 'Six', 'During your turn, nonland permanent cards in your graveyard have retrace.');
    const spell = { name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}' };
    expect(batch112GrantsRetrace({ battlefield: [six], turnPlayer: 'p1' }, 'p1', spell)).toBe(true);
    expect(batch112GrantsRetrace({ battlefield: [six], turnPlayer: 'p1' }, 'p1', { type_line: 'Land' })).toBe(false);

    const minthara = perm('min', 'Minthara', 'Minthara has ward {X}, where X is the number of experience counters you have.');
    expect(batch112WardCost(minthara, { players: [{ id: 'p1', experienceCounters: 3 }] })).toBe('{3}');

    const doc = perm('doc', 'Dr. McCoy', 'If another creature you control with a +1/+1 counter on it would be destroyed, instead remove all +1/+1 counters from it.');
    const patient = perm('pat', 'Patient', '', { counters: { '+1/+1': 2 }, markedDamage: 4 });
    expect(batch112DestroyReplacement({ battlefield: [doc, patient] }, 'pat')).toBe(true);
    expect(patient.counters['+1/+1']).toBe(0);
    expect(patient.markedDamage).toBe(0);
  });
});
