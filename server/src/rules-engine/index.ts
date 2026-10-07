import type { GameState, BattlefieldPermanent } from '../../../shared/src';
import { permanentHasAttachmentGrantedKeyword } from '../../../shared/src';
import { getMarkedDamage } from '../../../shared/src/markedDamage.js';

import {
  getCounterValue,
  permanentHasCounterGrantedAbility,
  permanentHasDeathtouchDamageMarked,
} from '../state/modules/counter-common-effects.js';
import { calculateAllPTBonuses, calculateVariablePT } from '../state/utils.js';
import { sumActiveTemporaryPTMods } from '../state/modules/temporaryPtMods.js';
import { sumLongDurationPtModifiers } from '../state/modules/longDurationPtModifiers.js';
import { applyLayer7bSetBasePowerToughness } from '../state/modules/setBasePtTimestampResolution.js';
import { stripCreateTokenGrantedAbilities } from '../../../rules-engine/src/oracleReminderText.js';
import { getContinuousGrantedAbilitiesForPermanent } from '../state/modules/staticEffectSpec.js';

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

function getTemporaryPowerToughnessForSBA(perm: BattlefieldPermanent, state?: unknown): { power: number; toughness: number } {
  const mirroredMods = Array.isArray((perm as any).temporaryPTMods)
    ? (perm as any).temporaryPTMods
    : [];
  // Pumps lasting longer than end of turn are never mirrored: always count the active ones.
  const longLasting = sumLongDurationPtModifiers(perm, state);
  if (mirroredMods.length > 0) {
    const mirrored = sumActiveTemporaryPTMods(perm);
    return { power: mirrored.power + longLasting.power, toughness: mirrored.toughness + longLasting.toughness };
  }

  // Oracle IR stores P/T changes canonically in `modifiers`. The server bridge
  // normally mirrors end-of-turn entries to temporaryPTMods for the client, but
  // SBA must remain correct before that bridge runs and for replayed old events.
  let power = 0;
  let toughness = 0;
  for (const modifier of Array.isArray((perm as any).modifiers) ? (perm as any).modifiers : []) {
    const type = String(modifier?.type || '').trim().toLowerCase();
    if (type !== 'powertoughness' && type !== 'power_toughness') continue;
    // Long-lasting entries were already summed above.
    if (String(modifier?.duration || 'end_of_turn').trim().toLowerCase() !== 'end_of_turn') continue;
    power += Number(modifier?.power ?? 0) || 0;
    toughness += Number(modifier?.toughness ?? 0) || 0;
  }
  return { power: power + longLasting.power, toughness: toughness + longLasting.toughness };
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

  // Layer 7b set-base (Auras, static specs, Oracle IR setters) ordered by timestamp.
  const layer7b = applyLayer7bSetBasePowerToughness(perm, state, { power: basePower, toughness: baseToughness });
  basePower = layer7b.power ?? basePower;
  baseToughness = layer7b.toughness ?? baseToughness;

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
  const temporaryPT = getTemporaryPowerToughnessForSBA(perm, state);
  return {
    power: Math.max(0, basePower + counterDelta + otherCounterPower + allBonuses.power + temporaryPT.power),
    toughness: baseToughness + counterDelta + otherCounterToughness + allBonuses.toughness + temporaryPT.toughness,
  };
}

function oracleTextGrantsNativeIndestructible(oracleTextRaw: string): boolean {
  // Strip create-token type reminders, inline create...token ability tails, and
  // parentheticals so token keywords (e.g. Vibranium "with indestructible") are
  // not treated as native self-grants.
  const cleaned = stripCreateTokenGrantedAbilities(String(oracleTextRaw || ''))
    .replace(/\([^)]*\)/g, ' ');

  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);

  for (const line of lines) {
    if (!line.includes('indestructible')) continue;

    // Create-a-token instructions describe the token, not a native self-grant.
    if (/\bcreate\b/i.test(line) && /\btoken\b/i.test(line)) {
      continue;
    }

    // Native keyword lines are often just "Indestructible" or mixed with other keywords.
    if (/^(?:[a-z ,'-]+,\s*)*indestructible(?:\s*,\s*[a-z ,'-]+)*$/i.test(line)) {
      return true;
    }

    // Aura/Equipment grants apply to the host, not this permanent.
    if (/\b(?:enchanted|equipped|fortified)\s+(?:creature|permanent|land)\b/.test(line)) {
      continue;
    }

    // Static self-grants like "CARDNAME is indestructible." should count, but
    // conditional and temporary clauses are handled elsewhere.
    if ((/\bis indestructible\b/.test(line) || /\bhas indestructible\b/.test(line)) &&
        !/\bas long as\b/.test(line) &&
        !/\buntil end of turn\b/.test(line)) {
      return true;
    }
  }

  return false;
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
  if (oracleTextGrantsNativeIndestructible(oracleText)) {
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

  // Static grants from other permanents (Avacyn, Sephara "other creatures you control
  // with flying have indestructible", etc.) via the derived continuous-effects view.
  try {
    if (getContinuousGrantedAbilitiesForPermanent(perm, state).includes('indestructible')) {
      return true;
    }
  } catch {
    // best-effort only
  }

  return false;
}

