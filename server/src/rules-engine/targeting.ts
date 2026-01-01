import type { GameState, PlayerID, TargetRef, BattlefieldPermanent } from '../../../shared/src';

// Re-export TargetRef for consumers of this module
export type { TargetRef };

// Spell spec derived heuristically from oracle text
export type SpellOp =
  | 'DESTROY_TARGET' | 'EXILE_TARGET'
  | 'DESTROY_ALL' | 'EXILE_ALL'
  | 'DESTROY_EACH' | 'DAMAGE_EACH'
  | 'ANY_TARGET_DAMAGE'
  | 'TARGET_PERMANENT' | 'TARGET_CREATURE' | 'TARGET_PLAYER'
  | 'COUNTER_TARGET_SPELL' | 'COUNTER_TARGET_ABILITY'
  | 'FLICKER_TARGET'; // Exile and return to battlefield (Acrobatic Maneuver, Cloudshift, etc.)

export type PermanentFilter = 'ANY' | 'CREATURE' | 'PLANESWALKER' | 'PERMANENT' | 'ARTIFACT' | 'ENCHANTMENT' | 'LAND';

// Spell type filter for counterspells
export type SpellTypeFilter = 'ANY_SPELL' | 'INSTANT_SORCERY' | 'NONCREATURE' | 'CREATURE_SPELL';

// Power/toughness requirement for targeted creatures
export interface StatRequirement {
  stat: 'power' | 'toughness';
  comparison: '<=' | '>=' | '<' | '>' | '=';
  value: number;
}

// Target restriction - "that..." clauses after "target X"
// These define additional criteria that valid targets must meet
export type TargetRestrictionType = 
  | 'dealt_damage_to_you_this_turn'     // Reciprocate: "target creature that dealt damage to you this turn"
  | 'dealt_combat_damage_to_you_this_turn' // Similar but combat-only
  | 'attacked_this_turn'                 // "target creature that attacked this turn"
  | 'attacked_or_blocked_this_turn'      // "target attacking or blocking creature" (Repel Calamity)
  | 'blocked_this_turn'                  // "target creature that blocked this turn"
  | 'entered_this_turn'                  // "target creature that entered the battlefield this turn"
  | 'tapped'                             // "target tapped creature"
  | 'untapped'                           // "target untapped creature"
  | 'has_keyword'                        // "target creature with flying" (Atraxa's Fall, Wing Snare)
  | 'controlled_by_active_player';       // Delirium: "target creature that player controls" (where "that player" = opponent whose turn it is)

export interface TargetRestriction {
  type: TargetRestrictionType;
  description: string;  // Human-readable description like "that dealt damage to you this turn"
  keyword?: string;     // For has_keyword type: the keyword ability required (flying, reach, etc.)
}

export type SpellSpec = {
  op: SpellOp;
  filter: PermanentFilter;
  minTargets: number;
  maxTargets: number;
  amount?: number;
  spellTypeFilter?: SpellTypeFilter; // For counterspells that only counter certain spell types
  targetDescription?: string; // Human-readable description of what can be targeted
  returnDelay?: 'immediate' | 'end_of_turn' | 'end_of_combat'; // For flicker effects
  statRequirement?: StatRequirement; // For spells like Repel Calamity (toughness 4 or greater)
  targetRestriction?: TargetRestriction; // For "target X that..." clauses (Reciprocate, etc.)
  controllerOnly?: boolean; // For "creature you control" patterns (Acrobatic Maneuver, Cloudshift)
  excludeSource?: boolean; // For "another target" patterns (Skrelv, etc.) - cannot target the source
  multiFilter?: PermanentFilter[]; // For "artifact or enchantment" patterns (Nature's Claim) - uses OR logic
  creatureRestriction?: TargetRestriction; // For restrictions that only apply to creatures when multiFilter includes CREATURE (Atraxa's Fall)
};

/**
 * Detect if a spell requires targets based on oracle text
 * This is a comprehensive check that looks for ANY "target" pattern in the spell text
 * 
 * MTG Rules 601.2c: The player announces targets for the spell.
 * Targets must be chosen before costs are paid.
 */
export function requiresTargeting(oracleText?: string): boolean {
  if (!oracleText) return false;
  const t = oracleText.toLowerCase();
  
  // Skip if this is an enchant aura (handled separately)
  if (/^enchant\s+/.test(t)) return false;
  
  // Check for "target" keyword followed by a valid target type
  // This catches ALL spells that require targets
  const targetPatterns = [
    /target\s+(?:creature|permanent|artifact|enchantment|land|player|opponent|planeswalker)/i,
    /any\s+target/i,
    /target\s+spell/i,
    /target\s+(?:activated|triggered)\s+ability/i,
    /up\s+to\s+\w+\s+target/i,
    /target\s+(?:nonland|noncreature|nonartifact)/i,
    /each\s+target/i,
  ];
  
  return targetPatterns.some(pattern => pattern.test(t));
}

/**
 * Parse target requirements from oracle text
 * Returns details about what types of targets are needed and how many
 */
