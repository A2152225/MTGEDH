import { describe, expect, it } from 'vitest';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';

const AURIOK_ORACLE = [
  'First strike, vigilance',
  'Protection from black and from red',
  'Whenever another creature enters the battlefield, you may gain 1 life.',
].join('\n');

const SOUL_WARDEN_ORACLE = 'Whenever another creature enters the battlefield, you gain 1 life.';

describe('Auriok Champion ETB trigger detection', () => {
  it('matches Soul Warden-style creature_etb with no color restriction', () => {
    const auriokTriggers = detectETBTriggers({
      name: 'Auriok Champion',
      oracle_text: AURIOK_ORACLE,
    });
    const soulTriggers = detectETBTriggers({
      name: 'Soul Warden',
      oracle_text: SOUL_WARDEN_ORACLE,
    });

    const auriokCreatureEtb = auriokTriggers.find((trigger) => trigger.triggerType === 'creature_etb');
    const soulCreatureEtb = soulTriggers.find((trigger) => trigger.triggerType === 'creature_etb');

    expect(auriokCreatureEtb).toBeDefined();
    expect(soulCreatureEtb).toBeDefined();
    expect(auriokCreatureEtb?.mandatory).toBe(false);
    expect(auriokCreatureEtb?.requiresChoice).toBe(true);
    expect(soulCreatureEtb?.mandatory).toBe(true);
    expect(/\byou may gain 1 life/i.test(String(auriokCreatureEtb?.effect || ''))).toBe(true);
  });
});
