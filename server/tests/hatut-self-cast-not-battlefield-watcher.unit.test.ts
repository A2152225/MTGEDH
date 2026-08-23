import { describe, expect, it } from 'vitest';

import { resolveOnCastSpellTriggerDescriptions } from '../src/state/modules/onCastSpellTriggerUtils.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { processSpellCastTriggersForCast } from '../src/socket/game-actions.js';

const HATUT_ORACLE =
  "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.\n"
  + 'When this creature enters, destroy up to one target artifact or enchantment.';

describe('G1 Hatut self-cast must not watch later casts', () => {
  it('detectSpellCastTriggers ignores Hatut When-you-cast-this-spell on a battlefield permanent', () => {
    const triggers = detectSpellCastTriggers(
      {
        name: 'Hatut Zeraze Strike Force',
        type_line: 'Creature — Human Warrior',
        oracle_text: HATUT_ORACLE,
      },
      { id: 'perm_hatut_1', controller: 'p1' },
    );

    expect(triggers.filter((t) => /when you cast this spell/i.test(String(t.description || '')))).toHaveLength(0);
    expect(triggers.some((t) => /copy it for each time/i.test(String(t.effect || '')))).toBe(false);
  });

  it('still exposes Hatut on-cast via resolveOnCastSpellTriggerDescriptions when the spell is cast', () => {
    const onCast = resolveOnCastSpellTriggerDescriptions({
      name: 'Hatut Zeraze Strike Force',
      type_line: 'Creature — Human Warrior',
      oracle_text: HATUT_ORACLE,
    });

    expect(onCast.length).toBeGreaterThan(0);
    expect(onCast.some((t) => /copy it for each time/i.test(String(t.effect || t.description || '')))).toBe(true);
  });

  it('processSpellCastTriggersForCast does not push Hatut triggers when Beast Within is cast', () => {
    const game: any = {
      seq: 1,
      state: {
        battlefield: [
          {
            id: 'perm_hatut_a',
            controller: 'p1',
            card: {
              id: 'hatut_a',
              name: 'Hatut Zeraze Strike Force',
              type_line: 'Creature — Human Warrior',
              oracle_text: HATUT_ORACLE,
            },
          },
          {
            id: 'perm_hatut_b',
            controller: 'p1',
            card: {
              id: 'hatut_b',
              name: 'Hatut Zeraze Strike Force',
              type_line: 'Creature — Human Warrior',
              oracle_text: HATUT_ORACLE,
            },
          },
          {
            id: 'perm_hatut_c',
            controller: 'p1',
            card: {
              id: 'hatut_c',
              name: 'Hatut Zeraze Strike Force',
              type_line: 'Creature — Human Warrior',
              oracle_text: HATUT_ORACLE,
            },
          },
        ],
        stack: [
          {
            id: 'stack_beast',
            type: 'spell',
            controller: 'p1',
            card: {
              id: 'beast_1',
              name: 'Beast Within',
              type_line: 'Instant',
              oracle_text: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
            },
          },
        ],
      },
      bumpSeq: () => {},
    };

    const io: any = { to: () => ({ emit: () => {} }) };

    processSpellCastTriggersForCast(
      'game_g1_hatut_beast',
      game,
      io,
      'p1',
      {
        id: 'beast_1',
        name: 'Beast Within',
        type_line: 'Instant',
        oracle_text: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
      },
      'hand',
      'stack_beast',
    );

    const hatutStackTriggers = (game.state.stack || []).filter(
      (item: any) =>
        item?.type === 'triggered_ability'
        && /Hatut/i.test(String(item?.sourceName || item?.card?.name || ''))
        && /when you cast this spell/i.test(String(item?.description || '')),
    );
    expect(hatutStackTriggers).toHaveLength(0);
    expect((game.state.stack || []).filter((item: any) => item?.type === 'triggered_ability')).toHaveLength(0);
  });
});
