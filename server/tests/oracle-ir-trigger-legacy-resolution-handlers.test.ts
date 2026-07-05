import { describe, expect, it } from 'vitest';

import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';

describe('oracle IR trigger legacy resolution handlers', () => {
  it('parses optional put creature from hand as wired move_zone IR', () => {
    const effect = 'you may put a creature card from your hand onto the battlefield';
    expect(isTriggerEffectFullyIrWired(effect, 'Champion of Rhonas')).toBe(true);
    const steps = collectOracleEffectSteps(effect, 'Champion of Rhonas');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'move_zone',
      to: 'battlefield',
      optional: true,
      what: { kind: 'raw', text: 'a creature card from your hand' },
    });
  });

  it('parses Belbe portal chosen-type put from hand as wired move_zone IR', () => {
    const effect = 'You may put a creature card of the chosen type from your hand onto the battlefield.';
    expect(isTriggerEffectFullyIrWired(effect, "Belbe's Portal")).toBe(true);
    const steps = collectOracleEffectSteps(effect, "Belbe's Portal");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'move_zone',
      to: 'battlefield',
      optional: true,
      what: { kind: 'raw', text: 'a creature card of the chosen type from your hand' },
    });
  });
});
