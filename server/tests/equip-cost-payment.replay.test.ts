import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/index.js';

function setup(id: string) {
  const g: any = createInitialGameState(id);
  const s: any = g.state;
  s.players = [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }];
  s.zones = { p1: { hand: [{ id: 'h1', name: 'Shock', type_line: 'Instant' }, { id: 'h2', name: 'Opt', type_line: 'Instant' }], handCount: 2, graveyard: [], graveyardCount: 0, exile: [] }, p2: { hand: [], graveyard: [], exile: [] } };
  s.battlefield = [
    { id: 'eq', controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { name: 'Test Equipment', type_line: 'Artifact - Equipment', oracle_text: 'Equip-Sacrifice a creature.' } },
    { id: 'fodder', controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { name: 'Grizzly Bears', type_line: 'Creature - Bear', power: '2', toughness: '2' } },
  ];
  return g;
}

describe('Equip non-mana cost payment replay events', () => {
  it('replays equipSacrificeCostPaid by moving the sacrificed permanent off the battlefield', () => {
    const g = setup('equip_sac_replay');
    g.applyEvent({ type: 'equipSacrificeCostPaid', playerId: 'p1', permanentId: 'eq', sacrificedId: 'fodder' } as any);
    expect(g.state.battlefield.map((p: any) => p.id)).toEqual(['eq']);
    expect(g.state.zones.p1.graveyard.some((c: any) => c.name === 'Grizzly Bears')).toBe(true);
  });

  it('replays equipDiscardCostPaid by moving the discarded card from hand to graveyard', () => {
    const g = setup('equip_discard_replay');
    g.applyEvent({ type: 'equipDiscardCostPaid', playerId: 'p1', permanentId: 'eq', cardId: 'h2' } as any);
    expect(g.state.zones.p1.hand.map((c: any) => c.id)).toEqual(['h1']);
    expect(g.state.zones.p1.graveyard.map((c: any) => c.id)).toEqual(['h2']);
    expect(g.state.zones.p1.handCount).toBe(1);
  });
});
