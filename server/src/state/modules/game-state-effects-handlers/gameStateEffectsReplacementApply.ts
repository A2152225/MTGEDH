// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: ReplacementEffect types, 616.1 order helpers, applyBeneficial /
// applyDamage / applyCustomOrder, detect*ReplacementEffects, applyCounter /
// applyLifeGain / applyMill / applyTokenCreation replacements.
// Public entry symbols: ReplacementEffectType, ReplacementEffect,
// ReplacementEffectOrderPreference, applyBeneficialReplacements,
// applyDamageReplacementsMinimized, applyDamageReplacementsMaximized,
// applyReplacementsCustomOrder, detectDamageReplacementEffects,
// detectCounterReplacementEffects, detectLifeGainReplacementEffects,
// detectTokenCreationReplacementEffects, applyCounterReplacements,
// applyLifeGainReplacements, detectLifeLossReplacementEffects, applyLifeLossReplacements, detectMillReplacementEffects,
// applyMillReplacements, applyTokenCreationReplacements.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import {
  collectOraclePatternDamageReplacementSpecsFromState,
  collectOraclePatternLifeFloorDamageReplacementSpecsFromState,
  collectOraclePatternLifeGainReplacementSpecsFromState,
  collectOraclePatternTokenReplacementSpecsFromState,
  collectOraclePatternCounterReplacementSpecsFromState,
  collectReplacementEffectSpecsFromState,
  overlayReplacementSpecToEffect,
  overlaySpecsMatchDamage,
  overlaySpecsMatchLifeGain,
  overlaySpecsMatchTokenCreation,
  overlaySpecsMatchCounterPlacement,
  overlaySpecsMatchMill,
} from "../replacementEffectSpec.js";
import {
  collectOraclePatternLifeLossReplacementSpecsFromState,
  overlaySpecsMatchLifeLoss,
} from "../replacementEffectSpec-handlers/replacementEffectSpecLifeLossOracleTemplates.js";

/**
 * Replacement Effect Ordering System
 * 
 * MTG Rule 616.1: If two or more replacement effects would apply to a single event,
 * the affected object's controller (or its owner if it has no controller) or
 * the affected player chooses one to apply first.
 * 
 * OPTIMIZATION RULES FOR AUTOMATED ORDERING:
 * 
 * For BENEFICIAL effects (gaining life, counters, tokens, creature P/T):
 * - Apply +1 (singular increase) effects BEFORE doublers
 * - This maximizes the final value: (X + 1) * 2 > (X * 2) + 1
 * - Example: 3 life with Leyline of Hope (+1) and Boon Reflection (double)
 *   - Optimal: (3 + 1) * 2 = 8 life
 *   - Suboptimal: (3 * 2) + 1 = 7 life
 * 
 * For HARMFUL effects (receiving damage):
 * - The receiver chooses to MINIMIZE damage
 * - Apply doublers BEFORE +1 effects: (X * 2) + 1 < (X + 1) * 2
 * - Apply halving effects strategically:
 *   - If you can reduce to 0 with -1 effects, apply those first
 *   - Otherwise, halving should typically go first (Gisela)
 */

export type ReplacementEffectType = 
  | 'add_flat'      // +1, +2, etc.
  | 'double'        // *2
  | 'triple'        // *3
  | 'halve'         // /2 (rounded down)
  | 'halve_round_up' // /2 (rounded up, like Gisela's prevention)
  | 'prevent'       // Set to 0
  | 'cap';          // Prevent all but N (Temple Altisaur family)

export interface ReplacementEffect {
  type: ReplacementEffectType;
  value?: number;     // For 'add_flat' type
  source: string;     // Card name that provides this effect
  controllerId?: string; // Who controls the source
}

type ReplacementEffectPreferenceState = {
  /**
   * Stored on game state as player preference.
   * Currently used as a simple override toggle, and optionally with a custom order list.
   */
  mode?: 'minimize' | 'maximize' | 'custom' | 'auto';
  useCustomOrder?: boolean;
  /** Optional explicit custom order by source name. */
  customOrder?: string[];
};

export function getReplacementEffectMode(
  pref: ReplacementEffectPreferenceState | null,
  effectType: 'damage' | 'life_gain' | 'counters' | 'tokens'
): 'minimize' | 'maximize' | 'custom' | 'auto' {
  if (pref?.mode) return pref.mode;

  // Back-compat: older state stored only a boolean toggle.
  if (effectType === 'damage') {
    return pref?.useCustomOrder ? 'maximize' : 'minimize';
  }
  return pref?.useCustomOrder ? 'custom' : 'auto';
}

