import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpellWithoutPrimaryRetirement as categorizeSpell, evaluateTargeting, resolveSpell } from '../src/rules-engine/targeting';

describe('Oracle templates: Blight (Lorwyn Eclipsed)', () => {
  it('categorizeSpell: "Each opponent blights 1." -> BLIGHT_EACH_OPPONENT (supports numerals + reminder text)', () => {
    const spec = categorizeSpell(
      'High Perfect Morcant',
      'Each opponent blights 1. (They each put a -1/-1 counter on a creature they control.)',
    );

    expect(spec?.op).toBe('BLIGHT_EACH_OPPONENT');
    expect((spec as any)?.amount).toBe(1);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('BLIGHT_* resolveSpell ops are deleted (P1a; categorize patterns kept for cast)', () => {
    const g = createInitialGameState('t_blight_resolve_deleted');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    expect(resolveSpell(
      { op: 'BLIGHT_SELF', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'BLIGHT_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'BLIGHT_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'BLIGHT_TARGET_OPPONENT', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 2 } as any,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'BLIGHT_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 1 } as any,
      [{ kind: 'player', id: p1 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
  });

  it('categorizeSpell + evaluateTargeting: "Target opponent blights 2." -> BLIGHT_TARGET_OPPONENT (opponentOnly)', () => {
    const g = createInitialGameState('t_blight_target_opponent');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent!({ type: 'join', playerId: p3, name: 'P3' });

    const spec = categorizeSpell('Blight Ray', 'Target opponent blights 2. (They put two -1/-1 counters on a creature they control.)');
    expect(spec?.op).toBe('BLIGHT_TARGET_OPPONENT');
    expect((spec as any)?.amount).toBe(2);
    expect((spec as any)?.opponentOnly).toBe(true);

    const targets = evaluateTargeting(g.state as any, p1, spec as any, undefined);
    const playerIds = targets.filter(t => t.kind === 'player').map(t => t.id);

    expect(playerIds).toContain(p2);
    expect(playerIds).toContain(p3);
    expect(playerIds).not.toContain(p1);
  });

  it('categorizeSpell: "Each player blights 1." -> BLIGHT_EACH_PLAYER', () => {
    const spec = categorizeSpell('Group Blight', 'Each player blights 1.');
    expect(spec?.op).toBe('BLIGHT_EACH_PLAYER');
    expect((spec as any)?.amount).toBe(1);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('categorizeSpell + evaluateTargeting: "Target player blights 1." -> BLIGHT_TARGET_PLAYER', () => {
    const g = createInitialGameState('t_blight_target_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    const spec = categorizeSpell('Pointed Blight', 'Target player blights 1.');
    expect(spec?.op).toBe('BLIGHT_TARGET_PLAYER');
    expect((spec as any)?.amount).toBe(1);
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);

    const targets = evaluateTargeting(g.state as any, p1, spec as any, undefined);
    const ids = targets.filter(t => t.kind === 'player').map(t => t.id);
    expect(ids).toContain(p1);
    expect(ids).toContain(p2);
  });

  it('categorizeSpell: "Blight 2." -> BLIGHT_SELF', () => {
    const spec = categorizeSpell('Simple Blight', 'Blight 2.');
    expect(spec?.op).toBe('BLIGHT_SELF');
    expect((spec as any)?.amount).toBe(2);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });
});
