import { describe, expect, it } from 'vitest';
import { analyzeCardTriggers } from '../src/state/modules/triggers/registry.js';
import { detectEndStepTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { detectAttackTriggers, detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

describe('trigger effect text extraction (server registration)', () => {
  it('registers full Kynaios end-step effect text from oracle', () => {
    const oracle =
      "At the beginning of your end step, draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.";
    const triggers = analyzeCardTriggers(
      { name: 'Test Enchantment', oracle_text: oracle },
      'perm_1',
      'p1',
    );

    const endStep = triggers.find((trigger) => trigger.timing === 'end_step');
    expect(endStep?.effect?.toLowerCase()).toContain('draw a card');
    expect(endStep?.effect?.toLowerCase()).toContain('each player may put a land');
    expect(endStep?.effect?.toLowerCase()).toContain("each opponent who didn't");
  });

  it('detectEndStepTriggers captures multi-sentence generic end-step effects', () => {
    const oracle =
      "At the beginning of your end step, draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.";
    const triggers = detectEndStepTriggers(
      { name: 'Generic Card', oracle_text: oracle },
      { id: 'perm_2', controller: 'p1' },
    );

    const generic = triggers.find((trigger) => trigger.triggerType === 'end_step_effect');
    expect(generic?.effect?.toLowerCase()).toContain('each player may put a land');
  });

  it('does not register the Warp reminder text as an end-step trigger', () => {
    const triggers = detectEndStepTriggers(
      {
        name: 'Starfield Vocalist',
        oracle_text:
          'If a permanent entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\n'
          + 'Warp {1}{U} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)',
      },
      { id: 'starfield-vocalist', controller: 'p1' },
    );

    expect(triggers).toEqual([]);
  });

  it('detectAttackTriggers captures if-you-do continuation after attacks', () => {
    const oracle =
      'Whenever this creature attacks, you may put an artifact creature card from your hand onto the battlefield tapped and attacking. If you do, convert it at the beginning of your next upkeep.';
    const triggers = detectAttackTriggers(
      { name: 'Ultra Magnus', oracle_text: oracle },
      { id: 'perm_3', controller: 'p1' },
    );

    const attack = triggers.find((trigger) => trigger.triggerType === 'attack' || trigger.effect?.includes('artifact creature'));
    expect(attack?.effect?.toLowerCase()).toContain('you may put an artifact creature');
    expect(attack?.effect?.toLowerCase()).toContain('if you do');
  });

  it('detectETBTriggers captures sacrifice-if-you-do continuation', () => {
    const oracle =
      'When this creature enters, you may sacrifice a nontoken creature. If you do, draw X cards, then mill X cards, where X is that creature\'s mana value.';
    const triggers = detectETBTriggers(
      { name: 'Altar Test', oracle_text: oracle },
      { id: 'perm_4', controller: 'p1' },
    );

    const etb = triggers.find((trigger) => trigger.triggerType === 'etb' || trigger.triggerType === 'etb_sacrifice_unless_pay');
    expect(etb?.effect?.toLowerCase()).toContain('you may sacrifice a nontoken creature');
    expect(etb?.effect?.toLowerCase()).toContain('if you do');
    expect(etb?.effect?.toLowerCase()).toContain('mill x cards');
  });
});