export function getReplacementEffectPreference(
  ctx: GameContext,
  playerId: string,
  effectType: 'damage' | 'life_gain' | 'counters' | 'tokens'
): ReplacementEffectPreferenceState | null {
  const prefs = (ctx.state as any)?.replacementEffectPreferences?.[playerId];
  const pref = prefs?.[effectType];
  return pref && typeof pref === 'object' ? (pref as ReplacementEffectPreferenceState) : null;
}

export function sortEffectsByCustomOrder(
  effects: ReplacementEffect[],
  customOrder: string[]
): ReplacementEffect[] {
  const orderIndex = new Map<string, number>();
  for (let i = 0; i < customOrder.length; i++) {
    orderIndex.set(String(customOrder[i]), i);
  }

  // Stable-ish ordering: known entries first in the specified order, then the rest.
  return [...effects].sort((a, b) => {
    const ai = orderIndex.has(a.source) ? (orderIndex.get(a.source) as number) : Number.POSITIVE_INFINITY;
    const bi = orderIndex.has(b.source) ? (orderIndex.get(b.source) as number) : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return String(a.source).localeCompare(String(b.source));
  });
}

/**
 * Apply replacement effects in optimal order for BENEFICIAL outcomes.
 * Used for: life gain, counter gain, token creation, power/toughness buffs.
 * 
 * Order: add_flat -> double -> triple
 * This maximizes the final value.
 * 
 * @param baseAmount - Starting amount before any replacements
 * @param effects - Array of replacement effects to apply
 * @returns { finalAmount, appliedEffects } - Result and description of what was applied
 */
export function applyBeneficialReplacements(
  baseAmount: number,
  effects: ReplacementEffect[]
): { finalAmount: number; appliedEffects: string[] } {
  const appliedEffects: string[] = [];
  let amount = baseAmount;
  
  // Sort effects to maximize the final value.
  // Note: halving/prevention are generally harmful, so apply them last.
  const sortedEffects = [...effects].sort((a, b) => {
    const order: Record<ReplacementEffectType, number> = {
      'cap': 0,            // Cap first so remaining N can still be doubled
      'add_flat': 1,
      'double': 2,
      'triple': 3,
      'halve_round_up': 4,
      'halve': 5,
      'prevent': 6,
    };
    return (order[a.type] || 99) - (order[b.type] || 99);
  });
  
  for (const effect of sortedEffects) {
    const before = amount;
    switch (effect.type) {
      case 'add_flat':
        amount += effect.value || 1;
        appliedEffects.push(`${effect.source}: +${effect.value || 1} (${before} -> ${amount})`);
        break;
      case 'double':
        amount *= 2;
        appliedEffects.push(`${effect.source}: doubled (${before} -> ${amount})`);
        break;
      case 'triple':
        amount *= 3;
        appliedEffects.push(`${effect.source}: tripled (${before} -> ${amount})`);
        break;
      case 'halve':
        amount = Math.floor(amount / 2);
        appliedEffects.push(`${effect.source}: halved (${before} -> ${amount})`);
        break;
      case 'halve_round_up':
        amount = Math.ceil(amount / 2);
        appliedEffects.push(`${effect.source}: halved rounded up (${before} -> ${amount})`);
        break;
      case 'prevent':
        amount = 0;
        appliedEffects.push(`${effect.source}: prevented (${before} -> 0)`);
        break;
      case 'cap': {
        const cap = Math.max(0, Number(effect.value ?? 1));
        amount = Math.min(amount, cap);
        appliedEffects.push(`${effect.source}: prevent all but ${cap} (${before} -> ${amount})`);
        break;
      }
    }
  }
  
  return { finalAmount: Math.max(0, amount), appliedEffects };
}

/**
 * Apply replacement effects in optimal order for MINIMIZING HARMFUL outcomes.
 * Used for: damage received by a player.
 * 
 * Order strategy to minimize damage:
 * 1. Check if we can reduce to 0 with prevention or enough -1 effects
 * 2. Otherwise: halve first -> double -> add_flat -> triple
 * 
 * The receiver chooses order to minimize final damage.
 * 
 * @param baseAmount - Starting damage amount
 * @param effects - Array of replacement effects to apply
 * @returns { finalAmount, appliedEffects } - Result and description of what was applied
 */
