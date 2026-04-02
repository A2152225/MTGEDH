/**
 * triggers/damage-received.ts
 * 
 * Centralized damage-received trigger system.
 * Handles "whenever [this creature/enchanted creature/equipped creature] is dealt damage" triggers.
 * 
 * This module provides a scalable, dynamic solution that works for:
 * - Combat damage (attackers, blockers)
 * - Fight abilities
 * - Spell damage (Lightning Bolt, Fireball, etc.)
 * - Ability damage (Prodigal Pyromancer, etc.)
 * 
 * Cards supported:
 * - Brash Taunter: "Whenever this creature is dealt damage, it deals that much damage to target opponent."
 * - Boros Reckoner: "Whenever Boros Reckoner is dealt damage, it deals that much damage to any target."
 * - Blazing Sunsteel: "Whenever equipped creature is dealt damage, it deals that much damage to any target."
 * - And many more similar cards
 */

import type { GameContext } from "../../context.js";
import { KNOWN_DAMAGE_RECEIVED_TRIGGERS, KNOWN_DAMAGE_RECEIVED_AURAS, KNOWN_DAMAGE_RECEIVED_EQUIPMENT } from "./card-data-tables.js";
import { isInterveningIfSatisfied } from "./intervening-if.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import { processLifeChange } from "../game-state-effects.js";
import { triggerLifeGainEffects } from "../../utils.js";
import { applyDamageToPermanentWithCounterEffects } from "../counter-common-effects.js";

