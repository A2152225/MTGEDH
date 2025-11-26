export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Parse power/toughness values from card data.
 * Handles numeric values, "*", and expressions like "*+1" or "1+*".
 * For pure "*" values, returns undefined (caller should use calculateVariablePT).
 */
export function parsePT(raw?: string | number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  
  // If already a number, return it
  if (typeof raw === 'number') return raw;
  
  const str = String(raw).trim();
  
  // Pure numeric
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  
  // Handle X (typically 0 unless otherwise specified)
  if (str.toLowerCase() === 'x') return 0;
  
  // Pure * - caller needs to use calculateVariablePT
  if (str === '*') return undefined;
  
  // Handle expressions like *+1, 1+*, etc. - return undefined for now
  if (str.includes('*')) return undefined;
  
  return undefined;
}

/**
 * Calculate the effective P/T for creatures with variable (*/*) power/toughness.
 * This implements the characteristic-defining abilities from card text.
 * 
 * Note: This is only for true variable P/T creatures like Tarmogoyf or Nighthowler.
 * Cards with fixed P/T (like Morophon 6/6) should have their values parsed normally.
 * 
 * Examples:
 * - Tarmogoyf: Count card types in all graveyards
 * - Nighthowler: Count creatures in graveyards
 * - Consuming Aberration: Count cards in opponents' graveyards
 * 
 * @param card - The card data with oracle_text and type information
 * @param gameState - Optional game state for dynamic calculations
 * @returns { power, toughness } or undefined if not calculable
 */
export function calculateVariablePT(
  card: any,
  gameState?: any
): { power: number; toughness: number } | undefined {
  if (!card) return undefined;
  
  const name = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  
  // Marit Lage token - Defined as 20/20
  if (name.includes('marit lage')) {
    return { power: 20, toughness: 20 };
  }
  
  // Check oracle text for common patterns
  
  // "where X is" patterns - e.g., "power and toughness are each equal to"
  if (oracleText.includes('power and toughness are each equal to')) {
    // Common patterns:
    
    // "number of creatures you control"
    if (oracleText.includes('number of creatures you control')) {
      // Dynamic - would need battlefield state
      if (gameState?.battlefield) {
        const controllerId = card.controller;
        const creatures = gameState.battlefield.filter((p: any) => 
          p.controller === controllerId && 
          (p.card?.type_line || '').toLowerCase().includes('creature')
        );
        return { power: creatures.length, toughness: creatures.length };
      }
      return { power: 0, toughness: 0 }; // Default for unknown state
    }
    
    // "cards in your hand"
    if (oracleText.includes('cards in your hand')) {
      // Dynamic - would need zone state
      return { power: 0, toughness: 0 }; // Default for unknown state
    }
    
    // "lands you control"
    if (oracleText.includes('lands you control')) {
      if (gameState?.battlefield) {
        const controllerId = card.controller;
        const lands = gameState.battlefield.filter((p: any) => 
          p.controller === controllerId && 
          (p.card?.type_line || '').toLowerCase().includes('land')
        );
        return { power: lands.length, toughness: lands.length };
      }
      return { power: 0, toughness: 0 };
    }
  }
  
  // For cards we can't calculate, check if there's a defined base in reminder text
  // Some cards define their size like "(This creature has base power 6/6)"
  const sizeMatch = oracleText.match(/base power and toughness (\d+)\/(\d+)/i);
  if (sizeMatch) {
    return { power: parseInt(sizeMatch[1], 10), toughness: parseInt(sizeMatch[2], 10) };
  }
  
  // Default fallback - return undefined so caller knows we couldn't calculate
  return undefined;
}