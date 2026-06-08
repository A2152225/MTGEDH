import { describe, expect, it } from 'vitest';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';

const permanent = { id: 'P1', controller: 'P1' };

describe('upkeep trigger detection', () => {
  it('detects epic each-of-your-upkeeps triggers', () => {
    const triggers = detectUpkeepTriggers({
      name: 'Neverending Torment',
      oracle_text: 'Epic\nAt the beginning of each of your upkeeps, copy this spell except for its epic ability.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });
});
