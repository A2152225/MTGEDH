import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';

describe('Damage effects via resolveSpell (ANY_TARGET_DAMAGE, DAMAGE_EACH)', () => {
  it('reduces player life total for ANY_TARGET_DAMAGE', () => {
    const g = createInitialGameState('t_dmg_player');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const startLife = g.state.life[p2];
    expect(startLife).toBeGreaterThan(0);

    // Resolve a burn spell to player p2 for 5 damage
    g.applyEvent({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'burn_5',
      spec: { op: 'ANY_TARGET_DAMAGE', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 5 },
      chosen: [{ kind: 'player', id: p2 } as TargetRef]
    });

    expect(g.state.life[p2]).toBe(startLife - 5);
  });

  it('removes a creature permanent when lethal damage is applied', () => {
    const g = createInitialGameState('t_dmg_perm');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Create a 1/1 token creature
    g.createToken(p1, 'Soldier Token', 1, 1, 1);
    const creatureId = g.state.battlefield[0].id;

    // Apply ANY_TARGET_DAMAGE for 1 to that creature
    g.applyEvent({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'ping_1',
      spec: { op: 'ANY_TARGET_DAMAGE', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 1 },
      chosen: [{ kind: 'permanent', id: creatureId } as TargetRef]
    });

    // Lethal approximation removes the permanent
    expect(g.state.battlefield.find(p => p.id === creatureId)).toBeUndefined();
  });

  it('DAMAGE_EACH applies to all creatures and removes 1-toughness tokens when amount >= toughness', () => {
    const g = createInitialGameState('t_dmg_each');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    // Create two tokens: 1/1 and 2/2
    g.createToken(p1, 'Soldier', 1, 1, 1);
    g.createToken(p1, 'Knight', 1, 2, 2);
    const ids = g.state.battlefield.map(b => b.id);
    expect(ids.length).toBe(2);

    // Resolve "deal 1 to each creature"
    g.applyEvent({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'sweep_1',
      spec: { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amount: 1 },
      chosen: []
    });

    // The 1/1 should be gone; the 2/2 remains
    const remaining = g.state.battlefield.map(b => b.id);
    expect(remaining.length).toBe(1);
  });
});