import { describe, expect, it } from 'vitest';

import { detectAttackTriggers } from '../src/state/modules/triggers/combat.js';

describe('Svyelun attack trigger detection', () => {
  it('detects "Whenever Svyelun attacks" on Svyelun of Sea and Sky', () => {
    const card = {
      name: 'Svyelun of Sea and Sky',
      oracle_text:
        'Svyelun has indestructible as long as you control at least two other Merfolk.\nWhenever Svyelun attacks, draw a card.\nOther Merfolk you control have ward {1}.',
    };
    const permanent = { id: 'svyelun_1', card };

    const triggers = detectAttackTriggers(card, permanent);
    const attackTrigger = triggers.find((t) => t.triggerType === 'attacks');

    expect(attackTrigger).toBeTruthy();
    expect(attackTrigger?.description).toBe('draw a card.');
  });
});
