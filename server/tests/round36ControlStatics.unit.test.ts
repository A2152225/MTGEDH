import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';
import { specMatchesStaticCondition } from '../src/state/modules/staticEffectSpecConditionEval';
import { resolveExtendedCountMultiplier } from '../src/state/modules/staticEffectSpecCountBases';
import { normalizeStaticSelfNameSubjects } from '../src/state/modules/staticEffectSpecSelfNameSubject';
import { defenderConditionedAttackReason } from '../src/socket/combat-handlers/combatR36DefenderConditionedAttack';
import { collectAttackerSelfAttackTax, collectBlockerSelfTax } from '../../shared/src/combatAttackerSelfTax';

function perm(id: string, name: string, oracle: string, controller = 'p1', type_line = 'Creature', extra: any = {}): any {
  return { id, controller, owner: controller, counters: {}, card: { name, type_line, oracle_text: oracle, power: '2', toughness: '2', colors: [] }, ...extra };
}
function state(battlefield: any[], extra: any = {}): any {
  return {
    battlefield, turn: 3, turnPlayer: 'p1',
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
    zones: { p1: { hand: [], graveyard: [] }, p2: { hand: [], graveyard: [] } },
    ...extra,
  };
}
const specs = (p: any): any[] => parseStaticEffectSpecsFromOraclePermanent(p);
const find = (p: any, frag: string): any => specs(p).find((s: any) => String(s.id).includes(frag));
const land = (id: string, sub: string, controller: string) => perm(id, sub, '', controller, 'Basic Land \u2014 ' + sub);

describe('round 36: self-name subjects', () => {
  it('"X the Y" heads become the self subject (Oketra, Hazoret, Tuvasa, Rhonas)', () => {
    expect(find(perm('o', 'Oketra the True', "Oketra can't attack or block unless you control at least three other creatures.", 'p1', 'Legendary Creature \u2014 God'), 'self-combat-lock-unless')).toBeTruthy();
    expect(find(perm('t', 'Tuvasa the Sunlit', 'Tuvasa gets +1/+1 for each enchantment you control.', 'p1', 'Legendary Creature \u2014 Merfolk Shaman'), 'self-counted-pt')).toBeTruthy();
    const rhonas = perm('r', 'Rhonas the Indomitable', "Rhonas can't attack or block unless you control another creature with power 4 or greater.", 'p1', 'Legendary Creature \u2014 God');
    const spec = find(rhonas, 'self-combat-lock-unless');
    expect(spec?.condition.kind).toBe('controller_other_creature_power_at_least');
    const big = { ...perm('b', 'Big', '', 'p1'), card: { ...perm('b', 'Big', '').card, power: '5', toughness: '5' } };
    expect(specMatchesStaticCondition(rhonas, spec, state([rhonas, big]))).toBe(false);
    expect(specMatchesStaticCondition(rhonas, spec, state([rhonas, perm('s', 'Small', '')]))).toBe(true);
  });

  it('regression: no rewrite for creature-type heads or noncreature cards', () => {
    // "Goblin of the Flarg": head is a creature type, so the line keeps its printed subject.
    const goblinLine = "Goblin creatures can't block.";
    expect(normalizeStaticSelfNameSubjects(goblinLine, perm('g', 'Goblin of the Flarg', goblinLine))).toBe(goblinLine);
    // "Elf the Bold" (hypothetical): "X the Y" head that is a creature type is not an alias either.
    const elfLine = 'Elf creatures get +1/+1.';
    expect(normalizeStaticSelfNameSubjects(elfLine, perm('e', 'Elf the Bold', elfLine))).toBe(elfLine);
    // Noncreature: an enchantment named like its subject is left alone.
    const ench = "Urza can't be the target of spells.";
    expect(normalizeStaticSelfNameSubjects(ench, perm('u', 'Urza the Planner', ench, 'p1', 'Legendary Enchantment'))).toBe(ench);
    // Mid-sentence names are untouched.
    const mid = 'Creatures named Tuvasa get +1/+1.';
    expect(normalizeStaticSelfNameSubjects(mid, perm('t', 'Tuvasa the Sunlit', mid))).toBe(mid);
  });
});

