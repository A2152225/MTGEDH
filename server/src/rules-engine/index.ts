import type { GameState, BattlefieldPermanent } from '../../../shared/src';

import {
  getCounterValue,
  permanentHasCounterGrantedAbility,
} from '../state/modules/counter-common-effects.js';
import { calculateAllPTBonuses, calculateVariablePT } from '../state/utils.js';

/**
 * Parse power/toughness value from string or number
 * Handles: "2", "3", "*", "1+*", etc.
 * Returns undefined for * or complex values
 */
function parsePT(raw?: string | number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') return raw;
  const s = String(raw).trim();
  if (s === '*' || s.includes('*')) return undefined;
  const n = parseInt(s, 10);
  return isNaN(n) ? undefined : n;
}

// Engine effects (counter updates computed by SBA)
export type EngineCounterUpdate = {
  readonly permanentId: string;
  readonly counters: Readonly<Record<string, number>>;
  readonly clearDamage?: boolean;
};

export type EngineSBAResult = {
  readonly counterUpdates: readonly EngineCounterUpdate[];
  readonly destroys: readonly string[];
  readonly playersLost: readonly string[]; // Player IDs who have lost due to SBA (Rule 704.5a)
  readonly legendRuleViolations?: readonly string[]; // Permanent IDs involved in legend rule violations (Rule 704.5j)
};

// Normalize counters: positives only; +1/+1 and -1/-1 cancel pairwise
function normalizeCounters(input?: Readonly<Record<string, number>>): Record<string, number> {
  if (!input) return {};
  const out: Record<string, number> = {};
  for (const [k, vRaw] of Object.entries(input)) {
    const v = Math.floor(Number(vRaw) || 0);
    if (v > 0) out[k] = v;
  }
  const plus = out['+1/+1'] ?? 0;
  const minus = out['-1/-1'] ?? 0;
  if (plus > 0 && minus > 0) {
    const cancel = Math.min(plus, minus);
    const pRem = plus - cancel;
    const mRem = minus - cancel;
    if (pRem > 0) out['+1/+1'] = pRem; else delete out['+1/+1'];
    if (mRem > 0) out['-1/-1'] = mRem; else delete out['-1/-1'];
  }
  return out;
}

