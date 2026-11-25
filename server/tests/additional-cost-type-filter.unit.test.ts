import { describe, expect, it } from 'vitest';

import {
  normalizeAdditionalCostTypeFilter,
  parseSacrificeAdditionalCostFilter,
  typeLineMatchesAdditionalCostFilter,
} from '../src/socket/additionalCostTypeFilter.js';
import { detectAdditionalCost } from '../src/socket/land-helpers.js';

describe('additional cost type filter', () => {
  it('matches artifact or creature as a disjunction', () => {
    expect(typeLineMatchesAdditionalCostFilter('Artifact', 'artifact or creature')).toBe(true);
    expect(typeLineMatchesAdditionalCostFilter('Creature - Bear', 'artifact or creature')).toBe(true);
    expect(typeLineMatchesAdditionalCostFilter('Enchantment', 'artifact or creature')).toBe(false);
  });

  it('treats nonland as any non-land permanent', () => {
    expect(typeLineMatchesAdditionalCostFilter('Creature - Human', 'nonland')).toBe(true);
    expect(typeLineMatchesAdditionalCostFilter('Artifact Creature - Construct', 'nonland')).toBe(true);
    expect(typeLineMatchesAdditionalCostFilter('Land', 'nonland')).toBe(false);
    expect(typeLineMatchesAdditionalCostFilter('Land Creature - Elemental', 'nonland')).toBe(false);
  });

  it('strips "or pay N life" from the type filter', () => {
    expect(normalizeAdditionalCostTypeFilter('creature or pay 4 life')).toBe('creature');
    expect(parseSacrificeAdditionalCostFilter('creature or pay 4 life')).toEqual({
      filter: 'creature',
      orPayLife: 4,
    });
    expect(typeLineMatchesAdditionalCostFilter('Creature - Zombie', 'creature or pay')).toBe(true);
    expect(typeLineMatchesAdditionalCostFilter('Artifact', 'creature or pay 1 life')).toBe(false);
  });

  it('parses Deadly Dispute, Rite of Oblivion, and Morkrut Behemoth additional costs', () => {
    const dispute = detectAdditionalCost('As an additional cost to cast this spell, sacrifice an artifact or creature.');
    expect(dispute).toMatchObject({ type: 'sacrifice', amount: 1, filter: 'artifact or creature' });
    expect(typeLineMatchesAdditionalCostFilter('Artifact - Treasure', dispute?.filter)).toBe(true);

    const rite = detectAdditionalCost('As an additional cost to cast this spell, sacrifice a nonland permanent.');
    expect(rite).toMatchObject({ type: 'sacrifice', amount: 1, filter: 'nonland' });
    expect(typeLineMatchesAdditionalCostFilter('Enchantment', rite?.filter)).toBe(true);
    expect(typeLineMatchesAdditionalCostFilter('Basic Land - Forest', rite?.filter)).toBe(false);

    const behemoth = detectAdditionalCost('As an additional cost to cast this spell, sacrifice a creature or pay {1}.');
    expect(behemoth?.type).toBe('sacrifice');
    expect(behemoth?.filter).toBe('creature');
    expect(behemoth?.orPayMana).toBe('{1}');
    expect(behemoth?.filter).not.toContain('pay');
  });

  it('detects pay X life as a pay_life additional cost', () => {
    const hatred = detectAdditionalCost('As an additional cost to cast this spell, pay X life.\nTarget creature gets +X/+0 until end of turn.');
    expect(hatred).toMatchObject({ type: 'pay_life', payLifeIsX: true });
  });
});
