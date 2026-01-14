import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, resolveSpell } from '../src/rules-engine/targeting';

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

  it('Lightning Bolt (3 damage) kills a 1/1 creature - simulates AI casting', () => {
    const g = createInitialGameState('t_lightning_bolt');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Create a 1/1 creature (Skrelv-like) under p2's control
    g.createToken(p2, 'Skrelv, Defector Mite', 1, 1, 1);
    const creatureId = g.state.battlefield[0].id;
    
    // Verify creature is on battlefield with proper baseToughness
    const creatureBefore = g.state.battlefield.find(p => p.id === creatureId);
    expect(creatureBefore).toBeDefined();
    expect(creatureBefore?.baseToughness).toBe(1);

    // p1 (AI) casts Lightning Bolt (3 damage) targeting the creature
    g.applyEvent({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'lightning_bolt',
      spec: { op: 'ANY_TARGET_DAMAGE', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 3 },
      chosen: [{ kind: 'permanent', id: creatureId } as TargetRef]
    });

    // The 1/1 creature should be destroyed (3 damage >= 1 toughness)
    const creatureAfter = g.state.battlefield.find(p => p.id === creatureId);
    expect(creatureAfter).toBeUndefined();
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

  it('categorizeSpell: deals N damage to target player -> DAMAGE_TARGET_PLAYER', () => {
    const spec = categorizeSpell('BoltFace', 'Test deals 3 damage to target player.')!;
    expect(spec.op).toBe('DAMAGE_TARGET_PLAYER');
    expect(spec.amount).toBe(3);
    expect(spec.minTargets).toBe(1);
    expect(spec.maxTargets).toBe(1);
  });

  it('evaluateTargeting: target opponent excludes caster', () => {
    const g = createInitialGameState('t_dmg_target_opp');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const spec = categorizeSpell('BoltOpp', 'Test deals 2 damage to target opponent.')!;
    const targets = evaluateTargeting(g.state as any, p1, spec);
    const ids = new Set(targets.filter(t => t.kind === 'player').map(t => t.id));
    expect(ids.has(p1)).toBe(false);
    expect(ids.has(p2)).toBe(true);
  });

  it('categorizeSpell: deals N damage to target creature an opponent controls -> DAMAGE_TARGET (opponentOnly)', () => {
    const spec = categorizeSpell('ScopedBurn', 'Test deals 3 damage to target creature an opponent controls.')!;
    expect(spec.op).toBe('DAMAGE_TARGET');
    expect(spec.amount).toBe(3);
    expect(spec.filter).toBe('CREATURE');
    expect(spec.opponentOnly).toBe(true);
  });

  it('evaluateTargeting: scoped DAMAGE_TARGET excludes caster-controlled permanents', () => {
    const g = createInitialGameState('t_dmg_target_scope');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    g.createToken(p1, 'P1 Token', 1, 1, 1);
    g.createToken(p2, 'P2 Token', 1, 1, 1);
    const p1Creature = g.state.battlefield.find(p => (p as any).controller === p1)!.id;
    const p2Creature = g.state.battlefield.find(p => (p as any).controller === p2)!.id;

    const spec = categorizeSpell('ScopedBurn', 'Test deals 3 damage to target creature an opponent controls.')!;
    const targets = evaluateTargeting(g.state as any, p1, spec);
    const ids = new Set(targets.filter(t => t.kind === 'permanent').map(t => t.id));

    expect(ids.has(p1Creature)).toBe(false);
    expect(ids.has(p2Creature)).toBe(true);
  });

  it('resolveSpell: scoped DAMAGE_TARGET does not produce effects for illegal chosen target', () => {
    const g = createInitialGameState('t_dmg_target_scope_defensive');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    g.createToken(p1, 'P1 Token', 1, 1, 1);
    const p1Creature = g.state.battlefield.find(p => (p as any).controller === p1)!.id;

    const spec = categorizeSpell('ScopedBurn', 'Test deals 3 damage to target creature an opponent controls.')!;
    const eff = resolveSpell(spec, [{ kind: 'permanent', id: p1Creature } as TargetRef], g.state as any, p1);
    expect(eff.some(e => e.kind === 'DamagePermanent')).toBe(false);
  });

  it('DAMAGE_TARGET_PLAYER reduces life total', () => {
    const g = createInitialGameState('t_dmg_target_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const startLife = g.state.life[p2];
    const spec = categorizeSpell('BoltFace', 'Test deals 3 damage to target player.')!;
    g.applyEvent({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'bolt_face',
      spec,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });
    expect(g.state.life[p2]).toBe(startLife - 3);
  });

  it('DAMAGE_EACH_OPPONENT reduces opponents life only', () => {
    const g = createInitialGameState('t_dmg_each_opp');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const startP1 = g.state.life[p1];
    const startP2 = g.state.life[p2];

    const spec = categorizeSpell('Pestilence', 'Test deals 2 damage to each opponent.')!;
    g.applyEvent({ type: 'resolveSpell', caster: p1, cardId: 'each_opp', spec, chosen: [] });

    expect(g.state.life[p1]).toBe(startP1);
    expect(g.state.life[p2]).toBe(startP2 - 2);
  });

  it('DAMAGE_EACH can target creatures and planeswalkers together (resolveSpell output)', () => {
    const g = createInitialGameState('t_dmg_creature_pw');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    g.createToken(p1, 'Soldier', 1, 1, 1);
    const creatureId = g.state.battlefield[0].id;

    g.state.battlefield.push({
      id: 'pw1',
      owner: p1,
      controller: p1,
      tapped: false,
      card: { id: 'jace', name: 'Jace', type_line: 'Planeswalker — Jace', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Swelter', 'Test deals 1 damage to each creature and each planeswalker.')!;
    const eff = resolveSpell(spec, [], g.state as any, p1);
    const ids = new Set(eff.filter(e => e.kind === 'DamagePermanent').map(e => (e as any).id));
    expect(ids.has(creatureId)).toBe(true);
    expect(ids.has('pw1')).toBe(true);
  });

  it('DAMAGE_EACH supports controllerOnly scope (resolveSpell output)', () => {
    const g = createInitialGameState('t_dmg_each_you_control');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    g.createToken(p1, 'P1 Token', 1, 1, 1);
    g.createToken(p2, 'P2 Token', 1, 1, 1);
    const p1Creature = g.state.battlefield.find(p => (p as any).controller === p1)!.id;
    const p2Creature = g.state.battlefield.find(p => (p as any).controller === p2)!.id;

    const spec = categorizeSpell('SelfSweep', 'Test deals 1 damage to each creature you control.')!;
    const eff = resolveSpell(spec, [], g.state as any, p1);
    const ids = new Set(eff.filter(e => e.kind === 'DamagePermanent').map(e => (e as any).id));

    expect(ids.has(p1Creature)).toBe(true);
    expect(ids.has(p2Creature)).toBe(false);
  });
});