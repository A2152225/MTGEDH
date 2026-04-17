import { describe, expect, it } from 'vitest';

import { getPrimaryCardImageUrl } from '../src/utils/cardImages';

describe('getPrimaryCardImageUrl', () => {
  it('returns the root image when present', () => {
    const card = {
      image_uris: {
        normal: 'https://example.com/root-normal.jpg',
        small: 'https://example.com/root-small.jpg',
      },
    } as any;

    expect(getPrimaryCardImageUrl(card, 'normal')).toBe('https://example.com/root-normal.jpg');
  });

  it('falls back to the front face image for double-faced cards without root images', () => {
    const card = {
      layout: 'modal_dfc',
      card_faces: [
        {
          name: 'Front Face',
          image_uris: {
            normal: 'https://example.com/front-normal.jpg',
            small: 'https://example.com/front-small.jpg',
          },
        },
        {
          name: 'Back Face',
          image_uris: {
            normal: 'https://example.com/back-normal.jpg',
            small: 'https://example.com/back-small.jpg',
          },
        },
      ],
    } as any;

    expect(getPrimaryCardImageUrl(card, 'normal')).toBe('https://example.com/front-normal.jpg');
    expect(getPrimaryCardImageUrl(card, 'small')).toBe('https://example.com/front-small.jpg');
  });
});