import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, resolveSpell, type SpellSpec } from '../src/rules-engine/targeting';

describe('Oracle templates: tokens / scry / mill / goad', () => {
  it('categorizeSpell: "Investigate." -> INVESITGATE (Clue token)', () => {
    const spec = categorizeSpell('Hard Evidence', 'Investigate. (Create a Clue token. It\'s an artifact with "2, Sacrifice this artifact: Draw a card.")');
    expect(spec?.op).toBe('INVESTIGATE');
    expect(spec?.tokenKind).toBe('CLUE');
    expect(spec?.tokenCount).toBe(1);
  });

  it('categorizeSpell: "Create a Treasure token." -> CREATE_TOKEN', () => {
    const spec = categorizeSpell('Strike It Rich', 'Create a Treasure token. (It\'s an artifact with "T, Sacrifice this artifact: Add one mana of any color.")');
    expect(spec?.op).toBe('CREATE_TOKEN');
    expect(spec?.tokenKind).toBe('TREASURE');
    expect(spec?.tokenCount).toBe(1);
  });

  it('categorizeSpell: "Create a 1/1 green Saproling creature token." -> CREATE_TOKEN creature', () => {
    const spec = categorizeSpell('Sprout', 'Create a 1/1 green Saproling creature token.');
    expect(spec?.op).toBe('CREATE_TOKEN');
    expect(spec?.tokenKind).toBe('CREATURE');
    expect(spec?.tokenCount).toBe(1);
    expect(spec?.tokenPower).toBe(1);
    expect(spec?.tokenToughness).toBe(1);
    expect(spec?.tokenColor).toBe('green');
    expect(spec?.tokenSubtype).toBe('Saproling');
  });

  it('categorizeSpell: "Scry 2." -> SCRY', () => {
    const spec = categorizeSpell('Magma Jet', 'Scry 2. (Look at the top two cards of your library, then put any number of them on the bottom of your library and the rest on top in any order.)');
    expect(spec?.op).toBe('SCRY');
    expect(spec?.scryCount).toBe(2);
  });

  it('categorizeSpell: "Each opponent scries 2." -> SCRY_EACH_OPPONENT', () => {
    const spec = categorizeSpell('Opp Scry', 'Each opponent scries 2.');
    expect(spec?.op).toBe('SCRY_EACH_OPPONENT');
    expect(spec?.scryCount).toBe(2);
  });

  it('categorizeSpell: "Each player scries 1." -> SCRY_EACH_PLAYER', () => {
    const spec = categorizeSpell('All Scry', 'Each player scries 1.');
    expect(spec?.op).toBe('SCRY_EACH_PLAYER');
    expect(spec?.scryCount).toBe(1);
  });

  it('categorizeSpell: "Each opponent surveils 2." -> SURVEIL_EACH_OPPONENT', () => {
    const spec = categorizeSpell('Opp Surveil', 'Each opponent surveils 2.');
    expect(spec?.op).toBe('SURVEIL_EACH_OPPONENT');
    expect(spec?.surveilCount).toBe(2);
  });

  it('categorizeSpell: "Each player surveils 1." -> SURVEIL_EACH_PLAYER', () => {
    const spec = categorizeSpell('All Surveil', 'Each player surveils 1.');
    expect(spec?.op).toBe('SURVEIL_EACH_PLAYER');
    expect(spec?.surveilCount).toBe(1);
  });

  it('categorizeSpell: "Mill two cards." -> MILL_SELF', () => {
    const spec = categorizeSpell('Mental Note', 'Mill two cards.');
    expect(spec?.op).toBe('MILL_SELF');
    expect(spec?.millCount).toBe(2);
  });

  it('categorizeSpell: "Target player mills two cards." -> MILL_TARGET_PLAYER', () => {
    const spec = categorizeSpell('Thought Scour', 'Target player mills two cards.');
    expect(spec?.op).toBe('MILL_TARGET_PLAYER');
    expect(spec?.millCount).toBe(2);
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: Increasing Confusion mills X (2X from graveyard)', () => {
    const oracle =
      'Target player mills X cards. If this spell was cast from a graveyard, that player mills twice that many cards instead.\nFlashback {X}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)';
    const spec = categorizeSpell('Increasing Confusion', oracle);
    expect(spec?.op).toBe('MILL_TARGET_PLAYER');
    expect(spec?.millCountIsX).toBe(true);
    expect(spec?.millCountDoubleIfCastFromGraveyard).toBe(true);
    expect(spec?.minTargets).toBe(1);
    expect(spec?.maxTargets).toBe(1);
  });

  it('categorizeSpell: "Each opponent mills two cards." -> MILL_EACH_OPPONENT', () => {
    const spec = categorizeSpell('Opp Mill', 'Each opponent mills two cards.');
    expect(spec?.op).toBe('MILL_EACH_OPPONENT');
    expect(spec?.millCount).toBe(2);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('categorizeSpell: "Each player mills a card." -> MILL_EACH_PLAYER', () => {
    const spec = categorizeSpell('All Mill', 'Each player mills a card.');
    expect(spec?.op).toBe('MILL_EACH_PLAYER');
    expect(spec?.millCount).toBe(1);
    expect(spec?.minTargets).toBe(0);
    expect(spec?.maxTargets).toBe(0);
  });

  it('categorizeSpell: "Goad target creature an opponent controls." -> GOAD_TARGET (opponentOnly)', () => {
    const spec = categorizeSpell('Laser Screwdriver', 'Goad target creature an opponent controls. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)');
    expect(spec?.op).toBe('GOAD_TARGET');
    expect(spec?.opponentOnly).toBe(true);
  });
});

describe('Execution via applyEvent(resolveSpell) for tokens / scry / mill / goad', () => {
  it('CREATE_TOKEN / INVESTIGATE / GOAD_TARGET resolveSpell ops are deleted (P1a; categorize patterns kept for cast)', () => {
    const g = createInitialGameState('t_token_goad_resolve_deleted');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.createToken!(p2, 'P2 Creature', 1, 2, 2);
    const creatureId = g.state.battlefield.find(p => (p as any).controller === p2)!.id;

    expect(resolveSpell(
      { op: 'CREATE_TOKEN', filter: 'ANY', minTargets: 0, maxTargets: 0, tokenKind: 'TREASURE', tokenCount: 1 } as SpellSpec,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'INVESTIGATE', filter: 'ANY', minTargets: 0, maxTargets: 0, tokenKind: 'CLUE', tokenCount: 1 } as SpellSpec,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'GOAD_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 } as SpellSpec,
      [{ kind: 'permanent', id: creatureId } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
  });

  it('SCRY_*/SURVEIL_*/MILL_* resolveSpell ops are deleted (P1a; categorize patterns kept for cast)', () => {
    const g = createInitialGameState('t_scry_surveil_mill_resolve_deleted');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    expect(resolveSpell(
      { op: 'SCRY', filter: 'ANY', minTargets: 0, maxTargets: 0, scryCount: 2 } as SpellSpec,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'SCRY_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, scryCount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'SCRY_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, scryCount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'SURVEIL', filter: 'ANY', minTargets: 0, maxTargets: 0, surveilCount: 2 } as SpellSpec,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'SURVEIL_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, surveilCount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'SURVEIL_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, surveilCount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'SURVEIL_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, surveilCount: 1 } as SpellSpec,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'MILL_SELF', filter: 'ANY', minTargets: 0, maxTargets: 0, millCount: 2 } as SpellSpec,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'MILL_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, millCount: 2 } as SpellSpec,
      [{ kind: 'player', id: p2 } as TargetRef],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'MILL_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, millCount: 2 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
    expect(resolveSpell(
      { op: 'MILL_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, millCount: 1 } as any,
      [],
      g.state as any,
      p1,
    )).toEqual([]);
  });

  it('evaluateTargeting respects opponentOnly for goad', () => {
    const g = createInitialGameState('t_goad_opponent_only');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.createToken!(p1, 'P1 Creature', 1, 2, 2);
    g.createToken!(p2, 'P2 Creature', 1, 2, 2);

    const spec: SpellSpec = { op: 'GOAD_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, opponentOnly: true };
    const targets = evaluateTargeting(g.state as any, p1, spec, undefined);

    const ids = new Set(targets.filter(t => t.kind === 'permanent').map(t => t.id));
    const p1CreatureId = g.state.battlefield.find(p => (p as any).controller === p1)!.id;
    const p2CreatureId = g.state.battlefield.find(p => (p as any).controller === p2)!.id;

    expect(ids.has(p1CreatureId)).toBe(false);
    expect(ids.has(p2CreatureId)).toBe(true);
  });
});
