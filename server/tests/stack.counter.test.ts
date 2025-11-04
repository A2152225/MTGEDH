import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef, KnownCardRef } from '../../shared/src';

describe('Counterspell flow (COUNTER_TARGET_SPELL)', () => {
  it('removes targeted stack item and moves it to the controller’s graveyard', () => {
    const g = createInitialGameState('t_counter_1');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    // Join players (sets up life/zones)
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Put a spell from P1 on the stack
    const lightningBolt: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
      id: 'card_bolt',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      image_uris: undefined
    };
    const stackId = 'st_abc123';
    g.applyEvent({
      type: 'pushStack',
      item: {
        id: stackId,
        controller: p1,
        card: lightningBolt,
        targets: []
      }
    });

    expect(g.state.stack.length).toBe(1);

    // Resolve "Counter target spell" from p2 targeting that stack item
    g.applyEvent({
      type: 'resolveSpell',
      caster: p2,
      cardId: 'card_counter',
      spec: { op: 'COUNTER_TARGET_SPELL', filter: 'ANY', minTargets: 1, maxTargets: 1 },
      chosen: [{ kind: 'stack', id: stackId } as TargetRef]
    });

    // Countered: stack is empty, and the countered spell is in P1's graveyard
    expect(g.state.stack.length).toBe(0);
    const gy = g.state.zones?.[p1]?.graveyard ?? [];
    expect(gy.find(c => (c as any).id === 'card_bolt')).toBeTruthy();
  });
});