function escapeRegex(text: string): string {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractDamageReceivedAbilityText(oracleText: string, creatureName: string): string | null {
  const raw = String(oracleText || "");
  const nameEscaped = escapeRegex(String(creatureName || ""));

  const pattern = new RegExp(
    `(whenever\\s+(?:this creature|${nameEscaped}|enchanted creature|equipped creature)\\s+is\\s+dealt\\s+(?:combat\\s+)?damage[^.]*)(?:\\.|$)`,
    "i"
  );

  const m = raw.match(pattern);
  if (!m) return null;
  return String(m[1] || "").trim();
}

/**
 * Information about a damage trigger that needs target selection
 */
export interface DamageTriggerInfo {
  triggerId: string;
  sourceId: string;
  sourceName: string;
  controller: string;
  damageAmount: number;
  triggerType: 'dealt_damage';
  targetType: 'opponent' | 'any' | 'each_opponent' | 'any_non_dragon' | 'controller' | 'chosen_player' | 'opponent_or_planeswalker' | 'none';
  targetRestriction?: string;
  effect: string;
  effectMode?: 'gain_life' | 'gain_life_and_attacking_player_loses_life';
  attackingPlayerId?: string;
}

/**
 * Check if a permanent has a damage-received trigger.
 * Checks both the permanent's own oracle text and any granted triggers from attachments.
 * 
 * @param permanent The permanent that was dealt damage
 * @param state Game state
 * @returns Trigger info if found, null otherwise
 */
export function getDamageReceivedTrigger(
  permanent: any,
  state: any
): { controllerId: string; targetType: string; effect: string; targetRestriction?: string; oracleTextForInterveningIf?: string; effectMode?: 'gain_life' | 'gain_life_and_attacking_player_loses_life' } | null {
  if (!permanent) return null;

  const card = permanent.card || {};
  const oracleText = (card.oracle_text || "").toLowerCase();
  const creatureName = (card.name || "").toLowerCase();
  const oracleTextForInterveningIf = extractDamageReceivedAbilityText(card.oracle_text || "", card.name || "") || (card.oracle_text || "");

  // Check known cards table first (for optimization)
  if (KNOWN_DAMAGE_RECEIVED_TRIGGERS[creatureName]) {
    const triggerInfo = KNOWN_DAMAGE_RECEIVED_TRIGGERS[creatureName];
    return {
      controllerId: permanent.controller,
      targetType: triggerInfo.targetType,
      effect: triggerInfo.effect,
      effectMode: triggerInfo.effectMode,
      oracleTextForInterveningIf,
    };
  }

  // Check if this permanent has attachments that grant damage-received triggers
  if (permanent.attachments && permanent.attachments.length > 0) {
    for (const attachmentId of permanent.attachments) {
      const attachment = state.battlefield?.find((p: any) => p.id === attachmentId);
      if (attachment) {
        const attachmentName = (attachment.card?.name || "").toLowerCase();
        
        if (KNOWN_DAMAGE_RECEIVED_AURAS[attachmentName]) {
          const triggerInfo = KNOWN_DAMAGE_RECEIVED_AURAS[attachmentName];
          return {
            controllerId: attachment.controller || permanent.controller,
            targetType: triggerInfo.targetType,
            effect: triggerInfo.effect,
            effectMode: triggerInfo.effectMode,
            oracleTextForInterveningIf:
              extractDamageReceivedAbilityText(attachment.card?.oracle_text || "", attachment.card?.name || "") ||
              (attachment.card?.oracle_text || ""),
          };
        }
        
        if (KNOWN_DAMAGE_RECEIVED_EQUIPMENT[attachmentName]) {
          const triggerInfo = KNOWN_DAMAGE_RECEIVED_EQUIPMENT[attachmentName];
          return {
            controllerId: attachment.controller || permanent.controller,
            targetType: triggerInfo.targetType,
            effect: triggerInfo.effect,
            effectMode: triggerInfo.effectMode,
            oracleTextForInterveningIf:
              extractDamageReceivedAbilityText(attachment.card?.oracle_text || "", attachment.card?.name || "") ||
              (attachment.card?.oracle_text || ""),
          };
        }
      }
    }
  }

  // Dynamic pattern matching for unknown cards
  // Pattern: "Whenever this creature is dealt damage/combat damage" or "Whenever ~ is dealt damage/combat damage"
  if (oracleText.includes("whenever this creature is dealt damage") ||
      oracleText.includes("whenever this creature is dealt combat damage") ||
      oracleText.includes(`whenever ${creatureName} is dealt damage`) ||
      oracleText.includes(`whenever ${creatureName} is dealt combat damage`) ||
      oracleText.includes("whenever enchanted creature is dealt damage") ||
      oracleText.includes("whenever enchanted creature is dealt combat damage") ||
      oracleText.includes("whenever equipped creature is dealt damage") ||
      oracleText.includes("whenever equipped creature is dealt combat damage")) {
    
    // Determine target type from oracle text
    let targetType = 'any'; // Default to any target
    let targetRestriction = '';
    let effectMode: 'gain_life' | 'gain_life_and_attacking_player_loses_life' | undefined;

    if (oracleText.includes("you gain that much life and attacking player loses that much life")) {
      targetType = 'none';
      effectMode = 'gain_life_and_attacking_player_loses_life';
    } else if (oracleText.includes("you gain that much life")) {
      targetType = 'none';
      effectMode = 'gain_life';
    }
    
    if (targetType !== 'none' && oracleText.includes("target opponent or planeswalker")) {
      targetType = 'opponent_or_planeswalker';
      targetRestriction = 'opponent or planeswalker';
    } else if (targetType !== 'none' && oracleText.includes("target opponent")) {
      targetType = 'opponent';
      targetRestriction = 'opponent';
    } else if (targetType !== 'none' && oracleText.includes("each opponent")) {
      targetType = 'each_opponent';
      targetRestriction = 'each opponent';
    } else if (targetType !== 'none' && oracleText.includes("any target that isn't a dragon")) {
      targetType = 'any_non_dragon';
      targetRestriction = "that isn't a Dragon";
    } else if (targetType !== 'none' && oracleText.includes("the chosen player")) {
      targetType = 'chosen_player';
      targetRestriction = 'chosen player';
    } else if (targetType !== 'none' && oracleText.includes("target player")) {
      targetType = 'any';
      targetRestriction = 'player';
    }
    
    // Extract effect description
    let effect = "Deals that much damage to target";
    if (effectMode === 'gain_life_and_attacking_player_loses_life') {
      effect = 'You gain that much life and attacking player loses that much life';
    } else if (effectMode === 'gain_life') {
      effect = 'You gain that much life';
    } else if (oracleText.includes("deals that much damage to")) {
      const match = oracleText.match(/deals that much damage to ([^.]+)/);
      if (match) {
        effect = `Deals that much damage to ${match[1]}`;
      }
    }
    
    return {
      controllerId: permanent.controller,
      targetType,
      effect,
      effectMode,
      targetRestriction,
      oracleTextForInterveningIf,
    };
  }

  return null;
}

/**
 * Process damage dealt to a permanent and check for damage-received triggers.
 * This is the main entry point called from combat, spells, abilities, etc.
 * 
 * @param ctx Game context
 * @param permanent The permanent that was dealt damage
 * @param damageAmount Amount of damage dealt
 * @param onTriggerDetected Callback when a trigger is detected (for queueing/emitting to client)
 */
export function processDamageReceivedTriggers(
  ctx: GameContext,
  permanent: any,
  damageAmount: number,
  onTriggerDetected: (triggerInfo: DamageTriggerInfo) => void
): void {
  if (!permanent || damageAmount <= 0) return;

  const state = (ctx as any).state;
  const triggerInfo = getDamageReceivedTrigger(permanent, state);
  
  if (!triggerInfo) return;

  // Intervening-if (Rule 603.4): if the condition is recognized and false at trigger time,
  // the ability does not trigger and must not be queued.
  try {
    const controllerId = String(triggerInfo.controllerId || permanent.controller || "");
    const text = String(triggerInfo.oracleTextForInterveningIf || "").trim();
    const ok = isInterveningIfSatisfied(ctx, controllerId, text, permanent);
    if (ok === false) return;
  } catch {
    // Conservative fallback: keep the trigger if evaluation fails.
  }

  const card = permanent.card || {};
  const creatureName = card.name || "Unknown";
  const triggerId = `damage_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const phase = String(state?.phase || '').toLowerCase();
  const attackingPlayerId = triggerInfo.effectMode === 'gain_life_and_attacking_player_loses_life' && phase === 'combat'
    ? String(state?.activePlayer || state?.turnPlayer || '') || undefined
    : undefined;

  // Create trigger info
  const damageTrigger: DamageTriggerInfo = {
    triggerId,
    sourceId: permanent.id,
    sourceName: creatureName,
    controller: triggerInfo.controllerId || permanent.controller,
    damageAmount,
    triggerType: 'dealt_damage',
    targetType: triggerInfo.targetType as any,
    targetRestriction: triggerInfo.targetRestriction,
    effect: triggerInfo.effect,
    effectMode: triggerInfo.effectMode,
    attackingPlayerId,
  };

  // Call the callback to handle queueing and client notification
  onTriggerDetected(damageTrigger);
}

function syncPlayerLife(state: any, playerId: string, lifeTotal: number): void {
  state.life = state.life || {};
  state.life[playerId] = lifeTotal;

  const player = (Array.isArray(state.players) ? state.players : []).find((entry: any) => String(entry?.id) === String(playerId));
  if (player) {
    player.life = lifeTotal;
  }
}

function applyAutomaticLifeChange(
  ctx: GameContext,
  playerId: string,
  amount: number,
  isGain: boolean,
): number {
  const numericAmount = Math.max(0, Number(amount || 0));
  if (!playerId || numericAmount <= 0) return 0;

  const stateAny = (ctx as any).state as any;
  const startingLife = Number(stateAny?.startingLife ?? 40);
  const currentLife = Number(stateAny?.life?.[playerId] ?? startingLife);
  const result = processLifeChange(ctx, playerId, numericAmount, isGain);
  if (result.prevented || Number(result.finalAmount || 0) === 0) {
    return 0;
  }

  if (isGain) {
    const finalAmount = Number(result.finalAmount || 0);
    syncPlayerLife(stateAny, playerId, currentLife + finalAmount);
    try {
      stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
      stateAny.lifeGainedThisTurn[playerId] = (stateAny.lifeGainedThisTurn[playerId] || 0) + finalAmount;
      triggerLifeGainEffects(stateAny, playerId, finalAmount);
    } catch {
      // best-effort bookkeeping only
    }
    return finalAmount;
  }

  const finalAmount = Math.max(0, Number(result.finalAmount || 0));
  syncPlayerLife(stateAny, playerId, currentLife - finalAmount);
  try {
    stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
    stateAny.lifeLostThisTurn[playerId] = (stateAny.lifeLostThisTurn[playerId] || 0) + finalAmount;
  } catch {
    // best-effort bookkeeping only
  }
  return -finalAmount;
}

function addDamageTriggerPlayerTargets(validTargets: any[], players: any[], predicate: (player: any) => boolean): void {
  for (const player of players) {
    if (!player?.id || !predicate(player)) continue;
    validTargets.push({
      id: String(player.id),
      label: String(player.name || player.id),
      description: 'player',
    });
  }
}

function addDamageTriggerPermanentTargets(validTargets: any[], battlefield: any[], predicate: (perm: any, typeLineLower: string) => boolean): void {
  for (const perm of battlefield) {
    if (!perm?.id || !perm?.card) continue;
    const typeLine = String(perm.card?.type_line || 'permanent');
    const typeLineLower = typeLine.toLowerCase();
    if (!predicate(perm, typeLineLower)) continue;
    validTargets.push({
      id: String(perm.id),
      label: String(perm.card?.name || 'Permanent'),
      description: typeLine,
      imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
    });
  }
}

export function dispatchDamageReceivedTrigger(ctx: GameContext, triggerInfo: DamageTriggerInfo): boolean {
  const state = (ctx as any).state as any;
  const gameId = String((ctx as any).gameId || '').trim();
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];
  const sourcePerm = battlefield.find((perm: any) => String(perm?.id) === String(triggerInfo.sourceId || ''));
  const controllerId = String(triggerInfo.controller || '');
  const damageAmount = Math.max(0, Number(triggerInfo.damageAmount || 0));
  const targetType = String(triggerInfo.targetType || 'any');
  const targetRestriction = String(triggerInfo.targetRestriction || '');

  if (!controllerId || damageAmount <= 0) return false;

  if (targetType === 'none' && String(triggerInfo.effectMode || '') === 'gain_life') {
    applyAutomaticLifeChange(ctx, controllerId, damageAmount, true);
    return true;
  }

  if (targetType === 'none' && String(triggerInfo.effectMode || '') === 'gain_life_and_attacking_player_loses_life') {
    const attackerId = String(triggerInfo.attackingPlayerId || state?.activePlayer || state?.turnPlayer || '');
    applyAutomaticLifeChange(ctx, controllerId, damageAmount, true);
    if (attackerId) {
      applyAutomaticLifeChange(ctx, attackerId, damageAmount, false);
    }
    return true;
  }

  if (targetType === 'each_opponent') {
    resolveDamageTrigger(ctx, triggerInfo);
    return true;
  }

  if (!gameId) return false;

  const validTargets: any[] = [];
  let targetDescription = 'any target';
  let targetTypes: string[] = ['any_target'];

  if (targetType === 'opponent') {
    targetDescription = 'target opponent';
    targetTypes = ['player'];
    addDamageTriggerPlayerTargets(validTargets, players, player => String(player.id) !== controllerId);
  } else if (targetType === 'opponent_or_planeswalker') {
    targetDescription = 'target opponent or planeswalker';
    targetTypes = ['player', 'planeswalker'];
    addDamageTriggerPlayerTargets(validTargets, players, player => String(player.id) !== controllerId);
    addDamageTriggerPermanentTargets(validTargets, battlefield, (_perm, typeLineLower) => typeLineLower.includes('planeswalker'));
  } else if (targetType === 'controller') {
    targetDescription = 'you';
    targetTypes = ['player'];
    addDamageTriggerPlayerTargets(validTargets, players, player => String(player.id) === controllerId);
  } else if (targetType === 'any_non_dragon') {
    targetDescription = "any target that isn't a Dragon";
    targetTypes = ['any_target'];
    addDamageTriggerPlayerTargets(validTargets, players, _player => true);
    addDamageTriggerPermanentTargets(validTargets, battlefield, (_perm, typeLineLower) => {
      const isTargetKind = typeLineLower.includes('creature') || typeLineLower.includes('planeswalker');
      return isTargetKind && !typeLineLower.includes('dragon');
    });
  } else {
    addDamageTriggerPlayerTargets(validTargets, players, _player => true);
    addDamageTriggerPermanentTargets(validTargets, battlefield, (_perm, typeLineLower) => typeLineLower.includes('creature') || typeLineLower.includes('planeswalker'));
  }

  if (validTargets.length === 0) {
    return true;
  }

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: controllerId as any,
    sourceId: String(triggerInfo.sourceId || ''),
    sourceName: String(triggerInfo.sourceName || 'Damage Trigger'),
    sourceImage: sourcePerm?.card?.image_uris?.small || sourcePerm?.card?.image_uris?.normal,
    description: `${triggerInfo.sourceName} was dealt ${damageAmount} damage. Choose a target to deal ${damageAmount} damage to${targetRestriction ? ` (${targetRestriction})` : ''}.`,
    mandatory: true,
    validTargets,
    targetTypes,
    minTargets: 1,
    maxTargets: 1,
    targetDescription,
    damageReceivedTrigger: true,
    damageTrigger: {
      triggerId: String(triggerInfo.triggerId || ''),
      sourceId: String(triggerInfo.sourceId || ''),
      sourceName: String(triggerInfo.sourceName || ''),
      controller: controllerId,
      damageAmount,
      triggerType: 'dealt_damage',
      targetType,
      targetRestriction,
    },
  } as any);

  return true;
}

/**
 * Resolve a damage trigger by dealing damage to the selected target(s).
 * Called when player selects a target for the damage trigger.
 * 
 * @param ctx Game context
 * @param triggerInfo The trigger information
 * @param targetId The selected target (player ID, permanent ID, or null for "each opponent")
 * @returns Chat message describing what happened
 */
export function resolveDamageTrigger(
  ctx: GameContext,
  triggerInfo: DamageTriggerInfo,
  targetId?: string
): string {
  const state = (ctx as any).state;
  const life = state.life || {};
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const dmg = Math.max(0, Number(triggerInfo.damageAmount ?? 0));
  const sourceId = String(triggerInfo.sourceId || '');
  const sourcePerm = sourceId ? battlefield.find((p: any) => String(p?.id) === sourceId) : null;
  const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
  const isSourceCreature = !!(sourcePerm && sourceTL.includes('creature'));
  
  // Handle "each opponent" targeting
  if (triggerInfo.targetType === 'each_opponent') {
    const controller = triggerInfo.controller;
    const opponents = Object.keys(life).filter(pid => pid !== controller);
    
    for (const opponentId of opponents) {
      life[opponentId] = (life[opponentId] || 40) - dmg;

      // Track per-turn damage/life-loss for intervening-if and other rules.
      try {
        state.damageTakenThisTurnByPlayer = state.damageTakenThisTurnByPlayer || {};
        state.damageTakenThisTurnByPlayer[String(opponentId)] =
          (state.damageTakenThisTurnByPlayer[String(opponentId)] || 0) + dmg;
      } catch {}
      try {
        state.lifeLostThisTurn = state.lifeLostThisTurn || {};
        state.lifeLostThisTurn[String(opponentId)] = (state.lifeLostThisTurn[String(opponentId)] || 0) + dmg;
      } catch {}
      try {
        if (isSourceCreature && sourceId) {
          state.creaturesThatDealtDamageToPlayer = state.creaturesThatDealtDamageToPlayer || {};
          const perPlayer = ((state.creaturesThatDealtDamageToPlayer[String(opponentId)] =
            state.creaturesThatDealtDamageToPlayer[String(opponentId)] || {}) as any);
          perPlayer[sourceId] = {
            creatureName: String(sourcePerm?.card?.name || triggerInfo.sourceName || sourceId),
            totalDamage: (perPlayer[sourceId]?.totalDamage || 0) + dmg,
            lastDamageTime: Date.now(),
          };
        }
      } catch {}
    }
    
    return `${triggerInfo.sourceName} dealt ${dmg} damage to each opponent.`;
  }
  
  // Handle single target
  if (!targetId) {
    return `${triggerInfo.sourceName} trigger failed - no target selected.`;
  }
  
  // Check if target is a player
  if (life.hasOwnProperty(targetId)) {
    life[targetId] = (life[targetId] || 40) - dmg;

    // Track per-turn damage/life-loss for intervening-if and other rules.
    try {
      state.damageTakenThisTurnByPlayer = state.damageTakenThisTurnByPlayer || {};
      state.damageTakenThisTurnByPlayer[String(targetId)] = (state.damageTakenThisTurnByPlayer[String(targetId)] || 0) + dmg;
    } catch {}
    try {
      state.lifeLostThisTurn = state.lifeLostThisTurn || {};
      state.lifeLostThisTurn[String(targetId)] = (state.lifeLostThisTurn[String(targetId)] || 0) + dmg;
    } catch {}
    try {
      if (isSourceCreature && sourceId) {
        state.creaturesThatDealtDamageToPlayer = state.creaturesThatDealtDamageToPlayer || {};
        const perPlayer = ((state.creaturesThatDealtDamageToPlayer[String(targetId)] =
          state.creaturesThatDealtDamageToPlayer[String(targetId)] || {}) as any);
        perPlayer[sourceId] = {
          creatureName: String(sourcePerm?.card?.name || triggerInfo.sourceName || sourceId),
          totalDamage: (perPlayer[sourceId]?.totalDamage || 0) + dmg,
          lastDamageTime: Date.now(),
        };
      }
    } catch {}

    return `${triggerInfo.sourceName} dealt ${dmg} damage to player.`;
  }
  
  // Check if target is a permanent (planeswalker, creature, etc.)
  const targetPerm = state.battlefield?.find((p: any) => p.id === targetId);
  if (targetPerm) {
    // Mark damage on the permanent
    const damageResult = applyDamageToPermanentWithCounterEffects(targetPerm, dmg, 'damageMarked');
    if (damageResult.prevented) {
      return `${triggerInfo.sourceName} damage to ${targetPerm.card?.name || 'target'} was prevented.`;
    }
    
    const targetName = targetPerm.card?.name || "target";
    return `${triggerInfo.sourceName} dealt ${dmg} damage to ${targetName}.`;
  }
  
  return `${triggerInfo.sourceName} dealt ${triggerInfo.damageAmount} damage.`;
}
