/**
 * spellSelfCreaturePowerCostReduction.ts
 *
 * Cast-time cost reduction for a spell's own oracle text of the form:
 *   "This spell costs {X} less to cast, where X is the total power of creatures you control."
 *   "This spell costs {X} less to cast, where X is the greatest power among creatures you control."
 *
 * Covers Ghalta, Primal Hunger (total power) and The Great Henge (greatest power).
 * Counts battlefield creatures the caster already controls — not the spell on the stack.
 */

import { lookupLocalCardByNameSync } from '../../services/localCardLookup.js';
import { parsePT } from '../utils.js';
import { getCurrentPowerToughnessForRules } from './currentPowerToughness.js';
import type { SpellSelfCostReductionDelta } from './spellSelfTotalManaValueCostReduction.js';

const TOTAL_POWER_COST_LESS_RE =
  /costs?\s*\{?x\}?\s*less(?:\s+to\s+cast)?[\s,]+where\s+x\s+is\s+the\s+total\s+power\s+of\s+creatures\s+you\s+control/i;

const GREATEST_POWER_COST_LESS_RE =
  /costs?\s*\{?x\}?\s*less(?:\s+to\s+cast)?[\s,]+where\s+x\s+is\s+the\s+greatest\s+power\s+among\s+creatures\s+you\s+control/i;

function isCreaturePermanent(perm: any): boolean {
  const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

function permanentControlledBy(perm: any, playerId: string): boolean {
  const controller = String(perm?.controller || perm?.controllerId || perm?.owner || '').trim();
  return Boolean(controller) && controller === playerId;
}

function hasPrintedPowerField(perm: any): boolean {
  const values = [perm?.effectivePower, perm?.basePower, perm?.power, perm?.card?.power];
  return values.some((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function printedPowerFromLookup(perm: any): number {
  const name = String(perm?.card?.name || perm?.name || '').trim();
  if (!name) return 0;
  try {
    const parsed = parsePT(lookupLocalCardByNameSync(name)?.power as string | number | undefined);
    return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  } catch {
    return 0;
  }
}

function creaturePower(perm: any, gameState?: any, battlefield?: any[]): number {
  // Current power (anthems, equipment, pumps, counters), as the battlefield shows it.
  const actual = getCurrentPowerToughnessForRules(perm, gameState ?? { battlefield: battlefield || [] });
  if (actual.power > 0 || hasPrintedPowerField(perm)) {
    return Math.max(0, actual.power);
  }
  return printedPowerFromLookup(perm);
}

export function controlledCreaturePowers(
  battlefield: any[] | undefined,
  playerId: string,
  gameState?: any,
): number[] {
  if (!Array.isArray(battlefield) || !playerId) return [];
  const powers: number[] = [];
  for (const perm of battlefield) {
    if (!perm || !permanentControlledBy(perm, playerId)) continue;
    if (!isCreaturePermanent(perm)) continue;
    powers.push(creaturePower(perm, gameState, battlefield));
  }
  return powers;
}

export function applySpellSelfCreaturePowerCostReduction(options: {
  oracleText: string;
  cardName?: string;
  battlefield: any[] | undefined;
  playerId: string;
  gameState?: any;
}): SpellSelfCostReductionDelta {
  const result: SpellSelfCostReductionDelta = { generic: 0, messages: [] };
  const oracle = String(options.oracleText || '');
  if (!oracle.trim()) return result;

  const totalMatch = TOTAL_POWER_COST_LESS_RE.test(oracle);
  const greatestMatch = GREATEST_POWER_COST_LESS_RE.test(oracle);
  if (!totalMatch && !greatestMatch) return result;

  const powers = controlledCreaturePowers(options.battlefield, options.playerId, options.gameState);
  const amount = totalMatch
    ? powers.reduce((sum, power) => sum + power, 0)
    : powers.reduce((max, power) => (power > max ? power : max), 0);
  if (amount <= 0) return result;

  const name = String(options.cardName || 'Spell').trim() || 'Spell';
  const label = totalMatch ? 'total creature power' : 'greatest creature power';
  result.generic += amount;
  result.messages.push(`${name}: -{${amount}} (${label})`);
  return result;
}
