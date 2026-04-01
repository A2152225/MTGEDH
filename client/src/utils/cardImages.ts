import type { ImageUris, KnownCardRef } from '../../../shared/src';

type CardWithFaces = Pick<KnownCardRef, 'image_uris' | 'card_faces'> | null | undefined;

export function getPrimaryCardImageUris(card: CardWithFaces): ImageUris | null {
  if (!card) return null;

  return card.image_uris || card.card_faces?.[0]?.image_uris || null;
}

export function getPrimaryCardImageUrl(card: CardWithFaces, preferred: keyof ImageUris = 'normal'): string | null {
  const imageUris = getPrimaryCardImageUris(card);
  if (!imageUris) return null;

  return imageUris[preferred] || imageUris.normal || imageUris.small || imageUris.art_crop || null;
}