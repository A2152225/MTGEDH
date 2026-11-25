import { describe, expect, it } from 'vitest';
import {
  shouldQuietPassEmptyStackOffTurn,
  V2_OFFTURN_FLASH_MAX_BF,
} from '../src/socket/ai-handlers/aiOffTurnQuietPass.js';

describe('shouldQuietPassEmptyStackOffTurn', () => {
  it('quiet-passes beginning for all brains; v2 may answer empty end on small bf', () => {
    expect(shouldQuietPassEmptyStackOffTurn({
      stackEmpty: true,
      phase: 'ending',
      step: 'end',
      brain: 'v2',
      battlefieldSize: 4,
    })).toBe(false);
    expect(shouldQuietPassEmptyStackOffTurn({
      stackEmpty: true,
      phase: 'ending',
      step: 'end',
      brain: 'v2',
      battlefieldSize: V2_OFFTURN_FLASH_MAX_BF + 1,
    })).toBe(true);
    expect(shouldQuietPassEmptyStackOffTurn({
      stackEmpty: true,
      phase: 'ending',
      step: 'end',
      brain: 'v1',
      battlefieldSize: 4,
    })).toBe(true);
    expect(shouldQuietPassEmptyStackOffTurn({
      stackEmpty: true,
      phase: 'beginning',
      step: 'upkeep',
      brain: 'v1',
      battlefieldSize: 4,
    })).toBe(true);
  });

  it('quiet-passes opponent main for all brains (flash footgun disabled)', () => {
    expect(shouldQuietPassEmptyStackOffTurn({
      stackEmpty: true,
      phase: 'main',
      step: 'main1',
      brain: 'v2',
      battlefieldSize: V2_OFFTURN_FLASH_MAX_BF,
    })).toBe(true);
    expect(shouldQuietPassEmptyStackOffTurn({
      stackEmpty: true,
      phase: 'main',
      step: 'main1',
      brain: 'v1',
      battlefieldSize: 4,
    })).toBe(true);
  });

  it('does not quiet-pass when stack is non-empty', () => {
    expect(shouldQuietPassEmptyStackOffTurn({
      stackEmpty: false,
      phase: 'main',
      step: 'main1',
      brain: 'v0',
      battlefieldSize: 4,
    })).toBe(false);
  });
});
