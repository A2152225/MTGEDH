import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, type SpellSpec } from '../src/rules-engine/targeting';

describe('Oracle templates: surveil + multiword creature tokens', () => {
  it('categorizeSpell: "Surveil 2." -> SURVEIL', () => {
    const spec = categorizeSpell('Consider', 'Surveil 1.');
    expect(spec?.op).toBe('SURVEIL');
    expect(spec?.surveilCount).toBe(1);
  });

  it('categorizeSpell: "Target player surveils two." -> SURVEIL_TARGET_PLAYER', () => {
    const spec = categorizeSpell('Surveil Spell', 'Target player surveils two. (Look at the top two cards of your library...)');
    expect(spec?.op).toBe('SURVEIL_TARGET_PLAYER');
    expect(spec?.surveilCount).toBe(2);
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Create a 3/3 green Frog Lizard creature token." -> CREATE_TOKEN with multiword subtype', () => {
    const spec = categorizeSpell('Pongify-ish', 'Create a 3/3 green Frog Lizard creature token.');
    expect(spec?.op).toBe('CREATE_TOKEN');
    expect(spec?.tokenKind).toBe('CREATURE');
    expect(spec?.tokenPower).toBe(3);
    expect(spec?.tokenToughness).toBe(3);
    expect(spec?.tokenColor).toBe('green');
    expect(spec?.tokenSubtype).toBe('Frog Lizard');
  });

  it('evaluateTargeting: SURVEIL_TARGET_PLAYER offers players', () => {
    const g = createInitialGameState('t_eval_surv_target');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    const spec: SpellSpec = { op: 'SURVEIL_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, surveilCount: 2 };
    const targets = evaluateTargeting(g.state as any, p1, spec, undefined);
    const ids = new Set(targets.filter(t => t.kind === 'player').map(t => t.id));

    expect(ids.has(p1)).toBe(true);
    expect(ids.has(p2)).toBe(true);
  });
});

describe('Execution via applyEvent(resolveSpell) for QueueSurveil', () => {
  it('SURVEIL sets pendingSurveil for caster (test/replay path)', () => {
    const g = createInitialGameState('t_surv_pending');
    const p1 = 'p1' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const spec: SpellSpec = { op: 'SURVEIL', filter: 'ANY', minTargets: 0, maxTargets: 0, surveilCount: 2 };
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'surveil2', spec, chosen: [] });

    expect((g.state as any).pendingSurveil?.[p1]).toBe(2);
  });

  it('SURVEIL_TARGET_PLAYER sets pendingSurveil for chosen player', () => {
    const g = createInitialGameState('t_surv_pending_target');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    const spec: SpellSpec = { op: 'SURVEIL_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, surveilCount: 1 };
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'surveil_target',
      spec,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });

    expect((g.state as any).pendingSurveil?.[p2]).toBe(1);
  });
});
