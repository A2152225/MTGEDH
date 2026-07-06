import { describe, expect, it } from 'vitest';

import {
  detectAttackTriggers as detectCombatAttackTriggers,
  detectBlockTriggers as detectCombatBlockTriggers,
} from '../src/state/modules/triggers/combat.js';
import {
  detectAttackTriggers as detectLegacyAttackTriggers,
  detectBlockTriggers as detectLegacyBlockTriggers,
} from '../src/state/modules/triggered-abilities.js';

describe('Svyelun attack trigger detection', () => {
  it('detects "Whenever Svyelun attacks" on Svyelun of Sea and Sky', () => {
    const card = {
      name: 'Svyelun of Sea and Sky',
      oracle_text:
        'Svyelun has indestructible as long as you control at least two other Merfolk.\nWhenever Svyelun attacks, draw a card.\nOther Merfolk you control have ward {1}.',
    };
    const permanent = { id: 'svyelun_1', card };

    const triggers = detectCombatAttackTriggers(card, permanent);
    const attackTrigger = triggers.find((t) => t.triggerType === 'attacks');

    expect(attackTrigger).toBeTruthy();
    expect(attackTrigger?.description).toBe('draw a card.');
  });
});

describe('Multi-line oracle trigger effect extraction', () => {
  const myrelOracle =
    "During your turn, opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.\nWhenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.";
  const myrelCard = { name: 'Myrel, Shield of Argive', oracle_text: myrelOracle };
  const myrelPermanent = { id: 'myrel_1', controller: 'p1' };

  const blockOracle =
    "During your turn, opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.\nWhenever Test Knight blocks a creature, draw a card.";
  const blockCard = { name: 'Test Knight', oracle_text: blockOracle };
  const blockPermanent = { id: 'knight_1', controller: 'p1' };

  it('combat.detectAttackTriggers uses token effect, not static ability slice', () => {
    const attackTrigger = detectCombatAttackTriggers(myrelCard, myrelPermanent).find(
      (t) => t.triggerType === 'attacks',
    );

    expect(attackTrigger?.description?.toLowerCase()).toContain('create x 1/1 colorless soldier');
    expect(attackTrigger?.description?.toLowerCase()).not.toContain('pponents');
    expect(attackTrigger?.description?.toLowerCase()).not.toContain("can't cast spells");
  });

  it('legacy.detectAttackTriggers uses token effect, not static ability slice', () => {
    const attackTrigger = detectLegacyAttackTriggers(myrelCard, myrelPermanent).find(
      (t) => t.triggerType === 'attacks',
    );

    expect(attackTrigger?.effect?.toLowerCase()).toContain('create x 1/1 colorless soldier');
    expect(attackTrigger?.effect?.toLowerCase()).not.toContain('pponents');
  });

  it('combat.detectBlockTriggers uses block effect, not prior static line slice', () => {
    const triggers = detectCombatBlockTriggers(blockCard, blockPermanent);
    expect(triggers.length).toBeGreaterThan(0);
    const effect = String(triggers[0]?.description || triggers[0]?.effect || '').toLowerCase();
    expect(effect).toContain('draw a card');
    expect(effect).not.toContain('pponents');
    expect(effect).not.toContain("can't cast spells");
  });

  it('legacy.detectBlockTriggers uses block effect, not prior static line slice', () => {
    const blockTrigger = detectLegacyBlockTriggers(blockCard, blockPermanent).find((t) =>
      String(t.description || t.effect || '')
        .toLowerCase()
        .includes('draw a card'),
    );
    const effect = String(blockTrigger?.description || blockTrigger?.effect || '').toLowerCase();
    expect(effect).toContain('draw a card');
    expect(effect).not.toContain('pponents');
  });
});