export function parseTargetRequirements(oracleText?: string): {
  needsTargets: boolean;
  targetTypes: string[];
  minTargets: number;
  maxTargets: number;
  targetDescription: string;
} {
  if (!oracleText) return { needsTargets: false, targetTypes: [], minTargets: 0, maxTargets: 0, targetDescription: '' };
  
  const t = oracleText.toLowerCase();
  const targetTypes: string[] = [];
  let minTargets = 0;
  let maxTargets = 0;
  let targetDescription = '';
  
  // Check for "up to X target" patterns
  const upToMatch = t.match(/up\s+to\s+(\w+)\s+target\s+(\w+)/i);
  if (upToMatch) {
    const numWord = upToMatch[1];
    const targetType = upToMatch[2];
    const numMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    maxTargets = numMap[numWord] || parseInt(numWord, 10) || 1;
    minTargets = 0; // "up to" means minimum is 0
    targetTypes.push(targetType);
    targetDescription = `up to ${numWord} target ${targetType}`;
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription };
  }
  
  // Check for "X target" patterns (e.g., "two target creatures")
  const multiTargetMatch = t.match(/(\w+)\s+target\s+(\w+)/i);
  if (multiTargetMatch) {
    const numWord = multiTargetMatch[1];
    const targetType = multiTargetMatch[2];
    const numMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const num = numMap[numWord] || parseInt(numWord, 10);
    if (num && num > 0) {
      minTargets = num;
      maxTargets = num;
      targetTypes.push(targetType);
      targetDescription = `${numWord} target ${targetType}`;
      return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription };
    }
  }
  
  // Check for "any target" (can target creatures, planeswalkers, or players)
  if (/any\s+target/i.test(t)) {
    minTargets = 1;
    maxTargets = 1;
    targetTypes.push('any');
    targetDescription = 'any target';
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription };
  }
  
  // Check for standard "target X" patterns
  const targetMatch = t.match(/target\s+(creature|permanent|artifact|enchantment|land|player|opponent|planeswalker|spell|nonland\s+permanent|noncreature\s+permanent)/i);
  if (targetMatch) {
    minTargets = 1;
    maxTargets = 1;
    targetTypes.push(targetMatch[1]);
    targetDescription = `target ${targetMatch[1]}`;
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription };
  }
  
  // Check for "target activated or triggered ability"
  if (/target\s+(?:activated|triggered)\s+ability/i.test(t)) {
    minTargets = 1;
    maxTargets = 1;
    targetTypes.push('ability');
    targetDescription = 'target ability';
    return { needsTargets: true, targetTypes, minTargets, maxTargets, targetDescription };
  }
  
  return { needsTargets: false, targetTypes: [], minTargets: 0, maxTargets: 0, targetDescription: '' };
}

