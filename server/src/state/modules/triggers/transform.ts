/**
 * triggers/transform.ts
 * 
 * Transform and flip card trigger detection.
 * Handles double-faced cards and transform triggers.
 */

import type { GameContext } from "../../context.js";

export interface TransformCheckResult {
  permanentId: string;
  cardName: string;
  shouldTransform: boolean;
  reason: string;
  newFace?: any;
}

/**
 * Check if a permanent should transform at end of turn
 * Handles cards like Growing Rites of Itlimoc, Legion's Landing, etc.
 */
export function checkEndOfTurnTransforms(
  ctx: GameContext,
  activePlayerId: string
): TransformCheckResult[] {
  const results: TransformCheckResult[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== activePlayerId) continue;
    if (!permanent.card) continue;
    
    const cardName = (permanent.card.name || "").toLowerCase();
    const oracleText = ((permanent.card as any).oracle_text || "").toLowerCase();
    const layout = (permanent.card as any).layout;
    const cardFaces = (permanent.card as any).card_faces;
    
    // Only check transformable cards
    if (layout !== 'transform' && layout !== 'double_faced_token') continue;
    if (!Array.isArray(cardFaces) || cardFaces.length < 2) continue;
    
    // Skip already transformed cards (back face is showing)
    if ((permanent as any).transformed) continue;
    
    // Growing Rites of Itlimoc: Transform at end of turn if you control 4+ creatures
    if (cardName.includes('growing rites of itlimoc')) {
      const creatureCount = battlefield.filter((p: any) => 
        p.controller === activePlayerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      ).length;
      
      if (creatureCount >= 4) {
        results.push({
          permanentId: permanent.id,
          cardName: permanent.card.name,
          shouldTransform: true,
          reason: `Control ${creatureCount} creatures (4+ required)`,
          newFace: cardFaces[1],
        });
      }
    }
    
    // Legion's Landing: Transform when you attack with 3+ creatures
    // (This is actually checked during declare attackers, but including for completeness)
    
    // Arguel's Blood Fast: Transform at end of turn if you have 5 or less life
    if (cardName.includes("arguel's blood fast")) {
      const life = (ctx as any).life?.[activePlayerId] ?? 40;
      if (life <= 5) {
        results.push({
          permanentId: permanent.id,
          cardName: permanent.card.name,
          shouldTransform: true,
          reason: `Life total is ${life} (5 or less required)`,
          newFace: cardFaces[1],
        });
      }
    }
    
    // Dowsing Dagger: Transform when creature deals combat damage
    // (Checked during combat damage resolution)
    
    // Treasure Map: Transform when it has 3+ landmark counters
    if (cardName.includes('treasure map')) {
      const counters = permanent.counters || {};
      if ((counters.landmark || 0) >= 3) {
        results.push({
          permanentId: permanent.id,
          cardName: permanent.card.name,
          shouldTransform: true,
          reason: `Has ${counters.landmark} landmark counters (3+ required)`,
          newFace: cardFaces[1],
        });
      }
    }
    
    // Generic pattern: "At the beginning of your end step, if [condition], transform ~"
    const endStepTransformMatch = oracleText.match(
      /at the beginning of (?:your )?end step,?\s*if ([^,]+),?\s*transform/i
    );
    if (endStepTransformMatch) {
      // We found a transform trigger - would need to evaluate the condition
      // For now, mark it for UI to handle
      results.push({
        permanentId: permanent.id,
        cardName: permanent.card.name,
        shouldTransform: false, // UI needs to confirm
        reason: `Condition: ${endStepTransformMatch[1]}`,
        newFace: cardFaces[1],
      });
    }
  }
  
  return results;
}
