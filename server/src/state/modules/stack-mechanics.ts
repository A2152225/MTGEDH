/**
 * stack-mechanics.ts
 * 
 * Comprehensive stack system for Magic: The Gathering
 * 
 * STACK ITEMS:
 * - Spells (instants, sorceries, creatures, etc.)
 * - Activated abilities
 * - Triggered abilities
 * 
 * COUNTERSPELLS:
 * - Counter target spell (Counterspell, Cancel)
 * - Counter target noncreature spell (Negate)
 * - Counter target creature spell (Essence Scatter)
 * - Counter unless pays X (Mana Leak, Spell Pierce)
 * - Counter target activated/triggered ability (Stifle, Tale's End)
 * - Counter target spell or ability (Disallow)
 * 
 * WARD:
 * - When becomes target of opponent's spell/ability, counter unless they pay cost
 * 
 * COPYING:
 * - Copy target triggered ability (Strionic Resonator)
 * - Copy target activated/triggered ability (Lithoform Engine)
 * - Copy target spell (Fork, Reverberate, Twincast)
 * 
 * REDIRECTING:
 * - Change targets of target spell (Redirect, Misdirection)
 * - Choose new targets for target spell (Deflecting Swat)
 */

import type { GameContext } from "../context.js";

export interface StackItem {
  id: string;
  type: 'spell' | 'activated_ability' | 'triggered_ability' | 'mana_ability';
  controller: string;
  source: {
    permanentId?: string;
    cardId?: string;
    cardName: string;
    zone: string;
  };
  card?: any; // Full card data for spells
  ability?: {
    id: string;
    text: string;
    cost?: string;
    isManaAbility?: boolean;
  };
  targets?: StackTarget[];
  modes?: string[]; // For modal spells
  xValue?: number;
  additionalCosts?: string[];
  alternativeCost?: string; // flashback, overload, etc.
  canBeCountered: boolean;
  timestamp: number;
}

export interface StackTarget {
  type: 'player' | 'permanent' | 'spell' | 'ability' | 'card_in_zone';
  id: string;
  description?: string;
  zone?: string;
}

export interface CounterSpellEffect {
  targetTypes: ('spell' | 'activated_ability' | 'triggered_ability' | 'any')[];
  spellTypes?: string[]; // 'creature', 'noncreature', 'instant', 'sorcery', etc.
  unlessPays?: string; // Mana cost to avoid being countered
  condition?: string;
}

export interface WardEffect {
  permanentId: string;
  cardName: string;
  cost: string; // The ward cost
  triggeredBy: string; // The spell/ability ID that triggered ward
}

/**
 * Known counterspell patterns
 */
const COUNTERSPELL_PATTERNS: Record<string, CounterSpellEffect> = {
  // Counter any spell
  "counterspell": { targetTypes: ['spell'] },
  "cancel": { targetTypes: ['spell'] },
  "dissolve": { targetTypes: ['spell'] },
  "dissipate": { targetTypes: ['spell'] },
  "void shatter": { targetTypes: ['spell'] },
  "absorb": { targetTypes: ['spell'] },
  "undermine": { targetTypes: ['spell'] },
  "cryptic command": { targetTypes: ['spell'] },
  "force of will": { targetTypes: ['spell'] },
  "force of negation": { targetTypes: ['spell'], spellTypes: ['noncreature'] },
  "pact of negation": { targetTypes: ['spell'] },
  "fierce guardianship": { targetTypes: ['spell'], spellTypes: ['noncreature'] },
  "flusterstorm": { targetTypes: ['spell'], spellTypes: ['instant', 'sorcery'] },
  
  // Counter noncreature
  "negate": { targetTypes: ['spell'], spellTypes: ['noncreature'] },
  "dovin's veto": { targetTypes: ['spell'], spellTypes: ['noncreature'] },
  
  // Counter creature
  "essence scatter": { targetTypes: ['spell'], spellTypes: ['creature'] },
  "remove soul": { targetTypes: ['spell'], spellTypes: ['creature'] },
  
  // Counter unless pays
  "mana leak": { targetTypes: ['spell'], unlessPays: '{3}' },
  "spell pierce": { targetTypes: ['spell'], spellTypes: ['noncreature'], unlessPays: '{2}' },
  "daze": { targetTypes: ['spell'], unlessPays: '{1}' },
  "force spike": { targetTypes: ['spell'], unlessPays: '{1}' },
  "mental misstep": { targetTypes: ['spell'] }, // CMC 1 only
  "swan song": { targetTypes: ['spell'], spellTypes: ['instant', 'sorcery', 'enchantment'] },
  "an offer you can't refuse": { targetTypes: ['spell'], spellTypes: ['noncreature'] },
  "arcane denial": { targetTypes: ['spell'] },
  
  // Counter abilities
  "stifle": { targetTypes: ['activated_ability', 'triggered_ability'] },
  "tale's end": { targetTypes: ['activated_ability', 'triggered_ability'] },
  "trickbind": { targetTypes: ['activated_ability', 'triggered_ability'] },
  "voidslime": { targetTypes: ['spell', 'activated_ability', 'triggered_ability'] },
  "disallow": { targetTypes: ['spell', 'activated_ability', 'triggered_ability'] },
  "repudiate": { targetTypes: ['activated_ability', 'triggered_ability'] },
  
  // Conditional counters
  "dispel": { targetTypes: ['spell'], spellTypes: ['instant'] },
  "envelop": { targetTypes: ['spell'], spellTypes: ['sorcery'] },
  "annul": { targetTypes: ['spell'], spellTypes: ['artifact', 'enchantment'] },
  "ceremonious rejection": { targetTypes: ['spell'], spellTypes: ['colorless'] },
};

