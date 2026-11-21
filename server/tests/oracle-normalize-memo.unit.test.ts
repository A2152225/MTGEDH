import { describe, expect, it } from 'vitest';

import { memoOracleNormalize } from '../src/state/modules/oracleNormalizeMemo.js';
import { normalizeB110Oracle } from '../src/state/modules/batch110Parsers.js';
import { normalizeBatch111Oracle } from '../src/state/modules/batch111Parsers.js';
import { normalizeBatch112Oracle } from '../src/state/modules/batch112Parsers.js';

describe('memoOracleNormalize', () => {
  it('computes once per (cache, card name, text) and keeps names and caches apart', () => {
    let calls = 0;
    const compute = (label: string) => () => {
      calls += 1;
      return label;
    };
    expect(memoOracleNormalize('memo-test-a', 'Flying', 'Bird', compute('a-bird'))).toBe('a-bird');
    expect(memoOracleNormalize('memo-test-a', 'Flying', 'Bird', compute('never'))).toBe('a-bird');
    expect(calls).toBe(1);
    expect(memoOracleNormalize('memo-test-a', 'Flying', 'Bat', compute('a-bat'))).toBe('a-bat');
    expect(memoOracleNormalize('memo-test-a', 'Flying', undefined, compute('a-none'))).toBe('a-none');
    expect(memoOracleNormalize('memo-test-b', 'Flying', 'Bird', compute('b-bird'))).toBe('b-bird');
    expect(calls).toBe(4);
  });

  it('does not cache non-string input', () => {
    let calls = 0;
    const compute = () => {
      calls += 1;
      return 'x';
    };
    memoOracleNormalize('memo-test-c', undefined, undefined, compute);
    memoOracleNormalize('memo-test-c', undefined, undefined, compute);
    memoOracleNormalize('memo-test-c', 'text', null, compute);
    memoOracleNormalize('memo-test-c', 'text', null, compute);
    expect(calls).toBe(4);
  });

  it('gives the batch normalisers the same output on a repeat call, per card name', () => {
    // Oracle (oracle-cards.jsonl) for Cryptolith Rite.
    const oracle = 'Creatures you control have "{T}: Add one mana of any color."';
    const first112 = normalizeBatch112Oracle(oracle, 'Cryptolith Rite');
    expect(first112).toBe('creatures you control have "{t}: add one mana of any color."');
    expect(normalizeBatch112Oracle(oracle, 'Cryptolith Rite')).toBe(first112);

    const named = 'Admiral Brass gets +1/+1. This creature has haste.';
    expect(normalizeBatch111Oracle(named, 'Admiral Brass, Unsinkable')).toBe('~ gets +1/+1. ~ has haste');
    expect(normalizeBatch111Oracle(named, 'Admiral Brass, Unsinkable')).toBe('~ gets +1/+1. ~ has haste');
    expect(normalizeBatch111Oracle(named, 'Someone Else')).toBe('admiral brass gets +1/+1. ~ has haste');

    expect(normalizeB110Oracle('Landfall — Whenever  a land enters')).toBe('Whenever a land enters');
    expect(normalizeB110Oracle('Landfall — Whenever  a land enters')).toBe('Whenever a land enters');
  });
});
