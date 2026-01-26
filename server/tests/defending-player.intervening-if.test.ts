import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';

function setupToMain1(g: ReturnType<typeof createInitialGameState>, p1: PlayerID, p2: PlayerID) {
  // Start turn engine (turnPlayer becomes p2 after nextTurn in this harness)
  g.applyEvent({ type: 'nextTurn' });

  // Ensure draw step can draw
  const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
    id: `card_${i}`,
    name: `Test Card ${i}`,
    type_line: 'Creature',
    oracle_text: '',
  }));
  g.importDeckResolved(p1, sampleDeck);
  g.importDeckResolved(p2, sampleDeck.map((c) => ({ ...c, id: `p2_${c.id}` })));

  // Advance to MAIN1
  g.applyEvent({ type: 'nextStep' }); // UPKEEP
  g.applyEvent({ type: 'nextStep' }); // DRAW
  g.applyEvent({ type: 'nextStep' }); // MAIN1
}

describe('Intervening-if: defending player combat context', () => {
  it('does not queue per-attacker combat damage trigger when "defending player has N or fewer cards" is false', () => {
    const g = createInitialGameState('t_cd_defending_player_hand_false');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const active = g.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    // Defending player has 3 cards in hand => "two or fewer" is false.
    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[defending] = (g.state as any).zones[defending] || {};
    (g.state as any).zones[defending].hand = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
    (g.state as any).zones[defending].handCount = 3;

    const attacker: any = {
      id: 'attacker_1',
      controller: active,
      owner: active,
      card: {
        id: 'attacker_card',
        name: 'Test Defending Player Hand Trigger Creature',
        type_line: 'Creature',
        oracle_text:
          'Whenever ~ deals combat damage to a player, if defending player has two or fewer cards in hand, draw a card.',
        power: '2',
        toughness: '2',
      },
      basePower: 2,
      baseToughness: 2,
      tapped: false,
      summoningSickness: false,
    };
    (g.state.battlefield as any[]).push(attacker);

    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS

    attacker.attacking = defending;
    attacker.blockedBy = [];

    g.applyEvent({ type: 'nextStep' }); // DAMAGE

    const stack = (g.state as any).stack || [];
    const queued = stack.some(
      (it: any) =>
        it?.type === 'triggered_ability' &&
        it?.source === 'attacker_1' &&
        it?.triggerType === 'deals_combat_damage'
    );
    expect(queued).toBe(false);
  });

  it('queues per-attacker combat damage trigger when "defending player has N or fewer cards" is true', () => {
    const g = createInitialGameState('t_cd_defending_player_hand_true');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const active = g.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    // Defending player has 2 cards in hand => "two or fewer" is true.
    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[defending] = (g.state as any).zones[defending] || {};
    (g.state as any).zones[defending].hand = [{ id: 'c1' }, { id: 'c2' }];
    (g.state as any).zones[defending].handCount = 2;

    const attacker: any = {
      id: 'attacker_1',
      controller: active,
      owner: active,
      card: {
        id: 'attacker_card',
        name: 'Test Defending Player Hand Trigger Creature',
        type_line: 'Creature',
        oracle_text:
          'Whenever ~ deals combat damage to a player, if defending player has two or fewer cards in hand, draw a card.',
        power: '2',
        toughness: '2',
      },
      basePower: 2,
      baseToughness: 2,
      tapped: false,
      summoningSickness: false,
    };
    (g.state.battlefield as any[]).push(attacker);

    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS

    attacker.attacking = defending;
    attacker.blockedBy = [];

    g.applyEvent({ type: 'nextStep' }); // DAMAGE

    const stack = (g.state as any).stack || [];
    const queued = stack.some(
      (it: any) =>
        it?.type === 'triggered_ability' &&
        it?.source === 'attacker_1' &&
        it?.triggerType === 'deals_combat_damage'
    );
    expect(queued).toBe(true);
  });

  it('evaluates "defending player controls more lands than you" using explicit defendingPlayerId refs', () => {
    const g = createInitialGameState('t_eval_defending_player_more_lands');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state.battlefield as any[]).push(
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        attacking: p2,
        card: {
          id: 'src_card_1',
          name: 'Test Attacker',
          type_line: 'Creature',
          oracle_text: 'Whenever ~ attacks, if defending player controls more lands than you, draw a card.',
        },
        tapped: false,
      },
      // p1 has 1 land
      {
        id: 'p1_land_1',
        controller: p1,
        owner: p1,
        card: { id: 'p1_land_1_card', name: 'Plains', type_line: 'Land — Plains', oracle_text: '' },
        tapped: false,
      },
      // p2 has 2 lands
      {
        id: 'p2_land_1',
        controller: p2,
        owner: p2,
        card: { id: 'p2_land_1_card', name: 'Island', type_line: 'Land — Island', oracle_text: '' },
        tapped: false,
      },
      {
        id: 'p2_land_2',
        controller: p2,
        owner: p2,
        card: { id: 'p2_land_2_card', name: 'Swamp', type_line: 'Land — Swamp', oracle_text: '' },
        tapped: false,
      }
    );

    const source = (g.state.battlefield as any[]).find((p) => p?.id === 'src_1');
    const desc = 'Whenever ~ attacks, if defending player controls more lands than you, draw a card.';

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(true);
  });

  it('evaluates "defending player controls no Walls" using explicit defendingPlayerId refs', () => {
    const g = createInitialGameState('t_eval_defending_player_no_walls');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const source: any = {
      id: 'src_1',
      controller: p1,
      owner: p1,
      attacking: p2,
      card: {
        id: 'src_card_1',
        name: 'Test Attacker',
        type_line: 'Creature',
        oracle_text: 'Whenever ~ attacks, if defending player controls no Walls, draw a card.',
      },
      tapped: false,
    };

    (g.state.battlefield as any[]).push(source);

    const desc = 'Whenever ~ attacks, if defending player controls no Walls, draw a card.';

    // No Walls => true.
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(true);

    // Add a Wall for the defending player => false.
    (g.state.battlefield as any[]).push({
      id: 'p2_wall_1',
      controller: p2,
      owner: p2,
      card: {
        id: 'p2_wall_1_card',
        name: 'Wall',
        type_line: 'Creature — Wall',
        oracle_text: '',
      },
      tapped: false,
    });

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(false);
  });

  it('evaluates "defending player is poisoned" using explicit defendingPlayerId refs', () => {
    const g = createInitialGameState('t_eval_defending_player_poisoned');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).poisonCounters = { [p2]: 1 };

    const source: any = {
      id: 'src_1',
      controller: p1,
      owner: p1,
      attacking: p2,
      card: {
        id: 'src_card_1',
        name: 'Test Attacker',
        type_line: 'Creature',
        oracle_text: 'Whenever ~ attacks, if defending player is poisoned, draw a card.',
      },
      tapped: false,
    };
    (g.state.battlefield as any[]).push(source);

    const desc = 'Whenever ~ attacks, if defending player is poisoned, draw a card.';
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(true);

    (g.state as any).poisonCounters = { [p2]: 0 };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(false);
  });

  it('evaluates "defending player controls no Glimmer creatures" using explicit defendingPlayerId refs', () => {
    const g = createInitialGameState('t_eval_defending_player_no_glimmer');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const source: any = {
      id: 'src_1',
      controller: p1,
      owner: p1,
      attacking: p2,
      card: {
        id: 'src_card_1',
        name: 'Test Attacker',
        type_line: 'Creature',
        oracle_text: 'Whenever ~ attacks, if defending player controls no Glimmer creatures, draw a card.',
      },
      tapped: false,
    };
    (g.state.battlefield as any[]).push(source);

    const desc = 'Whenever ~ attacks, if defending player controls no Glimmer creatures, draw a card.';
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(true);

    (g.state.battlefield as any[]).push({
      id: 'p2_glimmer_1',
      controller: p2,
      owner: p2,
      card: { id: 'p2_glimmer_1_card', name: 'Glimmer', type_line: 'Creature — Glimmer', oracle_text: '' },
      tapped: false,
    });

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(false);
  });

  it('evaluates "defending player controls no black permanents" (and nontoken variant) using explicit defendingPlayerId refs', () => {
    const g = createInitialGameState('t_eval_defending_player_no_black');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const source: any = {
      id: 'src_1',
      controller: p1,
      owner: p1,
      attacking: p2,
      card: {
        id: 'src_card_1',
        name: 'Test Attacker',
        type_line: 'Creature',
        oracle_text: 'Whenever ~ attacks, if defending player controls no black permanents, draw a card.',
      },
      tapped: false,
    };

    (g.state.battlefield as any[]).push(source);

    const descNoBlack = 'Whenever ~ attacks, if defending player controls no black permanents, draw a card.';
    const descNoBlackNontoken =
      'Whenever ~ attacks, if defending player controls no black nontoken permanents, draw a card.';

    // With explicit non-black permanent set, should be true.
    (g.state.battlefield as any[]).push({
      id: 'p2_green_1',
      controller: p2,
      owner: p2,
      card: { id: 'p2_green_1_card', name: 'Elf', type_line: 'Creature — Elf', oracle_text: '', colors: ['G'] },
      tapped: false,
    });
    expect(
      isInterveningIfSatisfied(g as any, String(p1), descNoBlack, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(true);

    // Add a black permanent => false.
    (g.state.battlefield as any[]).push({
      id: 'p2_black_1',
      controller: p2,
      owner: p2,
      card: { id: 'p2_black_1_card', name: 'Zombie', type_line: 'Creature — Zombie', oracle_text: '', colors: ['B'] },
      tapped: false,
    });
    expect(
      isInterveningIfSatisfied(g as any, String(p1), descNoBlack, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(false);

    // Nontoken variant: black token should not violate.
    const g2 = createInitialGameState('t_eval_defending_player_no_black_nontoken');
    g2.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g2.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    const src2: any = {
      id: 'src_2',
      controller: p1,
      owner: p1,
      attacking: p2,
      card: {
        id: 'src_card_2',
        name: 'Test Attacker',
        type_line: 'Creature',
        oracle_text: descNoBlackNontoken,
      },
      tapped: false,
    };
    (g2.state.battlefield as any[]).push(src2);
    (g2.state.battlefield as any[]).push({
      id: 'p2_black_token',
      controller: p2,
      owner: p2,
      isToken: true,
      card: { id: 'p2_black_token_card', name: 'Zombie Token', type_line: 'Creature — Zombie', oracle_text: '', colors: ['B'] },
      tapped: false,
    });
    expect(
      isInterveningIfSatisfied(g2 as any, String(p1), descNoBlackNontoken, src2, {
        defendingPlayerId: String(p2),
      })
    ).toBe(true);

    // Add a black nontoken => false.
    (g2.state.battlefield as any[]).push({
      id: 'p2_black_real',
      controller: p2,
      owner: p2,
      card: { id: 'p2_black_real_card', name: 'Swamp Thing', type_line: 'Creature', oracle_text: '', colors: ['B'] },
      tapped: false,
    });
    expect(
      isInterveningIfSatisfied(g2 as any, String(p1), descNoBlackNontoken, src2, {
        defendingPlayerId: String(p2),
      })
    ).toBe(false);
  });

  it('evaluates "defending player controls an Enchanting Tale" using set code WOT', () => {
    const g = createInitialGameState('t_eval_defending_player_enchanting_tale');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const source: any = {
      id: 'src_1',
      controller: p1,
      owner: p1,
      attacking: p2,
      card: {
        id: 'src_card_1',
        name: 'Must Be Knights',
        type_line: 'Creature',
        oracle_text: 'Whenever ~ attacks, if defending player controls an Enchanting Tale, ~ deals 1 damage to any target.',
      },
      tapped: false,
    };
    (g.state.battlefield as any[]).push(source);

    const desc = 'Whenever ~ attacks, if defending player controls an Enchanting Tale, ~ deals 1 damage to any target.';

    // Non-WOT printing => false.
    (g.state.battlefield as any[]).push({
      id: 'p2_ench_woe',
      controller: p2,
      owner: p2,
      card: { id: 'p2_ench_woe_card', name: 'Random Enchantment', type_line: 'Enchantment', oracle_text: '', set: 'woe' },
      tapped: false,
    });
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(false);

    // WOT printing => true.
    (g.state.battlefield as any[]).push({
      id: 'p2_ench_wot',
      controller: p2,
      owner: p2,
      card: { id: 'p2_ench_wot_card', name: 'Enchanting Tale', type_line: 'Enchantment', oracle_text: '', set: 'wot' },
      tapped: false,
    });
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        defendingPlayerId: String(p2),
      })
    ).toBe(true);
  });
});
