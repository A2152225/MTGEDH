import { describe, expect, it } from 'vitest';

import { getLandwalkUnblockableReason, permanentHasLandwalk, playerControlsLandWithSubtype } from '../../shared/src/combatLandwalk.js';

describe('landwalk combat blocking', () => {
  const chatterfang = {
    id: 'chatterfang_1',
    controller: 'p2',
    card: {
      name: 'Chatterfang, Squirrel General',
      type_line: 'Legendary Creature — Squirrel Warrior',
      oracle_text:
        "Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)\n"
        + 'If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.',
      keywords: ['Forestwalk'],
    },
  };

  it('detects forestwalk on Chatterfang', () => {
    expect(permanentHasLandwalk(chatterfang, 'forestwalk')).toBe(true);
  });

  it('makes forestwalk attackers unblockable when the defending player controls a Forest', () => {
    const battlefield = [
      chatterfang,
      {
        id: 'forest_1',
        controller: 'p1',
        card: { name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];

    expect(playerControlsLandWithSubtype(battlefield, 'p1', 'forest')).toBe(true);
    expect(getLandwalkUnblockableReason(chatterfang, 'p1', battlefield)).toContain('forestwalk');
  });

  it('allows blocking when the defending player controls no matching land', () => {
    const battlefield = [
      chatterfang,
      {
        id: 'island_1',
        controller: 'p1',
        card: { name: 'Island', type_line: 'Basic Land — Island' },
      },
    ];

    expect(getLandwalkUnblockableReason(chatterfang, 'p1', battlefield)).toBeUndefined();
  });
});
