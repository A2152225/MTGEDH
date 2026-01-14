import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, evaluateTargeting, type SpellSpec } from '../src/rules-engine/targeting';

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
  it('CREATE_TOKEN creates a Treasure token on battlefield', () => {
    const g = createInitialGameState('t_create_treasure');
    const p1 = 'p1' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const before = g.state.battlefield.length;

    const spec: SpellSpec = {
      op: 'CREATE_TOKEN',
      filter: 'ANY',
      minTargets: 0,
      maxTargets: 0,
      tokenKind: 'TREASURE',
      tokenCount: 1,
    };

    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'strike_it_rich', spec, chosen: [] });

    expect(g.state.battlefield.length).toBe(before + 1);
    expect(g.state.battlefield.some(p => (p as any)?.card?.name === 'Treasure')).toBe(true);
  });

  it('INVESTIGATE creates a Clue token on battlefield', () => {
    const g = createInitialGameState('t_investigate');
    const p1 = 'p1' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const before = g.state.battlefield.length;

    const spec: SpellSpec = {
      op: 'INVESTIGATE',
      filter: 'ANY',
      minTargets: 0,
      maxTargets: 0,
      tokenKind: 'CLUE',
      tokenCount: 1,
    };

    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'hard_evidence', spec, chosen: [] });

    expect(g.state.battlefield.length).toBe(before + 1);
    expect(g.state.battlefield.some(p => (p as any)?.card?.name === 'Clue')).toBe(true);
  });

  it('SCRY sets pendingScry for caster during replay/test path', () => {
    const g = createInitialGameState('t_scry_pending');
    const p1 = 'p1' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    const spec: SpellSpec = { op: 'SCRY', filter: 'ANY', minTargets: 0, maxTargets: 0, scryCount: 2 };
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'scry2', spec, chosen: [] });

    expect((g.state as any).pendingScry?.[p1]).toBe(2);
  });

  it('MILL_SELF mills from library into graveyard for caster', () => {
    const g = createInitialGameState('t_mill_self');
    const p1 = 'p1' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });

    g.importDeckResolved(p1, [
      { id: 'c1', name: 'Card 1', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c2', name: 'Card 2', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c3', name: 'Card 3', type_line: 'Instant', oracle_text: '' } as any,
    ]);

    const beforeLib = g.state.zones?.[p1]?.libraryCount ?? 0;
    const beforeGy = g.state.zones?.[p1]?.graveyardCount ?? 0;

    const spec: SpellSpec = { op: 'MILL_SELF', filter: 'ANY', minTargets: 0, maxTargets: 0, millCount: 2 };
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'mental_note', spec, chosen: [] });

    const afterLib = g.state.zones?.[p1]?.libraryCount ?? 0;
    const afterGy = g.state.zones?.[p1]?.graveyardCount ?? 0;

    expect(afterLib).toBe(beforeLib - 2);
    expect(afterGy).toBe(beforeGy + 2);
  });

  it('MILL_TARGET_PLAYER mills for chosen player', () => {
    const g = createInitialGameState('t_mill_target_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.importDeckResolved(p2, [
      { id: 'c1', name: 'Card 1', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c2', name: 'Card 2', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c3', name: 'Card 3', type_line: 'Instant', oracle_text: '' } as any,
    ]);

    const beforeLib = g.state.zones?.[p2]?.libraryCount ?? 0;
    const beforeGy = g.state.zones?.[p2]?.graveyardCount ?? 0;

    const spec: SpellSpec = { op: 'MILL_TARGET_PLAYER', filter: 'ANY', minTargets: 1, maxTargets: 1, millCount: 2 };
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'thought_scour',
      spec,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });

    const afterLib = g.state.zones?.[p2]?.libraryCount ?? 0;
    const afterGy = g.state.zones?.[p2]?.graveyardCount ?? 0;

    expect(afterLib).toBe(beforeLib - 2);
    expect(afterGy).toBe(beforeGy + 2);
  });

  it('MILL_EACH_OPPONENT mills for each opponent (not caster)', () => {
    const g = createInitialGameState('t_mill_each_opponent');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent!({ type: 'join', playerId: p3, name: 'P3' });

    g.importDeckResolved(p2, [
      { id: 'b1', name: 'B1', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'b2', name: 'B2', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'b3', name: 'B3', type_line: 'Instant', oracle_text: '' } as any,
    ]);
    g.importDeckResolved(p3, [
      { id: 'c1', name: 'C1', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c2', name: 'C2', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c3', name: 'C3', type_line: 'Instant', oracle_text: '' } as any,
    ]);

    const beforeLib1 = g.state.zones?.[p1]?.libraryCount ?? 0;
    const beforeGy1 = g.state.zones?.[p1]?.graveyardCount ?? 0;
    const beforeLib2 = g.state.zones?.[p2]?.libraryCount ?? 0;
    const beforeGy2 = g.state.zones?.[p2]?.graveyardCount ?? 0;
    const beforeLib3 = g.state.zones?.[p3]?.libraryCount ?? 0;
    const beforeGy3 = g.state.zones?.[p3]?.graveyardCount ?? 0;

    const spec: SpellSpec = { op: 'MILL_EACH_OPPONENT', filter: 'ANY', minTargets: 0, maxTargets: 0, millCount: 2 } as any;
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'mill_each_opponent', spec, chosen: [] });

    expect(g.state.zones?.[p1]?.libraryCount ?? 0).toBe(beforeLib1);
    expect(g.state.zones?.[p1]?.graveyardCount ?? 0).toBe(beforeGy1);
    expect(g.state.zones?.[p2]?.libraryCount ?? 0).toBe(beforeLib2 - 2);
    expect(g.state.zones?.[p2]?.graveyardCount ?? 0).toBe(beforeGy2 + 2);
    expect(g.state.zones?.[p3]?.libraryCount ?? 0).toBe(beforeLib3 - 2);
    expect(g.state.zones?.[p3]?.graveyardCount ?? 0).toBe(beforeGy3 + 2);
  });

  it('MILL_EACH_PLAYER mills for all players', () => {
    const g = createInitialGameState('t_mill_each_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    g.applyEvent!({ type: 'join', playerId: p3, name: 'P3' });

    g.importDeckResolved(p1, [
      { id: 'a1', name: 'A1', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'a2', name: 'A2', type_line: 'Instant', oracle_text: '' } as any,
    ]);
    g.importDeckResolved(p2, [
      { id: 'b1', name: 'B1', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'b2', name: 'B2', type_line: 'Instant', oracle_text: '' } as any,
    ]);
    g.importDeckResolved(p3, [
      { id: 'c1', name: 'C1', type_line: 'Instant', oracle_text: '' } as any,
      { id: 'c2', name: 'C2', type_line: 'Instant', oracle_text: '' } as any,
    ]);

    const beforeLib1 = g.state.zones?.[p1]?.libraryCount ?? 0;
    const beforeGy1 = g.state.zones?.[p1]?.graveyardCount ?? 0;
    const beforeLib2 = g.state.zones?.[p2]?.libraryCount ?? 0;
    const beforeGy2 = g.state.zones?.[p2]?.graveyardCount ?? 0;
    const beforeLib3 = g.state.zones?.[p3]?.libraryCount ?? 0;
    const beforeGy3 = g.state.zones?.[p3]?.graveyardCount ?? 0;

    const spec: SpellSpec = { op: 'MILL_EACH_PLAYER', filter: 'ANY', minTargets: 0, maxTargets: 0, millCount: 1 } as any;
    g.applyEvent!({ type: 'resolveSpell', caster: p1, cardId: 'mill_each_player', spec, chosen: [] });

    expect(g.state.zones?.[p1]?.libraryCount ?? 0).toBe(beforeLib1 - 1);
    expect(g.state.zones?.[p1]?.graveyardCount ?? 0).toBe(beforeGy1 + 1);
    expect(g.state.zones?.[p2]?.libraryCount ?? 0).toBe(beforeLib2 - 1);
    expect(g.state.zones?.[p2]?.graveyardCount ?? 0).toBe(beforeGy2 + 1);
    expect(g.state.zones?.[p3]?.libraryCount ?? 0).toBe(beforeLib3 - 1);
    expect(g.state.zones?.[p3]?.graveyardCount ?? 0).toBe(beforeGy3 + 1);
  });

  it('GOAD_TARGET applies goad metadata to the chosen creature', () => {
    const g = createInitialGameState('t_goad_target');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

    g.createToken!(p2, 'P2 Creature', 1, 2, 2);
    const creatureId = g.state.battlefield.find(p => (p as any).controller === p2)!.id;

    const spec: SpellSpec = { op: 'GOAD_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 };
    g.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'goad_spell',
      spec,
      chosen: [{ kind: 'permanent', id: creatureId } as TargetRef],
    });

    const perm = g.state.battlefield.find(p => p.id === creatureId) as any;
    expect(Array.isArray(perm?.goadedBy) ? perm.goadedBy.includes(p1) : false).toBe(true);
    expect(perm?.goadedUntil?.[p1]).toBeDefined();
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
