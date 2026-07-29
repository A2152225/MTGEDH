import { describe, expect, it } from 'vitest';
import {
  buildNoUntilTargetsChangeValue,
  fingerprintArtifactEnchantmentTargets,
  parseNoUntilTargetsChangeFingerprint,
  resolveNoUntilTargetsChangePreference,
  supportsNoUntilTargetsChangePreference,
} from '../../shared/src/mayAutoPreference.js';

describe('mayAutoPreference no-until-targets', () => {
  it('detects Aura Shards-style destroy may text', () => {
    expect(supportsNoUntilTargetsChangePreference(
      'you may destroy target artifact or enchantment.',
    )).toBe(true);
    expect(supportsNoUntilTargetsChangePreference('you may gain 1 life')).toBe(false);
  });

  it('fingerprints artifact and enchantment ids stably', () => {
    const battlefield = [
      { id: 'b', card: { type_line: 'Artifact' } },
      { id: 'a', card: { type_line: 'Enchantment' } },
      { id: 'c', card: { type_line: 'Creature' } },
    ];
    expect(fingerprintArtifactEnchantmentTargets(battlefield)).toBe('a,b');
  });

  it('auto-nos while fingerprint matches and clears when it changes', () => {
    const state: any = {
      battlefield: [
        { id: 'aura', card: { type_line: 'Enchantment' } },
        { id: 'ring', card: { type_line: 'Artifact' } },
      ],
      mayAutoPreferences: {
        p1: {
          'aura shards:you may destroy target artifact or enchantment':
            buildNoUntilTargetsChangeValue('aura,ring'),
        },
      },
    };

    expect(resolveNoUntilTargetsChangePreference(
      state,
      'p1',
      'aura shards:you may destroy target artifact or enchantment',
      state.mayAutoPreferences.p1['aura shards:you may destroy target artifact or enchantment'],
      'you may destroy target artifact or enchantment.',
    )).toBe('no');

    state.battlefield.push({ id: 'signet', card: { type_line: 'Artifact' } });
    expect(resolveNoUntilTargetsChangePreference(
      state,
      'p1',
      'aura shards:you may destroy target artifact or enchantment',
      state.mayAutoPreferences.p1['aura shards:you may destroy target artifact or enchantment'],
      'you may destroy target artifact or enchantment.',
    )).toBeUndefined();
    expect(state.mayAutoPreferences.p1['aura shards:you may destroy target artifact or enchantment'])
      .toBeUndefined();
  });

  it('round-trips stored preference strings', () => {
    const stored = buildNoUntilTargetsChangeValue('a,b');
    expect(parseNoUntilTargetsChangeFingerprint(stored)).toBe('a,b');
  });
});
