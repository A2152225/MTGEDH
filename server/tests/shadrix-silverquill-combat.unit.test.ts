import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { detectBeginningOfCombatTriggers } from '../src/state/modules/triggers/combat.js';

const SHADRIX_ORACLE =
  'Flying, double strike\n' +
  'At the beginning of combat on your turn, you may choose two. Each mode must target a different player.\n' +
  '\u2022 Target player creates a 2/1 white and black Inkling creature token with flying.\n' +
  '\u2022 Target player draws a card and loses 1 life.\n' +
  '\u2022 Target player puts a +1/+1 counter on each creature they control.';

describe('Shadrix Silverquill beginning-of-combat modal', () => {
  it('detects the combat trigger with all three modes in the effect text', () => {
    const card = { name: 'Shadrix Silverquill', oracle_text: SHADRIX_ORACLE };
    const triggers = detectBeginningOfCombatTriggers(card, { id: 'shadrix-1', controller: 'p1' });

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.requiresChoice).toBe(true);
    expect(String(triggers[0]?.effect || '')).toMatch(/you may choose two/i);
    expect(String(triggers[0]?.effect || '')).toMatch(/inkling/i);
    expect(String(triggers[0]?.effect || '')).toMatch(/draws a card and loses 1 life/i);
    expect(String(triggers[0]?.effect || '')).toMatch(/\+1\/\+1 counter on each creature they control/i);
  });

  it('collects a single optional choose_mode step instead of auto-applying +1/+1 counters', () => {
    const ir = parseOracleTextToIR(SHADRIX_ORACLE, 'Shadrix Silverquill');
    const combatAbility = ir.abilities.find((ability) =>
      /beginning of combat on your turn/i.test(String(ability.triggerCondition || ability.text || '')),
    );
    expect(combatAbility?.steps.map((step) => step.kind)).toEqual(['choose_mode']);

    const card = { name: 'Shadrix Silverquill', oracle_text: SHADRIX_ORACLE };
    const triggers = detectBeginningOfCombatTriggers(card, { id: 'shadrix-1', controller: 'p1' });
    const steps = collectOracleEffectSteps(String(triggers[0]?.effect || ''), 'Shadrix Silverquill');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'choose_mode',
      minModes: 2,
      maxModes: 2,
      optional: true,
    });
    expect((steps[0] as any).distinctPlayerTargets).toBe(true);
    expect((steps[0] as any).modes).toHaveLength(3);
    expect(steps.some((step) => step.kind === 'add_counter')).toBe(false);
  });
});