export function categorizeSpell(_name: string, oracleText?: string): SpellSpec | null {
  const t = (oracleText || '').toLowerCase();

  // IMPORTANT: Check for stack-targeting spells FIRST before battlefield patterns
  // Spells like Summary Dismissal ("Exile all other spells and counter all abilities")
  // target the stack, not permanents on the battlefield
  // These patterns should NOT be treated as EXILE_ALL/DESTROY_ALL on battlefield
  if (/exile all\s+(?:other\s+)?spells\b/.test(t)) {
    // This targets the stack (spells), not battlefield - return null to handle specially
    return null;
  }
  if (/counter all\s+(?:other\s+)?spells\b/.test(t)) {
    // This counters all spells on stack, not battlefield - return null to handle specially
    return null;
  }

  // Check for counterspells - these target spells on the stack
  // Pattern: "counter target spell" or "counter target instant or sorcery" etc.
  if (/counter target\s+(?:\w+\s+)?spell\b/.test(t) || /counter target\s+(?:instant|sorcery)/.test(t)) {
    // Determine spell type filter
    let spellTypeFilter: SpellTypeFilter = 'ANY_SPELL';
    
    if (/counter target noncreature spell/.test(t)) {
      spellTypeFilter = 'NONCREATURE';
    } else if (/counter target creature spell/.test(t)) {
      spellTypeFilter = 'CREATURE_SPELL';
    } else if (/counter target instant or sorcery/.test(t) || /counter target instant or sorcery spell/.test(t)) {
      spellTypeFilter = 'INSTANT_SORCERY';
    }
    
    return { 
      op: 'COUNTER_TARGET_SPELL', 
      filter: 'ANY', 
      minTargets: 1, 
      maxTargets: 1,
      spellTypeFilter,
    };
  }

  // Check for ability counters (Stifle, Tale's End, etc.)
  if (/counter target (?:activated|triggered) ability/.test(t)) {
    return { 
      op: 'COUNTER_TARGET_ABILITY', 
      filter: 'ANY', 
      minTargets: 1, 
      maxTargets: 1,
    };
  }

  // Detect filter type based on target description
  // Priority: specific types (artifact, enchantment, land, creature, planeswalker) > permanent > any
  // Special handling for "X or Y" patterns (e.g., "artifact or enchantment")
  const hasArtifact = /\bartifact\b/.test(t);
  const hasEnchantment = /\benchantment\b/.test(t);
  const hasLand = /\bland\b/.test(t);
  const hasCreature = /\bcreature\b/.test(t);
  const hasPlaneswalker = /\bplaneswalker\b/.test(t);
  const hasBattle = /\bbattle\b/.test(t);
  const hasPermanent = /\bpermanent\b/.test(t);
  
  // Check for multi-type patterns with "or" (Nature's Claim: "target artifact or enchantment")
  // Atraxa's Fall: "target artifact, battle, enchantment, or creature with flying"
  let filter: PermanentFilter;
  let multiFilter: PermanentFilter[] | undefined;
  let creatureRestriction: TargetRestriction | undefined;
  
  // Pattern: "artifact, battle, enchantment, or creature with flying" (Atraxa's Fall)
  // This is a complex pattern: artifacts/battles/enchantments without restriction, OR creatures with flying
  if (/artifact,?\s+battle,?\s+enchantment,?\s+or creature with flying/.test(t)) {
    // All four types, but creatures need flying
    // Note: Battles use PERMANENT filter since there's no dedicated BATTLE filter type
    multiFilter = ['ARTIFACT', 'PERMANENT', 'ENCHANTMENT', 'CREATURE'];
    filter = 'ARTIFACT'; // Primary filter
    // Add restriction for creatures only - they must have flying
    creatureRestriction = {
      type: 'has_keyword',
      description: 'with flying',
      keyword: 'flying',
    };
  }
  // Pattern: "artifact or enchantment" (Nature's Claim, Naturalize, etc.)
  else if (/artifact or enchantment/.test(t)) {
    filter = 'ARTIFACT'; // Primary filter
    multiFilter = ['ARTIFACT', 'ENCHANTMENT'];
  }
  // Pattern: "artifact, battle, enchantment" or similar multi-type without creature restriction
  else if (/artifact,?\s+(?:battle,?\s+)?enchantment/.test(t) || /battle,?\s+(?:artifact,?\s+)?enchantment/.test(t)) {
    // Complex multi-type - parse all types mentioned
    // Note: Battles use PERMANENT filter since there's no dedicated BATTLE filter type
    const types: PermanentFilter[] = [];
    if (hasArtifact) types.push('ARTIFACT');
    if (hasBattle) types.push('PERMANENT'); // Represents battles
    if (hasEnchantment) types.push('ENCHANTMENT');
    if (hasCreature) types.push('CREATURE');
    filter = types[0] || 'PERMANENT';
    multiFilter = types.length > 1 ? types : undefined;
  }
  // Single type filters
  else if (hasArtifact && !hasEnchantment && !hasCreature && !hasPlaneswalker) {
    filter = 'ARTIFACT';
  } else if (hasEnchantment && !hasArtifact && !hasCreature && !hasPlaneswalker) {
    filter = 'ENCHANTMENT';
  } else if (hasLand && !hasCreature && !hasArtifact && !hasEnchantment) {
    filter = 'LAND';
  } else if (hasCreature && !hasPlaneswalker) {
    filter = 'CREATURE';
  } else if (hasPlaneswalker && !hasCreature) {
    filter = 'PLANESWALKER';
  } else if (hasPermanent) {
    filter = 'PERMANENT';
  } else {
    filter = 'ANY';
  }

  // IMPORTANT: Skip "destroy all" patterns that have conditional "if X is N or more" clauses
  // Cards like Martial Coup: "Create X tokens. If X is 5 or more, destroy all other creatures."
  // These conditional effects must be handled separately by the X-value-aware code in stack.ts
  const hasConditionalXWipe = /if x is \d+ or more[,.]?\s*destroy all/i.test(t);
  
  if (/destroy all\b/.test(t) && !hasConditionalXWipe) return { op: 'DESTROY_ALL', filter, minTargets: 0, maxTargets: 0, ...(multiFilter && { multiFilter }) };
  // Only match "exile all" if it's targeting permanents (creatures, planeswalkers, etc.), not spells
  if (/exile all\b/.test(t) && !/exile all\s+(?:other\s+)?spells\b/.test(t)) return { op: 'EXILE_ALL', filter, minTargets: 0, maxTargets: 0, ...(multiFilter && { multiFilter }) };
  if (/destroy each\b/.test(t)) return { op: 'DESTROY_EACH', filter, minTargets: 0, maxTargets: 0, ...(multiFilter && { multiFilter }) };

  if (/each creature/.test(t) && /\bdamage\b/.test(t)) {
    const m = t.match(/(\d+)\s+damage/);
    return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amount: m ? parseInt(m[1], 10) : undefined };
  }

  if (/exile up to (\d+)/.test(t)) {
    const n = parseInt(t.match(/exile up to (\d+)/)![1], 10);
    return { op: 'EXILE_TARGET', filter, minTargets: 0, maxTargets: n, ...(multiFilter && { multiFilter }) };
  }
  if (/destroy up to (\d+)/.test(t)) {
    const n = parseInt(t.match(/destroy up to (\d+)/)![1], 10);
    return { op: 'DESTROY_TARGET', filter, minTargets: 0, maxTargets: n, ...(multiFilter && { multiFilter }) };
  }

  // Flicker effects - exile and return to battlefield
  // Pattern: "exile target creature ... return it/that card to the battlefield"
  // Cards: Acrobatic Maneuver, Cloudshift, Ephemerate, Flickerwisp, etc.
  if (/exile target/.test(t) && /return (?:it|that card|that creature) to the battlefield/.test(t)) {
    // Check for delayed return (end of turn, end of combat)
    let returnDelay: 'immediate' | 'end_of_turn' | 'end_of_combat' = 'immediate';
    if (/at (?:the )?(?:beginning of )?(?:the )?(?:next )?end(?:ing)? step|end of turn/.test(t)) {
      returnDelay = 'end_of_turn';
    } else if (/end of combat/.test(t)) {
      returnDelay = 'end_of_combat';
    }
    
    // Check for controller restriction ("creature you control")
    const controllerRestricted = /target creature you control/.test(t);
    const targetDesc = controllerRestricted ? 'creature you control' : 'creature';
    
    return { 
      op: 'FLICKER_TARGET', 
      filter: 'CREATURE', 
      minTargets: 1, 
      maxTargets: 1,
      returnDelay,
      targetDescription: targetDesc,
      controllerOnly: controllerRestricted,
    };
  }

  // Check for toughness/power requirements in target descriptions
  // Pattern: "target creature with toughness 4 or greater" (Repel Calamity)
  // Pattern: "target creature with power 2 or less" (Ulcerate)
  // Also handle "target attacking or blocking creature with toughness X" patterns
  const toughnessMatch = t.match(/target (?:attacking or blocking )?creature with toughness (\d+) or (greater|less)/i);
  const powerMatch = t.match(/target (?:attacking or blocking )?creature with power (\d+) or (greater|less)/i);
  
  if (toughnessMatch) {
    const value = parseInt(toughnessMatch[1], 10);
    const comparison = toughnessMatch[2] === 'greater' ? '>=' : '<=';
    const statReq: StatRequirement = { stat: 'toughness', comparison, value };
    
    // Check if there's an "attacking or blocking" restriction (Repel Calamity)
    const hasAttackingOrBlockingRestriction = /target attacking or blocking creature/i.test(t);
    const targetRestriction = hasAttackingOrBlockingRestriction ? {
      type: 'attacked_or_blocked_this_turn' as TargetRestrictionType,
      description: 'that is attacking or blocking',
    } : undefined;
    const targetDescription = hasAttackingOrBlockingRestriction 
      ? `attacking or blocking creature with toughness ${comparison} ${value}`
      : `creature with toughness ${comparison} ${value}`;
    
    // Determine the operation
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
    }
    // Default to target creature action
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
  }
  
  if (powerMatch) {
    const value = parseInt(powerMatch[1], 10);
    const comparison = powerMatch[2] === 'greater' ? '>=' : '<=';
    const statReq: StatRequirement = { stat: 'power', comparison, value };
    
    // Check if there's an "attacking or blocking" restriction
    const hasAttackingOrBlockingRestriction = /target attacking or blocking creature/i.test(t);
    const targetRestriction = hasAttackingOrBlockingRestriction ? {
      type: 'attacked_or_blocked_this_turn' as TargetRestrictionType,
      description: 'that is attacking or blocking',
    } : undefined;
    const targetDescription = hasAttackingOrBlockingRestriction 
      ? `attacking or blocking creature with power ${comparison} ${value}`
      : `creature with power ${comparison} ${value}`;
    
    // Determine the operation
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
    }
    // Default to target creature action
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, statRequirement: statReq, targetRestriction, targetDescription };
  }

  // ==========================================================================
  // TARGET RESTRICTIONS: "target X that..." patterns
  // These are defining criteria that restrict what can be targeted beyond just type.
  // Examples:
  // - Reciprocate: "Exile target creature that dealt damage to you this turn."
  // - Condemn: "Put target attacking creature on the bottom of its owner's library."
  // - Wing Snare: "Destroy target creature with flying."
  // ==========================================================================
  
  // Pattern: "target creature that dealt damage to you this turn" (Reciprocate)
  // Also handles: "target creature that dealt combat damage to you this turn"
  const dealtDamageToYouMatch = t.match(/target creature that dealt (?:combat )?damage to you this turn/i);
  if (dealtDamageToYouMatch) {
    const isCombatOnly = t.includes('combat damage to you');
    const restrictionType: TargetRestrictionType = isCombatOnly 
      ? 'dealt_combat_damage_to_you_this_turn' 
      : 'dealt_damage_to_you_this_turn';
    const restriction: TargetRestriction = {
      type: restrictionType,
      description: isCombatOnly ? 'that dealt combat damage to you this turn' : 'that dealt damage to you this turn',
    };
    
    // Determine the operation
    if (/exile target/.test(t)) {
      return { 
        op: 'EXILE_TARGET', 
        filter: 'CREATURE', 
        minTargets: 1, 
        maxTargets: 1, 
        targetRestriction: restriction,
        targetDescription: `creature ${restriction.description}`,
      };
    }
    if (/destroy target/.test(t)) {
      return { 
        op: 'DESTROY_TARGET', 
        filter: 'CREATURE', 
        minTargets: 1, 
        maxTargets: 1, 
        targetRestriction: restriction,
        targetDescription: `creature ${restriction.description}`,
      };
    }
    return { 
      op: 'TARGET_CREATURE', 
      filter: 'CREATURE', 
      minTargets: 1, 
      maxTargets: 1, 
      targetRestriction: restriction,
      targetDescription: `creature ${restriction.description}`,
    };
  }
  
  // Pattern: "target attacking creature" (Condemn, Divine Verdict, etc.)
  const attackingCreatureMatch = t.match(/target attacking creature/i);
  if (attackingCreatureMatch) {
    const restriction: TargetRestriction = {
      type: 'attacked_this_turn',
      description: 'that is attacking',
    };
    
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking creature' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking creature' };
    }
    // Some spells like Condemn put on bottom of library - treat as destroy for now
    if (/put target attacking creature/.test(t) || /on the bottom/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking creature' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'attacking creature' };
  }
  
  // Pattern: "target blocking creature"
  const blockingCreatureMatch = t.match(/target blocking creature/i);
  if (blockingCreatureMatch) {
    const restriction: TargetRestriction = {
      type: 'blocked_this_turn',
      description: 'that is blocking',
    };
    
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'blocking creature' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'blocking creature' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'blocking creature' };
  }
  
  // Pattern: "target tapped creature"
  const tappedCreatureMatch = t.match(/target tapped creature/i);
  if (tappedCreatureMatch) {
    const restriction: TargetRestriction = {
      type: 'tapped',
      description: 'that is tapped',
    };
    
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'tapped creature' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'tapped creature' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'tapped creature' };
  }
  
  // Pattern: "target untapped creature"
  const untappedCreatureMatch = t.match(/target untapped creature/i);
  if (untappedCreatureMatch) {
    const restriction: TargetRestriction = {
      type: 'untapped',
      description: 'that is untapped',
    };
    
    if (/exile target/.test(t)) {
      return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'untapped creature' };
    }
    if (/destroy target/.test(t)) {
      return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'untapped creature' };
    }
    return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: 'untapped creature' };
  }

  // Pattern: "target creature that player controls" with "cast only during an opponent's turn" (Delirium)
  // Delirium: "Cast this spell only during an opponent's turn. Tap target creature that player controls.
  //           That creature deals damage equal to its power to the player."
  // "that player" refers to the opponent whose turn it is
  if (/cast (?:this spell )?only during an opponent's turn/i.test(t) && 
      /target creature that player controls/i.test(t)) {
    const restriction: TargetRestriction = {
      type: 'controlled_by_active_player',
      description: 'controlled by the opponent whose turn it is',
    };
    
    // Delirium taps and deals damage, but we'll categorize as TARGET_CREATURE
    // The spell resolution handles the actual tap+damage effect
    return { 
      op: 'TARGET_CREATURE', 
      filter: 'CREATURE', 
      minTargets: 1, 
      maxTargets: 1, 
      targetRestriction: restriction,
      targetDescription: 'creature that player controls',
    };
  }

  // Pattern: "target creature with [keyword]" (Atraxa's Fall, Wing Snare, Aerial Predation, etc.)
  // Keywords: flying, reach, deathtouch, lifelink, trample, vigilance, haste, etc.
  const keywordAbilities = ['flying', 'reach', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'haste', 
                            'menace', 'hexproof', 'indestructible', 'first strike', 'double strike'];
  for (const keyword of keywordAbilities) {
    const keywordPattern = new RegExp(`target creature with ${keyword}`, 'i');
    if (keywordPattern.test(t)) {
      const restriction: TargetRestriction = {
        type: 'has_keyword',
        description: `with ${keyword}`,
        keyword,
      };
      
      if (/exile target/.test(t)) {
        return { op: 'EXILE_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: `creature with ${keyword}` };
      }
      if (/destroy target/.test(t)) {
        return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: `creature with ${keyword}` };
      }
      return { op: 'TARGET_CREATURE', filter: 'CREATURE', minTargets: 1, maxTargets: 1, targetRestriction: restriction, targetDescription: `creature with ${keyword}` };
    }
  }

  if (/exile target/.test(t)) return { op: 'EXILE_TARGET', filter, minTargets: 1, maxTargets: 1, ...(multiFilter && { multiFilter }), ...(creatureRestriction && { creatureRestriction }) };
  if (/destroy target/.test(t)) return { op: 'DESTROY_TARGET', filter, minTargets: 1, maxTargets: 1, ...(multiFilter && { multiFilter }), ...(creatureRestriction && { creatureRestriction }) };
  
  // Chaos Warp and similar shuffle effects: "target permanent" or "of target permanent"
  if (/(?:of )?target permanent/.test(t) && /shuffles? it into/.test(t)) {
    return { op: 'DESTROY_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 1 };
  }
  
  // Generic "target permanent" patterns for spells that affect permanents
  // This catches spells like Chaos Warp that don't use standard destroy/exile wording
  if (/target permanent\b/.test(t) && !(/enchant/.test(t))) {
    return { op: 'DESTROY_TARGET', filter: 'PERMANENT', minTargets: 1, maxTargets: 1 };
  }
  
  // Target creature/artifact/enchantment patterns without destroy/exile
  if (/target creature\b/.test(t) && !(/enchant/.test(t))) {
    return { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 };
  }

  if (/any target/.test(t) && /\bdamage\b/.test(t)) {
    const m = t.match(/(\d+)\s+damage/);
    return { op: 'ANY_TARGET_DAMAGE', filter: 'ANY', minTargets: 1, maxTargets: 1, amount: m ? parseInt(m[1], 10) : undefined };
  }

  return null;
}