/**
 * True when attached Equipment or Auras grant indestructible
 * (Darksteel Plate, Redemption Arc, etc.).
 */
function attachmentGrantsIndestructible(
  state: Readonly<GameState>,
  perm: BattlefieldPermanent,
): boolean {
  const battlefield = Array.isArray(state.battlefield) ? [...state.battlefield] : [];
  return permanentHasAttachmentGrantedKeyword(perm, battlefield, 'indestructible');
}

/** Rule 702.12: a permanent with indestructible can't be destroyed. */
export function permanentHasIndestructible(
  state: Readonly<GameState> | undefined,
  perm: BattlefieldPermanent | undefined,
): boolean {
  if (!state || !perm) return false;
  return hasIndestructible(state, perm) || attachmentGrantsIndestructible(state, perm);
}

// Pure SBA pass
export function applyStateBasedActions(state: Readonly<GameState>): EngineSBAResult {
  const updates: EngineCounterUpdate[] = [];
  const battlefieldPermanents = state.battlefield as readonly BattlefieldPermanent[];

  for (const perm of battlefieldPermanents) {
    const normalized = normalizeCounters(perm.counters);
    if (!countersEqual(perm.counters, normalized)) {
      updates.push({ permanentId: perm.id, counters: normalized });
    }
  }

  const destroys: string[] = [];

  const pushDestroy = (id: string | undefined) => {
    const permanentId = String(id || '').trim();
    if (permanentId && !destroys.includes(permanentId)) {
      destroys.push(permanentId);
    }
  };

  const collectIllegalAuraDestroys = () => {
    // CR 704.5m / 704.5n: Aura not attached to a legal object/player is put into its owner's graveyard.
    for (const perm of battlefieldPermanents) {
      const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
      const isAura = typeLine.includes('enchantment') && typeLine.includes('aura');
      if (!isAura) continue;

      // Enchantment creatures (Bestow, Reconfigure) can exist unattached.
      const isEnchantmentCreature = typeLine.includes('creature');
      if (isEnchantmentCreature) continue;

      const attachedTo = String((perm as any).attachedTo || '').trim();
      if (!attachedTo) {
        pushDestroy(perm.id);
        continue;
      }
      const targetExists = battlefieldPermanents.some((p) => p.id === attachedTo);
      if (!targetExists || destroys.includes(attachedTo)) {
        pushDestroy(perm.id);
      }
    }
  };
  
  // CR 704.5f: If a creature has toughness 0 or less, it's put into its owner's graveyard.
  // This is NOT destruction (Rule 702.12b) - it happens regardless of indestructible
  // CR 704.5g: If a creature has toughness greater than 0, and it has been dealt damage equal to
  // or greater than its toughness, that creature has been dealt lethal damage and is destroyed.
  // Rule 702.12b: Indestructible creatures are NOT destroyed by lethal damage.
  for (const perm of battlefieldPermanents) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    const totalToughness = getEffectiveStatsForSBA(state, perm).toughness;
    if (!isNumber(totalToughness)) continue;
    
    // Get damage
    // Largest of all mirrored damage fields: a stale damage:0 from cleanup must not hide combat damage.
    const damage = getMarkedDamage(perm);
    
    // CR 704.5f: 0 or less toughness - NOT destruction, ignores indestructible
    if (totalToughness <= 0) {
      pushDestroy(perm.id);
      continue;
    }
    
    // CR 704.5g: Lethal damage - IS destruction, respects indestructible.
    // Deathtouch (702.2c): any damage from a deathtouch source counts as lethal.
    const hasLethalMarkedDamage =
      damage >= totalToughness
      || (damage > 0 && permanentHasDeathtouchDamageMarked(perm));

    if (hasLethalMarkedDamage) {
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

      const isIndestructible = permanentHasIndestructible(state, perm);
      if (!isIndestructible) {
        pushDestroy(perm.id);
      }
    }
  }

  // CR 704.5i: If a planeswalker has loyalty 0, it's put into its owner's graveyard.
  for (const perm of battlefieldPermanents) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    if (!typeLine.includes('planeswalker')) continue;
    
    // Get current loyalty from counters
    const loyalty = (perm as any).counters?.loyalty ?? 0;
    
    if (loyalty <= 0) {
      pushDestroy(perm.id);
    }
  }

  collectIllegalAuraDestroys();
  
  // CR 704.5j: Legend Rule - If a player controls two or more legendary permanents
  // with the same name, that player chooses one of them, and the rest are put into
  // their owners' graveyards. This is called the "legend rule."
  // Note: This function returns which permanents NEED a choice, the actual choice
  // is handled by the caller (runSBA) via ResolutionQueueManager
  const legendaryByControllerAndName = new Map<string, BattlefieldPermanent[]>();
  
  for (const perm of battlefieldPermanents) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    // Check for "legendary" supertype on any permanent (creatures, planeswalkers, lands, …)
    if (!typeLine.includes('legendary')) continue;
    
    // The legend rule is based on control, not ownership. Battlefield replay can
    // retain owner-only shells for permanents that have already left play; those
    // must not be treated as permanents the owner still controls.
    const controller = (perm as any).controller || '';
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