import { describe, expect, it } from 'vitest';

import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { detectAttackTriggers } from '../src/state/modules/triggered-abilities.js';

const ELVISH_PIPER_ORACLE =
  '{G}, {T}: You may put a creature card from your hand onto the battlefield.';

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

  it('parses Elvish Piper activated put-from-hand as wired optional move_zone IR', () => {
    const effect = 'You may put a creature card from your hand onto the battlefield.';
    expect(isTriggerEffectFullyIrWired(effect, 'Elvish Piper')).toBe(true);
    const steps = collectOracleEffectSteps(effect, 'Elvish Piper');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'move_zone',
      to: 'battlefield',
      optional: true,
      what: { kind: 'raw', text: 'a creature card from your hand' },
    });
  });

  it('does not invent an attack trigger for Elvish Piper activated put-from-hand', () => {
    const triggers = detectAttackTriggers(
      {
        name: 'Elvish Piper',
        type_line: 'Creature — Elf Shaman',
        oracle_text: ELVISH_PIPER_ORACLE,
      },
      { id: 'piper_1', controller: 'p1' },
    );
    expect(triggers).toHaveLength(0);
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
