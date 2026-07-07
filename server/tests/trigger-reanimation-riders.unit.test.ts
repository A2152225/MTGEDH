import { describe, expect, it } from 'vitest';

import { applyPermanentKeywordGrantFromText } from '../src/state/modules/triggerReanimationRiders.js';

const AGENT_ORACLE =
  'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn."';

describe('triggerReanimationRiders keyword grants', () => {
  it('does not self-grant keywords from commander-grant background oracle text', () => {
    const background = {
      id: 'bg_1',
      grantedAbilities: [] as string[],
      card: {
        name: 'Agent of the Shadow Thieves',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: AGENT_ORACLE,
      },
    };

    const applied = applyPermanentKeywordGrantFromText(
      background,
      'Agent of the Shadow Thieves',
      AGENT_ORACLE,
    );

    expect(applied).toBe(false);
    expect(background.grantedAbilities).toEqual([]);
  });
});
