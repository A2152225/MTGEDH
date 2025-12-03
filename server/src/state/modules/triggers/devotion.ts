/**
 * triggers/devotion.ts
 * 
 * Devotion calculation for permanents.
 * Handles counting mana symbols and calculating devotion amounts.
 */

/**
 * Calculate devotion to a color for a player
 * Devotion = count of mana symbols of that color in mana costs of permanents you control
 */
export function calculateDevotion(
  gameState: any,
  playerId: string,
  color: 'W' | 'U' | 'B' | 'R' | 'G'
): number {
  const battlefield = gameState?.battlefield || [];
  let devotion = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const manaCost = permanent.card?.mana_cost || "";
    
    // Count occurrences of the color symbol
    // Format: {W}, {U}, {B}, {R}, {G}
    // Also count hybrid: {W/U}, {W/B}, etc.
    const colorSymbol = `{${color}}`;
    const regex = new RegExp(`\\{${color}(?:\\/[WUBRG])?\\}|\\{[WUBRG]\\/${color}\\}`, 'gi');
    const matches = manaCost.match(regex) || [];
    devotion += matches.length;
  }
  
  return devotion;
}

/**
 * Get the amount of mana produced by a devotion-based ability
 * Cards like Karametra's Acolyte, Nykthos
 */
export function getDevotionManaAmount(
  card: any,
  gameState: any,
  controllerId: string
): { color: string; amount: number }[] {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const results: { color: string; amount: number }[] = [];
  
  // Pattern: "Add an amount of {G} equal to your devotion to green"
  const devotionManaMatch = oracleText.match(
    /add (?:an amount of )?(\{[WUBRGC]\})(?:[^.]*?)equal to your devotion to (\w+)/i
  );
  
  if (devotionManaMatch) {
    const manaSymbol = devotionManaMatch[1].toUpperCase();
    const colorName = devotionManaMatch[2].toLowerCase();
    
    let colorCode: 'W' | 'U' | 'B' | 'R' | 'G' = 'G';
    switch (colorName) {
      case 'white': colorCode = 'W'; break;
      case 'blue': colorCode = 'U'; break;
      case 'black': colorCode = 'B'; break;
      case 'red': colorCode = 'R'; break;
      case 'green': colorCode = 'G'; break;
    }
    
    const amount = calculateDevotion(gameState, controllerId, colorCode);
    
    // Extract color from mana symbol
    const color = manaSymbol.replace(/[{}]/g, '');
    
    // Note: Devotion-based mana abilities should produce 0 if devotion is 0
    // Do not use Math.max(1, amount) as that would be incorrect
    results.push({ color, amount });
  }
  
  // Nykthos pattern: "Add X mana in any combination of colors..."
  if (oracleText.includes('nykthos') || 
      (oracleText.includes('devotion') && oracleText.includes('any combination'))) {
    // Nykthos requires choosing a color and getting devotion to that color
    // This would need UI interaction, so we return a placeholder
    results.push({ color: 'devotion_choice', amount: 0 });
  }
  
  return results;
}
