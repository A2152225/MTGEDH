/**
 * spellSelfTotalManaValueCostReduction.ts
 *
 * Cast-time cost reduction for a spell's own oracle text of the form:
 *   "This spell costs {X} less to cast, where X is the total mana value of <qualifier> you control."
 *
 * Covers Metalwork Colossus (noncreature artifacts), Excalibur / Sword of Eden (historic), etc.
 * Generic qualifier matching — not card-name bespoke.
 */

import { cardManaValue } from '../utils.js';

export type SpellSelfCostReductionDelta = {
  generic: number;
  messages: string[];
};

export type ControlledPermanentManaValueFilter =
  | { kind: 'noncreature_artifacts' }
  | { kind: 'artifacts' }
  | { kind: 'historic' }
  | { kind: 'creatures' }
  | { kind: 'unknown'; raw: string };

const TOTAL_MV_COST_LESS_RE =
  /costs?\s*\{?x\}?\s*less(?:\s+to\s+cast)?[\s,]+where\s+x\s+is\s+the\s+total\s+(?:mana\s+value|mana\s+cost)\s+of\s+([^.]+)/i;

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function permanentCard(perm: any): any {
  return perm?.card || perm || null;
}

/** Parse the qualifier after "total mana value of ..." into a permanent filter. */
export function parseTotalManaValueCostLessQualifier(
  qualifierRaw: string,
): ControlledPermanentManaValueFilter | null {
  const q = String(qualifierRaw || '')
    .toLowerCase()
    .replace(/\byou control\b/g, '')
    .replace(/\bpermanents?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!q) return null;

  if (/\bhistoric\b/.test(q)) {
    return { kind: 'historic' };
  }
  if (/\bnoncreature\b/.test(q) && /\bartifacts?\b/.test(q)) {
    return { kind: 'noncreature_artifacts' };
  }
  if (/\bartifacts?\b/.test(q)) {
    return { kind: 'artifacts' };
  }
  if (/\bcreatures?\b/.test(q)) {
    return { kind: 'creatures' };
  }

  return { kind: 'unknown', raw: q };
}

export function permanentMatchesManaValueFilter(
  perm: any,
  filter: ControlledPermanentManaValueFilter,
): boolean {
  if (!perm) return false;
  const typeLine = typeLineOf(perm);
  switch (filter.kind) {
    case 'noncreature_artifacts':
      return typeLine.includes('artifact') && !typeLine.includes('creature');
    case 'artifacts':
      return typeLine.includes('artifact');
    case 'historic':
      return (
        typeLine.includes('artifact') ||
        typeLine.includes('legendary') ||
        typeLine.includes('saga')
      );
    case 'creatures':
      return typeLine.includes('creature');
    case 'unknown':
      return false;
    default:
      return false;
  }
}

export function filterLabel(filter: ControlledPermanentManaValueFilter): string {
  switch (filter.kind) {
    case 'noncreature_artifacts':
      return 'noncreature artifact mana value';
    case 'artifacts':
      return 'artifact mana value';
    case 'historic':
      return 'historic mana value';
    case 'creatures':
      return 'creature mana value';
    case 'unknown':
      return `mana value (${filter.raw})`;
    default:
      return 'mana value';
  }
}

/**
 * Sum mana values of controlled battlefield permanents matching the filter.
 */
export function totalControlledManaValue(
  battlefield: any[] | undefined,
  playerId: string,
  filter: ControlledPermanentManaValueFilter,
): number {
  if (!Array.isArray(battlefield) || !playerId) return 0;
  let total = 0;
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    if (!permanentMatchesManaValueFilter(perm, filter)) continue;
    const mv = Number(cardManaValue(permanentCard(perm)));
    if (Number.isFinite(mv) && mv > 0) {
      total += mv;
    } else if (Number.isFinite(mv) && mv === 0) {
      // Zero-MV permanents contribute 0; still valid matches.
      total += 0;
    }
  }
  return total;
}

/**
 * Detect and apply "costs {X} less ... where X is the total mana value of ..." self-reductions.
 */
export function applySpellSelfTotalManaValueCostReduction(options: {
  oracleText: string;
  cardName?: string;
  battlefield: any[] | undefined;
  playerId: string;
}): SpellSelfCostReductionDelta {
  const result: SpellSelfCostReductionDelta = { generic: 0, messages: [] };
  const oracle = String(options.oracleText || '');
  if (!oracle.trim()) return result;

  const match = oracle.match(TOTAL_MV_COST_LESS_RE);
  if (!match) return result;

  const filter = parseTotalManaValueCostLessQualifier(match[1] || '');
  if (!filter || filter.kind === 'unknown') return result;

  const total = totalControlledManaValue(options.battlefield, options.playerId, filter);
  if (total <= 0) return result;

  const name = String(options.cardName || 'Spell').trim() || 'Spell';
  result.generic += total;
  result.messages.push(`${name}: -{${total}} (${filterLabel(filter)})`);
  return result;
}
