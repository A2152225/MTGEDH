import { describe, expect, it } from 'vitest';
import { getPermanentCombatStats } from '../src/socket/ai-handlers/aiPermanentCombatStats.js';

function creature(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, controller: 'p1', owner: 'p1', tapped: false, counters: {},
    card: { id: `${id}_c`, name: id, type_line: 'Creature - Bear', oracle_text: '', power: '2', toughness: '2' },
    ...extra,
  };
}

describe('AI combat stats read current power/toughness', () => {
  it('without a state keeps printed/base values', () => {
    expect(getPermanentCombatStats(creature('a'))).toEqual({ power: 2, toughness: 2 });
  });

  it('with a state, a battlefield permanent reflects +1/+1 counters and anthems', () => {
    const lord = {
      id: 'lord', controller: 'p1', owner: 'p1', tapped: false, counters: {},
      card: { id: 'lord_c', name: 'Glorious Anthem', type_line: 'Enchantment', oracle_text: 'Creatures you control get +1/+1.' },
    };
    const bear = creature('bear', { counters: { '+1/+1': 2 } });
    const state: any = { battlefield: [bear, lord], players: [{ id: 'p1' }], zones: {}, stack: [] };
    const stats = getPermanentCombatStats(bear, state);
    expect(stats.power).toBe(5);
    expect(stats.toughness).toBe(5);
    // Not on the battlefield: printed values only.
    expect(getPermanentCombatStats(creature('ghost'), state)).toEqual({ power: 2, toughness: 2 });
  });
});