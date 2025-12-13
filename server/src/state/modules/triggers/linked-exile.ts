/**
 * triggers/linked-exile.ts
 * 
 * Linked Exile System (Oblivion Ring, Banisher Priest, etc.)
 * 
 * These cards exile a target permanent and return it when they leave the battlefield.
 * We track the link between the exiling permanent and exiled cards so when the 
 * enchantment/creature leaves, we return the exiled cards to the battlefield.
 */

import type { GameContext } from "../../context.js";

/**
 * Represents a linked exile - a permanent that has exiled another permanent
 * and will return it when the exiling permanent leaves the battlefield.
 */
export interface LinkedExile {
  id: string;                  // Unique identifier for this linked exile
  exilingPermanentId: string;  // The permanent that created the exile (e.g., Oblivion Ring)
  exilingPermanentName: string;// Name for logging/display
  exiledCardId: string;        // The card that was exiled
  exiledCard: any;             // The actual card data to return
  exiledCardName: string;      // Name for logging/display
  originalOwner: string;       // Owner of the exiled card (for returning)
  originalController: string;  // Controller of the exiled permanent
  returnCondition: 'ltb' | 'dies' | 'destroyed'; // When to return
}

/**
 * Known cards with linked exile effects.
 * Pattern: "exile target [X] until ~ leaves the battlefield"
 */
const LINKED_EXILE_CARDS: Record<string, { 
  targetType: string;         // What can be exiled
  returnCondition: 'ltb';     // Always returns on LTB
  isCreature?: boolean;       // If the exiling card is a creature (Banisher Priest)
  controllerRestriction?: 'opponent' | 'you' | 'any'; // Whose permanents can be targeted
}> = {
  // White enchantments
  "oblivion ring": { targetType: "nonland permanent", returnCondition: 'ltb', controllerRestriction: 'any' },
  "journey to nowhere": { targetType: "creature", returnCondition: 'ltb', controllerRestriction: 'any' },
  "banishing light": { targetType: "nonland permanent", returnCondition: 'ltb', controllerRestriction: 'opponent' },
  "glass casket": { targetType: "creature with mana value 3 or less", returnCondition: 'ltb', controllerRestriction: 'opponent' },
  "cast out": { targetType: "nonland permanent", returnCondition: 'ltb', controllerRestriction: 'any' },
  "detention sphere": { targetType: "nonland permanent and all other permanents with the same name", returnCondition: 'ltb', controllerRestriction: 'opponent' },
  "stasis snare": { targetType: "creature", returnCondition: 'ltb', controllerRestriction: 'any' },
  "static prison": { targetType: "creature", returnCondition: 'ltb', controllerRestriction: 'opponent' },
  "suspension field": { targetType: "creature with toughness 3 or greater", returnCondition: 'ltb', controllerRestriction: 'any' },
  "prison realm": { targetType: "creature or planeswalker", returnCondition: 'ltb', controllerRestriction: 'opponent' },
  "circle of confinement": { targetType: "creature with mana value 3 or less", returnCondition: 'ltb', controllerRestriction: 'opponent' },
  "borrowed time": { targetType: "nonland permanent", returnCondition: 'ltb', controllerRestriction: 'opponent' },
  "ossification": { targetType: "creature or planeswalker", returnCondition: 'ltb', controllerRestriction: 'opponent' },
  "skyclave apparition": { targetType: "nonland nontoken permanent with mana value 4 or less", returnCondition: 'ltb', controllerRestriction: 'opponent', isCreature: true },
  "fiend hunter": { targetType: "creature", returnCondition: 'ltb', controllerRestriction: 'any', isCreature: true },
  "banisher priest": { targetType: "creature", returnCondition: 'ltb', controllerRestriction: 'opponent', isCreature: true },
  "fairgrounds warden": { targetType: "creature", returnCondition: 'ltb', controllerRestriction: 'opponent', isCreature: true },
  "brutal cathar": { targetType: "creature", returnCondition: 'ltb', controllerRestriction: 'opponent', isCreature: true },
  "palace jailer": { targetType: "creature", returnCondition: 'ltb', controllerRestriction: 'opponent', isCreature: true },
  "mangara of corondor": { targetType: "permanent", returnCondition: 'ltb' }, // Special - exiles self too
  
  // Note: Reality Shift is NOT a linked exile - it permanently exiles
  // "reality shift" performs permanent exile, so NOT included here
  
  // Black
  "faceless butcher": { targetType: "creature other than Faceless Butcher", returnCondition: 'ltb', isCreature: true },
  
  // Artifacts
  "duplicant": { targetType: "nontoken creature", returnCondition: 'ltb', isCreature: true },
  "spine of ish sah": { targetType: "permanent", returnCondition: 'ltb' },
};

