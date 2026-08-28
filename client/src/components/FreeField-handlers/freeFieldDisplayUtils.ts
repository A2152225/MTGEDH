// Origin parent: client/src/components/FreeField.tsx
// Cluster moved: permanentIdsForPositionUpdate, parsePT, computeDisplayPT,
// getPTColor, getLoyaltyColor, buildPTTooltip, getAbilityDisplay, readPermanentDamageMarked.
// Public entry symbols: those eight functions.
// Leaf must not import FreeField.tsx or FreeField-handlers/index.ts.

import type { BattlefieldPermanent, KnownCardRef } from '../../../../shared/src';
import { getKeywordInfo } from '../../utils/keywordGlossary';

/** Resolve real server permanent IDs for layout moves (grouped tokens use synthetic display IDs). */
function permanentIdsForPositionUpdate(item: {
  id: string;
  isGroupedTokens?: boolean;
  groupedTokenIds?: string[];
}): string[] {
  const groupedIds = item.groupedTokenIds;
  if (item.isGroupedTokens) {
    if (Array.isArray(groupedIds) && groupedIds.length > 0) {
      return groupedIds;
    }
    return [item.id];
  }
  if (item.id.startsWith('group_')) {
    const suffix = item.id.slice('group_'.length);
    if (suffix) return [suffix];
  }
  return [item.id];
}

function parsePT(raw?: string | number): number | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return parseInt(raw, 10);
  return undefined;
}

function computeDisplayPT(perm: BattlefieldPermanent): {
  baseP?: number;
  baseT?: number;
  p?: number;
  t?: number;
} {
  const kc = perm.card as KnownCardRef;
  const baseP = typeof perm.basePower === 'number' ? perm.basePower : parsePT(kc?.power);
  const baseT = typeof perm.baseToughness === 'number' ? perm.baseToughness : parsePT(kc?.toughness);

  const effP = (perm as any).effectivePower as number | undefined;
  const effT = (perm as any).effectiveToughness as number | undefined;

  if (typeof effP === 'number' && typeof effT === 'number') {
    return { baseP, baseT, p: effP, t: effT };
  }

  if (typeof baseP === 'number' && typeof baseT === 'number') {
    const plus = perm.counters?.['+1/+1'] ?? 0;
    const minus = perm.counters?.['-1/-1'] ?? 0;
    const delta = plus - minus;
    return { baseP, baseT, p: baseP + delta, t: baseT + delta };
  }
  return { baseP, baseT, p: undefined, t: undefined };
}

// Color coding for P/T changes
function getPTColor(base: number | undefined, effective: number | undefined): string {
  if (base === undefined || effective === undefined) return '#ffffff';
  if (effective > base) return '#22c55e'; // Green - increased
  if (effective < base) return '#ef4444'; // Red - decreased
  return '#d1d5db'; // Neutral gray - unchanged
}

// Color coding for loyalty changes
function getLoyaltyColor(base: number | undefined, current: number | undefined): string {
  if (base === undefined || current === undefined) return '#c084fc';
  if (current > base) return '#22c55e'; // Green - increased
  if (current < base) return '#ef4444'; // Red - decreased
  return '#c084fc'; // Purple - unchanged
}

/**
 * Build P/T tooltip content showing breakdown of modifiers and damage
 */
function buildPTTooltip(params: {
  baseP?: number;
  baseT?: number;
  plusCounters: number;
  minusCounters: number;
  ptSources?: { name: string; power: number; toughness: number }[];
  damageMarked?: number;
  effectiveToughness?: number;
}): string | undefined {
  const { baseP, baseT, plusCounters, minusCounters, ptSources, damageMarked, effectiveToughness } = params;
  
  const hasModifiers = plusCounters > 0 || minusCounters > 0 || (ptSources && ptSources.length > 0);
  const hasDamage = (damageMarked ?? 0) > 0;
  
  if (!hasModifiers && !hasDamage) {
    return undefined;
  }
  
  const lines: string[] = [];
  
  // Base P/T
  lines.push(`Base: ${baseP ?? '?'}/${baseT ?? '?'}`);
  
  // +1/+1 counters
  if (plusCounters > 0) {
    lines.push(`${plusCounters}× +1/+1`);
  }
  
  // -1/-1 counters
  if (minusCounters > 0) {
    lines.push(`${minusCounters}× -1/-1`);
  }
  
  // Other P/T sources
  if (ptSources && ptSources.length > 0) {
    for (const source of ptSources) {
      const pStr = source.power >= 0 ? `+${source.power}` : `${source.power}`;
      const tStr = source.toughness >= 0 ? `+${source.toughness}` : `${source.toughness}`;
      lines.push(`${source.name}: ${pStr}/${tStr}`);
    }
  }
  
  // Damage
  if (hasDamage && effectiveToughness !== undefined) {
    lines.push('');  // Empty line before damage
    lines.push(`💔 Damage: ${damageMarked}/${effectiveToughness}`);
  }
  
  return lines.join('\n');
}

// Get ability info from glossary, with fallback
function getAbilityDisplay(abilityName: string): { short: string; color: string; reminderText: string; term: string } {
  const info = getKeywordInfo(abilityName);
  if (info) {
    return {
      short: info.short,
      color: info.color,
      reminderText: info.reminderText,
      term: info.term,
    };
  }
  // Fallback for unknown abilities
  return {
    short: abilityName.slice(0, 3).toUpperCase(),
    color: '#6b7280',
    reminderText: abilityName,
    term: abilityName,
  };
}

/** Combat stores `markedDamage`; the remaining-health badge reads `damageMarked`. */
function readPermanentDamageMarked(perm: { damageMarked?: number; markedDamage?: number; damageTaken?: number } | null | undefined): number {
  return Number(perm?.damageMarked || perm?.markedDamage || perm?.damageTaken || 0);
}

export {
  permanentIdsForPositionUpdate,
  parsePT,
  computeDisplayPT,
  getPTColor,
  getLoyaltyColor,
  buildPTTooltip,
  getAbilityDisplay,
  readPermanentDamageMarked,
};
