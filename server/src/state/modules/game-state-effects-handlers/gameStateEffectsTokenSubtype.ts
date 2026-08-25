// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: isTreasureToken / isArtifactTokenSubtype (Treasure and other
// artifact token subtype checks).
// Public entry symbols: isTreasureToken, isArtifactTokenSubtype.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

/**
 * Check if a permanent is an actual Treasure token/artifact (not just a card that creates treasures)
 * A Treasure has "Treasure" as a subtype in type_line (e.g., "Token Artifact — Treasure")
 * Cards like "Dockside Extortionist" have "treasure" in oracle text but are NOT treasures
 */
export function isTreasureToken(permanent: any): boolean {
  const typeLine = (permanent?.card?.type_line || "").toLowerCase();
  const oracleText = (permanent?.card?.oracle_text || "").toLowerCase();
  const cardName = (permanent?.card?.name || "").toLowerCase();
  
  // Check if type_line contains "treasure" as a subtype (after the em-dash or hyphen)
  // Valid: "Token Artifact — Treasure", "Artifact — Treasure"
  // Invalid: Cards that just mention "treasure" in name/text
  const hasEmDash = typeLine.includes("—") || typeLine.includes("-");
  if (hasEmDash) {
    // Get the subtype portion (after the dash)
    const subtypePortion = typeLine.split(/[—-]/)[1] || "";
    // Must have "treasure" as a subtype, not in the main type
    if (subtypePortion.includes("treasure")) {
      return true;
    }
  }
  
  // For tokens without type_line parsing, check if it's explicitly a treasure token
  if (permanent?.isToken && cardName === "treasure") {
    return true;
  }
  
  // Check for the standard Treasure token oracle text pattern
  // Treasure tokens have: "{T}, Sacrifice this artifact: Add one mana of any color."
  if (typeLine.includes("artifact") && 
      oracleText.includes("sacrifice") && 
      oracleText.includes("add one mana of any color") &&
      // Must NOT have other complex abilities (real cards have more text)
      oracleText.length < 100) {
    return true;
  }
  
  return false;
}

/**
 * Check if a permanent is a Food, Clue, Blood, or other artifact token type
 * Similar logic to isTreasureToken - checks actual subtype, not oracle text mentions
 */
export function isArtifactTokenSubtype(permanent: any, subtype: string): boolean {
  const typeLine = (permanent?.card?.type_line || "").toLowerCase();
  const subtypeLower = subtype.toLowerCase();
  
  const hasEmDash = typeLine.includes("—") || typeLine.includes("-");
  if (hasEmDash) {
    const subtypePortion = typeLine.split(/[—-]/)[1] || "";
    if (subtypePortion.includes(subtypeLower)) {
      return true;
    }
  }
  
  // For tokens without type_line parsing
  if (permanent?.isToken && (permanent?.card?.name || "").toLowerCase() === subtypeLower) {
    return true;
  }
  
  return false;
}
