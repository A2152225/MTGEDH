import type { GameState, PlayerID, TargetRef, BattlefieldPermanent } from '../../../shared/src';

// Re-export TargetRef for consumers of this module
export type { TargetRef };

// Spell spec derived heuristically from oracle text
export type SpellOp =
  | 'DESTROY_TARGET' | 'EXILE_TARGET'
  | 'DESTROY_ALL' | 'EXILE_ALL'
  | 'DESTROY_EACH' | 'DAMAGE_EACH'
  | 'ANY_TARGET_DAMAGE'
  | 'COUNTER_TARGET_SPELL' | 'COUNTER_TARGET_ABILITY';

export type PermanentFilter = 'ANY' | 'CREATURE' | 'PLANESWALKER' | 'PERMANENT';

// Spell type filter for counterspells
export type SpellTypeFilter = 'ANY_SPELL' | 'INSTANT_SORCERY' | 'NONCREATURE' | 'CREATURE_SPELL';

export type SpellSpec = {
  op: SpellOp;
  filter: PermanentFilter;
  minTargets: number;
  maxTargets: number;
  amount?: number;
  spellTypeFilter?: SpellTypeFilter; // For counterspells that only counter certain spell types
};

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

  if (/exile target/.test(t)) return { op: 'EXILE_TARGET', filter, minTargets: 1, maxTargets: 1 };
  if (/destroy target/.test(t)) return { op: 'DESTROY_TARGET', filter, minTargets: 1, maxTargets: 1 };

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

function hasHexproofOrShroud(p: BattlefieldPermanent, s: Readonly<GameState>) {
  const self = (((p.card as any)?.oracle_text) || '').toLowerCase();
  if (self.includes('hexproof') || self.includes('shroud')) return true;
  return s.battlefield.some(a =>
    a.attachedTo === p.id &&
    ((((a.card as any)?.oracle_text) || '').toLowerCase().match(/hexproof|shroud/))
  );
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
  | { kind: 'Broadcast'; message: string };

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