export function applyDamageReplacementsMinimized(
  baseAmount: number,
  effects: ReplacementEffect[]
): { finalAmount: number; appliedEffects: string[] } {
  const appliedEffects: string[] = [];
  let amount = baseAmount;
  
  // Check for prevention first
  const preventEffects = effects.filter(e => e.type === 'prevent');
  if (preventEffects.length > 0) {
    appliedEffects.push(`${preventEffects[0].source}: prevented (${amount} -> 0)`);
    return { finalAmount: 0, appliedEffects };
  }
  
  // Sort effects to minimize damage received:
  // Order: halve_round_up -> halve -> double -> triple -> add_flat
  // 
  // Mathematical reasoning for this order:
  // - Halving first applies to the base damage, then doublers multiply the halved amount
  //   Example: Base 10, halve then double: (10/2) * 2 = 10
  //            Base 10, double then halve: (10 * 2) / 2 = 10 (same result)
  // - Add_flat goes LAST so it's not multiplied by doublers/triplers
  //   Example: Base 10, +1 then double: (10 + 1) * 2 = 22
  //            Base 10, double then +1: (10 * 2) + 1 = 21 (better for receiver)
  // - Therefore: halve -> double/triple -> add_flat minimizes final damage
  const sortedEffects = [...effects].sort((a, b) => {
    const order: Record<ReplacementEffectType, number> = {
      'prevent': 0,        // Already handled above
      'halve_round_up': 1, // Halve first (Gisela's prevention style - rounded up means less damage)
      'halve': 2,          // Standard halving
      'double': 3,         // Doublers apply to halved amount
      'triple': 4,         // Triplers apply to halved amount
      'add_flat': 5,       // Add last so it's not multiplied
      'cap': 6,            // Cap last so doubled damage still becomes N
    };
    return (order[a.type] || 99) - (order[b.type] || 99);
  });
  
  for (const effect of sortedEffects) {
    const before = amount;
    switch (effect.type) {
      case 'add_flat':
        amount += effect.value || 1;
        appliedEffects.push(`${effect.source}: +${effect.value || 1} (${before} -> ${amount})`);
        break;
      case 'double':
        amount *= 2;
        appliedEffects.push(`${effect.source}: doubled (${before} -> ${amount})`);
        break;
      case 'triple':
        amount *= 3;
        appliedEffects.push(`${effect.source}: tripled (${before} -> ${amount})`);
        break;
      case 'halve':
        amount = Math.floor(amount / 2);
        appliedEffects.push(`${effect.source}: halved (${before} -> ${amount})`);
        break;
      case 'halve_round_up':
        amount = Math.ceil(amount / 2);
        appliedEffects.push(`${effect.source}: halved rounded up (${before} -> ${amount})`);
        break;
      case 'prevent':
        // Already handled above
        break;
      case 'cap': {
        const cap = Math.max(0, Number(effect.value ?? 1));
        amount = Math.min(amount, cap);
        appliedEffects.push(`${effect.source}: prevent all but ${cap} (${before} -> ${amount})`);
        break;
      }
    }
  }
  
  return { finalAmount: Math.max(0, amount), appliedEffects };
}

/**
 * Apply replacement effects in optimal order for MAXIMIZING DAMAGE TO OPPONENTS.
 * Used for: damage dealt by the attacker to opponents.
 * 
 * Order: add_flat -> double -> triple (maximize final damage)
 * 
 * @param baseAmount - Starting damage amount
 * @param effects - Array of replacement effects to apply
 * @returns { finalAmount, appliedEffects } - Result and description of what was applied
 */
export function applyDamageReplacementsMaximized(
  baseAmount: number,
  effects: ReplacementEffect[]
): { finalAmount: number; appliedEffects: string[] } {
  // For maximizing damage, use the same logic as beneficial replacements
  return applyBeneficialReplacements(baseAmount, effects);
}

/**
 * Apply replacement effects in a CUSTOM order specified by the player.
 * This allows players to override the default ordering when they want to
 * maximize or minimize effects for strategic reasons.
 * 
 * Use cases:
 * - Selfless Squire: Player wants to maximize incoming damage to gain counters
 * - Redirect effects: Player wants damage redirected to maximize the redirect
 * - Damage to creatures that gain benefits (Stuffy Doll, Brash Taunter)
 * 
 * @param baseAmount - Starting amount before any replacements
 * @param effects - Array of replacement effects to apply (already in desired order)
 * @returns { finalAmount, appliedEffects } - Result and description of what was applied
 */
