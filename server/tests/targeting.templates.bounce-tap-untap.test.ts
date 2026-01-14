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

  it('categorizeSpell: "Return target artifact to its owner\'s hand." -> BOUNCE_TARGET (ARTIFACT)', () => {
    const spec = categorizeSpell('Hurkyl-ish', "Return target artifact to its owner's hand.");
    expect(spec?.op).toBe('BOUNCE_TARGET');
    expect(spec?.filter).toBe('ARTIFACT');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Return up to two target creatures to their owners\' hands." -> BOUNCE_TARGET (max 2)', () => {
    const spec = categorizeSpell('BounceTwo', "Return up to two target creatures to their owners' hands.");
    expect(spec?.op).toBe('BOUNCE_TARGET');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(2);
  });

  it('categorizeSpell: "Return up to two target nonland permanents to their owners\' hands." -> BOUNCE_TARGET (PERMANENT + nonlandOnly)', () => {
    const spec = categorizeSpell('BounceNonlands', "Return up to two target nonland permanents to their owners' hands.");
    expect(spec?.op).toBe('BOUNCE_TARGET');
    expect(spec?.filter).toBe('PERMANENT');
    expect(spec?.nonlandOnly).toBe(true);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(2);
  });

  it('categorizeSpell: "Tap target creature." -> TAP_TARGET', () => {
    const spec = categorizeSpell('Twiddle-ish', 'Tap target creature.');
    expect(spec?.op).toBe('TAP_TARGET');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Tap target creature an opponent controls." -> TAP_TARGET (opponentOnly)', () => {
    const spec = categorizeSpell('TapOpp', 'Tap target creature an opponent controls.');
    expect(spec?.op).toBe('TAP_TARGET');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.opponentOnly).toBe(true);
    expect(spec?.controllerOnly).not.toBe(true);
  });

  it('categorizeSpell: "Tap target land." -> TAP_TARGET (LAND)', () => {
    const spec = categorizeSpell('Ice', 'Tap target land.');
    expect(spec?.op).toBe('TAP_TARGET');
    expect(spec?.filter).toBe('LAND');
  });

  it('categorizeSpell: "Tap target nonland permanent." -> TAP_TARGET (PERMANENT + nonlandOnly)', () => {
    const spec = categorizeSpell('Freeze', 'Tap target nonland permanent.');
    expect(spec?.op).toBe('TAP_TARGET');
    expect(spec?.filter).toBe('PERMANENT');
    expect(spec?.nonlandOnly).toBe(true);
  });

  it('categorizeSpell: "Tap up to two target nonland permanents." -> TAP_TARGET (PERMANENT + nonlandOnly, max 2)', () => {
    const spec = categorizeSpell('TapNonlands', 'Tap up to two target nonland permanents.');
    expect(spec?.op).toBe('TAP_TARGET');
    expect(spec?.filter).toBe('PERMANENT');
    expect(spec?.nonlandOnly).toBe(true);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(2);
  });

  it('categorizeSpell: "Tap target attacking or blocking creature." -> TAP_TARGET with attacked_or_blocked_this_turn restriction', () => {
    const spec = categorizeSpell('TapCombat', 'Tap target attacking or blocking creature.');
    expect(spec?.op).toBe('TAP_TARGET');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.targetRestriction?.type).toBe('attacked_or_blocked_this_turn');
  });

  it('categorizeSpell: "Tap target creature that entered this turn." -> TAP_TARGET with entered_this_turn restriction', () => {
    const spec = categorizeSpell('TapNew', 'Tap target creature that entered this turn.');
    expect(spec?.op).toBe('TAP_TARGET');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.targetRestriction?.type).toBe('entered_this_turn');
  });

  it('categorizeSpell: "Untap target permanent." -> UNTAP_TARGET', () => {
    const spec = categorizeSpell('Twiddle', 'Untap target permanent.');
    expect(spec?.op).toBe('UNTAP_TARGET');
    expect(spec?.filter).toBe('PERMANENT');
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Untap target creature you control." -> UNTAP_TARGET (controllerOnly)', () => {
    const spec = categorizeSpell('UntapMine', 'Untap target creature you control.');
    expect(spec?.op).toBe('UNTAP_TARGET');
    expect(spec?.filter).toBe('CREATURE');
    expect(spec?.controllerOnly).toBe(true);
    expect(spec?.opponentOnly).not.toBe(true);
  });

  it('categorizeSpell: "Untap target planeswalker." -> UNTAP_TARGET (PLANESWALKER)', () => {
    const spec = categorizeSpell('Wake', 'Untap target planeswalker.');
    expect(spec?.op).toBe('UNTAP_TARGET');
    expect(spec?.filter).toBe('PLANESWALKER');
  });

  it('categorizeSpell: "Untap up to two target nonland permanents." -> UNTAP_TARGET (PERMANENT + nonlandOnly, max 2)', () => {
    const spec = categorizeSpell('UntapNonlands', 'Untap up to two target nonland permanents.');
    expect(spec?.op).toBe('UNTAP_TARGET');
    expect(spec?.filter).toBe('PERMANENT');
    expect(spec?.nonlandOnly).toBe(true);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(2);
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

describe('Target evaluation: single-target controller/opponent scopes', () => {
  it('evaluateTargeting: opponentOnly excludes caster-controlled permanents', () => {
    const g = createInitialGameState('t_scope_opponent_only');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'p1_creature',
      owner: p1,
      controller: p1,
      tapped: false,
      card: { id: 'c1', name: 'P1 Bear', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p2_creature',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'c2', name: 'P2 Bear', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('TapOpp', 'Tap target creature an opponent controls.')!;
    const targets = evaluateTargeting(g.state as any, p1, spec);
    const ids = new Set(targets.filter(t => t.kind === 'permanent').map(t => t.id));

    expect(ids.has('p1_creature')).toBe(false);
    expect(ids.has('p2_creature')).toBe(true);
  });

  it('evaluateTargeting: controllerOnly excludes opponent-controlled permanents', () => {
    const g = createInitialGameState('t_scope_controller_only');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'p1_creature',
      owner: p1,
      controller: p1,
      tapped: true,
      card: { id: 'c1', name: 'P1 Bear', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p2_creature',
      owner: p2,
      controller: p2,
      tapped: true,
      card: { id: 'c2', name: 'P2 Bear', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('UntapMine', 'Untap target creature you control.')!;
    const targets = evaluateTargeting(g.state as any, p1, spec);
    const ids = new Set(targets.filter(t => t.kind === 'permanent').map(t => t.id));

    expect(ids.has('p1_creature')).toBe(true);
    expect(ids.has('p2_creature')).toBe(false);
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

  it('evaluateTargeting: nonlandOnly excludes lands for PERMANENT filter', () => {
    const g = createInitialGameState('t_nonland_targets');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'land1',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'island', name: 'Island', type_line: 'Land — Island', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'art1',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'ring', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    } as any);

    const spec: SpellSpec = { op: 'TAP_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 1, nonlandOnly: true };
    const targets = evaluateTargeting(g.state as any, p1, spec, undefined);
    const ids = new Set(targets.filter(t => t.kind === 'permanent').map(t => t.id));

    expect(ids.has('land1')).toBe(false);
    expect(ids.has('art1')).toBe(true);
  });

  it('evaluateTargeting: TAP_TARGET with combat restriction only returns attackers/blockers', () => {
    const g = createInitialGameState('t_tap_attacking_or_blocking');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'attacker',
      owner: p2,
      controller: p2,
      tapped: false,
      attacking: true,
      card: { id: 'c1', name: 'Attacker', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'idle',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'c2', name: 'Idle', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('TapCombat', 'Tap target attacking or blocking creature.')!;
    const targets = evaluateTargeting(g.state as any, p1, spec, undefined);
    const ids = new Set(targets.filter(t => t.kind === 'permanent').map(t => t.id));

    expect(ids.has('attacker')).toBe(true);
    expect(ids.has('idle')).toBe(false);
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

  it('TAP_TARGET with nonlandOnly does not tap lands (defensive)', () => {
    const g = createInitialGameState('t_tap_nonland_defensive');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'land1',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'island', name: 'Island', type_line: 'Land — Island', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Freeze', 'Tap target nonland permanent.')!;
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'freeze',
      spec,
      chosen: [{ kind: 'permanent', id: 'land1' } as TargetRef],
    });

    expect((g.state.battlefield.find(p => p.id === 'land1') as any).tapped).toBe(false);
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
