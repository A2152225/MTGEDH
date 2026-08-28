import { describe, expect, it } from 'vitest';
import { detectCombatDamageTriggers } from '../src/state/modules/triggered-abilities.js';

describe('non-[type] creatures combat damage detection', () => {
  const permanent = { id: 'bf-src' };

  it('keeps the Human trigger-type alias and stamps requiredTypePhrase', () => {
    const triggers = detectCombatDamageTriggers(
      {
        name: 'Keeper of Fables',
        oracle_text: 'Whenever one or more non-Human creatures you control deal combat damage to a player, draw a card.',
      },
      permanent,
    );
    const found = triggers.find((t) => t.triggerType === 'non_human_creatures_combat_damage_to_player');
    expect(found).toBeTruthy();
    expect(String((found as { requiredTypePhrase?: string }).requiredTypePhrase || '')).toMatch(/human/i);
  });

  it('uses the generic trigger type for other creature types', () => {
    const triggers = detectCombatDamageTriggers(
      {
        name: 'Typed Fables',
        oracle_text: 'Whenever one or more non-Dragon creatures you control deal combat damage to a player, draw a card.',
      },
      permanent,
    );
    const found = triggers.find((t) => t.triggerType === 'non_type_creatures_combat_damage_to_player');
    expect(found).toBeTruthy();
    expect(String((found as { requiredTypePhrase?: string }).requiredTypePhrase || '')).toMatch(/dragon/i);
  });

  it('keeps the Assassin trigger-type alias', () => {
    const triggers = detectCombatDamageTriggers(
      {
        name: 'Etrata, Deadly Fugitive',
        oracle_text: "Whenever an Assassin you control deals combat damage to an opponent, cloak the top card of that player's library.",
      },
      permanent,
    );
    const found = triggers.find((t) => t.triggerType === 'assassin_combat_damage_to_opponent');
    expect(found).toBeTruthy();
    expect(String((found as { requiredTypePhrase?: string }).requiredTypePhrase || '')).toMatch(/assassin/i);
  });

  it('keeps the Sliver trigger-type alias', () => {
    const triggers = detectCombatDamageTriggers(
      {
        name: 'Toxin Sliver',
        oracle_text: 'Whenever a Sliver deals combat damage to a creature, destroy that creature.',
      },
      permanent,
    );
    const found = triggers.find((t) => t.triggerType === 'sliver_combat_damage_to_creature');
    expect(found).toBeTruthy();
    expect(String((found as { requiredTypePhrase?: string }).requiredTypePhrase || '')).toMatch(/sliver/i);
  });
});