export function applyReplacementsCustomOrder(
  baseAmount: number,
  effects: ReplacementEffect[]
): { finalAmount: number; appliedEffects: string[] } {
  const appliedEffects: string[] = [];
  let amount = baseAmount;
  
  // Apply effects in the exact order provided (no sorting)
  for (const effect of effects) {
    const before = amount;
    switch (effect.type) {
      case 'add_flat':
        amount += effect.value || 1;
        appliedEffects.push(`${effect.source}: +${effect.value || 1} (${before} -> ${amount})`);
        break;
      case 'double':
        amount *= 2;
        appliedEffects.push(`${effect.source}: doubled (${before} -> ${amount})`);
        break;
      case 'triple':
        amount *= 3;
        appliedEffects.push(`${effect.source}: tripled (${before} -> ${amount})`);
        break;
      case 'halve':
        amount = Math.floor(amount / 2);
        appliedEffects.push(`${effect.source}: halved (${before} -> ${amount})`);
        break;
      case 'halve_round_up':
        amount = Math.ceil(amount / 2);
        appliedEffects.push(`${effect.source}: halved rounded up (${before} -> ${amount})`);
        break;
      case 'prevent':
        amount = 0;
        appliedEffects.push(`${effect.source}: prevented (${before} -> 0)`);
        break;
      case 'cap': {
        const cap = Math.max(0, Number(effect.value ?? 1));
        amount = Math.min(amount, cap);
        appliedEffects.push(`${effect.source}: prevent all but ${cap} (${before} -> ${amount})`);
        break;
      }
    }
  }
  
  return { finalAmount: Math.max(0, amount), appliedEffects };
}

/**
 * Helper structure for storing player's custom replacement effect ordering preference.
 * This can be stored in game state to persist ordering choices during a game.
 */
export interface ReplacementEffectOrderPreference {
  playerId: string;
  effectType: 'damage' | 'life_gain' | 'counters' | 'tokens';
  useCustomOrder: boolean;
  customOrder?: string[];  // Source names in desired order
}

/**
 * Detect all damage replacement effects from the battlefield that apply to a specific damage event.
 * 
 * @param ctx - Game context
 * @param damageDealer - Player ID dealing the damage (controller of source)
 * @param damageReceiver - Player ID receiving the damage
 * @param isToOpponent - True if damage is being dealt TO an opponent
 * @returns Array of replacement effects that apply
 */
function readReplacementApplyPlayerLife(state: unknown, playerId: string): number {
  const pid = String(playerId || '');
  const lifeMap = (state as { life?: Record<string, unknown> })?.life;
  const fromMap = Number(lifeMap?.[pid]);
  if (Number.isFinite(fromMap)) return fromMap;
  const players = Array.isArray((state as { players?: unknown })?.players)
    ? (state as { players: Array<{ id?: string; life?: unknown }> }).players
    : [];
  const player = players.find((entry) => String(entry?.id || '') === pid);
  const fromPlayer = Number(player?.life);
  if (Number.isFinite(fromPlayer)) return fromPlayer;
  return Number((state as { startingLife?: unknown })?.startingLife || 40);
}

