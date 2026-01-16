/**
 * Color choice selection handlers
 * 
 * Used for cards that require choosing a color as they enter the battlefield or resolve:
 * - Caged Sun - "As Caged Sun enters the battlefield, choose a color"
 * - Chromatic Lantern variants
 * - Color-specific protection effects
 * - Brave the Elements - "Choose a color. White creatures you control gain protection..."
 * etc.
 */


/**
 * Check if a card requires color choice on ETB
 */
export function requiresColorChoice(card: any): { required: boolean; reason: string } {
  if (!card) return { required: false, reason: "" };
  
  const name = (card.name || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Caged Sun - "As Caged Sun enters the battlefield, choose a color"
  if (name.includes("caged sun")) {
    return { required: true, reason: "Choose a color for Caged Sun's effects" };
  }
  
  // Gauntlet of Power - "As Gauntlet of Power enters the battlefield, choose a color"
  if (name.includes("gauntlet of power")) {
    return { required: true, reason: "Choose a color for Gauntlet of Power" };
  }
  
  // Extraplanar Lens - "As Extraplanar Lens enters the battlefield, you may choose a color"
  if (name.includes("extraplanar lens")) {
    return { required: true, reason: "Choose a color for Extraplanar Lens (optional)" };
  }
  
  // Generic detection: look for "as ~ enters the battlefield, choose a color" or "as ~ enters, choose a color"
  // This pattern specifically matches the ETB template where choosing a color is part of the enters clause
  // Pattern breakdown:
  // - "as .+? enters" matches "as [card name] enters" 
  // - "(?: the battlefield)?" optionally matches " the battlefield" (newer template omits this)
  // - ",?\s+" matches optional comma and whitespace
  // - "(?:you may\s+)?" optionally matches "you may "
  // - "choose a colou?r" matches "choose a color" or "choose a colour"
  // - "\.?" optionally matches period at end
  // - Must be followed by sentence boundary (end of string, newline, or next sentence)
  const entersChooseColorPattern = /as .+? enters(?: the battlefield)?,?\s+(?:you may\s+)?choose a colou?r\.?(?:\n|$)/i;
  if (entersChooseColorPattern.test(oracleText)) {
    return { required: true, reason: "Choose a color" };
  }
  
  return { required: false, reason: "" };
}

