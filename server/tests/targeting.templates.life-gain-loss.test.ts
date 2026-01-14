import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, type SpellSpec } from '../src/rules-engine/targeting';

describe('Oracle templates: gain / lose life', () => {
  it('categorizeSpell: "Gain 3 life." -> GAIN_LIFE', () => {
    const spec = categorizeSpell('Heal', 'Gain 3 life.');
    expect(spec?.op).toBe('GAIN_LIFE');
    expect((spec as any)?.amount).toBe(3);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('categorizeSpell: "Target player gains 2 life." -> GAIN_LIFE_TARGET_PLAYER', () => {
    const spec = categorizeSpell('Aid', 'Target player gains 2 life.');
    expect(spec?.op).toBe('GAIN_LIFE_TARGET_PLAYER');
    expect((spec as any)?.amount).toBe(2);
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Each opponent gains 1 life." -> GAIN_LIFE_EACH_OPPONENT', () => {
    const spec = categorizeSpell('Group Hug', 'Each opponent gains 1 life.');
    expect(spec?.op).toBe('GAIN_LIFE_EACH_OPPONENT');
    expect((spec as any)?.amount).toBe(1);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('categorizeSpell: "Each player gains 2 life." -> GAIN_LIFE_EACH_PLAYER', () => {
    const spec = categorizeSpell('Team Heal', 'Each player gains 2 life.');
    expect(spec?.op).toBe('GAIN_LIFE_EACH_PLAYER');
    expect((spec as any)?.amount).toBe(2);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('categorizeSpell: "You lose 4 life." -> LOSE_LIFE', () => {
    const spec = categorizeSpell('Pain', 'You lose 4 life.');
    expect(spec?.op).toBe('LOSE_LIFE');
    expect((spec as any)?.amount).toBe(4);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('categorizeSpell: "Target player loses two life." -> LOSE_LIFE_TARGET_PLAYER', () => {
    const spec = categorizeSpell('Drain', 'Target player loses two life.');
    expect(spec?.op).toBe('LOSE_LIFE_TARGET_PLAYER');
    expect((spec as any)?.amount).toBe(2);
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Each opponent loses 1 life." -> LOSE_LIFE_EACH_OPPONENT', () => {
    const spec = categorizeSpell('Blood Artist-ish', 'Each opponent loses 1 life.');
    expect(spec?.op).toBe('LOSE_LIFE_EACH_OPPONENT');
    expect((spec as any)?.amount).toBe(1);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('categorizeSpell: "Each player loses 2 life." -> LOSE_LIFE_EACH_PLAYER', () => {
    const spec = categorizeSpell('Pox-ish', 'Each player loses 2 life.');
    expect(spec?.op).toBe('LOSE_LIFE_EACH_PLAYER');
    expect((spec as any)?.amount).toBe(2);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });
});

describe('Target evaluation: gain/lose life target player', () => {
  it('evaluateTargeting includes players for target-player variants', () => {
    const g = createInitialGameState('t_life_targets');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    const spec: SpellSpec = { op: 'LOSE_LIFE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 2 } as any;
    const targets = evaluateTargeting(g.state as any, p1, spec, undefined);
    const ids = new Set(targets.filter(t => t.kind === 'player').map(t => t.id));

    expect(ids.has(p1)).toBe(true);
    expect(ids.has(p2)).toBe(true);
  });
});

describe('Execution via applyEvent(resolveSpell) for gain / lose life', () => {
  it('GAIN_LIFE increases caster life', () => {
    const g = createInitialGameState('t_gain_life');
    const p1 = 'p1' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const before = g.state.players.find(p => (p as any).id === p1) as any;
    const beforeLife = before?.life ?? 40;

    const spec: SpellSpec = { op: 'GAIN_LIFE', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 3 } as any;
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'heal', spec, chosen: [] });

    const after = g.state.players.find(p => (p as any).id === p1) as any;
    expect(after.life).toBe(beforeLife + 3);
  });

  it('GAIN_LIFE_EACH_OPPONENT increases each opponent (not caster)', () => {
    const g = createInitialGameState('t_gain_each_opponent');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent!({ type: 'join', playerId: p3, name: 'P3' });

    const lifeBefore = new Map<string, number>();
    for (const pl of g.state.players as any[]) lifeBefore.set(pl.id, pl.life ?? 40);

    const spec: SpellSpec = { op: 'GAIN_LIFE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as any;
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'gain_each_opponent', spec, chosen: [] });

    const after1 = (g.state.players.find(p => (p as any).id === p1) as any).life;
    const after2 = (g.state.players.find(p => (p as any).id === p2) as any).life;
    const after3 = (g.state.players.find(p => (p as any).id === p3) as any).life;
    expect(after1).toBe(lifeBefore.get(p1));
    expect(after2).toBe((lifeBefore.get(p2) ?? 40) + 2);
    expect(after3).toBe((lifeBefore.get(p3) ?? 40) + 2);
  });

  it('GAIN_LIFE_EACH_PLAYER increases all players', () => {
    const g = createInitialGameState('t_gain_each_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent!({ type: 'join', playerId: p3, name: 'P3' });

    const lifeBefore = new Map<string, number>();
    for (const pl of g.state.players as any[]) lifeBefore.set(pl.id, pl.life ?? 40);

    const spec: SpellSpec = { op: 'GAIN_LIFE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 1 } as any;
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'gain_each_player', spec, chosen: [] });

    for (const pl of g.state.players as any[]) {
      expect(pl.life).toBe((lifeBefore.get(pl.id) ?? 40) + 1);
    }
  });

  it('LOSE_LIFE_TARGET_PLAYER decreases chosen player life', () => {
    const g = createInitialGameState('t_lose_life_target');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    const before = g.state.players.find(p => (p as any).id === p2) as any;
    const beforeLife = before?.life ?? 40;

    const spec: SpellSpec = { op: 'LOSE_LIFE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 2 } as any;
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'drain',
      spec,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });

    const after = g.state.players.find(p => (p as any).id === p2) as any;
    expect(after.life).toBe(beforeLife - 2);
  });

  it('LOSE_LIFE_EACH_OPPONENT decreases each opponent (not caster)', () => {
    const g = createInitialGameState('t_lose_each_opponent');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent!({ type: 'join', playerId: p3, name: 'P3' });

    const lifeBefore = new Map<string, number>();
    for (const pl of g.state.players as any[]) lifeBefore.set(pl.id, pl.life ?? 40);

    const spec: SpellSpec = { op: 'LOSE_LIFE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as any;
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'lose_each_opponent', spec, chosen: [] });

    const after1 = (g.state.players.find(p => (p as any).id === p1) as any).life;
    const after2 = (g.state.players.find(p => (p as any).id === p2) as any).life;
    const after3 = (g.state.players.find(p => (p as any).id === p3) as any).life;
    expect(after1).toBe(lifeBefore.get(p1));
    expect(after2).toBe((lifeBefore.get(p2) ?? 40) - 2);
    expect(after3).toBe((lifeBefore.get(p3) ?? 40) - 2);
  });

  it('LOSE_LIFE_EACH_PLAYER decreases all players', () => {
    const g = createInitialGameState('t_lose_each_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent!({ type: 'join', playerId: p3, name: 'P3' });

    const lifeBefore = new Map<string, number>();
    for (const pl of g.state.players as any[]) lifeBefore.set(pl.id, pl.life ?? 40);

    const spec: SpellSpec = { op: 'LOSE_LIFE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 1 } as any;
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'lose_each_player', spec, chosen: [] });

    for (const pl of g.state.players as any[]) {
      expect(pl.life).toBe((lifeBefore.get(pl.id) ?? 40) - 1);
    }
  });
});