export function detectDamageReplacementEffects(
  ctx: GameContext,
  damageDealer: string,
  damageReceiver: string,
  isToOpponent: boolean,
  damageSourcePermanentId?: string,
  isCombatDamage?: boolean,
  targetPermanentId?: string,
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];

  // Oracle-pattern amount modifiers (Furnace / Dictate / Gisela / Angrath's / Emancipation / Torbran / Sound of Drums).
  const state = (ctx as any)?.state || ctx;
  const oracleSpecs = [
    ...collectOraclePatternDamageReplacementSpecsFromState(state),
    ...collectOraclePatternLifeFloorDamageReplacementSpecsFromState(state),
  ];
  for (const spec of oracleSpecs) {
    if (!overlaySpecsMatchDamage(
      spec,
      { damageDealer, damageReceiver, damageSourcePermanentId, isCombatDamage, targetPermanentId },
      state,
    )) continue;

    const floorLifeAt = Number(spec.instead?.floorLifeAt);
    if (Number.isFinite(floorLifeAt) && floorLifeAt > 0) {
      if (targetPermanentId) continue;
      if (spec.match?.requiresSourceControllerControlsCreature === true) {
        const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
          ? (state as { battlefield: unknown[] }).battlefield
          : [];
        const sourceController = String(spec.sourceController || '');
        const hasCreature = battlefield.some((perm) => {
          if (!perm || typeof perm !== 'object') return false;
          const record = perm as {
            controller?: string;
            phasedOut?: boolean;
            type_line?: string;
            card?: { type_line?: string };
          };
          if (record.phasedOut === true) return false;
          if (String(record.controller || '') !== sourceController) return false;
          const typeLine = String(record.card?.type_line || record.type_line || '').toLowerCase();
          return typeLine.includes('creature');
        });
        if (!hasCreature) continue;
      }
      const currentLife = readReplacementApplyPlayerLife(state, damageReceiver);
      const cap = Math.max(0, currentLife - Math.floor(floorLifeAt));
      effects.push({
        type: 'cap',
        value: cap,
        source: String(spec.sourceName || spec.effectId || spec.id || 'Replacement effect'),
        controllerId: spec.sourceController,
      });
      continue;
    }

    if (!spec.instead?.modify) continue;
    effects.push(overlayReplacementSpecToEffect(spec));
  }

  if (isCombatDamage && isToOpponent && damageSourcePermanentId) {
    const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
      ? (state as { battlefield: any[] }).battlefield
      : [];
    const sourcePerm = battlefield.find((perm) => perm && String(perm.id || '') === String(damageSourcePermanentId));
    const grants = Array.isArray(sourcePerm?.untilNextTurnGrants) ? sourcePerm.untilNextTurnGrants : [];
    if (grants.some((grant: any) => String(grant?.kind || '') === 'triple_combat_damage_to_opponents')) {
      effects.push({
        type: 'triple',
        source: String(grants.find((grant: any) => String(grant?.kind || '') === 'triple_combat_damage_to_opponents')?.sourceName || sourcePerm?.card?.name || 'Triple combat damage'),
        controllerId: String(sourcePerm?.controller || damageDealer),
      });
    }
  }

  return effects;
}

/**
 * Detect counter amount-modify replacements (Doubling Season / Hardened Scales / Primal Vigor).
 * Oracle-pattern specs only — no card-name routing.
 */
export function detectCounterReplacementEffects(
  ctx: GameContext,
  controllerId: string,
  counterType: string
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const state = (ctx as any)?.state || ctx;
  const specs = collectOraclePatternCounterReplacementSpecsFromState(state);
  for (const spec of specs) {
    if (!spec.instead?.modify) continue;
    if (!overlaySpecsMatchCounterPlacement(spec, { counterType, targetController: controllerId })) continue;
    effects.push(overlayReplacementSpecToEffect(spec));
  }
  return effects;
}

/**
 * Detect life gain amount-modify replacements (Boon Reflection / Leyline of Hope family).
 * Oracle-pattern specs only — no card-name routing.
 */
export function detectLifeGainReplacementEffects(
  ctx: GameContext,
  playerId: string
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const state = (ctx as any)?.state || ctx;
  const specs = collectOraclePatternLifeGainReplacementSpecsFromState(state);
  for (const spec of specs) {
    if (!spec.instead?.modify) continue;
    if (!overlaySpecsMatchLifeGain(spec, { playerId, state })) continue;
    effects.push(overlayReplacementSpecToEffect(spec));
  }
  return effects;
}

/**
 * Detect token creation amount-modify replacements (Anointed Procession / Primal Vigor / Ojer Taq).
 * Oracle-pattern specs only — no card-name routing.
 */
export function detectTokenCreationReplacementEffects(
  ctx: GameContext,
  controllerId: string
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const state = (ctx as any)?.state || ctx;
  const specs = collectOraclePatternTokenReplacementSpecsFromState(state);
  for (const spec of specs) {
    if (!spec.instead?.modify) continue;
    if (!overlaySpecsMatchTokenCreation(spec, { controllerId, state })) continue;
    effects.push(overlayReplacementSpecToEffect(spec));
  }
  return effects;
}

/**
 * Apply counter replacement effects in optimal order (beneficial).
 * Order: +1 effects first, then doublers (maximizes counters).
 */
