import { describe, expect, it } from 'vitest';

import {
  assemblePlanarDeck,
  isVariantSeedingClosed,
  partitionVariantCards,
  seedVariantDecks,
} from '../src/state/modules/variantDeckSeeding.js';
import { redactVariantDecksForView } from '../src/state/modules/viewVariantDeckRedaction.js';

const plane = (name: string, world = 'Earth') => ({ name, type_line: `Plane — ${world}`, oracle_text: '' });
const phenomenon = (name: string) => ({ name, type_line: 'Phenomenon', oracle_text: '' });
const scheme = (name: string) => ({ name, type_line: 'Scheme', oracle_text: '' });
const ongoingScheme = (name: string) => ({ name, type_line: 'Ongoing Scheme', oracle_text: '' });
const creature = (name: string) => ({ name, type_line: 'Creature — Dalek', oracle_text: '' });

/** Deterministic "random" so shuffles are reproducible in tests. */
function seededRandom(seed = 1): () => number {
  let value = seed;
  return () => {
    value = (value * 48271) % 2147483647;
    return value / 2147483647;
  };
}

function makeCtx(state: Record<string, unknown>) {
  return { state, bumpSeq() { (state as any).seq = Number((state as any).seq || 0) + 1; } } as any;
}

const doctorWhoPlanar = [
  plane("Amy's Home"),
  plane('Pompeii'),
  plane('Bad Wolf Bay'),
  phenomenon('Human—Time Lord Meta-Crisis'),
];

