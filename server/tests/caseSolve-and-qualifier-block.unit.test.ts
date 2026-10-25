import { describe, it, expect } from 'vitest';
import { evaluateCaseSolveCondition, processCaseSolveAtEndStep, caseSolveText } from '../src/state/modules/caseSolve';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';

const creature = (id: string, controller: string, type_line: string, oracle_text = '', extra: any = {}) =>
  ({ id, controller, owner: controller, counters: {}, ...extra, card: { id, name: id, type_line, oracle_text, power: '2', toughness: '2' } }) as any;

describe('Case solve tracking', () => {
  const gateway = 'When this Case enters, choose target creature you don\u2019t control.\nTo solve \u2014 Three or more creatures attacked this turn. (If unsolved, solve at the beginning of your end step.)\nSolved \u2014 Creatures you control get +1/+0.';
  it('extracts the To solve text', () => {
    expect(caseSolveText(gateway)).toBe('Three or more creatures attacked this turn');
  });
  it('solves at end step only when the condition holds, and turns on the Solved static', () => {
    const c = creature('case', 'p1', 'Enchantment \u2014 Case', gateway);
    const atk = (id: string) => creature(id, 'p1', 'Creature \u2014 Bear', '', { attackedThisTurn: true });
    const state: any = { turnPlayer: 'p1', battlefield: [c, atk('a'), atk('b')] };
    processCaseSolveAtEndStep({ state });
    expect(c.solved).toBeUndefined();
    state.battlefield.push(atk('d'));
    processCaseSolveAtEndStep({ state });
    expect(c.solved).toBe(true);
  });
  it('evaluates other To solve families', () => {
    const st: any = { battlefield: [creature('l1', 'p1', 'Land'), creature('l2', 'p1', 'Land')], zones: { p1: { hand: [], graveyard: [] } }, lifeGainedThisTurn: { p1: 5 } };
    expect(evaluateCaseSolveCondition("You've gained 5 or more life this turn", 'p1', st)).toBe(true);
    expect(evaluateCaseSolveCondition('You control seven or more lands', 'p1', st)).toBe(false);
    expect(evaluateCaseSolveCondition('You have no cards in hand', 'p1', st)).toBe(true);
    expect(evaluateCaseSolveCondition('Something unknown', 'p1', st)).toBeUndefined();
  });
});

describe('static-granted qualifier block restriction', () => {
  it('Wall Crawl spiders cannot be blocked by defenders', () => {
    const wc = creature('wc', 'p1', 'Enchantment', "Spiders you control get +1/+1 and can't be blocked by creatures with defender.");
    const spider = creature('sp', 'p1', 'Creature \u2014 Spider', 'Reach');
    const wall = creature('wall', 'p2', 'Creature \u2014 Wall', 'Defender', { card: { id: 'wall', name: 'wall', type_line: 'Creature \u2014 Wall', oracle_text: 'Defender', keywords: ['Defender'], power: '0', toughness: '4' } });
    const bear = creature('bear', 'p2', 'Creature \u2014 Bear');
    const bf = [wc, spider, wall, bear];
    expect(getContinuousGrantedAbilitiesForPermanent(spider, { battlefield: bf } as any).join('|')).toContain('defender');
    expect(canBlockAttacker(wall, spider, bf, 'p2', { battlefield: bf }).canBlock).toBe(false);
    expect(canBlockAttacker(bear, spider, bf, 'p2', { battlefield: bf }).canBlock).toBe(true);
  });
});