export function applyCounterReplacements(
  ctx: GameContext,
  baseCount: number,
  controllerId: string,
  counterType: string
): { finalCount: number; appliedEffects: string[] } {
  const effects = detectCounterReplacementEffects(ctx, controllerId, counterType);
  const pref = getReplacementEffectPreference(ctx, controllerId, 'counters');
  const result = pref?.useCustomOrder && Array.isArray(pref.customOrder) && pref.customOrder.length > 0
    ? applyReplacementsCustomOrder(baseCount, sortEffectsByCustomOrder(effects, pref.customOrder))
    : applyBeneficialReplacements(baseCount, effects);
  return { finalCount: result.finalAmount, appliedEffects: result.appliedEffects };
}

/**
 * Apply life gain replacement effects in optimal order (beneficial).
 * Order: +1 effects first, then doublers (maximizes life gained).
 */
export function applyLifeGainReplacements(
  ctx: GameContext,
  baseAmount: number,
  playerId: string
): { finalAmount: number; appliedEffects: string[] } {
  const effects = detectLifeGainReplacementEffects(ctx, playerId);
  const pref = getReplacementEffectPreference(ctx, playerId, 'life_gain');
  if (pref?.useCustomOrder && Array.isArray(pref.customOrder) && pref.customOrder.length > 0) {
    return applyReplacementsCustomOrder(baseAmount, sortEffectsByCustomOrder(effects, pref.customOrder));
  }
  return applyBeneficialReplacements(baseAmount, effects);
}

/**
 * Detect life-loss amount-modify replacements (Bloodletter family).
 * Oracle-pattern specs only — no card-name routing.
 */
export function detectLifeLossReplacementEffects(
  ctx: GameContext,
  playerId: string
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const state = (ctx as any)?.state || ctx;
  const specs = collectOraclePatternLifeLossReplacementSpecsFromState(state);
  for (const spec of specs) {
    if (!spec.instead?.modify) continue;
    if (!overlaySpecsMatchLifeLoss(spec, { playerId, state })) continue;
    effects.push(overlayReplacementSpecToEffect(spec));
  }
  return effects;
}

/**
 * Apply life-loss amount-modify replacements (Bloodletter doubles).
 */
export function applyLifeLossReplacements(
  ctx: GameContext,
  baseAmount: number,
  playerId: string
): { finalAmount: number; appliedEffects: string[] } {
  const effects = detectLifeLossReplacementEffects(ctx, playerId);
  return applyBeneficialReplacements(baseAmount, effects);
}

/**
 * Detect mill replacement effects (Bruvac / Water Crystal family).
 * Oracle-pattern + overlay specs only — no card-name routing.
 */
export function detectMillReplacementEffects(
  ctx: GameContext,
  millingPlayerId: string,
  targetPlayerId: string
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const state = (ctx as any)?.state || ctx;
  for (const spec of collectReplacementEffectSpecsFromState(state)) {
    if (spec.event !== 'mill' || !spec.instead?.modify) continue;
    if (!overlaySpecsMatchMill(spec, { millingPlayerId, targetPlayerId })) continue;
    effects.push(overlayReplacementSpecToEffect(spec));
  }
  return effects;
}

/**
 * Apply mill replacement effects in optimal order (beneficial for the controller).
 * For mill effects that hurt opponents, we want to MAXIMIZE the mill amount.
 * Order: +N effects first, then doublers (maximizes mill).
 */
export function applyMillReplacements(
  ctx: GameContext,
  baseCount: number,
  millingPlayerId: string,
  targetPlayerId: string
): { finalCount: number; appliedEffects: string[] } {
  const effects = detectMillReplacementEffects(ctx, millingPlayerId, targetPlayerId);
  const result = applyBeneficialReplacements(baseCount, effects);
  return { finalCount: result.finalAmount, appliedEffects: result.appliedEffects };
}

/**
 * Apply token creation replacement effects in optimal order (beneficial).
 * Since there are no +1 token effects currently, this just applies doublers.
 */
export function applyTokenCreationReplacements(
  ctx: GameContext,
  baseCount: number,
  controllerId: string
): { finalCount: number; appliedEffects: string[] } {
  const effects = detectTokenCreationReplacementEffects(ctx, controllerId);
  const pref = getReplacementEffectPreference(ctx, controllerId, 'tokens');
  const result = pref?.useCustomOrder && Array.isArray(pref.customOrder) && pref.customOrder.length > 0
    ? applyReplacementsCustomOrder(baseCount, sortEffectsByCustomOrder(effects, pref.customOrder))
    : applyBeneficialReplacements(baseCount, effects);
  return { finalCount: result.finalAmount, appliedEffects: result.appliedEffects };
}
