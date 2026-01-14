import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, type SpellSpec } from '../src/rules-engine/targeting';

describe('Oracle templates: bounce / tap / untap', () => {
  it('categorizeSpell: "Return target creature to its owner\'s hand." -> BOUNCE_TARGET', () => {
    const spec = categorizeSpell('Unsummon', "Return target creature to its owner's hand.");
    expect(spec?.op).toBe('BOUNCE_TARGET');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Tap target creature." -> TAP_TARGET', () => {
    const spec = categorizeSpell('Twiddle-ish', 'Tap target creature.');
    expect(spec?.op).toBe('TAP_TARGET');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Untap target permanent." -> UNTAP_TARGET', () => {
    const spec = categorizeSpell('Twiddle', 'Untap target permanent.');
    expect(spec?.op).toBe('UNTAP_TARGET');
    expect(spec?.filter).toBe('PERMANENT');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Tap all creatures." -> TAP_ALL', () => {
    const spec = categorizeSpell('Sleep-ish', 'Tap all creatures.');
    expect(spec?.op).toBe('TAP_ALL');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('categorizeSpell: "Tap all creatures your opponents control." -> TAP_ALL (opponents only)', () => {
    const spec = categorizeSpell('Blinding Light-ish', 'Tap all creatures your opponents control.');
    expect(spec?.op).toBe('TAP_ALL');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.opponentOnly).toBe(true);
    expect(spec?.controllerOnly).not.toBe(true);
  });

  it('categorizeSpell: "Untap all lands you control." -> UNTAP_ALL (controller only)', () => {
    const spec = categorizeSpell('Reset-ish', 'Untap all lands you control.');
    expect(spec?.op).toBe('UNTAP_ALL');
    expect(spec?.filter).toBe('LAND');
    expect(spec?.controllerOnly).toBe(true);
    expect(spec?.opponentOnly).not.toBe(true);
  });

  it('categorizeSpell: "Untap all nonland permanents you control." -> UNTAP_ALL (nonland, controller only)', () => {
    const spec = categorizeSpell('Paradox-ish', 'Untap all nonland permanents you control.');
    expect(spec?.op).toBe('UNTAP_ALL');
    expect(spec?.filter).toBe('PERMANENT');
    expect(spec?.nonlandOnly).toBe(true);
    expect(spec?.controllerOnly).toBe(true);
  });

  it('categorizeSpell: "Tap all creatures target player controls." -> TAP_ALL_TARGET_PLAYER', () => {
    const spec = categorizeSpell('Sleep-ish', 'Tap all creatures target player controls.');
    expect(spec?.op).toBe('TAP_ALL_TARGET_PLAYER');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Untap all lands target player controls." -> UNTAP_ALL_TARGET_PLAYER', () => {
    const spec = categorizeSpell('Reset-ish', 'Untap all lands target player controls.');
    expect(spec?.op).toBe('UNTAP_ALL_TARGET_PLAYER');
    expect(spec?.filter).toBe('LAND');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });
});

describe('Target evaluation: tap respects controller filter', () => {
  it('evaluateTargeting: TAP_TARGET creature only returns creature permanents', () => {
    const g = createInitialGameState('t_tap_targets');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'c_perm',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'c1', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'a_perm',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'a1', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    } as any);

    const spec: SpellSpec = { op: 'TAP_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 };
    const targets = evaluateTargeting(g.state as any, p1, spec, undefined);
    const ids = new Set(targets.filter(t => t.kind === 'permanent').map(t => t.id));

    expect(ids.has('c_perm')).toBe(true);
    expect(ids.has('a_perm')).toBe(false);
  });
});

