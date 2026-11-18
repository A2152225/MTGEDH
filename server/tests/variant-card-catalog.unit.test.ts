import { describe, expect, it } from 'vitest';

import {
  buildVariantCatalogFromCards,
  variantCatalogKind,
} from '../src/services/variantCardCatalog.js';

describe('variant card catalog', () => {
  it('classifies planes, phenomena and schemes, and ignores library cards', () => {
    expect(variantCatalogKind('planar', 'Plane — Ravnica')).toBe('plane');
    expect(variantCatalogKind('planar', 'Phenomenon')).toBe('phenomenon');
    expect(variantCatalogKind('planar', 'Phenome-nom')).toBe('phenomenon');
    expect(variantCatalogKind('scheme', 'Scheme')).toBe('scheme');
    expect(variantCatalogKind('scheme', 'Ongoing Scheme')).toBe('ongoing_scheme');
    expect(variantCatalogKind('normal', 'Creature — Bear')).toBeNull();
    expect(variantCatalogKind('vanguard', 'Vanguard')).toBeNull();
  });

  it('keeps one English card per name and prefers the copy that has an image', () => {
    const catalog = buildVariantCatalogFromCards([
      { name: 'Grizzly Bears', layout: 'normal', type_line: 'Creature — Bear', oracle_text: 'no' },
      { name: 'Pompeii', layout: 'planar', type_line: 'Plane — Earth', oracle_text: 'When you planeswalk...' },
      { name: 'Pompeii', layout: 'planar', type_line: 'Plane — Earth', oracle_text: '', lang: 'ja' },
      {
        name: 'The Lux Foundation Library',
        layout: 'planar',
        type_line: 'Plane — Gallifrey',
        oracle_text: 'first printing',
      },
      {
        name: 'The Lux Foundation Library',
        layout: 'planar',
        type_line: 'Plane — Gallifrey',
        oracle_text: 'with art',
        image_uris: { small: 'https://img/small.jpg', normal: 'https://img/normal.jpg' },
      },
      { name: 'Choose Your Demise', layout: 'scheme', type_line: 'Scheme', oracle_text: 'When you set this scheme in motion...' },
      { name: 'I Am Duskmourn', layout: 'scheme', type_line: 'Ongoing Scheme', oracle_text: 'ongoing' },
    ]);

    expect(catalog.planes.map((card) => card.name)).toEqual(['Pompeii', 'The Lux Foundation Library']);
    expect(catalog.planes[1]).toMatchObject({
      oracle_text: 'with art',
      image_small: 'https://img/small.jpg',
      image_normal: 'https://img/normal.jpg',
    });
    expect(catalog.schemes.map((card) => card.name)).toEqual(['Choose Your Demise']);
    expect(catalog.ongoingSchemes.map((card) => card.name)).toEqual(['I Am Duskmourn']);
    expect(catalog.phenomena).toEqual([]);
  });
});
