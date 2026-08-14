import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import {
  inferTriggeredAbilityTargetMetadata,
  isModalChooseModesEffectText,
} from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

const KOGLA_ORACLE =
  'When Kogla and Yidaro enters, choose one —\n' +
  '\u2022 It gains trample and haste until end of turn.\n' +
  '\u2022 It fights target creature you don\'t control.\n' +
  '{2}{R}{G}, Discard this card: Destroy up to one target artifact or enchantment. Shuffle this card into your library from your graveyard, then draw a card.';

describe('Kogla and Yidaro ETB modal targeting', () => {
  it('detects the self-ETB without a stack-time creature target', () => {
    const triggers = detectETBTriggers(
      { name: 'Kogla and Yidaro', oracle_text: KOGLA_ORACLE },
      { id: 'kogla-1', controller: 'p1' },
    );
    const etb = triggers.find((trigger) => trigger.triggerType === 'etb');

    expect(etb).toBeDefined();
    expect(String(etb?.effect || '')).toMatch(/choose one/i);
    expect(String(etb?.effect || '')).toMatch(/trample and haste/i);
    expect(String(etb?.effect || '')).toMatch(/fights target creature you don['’]t control/i);
    expect(etb?.requiresTarget).toBeFalsy();
    expect(isModalChooseModesEffectText(String(etb?.effect || ''))).toBe(true);
  });

  it('does not infer stack targeting from the fight mode\'s target word', () => {
    const triggers = detectETBTriggers(
      { name: 'Kogla and Yidaro', oracle_text: KOGLA_ORACLE },
      { id: 'kogla-1' },
    );
    const effectText = String(triggers.find((trigger) => trigger.triggerType === 'etb')?.effect || '');
    const metadata = inferTriggeredAbilityTargetMetadata(effectText);

    expect(metadata.requiresTarget).toBe(false);
    expect(metadata.targetType).toBeUndefined();
  });

  it('still infers a creature target for a non-modal fight clause', () => {
    const metadata = inferTriggeredAbilityTargetMetadata(
      'It fights target creature you don\'t control.',
    );
    expect(metadata.requiresTarget).toBe(true);
    expect(metadata.targetType).toBe('creature');
  });

  it('collects a single choose_mode step for the ETB effect', () => {
    const ir = parseOracleTextToIR(KOGLA_ORACLE, 'Kogla and Yidaro');
    const etbAbility = ir.abilities.find((ability) =>
      /enters/i.test(String(ability.triggerCondition || ability.text || '')),
    );
    expect(etbAbility?.steps.some((step) => step.kind === 'choose_mode')).toBe(true);

    const triggers = detectETBTriggers(
      { name: 'Kogla and Yidaro', oracle_text: KOGLA_ORACLE },
      { id: 'kogla-1' },
    );
    const steps = collectOracleEffectSteps(String(triggers[0]?.effect || ''), 'Kogla and Yidaro');
    expect(steps.filter((step) => step.kind === 'choose_mode')).toHaveLength(1);
    expect(steps.some((step) => step.kind === 'deal_damage')).toBe(false);
  });
});
