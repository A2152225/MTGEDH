import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, parseTargetRequirements, resolveSpell, type SpellSpec } from '../src/rules-engine/targeting';

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

  it('parseTargetRequirements resolves life-lost graveyard mana-value limits from context', () => {
    const reqs = parseTargetRequirements(
      'Return target creature card with mana value less than or equal to the amount of life you lost this turn from your graveyard to your hand.',
      {
        controllerId: 'p1',
        gameState: {
          lifeLostThisTurn: { p1: 4 },
        },
      },
    );

    expect(reqs.needsTargets).toBe(true);
    expect(reqs.targetTypes).toEqual(['graveyard_creature_card']);
    expect(reqs.targetFilterMaxManaValue).toBe(4);
    expect(reqs.targetDescription).toBe('target creature card in your graveyard with mana value 4 or less');
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
  it('GAIN_LIFE* / LOSE_LIFE* resolveSpell ops are deleted (P1a; categorize patterns kept for cast)', () => {
    const g = createInitialGameState('t_life_resolve_deleted');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    expect(resolveSpell(
      { op: 'GAIN_LIFE', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 3 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'GAIN_LIFE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 2 } as any,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'GAIN_LIFE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'GAIN_LIFE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'LOSE_LIFE', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'LOSE_LIFE_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 2 } as any,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'LOSE_LIFE_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'LOSE_LIFE_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
  });
});
