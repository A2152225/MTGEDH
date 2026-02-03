import { describe, expect, it } from 'vitest';
import { evaluateInterveningIfClause } from '../src/state/modules/triggers/intervening-if';

describe('Intervening-if: cards exiled with source (Items 29/30)', () => {
  it('three-or-more exiled with this artifact: returns null when exile zones not fully tracked', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: {
          p1: { exile: [] },
          // p2 exile missing => incomplete tracking
          p2: {},
        },
      },
    };
    const src: any = { id: 'a1', card: { name: 'Some Artifact' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if three or more cards have been exiled with this artifact', src)).toBe(null);
  });

  it('three-or-more exiled with this artifact: returns false when exile zones fully tracked and count < 3', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: {
          p1: { exile: [] },
          p2: { exile: [] },
        },
      },
    };
    const src: any = { id: 'a1', card: { name: 'Some Artifact' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if three or more cards have been exiled with this artifact', src)).toBe(false);
  });

  it('three-or-more exiled with this artifact: returns true when 3+ matching cards found', () => {
    const g: any = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: {
          p1: {
            exile: [
              { id: 'x1', name: 'C1', exiledWithSourceId: 'a1' },
              { id: 'x2', name: 'C2', exiledWithSourceId: 'a1' },
              { id: 'x3', name: 'C3', exiledWithSourceId: 'a1' },
            ],
          },
          p2: { exile: [] },
        },
      },
    };
    const src: any = { id: 'a1', card: { name: 'Some Artifact' } };
    expect(evaluateInterveningIfClause(g, 'p1', 'if three or more cards have been exiled with this artifact', src)).toBe(true);
  });

  it('N-or-more exiled with <Name>: returns null when exile zones not fully tracked and count is below threshold', () => {
    const g: any = {
      state: {
        battlefield: [{ id: 'o1', controller: 'p1', card: { name: 'The Thing' } }],
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: {
          p1: { exile: [{ id: 'x1', name: 'C1', exiledWithSourceId: 'o1' }] },
          p2: {},
        },
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', 'if there are two or more cards exiled with The Thing')).toBe(null);
  });

  it('N-or-more exiled with <Name>: returns false when exile zones fully tracked and count is below threshold', () => {
    const g: any = {
      state: {
        battlefield: [{ id: 'o1', controller: 'p1', card: { name: 'The Thing' } }],
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: {
          p1: { exile: [{ id: 'x1', name: 'C1', exiledWithSourceId: 'o1' }] },
          p2: { exile: [] },
        },
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', 'if there are two or more cards exiled with The Thing')).toBe(false);
  });

  it('N-or-more exiled with <Name>: returns true when threshold met', () => {
    const g: any = {
      state: {
        battlefield: [{ id: 'o1', controller: 'p1', card: { name: 'The Thing' } }],
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: {
          p1: {
            exile: [
              { id: 'x1', name: 'C1', exiledWithSourceId: 'o1' },
              { id: 'x2', name: 'C2', exiledWithSourceId: 'o1' },
            ],
          },
          p2: { exile: [] },
        },
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', 'if there are two or more cards exiled with The Thing')).toBe(true);
  });

  it('N-or-more exiled with <Name>: uses linkedExiles when the named permanent has a linked-exile effect', () => {
    const g: any = {
      state: {
        battlefield: [
          {
            id: 'le1',
            controller: 'p1',
            card: {
              name: 'Oblivion Ring',
              type_line: 'Enchantment',
              oracle_text: 'Exile target nonland permanent until Oblivion Ring leaves the battlefield.',
            },
          },
        ],
        linkedExiles: [
          { exilingPermanentId: 'le1', exiledCardName: 'A' },
          { exilingPermanentId: 'le1', exiledCardName: 'B' },
        ],
        // zones intentionally absent to prove linkedExiles path
      },
    };

    expect(evaluateInterveningIfClause(g, 'p1', 'if there are two or more cards exiled with Oblivion Ring')).toBe(true);
  });
});
