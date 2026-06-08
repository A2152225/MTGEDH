import { describe, expect, it } from 'vitest';
import { detectAttackTriggers, detectDeathTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';
import { detectGainedLifeTriggersFromOracle } from '../src/state/modules/triggers/lifegain.js';

const permanent = { id: 'P1', controller: 'P1' };

describe('death trigger detection extensions', () => {
  it('detects dealt-damage-this-turn dies triggers', () => {
    const triggers = detectDeathTriggers({
      name: 'Blood Cultist',
      oracle_text: 'Whenever a creature dealt damage by Blood Cultist this turn dies, you gain 1 life.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'dealt_damage_dies')).toBe(true);
  });

  it('detects equipped creature dies triggers', () => {
    const triggers = detectDeathTriggers({
      name: 'Deathrender',
      oracle_text: 'Whenever equipped creature dies, you may return Deathrender to its owner\'s hand and put it onto the battlefield attached to target creature card in a graveyard.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'attachment_dies')).toBe(true);
  });
});

describe('attack trigger detection extensions', () => {
  it('detects battalion attack triggers', () => {
    const triggers = detectAttackTriggers({
      name: 'Frontline Medic',
      oracle_text: 'Whenever Frontline Medic attacks and at least two other creatures attack, Frontline Medic gains double strike until end of turn.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'battalion')).toBe(true);
  });
});

describe('life trigger detection', () => {
  it('detects opponent life loss triggers', () => {
    const triggers = detectLifeLossTriggers({
      name: 'Mindcrank',
      oracle_text: 'Whenever an opponent loses life, that player mills that many cards.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'opponent_loses_life')).toBe(true);
  });

  it('detects lifegain triggers from oracle', () => {
    const triggers = detectGainedLifeTriggersFromOracle({
      name: 'Vito, Thorn of the Dusk Rose',
      oracle_text: 'Whenever you gain life, each opponent loses 1 life.',
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'you_gain_life')).toBe(true);
  });
});
