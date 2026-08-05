import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, resolveSpell, type SpellSpec } from '../src/rules-engine/targeting';

describe('Oracle templates: draw/discard/counters/damage', () => {
  it('categorizeSpell: "Draw two cards." -> DRAW_CARDS', () => {
    const spec = categorizeSpell('Quick Study', 'Draw two cards.');
    expect(spec?.op).toBe('DRAW_CARDS');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
    expect(spec?.amount).toBe(2);
  });

  it('categorizeSpell: "Target player draws two cards." -> DRAW_TARGET_PLAYER', () => {
    const spec = categorizeSpell('Deep Analysis', 'Target player draws two cards.');
    expect(spec?.op).toBe('DRAW_TARGET_PLAYER');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
    expect(spec?.amount).toBe(2);
  });

  it('categorizeSpell: "Each opponent draws two cards." -> DRAW_CARDS_EACH_OPPONENT', () => {
    const spec = categorizeSpell('Howling Mine-ish', 'Each opponent draws two cards.');
    expect(spec?.op).toBe('DRAW_CARDS_EACH_OPPONENT');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
    expect(spec?.amount).toBe(2);
  });

  it('categorizeSpell: "Each player draws a card." -> DRAW_CARDS_EACH_PLAYER', () => {
    const spec = categorizeSpell('Wheel-ish', 'Each player draws a card.');
    expect(spec?.op).toBe('DRAW_CARDS_EACH_PLAYER');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
    expect(spec?.amount).toBe(1);
  });

  it('categorizeSpell: "Target player discards two cards." -> DISCARD_TARGET_PLAYER', () => {
    const spec = categorizeSpell('Mind Rot', 'Target player discards two cards.');
    expect(spec?.op).toBe('DISCARD_TARGET_PLAYER');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
    expect(spec?.amount).toBe(2);
  });

  it('categorizeSpell: "Each opponent discards two cards." -> DISCARD_EACH_OPPONENT', () => {
    const spec = categorizeSpell('Opp Discard', 'Each opponent discards two cards.');
    expect(spec?.op).toBe('DISCARD_EACH_OPPONENT');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
    expect(spec?.amount).toBe(2);
  });

  it('categorizeSpell: "Each player discards a card." -> DISCARD_EACH_PLAYER', () => {
    const spec = categorizeSpell('All Discard', 'Each player discards a card.');
    expect(spec?.op).toBe('DISCARD_EACH_PLAYER');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
    expect(spec?.amount).toBe(1);
  });

  it('categorizeSpell: "Put a +1/+1 counter on target creature." -> ADD_COUNTERS_TARGET', () => {
    const spec = categorizeSpell('Guiding Voice', 'Put a +1/+1 counter on target creature.');
    expect(spec?.op).toBe('ADD_COUNTERS_TARGET');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
    expect(spec?.counterType).toBe('+1/+1');
    expect(spec?.amount).toBe(1);
  });

  it('categorizeSpell: "Put a +1/+1 counter on up to one target creature." -> ADD_COUNTERS_TARGET (optional)', () => {
    const spec = categorizeSpell('The Wandering Emperor (line)', 'Put a +1/+1 counter on up to one target creature.');
    expect(spec?.op).toBe('ADD_COUNTERS_TARGET');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(1);
    expect(spec?.counterType).toBe('+1/+1');
    expect(spec?.amount).toBe(1);
  });

  it('categorizeSpell: "Put a -1/-1 counter on target creature." -> ADD_COUNTERS_TARGET', () => {
    const spec = categorizeSpell('Instill Infection', 'Put a -1/-1 counter on target creature.');
    expect(spec?.op).toBe('ADD_COUNTERS_TARGET');
    expect(spec?.counterType).toBe('-1/-1');
    expect(spec?.amount).toBe(1);
  });

  it('categorizeSpell: "Put a -1/-1 counter on up to one target creature." -> ADD_COUNTERS_TARGET (optional)', () => {
    const spec = categorizeSpell('Some -1/-1 thing', 'Put a -1/-1 counter on up to one target creature.');
    expect(spec?.op).toBe('ADD_COUNTERS_TARGET');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(1);
    expect(spec?.counterType).toBe('-1/-1');
    expect(spec?.amount).toBe(1);
  });

  it('categorizeSpell: "Put a +1/+1 counter on target creature that entered this turn." -> ADD_COUNTERS_TARGET + restriction', () => {
    const spec = categorizeSpell('Cathedral Acolyte', 'Put a +1/+1 counter on target creature that entered this turn.');
    expect(spec?.op).toBe('ADD_COUNTERS_TARGET');
    expect(spec?.counterType).toBe('+1/+1');
    expect(spec?.amount).toBe(1);
    expect(spec?.targetRestriction?.type).toBe('entered_this_turn');
  });

  it('evaluateTargeting: entered_this_turn restriction filters legal targets', () => {
    const g = createInitialGameState('t_add_counters_entered_this_turn');
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    g.state.battlefield = [
      {
        id: 'creature_entered',
        controller: p1,
        owner: p1,
        tapped: false,
        enteredThisTurn: true,
        card: { id: 'c_entered', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
      } as any,
      {
        id: 'creature_old',
        controller: p1,
        owner: p1,
        tapped: false,
        enteredThisTurn: false,
        card: { id: 'c_old', name: 'Wolf', type_line: 'Creature — Wolf', oracle_text: '' },
      } as any,
    ];

    const spec = categorizeSpell('Cathedral Acolyte', 'Put a +1/+1 counter on target creature that entered this turn.')!;
    const targets = evaluateTargeting(g.state, p1, spec);
    expect(targets).toEqual([{ kind: 'permanent', id: 'creature_entered' } as TargetRef]);
  });

  it('evaluateTargeting: up to one target creature still enumerates legal creatures', () => {
    const g = createInitialGameState('t_add_counters_up_to_one');
    const p1 = 'p1' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    g.state.battlefield = [
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'c1', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
      } as any,
    ];

    const spec = categorizeSpell('The Wandering Emperor (line)', 'Put a +1/+1 counter on up to one target creature.')!;
    const targets = evaluateTargeting(g.state, p1, spec);
    expect(targets).toEqual([{ kind: 'permanent', id: 'creature_1' } as TargetRef]);
  });

  it('categorizeSpell: "Put a +1/+1 counter on each of up to two target creatures." -> multi-target ADD_COUNTERS_TARGET', () => {
    const spec = categorizeSpell('Travel Preparations', 'Put a +1/+1 counter on each of up to two target creatures.');
    expect(spec?.op).toBe('ADD_COUNTERS_TARGET');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(2);
    expect(spec?.counterType).toBe('+1/+1');
    expect(spec?.amount).toBe(1);
  });

  it('categorizeSpell: "Put a -1/-1 counter on each of up to two target creatures." -> multi-target ADD_COUNTERS_TARGET', () => {
    const spec = categorizeSpell('Sample -1/-1', 'Put a -1/-1 counter on each of up to two target creatures.');
    expect(spec?.op).toBe('ADD_COUNTERS_TARGET');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(2);
    expect(spec?.counterType).toBe('-1/-1');
    expect(spec?.amount).toBe(1);
  });

  it('categorizeSpell: "Put a +1/+1 counter on each creature you control." -> ADD_COUNTERS_EACH', () => {
    const spec = categorizeSpell("Basri's Solidarity", 'Put a +1/+1 counter on each creature you control.');
    expect(spec?.op).toBe('ADD_COUNTERS_EACH');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
    expect(spec?.counterType).toBe('+1/+1');
    expect(spec?.controllerOnly).toBe(true);
  });

  it('categorizeSpell: "...deals 3 damage to target creature or planeswalker." -> DAMAGE_TARGET + multiFilter', () => {
    const spec = categorizeSpell('Strangle', 'Strangle deals 3 damage to target creature or planeswalker.');
    expect(spec?.op).toBe('DAMAGE_TARGET');
    expect(spec?.amount).toBe(3);
    expect(spec?.multiFilter?.includes('CREATURE')).toBe(true);
    expect(spec?.multiFilter?.includes('PLANESWALKER')).toBe(true);
  });
});

