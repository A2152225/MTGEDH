import { describe, expect, it } from 'vitest';

import {
  matchesTriggeredBattlefieldTarget,
  PERMANENT_TRIGGER_TARGET_TYPES,
} from '../src/state/modules/triggeredAbilityBattlefieldTargetMatch.js';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';

describe('compound / up-to on-cast battlefield target matching', () => {
  it('registers World Breaker compound type as a battlefield target type', () => {
    expect(PERMANENT_TRIGGER_TARGET_TYPES.has('artifact, enchantment, or land')).toBe(true);
  });

  it('matches artifact, enchantment, or land (not creature-only)', () => {
    expect(matchesTriggeredBattlefieldTarget('artifact, enchantment, or land', 'Artifact')).toBe(true);
    expect(matchesTriggeredBattlefieldTarget('artifact, enchantment, or land', 'Enchantment')).toBe(true);
    expect(matchesTriggeredBattlefieldTarget('artifact, enchantment, or land', 'Basic Land — Forest')).toBe(true);
    expect(matchesTriggeredBattlefieldTarget('artifact, enchantment, or land', 'Creature — Eldrazi')).toBe(false);
  });

  it('filters colorless permanents when one-or-more-colors is required', () => {
    const colored = {
      colors: ['U'],
      card: { type_line: 'Creature — Merfolk', colors: ['U'] },
    };
    const colorless = {
      colors: [],
      card: { type_line: 'Creature — Eldrazi', colors: [] },
    };
    expect(
      matchesTriggeredBattlefieldTarget(
        'permanent',
        'Creature — Merfolk',
        { targetFilterRequiresOneOrMoreColors: true },
        colored,
      ),
    ).toBe(true);
    expect(
      matchesTriggeredBattlefieldTarget(
        'permanent',
        'Creature — Eldrazi',
        { targetFilterRequiresOneOrMoreColors: true },
        colorless,
      ),
    ).toBe(false);
  });

  it('infers Elder Deep-Fiend tap up-to-four metadata', () => {
    const metadata = inferTriggeredAbilityTargetMetadata(
      'When you cast this spell, tap up to four target permanents.',
    );
    expect(metadata.minTargets).toBe(0);
    expect(metadata.maxTargets).toBe(4);
    expect(metadata.targetType).toBe('permanent');
  });
});
