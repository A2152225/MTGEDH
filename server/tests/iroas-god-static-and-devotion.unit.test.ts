import { describe, expect, it } from 'vitest';

import { countDevotionSymbolsInManaCost, countDevotionAmongPermanents } from '../../shared/src/devotionCount.js';
import { detectBeginningOfCombatTriggers } from '../src/state/modules/triggers/combat.js';
import { updateGodCreatureStatus } from '../src/state/modules/counters_tokens.js';
import { isCurrentlyCreature } from '../src/socket/combat-handlers/combatLegalityGates.js';

const IROAS_ORACLE =
  "Indestructible\n" +
  "As long as your devotion to red and white is less than seven, Iroas isn't a creature.\n" +
  "Creatures you control have menace.\n" +
  "Prevent all damage that would be dealt to attacking creatures you control.";

describe('Iroas statics and two-color devotion', () => {
  it('does not invent a beginning-of-combat trigger for the menace grant', () => {
    const triggers = detectBeginningOfCombatTriggers(
      { name: 'Iroas, God of Victory', oracle_text: IROAS_ORACLE },
      { id: 'iroas_1', controller: 'p1' },
    );
    expect(triggers).toEqual([]);
  });

  it('counts each hybrid pip once toward two-color devotion', () => {
    expect(countDevotionSymbolsInManaCost('{2}{R}{W}', ['R', 'W'])).toBe(2);
    expect(countDevotionSymbolsInManaCost('{R/W}', ['R', 'W'])).toBe(1);
    expect(countDevotionSymbolsInManaCost('{R/W}{R/W}', ['R', 'W'])).toBe(2);
    expect(countDevotionAmongPermanents(
      [
        { controller: 'p1', card: { mana_cost: '{2}{R}{W}' } },
        { controller: 'p1', card: { mana_cost: '{R/W}' } },
        { controller: 'p2', card: { mana_cost: '{R}{R}{W}{W}' } },
      ],
      'p1',
      ['R', 'W'],
    )).toBe(3);
  });

  it('marks Iroas not a creature when combined devotion is below 7', () => {
    const ctx: any = {
      bumpSeq: () => {},
      state: {
        battlefield: [
          {
            id: 'iroas_1',
            controller: 'p1',
            card: {
              name: 'Iroas, God of Victory',
              type_line: 'Legendary Enchantment Creature — God',
              mana_cost: '{2}{R}{W}',
              oracle_text: IROAS_ORACLE,
            },
          },
          { id: 'plains_1', controller: 'p1', card: { name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '' } },
          { id: 'mountain_1', controller: 'p1', card: { name: 'Mountain', type_line: 'Basic Land — Mountain', mana_cost: '' } },
        ],
      },
    };

    updateGodCreatureStatus(ctx);
    const iroas = ctx.state.battlefield[0];
    expect(iroas.calculatedDevotion).toBe(2);
    expect(iroas.notCreature).toBe(true);
    expect(isCurrentlyCreature(iroas, ctx.state.battlefield, 'p1')).toBe(false);
  });

  it('is a creature again when combined devotion reaches 7', () => {
    const ctx: any = {
      bumpSeq: () => {},
      state: {
        battlefield: [
          {
            id: 'iroas_1',
            controller: 'p1',
            notCreature: true,
            card: {
              name: 'Iroas, God of Victory',
              type_line: 'Legendary Enchantment Creature — God',
              mana_cost: '{2}{R}{W}',
              oracle_text: IROAS_ORACLE,
            },
          },
          { id: 'sol', controller: 'p1', card: { name: 'Boros Charm', mana_cost: '{R}{W}' } },
          { id: 'tal', controller: 'p1', card: { name: 'Lightning Helix', mana_cost: '{R}{W}' } },
          { id: 'adeline', controller: 'p1', card: { name: 'Adeline', mana_cost: '{1}{W}{W}{W}' } },
        ],
      },
    };

    updateGodCreatureStatus(ctx);
    const iroas = ctx.state.battlefield[0];
    expect(iroas.calculatedDevotion).toBeGreaterThanOrEqual(7);
    expect(iroas.notCreature).toBe(false);
    expect(isCurrentlyCreature(iroas, ctx.state.battlefield, 'p1')).toBe(true);
  });
});