function countersEqual(a?: Readonly<Record<string, number>>, b?: Readonly<Record<string, number>>): boolean {
  const ak = a ? Object.keys(a) : [];
  const bk = b ? Object.keys(b) : [];
  if (ak.length !== bk.length) return false;
  for (const k of ak) if ((a?.[k] ?? 0) !== (b?.[k] ?? 0)) return false;
  return true;
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function getEffectiveStatsForSBA(
  state: Readonly<GameState>,
  perm: BattlefieldPermanent
): { power?: number; toughness?: number } {
  const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return {};

  if (isNumber((perm as any).effectivePower) && isNumber((perm as any).effectiveToughness)) {
    return {
      power: Number((perm as any).effectivePower),
      toughness: Number((perm as any).effectiveToughness),
    };
  }

  let basePower = parsePT(perm.basePower);
  let baseToughness = parsePT(perm.baseToughness);

  if (!isNumber(basePower)) {
    basePower = parsePT((perm.card as any)?.power);
  }
  if (!isNumber(baseToughness)) {
    baseToughness = parsePT((perm.card as any)?.toughness);
  }

  if (!isNumber(basePower) || !isNumber(baseToughness)) {
    const variablePT = calculateVariablePT({ ...((perm.card as any) || {}), controller: (perm as any).controller }, state);
    if (variablePT) {
      basePower = isNumber(basePower) ? basePower : variablePT.power;
      baseToughness = isNumber(baseToughness) ? baseToughness : variablePT.toughness;
    }
  }

  if (!isNumber(basePower) || !isNumber(baseToughness)) {
    return {};
  }

  const plus = perm.counters?.['+1/+1'] ?? 0;
  const minus = perm.counters?.['-1/-1'] ?? 0;
  const counterDelta = plus - minus;

  let otherCounterPower = 0;
  let otherCounterToughness = 0;
  if (perm.counters) {
    for (const [counterType, count] of Object.entries(perm.counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (!counterMatch) continue;
      otherCounterPower += parseInt(counterMatch[1], 10) * (count as number);
      otherCounterToughness += parseInt(counterMatch[2], 10) * (count as number);
    }
  }

  const allBonuses = calculateAllPTBonuses(perm, state);
  return {
    power: Math.max(0, basePower + counterDelta + otherCounterPower + allBonuses.power),
    toughness: baseToughness + counterDelta + otherCounterToughness + allBonuses.toughness,
  };
}

/**
 * Check if a permanent has the indestructible ability
 * Rule 702.12: A permanent with indestructible can't be destroyed.
 */
function hasIndestructible(state: Readonly<GameState>, perm: BattlefieldPermanent): boolean {
  const oracleText = ((perm.card as any)?.oracle_text || '').toLowerCase();
  const grantedAbilities = (perm as any).grantedAbilities || [];
  const keywords = (perm.card as any)?.keywords || [];
  const counters = (perm as any)?.counters || {};
  
  // Check oracle text
  if (oracleText.includes('indestructible')) {
    return true;
  }
  
  // Check granted abilities
  for (const ability of grantedAbilities) {
    if (typeof ability === 'string' && ability.toLowerCase().includes('indestructible')) {
      return true;
    }
  }
  
  // Check Scryfall keywords
  for (const keyword of keywords) {
    if (typeof keyword === 'string' && keyword.toLowerCase() === 'indestructible') {
      return true;
    }
  }

  for (const [counterName, counterValue] of Object.entries(counters)) {
    if (String(counterName).toLowerCase() === 'indestructible' && Number(counterValue || 0) > 0) {
      return true;
    }
  }

  if (permanentHasCounterGrantedAbility(state, perm, 'indestructible')) {
    return true;
  }
  
  // Check for equipment that grants indestructible (e.g., Darksteel Plate)
  const attachedEquipment = (perm as any).attachedEquipment || [];
  const attachments = (perm as any).attachments || [];
  const allAttachments = [...attachedEquipment, ...attachments];
  
  // We need to check the battlefield for these attachments
  // This will be done in the main function where we have access to state
  
  return false;
}

/**
 * Check if any attached permanents grant indestructible
 * Used for Equipment like Darksteel Plate
 */
function attachmentGrantsIndestructible(
  state: Readonly<GameState>, 
  perm: BattlefieldPermanent
): boolean {
  const attachedEquipment = (perm as any).attachedEquipment || [];
  const attachments = (perm as any).attachments || [];
  const allAttachments = [...attachedEquipment, ...attachments];
  
  for (const attachId of allAttachments) {
    const attachment = (state.battlefield as readonly BattlefieldPermanent[]).find(
      p => p.id === attachId
    );
    if (attachment) {
      const attachOracleText = ((attachment.card as any)?.oracle_text || '').toLowerCase();
      // Pattern: "Equipped creature has indestructible" or "Equipped creature is indestructible"
      if (attachOracleText.includes('equipped creature') && 
          (attachOracleText.includes('has indestructible') || 
           attachOracleText.includes('is indestructible') ||
           attachOracleText.includes('indestructible'))) {
        return true;
      }
    }
  }
  
  return false;
}

// Pure SBA pass
export function applyStateBasedActions(state: Readonly<GameState>): EngineSBAResult {
  const updates: EngineCounterUpdate[] = [];

  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const normalized = normalizeCounters(perm.counters);
    if (!countersEqual(perm.counters, normalized)) {
      updates.push({ permanentId: perm.id, counters: normalized });
    }
  }

  const destroys: string[] = [];
  
  // CR 704.5m: If an Aura is attached to an illegal object or player,
  // or is not attached to an object or player, that Aura is put into
  // its owner's graveyard.
  // CR 704.5n: If an Aura is on the battlefield and isn't enchanting
  // an object or player, that Aura is put into its owner's graveyard.
  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    const isAura = typeLine.includes('enchantment') && typeLine.includes('aura');
    
    if (isAura) {
      // Check if the aura is an enchantment creature (Bestow, Reconfigure, etc.)
      // These can exist on the battlefield without being attached
      const isEnchantmentCreature = typeLine.includes('creature');
      
      // If it's NOT an enchantment creature and has no attachedTo, destroy it
      if (!isEnchantmentCreature && !(perm as any).attachedTo) {
        destroys.push(perm.id);
      }
      // If it IS attached, verify the target still exists
      else if ((perm as any).attachedTo && !isEnchantmentCreature) {
        const targetExists = (state.battlefield as readonly BattlefieldPermanent[])
          .some(p => p.id === (perm as any).attachedTo);
        if (!targetExists) {
          destroys.push(perm.id);
        }
      }
      // Note: Enchantment creatures (bestow/reconfigure) are handled in runSBA
      // before applyStateBasedActions is called, so they get their stats restored
      // before the toughness check below
    }
  }
  
  // CR 704.5f: If a creature has toughness 0 or less, it's put into its owner's graveyard.
  // This is NOT destruction (Rule 702.12b) - it happens regardless of indestructible
  // CR 704.5g: If a creature has toughness greater than 0, and it has been dealt damage equal to
  // or greater than its toughness, that creature has been dealt lethal damage and is destroyed.
  // Rule 702.12b: Indestructible creatures are NOT destroyed by lethal damage.
  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    const totalToughness = getEffectiveStatsForSBA(state, perm).toughness;
    if (!isNumber(totalToughness)) continue;
    
    // Get damage
    const damage = (perm as any).damage ?? (perm as any).markedDamage ?? (perm as any).damageMarked ?? 0;
    
    // CR 704.5f: 0 or less toughness - NOT destruction, ignores indestructible
    if (totalToughness <= 0) {
      destroys.push(perm.id);
      continue;
    }
    
    // CR 704.5g: Lethal damage - IS destruction, respects indestructible
    if (damage >= totalToughness) {
      // Check for indestructible
      const shieldCounters = getCounterValue(perm, 'shield');
      if (shieldCounters > 0) {
        const nextCounters = normalizeCounters({
          ...((perm.counters || {}) as Record<string, number>),
          shield: shieldCounters - 1,
        });
        updates.push({ permanentId: perm.id, counters: nextCounters, clearDamage: true });
        continue;
      }

      const isIndestructible = hasIndestructible(state, perm) || attachmentGrantsIndestructible(state, perm);
      if (!isIndestructible) {
        destroys.push(perm.id);
      }
    }
  }

  // CR 704.5i: If a planeswalker has loyalty 0, it's put into its owner's graveyard.
  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    if (!typeLine.includes('planeswalker')) continue;
    
    // Get current loyalty from counters
    const loyalty = (perm as any).counters?.loyalty ?? 0;
    
    if (loyalty <= 0) {
      destroys.push(perm.id);
    }
  }
  
  // CR 704.5j: Legend Rule - If a player controls two or more legendary permanents
  // with the same name, that player chooses one of them, and the rest are put into
  // their owners' graveyards. This is called the "legend rule."
  // Note: This function returns which permanents NEED a choice, the actual choice
  // is handled by the caller (runSBA) via ResolutionQueueManager
  const legendaryByControllerAndName = new Map<string, BattlefieldPermanent[]>();
  
  for (const perm of state.battlefield as readonly BattlefieldPermanent[]) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    // Check for "legendary" supertype (both legendary creatures and legendary planeswalkers)
    if (!typeLine.includes('legendary')) continue;
    
    const controller = (perm as any).controller || (perm as any).owner || '';
    const cardName = (perm.card as any)?.name || '';
    
    if (!controller || !cardName) continue;
    
    const key = `${controller}:${cardName}`;
    const existing = legendaryByControllerAndName.get(key) || [];
    existing.push(perm);
    legendaryByControllerAndName.set(key, existing);
  }
  
  // For duplicate legendaries, we need to mark them for legend rule processing
  // The caller will handle prompting the player to choose which to keep
  // For now, we return all IDs of permanents that are part of a legend rule violation
  const legendRuleViolations: string[] = [];
  for (const [, perms] of legendaryByControllerAndName) {
    if (perms.length > 1) {
      // All permanents in this group are part of a legend rule violation
      // The player will need to choose which one to keep
      for (const perm of perms) {
        legendRuleViolations.push(perm.id);
      }
    }
  }

  // CR 704.5a: If a player has 0 or less life, that player loses the game.
  const playersLost: string[] = [];
  const life = (state as any).life || {};
  const players = Array.isArray((state as any).players) 
    ? (state as any).players 
    : [];
  
  for (const player of players) {
    if (!player || !player.id) continue;
    if (player.hasLost || player.eliminated || player.conceded) continue;
    
    const playerLife = life[player.id];
    if (typeof playerLife === 'number' && playerLife <= 0) {
      playersLost.push(player.id);
    }
  }

  return { counterUpdates: updates, destroys, playersLost, legendRuleViolations };
}

// Damage evaluation (wither/infect → -1/-1 counters)
export type EngineAction =
  | { type: 'DEAL_DAMAGE'; targetPermanentId: string; amount: number; wither?: boolean; infect?: boolean };

export type EngineEffect =
  | { kind: 'AddCounters'; permanentId: string; counter: string; amount: number }
  | { kind: 'DestroyPermanent'; permanentId: string };

export function evaluateAction(_state: Readonly<GameState>, action: EngineAction): readonly EngineEffect[] {
  switch (action.type) {
    case 'DEAL_DAMAGE': {
      const { amount, wither, infect, targetPermanentId } = action;
      if ((wither || infect) && amount > 0) {
        return [{ kind: 'AddCounters', permanentId: targetPermanentId, counter: '-1/-1', amount }];
      }
      return [];
    }
    default:
      return [];
  }
}