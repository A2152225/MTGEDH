import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';
import { specMatchesStaticCondition } from '../src/state/modules/staticEffectSpecConditionEval';
import { resolveExtendedCountMultiplier } from '../src/state/modules/staticEffectSpecCountBases';

function perm(id: string, name: string, oracle: string, controller = 'p1', type_line = 'Creature'): any {
  return { id, controller, owner: controller, counters: {}, card: { name, type_line, oracle_text: oracle, power: '2', toughness: '2' } };
}
function state(battlefield: any[], graveyard: any[] = []): any {
  return { battlefield, players: [{ id: 'p1', hand: [], graveyard, life: 40 }, { id: 'p2', hand: [], graveyard: [], life: 40 }], turnPlayer: 'p1', zones: { p1: { graveyard, hand: [] }, p2: { graveyard: [], hand: [] } } };
}

describe('round 34 control statics', () => {
  it('Blind-Spot Giant: locked unless you control another Giant', () => {
    const giant = perm('g', 'Blind-Spot Giant', "Blind-Spot Giant can't attack or block unless you control another Giant.", 'p1', 'Creature \u2014 Giant Warrior');
    const specs = parseStaticEffectSpecsFromOraclePermanent(giant);
    const spec: any = specs.find((s: any) => String(s.id).includes('self-combat-lock-unless'));
    expect(spec).toBeTruthy();
    expect(spec.grant.abilities).toEqual(["can't attack", "can't block"]);
    expect(spec.conditionNegated).toBe(true);
    expect(specMatchesStaticCondition(giant, spec, state([giant]))).toBe(true);
    const other = perm('o', 'Hill Giant', '', 'p1', 'Creature \u2014 Giant');
    expect(specMatchesStaticCondition(giant, spec, state([giant, other]))).toBe(false);
  });

  it('block-only lock and cost-style unless are distinguished', () => {
    const nul = perm('n', 'Mindless Null', "Mindless Null can't block unless you control a Vampire.");
    const s: any = parseStaticEffectSpecsFromOraclePermanent(nul).find((x: any) => String(x.id).includes('self-combat-lock-unless'));
    expect(s?.grant.abilities).toEqual(["can't block"]);
    const serpent = perm('f', 'Floodtide Serpent', "Floodtide Serpent can't attack unless you return an enchantment you control to its owner's hand.");
    expect(parseStaticEffectSpecsFromOraclePermanent(serpent).some((x: any) => String(x.id).includes('self-combat-lock-unless'))).toBe(false);
  });

  it('Jeskai-style unblockable while condition', () => {
    const inf = perm('j', 'Jeskai Infiltrator', "Jeskai Infiltrator can't be blocked as long as you control no other creatures.");
    const s: any = parseStaticEffectSpecsFromOraclePermanent(inf).find((x: any) => String(x.id).includes('self-unblockable-while'));
    expect(s).toBeTruthy();
    expect(s.grant.abilities).toEqual(["can't be blocked"]);
    expect(s.condition).toMatchObject({ kind: 'controller_controls_no_other', cardType: 'creature' });
  });

  it('Scourge of Geier Reach counts creatures your opponents control', () => {
    const sc = perm('s', 'Scourge of Geier Reach', 'Scourge of Geier Reach gets +1/+1 for each creature your opponents control.');
    const spec: any = parseStaticEffectSpecsFromOraclePermanent(sc).find((x: any) => x.grant?.countWho === 'opponents');
    expect(spec).toBeTruthy();
    const bf = [sc, perm('a', 'Bear', '', 'p2'), perm('b', 'Bear', '', 'p2'), perm('c', 'Elf', '', 'p1')];
    expect(resolveExtendedCountMultiplier(spec, bf, state(bf))).toBe(2);
  });

  it('Katara counts Lesson cards in your graveyard', () => {
    const k = perm('k', 'Katara Test', 'Katara Test gets +1/+1 for each Lesson card in your graveyard.');
    const spec: any = parseStaticEffectSpecsFromOraclePermanent(k).find((x: any) => x.grant?.countBasis === 'controller_graveyard_cards_of_type');
    expect(spec?.grant.countCardType).toBe('lesson');
    const gy = [{ id: 'x', type_line: 'Sorcery \u2014 Lesson' }, { id: 'y', type_line: 'Instant' }];
    expect(resolveExtendedCountMultiplier(spec, [k], state([k], gy))).toBe(1);
  });
});