/**
 * Detect if a card has a linked exile effect
 */
export function detectLinkedExileEffect(card: any): {
  hasLinkedExile: boolean;
  targetType?: string;
  returnCondition?: 'ltb';
  controllerRestriction?: 'opponent' | 'you' | 'any';
  isCreature?: boolean;
} {
  if (!card) return { hasLinkedExile: false };
  
  const cardNameLower = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Check known cards first
  const knownCard = LINKED_EXILE_CARDS[cardNameLower];
  if (knownCard) {
    return {
      hasLinkedExile: true,
      targetType: knownCard.targetType,
      returnCondition: knownCard.returnCondition,
      controllerRestriction: knownCard.controllerRestriction,
      isCreature: knownCard.isCreature,
    };
  }
  
  // Dynamic detection: Pattern "exile target ... until ~ leaves the battlefield"
  // or "exile ... until ~ leaves the battlefield"
  const linkedExilePattern = /exile (?:target |that |a )?([^.]+) until [^.]* leaves the battlefield/i;
  const match = oracleText.match(linkedExilePattern);
  if (match) {
    const targetDesc = match[1].trim();
    // Determine if it restricts to opponent's permanents
    const isOpponentOnly = oracleText.includes("an opponent controls") || 
                           oracleText.includes("opponent controls");
    
    return {
      hasLinkedExile: true,
      targetType: targetDesc,
      returnCondition: 'ltb',
      controllerRestriction: isOpponentOnly ? 'opponent' : 'any',
      isCreature: card.type_line?.toLowerCase().includes('creature'),
    };
  }
  
  return { hasLinkedExile: false };
}

/**
 * Register a linked exile - call when Oblivion Ring-style effect exiles a permanent.
 * This tracks the link so we can return the card when the enchantment leaves.
 */