describe('round 36: attack/block-unless conditions', () => {
  it('Harbor Serpent counts Islands on the whole battlefield', () => {
    const s = perm('h', 'Harbor Serpent', "Islandwalk\nThis creature can't attack unless there are five or more Islands on the battlefield.");
    const spec = find(s, 'self-combat-lock-unless');
    const isles = (n: number) => Array.from({ length: n }, (_, i) => land('i' + i, 'Island', i % 2 ? 'p1' : 'p2'));
    expect(specMatchesStaticCondition(s, spec, state([s, ...isles(5)]))).toBe(false);
    expect(specMatchesStaticCondition(s, spec, state([s, ...isles(4)]))).toBe(true);
  });

  it('Red Lock: red creatures need the defender to control an Island (declaration gate)', () => {
    const lock = perm('l', 'Red Lock', "Red creatures can't attack unless defending player controls an Island.", 'p2', 'Enchantment');
    const spec = find(lock, 'r36-mass-combat');
    expect(spec?.scope).toMatchObject({ kind: 'all_creatures', qualifier: { colors: ['R'] } });
    const red = perm('r', 'Ogre', '', 'p1', 'Creature', { card: { ...perm('r', 'Ogre', '').card, colors: ['R'] } });
    const green = perm('g', 'Bear', '', 'p1', 'Creature', { card: { ...perm('g', 'Bear', '').card, colors: ['G'] } });
    const field = [lock, red, green];
    expect(defenderConditionedAttackReason(red, 'p2', field, state(field))).toBeTruthy();
    expect(defenderConditionedAttackReason(green, 'p2', field, state(field))).toBeNull();
    const withIsland = [...field, land('i', 'Island', 'p2')];
    expect(defenderConditionedAttackReason(red, 'p2', withIsland, state(withIsland))).toBeNull();
  });

  it('self "more lands than defending player" is gated at declaration, not locked statically', () => {
    const g = perm('g', 'Goblin Test', "This creature can't attack unless you control more lands than defending player.");
    expect(find(g, 'self-combat-lock-unless')).toBeUndefined();
    const field = [g, land('a', 'Mountain', 'p1'), land('b', 'Mountain', 'p1'), land('c', 'Island', 'p2')];
    expect(defenderConditionedAttackReason(g, 'p2', field, state(field))).toBeNull();
    const even = [g, land('a', 'Mountain', 'p1'), land('c', 'Island', 'p2')];
    expect(defenderConditionedAttackReason(g, 'p2', even, state(even))).toBeTruthy();
  });

  it('Qal Sisma Behemoth: printed "unless you pay {2}" taxes attacks and blocks', () => {
    const q = perm('q', 'Qal Sisma Behemoth', "This creature can't attack or block unless you pay {2}.");
    expect(collectAttackerSelfAttackTax(q, [q]).cost).toBe(2);
    expect(collectBlockerSelfTax(q, [q]).cost).toBe(2);
    const atkOnly = perm('a', 'Tax Test', "This creature can't attack unless you pay {1}.");
    expect(collectAttackerSelfAttackTax(atkOnly, [atkOnly]).cost).toBe(1);
    expect(collectBlockerSelfTax(atkOnly, [atkOnly]).cost).toBe(0);
  });
});

