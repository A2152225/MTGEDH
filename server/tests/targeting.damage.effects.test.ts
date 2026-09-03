import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpellWithoutPrimaryRetirement as categorizeSpell, evaluateTargeting, resolveSpell, type SpellSpec } from '../src/rules-engine/targeting';

describe('Damage effects via resolveSpell (ANY_TARGET_DAMAGE, DAMAGE_EACH)', () => {
  it('DAMAGE_* / ANY_TARGET_DAMAGE resolveSpell ops are deleted (P1a; categorize patterns kept for cast)', () => {
    const g = createInitialGameState('t_dmg_resolve_deleted');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    expect(resolveSpell(
      { op: 'ANY_TARGET_DAMAGE', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 5 } as SpellSpec,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DAMAGE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, amount: 3 } as SpellSpec,
      [{ kind: 'permanent', id: 'c1' } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DAMAGE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 3 } as SpellSpec,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amount: 1 } as SpellSpec,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DAMAGE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DAMAGE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
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

  it('categorizeSpell: deals N damage to each creature and each planeswalker -> DAMAGE_EACH multiFilter', () => {
    const spec = categorizeSpell('Swelter', 'Test deals 1 damage to each creature and each planeswalker.')!;
    expect(spec.op).toBe('DAMAGE_EACH');
    expect(spec.amount).toBe(1);
  });

  it('categorizeSpell: deals N damage to each creature you control -> DAMAGE_EACH controllerOnly', () => {
    const spec = categorizeSpell('SelfSweep', 'Test deals 1 damage to each creature you control.')!;
    expect(spec.op).toBe('DAMAGE_EACH');
    expect(spec.controllerOnly).toBe(true);
  });
});
