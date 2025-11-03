import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { resolveSpell, type SpellSpec } from '../src/rules-engine/targeting';

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
});