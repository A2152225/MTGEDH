import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

describe('Noncombat damage-to-player triggers - intervening-if at trigger time', () => {
  it('does not queue deals-damage trigger when intervening-if (that player hand size) is false', () => {
    const g = createInitialGameState('ncd_thatplayer_hand_false');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Damaged player has 3 cards in hand => "two or fewer" is false.
    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p2] = (g.state as any).zones[p2] || {};
    (g.state as any).zones[p2].hand = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
    (g.state as any).zones[p2].handCount = 3;

    const pinger = {
      id: 'pinger_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'pinger_card',
        name: 'Test Noncombat Damage Trigger Creature',
        type_line: 'Creature',
        oracle_text:
          '{T}: ~ deals 1 damage to any target.\nWhenever ~ deals damage to a player, if that player has two or fewer cards in hand, draw a card.',
        power: '1',
        toughness: '1',
      },
      basePower: 1,
      baseToughness: 1,
      tapped: false,
      summoningSickness: false,
    };
    (g.state.battlefield as any[]).push(pinger);

    // Resolve a generic activated ability that deals damage to target player (p2).
    (g.state as any).stack = (g.state as any).stack || [];
    (g.state as any).stack.push({
      id: 'ability_ping_1',
      type: 'ability',
      controller: p1,
      source: 'pinger_1',
      sourceName: 'Test Noncombat Damage Trigger Creature',
      description: 'deals 1 damage to any target',
      abilityType: 'generic',
      targets: [p2],
    });

    g.resolveTopOfStack();

    const stack = (g.state as any).stack || [];
    const queued = stack.some(
      (it: any) => it?.type === 'triggered_ability' && it?.source === 'pinger_1' && it?.triggerType === 'deals_damage'
    );
    expect(queued).toBe(false);
  });

  it('queues deals-damage trigger when intervening-if (that player hand size) is true', () => {
    const g = createInitialGameState('ncd_thatplayer_hand_true');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Damaged player has 2 cards in hand => "two or fewer" is true.
    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p2] = (g.state as any).zones[p2] || {};
    (g.state as any).zones[p2].hand = [{ id: 'c1' }, { id: 'c2' }];
    (g.state as any).zones[p2].handCount = 2;

    const pinger = {
      id: 'pinger_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'pinger_card',
        name: 'Test Noncombat Damage Trigger Creature',
        type_line: 'Creature',
        oracle_text:
          '{T}: ~ deals 1 damage to any target.\nWhenever ~ deals damage to a player, if that player has two or fewer cards in hand, draw a card.',
        power: '1',
        toughness: '1',
      },
      basePower: 1,
      baseToughness: 1,
      tapped: false,
      summoningSickness: false,
    };
    (g.state.battlefield as any[]).push(pinger);

    (g.state as any).stack = (g.state as any).stack || [];
    (g.state as any).stack.push({
      id: 'ability_ping_1',
      type: 'ability',
      controller: p1,
      source: 'pinger_1',
      sourceName: 'Test Noncombat Damage Trigger Creature',
      description: 'deals 1 damage to any target',
      abilityType: 'generic',
      targets: [p2],
    });

    g.resolveTopOfStack();

    const stack = (g.state as any).stack || [];
    const queued = stack.some(
      (it: any) => it?.type === 'triggered_ability' && it?.source === 'pinger_1' && it?.triggerType === 'deals_damage'
    );
    expect(queued).toBe(true);
  });

  it('queues trigger but fizzles at resolution when intervening-if becomes false', () => {
    const g = createInitialGameState('ncd_thatplayer_fizzle_at_resolution');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Start with 2 cards so the trigger is created.
    (g.state as any).zones = (g.state as any).zones || {};
    (g.state as any).zones[p2] = (g.state as any).zones[p2] || {};
    (g.state as any).zones[p2].hand = [{ id: 'c1' }, { id: 'c2' }];
    (g.state as any).zones[p2].handCount = 2;

    const pinger = {
      id: 'pinger_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'pinger_card',
        name: 'Test Noncombat Damage Trigger Creature',
        type_line: 'Creature',
        oracle_text:
          '{T}: ~ deals 1 damage to any target.\nWhenever ~ deals damage to a player, if that player has two or fewer cards in hand, draw a card.',
        power: '1',
        toughness: '1',
      },
      basePower: 1,
      baseToughness: 1,
      tapped: false,
      summoningSickness: false,
    };
    (g.state.battlefield as any[]).push(pinger);

    // Ability resolves first and should queue a triggered ability.
    (g.state as any).stack = (g.state as any).stack || [];
    (g.state as any).stack.push({
      id: 'ability_ping_1',
      type: 'ability',
      controller: p1,
      source: 'pinger_1',
      sourceName: 'Test Noncombat Damage Trigger Creature',
      description: 'deals 1 damage to any target',
      abilityType: 'generic',
      targets: [p2],
    });

    g.resolveTopOfStack();

    const afterAbility = (g.state as any).stack || [];
    const hasTrigger = afterAbility.some(
      (it: any) => it?.type === 'triggered_ability' && it?.source === 'pinger_1' && it?.triggerType === 'deals_damage'
    );
    expect(hasTrigger).toBe(true);

    // Now make condition false before the trigger resolves.
    (g.state as any).zones[p2].hand = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
    (g.state as any).zones[p2].handCount = 3;

    // Resolve the queued triggered ability.
    g.resolveTopOfStack();

    const pendingDraws = (g.state as any).pendingDraws || {};
    expect(pendingDraws[p1] || 0).toBe(0);
  });
});