function isCreature(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('creature');
}
function isPlaneswalker(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('planeswalker');
}
function isArtifact(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('artifact');
}
function isEnchantment(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('enchantment');
}
function isLand(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('land');
}
function isBattle(p: BattlefieldPermanent) {
  return (((p.card as any)?.type_line) || '').toLowerCase().includes('battle');
}

/**
 * Check if a permanent matches the given filter.
 * Handles single filters and ignores multiFilter (which is handled separately).
 */
function matchesFilter(p: BattlefieldPermanent, filter: PermanentFilter): boolean {
  switch (filter) {
    case 'CREATURE': return isCreature(p);
    case 'PLANESWALKER': return isPlaneswalker(p);
    case 'ARTIFACT': return isArtifact(p);
    case 'ENCHANTMENT': return isEnchantment(p);
    case 'LAND': return isLand(p);
    case 'PERMANENT': return true; // All permanents match (including battles, artifacts, creatures, etc.)
    case 'ANY': return isCreature(p) || isPlaneswalker(p); // "Any target" only includes creatures/planeswalkers/players
    default: return false;
  }
}

/**
 * Check if a permanent matches any of the filters in a multiFilter array (OR logic).
 * For example, "artifact or enchantment" matches if the permanent is an artifact OR an enchantment.
 */
