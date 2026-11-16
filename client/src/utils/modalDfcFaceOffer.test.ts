import { describe, expect, it } from 'vitest';
import { landPlayTimingBlockReason } from './landPlayTiming';
import { modalDfcOfferedFaceIndexes } from './modalDfcFaceOffer';

const SINK_FACES = [{ type_line: 'Instant' }, { type_line: 'Land' }];

describe('modal DFC faces while responding', () => {
  it('omits the land face when a land cannot be played', () => {
    expect(modalDfcOfferedFaceIndexes(SINK_FACES, false)).toEqual([0]);
  });

  it('offers both faces during a legal land-play window', () => {
    expect(modalDfcOfferedFaceIndexes(SINK_FACES, true)).toEqual([0, 1]);
  });

  it('blocks a land play while spells are on the stack, even in your main phase', () => {
    expect(landPlayTimingBlockReason({
      you: 'A2',
      turnPlayer: 'A2',
      phase: 'precombatMain',
      stackCount: 1,
      landsPlayedThisTurn: 0,
      maxLandsPerTurn: 1,
    })).toMatch(/stack/i);
  });

  it('blocks a land play on an opponent\'s turn', () => {
    expect(landPlayTimingBlockReason({
      you: 'A2',
      turnPlayer: 'King2',
      phase: 'precombatMain',
      stackCount: 3,
      landsPlayedThisTurn: 0,
      maxLandsPerTurn: 1,
    })).toBe('Not your turn');
  });
});
