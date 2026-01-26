import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';

describe("Intervening-if: enchanted creature's power", () => {
  it('counts aura P/T bonuses when checking enchanted creature power thresholds', () => {
    const g = createInitialGameState('t_intervening_if_enchanted_creature_power');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // 2/2 creature.
    (g.state.battlefield as any).push({
      id: 'creature_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'creature_1_card',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
      tapped: false,
      basePower: 2,
      baseToughness: 2,
      attachments: ['aura_1'],
    });

    // Aura gives +2/+2, making enchanted creature power 4.
    const auraPerm = {
      id: 'aura_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'aura_1_card',
        name: 'Test Aura +2/+2',
        type_line: 'Enchantment — Aura',
        oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2.',
      },
      tapped: false,
      attachedTo: 'creature_1',
    };

    (g.state.battlefield as any).push(auraPerm);

    const text = 'At the beginning of your upkeep, if enchanted creature\'s power is 4 or greater, you win the game.';

    expect(isInterveningIfSatisfied(g as any, String(p1), text, auraPerm)).toBe(true);
  });

  it('returns false when enchanted creature power is below the threshold', () => {
    const g = createInitialGameState('t_intervening_if_enchanted_creature_power_false');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    (g.state.battlefield as any).push({
      id: 'creature_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'creature_1_card',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
      tapped: false,
      basePower: 2,
      baseToughness: 2,
      attachments: ['aura_1'],
    });

    const auraPerm = {
      id: 'aura_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'aura_1_card',
        name: 'Test Aura +1/+1',
        type_line: 'Enchantment — Aura',
        oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.',
      },
      tapped: false,
      attachedTo: 'creature_1',
    };

    (g.state.battlefield as any).push(auraPerm);

    const text = 'At the beginning of your upkeep, if enchanted creature\'s power is 4 or greater, you win the game.';

    expect(isInterveningIfSatisfied(g as any, String(p1), text, auraPerm)).toBe(false);
  });
});
