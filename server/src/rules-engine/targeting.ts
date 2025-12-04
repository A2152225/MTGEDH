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

export type SpellSpec = {
  op: SpellOp;
  filter: PermanentFilter;
  minTargets: number;
  maxTargets: number;
  amount?: number;
  spellTypeFilter?: SpellTypeFilter; // For counterspells that only counter certain spell types
  targetDescription?: string; // Human-readable description of what can be targeted
  returnDelay?: 'immediate' | 'end_of_turn' | 'end_of_combat'; // For flicker effects
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

  const creature = /\bcreature\b/.test(t) && !/\bplaneswalker\b/.test(t);
  const walker = /\bplaneswalker\b/.test(t) && !/\bcreature\b/.test(t);
  const permanent = /\bpermanent\b/.test(t);
  const filter: PermanentFilter = creature ? 'CREATURE' : walker ? 'PLANESWALKER' : permanent ? 'PERMANENT' : 'ANY';

  if (/destroy all\b/.test(t)) return { op: 'DESTROY_ALL', filter, minTargets: 0, maxTargets: 0 };
  // Only match "exile all" if it's targeting permanents (creatures, planeswalkers, etc.), not spells
  if (/exile all\b/.test(t) && !/exile all\s+(?:other\s+)?spells\b/.test(t)) return { op: 'EXILE_ALL', filter, minTargets: 0, maxTargets: 0 };
  if (/destroy each\b/.test(t)) return { op: 'DESTROY_EACH', filter, minTargets: 0, maxTargets: 0 };

  if (/each creature/.test(t) && /\bdamage\b/.test(t)) {
    const m = t.match(/(\d+)\s+damage/);
    return { op: 'DAMAGE_EACH', filter: 'CREATURE', minTargets: 0, maxTargets: 0, amount: m ? parseInt(m[1], 10) : undefined };
  }

  if (/exile up to (\d+)/.test(t)) {
    const n = parseInt(t.match(/exile up to (\d+)/)![1], 10);
    return { op: 'EXILE_TARGET', filter, minTargets: 0, maxTargets: n };
  }
  if (/destroy up to (\d+)/.test(t)) {
    const n = parseInt(t.match(/destroy up to (\d+)/)![1], 10);
    return { op: 'DESTROY_TARGET', filter, minTargets: 0, maxTargets: n };
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
    };
  }

  if (/exile target/.test(t)) return { op: 'EXILE_TARGET', filter, minTargets: 1, maxTargets: 1 };
  if (/destroy target/.test(t)) return { op: 'DESTROY_TARGET', filter, minTargets: 1, maxTargets: 1 };
  
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

function hasHexproofOrShroud(p: BattlefieldPermanent, s: Readonly<GameState>): boolean {
  const self = (((p.card as any)?.oracle_text) || '').toLowerCase();
  // Check if permanent itself has hexproof/shroud
  if (self.includes('hexproof') || self.includes('shroud')) return true;
  
  // Check if any attached aura grants hexproof/shroud
  const hasFromAura = s.battlefield.some(a =>
    a.attachedTo === p.id &&
    ((((a.card as any)?.oracle_text) || '').toLowerCase().match(/hexproof|shroud/))
  );
  if (hasFromAura) return true;
  
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

export function evaluateTargeting(state: Readonly<GameState>, caster: PlayerID, spec: SpellSpec): TargetRef[] {
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
    if (spec.filter === 'CREATURE' && !isCreature(p)) continue;
    if (spec.filter === 'PLANESWALKER' && !isPlaneswalker(p)) continue;
    // 'PERMANENT' filter allows any permanent; 'ANY' is for "any target" which only includes creatures/planeswalkers/players
    if (spec.filter === 'ANY' && !(isCreature(p) || isPlaneswalker(p))) continue;
    // For 'PERMANENT' filter, all permanents are valid targets
    if (hasHexproofOrShroud(p, state) && p.controller !== caster) continue;
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

export function resolveSpell(spec: SpellSpec, chosen: readonly TargetRef[], state: Readonly<GameState>): readonly EngineEffect[] {
  const eff: EngineEffect[] = [];
  const applyAll = (k: 'DestroyPermanent' | 'MoveToExile') => {
    for (const p of state.battlefield) {
      if (spec.filter === 'CREATURE' && !isCreature(p)) continue;
      if (spec.filter === 'PLANESWALKER' && !isPlaneswalker(p)) continue;
      eff.push({ kind: k, id: p.id });
    }
  };

  switch (spec.op) {
    case 'DESTROY_TARGET':
      for (const t of chosen) if (t.kind === 'permanent') eff.push({ kind: 'DestroyPermanent', id: t.id });
      break;
    case 'EXILE_TARGET':
      for (const t of chosen) if (t.kind === 'permanent') eff.push({ kind: 'MoveToExile', id: t.id });
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