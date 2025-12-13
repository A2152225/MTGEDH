/**
 * triggers/aura-graveyard.ts
 * 
 * Aura Graveyard Triggers (Rancor, Spirit Loop, etc.)
 * 
 * Known auras that return to owner's hand when put into graveyard from battlefield.
 * These have effects like: "When ~ is put into a graveyard from the battlefield, 
 * return ~ to its owner's hand."
 */

/**
 * Known auras that return to owner's hand when put into graveyard from battlefield
 */
export const AURAS_THAT_RETURN_TO_HAND: Record<string, { effect: string; condition?: string }> = {
  "rancor": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." 
  },
  "spirit loop": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." 
  },
  "feather of flight": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." 
  },
  "briar shield": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand.",
    condition: "sacrifice"
  },
  "fortitude": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." 
  },
  "familiar ground": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." 
  },
  "whip silk": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." 
  },
  "jolrael's favor": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." 
  },
  "mark of fury": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." 
  },
  "fallen ideal": { 
    effect: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand." 
  },
  "kaya's ghostform": { 
    effect: "When enchanted permanent dies or is put into exile, return that card to the battlefield and return Kaya's Ghostform to its owner's hand." 
  },
};

/**
 * Check if an aura should return to its owner's hand when put into graveyard from battlefield
 * @param card The aura card
 * @returns Object with shouldReturn and the effect description
 */
export function checkAuraGraveyardReturn(card: any): { shouldReturn: boolean; effect?: string } {
  if (!card) return { shouldReturn: false };
  
  const cardName = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Check known auras first
  for (const [knownName, info] of Object.entries(AURAS_THAT_RETURN_TO_HAND)) {
    if (cardName.includes(knownName)) {
      return { shouldReturn: true, effect: info.effect };
    }
  }
  
  // Generic detection via oracle text
  // Pattern: "When ~ is put into a graveyard from the battlefield, return ~ to its owner's hand"
  if (oracleText.includes('put into a graveyard from the battlefield') && 
      oracleText.includes('return') && 
      oracleText.includes('hand')) {
    return { shouldReturn: true, effect: 'Return to owner\'s hand' };
  }
  
  return { shouldReturn: false };
}
