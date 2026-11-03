import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';
import { specMatchesStaticCondition } from '../src/state/modules/staticEffectSpecConditionEval';
import { resolveExtendedCountMultiplier } from '../src/state/modules/staticEffectSpecCountBases';
import { getQualifierBlockRestrictionReason, parseQualifierBlockRestrictions } from '../src/socket/combat-handlers/combatQualifierBlockRestriction';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates';
import { getCreatureGoadStatus } from '../src/socket/combat-handlers/combatDeclareAttackersForceTapSupport';

function perm(id: string, name: string, oracle: string, controller = 'p1', type_line = 'Creature', extra: any = {}): any {
  return { id, controller, owner: controller, counters: {}, card: { name, type_line, oracle_text: oracle, power: '2', toughness: '2', colors: [] }, ...extra };
}
function state(battlefield: any[], extra: any = {}): any {
  return {
    battlefield, turn: 3, turnPlayer: 'p1',
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
    zones: { p1: { hand: [], graveyard: [] }, p2: { hand: [{ id: 'h1' }], graveyard: [] } },
    ...extra,
  };
}
const find = (p: any, frag: string): any => parseStaticEffectSpecsFromOraclePermanent(p).find((s: any) => String(s.id).includes(frag));
const stats = { blockerPower: 2, blockerToughness: 2 };

describe('round 35: block-by filters', () => {
  it('non-Wall and creature-token filters bar the right blockers', () => {
    const maggots = perm('m', 'Flow of Maggots', "This creature can't be blocked by non-Wall creatures.");
    expect(getQualifierBlockRestrictionReason(maggots, perm('b', 'Bear', ''), [], stats)).toBeTruthy();
    expect(getQualifierBlockRestrictionReason(maggots, perm('w', 'Wall', '', 'p2', 'Creature \u2014 Wall'), [], stats)).toBeNull();
    const runner = perm('r', 'Rubblebelt Runner', "This creature can't be blocked by creature tokens.");
    expect(getQualifierBlockRestrictionReason(runner, perm('t', 'Token', '', 'p2', 'Token Creature', { isToken: true }), [], stats)).toBeTruthy();
    expect(getQualifierBlockRestrictionReason(runner, perm('b', 'Bear', ''), [], stats)).toBeNull();
    expect(find(maggots, 'self-block-filter')?.grant.abilities).toEqual(["can't be blocked by non-wall creatures"]);
  });

  it('Kithkin Armor grants a host power filter that the qualifier reader understands', () => {
    const aura = perm('k', 'Kithkin Armor', "Enchant creature\nEnchanted creature can't be blocked by creatures with power 3 or greater.", 'p1', 'Enchantment \u2014 Aura', { attachedTo: 'h' });
    const spec = find(aura, 'attached-block-filter');
    expect(spec?.sourcePermanentId).toBe('h');
    const parsed = parseQualifierBlockRestrictions(spec.grant.abilities);
    expect(parsed[0]).toMatchObject({ kind: 'stat', stat: 'power', amount: 3 });
  });
});

describe('round 35: static goad', () => {
  it('The Sound of Drums grants goaded, honored by goad status', () => {
    const host = perm('h', 'Ogre', '', 'p2');
    const drums = perm('d', 'The Sound of Drums', "Enchant creature\nEnchanted creature is goaded.", 'p1', 'Enchantment \u2014 Aura', { attachedTo: 'h' });
    expect(find(drums, 'attached-static-goad')?.grant.abilities).toEqual(['goaded']);
    const st = state([host, drums]);
    expect(getCreatureGoadStatus(host, st.battlefield, 'p2', 3, st).isGoaded).toBe(true);
  });

  it('Bothersome Quasit: goaded opposing creatures cannot block', () => {
    const quasit = perm('q', 'Bothersome Quasit', "Goaded creatures your opponents control can't block.");
    expect(find(quasit, 'goaded-cant-block')?.scope.kind).toBe('opponent_creatures');
    const blocker = perm('b', 'Bear', '', 'p2', 'Creature', { goadedBy: ['p1'] });
    const attacker = perm('a', 'Elf', '', 'p1', 'Creature', { attacking: 'p2' });
    const st = state([quasit, blocker, attacker]);
    expect(canBlockAttacker(blocker, attacker, st.battlefield, 'p2', st).canBlock).toBe(false);
    const free = perm('c', 'Bear', '', 'p2');
    const st2 = state([quasit, free, attacker]);
    expect(canBlockAttacker(free, attacker, st2.battlefield, 'p2', st2).canBlock).toBe(true);
  });

  it('Baeloth goads opposing creatures with less power', () => {
    const baeloth = perm('ba', 'Baeloth Barrityl, Entertainer', "Creatures your opponents control with power less than Baeloth Barrityl's power are goaded.", 'p1', 'Creature', { basePower: 2 });
    const spec = find(baeloth, 'power-less-goad');
    expect(spec?.grant.abilities).toEqual(['goaded']);
    const small = perm('s', 'Mite', '', 'p2', 'Creature', { basePower: 1, effectivePower: 1 });
    const big = perm('g', 'Giant', '', 'p2', 'Creature', { basePower: 5, effectivePower: 5 });
    baeloth.effectivePower = 2;
    const st = state([baeloth, small, big]);
    expect(specMatchesStaticCondition(small, spec, st)).toBe(true);
    expect(specMatchesStaticCondition(big, spec, st)).toBe(false);
  });
});