function matchesMultiFilter(p: BattlefieldPermanent, filters: PermanentFilter[]): boolean {
  for (const filter of filters) {
    if (matchesFilter(p, filter)) return true;
  }
  return false;
}

function hasHexproofOrShroud(p: BattlefieldPermanent, s: Readonly<GameState>): boolean {
  const self = (((p.card as any)?.oracle_text) || '').toLowerCase();
  // Check if permanent itself has hexproof/shroud
  if (self.includes('hexproof') || self.includes('shroud')) return true;
  
  // Check if any attached aura or equipment grants hexproof/shroud
  // This includes Lightning Greaves ("Equipped creature has shroud and haste")
  const hasFromAttachment = s.battlefield.some(a => {
    if (a.attachedTo !== p.id) return false;
    const attachmentTypeLine = (((a.card as any)?.type_line) || '').toLowerCase();
    const attachmentOracle = (((a.card as any)?.oracle_text) || '').toLowerCase();
    // Check if it's an aura or equipment
    if (!attachmentTypeLine.includes('aura') && !attachmentTypeLine.includes('equipment')) return false;
    // Check if it grants hexproof or shroud
    return attachmentOracle.includes('hexproof') || attachmentOracle.includes('shroud');
  });
  if (hasFromAttachment) return true;
  
  // Check if any other permanent on the battlefield grants hexproof/shroud to this creature
  // This handles cards like Shalai, Voice of Plenty ("You and other creatures you control have hexproof")
  // and Privileged Position ("Other permanents you control have hexproof")
  const typeLine = (((p.card as any)?.type_line) || '').toLowerCase();
  const isCreaturePerm = typeLine.includes('creature');
  
  for (const source of s.battlefield) {
    if (source.id === p.id) continue; // Skip self
    if (source.controller !== p.controller) continue; // Only check permanents controlled by same player
    
    const sourceOracle = (((source.card as any)?.oracle_text) || '').toLowerCase();
    
    // "Other creatures you control have hexproof" (e.g., Shalai)
    if (/other creatures you control have hexproof/.test(sourceOracle) && isCreaturePerm) {
      return true;
    }
    
    // "You and other creatures you control have hexproof" (also Shalai pattern)
    if (/you and other creatures you control have hexproof/.test(sourceOracle) && isCreaturePerm) {
      return true;
    }
    
    // "Other permanents you control have hexproof" (e.g., Privileged Position)
    if (/other permanents you control have hexproof/.test(sourceOracle)) {
      return true;
    }
    
    // "Permanents you control have hexproof" (grants to all including source)
    // Check that this doesn't say "other permanents" which was already handled above
    if (!sourceOracle.includes('other permanents') && 
        /permanents you control have hexproof/.test(sourceOracle)) {
      return true;
    }
    
    // "Creatures you control have hexproof" (without "other")
    // Check that this doesn't say "other creatures" which was already handled above
    if (!sourceOracle.includes('other creatures') && 
        /creatures you control have hexproof/.test(sourceOracle) && isCreaturePerm) {
      return true;
    }
    
    // "Other creatures you control have shroud"
    if (/other creatures you control have shroud/.test(sourceOracle) && isCreaturePerm) {
      return true;
    }
    
    // "Other permanents you control have shroud"
    if (/other permanents you control have shroud/.test(sourceOracle)) {
      return true;
    }
  }
  
  return false;
}

