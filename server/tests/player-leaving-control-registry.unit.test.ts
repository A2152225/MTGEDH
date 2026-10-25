import { describe, expect, it } from 'vitest';
import { removeLeavingPlayerGameObjects } from '../src/state/modules/playerLeavingGame';
import { registerControlEffect, syncControlFromRegistry } from '../src/state/modules/continuousEffectRegistry';

describe('player leaving the game ends control effects through the registry (CR 800.4a)', () => {
  it('a permanent stolen by the leaving player returns to its owner and its entry is gone', () => {
    const bear = { id: 'b1', owner: 'p1', controller: 'p1', card: { id: 'b1', name: 'Grizzly Bears', type_line: 'Creature', oracle_text: '', power: '2', toughness: '2' } } as any;
    const state: any = { battlefield: [bear], players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], stack: [] };
    registerControlEffect(state, { permanentId: 'b1', originalController: 'p1', newController: 'p2', duration: 'permanent', sourceId: 'mind_control' } as any);
    syncControlFromRegistry(state);
    expect(bear.controller).toBe('p2');
    state.players[1].hasLost = true;
    removeLeavingPlayerGameObjects(state, 'p2');
    expect(state.battlefield.find((p: any) => p.id === 'b1')?.controller).toBe('p1');
    expect((state.permanentControlEffects || []).some((e: any) => e.newController === 'p2')).toBe(false);
    syncControlFromRegistry(state);
    expect(state.battlefield.find((p: any) => p.id === 'b1')?.controller).toBe('p1');
  });

  it('a chain of steals falls back to the next-latest controller still in the game', () => {
    const bear = { id: 'b1', owner: 'p1', controller: 'p1', card: { id: 'b1', name: 'Grizzly Bears', type_line: 'Creature', oracle_text: '', power: '2', toughness: '2' } } as any;
    const state: any = { battlefield: [bear], players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], stack: [] };
    registerControlEffect(state, { permanentId: 'b1', originalController: 'p1', newController: 'p3', duration: 'permanent' } as any);
    registerControlEffect(state, { permanentId: 'b1', originalController: 'p3', newController: 'p2', duration: 'permanent' } as any);
    syncControlFromRegistry(state);
    expect(bear.controller).toBe('p2');
    state.players[1].hasLost = true;
    removeLeavingPlayerGameObjects(state, 'p2');
    expect(state.battlefield.find((p: any) => p.id === 'b1')?.controller).toBe('p3');
  });
});