describe('round 35: self conditions', () => {
  it('Jeskai Infiltrator is unblockable only while alone (non-vacuous)', () => {
    const inf = perm('j', 'Jeskai Infiltrator', "Jeskai Infiltrator can't be blocked as long as you control no other creatures.", 'p1', 'Creature', { attacking: 'p2' });
    const spec = find(inf, 'self-unblockable-while');
    expect(spec).toBeTruthy();
    expect(specMatchesStaticCondition(inf, spec, state([inf]))).toBe(true);
    const friend = perm('f', 'Friend', '');
    expect(specMatchesStaticCondition(inf, spec, state([inf, friend]))).toBe(false);
    const blocker = perm('b', 'Bear', '', 'p2');
    const st = state([inf, blocker]);
    expect(canBlockAttacker(blocker, inf, st.battlefield, 'p2', st).canBlock).toBe(false);
  });

  it('defending player untapped land, any player hand, spells this turn', () => {
    const hazy = perm('hz', 'Hazy Homunculus', "This creature can't be blocked as long as defending player controls an untapped land.", 'p1', 'Creature', { attacking: 'p2' });
    const hs = find(hazy, 'self-unblockable-while');
    expect(hs.condition.kind).toBe('defending_player_controls_matching');
    const land = perm('l', 'Forest', '', 'p2', 'Basic Land \u2014 Forest');
    expect(specMatchesStaticCondition(hazy, hs, state([hazy, land]))).toBe(true);
    expect(specMatchesStaticCondition(hazy, hs, state([hazy, { ...land, tapped: true }]))).toBe(false);

    const lupine = perm('lu', 'Lupine Prototype', "This creature can't attack or block unless a player has no cards in hand.");
    const ls = find(lupine, 'self-combat-lock-unless');
    expect(ls.condition.kind).toBe('any_player_hand_at_most');
    expect(specMatchesStaticCondition(lupine, ls, state([lupine]))).toBe(false); // p1 empty hand -> unlocked
    const full = state([lupine]); full.zones.p1.hand = [{ id: 'x' }];
    expect(specMatchesStaticCondition(lupine, ls, full)).toBe(true);

    const illvoi = perm('il', 'Illvoi Infiltrator', "This creature can't be blocked if you've cast two or more spells this turn.");
    const is = find(illvoi, 'self-unblockable-while');
    expect(specMatchesStaticCondition(illvoi, is, state([illvoi], { spellsCastThisTurn: [{ casterId: 'p1' }] }))).toBe(false);
    expect(specMatchesStaticCondition(illvoi, is, state([illvoi], { spellsCastThisTurn: [{ casterId: 'p1' }, { casterId: 'p1' }] }))).toBe(true);
  });
});

describe('round 35: for-each count bases', () => {
  it('untyped counters, host hand, host colours, named creatures', () => {
    const host = perm('h', 'Bear', '', 'p2', 'Creature', { card: { name: 'Bear', type_line: 'Creature', colors: ['W', 'U'], oracle_text: '' } });
    const gavel = perm('gv', 'Gavel of the Righteous', 'Equipped creature gets +1/+1 for each counter on this Equipment.', 'p1', 'Artifact \u2014 Equipment', { attachedTo: 'h', counters: { charge: 2, oil: 1 } });
    const gs: any = parseStaticEffectSpecsFromOraclePermanent(gavel).find((s: any) => s.grant?.countBasis === 'source_counters');
    expect(gs?.grant.countOnEffectSource).toBe(true);

    const auth = perm('ra', 'Righteous Authority', "Enchanted creature gets +1/+1 for each card in its controller's hand.", 'p1', 'Enchantment \u2014 Aura', { attachedTo: 'h' });
    const as: any = parseStaticEffectSpecsFromOraclePermanent(auth).find((s: any) => s.grant?.countBasis === 'host_controller_hand_size');
    expect(resolveExtendedCountMultiplier(as, [host, auth], state([host, auth]))).toBe(1);

    const bless = perm('bn', 'Blessing of the Nephilim', 'Enchanted creature gets +1/+1 for each of its colors.', 'p1', 'Enchantment \u2014 Aura', { attachedTo: 'h' });
    const bs: any = parseStaticEffectSpecsFromOraclePermanent(bless).find((s: any) => s.grant?.countBasis === 'host_color_count');
    expect(resolveExtendedCountMultiplier(bs, [host, bless], state([host, bless]))).toBe(2);

    const rats = perm('r1', 'Relentless Rats', 'Relentless Rats gets +1/+1 for each other creature on the battlefield named Relentless Rats.', 'p1', 'Creature \u2014 Rat');
    const rs: any = parseStaticEffectSpecsFromOraclePermanent(rats).find((s: any) => s.grant?.countBasis === 'creatures_named');
    const bf = [rats, perm('r2', 'Relentless Rats', '', 'p2', 'Creature \u2014 Rat'), perm('r3', 'Relentless Rats', '', 'p1', 'Creature \u2014 Rat'), perm('x', 'Bear', '')];
    expect(resolveExtendedCountMultiplier(rs, bf, state(bf))).toBe(2);
  });
});