export function evaluateTargeting(state: Readonly<GameState>, caster: PlayerID, spec: SpellSpec, sourceId?: string): TargetRef[] {
  const out: TargetRef[] = [];
  
  // Handle counterspells - they target spells on the stack
  if (spec.op === 'COUNTER_TARGET_SPELL') {
    const stack = (state as any).stack || [];
    for (const stackItem of stack) {
      // Skip items that can't be countered
      if (stackItem.canBeCountered === false) continue;
      
      // Skip abilities (they're not spells)
      if (stackItem.type === 'ability' || stackItem.type === 'triggered_ability' || stackItem.type === 'activated_ability') continue;
      
      // Check spell type filter
      const card = stackItem.card;
      const typeLine = (card?.type_line || '').toLowerCase();
      
      if (spec.spellTypeFilter === 'NONCREATURE' && typeLine.includes('creature')) continue;
      if (spec.spellTypeFilter === 'CREATURE_SPELL' && !typeLine.includes('creature')) continue;
      if (spec.spellTypeFilter === 'INSTANT_SORCERY' && !typeLine.includes('instant') && !typeLine.includes('sorcery')) continue;
      
      // Don't target your own spells (usually)
      if (stackItem.controller === caster) continue;
      
      out.push({ kind: 'stack', id: stackItem.id });
    }
    return out;
  }
  
  // Handle ability counters (Stifle, etc.)
  if (spec.op === 'COUNTER_TARGET_ABILITY') {
    const stack = (state as any).stack || [];
    for (const stackItem of stack) {
      // Only target abilities
      if (stackItem.type !== 'ability' && stackItem.type !== 'triggered_ability' && stackItem.type !== 'activated_ability') continue;
      
      // Skip mana abilities (can't be countered)
      if (stackItem.isManaAbility) continue;
      
      out.push({ kind: 'stack', id: stackItem.id });
    }
    return out;
  }
  
  // Handle battlefield targeting
  for (const p of state.battlefield) {
    // Check if permanent matches the filter requirements
    // If multiFilter is defined, use OR logic (match any of the filters)
    // Otherwise, use the single filter
    let matchesFilterRequirement = false;
    
    if (spec.multiFilter) {
      // Multi-filter with OR logic (e.g., "artifact or enchantment")
      matchesFilterRequirement = matchesMultiFilter(p, spec.multiFilter);
    } else {
      // Single filter
      matchesFilterRequirement = matchesFilter(p, spec.filter);
    }
    
    if (!matchesFilterRequirement) continue;
    
    // Check hexproof/shroud (can't target opponent's permanents with hexproof/shroud)
    if (hasHexproofOrShroud(p, state) && p.controller !== caster) continue;
    
    // Check controller restriction ("creature you control")
    if (spec.controllerOnly && p.controller !== caster) continue;
    
    // Check excludeSource restriction ("another target" patterns - cannot target self)
    // This is used for abilities like Skrelv, Defector Mite that can only target "another" creature
    if (spec.excludeSource && sourceId && p.id === sourceId) continue;
    
    // Check stat requirement (power/toughness restrictions)
    if (spec.statRequirement && isCreature(p)) {
      const { stat, comparison, value } = spec.statRequirement;
      // Get effective power/toughness
      const card = p.card as any;
      let statValue: number;
      if (stat === 'power') {
        statValue = p.effectivePower ?? (typeof card?.power === 'string' ? parseInt(card.power, 10) : card?.power) ?? 0;
      } else {
        statValue = p.effectiveToughness ?? (typeof card?.toughness === 'string' ? parseInt(card.toughness, 10) : card?.toughness) ?? 0;
      }
      
      // Check comparison
      let passes = false;
      switch (comparison) {
        case '>=': passes = statValue >= value; break;
        case '<=': passes = statValue <= value; break;
        case '>': passes = statValue > value; break;
        case '<': passes = statValue < value; break;
        case '=': passes = statValue === value; break;
      }
      if (!passes) continue;
    }
    
    // Check target restriction ("target X that..." clauses)
    // These are defining criteria like "that dealt damage to you this turn" (Reciprocate)
    if (spec.targetRestriction) {
      const restriction = spec.targetRestriction;
      let meetsRestriction = false;
      
      switch (restriction.type) {
        case 'dealt_damage_to_you_this_turn':
        case 'dealt_combat_damage_to_you_this_turn': {
          // Check if this creature dealt damage to the caster this turn
          // The damage tracking is stored in state.creaturesThatDealtDamageToPlayer
          const damageTracker = (state as any).creaturesThatDealtDamageToPlayer?.[caster];
          if (damageTracker && damageTracker[p.id]) {
            meetsRestriction = true;
          }
          break;
        }
        
        case 'attacked_this_turn': {
          // Check if the creature is currently attacking or attacked this turn
          // During combat, 'attacking' is set on the permanent
          const isAttacking = !!(p as any).attacking || !!(p as any).attackedThisTurn;
          meetsRestriction = isAttacking;
          break;
        }
        
        case 'attacked_or_blocked_this_turn': {
          // Check if the creature is currently attacking OR blocking (Repel Calamity)
          const isAttacking = !!(p as any).attacking || !!(p as any).attackedThisTurn;
          const isBlocking = !!(p as any).blocking || !!(p as any).blockedThisTurn;
          meetsRestriction = isAttacking || isBlocking;
          break;
        }
        
        case 'blocked_this_turn': {
          // Check if the creature is currently blocking or blocked this turn
          meetsRestriction = !!(p as any).blocking || !!(p as any).blockedThisTurn;
          break;
        }
        
        case 'entered_this_turn': {
          // Check if the creature entered the battlefield this turn
          meetsRestriction = !!(p as any).enteredThisTurn;
          break;
        }
        
        case 'tapped': {
          // Check if the creature is tapped
          meetsRestriction = !!(p as any).tapped;
          break;
        }
        
        case 'untapped': {
          // Check if the creature is untapped
          meetsRestriction = !(p as any).tapped;
          break;
        }
        
        case 'controlled_by_active_player': {
          // Delirium: "target creature that player controls" where "that player" = opponent whose turn it is
          // The creature must be controlled by the active player (turnPlayer)
          const activePlayerId = (state as any).turnPlayer || 
                                state.players[(state as any).activePlayerIndex || 0]?.id;
          meetsRestriction = p.controller === activePlayerId;
          break;
        }
        
        case 'has_keyword': {
          // Check if the creature has the required keyword ability (flying, reach, etc.)
          // Check both the keywords array and oracle text
          const oracleText = (p.card as any)?.oracle_text || '';
          const cardKeywords = (p.card as any)?.keywords || [];
          const keyword = restriction.keyword?.toLowerCase() || '';
          
          // First check the keywords array (more reliable for most cards)
          const hasKeywordInArray = Array.isArray(cardKeywords) && 
            cardKeywords.some((k: string) => typeof k === 'string' && k.toLowerCase() === keyword);
          
          if (hasKeywordInArray) {
            meetsRestriction = true;
          } else {
            // Fallback: Check if the card's oracle text contains the keyword
            // We check at word boundary to avoid matching partial words
            const keywordPattern = new RegExp(`\\b${keyword}\\b`, 'i');
            meetsRestriction = keywordPattern.test(oracleText);
          }
          
          // Also check for keywords granted by auras and equipment attached to this creature
          if (!meetsRestriction) {
            const attachments = state.battlefield.filter((att: any) => att.attachedTo === p.id);
            for (const attachment of attachments) {
              const attOracle = ((attachment.card as any)?.oracle_text || '').toLowerCase();
              // Pattern: "Enchanted creature has flying" or "Equipped creature has flying"
              // Escape regex metacharacters in keyword to prevent ReDoS
              const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const grantsKeywordPattern = new RegExp(`(enchanted|equipped)\\s+creature\\s+has\\s+${escapedKeyword}`, 'i');
              if (grantsKeywordPattern.test(attOracle)) {
                meetsRestriction = true;
                break;
              }
            }
          }
          
          break;
        }
        
        default:
          // Unknown restriction type - allow targeting (fail open)
          meetsRestriction = true;
          break;
      }
      
      if (!meetsRestriction) continue;
    }
    
    // Check creatureRestriction (for multi-type spells where only creatures have restrictions)
    // Example: Atraxa's Fall targets "artifact, battle, enchantment, or creature with flying"
    // Artifacts/battles/enchantments can be targeted normally, but creatures need flying
    if (spec.creatureRestriction && isCreature(p)) {
      const restriction = spec.creatureRestriction;
      let meetsRestriction = false;
      
      // For now, only handle has_keyword restriction (the main use case)
      if (restriction.type === 'has_keyword') {
        const oracleText = (p.card as any)?.oracle_text || '';
        const cardKeywords = (p.card as any)?.keywords || [];
        const keyword = restriction.keyword?.toLowerCase() || '';
        
        // First check the keywords array (more reliable for most cards)
        const hasKeywordInArray = Array.isArray(cardKeywords) && 
          cardKeywords.some((k: string) => typeof k === 'string' && k.toLowerCase() === keyword);
        
        if (hasKeywordInArray) {
          meetsRestriction = true;
        } else {
          // Fallback: Check if the card's oracle text contains the keyword
          const keywordPattern = new RegExp(`\\b${keyword}\\b`, 'i');
          meetsRestriction = keywordPattern.test(oracleText);
        }
        
        // Also check for keywords granted by auras and equipment attached to this creature
        if (!meetsRestriction) {
          const attachments = state.battlefield.filter((att: any) => att.attachedTo === p.id);
          // Pre-compile the regex pattern once before the loop
          const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const grantsKeywordPattern = new RegExp(`(enchanted|equipped)\\s+creature\\s+has\\s+${escapedKeyword}`, 'i');
          
          for (const attachment of attachments) {
            const attOracle = ((attachment.card as any)?.oracle_text || '').toLowerCase();
            if (grantsKeywordPattern.test(attOracle)) {
              meetsRestriction = true;
              break;
            }
          }
        }
      } else {
        // For other restriction types, fail open (allow targeting)
        meetsRestriction = true;
      }
      
      if (!meetsRestriction) continue;
    }
    
    out.push({ kind: 'permanent', id: p.id });
  }
  if (spec.op === 'ANY_TARGET_DAMAGE') {
    for (const pr of state.players) out.push({ kind: 'player', id: pr.id });
  }
  return out;
}

