// Deck import resolution service
import { fetchCardsByExactNamesBatch, normalizeName } from './scryfall.js';
import type { KnownCardRef } from '../../../shared/src/types.js';

type ResolvedCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris' | 'mana_cost' | 'power' | 'toughness'>;

/**
 * Generate a unique ID for a card copy.
 * Format: originalId_copyN_timestamp to ensure uniqueness
 */
function generateUniqueCardId(originalId: string, copyIndex: number): string {
  // Use a combination of original ID, copy index, and partial timestamp for uniqueness
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${originalId}_${copyIndex}_${timestamp}${random}`;
}

export async function resolveDeckList(parsed: Array<{name: string; count: number}>) {
  // fetch by batch (reuse existing fetchCardsByExactNamesBatch)
  const byName = await fetchCardsByExactNamesBatch(parsed.map(p => p.name)).catch(() => null);
  const resolved: ResolvedCard[] = [];
  const validation: any[] = [];
  const missing: string[] = [];

  if (byName) {
    for (const {name, count} of parsed) {
      const key = normalizeName(name).toLowerCase();
      const c = byName.get(key);
      if (!c) { missing.push(name); continue; }
      for (let i = 0; i < (count || 1); i++) {
        validation.push(c);
        // Generate unique ID for each copy of the card
        // This ensures multiple copies of the same card (e.g., basic lands) can be 
        // individually tracked and played
        const uniqueId = count > 1 ? generateUniqueCardId(c.id, i) : c.id;
        resolved.push({ 
          id: uniqueId, 
          name: c.name, 
          type_line: c.type_line, 
          oracle_text: c.oracle_text, 
          image_uris: c.image_uris, 
          mana_cost: c.mana_cost, 
          power: c.power, 
          toughness: c.toughness 
        });
      }
    }
  } else {
    // fallback per-card fetch...
  }

  return { resolved, validation, missing };
}