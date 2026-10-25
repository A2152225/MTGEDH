import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';
import { calculateDevotion as calcEffects } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsBattlefieldQueries.js';
import { calculateDevotion as calcTriggers } from '../src/state/modules/triggers/devotion.js';
import { calculateDevotion as calcMana } from '../src/state/modules/mana-abilities.js';
import { calculateDevotion as calcCounters } from '../src/state/modules/counters_tokens.js';

const battlefield = [
  { id: 'a', controller: 'p1', owner: 'p1', card: { name: 'A', type_line: 'Creature', mana_cost: '{U}{U/B}{2/U}{U/P}' } },
  { id: 'b', controller: 'p1', owner: 'p1', card: { name: 'B', type_line: 'Enchantment', mana_cost: '{W}{B}{W/B}' } },
  { id: 'c', controller: 'p1', owner: 'p1', phasedOut: true, card: { name: 'C', type_line: 'Creature', mana_cost: '{U}{U}{U}' } },
  { id: 'd', controller: 'p2', owner: 'p2', card: { name: 'D', type_line: 'Creature', mana_cost: '{U}{U}' } },
];
const ctx: any = { state: { battlefield, players: [{ id: 'p1' }, { id: 'p2' }] } };

describe('server devotion helpers share one generic count', () => {
  it('all calculateDevotion copies agree (hybrid/Phyrexian once, phased-out ignored)', () => {
    expect(calcEffects(ctx, 'p1', 'U')).toBe(4);
    expect(calcTriggers(ctx.state, 'p1', 'U')).toBe(4);
    expect(calcMana(ctx.state, 'p1', 'U')).toBe(4);
    expect(calcCounters(ctx, 'p1' as any, 'U')).toBe(4);
  });

  it('intervening-if devotion thresholds are generic; {W/B} counts once', () => {
    // white and black: {U/B}, {W}, {B}, {W/B} = 4
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if your devotion to white and black is four or greater', { id: 'b' } as any)).toBe(true);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if your devotion to white and black is seven or greater', { id: 'b' } as any)).toBe(false);
    expect(evaluateInterveningIfClause(ctx, 'p1', 'if your devotion to blue is less than five', { id: 'b' } as any)).toBe(true);
  });
});