export type EngineEffect =
  | { kind: 'DestroyPermanent'; id: string }
  | { kind: 'MoveToExile'; id: string }
  | { kind: 'DamagePermanent'; id: string; amount: number }
  | { kind: 'DamagePlayer'; playerId: PlayerID; amount: number }
  | { kind: 'CounterSpell'; stackItemId: string }
  | { kind: 'CounterAbility'; stackItemId: string }
  | { kind: 'Broadcast'; message: string }
  | { kind: 'FlickerPermanent'; id: string; returnDelay: 'immediate' | 'end_of_turn' | 'end_of_combat' };

/**
 * Check if a permanent meets a stat requirement at resolution time.
 * This is used to validate targets when a spell resolves, as stats may have
 * changed since the spell was cast (e.g., -1/-1 effects reducing toughness).
 * 
 * MTG Rule 608.2b: "If the spell or ability specifies targets, it checks 
 * whether the targets are still legal."
 */
export function meetsStatRequirement(p: BattlefieldPermanent, req: StatRequirement): boolean {
  const card = p.card as any;
  let statValue: number;
  
  if (req.stat === 'power') {
    // Use effective power if calculated, otherwise use base power
    statValue = p.effectivePower ?? (typeof card?.power === 'string' ? parseInt(card.power, 10) : card?.power) ?? 0;
  } else {
    // Use effective toughness if calculated, otherwise use base toughness
    statValue = p.effectiveToughness ?? (typeof card?.toughness === 'string' ? parseInt(card.toughness, 10) : card?.toughness) ?? 0;
  }
  
  // Handle NaN values (e.g., '*' power/toughness)
  if (isNaN(statValue)) statValue = 0;
  
  switch (req.comparison) {
    case '>=': return statValue >= req.value;
    case '<=': return statValue <= req.value;
    case '>': return statValue > req.value;
    case '<': return statValue < req.value;
    case '=': return statValue === req.value;
    default: return true;
  }
}

