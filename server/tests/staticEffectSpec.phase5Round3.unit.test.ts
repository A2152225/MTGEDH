import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';
import { evalPhase5StateCondition } from '../src/state/modules/staticEffectSpecPhase5StateEval';
import { resolvePhase5CountMultiplier } from '../src/state/modules/staticEffectSpecPhase5Eval';

const perm = (name: string, oracle_text: string, extra: any = {}, type_line = 'Creature \u2014 Human') =>
  ({ id: 'src', controller: 'p1', owner: 'p1', counters: {}, ...extra, card: { id: 'src', name, type_line, oracle_text } }) as any;
const specsOf = (p: any) => parseStaticEffectSpecsFromOraclePermanent(p) as any[];
const findCond = (specs: any[], kind: string) => {
  for (const s of specs) for (const c of [s.condition, ...(s.conditions || [])]) if (c?.kind === kind) return { spec: s, cond: c };
  return undefined;
};
const ev = (hit: any, target: any, source: any, bf: any[], state: any = {}) => evalPhase5StateCondition(hit.cond, target, source, 'p1', bf, state);

describe('phase 5 round 3 state conditions', () => {
  it('gained life this turn', () => {
    const p = perm('Thornfist Striker', 'Infusion \u2014 Creatures you control get +1/+0 and have trample as long as you gained life this turn.');
    const hit = findCond(specsOf(p), 'controller_gained_life_this_turn');
    expect(hit).toBeTruthy();
    expect(ev(hit, p, p, [p], { lifeGainedThisTurn: { p1: 2 } })).toBe(true);
    expect(ev(hit, p, p, [p], { lifeGainedThisTurn: { p1: 0 } })).toBe(false);
  });
  it('attacked with N or more this turn', () => {
    const p = perm('Deepway Navigator', 'As long as you attacked with three or more Merfolk this turn, Merfolk you control get +1/+0.', {}, 'Creature \u2014 Merfolk Wizard');
    const hit = findCond(specsOf(p), 'controller_attacked_with_at_least');
    expect(hit).toBeTruthy();
    const m = (id: string, attacked: boolean) => ({ id, controller: 'p1', attackedThisTurn: attacked, card: { name: id, type_line: 'Creature \u2014 Merfolk' } });
    expect(ev(hit, p, p, [p, m('a', true), m('b', true), m('c', true)])).toBe(true);
    expect(ev(hit, p, p, [p, m('a', true), m('b', true), m('c', false)])).toBe(false);
  });
  it('delirium card types in graveyard', () => {
    const p = perm('X', 'Delirium \u2014 Creatures you control get +1/+1 as long as there are four or more card types among cards in your graveyard.');
    const hit = findCond(specsOf(p), 'controller_graveyard_card_types_at_least');
    expect(hit).toBeTruthy();
    const gy = (lines: string[]) => ({ zones: { p1: { graveyard: lines.map((type_line) => ({ type_line })) } } });
    expect(ev(hit, p, p, [p], gy(['Artifact Creature \u2014 Golem', 'Land', 'Instant']))).toBe(true);
    expect(ev(hit, p, p, [p], gy(['Creature', 'Land', 'Instant']))).toBe(false);
  });
  it('top card of library colour', () => {
    const p = perm('Vampire Nocturnus', 'As long as the top card of your library is black, this creature and other Vampire creatures you control get +2/+1 and have flying.');
    const hit = findCond(specsOf(p), 'controller_library_top_is_color');
    expect(hit).toBeTruthy();
    expect(ev(hit, p, p, [p], { zones: { p1: { library: [{ colors: ['B'] }] } } })).toBe(true);
    expect(ev(hit, p, p, [p], { zones: { p1: { library: [{ colors: ['G'] }] } } })).toBe(false);
    expect(ev(hit, p, p, [p], { zones: { p1: { library: [{ mana_cost: '{2}{B}' }] } } })).toBe(true);
  });
  it('equipped creature tapped / untapped', () => {
    const host = { id: 'h', controller: 'p1', tapped: true, card: { name: 'h', type_line: 'Creature' } };
    const eq = perm('Sword', 'As long as equipped creature is tapped, tapped creatures you control get +2/+0.\nAs long as equipped creature is untapped, untapped creatures you control get +0/+2.', { attachedTo: 'h' }, 'Artifact \u2014 Equipment');
    const hit = findCond(specsOf(eq), 'source_attached_is_tapped');
    expect(hit).toBeTruthy();
    expect(ev(hit, host, eq, [eq, host])).toBe(true);
    expect(ev(hit, host, eq, [eq, { ...host, tapped: false }])).toBe(false);
    expect(evalPhase5StateCondition({ kind: 'source_attached_is_untapped' }, host, eq, 'p1', [eq, { ...host, tapped: false }], {})).toBe(true);
  });
  it('exactly N permanents named', () => {
    const p = perm('Mothers Yamazaki', "As long as you control exactly two permanents named Mothers Yamazaki, the \"legend rule\" doesn't apply to them, and Samurai you control get +2/+2 and have vigilance and haste.");
    const hit = findCond(specsOf(p), 'controller_controls_named_exactly');
    expect(hit).toBeTruthy();
    const twin = { ...p, id: 'src2' };
    expect(ev(hit, p, p, [p, twin])).toBe(true);
    expect(ev(hit, p, p, [p])).toBe(false);
  });
  it('face-down creatures', () => {
    const p = perm('Secret Plans', 'Face-down creatures you control get +0/+1.', {}, 'Enchantment');
    const hit = findCond(specsOf(p), 'target_is_face_down');
    expect(hit).toBeTruthy();
    expect(ev(hit, { id: 'f', controller: 'p1', faceDown: true }, p, [p])).toBe(true);
    expect(ev(hit, { id: 'f', controller: 'p1' }, p, [p])).toBe(false);
  });
  it('commander cast count basis', () => {
    const p = perm('Vanguard of the Restless', "Spirits you control get +1/+1 for each time you've cast your commander from the command zone this game.");
    const spec = specsOf(p).find((s) => JSON.stringify(s).includes('controller_commander_casts'));
    expect(spec).toBeTruthy();
    expect(resolvePhase5CountMultiplier({ ...spec, sourceController: 'p1' }, [p], { commandZone: { p1: { tax: 4 } } })).toBe(2);
  });
});
