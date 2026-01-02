/**
 * shared/src/cardFactory.ts
 * 
 * Centralized card creation factory for consistent card object construction.
 * 
 * This module provides a single point of control for creating card objects from
 * Scryfall data, ensuring all required fields (including `loyalty` for planeswalkers)
 * are consistently populated across the codebase.
 * 
 * Benefits:
 * - Single source of truth for card field mapping
 * - Easier to add new fields in the future
 * - Prevents inconsistencies like missing `loyalty` field
 * - Type-safe card creation with proper TypeScript types
 */

import type { KnownCardRef, ImageUris, CardFace } from "./types.js";

/**
 * Input type for Scryfall card data.
 * This represents the raw data that comes from the Scryfall API or cache.
 */
export interface ScryfallCardInput {
  id: string;
  name: string;
  oracle_id?: string;
  cmc?: number;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    art_crop?: string;
  };
  legalities?: Record<string, string>;
  power?: string;
  toughness?: string;
  loyalty?: string; // Planeswalker starting loyalty
  layout?: string;
  card_faces?: Array<{
    name?: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: {
      small?: string;
      normal?: string;
      art_crop?: string;
    };
    power?: string;
    toughness?: string;
    loyalty?: string; // For MDFC planeswalkers
  }>;
  colors?: string[];
}

/**
 * Options for card creation.
 */
export interface CardCreationOptions {
  /**
   * Override the card ID. If not provided, uses the Scryfall ID.
   * This is useful when creating unique instance IDs for multiple copies of the same card.
   */
  instanceId?: string;
  
  /**
   * Zone where the card will be placed (optional, for KnownCardRef compatibility).
   */
  zone?: string;
}

/**
 * Creates a standardized card object from Scryfall data.
 * 
 * This is the primary factory function that should be used whenever creating
 * a card object from Scryfall data to ensure consistency across the codebase.
 * 
 * @param scryfallCard - The raw Scryfall card data
 * @param options - Optional configuration for card creation
 * @returns A KnownCardRef-compatible card object with all fields properly populated
 * 
 * @example
 * ```typescript
 * // Basic usage
 * const card = createCardFromScryfall(scryfallData);
 * 
 * // With custom instance ID (for multiple copies)
 * const card = createCardFromScryfall(scryfallData, { 
 *   instanceId: generateUniqueCardInstanceId(scryfallData.id) 
 * });
 * ```
 */
export function createCardFromScryfall(
  scryfallCard: ScryfallCardInput,
  options: CardCreationOptions = {}
): KnownCardRef {
  const { instanceId, zone } = options;
  
  // Map image URIs
  const imageUris: ImageUris | undefined = scryfallCard.image_uris
    ? {
        small: scryfallCard.image_uris.small,
        normal: scryfallCard.image_uris.normal,
        art_crop: scryfallCard.image_uris.art_crop,
      }
    : undefined;
  
  // Map card faces for double-faced cards
  const cardFaces: CardFace[] | undefined = scryfallCard.card_faces
    ? scryfallCard.card_faces.map((face) => ({
        name: face.name,
        mana_cost: face.mana_cost,
        type_line: face.type_line,
        oracle_text: face.oracle_text,
        image_uris: face.image_uris
          ? {
              small: face.image_uris.small,
              normal: face.image_uris.normal,
              art_crop: face.image_uris.art_crop,
            }
          : undefined,
        power: face.power,
        toughness: face.toughness,
      }))
    : undefined;
  
  const card: KnownCardRef = {
    id: instanceId ?? scryfallCard.id,
    name: scryfallCard.name,
    type_line: scryfallCard.type_line,
    oracle_text: scryfallCard.oracle_text,
    image_uris: imageUris,
    mana_cost: scryfallCard.mana_cost,
    power: scryfallCard.power,
    toughness: scryfallCard.toughness,
    loyalty: scryfallCard.loyalty, // Planeswalker starting loyalty
    card_faces: cardFaces,
    layout: scryfallCard.layout,
    cmc: scryfallCard.cmc,
    colors: scryfallCard.colors,
  };
  
  // Add zone if specified
  if (zone) {
    card.zone = zone;
  }
  
  return card;
}

/**
 * Creates a minimal card reference with just the essential fields.
 * 
 * This is useful for situations where only basic card identification is needed,
 * such as in selection lists or search results.
 * 
 * @param scryfallCard - The raw Scryfall card data
 * @param options - Optional configuration for card creation
 * @returns A minimal card object with id, name, type_line, oracle_text, and image_uris
 */
export function createMinimalCardRef(
  scryfallCard: ScryfallCardInput,
  options: CardCreationOptions = {}
): Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris' | 'mana_cost'> {
  const { instanceId } = options;
  
  return {
    id: instanceId ?? scryfallCard.id,
    name: scryfallCard.name,
    type_line: scryfallCard.type_line,
    oracle_text: scryfallCard.oracle_text,
    image_uris: scryfallCard.image_uris
      ? {
          small: scryfallCard.image_uris.small,
          normal: scryfallCard.image_uris.normal,
          art_crop: scryfallCard.image_uris.art_crop,
        }
      : undefined,
    mana_cost: scryfallCard.mana_cost,
  };
}

/**
 * Type guard to check if a card input has planeswalker loyalty.
 * 
 * @param card - The card to check
 * @returns True if the card has a loyalty value
 */
export function hasPlaneswalkerLoyalty(card: ScryfallCardInput): boolean {
  return card.loyalty !== undefined && card.loyalty !== null;
}

/**
 * Type guard to check if a card input is a double-faced card.
 * 
 * @param card - The card to check
 * @returns True if the card has card_faces
 */
export function isDoubleFacedCard(card: ScryfallCardInput): boolean {
  return Array.isArray(card.card_faces) && card.card_faces.length > 0;
}
