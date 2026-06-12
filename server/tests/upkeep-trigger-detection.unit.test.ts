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

  it('does not treat Court of Garenbrig ETB monarch as an upkeep effect', () => {
    const oracleText =
      'When Court of Garenbrig enters the battlefield, you become the monarch.\n' +
      'At the beginning of your upkeep, distribute two +1/+1 counters among up to two target creatures.';

    const triggers = detectUpkeepTriggers({
      name: 'Court of Garenbrig',
      oracle_text: oracleText,
    }, permanent);

    const upkeepEffects = triggers
      .filter((trigger) => trigger.triggerType === 'upkeep_effect')
      .map((trigger) => String(trigger.effect || trigger.description || '').toLowerCase());

    expect(upkeepEffects).toContain('distribute two +1/+1 counters among up to two target creatures');
    expect(upkeepEffects.some((effect) => effect.includes('become the monarch'))).toBe(false);
    expect(upkeepEffects.some((effect) => effect.includes('become monarch'))).toBe(false);
  });
});
