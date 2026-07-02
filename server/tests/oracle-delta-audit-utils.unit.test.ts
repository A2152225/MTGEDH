import { describe, expect, it } from 'vitest';

import {
  buildOracleDeltaBaseline,
  computeOracleDelta,
  hashOracleIdentity,
  oracleIdForCard,
  suggestDeltaGapAction,
} from '../scripts/oracleDeltaAuditUtils.ts';

describe('oracle delta audit utils (D1)', () => {
  it('hashes name + oracle text stably and detects changes', () => {
    const a = hashOracleIdentity('Lightning Bolt', 'Lightning Bolt deals 3 damage to any target.');
    const b = hashOracleIdentity('Lightning Bolt', 'Lightning Bolt deals 3 damage to any target.');
    const c = hashOracleIdentity('Lightning Bolt', 'Lightning Bolt deals 4 damage to any target.');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('prefers oracle_id, then id, then name for identity', () => {
    expect(oracleIdForCard({ oracle_id: 'o1', id: 'i1', name: 'N' })).toBe('o1');
    expect(oracleIdForCard({ id: 'i1', name: 'N' })).toBe('i1');
    expect(oracleIdForCard({ name: 'N' })).toBe('N');
  });

  it('computes new / changed / unchanged partitions against a baseline', () => {
    const baseline = buildOracleDeltaBaseline([
      { oracleId: 'a', name: 'A', hash: 'hash-a' },
      { oracleId: 'b', name: 'B', hash: 'hash-b' },
    ]);
    const delta = computeOracleDelta(
      [
        { oracleId: 'a', name: 'A', hash: 'hash-a' }, // unchanged
        { oracleId: 'b', name: 'B', hash: 'hash-b2' }, // changed oracle text
        { oracleId: 'c', name: 'C', hash: 'hash-c' }, // new card
      ],
      baseline,
    );
    expect(delta.unchangedCount).toBe(1);
    expect(delta.changedCards.map((entry) => entry.oracleId)).toEqual(['b']);
    expect(delta.newCards.map((entry) => entry.oracleId)).toEqual(['c']);
  });

  it('builds a baseline with meta counts', () => {
    const baseline = buildOracleDeltaBaseline([
      { oracleId: 'a', name: 'A', hash: 'h1' },
      { oracleId: 'b', name: 'B', hash: 'h2' },
    ]);
    expect(baseline.meta.cardCount).toBe(2);
    expect(baseline.cards).toEqual({ a: 'h1', b: 'h2' });
  });

  it('suggests overlay-first actions per gap reason (§C decision tree)', () => {
    expect(suggestDeltaGapAction(['trigger_not_detected'])).toContain('trigger detectors');
    expect(suggestDeltaGapAction(['full_card_ir_gap'])).toContain('compile overlay');
    expect(suggestDeltaGapAction(['trigger_effect_ir_gap'])).toContain('compile overlay');
    expect(suggestDeltaGapAction(['full_card_parse_to_execute'])).toContain('probe');
    // Detector gaps outrank overlay work — an overlay cannot make a trigger fire.
    expect(suggestDeltaGapAction(['full_card_ir_gap', 'trigger_not_detected'])).toContain(
      'trigger detectors',
    );
  });
});
