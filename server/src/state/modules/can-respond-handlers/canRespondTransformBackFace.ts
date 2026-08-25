// server/src/state/modules/can-respond-handlers/canRespondTransformBackFace.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: isTransformBackFace (back-face oracle pattern).
// Public entry symbols: isTransformBackFace.

/**
 * Check if a card is a transform back face (not playable from hand)
 * 
 * Transform back faces have "(Transforms from [Name])" in their oracle text
 * and should only be accessible after the front face transforms.
 * 
 * Examples:
 * - "Barracks of the Thousand" has "(Transforms from Thousand Moons Smithy.)" 
 * - Back faces of werewolves, etc.
 */
export function isTransformBackFace(card: any): boolean {
  if (!card) return false;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for the standard transform pattern: "(Transforms from [Name])"
  // This is the indicator that this is a back face that cannot be played from hand
  return /\(transforms from [^)]+\)/i.test(oracleText);
}
