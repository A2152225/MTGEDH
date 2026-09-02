import { describe, expect, it } from 'vitest';

import { bottomOrderIdsFromPeekConfirm } from '../src/utils/bottomOrderConfirm';

describe('bottomOrderIdsFromPeekConfirm', () => {
  it('prefers the bottom-order list', () => {
    expect(bottomOrderIdsFromPeekConfirm({
      keepTopOrder: ['keep-a'],
      bottomOrder: ['bottom-a', 'bottom-b'],
    })).toEqual(['bottom-a', 'bottom-b']);
  });

  it('falls back to keepTopOrder when bottomOrder is empty', () => {
    expect(bottomOrderIdsFromPeekConfirm({
      keepTopOrder: ['keep-a', 'keep-b'],
      bottomOrder: [],
    })).toEqual(['keep-a', 'keep-b']);
  });
});
