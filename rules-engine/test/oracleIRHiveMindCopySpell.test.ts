import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const HIVE_MIND_ORACLE =
  'Whenever a player casts an instant or sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy.';

const HIVE_MIND_EFFECT =
  'each other player copies that spell. Each of those players may choose new targets for their copy.';

function collectCopySpellSteps(oracleText: string, sourceName: string) {
  return parseOracleTextToIR(oracleText, sourceName)
    .abilities
    .flatMap((ability) => ability.steps || [])
    .filter((step): step is Extract<typeof step, { kind: 'copy_spell' }> => step.kind === 'copy_spell');
}

describe('Hive Mind copy_spell parse', () => {
  it('parses each other player copies that spell with retarget', () => {
    const copies = collectCopySpellSteps(HIVE_MIND_ORACLE, 'Hive Mind');
    expect(copies).toHaveLength(1);
    expect(copies[0]?.subject).toBe('target_spell');
    expect(copies[0]?.who).toEqual({ kind: 'each_opponent' });
    expect(copies[0]?.allowNewTargets).toBe(true);
    expect(copies[0]?.optional).toBeUndefined();
  });

  it('parses the isolated trigger effect clause the same way', () => {
    const copies = collectCopySpellSteps(HIVE_MIND_EFFECT, 'Hive Mind');
    expect(copies).toHaveLength(1);
    expect(copies[0]?.who).toEqual({ kind: 'each_opponent' });
    expect(copies[0]?.allowNewTargets).toBe(true);
  });
});
