import { describe, expect, it } from 'vitest';

import {
  BATTLEFIELD_KEYWORD_BADGES,
  collectBattlefieldAbilityBadgesForView,
  isCommanderGrantBackgroundOracle,
} from '../src/state/modules/battlefieldAbilityBadges.js';

const AGENT_ORACLE =
  'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn."';

describe('battlefieldAbilityBadges', () => {
  it('detects commander-grant background oracle', () => {
    expect(isCommanderGrantBackgroundOracle(AGENT_ORACLE)).toBe(true);
  });

  it('strips keyword badges from Agent of the Shadow Thieves even when grantedAbilities are wrong', () => {
    const background = {
      id: 'bg_1',
      controller: 'p1',
      grantedAbilities: ['deathtouch', 'indestructible'],
      card: {
        name: 'Agent of the Shadow Thieves',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: AGENT_ORACLE,
      },
    };

    expect(collectBattlefieldAbilityBadgesForView(background as any, [])).toEqual([]);
  });

  it('shows commander temporary keyword badges until EOT', () => {
    const commander = {
      id: 'cmd_1',
      controller: 'p1',
      grantedAbilities: ['deathtouch', 'indestructible'],
      temporaryAbilities: [
        { ability: 'deathtouch', expiresAt: 'end_of_turn', source: 'Commander' },
        { ability: 'indestructible', expiresAt: 'end_of_turn', source: 'Commander' },
      ],
      card: {
        name: 'Test Commander',
        type_line: 'Legendary Creature — Human Rogue',
      },
    };

    const badges = collectBattlefieldAbilityBadgesForView(commander as any, []);
    expect(badges).toEqual(expect.arrayContaining(['deathtouch', 'indestructible']));
    for (const badge of badges) {
      expect(BATTLEFIELD_KEYWORD_BADGES.has(badge)).toBe(true);
    }
  });

  it('shows keyword counters as the abilities they grant', () => {
    const bear = {
      id: 'bear',
      controller: 'p1',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      counters: { flying: 1, trample: 1, 'double strike': 1, charge: 2 },
    };
    const badges = collectBattlefieldAbilityBadgesForView(bear as any, [], [bear]);
    expect(badges).toEqual(expect.arrayContaining(['flying', 'trample', 'double strike']));
    expect(badges).not.toContain('charge');
  });
});