export function registerLinkedExile(
  ctx: GameContext,
  exilingPermanentId: string,
  exilingPermanentName: string,
  exiledCard: any,
  originalOwner: string,
  originalController: string
): string {
  const state = (ctx as any).state;
  state.linkedExiles = state.linkedExiles || [];
  
  const linkId = `linked_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  
  const linkedExile: LinkedExile = {
    id: linkId,
    exilingPermanentId,
    exilingPermanentName,
    exiledCardId: exiledCard.id || exiledCard.name,
    exiledCard: { ...exiledCard }, // Clone the card data
    exiledCardName: exiledCard.name || 'Unknown',
    originalOwner,
    originalController,
    returnCondition: 'ltb',
  };
  
  state.linkedExiles.push(linkedExile);
  
  console.log(`[registerLinkedExile] ${exilingPermanentName} (${exilingPermanentId}) exiled ${linkedExile.exiledCardName} - will return when it leaves`);
  
  return linkId;
}

/**
 * Process linked exile returns when a permanent leaves the battlefield.
 * Call this whenever a permanent is removed from the battlefield (destroyed, exiled, bounced, etc.)
 */
export function processLinkedExileReturns(
  ctx: GameContext,
  leavingPermanentId: string
): { returnedCards: any[]; owner: string }[] {
  const state = (ctx as any).state;
  if (!state.linkedExiles || state.linkedExiles.length === 0) {
    return [];
  }
  
  // Find all linked exiles created by this permanent
  const linkedToReturn = state.linkedExiles.filter(
    (le: LinkedExile) => le.exilingPermanentId === leavingPermanentId
  );
  
  if (linkedToReturn.length === 0) {
    return [];
  }
  
  const returns: { returnedCards: any[]; owner: string }[] = [];
  
  for (const linked of linkedToReturn) {
    console.log(`[processLinkedExileReturns] ${linked.exilingPermanentName} left - returning ${linked.exiledCardName} to battlefield`);
    
    // Return the exiled card to the battlefield under its owner's control
    // Per Rule 610.3, when a card returns from exile via "until ~ leaves" effect,
    // it returns under its owner's control
    const newPermanent = {
      id: `perm_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      card: linked.exiledCard,
      controller: linked.originalOwner, // Returns under owner's control (Rule 610.3)
      owner: linked.originalOwner,
      tapped: false,
      summoning_sickness: linked.exiledCard.type_line?.toLowerCase().includes('creature') || false,
      counters: {}, // Returns without counters
    };
    
    // Add to battlefield
    state.battlefield = state.battlefield || [];
    state.battlefield.push(newPermanent);
    
    // Remove from exile zone if present
    const ownerZones = ctx.state?.zones?.[linked.originalOwner] as any;
    if (ownerZones?.exile) {
      const exileIdx = ownerZones.exile.findIndex(
        (c: any) => c.id === linked.exiledCard.id || c.name === linked.exiledCardName
      );
      if (exileIdx >= 0) {
        ownerZones.exile.splice(exileIdx, 1);
        if (ownerZones.exileCount !== undefined) {
          ownerZones.exileCount = ownerZones.exile.length;
        }
      }
    }
    
    returns.push({ returnedCards: [newPermanent], owner: linked.originalOwner });
    
    // Trigger ETB effects for the returned permanent
    // Note: The returned permanent is a new object, so it gets fresh ETB triggers
    triggerETBEffectsForReturnedPermanent(ctx, newPermanent, linked.originalOwner);
  }
  
  // Remove the processed linked exiles
  state.linkedExiles = state.linkedExiles.filter(
    (le: LinkedExile) => le.exilingPermanentId !== leavingPermanentId
  );
  
  ctx.bumpSeq();
  
  return returns;
}

/**
 * Helper to trigger ETB effects for a permanent returned from exile
 */
function triggerETBEffectsForReturnedPermanent(ctx: GameContext, permanent: any, controllerId: string): void {
  // This will fire ETB triggers for the returned permanent
  // Since it's a new object, all "enters the battlefield" triggers fire
  const card = permanent.card;
  if (!card) return;
  
  // The ETB system should handle this via the normal ETB detection
  // We just log it for now - the main ETB processing happens in stack.ts
  console.log(`[triggerETBEffectsForReturnedPermanent] ${card.name} returned from exile - ETB triggers may fire`);
}

/**
 * Get all linked exiles created by a specific permanent
 */
export function getLinkedExilesForPermanent(ctx: GameContext, permanentId: string): LinkedExile[] {
  const state = (ctx as any).state;
  if (!state.linkedExiles) return [];
  
  return state.linkedExiles.filter(
    (le: LinkedExile) => le.exilingPermanentId === permanentId
  );
}

/**
 * Check if a card that was exiled is linked to a permanent (will return when that permanent leaves)
 */
export function isCardLinkedExile(ctx: GameContext, exiledCardId: string): LinkedExile | null {
  const state = (ctx as any).state;
  if (!state.linkedExiles) return null;
  
  return state.linkedExiles.find(
    (le: LinkedExile) => le.exiledCardId === exiledCardId
  ) || null;
}
