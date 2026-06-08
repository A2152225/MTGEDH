import { describe, expect, it } from 'vitest';
import { detectETBTriggers, detectLTBTriggers } from '../src/state/modules/triggered-abilities.js';

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
