import { describe, expect, it } from 'vitest';

import { candidateQuality, type LocalCardLookupRecord } from '../src/services/localCardLookup.js';

/**
 * Planes / phenomena / schemes are never commander-legal. The Scryfall (oracle-cards) record is
 * marked commander "not_legal" and used to lose to the AtomicCards record, which has no legalities
 * and no image. The planar deck then had no card art. Scryfall's record must win for these layouts.
 */

const scryfallPlane = {
  id: '4f82f5b7-b4b9-489a-bbd7-98faaa566515',
  name: 'City of the Daleks',
  type_line: 'Plane — Skaro',
  oracle_text: 'When you planeswalk to City of the Daleks, …',
  layout: 'planar',
  legalities: { commander: 'not_legal' },
  image_uris: { small: 'https://cards.scryfall.io/small/x.jpg', normal: 'https://cards.scryfall.io/normal/x.jpg' },
  source: 'oracle-cards',
} as unknown as LocalCardLookupRecord;

const atomicPlane = {
  id: 'atomic:city of the daleks',
  name: 'City of the Daleks',
  type_line: 'Plane — Skaro',
  oracle_text: 'When you planeswalk to City of the Daleks, …',
  layout: 'planar',
  legalities: {},
  image_uris: undefined,
  source: 'AtomicCards',
} as unknown as LocalCardLookupRecord;

describe('local card lookup ranking for non-deck layouts', () => {
  it('prefers the Scryfall record (with art) over the AtomicCards record for planes', () => {
    expect(candidateQuality(scryfallPlane)).toBeGreaterThan(candidateQuality(atomicPlane));
  });

  it.each(['scheme', 'vanguard'])('does the same for %s cards', (layout) => {
    const scryfall = { ...scryfallPlane, layout } as LocalCardLookupRecord;
    const atomic = { ...atomicPlane, layout } as LocalCardLookupRecord;
    expect(candidateQuality(scryfall)).toBeGreaterThan(candidateQuality(atomic));
  });

  it('still penalizes a non-legal ordinary card relative to a legal one', () => {
    const base = { name: 'Some Card', type_line: 'Creature', oracle_text: 'Flying', layout: 'normal' };
    const notLegal = { ...base, legalities: { commander: 'not_legal' } } as unknown as LocalCardLookupRecord;
    const legal = { ...base, legalities: { commander: 'legal' } } as unknown as LocalCardLookupRecord;
    expect(candidateQuality(legal)).toBeGreaterThan(candidateQuality(notLegal));
  });
});
