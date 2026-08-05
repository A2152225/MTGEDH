import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, resolveSpell, type SpellSpec } from '../src/rules-engine/targeting';

describe('Targeting resolve destroy/exile', () => {
  it('DESTROY_*/EXILE_* resolveSpell ops are deleted (P1a; categorize patterns kept for cast)', () => {
    const g = createInitialGameState('tgt_destroy_exile_resolve_deleted');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    expect(resolveSpell(
      { op: 'DESTROY_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 2 } as SpellSpec,
      [{ kind: 'permanent', id: 'any' } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 } as SpellSpec,
      [{ kind: 'permanent', id: 'any' } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DESTROY_ALL', filter: 'CREATURE', minTargets: 0, maxTargets: 0 } as SpellSpec,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DESTROY_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'EXILE_ALL', filter: 'CREATURE', minTargets: 0, maxTargets: 0 } as SpellSpec,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DESTROY_ALL_TARGET_PLAYER', filter: 'ARTIFACT', minTargets: 1, maxTargets: 1 } as any,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'EXILE_ALL_TARGET_PLAYER', filter: 'CREATURE', minTargets: 1, maxTargets: 1 } as any,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
  });

  it('categorizeSpell: destroy all creatures you control keeps controllerOnly', () => {
    const spec = categorizeSpell('Wrath-ish', 'Destroy all creatures you control.')!;
    expect(spec.op).toBe('DESTROY_ALL');
    expect(spec.filter).toBe('CREATURE');
    expect(spec.controllerOnly).toBe(true);
  });

  it('categorizeSpell: exile all creatures your opponents control keeps opponentOnly', () => {
    const spec = categorizeSpell('Exile-ish', 'Exile all creatures your opponents control.')!;
    expect(spec.op).toBe('EXILE_ALL');
    expect(spec.filter).toBe('CREATURE');
    expect(spec.opponentOnly).toBe(true);
  });

  it('categorizeSpell: destroy all artifacts target player controls', () => {
    const spec = categorizeSpell('Shatterstorm-ish', 'Destroy all artifacts target player controls.')!;
    expect(spec.op).toBe('DESTROY_ALL_TARGET_PLAYER');
    expect(spec.filter).toBe('ARTIFACT');
  });

  it('categorizeSpell: "Destroy up to two target nonland permanents" -> DESTROY_TARGET (nonlandOnly, max 2)', () => {
    const spec = categorizeSpell('NonlandUpTo', 'Destroy up to two target nonland permanents.');
    expect(spec?.op).toBe('DESTROY_TARGET');
    expect(spec?.filter).toBe('PERMANENT');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(2);
    expect(spec?.nonlandOnly).toBe(true);
  });

  it('categorizeSpell + evaluateTargeting: Beast Within stays on target permanent despite later token text', () => {
    const g = createInitialGameState('tgt_beast_within');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'sol_ring',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'ring', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'island',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'island_card', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Beast Within', 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.')!;
    expect(spec.op).toBe('DESTROY_TARGET');
    expect(spec.filter).toBe('PERMANENT');

    const targets = evaluateTargeting(g.state as any, p1, spec);
    expect(targets).toEqual(
      expect.arrayContaining([
        { kind: 'permanent', id: 'sol_ring' },
        { kind: 'permanent', id: 'island' },
      ])
    );
  });
});