describe('Execution via applyEvent(resolveSpell) for new EngineEffect kinds', () => {
  it('DRAW_* resolveSpell ops are deleted (P1a; categorize patterns kept for cast)', () => {
    const g = createInitialGameState('t_draw_resolve_deleted');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    expect(resolveSpell(
      { op: 'DRAW_CARDS', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as SpellSpec,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DRAW_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 2 } as SpellSpec,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DRAW_CARDS_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DRAW_CARDS_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
  });

  it('DISCARD_* resolveSpell ops are deleted (P1a; categorize patterns kept for cast)', () => {
    const g = createInitialGameState('t_discard_resolve_deleted');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    expect(resolveSpell(
      { op: 'DISCARD_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: 2 } as SpellSpec,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DISCARD_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'DISCARD_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, amount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
  });

  it('ADD_COUNTERS_* resolveSpell ops are deleted (P1a; categorize patterns kept for cast)', () => {
    const g = createInitialGameState('t_add_counters_resolve_deleted');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.createToken!(p1, 'P1 Creature', 1, 2, 2);
    const creatureId = g.state.battlefield[0].id;

    expect(resolveSpell(
      {
        op: 'ADD_COUNTERS_TARGET',
        filter: 'CREATURE',
        minTargets: 1,
        maxTargets: 1,
        amount: 1,
        counterType: '+1/+1',
      } as SpellSpec,
      [{ kind: 'permanent', id: creatureId } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      {
        op: 'ADD_COUNTERS_EACH',
        filter: 'CREATURE',
        minTargets: 0,
        maxTargets: 0,
        amount: 1,
        counterType: '+1/+1',
        controllerOnly: true,
      } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
  });

  it('evaluateTargeting: DAMAGE_TARGET creature-or-planeswalker includes both', () => {
    const g = createInitialGameState('t_eval_target_damage_c_or_pw');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    // Creature
    g.createToken!(p2, 'Opp Creature', 1, 2, 2);
    const creatureId = g.state.battlefield[0].id;

    // Planeswalker stub
    g.state.battlefield.push({
      id: 'pw1',
      controller: p2,
      owner: p2,
      tapped: false,
      counters: { loyalty: 3 },
      card: { name: 'Test Walker', type_line: 'Planeswalker', oracle_text: '' } as any,
    } as any);

    const spec = categorizeSpell('Strangle', 'Strangle deals 3 damage to target creature or planeswalker.') as SpellSpec;
    const refs = evaluateTargeting(g.state as any, p1, spec);
    const ids = new Set(refs.filter(r => r.kind === 'permanent').map(r => r.id));

    expect(ids.has(creatureId)).toBe(true);
    expect(ids.has('pw1')).toBe(true);
  });
});
