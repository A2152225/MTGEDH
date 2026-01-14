import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, TargetRef } from '../../shared/src';
import { categorizeSpell, resolveSpell, type SpellSpec } from '../src/rules-engine/targeting';

describe('Targeting resolve destroy/exile', () => {
  it('destroys chosen targets', () => {
    const g = createInitialGameState('tgt_destroy');
    const pid = 'p1' as PlayerID;
    g.createToken(pid, 'Token A', 1, 2, 2);
    g.createToken(pid, 'Token B', 1, 2, 2);
    const a = g.state.battlefield[0].id;
    const b = g.state.battlefield[1].id;

    const spec: SpellSpec = { op: 'DESTROY_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 2 };
    g.applyEvent({ type: 'resolveSpell', caster: pid, cardId: 'x', spec, chosen: [{ kind: 'permanent', id: a }] });
    expect(g.state.battlefield.find(p => p.id === a)).toBeUndefined();
    expect(g.state.battlefield.find(p => p.id === b)).toBeDefined();
  });

  it('exiles all creatures', () => {
    const g = createInitialGameState('tgt_exile_all');
    const pid = 'p1' as PlayerID;
    g.createToken(pid, 'Token C', 1, 1, 1);
    g.createToken(pid, 'Token D', 1, 1, 2);
    const spec: SpellSpec = { op: 'EXILE_ALL', filter: 'CREATURE', minTargets: 0, maxTargets: 0 };
    g.applyEvent({ type: 'resolveSpell', caster: pid, cardId: 'x', spec, chosen: [] });

    expect(g.state.battlefield.length).toBe(0);
    const exile = g.state.zones?.[pid]?.exile ?? [];
    expect((exile as any[]).length).toBe(2);
  });

  it('destroy all creatures you control only affects your permanents', () => {
    const g = createInitialGameState('tgt_destroy_all_you_control');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'p1_c',
      owner: p1,
      controller: p1,
      tapped: false,
      card: { id: 'bear1', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p2_c',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'bear2', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Wrath-ish', 'Destroy all creatures you control.')!;
    expect(spec.op).toBe('DESTROY_ALL');
    expect(spec.filter).toBe('CREATURE');
    expect(spec.controllerOnly).toBe(true);

    g.applyEvent({ type: 'resolveSpell', caster: p1, cardId: 'x', spec, chosen: [] });
    expect(g.state.battlefield.find(p => p.id === 'p1_c')).toBeUndefined();
    expect(g.state.battlefield.find(p => p.id === 'p2_c')).toBeDefined();
  });

  it('exile all creatures your opponents control only affects opponents', () => {
    const g = createInitialGameState('tgt_exile_all_opponents');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'p1_c',
      owner: p1,
      controller: p1,
      tapped: false,
      card: { id: 'bear1', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p2_c',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'bear2', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Exile-ish', 'Exile all creatures your opponents control.')!;
    expect(spec.op).toBe('EXILE_ALL');
    expect(spec.filter).toBe('CREATURE');
    expect(spec.opponentOnly).toBe(true);

    g.applyEvent({ type: 'resolveSpell', caster: p1, cardId: 'x', spec, chosen: [] });
    expect(g.state.battlefield.find(p => p.id === 'p1_c')).toBeDefined();
    expect(g.state.battlefield.find(p => p.id === 'p2_c')).toBeUndefined();
    const exileP2 = g.state.zones?.[p2]?.exile ?? [];
    expect((exileP2 as any[]).some((c: any) => c?.name === 'Grizzly Bears')).toBe(true);
  });

  it('destroy all artifacts target player controls affects only that player', () => {
    const g = createInitialGameState('tgt_destroy_all_target_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    g.state.battlefield.push({
      id: 'p2_a',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'ring', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p2_c',
      owner: p2,
      controller: p2,
      tapped: false,
      card: { id: 'bear2', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    } as any);
    g.state.battlefield.push({
      id: 'p1_a',
      owner: p1,
      controller: p1,
      tapped: false,
      card: { id: 'ring2', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '' },
    } as any);

    const spec = categorizeSpell('Shatterstorm-ish', 'Destroy all artifacts target player controls.')!;
    expect(spec.op).toBe('DESTROY_ALL_TARGET_PLAYER');
    expect(spec.filter).toBe('ARTIFACT');

    g.applyEvent({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'x',
      spec,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });

    expect(g.state.battlefield.find(p => p.id === 'p2_a')).toBeUndefined();
    expect(g.state.battlefield.find(p => p.id === 'p2_c')).toBeDefined();
    expect(g.state.battlefield.find(p => p.id === 'p1_a')).toBeDefined();
  });
});