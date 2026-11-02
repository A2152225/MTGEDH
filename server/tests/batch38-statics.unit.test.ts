import { describe, it, expect } from 'vitest';
import { parseEquipAbilitiesFromOracle } from '../../shared/src/equipAbilities.js';
import { getMaximumBlockers } from '../src/socket/combat-handlers/combatBatch30BlockLimits.js';
import { bannedCounterKinds, filterRestrictedCounterDeltas } from '../src/state/modules/counterPlacementRestrictions.js';

const TROLL = { id: 'troll', controller: 'p1', card: { name: 'Challenger Troll', type_line: 'Creature - Troll', power: '6', oracle_text: "Each creature you control with power 4 or greater can't be blocked by more than one creature." } };
const bear = (id: string, power: string, controller = 'p1') => ({ id, controller, counters: {}, card: { name: 'Bear', type_line: 'Creature - Bear', power, oracle_text: '' } });

describe('batch 38 statics', () => {
  it('Challenger Troll caps blockers only for its controller\'s creatures with power 4+', () => {
    const big = bear('big', '4');
    const small = bear('small', '2');
    const grown = { ...bear('grown', '3'), counters: { '+1/+1': 1 } };
    const foe = bear('foe', '5', 'p2');
    const bf = [TROLL, big, small, grown, foe];
    expect(getMaximumBlockers(big, bf)).toBe(1);
    expect(getMaximumBlockers(grown, bf)).toBe(1);
    expect(getMaximumBlockers(TROLL, bf)).toBe(1);
    expect(getMaximumBlockers(small, bf)).toBe(Infinity);
    expect(getMaximumBlockers(foe, bf)).toBe(Infinity);
  });

  it('Melira-style team ban stops -1/-1 counters on your creatures only', () => {
    const melira = { id: 'mel', controller: 'p1', card: { name: 'Melira, Sylvok Outcast', type_line: 'Legendary Creature - Human Scout', oracle_text: "You can't get poison counters.\nCreatures you control can't have -1/-1 counters put on them.\nCreatures your opponents control lose infect." } };
    const mine = bear('m', '2');
    const theirs = bear('t', '2', 'p2');
    const state = { battlefield: [melira, mine, theirs] };
    expect(bannedCounterKinds(state, mine)).toContain('-1/-1');
    expect(filterRestrictedCounterDeltas(state, mine, { '-1/-1': 2, '+1/+1': 1 })).toEqual({ '+1/+1': 1 });
    expect(filterRestrictedCounterDeltas(state, theirs, { '-1/-1': 2 })).toEqual({ '-1/-1': 2 });
  });

  it('parses Equip\u2014Sacrifice a creature (Dissection Tools)', () => {
    const parsed = parseEquipAbilitiesFromOracle('Equipped creature gets +5/+5 and has deathtouch and lifelink.\nEquip\u2014Sacrifice a creature.');
    expect(parsed.map((p: any) => p.cost)).toContain('Sacrifice a creature');
  });
});