export function resolveSpell(spec: SpellSpec, chosen: readonly TargetRef[], state: Readonly<GameState>): readonly EngineEffect[] {
  const eff: EngineEffect[] = [];
  const applyAll = (k: 'DestroyPermanent' | 'MoveToExile') => {
    for (const p of state.battlefield) {
      // Check if permanent matches the filter requirements
      let matchesFilterRequirement = false;
      
      if (spec.multiFilter) {
        // Multi-filter with OR logic (e.g., "artifact or enchantment")
        matchesFilterRequirement = matchesMultiFilter(p, spec.multiFilter);
      } else {
        // Single filter
        matchesFilterRequirement = matchesFilter(p, spec.filter);
      }
      
      if (!matchesFilterRequirement) continue;
      
      eff.push({ kind: k, id: p.id });
    }
  };

  switch (spec.op) {
    case 'DESTROY_TARGET':
      for (const t of chosen) {
        if (t.kind === 'permanent') {
          // Check if target is still valid at resolution time
          const perm = state.battlefield.find(p => p.id === t.id);
          if (!perm) continue; // Target no longer exists
          
          // Check stat requirement at resolution (e.g., toughness 4+ for Repel Calamity)
          if (spec.statRequirement && isCreature(perm)) {
            if (!meetsStatRequirement(perm, spec.statRequirement)) {
              // Target no longer meets requirement - spell fizzles for this target
              eff.push({ kind: 'Broadcast', message: `Target no longer meets stat requirement (${spec.statRequirement.stat} ${spec.statRequirement.comparison} ${spec.statRequirement.value})` });
              continue;
            }
          }
          
          eff.push({ kind: 'DestroyPermanent', id: t.id });
        }
      }
      break;
    case 'EXILE_TARGET':
      for (const t of chosen) {
        if (t.kind === 'permanent') {
          // Check if target is still valid at resolution time
          const perm = state.battlefield.find(p => p.id === t.id);
          if (!perm) continue; // Target no longer exists
          
          // Check stat requirement at resolution (e.g., toughness 4+ for Repel Calamity)
          if (spec.statRequirement && isCreature(perm)) {
            if (!meetsStatRequirement(perm, spec.statRequirement)) {
              // Target no longer meets requirement - spell fizzles for this target
              eff.push({ kind: 'Broadcast', message: `Target no longer meets stat requirement (${spec.statRequirement.stat} ${spec.statRequirement.comparison} ${spec.statRequirement.value})` });
              continue;
            }
          }
          
          eff.push({ kind: 'MoveToExile', id: t.id });
        }
      }
      break;
    case 'FLICKER_TARGET':
      // Flicker: Exile and return to battlefield
      // The returnDelay determines when the creature returns
      for (const t of chosen) {
        if (t.kind === 'permanent') {
          eff.push({ 
            kind: 'FlickerPermanent', 
            id: t.id, 
            returnDelay: spec.returnDelay || 'immediate' 
          });
        }
      }
      break;
    case 'DESTROY_ALL':
    case 'DESTROY_EACH':
      applyAll('DestroyPermanent');
      break;
    case 'EXILE_ALL':
      applyAll('MoveToExile');
      break;
    case 'DAMAGE_EACH': {
      const amt = spec.amount ?? 0;
      for (const p of state.battlefield) {
        if (!isCreature(p)) continue;
        eff.push({ kind: 'DamagePermanent', id: p.id, amount: amt });
      }
      break;
    }
    case 'ANY_TARGET_DAMAGE': {
      const amt = spec.amount ?? 0;
      for (const t of chosen) {
        if (t.kind === 'player') eff.push({ kind: 'DamagePlayer', playerId: t.id as PlayerID, amount: amt });
        else if (t.kind === 'permanent') eff.push({ kind: 'DamagePermanent', id: t.id, amount: amt });
      }
      break;
    }
    case 'COUNTER_TARGET_SPELL': {
      // Counter target spell - chosen targets should have kind 'stack'
      for (const t of chosen) {
        if (t.kind === 'stack') {
          eff.push({ kind: 'CounterSpell', stackItemId: t.id });
        }
      }
      break;
    }
    case 'COUNTER_TARGET_ABILITY': {
      // Counter target activated or triggered ability
      for (const t of chosen) {
        if (t.kind === 'stack') {
          eff.push({ kind: 'CounterAbility', stackItemId: t.id });
        }
      }
      break;
    }
  }
  return eff;
}

/**
 * Detect if an ability requires "another target" (cannot target the source).
 * This is used for abilities like Skrelv, Defector Mite:
 * "Another target creature you control gains hexproof..."
 * 
 * @param oracleText - The ability text to check
 * @returns true if the ability says "another target"
 */
export function detectAnotherTargetRestriction(oracleText: string): boolean {
  if (!oracleText) return false;
  const text = oracleText.toLowerCase();
  
  // Pattern: "another target creature", "another target permanent", etc.
  return /another target\s+(?:creature|permanent|artifact|enchantment|player|planeswalker)/i.test(text);
}

/**
 * Parse targeting restrictions from an activated ability's oracle text.
 * This extracts information about what can be targeted and any restrictions.
 * 
 * @param oracleText - The ability text to parse
 * @returns Targeting info or null if no targeting detected
 */
export function parseAbilityTargeting(oracleText: string): {
  targetType: 'creature' | 'permanent' | 'player' | 'any';
  controllerOnly: boolean;
  excludeSource: boolean;
  description: string;
} | null {
  if (!oracleText) return null;
  const text = oracleText.toLowerCase();
  
  // Check for "another target creature you control" pattern (Skrelv, etc.)
  if (/another target creature you control/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: true,
      excludeSource: true,
      description: 'another target creature you control',
    };
  }
  
  // Check for "another target permanent you control"
  if (/another target permanent you control/.test(text)) {
    return {
      targetType: 'permanent',
      controllerOnly: true,
      excludeSource: true,
      description: 'another target permanent you control',
    };
  }
  
  // Check for "another target creature"
  if (/another target creature/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: false,
      excludeSource: true,
      description: 'another target creature',
    };
  }
  
  // Check for "target creature you control" (without "another")
  if (/target creature you control/.test(text) && !/another/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: true,
      excludeSource: false,
      description: 'target creature you control',
    };
  }
  
  // Check for "target creature" (without controller restriction)
  if (/target creature/.test(text)) {
    return {
      targetType: 'creature',
      controllerOnly: false,
      excludeSource: false,
      description: 'target creature',
    };
  }
  
  return null;
}