/**
 * Create a spell stack item
 */
export function createSpellStackItem(
  controller: string,
  card: any,
  targets: StackTarget[] = [],
  options: {
    alternativeCost?: string;
    xValue?: number;
    modes?: string[];
    additionalCosts?: string[];
  } = {}
): StackItem {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Check if spell can be countered
  const canBeCountered = !oracleText.includes("can't be countered");
  
  return {
    id: `spell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'spell',
    controller,
    source: {
      cardId: card?.id,
      cardName: card?.name || "Unknown Spell",
      zone: 'hand', // or 'graveyard' for flashback, etc.
    },
    card,
    targets,
    modes: options.modes,
    xValue: options.xValue,
    additionalCosts: options.additionalCosts,
    alternativeCost: options.alternativeCost,
    canBeCountered,
    timestamp: Date.now(),
  };
}

/**
 * Create an activated ability stack item
 */
export function createActivatedAbilityStackItem(
  controller: string,
  permanent: any,
  abilityText: string,
  cost: string,
  targets: StackTarget[] = [],
  isManaAbility: boolean = false
): StackItem {
  return {
    id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: isManaAbility ? 'mana_ability' : 'activated_ability',
    controller,
    source: {
      permanentId: permanent?.id,
      cardName: permanent?.card?.name || "Unknown",
      zone: 'battlefield',
    },
    ability: {
      id: `act_${permanent?.id}`,
      text: abilityText,
      cost,
      isManaAbility,
    },
    targets,
    canBeCountered: !isManaAbility, // Mana abilities can't be countered
    timestamp: Date.now(),
  };
}

/**
 * Create a triggered ability stack item
 */
export function createTriggeredAbilityStackItem(
  controller: string,
  source: { permanentId?: string; cardName: string; zone: string },
  abilityText: string,
  targets: StackTarget[] = []
): StackItem {
  return {
    id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'triggered_ability',
    controller,
    source,
    ability: {
      id: `trig_${source.permanentId || Date.now()}`,
      text: abilityText,
    },
    targets,
    canBeCountered: true,
    timestamp: Date.now(),
  };
}

/**
 * Check if a counterspell can legally target a stack item
 */
export function canCounterStackItem(
  counterSpell: any,
  target: StackItem
): { legal: boolean; reason?: string } {
  const cardName = (counterSpell?.name || "").toLowerCase();
  const oracleText = (counterSpell?.oracle_text || "").toLowerCase();
  
  // Check if target can be countered at all
  if (!target.canBeCountered) {
    return { legal: false, reason: "This spell or ability can't be countered" };
  }
  
  // Mana abilities can never be countered
  if (target.type === 'mana_ability') {
    return { legal: false, reason: "Mana abilities can't be countered" };
  }
  
  // Check known counterspell patterns
  const pattern = Object.entries(COUNTERSPELL_PATTERNS).find(([name]) => 
    cardName.includes(name)
  )?.[1];
  
  if (pattern) {
    // Check target type
    if (!pattern.targetTypes.includes(target.type) && !pattern.targetTypes.includes('any')) {
      if (target.type === 'spell' && !pattern.targetTypes.includes('spell')) {
        return { legal: false, reason: "Can only counter abilities, not spells" };
      }
      if ((target.type === 'activated_ability' || target.type === 'triggered_ability') && 
          !pattern.targetTypes.some(t => t.includes('ability'))) {
        return { legal: false, reason: "Can only counter spells, not abilities" };
      }
    }
    
    // Check spell type restrictions
    if (pattern.spellTypes && target.type === 'spell' && target.card) {
      const typeLine = (target.card.type_line || "").toLowerCase();
      const matchesType = pattern.spellTypes.some(st => {
        if (st === 'noncreature') return !typeLine.includes('creature');
        if (st === 'colorless') return !target.card.colors || target.card.colors.length === 0;
        return typeLine.includes(st);
      });
      
      if (!matchesType) {
        return { legal: false, reason: `Can only counter ${pattern.spellTypes.join(' or ')} spells` };
      }
    }
  }
  
  // Generic oracle text parsing
  if (oracleText.includes("counter target spell")) {
    if (target.type !== 'spell') {
      return { legal: false, reason: "Can only counter spells" };
    }
    
    // Check for type restrictions in oracle text
    if (oracleText.includes("noncreature") && target.card?.type_line?.toLowerCase().includes('creature')) {
      return { legal: false, reason: "Can only counter noncreature spells" };
    }
    if (oracleText.includes("creature spell") && !target.card?.type_line?.toLowerCase().includes('creature')) {
      return { legal: false, reason: "Can only counter creature spells" };
    }
  }
  
  if (oracleText.includes("counter target activated") || oracleText.includes("counter target triggered")) {
    if (target.type === 'spell') {
      return { legal: false, reason: "Can only counter abilities" };
    }
  }
  
  return { legal: true };
}

/**
 * Counter a stack item
 */
export function counterStackItem(
  ctx: GameContext,
  stackItemId: string,
  counteringPlayerId: string
): { success: boolean; counteredItem?: StackItem; reason?: string } {
  const stack = (ctx.state?.stack || []) as any as StackItem[];
  const idx = stack.findIndex(item => item.id === stackItemId);
  
  if (idx === -1) {
    return { success: false, reason: "Stack item not found" };
  }
  
  const item = stack[idx];
  
  if (!item.canBeCountered) {
    return { success: false, reason: "This spell or ability can't be countered" };
  }
  
  if (item.type === 'mana_ability') {
    return { success: false, reason: "Mana abilities can't be countered" };
  }
  
  // Remove from stack
  stack.splice(idx, 1);
  
  // Move spell card to graveyard if it was a spell
  if (item.type === 'spell' && item.card) {
    const zones = (ctx as any).zones?.[item.controller];
    if (zones) {
      zones.graveyard = zones.graveyard || [];
      zones.graveyard.push({ ...item.card, zone: 'graveyard' });
      zones.graveyardCount = zones.graveyard.length;
    }
  }
  
  ctx.bumpSeq();
  
  return { success: true, counteredItem: item };
}

/**
 * Check if a permanent has Ward and get the ward cost
 */
export function getWardCost(card: any): string | null {
  const oracleText = (card?.oracle_text || "");
  
  // Ward {N} or Ward—[cost]
  const wardMatch = oracleText.match(/ward[—\s]*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (wardMatch) {
    return wardMatch[1];
  }
  
  // Ward with non-mana cost (like "Ward—Discard a card")
  const wardDashMatch = oracleText.match(/ward[—\-]\s*([^.]+)/i);
  if (wardDashMatch && !wardDashMatch[1].includes('{')) {
    return wardDashMatch[1].trim();
  }
  
  return null;
}

/**
 * Check if targeting a permanent triggers Ward
 */
export function checkWardTrigger(
  permanent: any,
  targetingPlayer: string,
  permanentController: string
): WardEffect | null {
  // Ward only triggers for opponents
  if (targetingPlayer === permanentController) {
    return null;
  }
  
  const wardCost = getWardCost(permanent.card);
  if (!wardCost) {
    return null;
  }
  
  return {
    permanentId: permanent.id,
    cardName: permanent.card?.name || "Unknown",
    cost: wardCost,
    triggeredBy: '', // Will be set by caller
  };
}

/**
 * Copy a stack item (for Strionic Resonator, Fork, etc.)
 */
export function copyStackItem(
  ctx: GameContext,
  stackItemId: string,
  newController: string,
  newTargets?: StackTarget[]
): { success: boolean; copy?: StackItem; reason?: string } {
  const stack = (ctx.state?.stack || []) as any as StackItem[] || [];
  const original = stack.find(item => item.id === stackItemId);
  
  if (!original) {
    return { success: false, reason: "Stack item not found" };
  }
  
  // Create copy
  const copy: StackItem = {
    ...original,
    id: `copy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    controller: newController,
    targets: newTargets || original.targets,
    timestamp: Date.now(),
  };
  
  // Copies are put on top of the stack
  stack.push(copy);
  ctx.bumpSeq();
  
  return { success: true, copy };
}

