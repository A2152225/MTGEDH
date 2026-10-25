import { describe, expect, it } from 'vitest';
import { parseLifeThresholdTriggers, queueLifeThresholdStateTriggers } from '../src/state/modules/triggers/lifeThresholdStateTriggers.js';

const OPAL = 'When you have 10 or less life, if Opal Avenger is an enchantment, it becomes a 3/5 Soldier creature.';
function ctxWith(life: number, typeLine = 'Enchantment', stack: any[] = []): any {
  return { state: {
    players: [{ id: 'p1', life }, { id: 'p2', life: 40 }], life: { p1: life, p2: 40 }, stack,
    battlefield: [{ id: 'opal', controller: 'p1', owner: 'p1', counters: {}, card: { name: 'Opal Avenger', type_line: typeLine, oracle_text: OPAL } }],
  } };
}

describe('round 25 life-threshold state triggers', () => {
  it('parses N or less / N or more with the intervening-if kept apart', () => {
    expect(parseLifeThresholdTriggers(OPAL)).toEqual([expect.objectContaining({ threshold: 10, comparison: 'at_most', interveningIf: 'if Opal Avenger is an enchantment', effect: 'it becomes a 3/5 Soldier creature' })]);
    expect(parseLifeThresholdTriggers("You don't lose the game for having 0 or less life. When you have 20 or more life, you lose the game.")[0]).toMatchObject({ threshold: 20, comparison: 'at_least', effect: 'you lose the game' });
  });

  it('fires at 10 or less life, not above, and not again while on the stack', () => {
    expect(queueLifeThresholdStateTriggers(ctxWith(11))).toHaveLength(0);
    const ctx = ctxWith(10);
    const q = queueLifeThresholdStateTriggers(ctx);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ triggerType: 'life_threshold', effect: 'it becomes a 3/5 Soldier creature' });
    expect(String(q[0].description)).toMatch(/if Opal Avenger is an enchantment/);
    expect(queueLifeThresholdStateTriggers(ctx)).toHaveLength(0);
  });

  it('checks the intervening-if', () => {
    expect(queueLifeThresholdStateTriggers(ctxWith(5, 'Creature \u2014 Soldier'))).toHaveLength(0);
  });
});