describe('partitionVariantCards', () => {
  it('splits planes, phenomena and schemes out of the playable deck', () => {
    const { playable, planar, schemes } = partitionVariantCards([
      creature('Davros, Dalek Creator'),
      plane('City of the Daleks', 'Skaro'),
      phenomenon('Unleash the Flux'),
      scheme('Choose Your Champion'),
      ongoingScheme('My Tendrils Run Deep'),
      { name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace' },
    ]);
    expect(playable.map((c) => c.name)).toEqual(['Davros, Dalek Creator', 'Jace, the Mind Sculptor']);
    expect(planar.map((c) => c.name)).toEqual(['City of the Daleks', 'Unleash the Flux']);
    expect(schemes.map((c) => c.name)).toEqual(['Choose Your Champion', 'My Tendrils Run Deep']);
  });

  it('reads the front face when the card has no top-level type line', () => {
    const { planar } = partitionVariantCards([
      { name: 'Odd Plane', card_faces: [{ type_line: 'Plane — Ravnica' }] },
    ]);
    expect(planar.map((c) => c.name)).toEqual(['Odd Plane']);
  });
});

describe('assemblePlanarDeck', () => {
  it('turns a plane face up and sends phenomena to the bottom (never starts on a phenomenon)', () => {
    // Force a phenomenon on top: a 1-plane + 1-phenomenon deck, tried across seeds.
    for (let seed = 1; seed <= 25; seed++) {
      const { deck, startingPlane } = assemblePlanarDeck(
        { p1: [phenomenon('Fixed Point in Time'), plane('Pompeii')] },
        ['p1'],
        seededRandom(seed),
      );
      expect(startingPlane?.name).toBe('Pompeii');
      expect(deck.map((c) => c.name)).toEqual(['Fixed Point in Time']);
    }
  });

  it('combines every contributor into one deck and keeps each card', () => {
    const { deck, startingPlane } = assemblePlanarDeck(
      { p1: [plane('A'), plane('B')], p2: [plane('C'), phenomenon('D')] },
      ['p1', 'p2'],
      seededRandom(7),
    );
    const all = [...deck, ...(startingPlane ? [startingPlane] : [])].map((c) => c.name).sort();
    expect(all).toEqual(['A', 'B', 'C', 'D']);
  });

  it('has no starting plane when the deck is only phenomena', () => {
    const { deck, startingPlane } = assemblePlanarDeck({ p1: [phenomenon('X')] }, ['p1'], seededRandom());
    expect(startingPlane).toBeNull();
    expect(deck.map((c) => c.name)).toEqual(['X']);
  });
});

describe('seedVariantDecks: Planechase', () => {
  it('seeds the planar deck + starting plane and stamps unique ids and the contributor', () => {
    const state: any = { houseRules: { enablePlanechase: true }, players: [{ id: 'p1' }, { id: 'p2' }] };
    const result = seedVariantDecks(makeCtx(state), 'p1', { planar: doctorWhoPlanar, schemes: [] }, { random: seededRandom(3) });

    expect(result.planarSeeded).toBe(4);
    expect(state.currentPlane?.type_line).toMatch(/^Plane/);
    expect(state.activePlane).toBe(state.currentPlane);
    expect(state.planarDeckFaceDown).toHaveLength(3);

    const everyCard = [state.currentPlane, ...state.planarDeckFaceDown];
    expect(new Set(everyCard.map((c: any) => c.id)).size).toBe(4);
    // CR 901.15b: in the communal deck the planar controller owns the cards, so no per-card owner.
    expect(everyCard.every((c: any) => c.owner === undefined && c.contributedBy === 'p1')).toBe(true);
    expect(state.planarContributions.p1).toHaveLength(4);
  });

  it('merges a second player\'s planes into the same shared deck', () => {
    const state: any = { houseRules: { enablePlanechase: true }, players: [{ id: 'p1' }, { id: 'p2' }] };
    seedVariantDecks(makeCtx(state), 'p1', { planar: [plane('A'), plane('B')], schemes: [] }, { random: seededRandom(1) });
    seedVariantDecks(makeCtx(state), 'p2', { planar: [plane('C'), plane('D')], schemes: [] }, { random: seededRandom(2) });

    const names = [state.currentPlane, ...state.planarDeckFaceDown].map((c: any) => c.name).sort();
    expect(names).toEqual(['A', 'B', 'C', 'D']);
    expect(Object.keys(state.planarContributions).sort()).toEqual(['p1', 'p2']);
  });

  it('re-importing replaces that player\'s planes instead of duplicating them', () => {
    const state: any = { houseRules: { enablePlanechase: true }, players: [{ id: 'p1' }] };
    seedVariantDecks(makeCtx(state), 'p1', { planar: [plane('A'), plane('B')], schemes: [] });
    seedVariantDecks(makeCtx(state), 'p1', { planar: [plane('C')], schemes: [] });

    expect(state.currentPlane?.name).toBe('C');
    expect(state.planarDeckFaceDown).toEqual([]);
    expect(state.planarContributions.p1.map((c: any) => c.name)).toEqual(['C']);
  });

  it('ignores planar cards (with a note) when Planechase is off', () => {
    const state: any = { houseRules: {}, players: [{ id: 'p1' }] };
    const result = seedVariantDecks(makeCtx(state), 'p1', { planar: doctorWhoPlanar, schemes: [] });
    expect(result.planarSeeded).toBe(0);
    expect(result.notes.join(' ')).toMatch(/Planechase is not enabled/);
    expect(state.planarDeckFaceDown).toBeUndefined();
    expect(state.currentPlane).toBeUndefined();
  });

  it('refuses to reshuffle the decks once the game has started', () => {
    const started: any = { houseRules: { enablePlanechase: true }, turnNumber: 1, players: [{ id: 'p1' }] };
    expect(isVariantSeedingClosed(started)).toBe(true);
    const result = seedVariantDecks(makeCtx(started), 'p1', { planar: [plane('A')], schemes: [] });
    expect(result.planarSeeded).toBe(0);
    expect(result.notes.join(' ')).toMatch(/already started/);
    expect(started.planarDeckFaceDown).toBeUndefined();

    expect(isVariantSeedingClosed({ planeswalksAttempted: 1 })).toBe(true);
    expect(isVariantSeedingClosed({ turnNumber: 0 })).toBe(false);
  });
});

describe('seedVariantDecks: Archenemy', () => {
  const schemes = [scheme('Choose Your Champion'), ongoingScheme('My Tendrils Run Deep'), scheme('I Am Never Alone')];

  it('makes the importer the archenemy and seeds a shuffled scheme deck', () => {
    const state: any = { houseRules: { enableArchenemy: true }, players: [{ id: 'p1' }, { id: 'p2' }] };
    const result = seedVariantDecks(makeCtx(state), 'p1', { planar: [], schemes }, { random: seededRandom(5) });

    expect(result.schemesSeeded).toBe(3);
    expect(state.archenemyPlayerId).toBe('p1');
    expect(state.schemeDeck.map((c: any) => c.name).sort()).toEqual(
      ['Choose Your Champion', 'I Am Never Alone', 'My Tendrils Run Deep'],
    );
    expect(state.ongoingSchemes).toEqual([]);
    expect(state.schemeDeck.every((c: any) => c.owner === 'p1')).toBe(true);
  });

  it('keeps the first archenemy: a second player\'s schemes are ignored with a note', () => {
    const state: any = { houseRules: { enableArchenemy: true }, players: [{ id: 'p1' }, { id: 'p2' }] };
    seedVariantDecks(makeCtx(state), 'p1', { planar: [], schemes });
    const second = seedVariantDecks(makeCtx(state), 'p2', { planar: [], schemes: [scheme('Other')] });

    expect(second.schemesSeeded).toBe(0);
    expect(second.notes.join(' ')).toMatch(/already the archenemy/);
    expect(state.archenemyPlayerId).toBe('p1');
    expect(state.schemeDeck).toHaveLength(3);
  });

  it('ignores schemes (with a note) when Archenemy is off', () => {
    const state: any = { houseRules: { enablePlanechase: true }, players: [{ id: 'p1' }] };
    const result = seedVariantDecks(makeCtx(state), 'p1', { planar: [], schemes });
    expect(result.schemesSeeded).toBe(0);
    expect(result.notes.join(' ')).toMatch(/Archenemy is not enabled/);
    expect(state.schemeDeck).toBeUndefined();
  });

  it('seeds both variants from one deck when both modes are on', () => {
    const state: any = {
      houseRules: { enablePlanechase: true, enableArchenemy: true },
      players: [{ id: 'p1' }],
    };
    const result = seedVariantDecks(makeCtx(state), 'p1', { planar: doctorWhoPlanar, schemes });
    expect(result.planarSeeded).toBe(4);
    expect(result.schemesSeeded).toBe(3);
  });
});

describe('redactVariantDecksForView', () => {
  const view = {
    id: 'g1',
    currentPlane: { id: 'face-up', name: 'Pompeii' },
    ongoingSchemes: [{ id: 'o1', name: 'My Tendrils Run Deep' }],
    archenemyPlayerId: 'p1',
    planarDeckFaceDown: [{ id: 'a', name: 'SECRET PLANE A' }, { id: 'b', name: 'SECRET PLANE B' }],
    planarContributions: { p1: [{ id: 'a', name: 'SECRET PLANE A' }] },
    schemeDeck: [{ id: 's', name: 'SECRET SCHEME' }],
  };

  it('removes the face-down decks and sends counts instead', () => {
    const out: any = redactVariantDecksForView(view);
    expect(out.planarDeckFaceDown).toBeUndefined();
    expect(out.planarContributions).toBeUndefined();
    expect(out.schemeDeck).toBeUndefined();
    expect(out.planarDeckCount).toBe(2);
    expect(out.schemeDeckCount).toBe(1);
    expect(JSON.stringify(out)).not.toMatch(/SECRET/);
  });

  it('keeps public face-up state', () => {
    const out: any = redactVariantDecksForView(view);
    expect(out.currentPlane.name).toBe('Pompeii');
    expect(out.ongoingSchemes).toHaveLength(1);
    expect(out.archenemyPlayerId).toBe('p1');
  });

  it('does not mutate the authoritative state and passes through views with no variant decks', () => {
    redactVariantDecksForView(view);
    expect(view.planarDeckFaceDown).toHaveLength(2);
    const plain = { id: 'g2', battlefield: [] };
    expect(redactVariantDecksForView(plain)).toBe(plain);
  });
});
