import { describe, expect, it } from 'vitest';

import {
  ARCHENEMY_STARTING_LIFE,
  applyVariantDeckSnapshot,
  assemblePlanarDeck,
  seedVariantDecks,
} from '../src/state/modules/variantDeckSeeding.js';
import { redactVariantDecksForView } from '../src/state/modules/viewVariantDeckRedaction.js';
import { asCommandZoneAbilitySource } from '../src/state/modules/commandZoneAbilitySources.js';

/**
 * Single communal planar deck (CR 901.15): unique English names, and the planar controller is
 * the owner of every card. Archenemy (CR 904.5): the archenemy starts at 40 life.
 */

const plane = (name: string, type = 'Plane — Test') => ({ name, type_line: type, oracle_text: '' });

function makeCtx(overrides: Record<string, unknown> = {}) {
  const state: any = {
    players: [{ id: 'p1' }, { id: 'p2' }],
    houseRules: { enablePlanechase: true, enableArchenemy: true },
    turnNumber: 0,
    life: { p1: 20, p2: 20 },
    ...overrides,
  };
  return { state, gameId: '', bumpSeq() {} } as any;
}

describe('communal planar deck: unique names (CR 901.15a)', () => {
  it('drops a plane whose name is already in the deck; first contributor in seat order wins', () => {
    const { deck, startingPlane, droppedDuplicates } = assemblePlanarDeck(
      {
        p2: [plane('Turri Island'), plane('Akoum')],
        p1: [plane('Turri Island'), plane('Naya')],
      },
      ['p1', 'p2'],
      () => 0.5,
    );
    const names = [...deck, startingPlane].map((card) => card.name).sort();
    expect(names).toEqual(['Akoum', 'Naya', 'Turri Island']);
    expect(droppedDuplicates).toEqual(['Turri Island']);
  });

  it('matches names case-insensitively and reports the dropped duplicates when seeding', () => {
    const ctx = makeCtx();
    seedVariantDecks(ctx, 'p1', { planar: [plane('Turri Island'), plane('Naya')], schemes: [] }, { random: () => 0 });
    const second = seedVariantDecks(
      ctx,
      'p2',
      { planar: [plane('turri island'), plane('Akoum')], schemes: [] },
      { random: () => 0 },
    );
    expect(second.notes.join(' ')).toMatch(/different name/);
    expect(second.notes.join(' ')).toMatch(/turri island/);
    const total = ctx.state.planarDeckFaceDown.length + (ctx.state.currentPlane ? 1 : 0);
    expect(total).toBe(3);
  });
});

describe('communal planar deck: ownership (CR 901.15b)', () => {
  it('does not stamp an owner on planar cards, so the planar controller owns them', () => {
    const ctx = makeCtx();
    seedVariantDecks(ctx, 'p1', { planar: [plane('Naya'), plane('Akoum')], schemes: [] }, { random: () => 0 });
    const all = [ctx.state.currentPlane, ...ctx.state.planarDeckFaceDown];
    for (const card of all) {
      expect(card.owner).toBeUndefined();
      expect(card.contributedBy).toBe('p1');
    }
    // The command-zone source falls back to the planar controller.
    const source = asCommandZoneAbilitySource(ctx.state.currentPlane, 'p2', 'plane');
    expect(source.owner).toBe('p2');
  });

  it('discards an owner that came in with the resolved card', () => {
    const ctx = makeCtx();
    seedVariantDecks(ctx, 'p1', { planar: [{ ...plane('Naya'), owner: 'p9' }], schemes: [] }, { random: () => 0 });
    expect(ctx.state.currentPlane.owner).toBeUndefined();
  });

  it('keeps scheme ownership with the archenemy (CR 904.7)', () => {
    const ctx = makeCtx();
    seedVariantDecks(ctx, 'p1', { planar: [], schemes: [{ name: 'S', type_line: 'Scheme' }] }, { random: () => 0 });
    expect(ctx.state.schemeDeck[0].owner).toBe('p1');
  });
});

describe('archenemy starting life (CR 904.5)', () => {
  it('sets the archenemy to 40 and leaves everyone else alone', () => {
    const ctx = makeCtx();
    seedVariantDecks(ctx, 'p1', { planar: [], schemes: [{ name: 'S', type_line: 'Scheme' }] }, { random: () => 0 });
    expect(ARCHENEMY_STARTING_LIFE).toBe(40);
    expect(ctx.state.life).toEqual({ p1: 40, p2: 20 });
  });

  it('restores the same life from the saved snapshot', () => {
    const state: any = { life: { p1: 20, p2: 20 } };
    applyVariantDeckSnapshot(state, {
      archenemyPlayerId: 'p1',
      archenemyLife: 40,
      schemeDeck: [{ id: 's1' }],
      ongoingSchemes: [],
      schemeGraveyard: [],
    });
    expect(state.life).toEqual({ p1: 40, p2: 20 });
  });

  it('does not change life when Archenemy is off', () => {
    const ctx = makeCtx({ houseRules: {} });
    seedVariantDecks(ctx, 'p1', { planar: [], schemes: [{ name: 'S', type_line: 'Scheme' }] }, { random: () => 0 });
    expect(ctx.state.life).toEqual({ p1: 20, p2: 20 });
  });
});

describe('client view: contribution counts', () => {
  it('shows how many cards each player contributed but not which', () => {
    const view: any = redactVariantDecksForView({
      planarContributions: { p1: [{ id: 'a' }, { id: 'b' }], p2: [{ id: 'c' }] },
      planarDeckFaceDown: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      schemeDeck: [],
    });
    expect(view.planarContributionCounts).toEqual({ p1: 2, p2: 1 });
    expect(view.planarDeckCount).toBe(3);
    expect(JSON.stringify(view)).not.toContain('"id":"a"');
    expect(view.planarContributions).toBeUndefined();
  });
});