describe('round 36: mass combat grants', () => {
  it('Deepchannel Mentor, Spitting Dilophosaurus, Stormtide Leviathan', () => {
    const mentor = find(perm('m', 'Deepchannel Mentor', "Blue creatures you control can't be blocked."), 'r36-mass-combat');
    expect(mentor).toMatchObject({ scope: { kind: 'creatures_you_control', qualifier: { colors: ['U'] } }, grant: { abilities: ["can't be blocked"] } });
    const dilo = find(perm('d', 'Spitting Dilophosaurus', "Creatures your opponents control with -1/-1 counters on them can't block."), 'r36-mass-combat');
    expect(dilo).toMatchObject({ scope: { kind: 'opponent_creatures', qualifier: { counter: '-1/-1' } }, grant: { abilities: ["can't block"] } });
    const levi = perm('s', 'Stormtide Leviathan', "Islandwalk\nAll lands are Islands in addition to their other types.\nCreatures without flying or islandwalk can't attack.");
    const spec = find(levi, 'r36-mass-combat');
    expect(spec?.condition).toMatchObject({ kind: 'target_lacks_keywords', keywords: ['flying', 'islandwalk'] });
    const bird = perm('b', 'Bird', 'Flying');
    const bear = perm('c', 'Bear', '');
    expect(specMatchesStaticCondition(bird, spec, state([levi, bird]))).toBe(false);
    expect(specMatchesStaticCondition(bear, spec, state([levi, bear]))).toBe(true);
  });

  it('conditional can\'t-be-blocked lines (Swimmer in Nightmares, Relic Runner)', () => {
    const swim = perm('w', 'Swimmer in Nightmares', "This creature can't be blocked as long as you control an Ashiok planeswalker.");
    const s1 = find(swim, 'self-unblockable-while');
    const ashiok = perm('a', 'Ashiok, Nightmare Muse', '', 'p1', 'Legendary Planeswalker \u2014 Ashiok');
    expect(specMatchesStaticCondition(swim, s1, state([swim, ashiok]))).toBe(true);
    expect(specMatchesStaticCondition(swim, s1, state([swim]))).toBe(false);
    const runner = perm('r', 'Relic Runner', "This creature can't be blocked if you've cast a historic spell this turn.");
    const s2 = find(runner, 'self-unblockable-while');
    const cast = { spellsCastThisTurn: [{ casterId: 'p1', card: { type_line: 'Artifact' } }] };
    expect(specMatchesStaticCondition(runner, s2, state([runner], cast))).toBe(true);
    expect(specMatchesStaticCondition(runner, s2, state([runner]))).toBe(false);
  });

  it('Thelonite Hermit: "All Saprolings get +1/+1"', () => {
    const spec = find(perm('t', 'Thelonite Hermit', 'All Saprolings get +1/+1.', 'p1', 'Creature \u2014 Elf Shaman'), 'r36-mass-pt');
    expect(spec).toMatchObject({ scope: { kind: 'all_creatures_of_type', creatureType: 'saproling' }, grant: { power: 1, toughness: 1 } });
  });
});

describe('round 36: count bases', () => {
  it('Aura on the battlefield, Swamps opponents control, opponents\' graveyards', () => {
    const gnarlid = perm('g', 'Aura Gnarlid', 'This creature gets +1/+1 for each Aura on the battlefield.');
    const aura = perm('x', 'Aura', '', 'p2', 'Enchantment \u2014 Aura');
    const sg = find(gnarlid, 'counted');
    expect(resolveExtendedCountMultiplier(sg, [gnarlid, aura, { ...aura, id: 'y', controller: 'p1' }], state([]))).toBe(2);
    const knight = perm('k', 'Crusading Knight', 'This creature gets +1/+1 for each Swamp your opponents control.');
    const sk = find(knight, 'counted');
    const field = [knight, land('s1', 'Swamp', 'p2'), land('s2', 'Swamp', 'p1')];
    expect(resolveExtendedCountMultiplier(sk, field, state(field))).toBe(1);
    const wight = perm('w', 'Wight of Precinct Six', "This creature gets +1/+1 for each creature card in your opponents' graveyards.");
    const sw = find(wight, 'counted');
    const st = state([wight], { zones: { p1: { hand: [], graveyard: [{ type_line: 'Creature' }] }, p2: { hand: [], graveyard: [{ type_line: 'Creature' }, { type_line: 'Instant' }] } } });
    expect(resolveExtendedCountMultiplier(sw, [wight], st)).toBe(1);
  });
});
