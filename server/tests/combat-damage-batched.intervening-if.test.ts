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

describe('Combat damage batched triggers - intervening-if at trigger time', () => {
  it('does not execute batched trigger when recognized intervening-if is false', () => {
    const g = createInitialGameState('batched_cd_if_false');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const active = g.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    // Tapped land that the batched trigger would untap
    const land = {
      id: 'land_1',
      controller: active,
      owner: active,
      card: { id: 'land_card', name: 'Test Land', type_line: 'Land', oracle_text: '' },
      tapped: true,
    };
    (g.state.battlefield as any[]).push(land);

    // Batched combat damage trigger with intervening-if
    const triggerPerm = {
      id: 'perm_batched_1',
      controller: active,
      owner: active,
      card: {
        id: 'batched_card',
        name: 'Test Batched Trigger',
        type_line: 'Enchantment',
        oracle_text:
          'Whenever one or more creatures you control deal combat damage to a player, if you control an artifact, untap all lands you control.',
      },
      tapped: false,
    };
    (g.state.battlefield as any[]).push(triggerPerm);

    // Attacker that will deal combat damage to the defending player
    (g as any).createToken(active, 'Test Attacker', 1, 2, 2);
    const attacker = g.state.battlefield.find((p: any) => p?.card?.name === 'Test Attacker' && p?.controller === active) as any;
    expect(attacker).toBeTruthy();

    // Go to DECLARE_BLOCKERS, then set attacking and advance into DAMAGE
    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS

    attacker.attacking = defending;
    attacker.blockedBy = [];

    g.applyEvent({ type: 'nextStep' }); // DAMAGE (combat damage is dealt here)

    // No artifacts controlled -> intervening-if false -> land should remain tapped
    const landAfter = g.state.battlefield.find((p: any) => p?.id === 'land_1') as any;
    expect(landAfter.tapped).toBe(true);
  });

  it('executes batched trigger when recognized intervening-if is true', () => {
    const g = createInitialGameState('batched_cd_if_true');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const active = g.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    const land = {
      id: 'land_1',
      controller: active,
      owner: active,
      card: { id: 'land_card', name: 'Test Land', type_line: 'Land', oracle_text: '' },
      tapped: true,
    };
    (g.state.battlefield as any[]).push(land);

    const triggerPerm = {
      id: 'perm_batched_1',
      controller: active,
      owner: active,
      card: {
        id: 'batched_card',
        name: 'Test Batched Trigger',
        type_line: 'Enchantment',
        oracle_text:
          'Whenever one or more creatures you control deal combat damage to a player, if you control an artifact, untap all lands you control.',
      },
      tapped: false,
    };
    (g.state.battlefield as any[]).push(triggerPerm);

    // Make condition true: control an artifact
    const artifact = {
      id: 'artifact_1',
      controller: active,
      owner: active,
      card: { id: 'artifact_card', name: 'Test Artifact', type_line: 'Artifact', oracle_text: '' },
      tapped: false,
    };
    (g.state.battlefield as any[]).push(artifact);

    (g as any).createToken(active, 'Test Attacker', 1, 2, 2);
    const attacker = g.state.battlefield.find((p: any) => p?.card?.name === 'Test Attacker' && p?.controller === active) as any;
    expect(attacker).toBeTruthy();

    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS

    attacker.attacking = defending;
    attacker.blockedBy = [];

    g.applyEvent({ type: 'nextStep' }); // DAMAGE

    const landAfter = g.state.battlefield.find((p: any) => p?.id === 'land_1') as any;
    expect(landAfter.tapped).toBe(false);
  });

  it('does not execute batched trigger when intervening-if (that player hand size) is false', () => {
    const g = createInitialGameState('batched_cd_thatplayer_hand_false');
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

    const land = {
      id: 'land_1',
      controller: active,
      owner: active,
      card: { id: 'land_card', name: 'Test Land', type_line: 'Land', oracle_text: '' },
      tapped: true,
    };
    (g.state.battlefield as any[]).push(land);

    const triggerPerm = {
      id: 'perm_batched_1',
      controller: active,
      owner: active,
      card: {
        id: 'batched_card',
        name: 'Test Batched Trigger',
        type_line: 'Enchantment',
        oracle_text:
          'Whenever one or more creatures you control deal combat damage to a player, if that player has two or fewer cards in hand, untap all lands you control.',
      },
      tapped: false,
    };
    (g.state.battlefield as any[]).push(triggerPerm);

    (g as any).createToken(active, 'Test Attacker', 1, 2, 2);
    const attacker = g.state.battlefield.find((p: any) => p?.card?.name === 'Test Attacker' && p?.controller === active) as any;
    expect(attacker).toBeTruthy();

    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS

    attacker.attacking = defending;
    attacker.blockedBy = [];

    g.applyEvent({ type: 'nextStep' }); // DAMAGE

    const landAfter = g.state.battlefield.find((p: any) => p?.id === 'land_1') as any;
    expect(landAfter.tapped).toBe(true);
  });

  it('executes batched trigger when intervening-if (that player hand size) is true', () => {
    const g = createInitialGameState('batched_cd_thatplayer_hand_true');
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

    const land = {
      id: 'land_1',
      controller: active,
      owner: active,
      card: { id: 'land_card', name: 'Test Land', type_line: 'Land', oracle_text: '' },
      tapped: true,
    };
    (g.state.battlefield as any[]).push(land);

    const triggerPerm = {
      id: 'perm_batched_1',
      controller: active,
      owner: active,
      card: {
        id: 'batched_card',
        name: 'Test Batched Trigger',
        type_line: 'Enchantment',
        oracle_text:
          'Whenever one or more creatures you control deal combat damage to a player, if that player has two or fewer cards in hand, untap all lands you control.',
      },
      tapped: false,
    };
    (g.state.battlefield as any[]).push(triggerPerm);

    (g as any).createToken(active, 'Test Attacker', 1, 2, 2);
    const attacker = g.state.battlefield.find((p: any) => p?.card?.name === 'Test Attacker' && p?.controller === active) as any;
    expect(attacker).toBeTruthy();

    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS

    attacker.attacking = defending;
    attacker.blockedBy = [];

    g.applyEvent({ type: 'nextStep' }); // DAMAGE

    const landAfter = g.state.battlefield.find((p: any) => p?.id === 'land_1') as any;
    expect(landAfter.tapped).toBe(false);
  });
});