/**
 * Change targets of a stack item
 */
export function changeTargets(
  ctx: GameContext,
  stackItemId: string,
  newTargets: StackTarget[]
): { success: boolean; reason?: string } {
  const stack = (ctx.state?.stack || []) as any as StackItem[] || [];
  const item = stack.find(i => i.id === stackItemId);
  
  if (!item) {
    return { success: false, reason: "Stack item not found" };
  }
  
  if (!item.targets || item.targets.length === 0) {
    return { success: false, reason: "This spell or ability has no targets" };
  }
  
  item.targets = newTargets;
  ctx.bumpSeq();
  
  return { success: true };
}

/**
 * Get all items on the stack that can be countered
 */
export function getCounterableStackItems(ctx: GameContext): StackItem[] {
  const stack = (ctx.state?.stack || []) as any as StackItem[] || [];
  return stack.filter(item => item.canBeCountered && item.type !== 'mana_ability');
}

/**
 * Get all triggered abilities on the stack
 */
export function getTriggeredAbilitiesOnStack(ctx: GameContext): StackItem[] {
  const stack = (ctx.state?.stack || []) as any as StackItem[] || [];
  return stack.filter(item => item.type === 'triggered_ability');
}

/**
 * Get all activated abilities on the stack (excluding mana abilities)
 */
