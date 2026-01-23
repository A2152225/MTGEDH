import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

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
  g.importDeckResolved(p2, sampleDeck.map(c => ({ ...c, id: `p2_${c.id}` })));

  // Advance to MAIN1
  g.applyEvent({ type: 'nextStep' }); // UPKEEP
  g.applyEvent({ type: 'nextStep' }); // DRAW
  g.applyEvent({ type: 'nextStep' }); // MAIN1
}

describe('Combat damage (per-attacker) triggers - intervening-if at trigger time', () => {
  it('does not queue per-attacker combat damage trigger when intervening-if (that player hand size) is false', () => {
    const g = createInitialGameState('single_cd_thatplayer_hand_false');
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

    const attacker = {
      id: 'attacker_1',
      controller: active,
      owner: active,
      card: {
        id: 'attacker_card',
        name: 'Test Combat Damage Trigger Creature',
        type_line: 'Creature',
        oracle_text:
          'Whenever ~ deals combat damage to a player, if that player has two or fewer cards in hand, draw a card.',
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
      (it: any) => it?.type === 'triggered_ability' && it?.source === 'attacker_1' && it?.triggerType === 'deals_combat_damage'
    );
    expect(queued).toBe(false);
  });

  it('queues per-attacker combat damage trigger when intervening-if (that player hand size) is true', () => {
    const g = createInitialGameState('single_cd_thatplayer_hand_true');
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

    const attacker = {
      id: 'attacker_1',
      controller: active,
      owner: active,
      card: {
        id: 'attacker_card',
        name: 'Test Combat Damage Trigger Creature',
        type_line: 'Creature',
        oracle_text:
          'Whenever ~ deals combat damage to a player, if that player has two or fewer cards in hand, draw a card.',
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
      (it: any) => it?.type === 'triggered_ability' && it?.source === 'attacker_1' && it?.triggerType === 'deals_combat_damage'
    );
    expect(queued).toBe(true);
  });

  it('queues trigger but fizzles at resolution when intervening-if becomes false', () => {
    const g = createInitialGameState('single_cd_thatplayer_fizzle_at_resolution');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const active = g.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    // Start with 2 cards so the trigger is created.
    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[defending] = (g.state as any).zones[defending] || {};
    (g.state as any).zones[defending].hand = [{ id: 'c1' }, { id: 'c2' }];
    (g.state as any).zones[defending].handCount = 2;

    const attacker = {
      id: 'attacker_1',
      controller: active,
      owner: active,
      card: {
        id: 'attacker_card',
        name: 'Test Combat Damage Trigger Creature',
        type_line: 'Creature',
        oracle_text:
          'Whenever ~ deals combat damage to a player, if that player has two or fewer cards in hand, draw a card.',
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

    const afterDamage = (g.state as any).stack || [];
    const hasTrigger = afterDamage.some(
      (it: any) => it?.type === 'triggered_ability' && it?.source === 'attacker_1' && it?.triggerType === 'deals_combat_damage'
    );
    expect(hasTrigger).toBe(true);

    // Now make condition false before the trigger resolves.
    (g.state as any).zones[defending].hand = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
    (g.state as any).zones[defending].handCount = 3;

    g.resolveTopOfStack();

    const pendingDraws = (g.state as any).pendingDraws || {};
    expect(pendingDraws[active] || 0).toBe(0);
  });
});