describe('Execution via applyEvent(resolveSpell) for bounce / tap / untap', () => {
  it('BOUNCE_TARGET moves a nontoken permanent to owner hand', () => {
    const g = createInitialGameState('t_bounce_nontoken');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'perm1',
      owner: p2,
      controller: p2,
      tapped: false,
      isToken: false,
      card: { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const beforeHand = g.state.zones?.[p2]?.handCount ?? 0;

    const spec: SpellSpec = { op: 'BOUNCE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 };
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'unsummon',
      spec,
      chosen: [{ kind: 'permanent', id: 'perm1' } as TargetRef],
    });

    expect(g.state.battlefield.some(p => p.id === 'perm1')).toBe(false);
    expect(g.state.zones?.[p2]?.handCount ?? 0).toBe(beforeHand + 1);
    expect((g.state.zones?.[p2]?.hand || []).some((c: any) => c?.name === 'Grizzly Bears')).toBe(true);
  });

  it('BOUNCE_TARGET makes tokens cease to exist (not moved to hand)', () => {
    const g = createInitialGameState('t_bounce_token');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.createToken!(p2, 'P2 Token', 1, 2, 2);
    const tokenId = g.state.battlefield.find(p => (p as any).controller === p2)!.id;
    const beforeHand = g.state.zones?.[p2]?.handCount ?? 0;

    const spec: SpellSpec = { op: 'BOUNCE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 };
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'unsummon',
      spec,
      chosen: [{ kind: 'permanent', id: tokenId } as TargetRef],
    });

    expect(g.state.battlefield.some(p => p.id === tokenId)).toBe(false);
    expect(g.state.zones?.[p2]?.handCount ?? 0).toBe(beforeHand);
  });

  it('TAP_TARGET and UNTAP_TARGET toggle permanent tapped state', () => {
    const g = createInitialGameState('t_tap_untap');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'perm1',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const tapSpec: SpellSpec = { op: 'TAP_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 };
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'tap_spell',
      spec: tapSpec,
      chosen: [{ kind: 'permanent', id: 'perm1' } as TargetRef],
    });

    expect((g.state.battlefield.find(p => p.id === 'perm1') as any).tapped).toBe(true);

    const untapSpec: SpellSpec = { op: 'UNTAP_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 };
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'untap_spell',
      spec: untapSpec,
      chosen: [{ kind: 'permanent', id: 'perm1' } as TargetRef],
    });

    expect((g.state.battlefield.find(p => p.id === 'perm1') as any).tapped).toBe(false);
  });

  it('TAP_ALL taps all creatures', () => {
    const g = createInitialGameState('t_tap_all_creatures');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'c1',
      owner: p1,
      controller: p1,
      tapped: false,
      card: { id: 'bear1', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'c2',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'bear2', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'a1',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'ring', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Sleep-ish', 'Tap all creatures.')!;
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'tap_all',
      spec,
      chosen: [],
    });

    expect((g.state.battlefield.find(p => p.id === 'c1') as any).tapped).toBe(true);
    expect((g.state.battlefield.find(p => p.id === 'c2') as any).tapped).toBe(true);
    expect((g.state.battlefield.find(p => p.id === 'a1') as any).tapped).toBe(false);
  });

  it('TAP_ALL (opponents only) taps only opponents creatures', () => {
    const g = createInitialGameState('t_tap_all_opponents_creatures');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'c1',
      owner: p1,
      controller: p1,
      tapped: false,
      card: { id: 'bear1', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'c2',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'bear2', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Blinding Light-ish', 'Tap all creatures your opponents control.')!;
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'tap_all_opps',
      spec,
      chosen: [],
    });

    expect((g.state.battlefield.find(p => p.id === 'c1') as any).tapped).toBe(false);
    expect((g.state.battlefield.find(p => p.id === 'c2') as any).tapped).toBe(true);
  });

  it('UNTAP_ALL (lands you control) untaps only your lands', () => {
    const g = createInitialGameState('t_untap_all_lands_you_control');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'l1',
      owner: p1,
      controller: p1,
      tapped: true,
      card: { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'l2',
      owner: p2,
      controller: p2,
      tapped: true,
      card: { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'a1',
      owner: p1,
      controller: p1,
      tapped: true,
      card: { id: 'ring', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Reset-ish', 'Untap all lands you control.')!;
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'untap_lands',
      spec,
      chosen: [],
    });

    expect((g.state.battlefield.find(p => p.id === 'l1') as any).tapped).toBe(false);
    expect((g.state.battlefield.find(p => p.id === 'l2') as any).tapped).toBe(true);
    expect((g.state.battlefield.find(p => p.id === 'a1') as any).tapped).toBe(true);
  });

  it('UNTAP_ALL (nonland permanents you control) skips lands', () => {
    const g = createInitialGameState('t_untap_nonland_perms_you_control');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'l1',
      owner: p1,
      controller: p1,
      tapped: true,
      card: { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'a1',
      owner: p1,
      controller: p1,
      tapped: true,
      card: { id: 'ring', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'c2',
      owner: p2,
      controller: p2,
      tapped: true,
      card: { id: 'bear2', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Paradox-ish', 'Untap all nonland permanents you control.')!;
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'untap_nonlands',
      spec,
      chosen: [],
    });

    expect((g.state.battlefield.find(p => p.id === 'l1') as any).tapped).toBe(true);
    expect((g.state.battlefield.find(p => p.id === 'a1') as any).tapped).toBe(false);
    expect((g.state.battlefield.find(p => p.id === 'c2') as any).tapped).toBe(true);
  });

  it('TAP_ALL_TARGET_PLAYER taps only creatures controlled by the chosen player', () => {
    const g = createInitialGameState('t_tap_all_creatures_target_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'p2_creature',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'bear2', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p2_artifact',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'ring', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p1_creature',
      owner: p1,
      controller: p1,
      tapped: false,
      card: { id: 'bear1', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Sleep-ish', 'Tap all creatures target player controls.')!;
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'tap_all_target_player',
      spec,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });

    expect((g.state.battlefield.find(p => p.id === 'p2_creature') as any).tapped).toBe(true);
    expect((g.state.battlefield.find(p => p.id === 'p2_artifact') as any).tapped).toBe(false);
    expect((g.state.battlefield.find(p => p.id === 'p1_creature') as any).tapped).toBe(false);
  });

  it('UNTAP_ALL_TARGET_PLAYER untaps only lands controlled by the chosen player', () => {
    const g = createInitialGameState('t_untap_all_lands_target_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'p2_land',
      owner: p2,
      controller: p2,
      tapped: true,
      card: { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p2_creature',
      owner: p2,
      controller: p2,
      tapped: true,
      card: { id: 'bear2', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p1_land',
      owner: p1,
      controller: p1,
      tapped: true,
      card: { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Reset-ish', 'Untap all lands target player controls.')!;
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'untap_all_target_player',
      spec,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });

    expect((g.state.battlefield.find(p => p.id === 'p2_land') as any).tapped).toBe(false);
    expect((g.state.battlefield.find(p => p.id === 'p2_creature') as any).tapped).toBe(true);
    expect((g.state.battlefield.find(p => p.id === 'p1_land') as any).tapped).toBe(true);
  });
});
