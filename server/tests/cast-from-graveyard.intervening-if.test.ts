import { describe, expect, it } from 'vitest';
import { applyEvent } from '../src/state/modules/applyEvent';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: cast from graveyard provenance', () => {
  it('replay castSpell(fromZone=graveyard) plumbs castSourceZone + castFromGraveyard onto the stack item', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1', name: 'P1' }],
        zones: { p1: { hand: [], graveyard: [], exile: [] } },
        battlefield: [],
        stack: [],
      },
      bumpSeq: () => {},
    };

    applyEvent(g as any, {
      type: 'castSpell',
      playerId: 'p1',
      card: { id: 'c1', name: 'Test Spell', oracle_text: '', type_line: 'Sorcery', mana_cost: '{1}{B}' },
      fromZone: 'graveyard',
      targets: [],
    } as any);

    expect(Array.isArray(g.state.stack)).toBe(true);
    expect(g.state.stack.length).toBe(1);
    const top = g.state.stack[g.state.stack.length - 1];

    expect(top.fromZone).toBe('graveyard');
    expect(top.source).toBe('graveyard');
    expect(top.castSourceZone).toBe('graveyard');
    expect(top.castFromGraveyard).toBe(true);
    expect(top.card.fromZone).toBe('graveyard');
    expect(top.card.source).toBe('graveyard');
    expect(top.card.castSourceZone).toBe('graveyard');
    expect(top.card.castFromGraveyard).toBe(true);

    expect((g.state as any).castFromGraveyardThisTurn?.p1).toBe(true);

    expect(evaluateInterveningIfClause(g as any, 'p1', 'if it was cast from your graveyard', top.card as any)).toBe(true);
    expect(
      evaluateInterveningIfClause(
        g as any,
        'p1',
        'if it entered from your graveyard or you cast it from your graveyard',
        top.card as any
      )
    ).toBe(true);
  });

  it('replay castSpell(fromZone=exile) plumbs castSourceZone + castFromExile onto the stack item', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1', name: 'P1' }],
        zones: { p1: { hand: [], graveyard: [], exile: [] } },
        battlefield: [],
        stack: [],
      },
      bumpSeq: () => {},
    };

    applyEvent(g as any, {
      type: 'castSpell',
      playerId: 'p1',
      card: { id: 'c2', name: 'Test Spell 2', oracle_text: '', type_line: 'Instant', mana_cost: '{U}' },
      fromZone: 'exile',
      targets: [],
    } as any);

    const top = g.state.stack[g.state.stack.length - 1];
    expect(top.fromZone).toBe('exile');
    expect(top.source).toBe('exile');
    expect(top.castSourceZone).toBe('exile');
    expect(top.castFromExile).toBe(true);

    expect((g.state as any).castFromExileThisTurn?.p1).toBe(true);

    // This clause should deterministically fail when we know the spell came from exile.
    expect(evaluateInterveningIfClause(g as any, 'p1', 'if it was cast from your graveyard', top.card as any)).toBe(false);
  });
});