export function getActivatedAbilitiesOnStack(ctx: GameContext): StackItem[] {
  const stack = (ctx.state?.stack || []) as any as StackItem[] || [];
  return stack.filter(item => item.type === 'activated_ability');
}

/**
 * Check if the stack is empty
 */
export function isStackEmpty(ctx: GameContext): boolean {
  const stack = (ctx.state?.stack || []) as any as StackItem[] || [];
  return stack.length === 0;
}

/**
 * Get the top item of the stack (next to resolve)
 */
export function getTopOfStack(ctx: GameContext): StackItem | null {
  const stack = (ctx.state?.stack || []) as any as StackItem[] || [];
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * Resolve the top item of the stack
 */
export function resolveTopOfStack(ctx: GameContext): { 
  resolved: StackItem | null; 
  moveToZone?: string;
} {
  const stack = (ctx.state?.stack || []) as any as StackItem[] || [];
  
  if (stack.length === 0) {
    return { resolved: null };
  }
  
  const item = stack.pop()!;
  
  // Determine where the card goes after resolution
  let moveToZone: string | undefined;
  
  if (item.type === 'spell' && item.card) {
    const typeLine = (item.card.type_line || "").toLowerCase();
    
    if (typeLine.includes('instant') || typeLine.includes('sorcery')) {
      // Instants and sorceries go to graveyard
      moveToZone = 'graveyard';
      
      // Unless they have flashback (then exile)
      if (item.alternativeCost === 'flashback') {
        moveToZone = 'exile';
      }
    } else {
      // Permanents go to battlefield
      moveToZone = 'battlefield';
    }
  }
  
  ctx.bumpSeq();
  
  return { resolved: item, moveToZone };
}
