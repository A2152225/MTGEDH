import { describe, expect, it } from 'vitest';
import { detectEntersWithCounters } from '../src/state/modules/detectEntersWithCounters.js';

describe('detectEntersWithCounters Fabricate', () => {
  it('does not preload +1/+1 counters for Fabricate (CR 702.123 choice trigger)', () => {
    const counters = detectEntersWithCounters({
      name: 'Hangarback Walker',
      type_line: 'Artifact Creature — Construct',
      oracle_text: 'Fabricate 2',
    });
    expect(counters['+1/+1'] || 0).toBe(0);
  });

  it('still preloads modular and enters-with counters', () => {
    const modular = detectEntersWithCounters({
      name: 'Arcbound Worker',
      type_line: 'Artifact Creature — Construct',
      oracle_text: 'Modular 1',
    });
    expect(modular['+1/+1']).toBe(1);

    const entersWith = detectEntersWithCounters({
      name: 'Sample',
      type_line: 'Creature — Beast',
      oracle_text: 'This creature enters with two +1/+1 counters on it.',
    });
    expect(entersWith['+1/+1']).toBe(2);
  });
});
