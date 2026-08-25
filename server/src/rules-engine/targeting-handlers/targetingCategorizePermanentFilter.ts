// server/src/rules-engine/targeting-handlers/targetingCategorizePermanentFilter.ts
// Origin parent: server/src/rules-engine/targeting.ts
// Cluster moved: the shared "detect filter type from oracle text" block that
//   categorizeSpellWithoutPrimaryRetirement closed over for destroy/exile-all
//   and later generic destroy/exile-target patterns.
// Public entry symbols: detectCategorizePermanentFilter.

import type { PermanentFilter, TargetRestriction } from './targetingSpellSpecTypes.js';

export function detectCategorizePermanentFilter(t: string): {
  filter: PermanentFilter;
  multiFilter: PermanentFilter[] | undefined;
  creatureRestriction: TargetRestriction | undefined;
} {
  // Detect filter type based on target description
  // Priority: specific types (artifact, enchantment, land, creature, planeswalker) > permanent > any
  // Special handling for "X or Y" patterns (e.g., "artifact or enchantment")
  const hasArtifact = /\bartifacts?\b/.test(t);
  const hasEnchantment = /\benchantments?\b/.test(t);
  const hasLand = /\blands?\b/.test(t);
  const hasCreature = /\bcreatures?\b/.test(t);
  const hasPlaneswalker = /\bplaneswalkers?\b/.test(t);
  const hasBattle = /\bbattles?\b/.test(t);
  const hasPermanent = /\bpermanents?\b/.test(t);
  
  // Check for multi-type patterns with "or" (Nature's Claim: "target artifact or enchantment")
  // Atraxa's Fall: "target artifact, battle, enchantment, or creature with flying"
  let filter: PermanentFilter;
  let multiFilter: PermanentFilter[] | undefined;
  let creatureRestriction: TargetRestriction | undefined;
  
  // Pattern: "artifact, battle, enchantment, or creature with flying" (Atraxa's Fall)
  // This is a complex pattern: artifacts/battles/enchantments without restriction, OR creatures with flying
  if (/artifact,?\s+battle,?\s+enchantment,?\s+or creature with flying/.test(t)) {
    // All four types, but creatures need flying
    multiFilter = ['ARTIFACT', 'BATTLE', 'ENCHANTMENT', 'CREATURE'];
    filter = 'ARTIFACT'; // Primary filter
    // Add restriction for creatures only - they must have flying
    creatureRestriction = {
      type: 'has_keyword',
      description: 'with flying',
      keyword: 'flying',
    };
  }
  // Pattern: "creature or planeswalker" (e.g., burn/removal)
  else if (/creature\s+or\s+planeswalker/.test(t) || /planeswalker\s+or\s+creature/.test(t)) {
    filter = 'CREATURE';
    multiFilter = ['CREATURE', 'PLANESWALKER'];
  }
  // Pattern: "artifact or enchantment" (Nature's Claim, Naturalize, etc.)
  else if (/artifacts?\s+(?:or|and\/or)\s+enchantments?/.test(t)) {
    filter = 'ARTIFACT'; // Primary filter
    multiFilter = ['ARTIFACT', 'ENCHANTMENT'];
  }
  // Pattern: "artifact and enchantment" (occasionally used; treat like multi-filter)
  else if (/artifacts?\s+and\s+enchantments?/.test(t) || /enchantments?\s+and\s+artifacts?/.test(t)) {
    filter = 'ARTIFACT';
    multiFilter = ['ARTIFACT', 'ENCHANTMENT'];
  }
  // Pattern: "artifact, battle, enchantment" or similar multi-type without creature restriction
  else if (/artifact,?\s+(?:battle,?\s+)?enchantment/.test(t) || /battle,?\s+(?:artifact,?\s+)?enchantment/.test(t)) {
    // Complex multi-type - parse all types mentioned
    const types: PermanentFilter[] = [];
    if (hasArtifact) types.push('ARTIFACT');
    if (hasBattle) types.push('BATTLE');
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
  } else if (hasBattle && !hasCreature && !hasArtifact && !hasEnchantment && !hasPlaneswalker && !hasLand) {
    filter = 'BATTLE';
  } else if (hasPermanent) {
    filter = 'PERMANENT';
  } else {
    filter = 'ANY';
  }
  return { filter, multiFilter, creatureRestriction };
}
