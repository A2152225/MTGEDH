import { describe, expect, it, vi } from 'vitest';

import { processEquippedAttackRevealUntilLandPumps } from '../src/state/modules/equippedAttackRevealPump.js';

describe('processEquippedAttackRevealUntilLandPumps', () => {
  const trepanationOracle =
    'Whenever equipped creature attacks, defending player reveals cards from the top of their library until they reveal a land card. The creature gets +1/+0 until end of turn for each card revealed this way. That player puts the revealed cards into their graveyard.';

  it('mills the defender and stores total pump on matching equipment', () => {
    const creature = { id: 'attacker_1', controller: 'p1' };
    const blade = {
      id: 'blade_1',
      controller: 'p1',
      attachedTo: 'attacker_1',
      card: {
        name: 'Trepanation Blade',
        type_line: 'Artifact — Equipment',
        oracle_text: trepanationOracle,
      },
    };
    const battlefield = [creature, blade];
    const millUntilLand = vi.fn(() => ({
      milled: [{ name: 'Shock' }, { name: 'Bolt' }, { name: 'Island' }],
      landHit: { name: 'Island' },
    }));

    const results = processEquippedAttackRevealUntilLandPumps(
      { state: {} },
      [{ creatureId: 'attacker_1', defendingPlayerId: 'p2' }],
      battlefield,
      millUntilLand,
    );

    expect(millUntilLand).toHaveBeenCalledWith({ state: {} }, 'p2');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      equipmentName: 'Trepanation Blade',
      defendingPlayerId: 'p2',
      revealedCount: 3,
      totalPump: 3,
      landHitName: 'Island',
    });
    expect(blade.trepanationBonus).toBe(3);
    expect(blade.lastTrepanationBonus).toBe(3);
  });

  it('ignores equipment without the reveal-until-land attack pattern', () => {
    const creature = { id: 'attacker_1', controller: 'p1' };
    const sword = {
      id: 'sword_1',
      controller: 'p1',
      attachedTo: 'attacker_1',
      card: {
        name: 'Bonesplitter',
        type_line: 'Artifact — Equipment',
        oracle_text: 'Equipped creature gets +2/+0.',
      },
    };
    const millUntilLand = vi.fn(() => ({ milled: [], landHit: undefined }));

    const results = processEquippedAttackRevealUntilLandPumps(
      { state: {} },
      [{ creatureId: 'attacker_1', defendingPlayerId: 'p2' }],
      [creature, sword],
      millUntilLand,
    );

    expect(results).toEqual([]);
    expect(millUntilLand).not.toHaveBeenCalled();
  });
});
