/**
 * Origin parent: shared/src/types.ts
 *
 * Cluster moved: card-ref shapes (ImageUris, CardFace, KnownCardRef, HiddenCardRef, CardRef).
 *
 * Public entry symbols: ImageUris, CardFace, KnownCardRef, HiddenCardRef, CardRef.
 */

import type { PlayerID } from './identityTypes.js';

/* Image URIs used by Scryfall */
export interface ImageUris {
  small?: string;
  normal?: string;
  art_crop?: string;
}

/* Card face for double-faced/transform/split cards */
export interface CardFace {
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ImageUris;
  power?: string;
  toughness?: string;
  loyalty?: string; // For MDFC planeswalkers
}

/* Known card shape (non-secret) */
export interface KnownCardRef {
  id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ImageUris;
  mana_cost?: string;
  power?: string | number;
  toughness?: string | number;
  loyalty?: string | number; // for planeswalkers - starting loyalty value
  zone?: string;
  faceDown?: boolean;
  knownTo?: PlayerID[]; // who knows the card face/identity
  card_faces?: CardFace[]; // for double-faced/transform/split cards
  layout?: string; // card layout type (e.g., 'transform', 'modal_dfc', 'split')
  colors?: readonly string[]; // color identifiers ('W', 'U', 'B', 'R', 'G')
  color_identity?: readonly string[]; // commander legality color identity
  cmc?: number; // converted mana cost
  putIntoGraveyardTurn?: number;
}

/* Hidden card representation for face-down and private zones */
export interface HiddenCardRef {
  id: string;
  faceDown: true;
  zone: 'battlefield' | 'exile' | 'stack' | 'library' | 'hand' | 'graveyard' | 'command';
  visibility: 'owner' | 'controller' | 'public' | 'none';
  // Optional properties for compatibility with KnownCardRef (when card is revealed)
  name?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: ImageUris;
  mana_cost?: string;
  power?: string | number;
  toughness?: string | number;
  loyalty?: string | number; // for planeswalkers - starting loyalty value
  putIntoGraveyardTurn?: number;
}

/* Generic CardRef used across the app */
export type CardRef = KnownCardRef | HiddenCardRef;
