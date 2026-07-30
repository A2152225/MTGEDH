import { describe, expect, it } from 'vitest';

import {
  resolveIncomingStateSeq,
  shouldAcceptStateSequence,
} from '../src/hooks/useGameSocket';

describe('client state sequence gating', () => {
  it('resolves seq from top-level state payloads', () => {
    expect(resolveIncomingStateSeq({ gameId: 'g1', view: {}, seq: 12 })).toBe(12);
  });

  it('resolves seq from stateDiff.diff.seq', () => {
    expect(
      resolveIncomingStateSeq({
        gameId: 'g1',
        diff: { full: { battlefield: [] }, seq: 44 },
      }),
    ).toBe(44);
  });

  it('rejects older sequences and accepts equal or newer', () => {
    expect(shouldAcceptStateSequence(10, 9)).toBe(false);
    expect(shouldAcceptStateSequence(10, 10)).toBe(true);
    expect(shouldAcceptStateSequence(10, 11)).toBe(true);
  });

  it('fails open when sequence metadata is missing', () => {
    expect(shouldAcceptStateSequence(10, null)).toBe(true);
    expect(shouldAcceptStateSequence(null, 5)).toBe(true);
    expect(resolveIncomingStateSeq({ gameId: 'g1', view: {} })).toBeNull();
  });
});
