/**
 * Emerge keyword ability (Rule 702.119)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.119. Emerge
 * 702.119a Emerge represents two static abilities that function while the spell with emerge is 
 * on the stack. "Emerge [cost]" means "You may cast this spell by paying [cost] and sacrificing 
 * a creature rather than paying its mana cost" and "If you chose to pay this spell's emerge cost, 
 * its total cost is reduced by an amount of generic mana equal to the sacrificed creature's mana 
 * value." Casting a spell using its emerge ability follows the rules for paying alternative costs 
 * in rules 601.2b and 601.2f–h.
 * 702.119b Emerge from [quality] is a variant of emerge. "Emerge from [quality] [cost]" means 
 * "You may cast this spell by paying [cost] and sacrificing a [quality] permanent rather than 
 * paying its mana cost" and "If you pay this spell's emerge cost, its total cost is reduced by 
 * an amount of generic mana equal to the sacrificed permanent's mana value."
 * 702.119c You choose which permanent to sacrifice as you choose to pay a spell's emerge cost, 
 * and you sacrifice that permanent as you pay the total cost.
 */

export interface EmergeAbility {
  readonly type: 'emerge';
  readonly source: string;
  readonly emergeCost: string;
  readonly emergeQuality?: string; // For "Emerge from [quality]" variant
  readonly wasEmerged: boolean;
  readonly sacrificedCreature?: string;
  readonly manaReduction: number;
}

function tokenizeCost(cost: string): string[] {
  const raw = String(cost || '').trim();
  if (!raw) {
    return [];
  }

  const braced = [...raw.matchAll(/\{([^}]+)\}/g)].map((match) => String(match[1] || '').trim().toUpperCase()).filter(Boolean);
  if (braced.length > 0) {
    return braced;
  }

  const compact = raw.replace(/\s+/g, '').toUpperCase();
  const tokens: string[] = [];
  for (let index = 0; index < compact.length;) {
    if (/\d/.test(compact[index])) {
      let nextIndex = index + 1;
      while (nextIndex < compact.length && /\d/.test(compact[nextIndex])) {
        nextIndex += 1;
      }
      tokens.push(compact.slice(index, nextIndex));
      index = nextIndex;
      continue;
    }

    tokens.push(compact[index]);
    index += 1;
  }

  return tokens;
}

function formatCost(tokens: readonly string[]): string {
  if (tokens.length === 0) {
    return '{0}';
  }

  return tokens.map((token) => `{${token}}`).join('');
}

function extractEmergeParts(oracleText: string): { quality?: string; emergeCost: string } | null {
  const normalized = String(oracleText || '').replace(/\r?\n/g, ' ');
  const variant = normalized.match(/\bemerge\s+from\s+([^—-]+?)\s+[—-]\s*([^.;,()]+)/i);
  if (variant) {
    const quality = String(variant[1] || '').trim();
    const emergeCost = String(variant[2] || '').trim();
    return quality && emergeCost ? { quality, emergeCost } : null;
  }

  const plain = normalized.match(/\bemerge\s+([^.;,()]+)/i);
  if (!plain) {
    return null;
  }

  const emergeCost = String(plain[1] || '').trim();
  return emergeCost ? { emergeCost } : null;
}

/**
 * Create an emerge ability
 * Rule 702.119a
 * @param source - The spell with emerge
 * @param emergeCost - Alternative cost to cast with emerge
 * @param emergeQuality - Optional quality requirement (e.g., "artifact")
 * @returns Emerge ability object
 */
export function emerge(source: string, emergeCost: string, emergeQuality?: string): EmergeAbility {
  return {
    type: 'emerge',
    source,
    emergeCost,
    emergeQuality,
    wasEmerged: false,
    manaReduction: 0,
  };
}

/**
 * Cast spell with emerge, sacrificing a creature
 * Rule 702.119a - Total cost reduced by creature's mana value
 * @param ability - Emerge ability
 * @param sacrificedCreature - ID of creature to sacrifice
 * @param creatureManaValue - Mana value of sacrificed creature
 * @returns Updated ability
 */
export function castWithEmerge(
  ability: EmergeAbility,
  sacrificedCreature: string,
  creatureManaValue: number
): EmergeAbility {
  return {
    ...ability,
    wasEmerged: true,
    sacrificedCreature,
    manaReduction: creatureManaValue,
  };
}

/**
 * Check if spell was cast with emerge
 * @param ability - Emerge ability
 * @returns True if emerge cost was paid
 */
export function wasEmerged(ability: EmergeAbility): boolean {
  return ability.wasEmerged;
}

/**
 * Get mana reduction from emerge
 * Rule 702.119a
 * @param ability - Emerge ability
 * @returns Amount of generic mana reduced
 */
export function getEmergeManaReduction(ability: EmergeAbility): number {
  return ability.manaReduction;
}

/**
 * Get sacrificed creature
 * @param ability - Emerge ability
 * @returns ID of sacrificed creature or undefined
 */
export function getSacrificedCreature(ability: EmergeAbility): string | undefined {
  return ability.sacrificedCreature;
}

/**
 * Check whether a permanent satisfies the emerge sacrifice quality restriction.
 */
export function canSacrificeForEmerge(
  candidate: { type_line?: string; card?: { type_line?: string } },
  quality?: string,
): boolean {
  const typeLine = String(candidate.type_line || candidate.card?.type_line || '').toLowerCase();
  if (!quality) {
    return typeLine.includes('creature');
  }

  return typeLine.includes(String(quality).trim().toLowerCase());
}

/**
 * Reduce generic mana in the emerge cost by the sacrificed permanent's mana value.
 */
export function getReducedEmergeCost(cost: string, reduction: number): string {
  const tokens = tokenizeCost(cost);
  let generic = 0;
  const nonGeneric: string[] = [];

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      generic += Number.parseInt(token, 10);
    } else {
      nonGeneric.push(token);
    }
  }

  const reducedGeneric = Math.max(0, generic - Math.max(0, reduction));
  return formatCost([
    ...(reducedGeneric > 0 ? [String(reducedGeneric)] : []),
    ...nonGeneric,
  ]);
}

/**
 * Parse emerge cost data from oracle text.
 */
export function parseEmerge(oracleText: string): { quality?: string; emergeCost: string } | null {
  return extractEmergeParts(oracleText);
}

/**
 * Emerge abilities with same cost are redundant
 * @param abilities - Array of emerge abilities
 * @returns True if costs match
 */
export function hasRedundantEmerge(abilities: readonly EmergeAbility[]): boolean {
  if (abilities.length <= 1) {
    return false;
  }
  
  const costs = new Set(abilities.map(a => a.emergeCost));
  return costs.size < abilities.length;
}
