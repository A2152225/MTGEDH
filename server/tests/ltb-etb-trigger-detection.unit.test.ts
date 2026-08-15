import { describe, expect, it } from 'vitest';
import {
  detectAttackTriggers,
  detectETBTriggers,
  detectLTBTriggers,
} from '../src/state/modules/triggered-abilities.js';

const permanent = { id: 'P1', controller: 'P1' };

describe('LTB trigger detection', () => {
  it('detects self leaves-the-battlefield triggers', () => {
    const triggers = detectLTBTriggers({
      name: 'Thragtusk',
      oracle_text: 'When this creature leaves the battlefield, create a 3/3 green Beast creature token.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'ltb')).toBe(true);
  });

  it('detects permanent-you-control leaves triggers', () => {
    const triggers = detectLTBTriggers({
      name: 'Purphoros, God of the Forge',
      oracle_text: 'Whenever another permanent you control leaves the battlefield, Purphoros deals 2 damage to each opponent.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'controlled_ltb')).toBe(true);
  });

  it('does not register a keyword reminder leaves trigger', () => {
    const triggers = detectLTBTriggers({
      name: 'Reminder Test',
      oracle_text:
        'Escape {2}{B} (You may cast this card from your graveyard for its escape cost. It escapes with three +1/+1 counters on it.)\nWhenever this creature leaves the battlefield, draw a card.',
    }, permanent);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.effect).toMatch(/draw a card/i);
  });
});

describe('ETB trigger detection extensions', () => {
  it('detects vehicle ETB triggers', () => {
    const triggers = detectETBTriggers({
      name: 'Burner Rocket',
      oracle_text: 'When this Vehicle enters, you may pay {1}. If you do, it becomes an artifact creature until end of turn.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('detects morph face-up triggers', () => {
    const triggers = detectETBTriggers({
      name: 'Willbender',
      oracle_text: 'When this creature is turned face up, you may change the target of target spell or ability by choosing new targets for it.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'face_up')).toBe(true);
  });

  it('detects aura ETB triggers', () => {
    const triggers = detectETBTriggers({
      name: 'Waterknot',
      oracle_text: 'When this Aura enters, tap enchanted creature. Enchanted creature doesn\'t untap during its controller\'s untap step.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('detects vehicle ETB with graveyard return', () => {
    const triggers = detectETBTriggers({
      name: 'Jailbreak',
      oracle_text: 'When this Vehicle enters, return target creature card with mana value 2 or less from your graveyard to the battlefield.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('skips a keyword reminder ETB in favor of the real ETB ability', () => {
    const triggers = detectETBTriggers({
      name: 'Sample Offspring',
      oracle_text:
        'Offspring {1}{U} (You may pay an additional {1}{U} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nWhen this creature enters, tap up to one target creature and put a stun counter on it.',
    }, permanent);
    expect(triggers.some((trigger) => (
      trigger.triggerType === 'etb'
      && /tap up to one target creature/i.test(String(trigger.effect || ''))
    ))).toBe(true);
  });

  it('does not register an offspring reminder as an ETB by itself', () => {
    const triggers = detectETBTriggers({
      name: 'Offspring Only',
      oracle_text:
        'Offspring {1}{U} (You may pay an additional {1}{U} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)',
    }, permanent);
    expect(triggers).toEqual([]);
  });

  it('detects planeswalker ETB triggers (Gatewatch Beacon)', () => {
    const triggers = detectETBTriggers({
      name: 'Gatewatch Beacon',
      oracle_text:
        'This artifact enters with three loyalty counters on it.\n'
        + '{T}: Add {W}.\n'
        + 'Whenever a planeswalker you control enters, if this artifact has loyalty counters on it, you may move a loyalty counter from this artifact onto that planeswalker.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'planeswalker_etb')).toBe(true);
  });
});

describe('attack trigger reminder exclusion', () => {
  it('ignores attack wording inside a keyword reminder', () => {
    const triggers = detectAttackTriggers({
      name: 'Reminder Attacker',
      oracle_text:
        'Escape {2}{B} (Whenever this creature attacks, create a Treasure token.)',
    }, permanent);
    expect(triggers).toEqual([]);
  });
});

describe('discard and targeted trigger detection', () => {
  it('detects opponent discard triggers', async () => {
    const { detectDiscardTriggers } = await import('../src/state/modules/triggered-abilities.js');
    const triggers = detectDiscardTriggers({
      name: 'Waste Not',
      oracle_text: 'Whenever an opponent discards a card, create a Treasure token.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'opponent_discard')).toBe(true);
  });

  it('detects becomes-the-target triggers', async () => {
    const { detectTargetedTriggers } = await import('../src/state/modules/triggered-abilities.js');
    const triggers = detectTargetedTriggers({
      name: 'Tar Pit Warrior',
      oracle_text: 'Whenever Tar Pit Warrior becomes the target of a spell or ability, sacrifice it.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });

  it('detects becomes-blocked triggers', async () => {
    const { detectBlockTriggers } = await import('../src/state/modules/triggered-abilities.js');
    const triggers = detectBlockTriggers({
      name: 'Chambered Nautilus',
      oracle_text: 'Whenever this creature becomes blocked, defending player mills three cards.',
    }, permanent);
    expect(triggers.length).toBeGreaterThan(0);
  });
});
