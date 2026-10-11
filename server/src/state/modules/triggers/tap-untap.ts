/**
 * triggers/tap-untap.ts
 * 
 * Tap/untap trigger detection and processing.
 * Includes triggers that fire when permanents become tapped or untapped.
 * 
 * Categories:
 * - Tap triggers: detectTapTriggers, getTapTriggers
 * - Untap triggers: detectUntapTriggers, getAttackUntapTriggers, getCombatDamageUntapTriggers
 * - Untap execution: executeUntapTrigger
 */

import type { GameContext } from "../../context.js";
import { timingTriggerEffect } from './timing-effect-extraction.js';
import { appendEvent } from "../../../db/index.js";
import { KNOWN_UNTAP_TRIGGERS } from "./card-data-tables.js";
import { escapeCardNameForRegex } from "./types.js";
import { debug, debugWarn, debugError } from "../../../utils/debug.js";
import { uid } from "../../utils.js";
import { orderTriggersByAPNAP } from "./ordering.js";
import { permanentHasCreatureTypeNow } from '../../creatureTypeNow.js';
import { extractCreatureTypes as extractCreatureTypesFromTypeLine } from '../../../../../shared/src/creatureTypes.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from "./target-metadata.js";
import { detectTapTriggers, type TapTrigger } from "./tap-detection.js";
import { tapPermanentMatchesPhrase, collectMatchingParsedEventLines } from "./triggerConditionFamilyMatch.js";
import {
  recordFirstTimeEachTurnTriggerQueued,
  shouldSkipFirstTimeEachTurnTrigger,
} from "../triggerDoThisOnlyOnceEachTurn.js";

export { detectTapTriggers };
export type { TapTrigger };

// Re-export detectDoesntUntapEffects from turn-phases for backwards compatibility
export { detectDoesntUntapEffects } from "./turn-phases.js";

// ============================================================================
// Type Definitions
// ============================================================================

export interface UntapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerOn: 'attack' | 'combat_damage' | 'damage_to_player';
  untapType: 'lands' | 'all' | 'creatures';
  effect: string;
}

// TapTrigger lives in tap-detection.ts (leftover-merged).

export type TapTriggeredStackItem = {
  id: string;
  type: 'triggered_ability';
  controller: string;
  source: string;
  sourceName: string;
  description: string;
  effect: string;
  triggerType: 'tap' | 'untap';
  mandatory: boolean;
  triggeringPermanentId: string;
  reflexiveWhenYouDo?: { actor: 'you' | 'they'; effect: string; delayed?: { timing: string; effect: string } };
  delayedEndStep?: { timing: string; effect: string };
  card?: any;
  sourcePermanentSnapshot?: any;
  effectData?: {
    tappedPermanentId?: string;
    tappedPermanentName?: string;
    tappedPermanentController?: string;
    tappedPermanentTypeLine?: string;
    untappedPermanentId?: string;
    untappedPermanentName?: string;
    untappedPermanentController?: string;
    untappedPermanentTypeLine?: string;
    createsToken?: boolean;
    tokenDetails?: TapTrigger['tokenDetails'];
  };
};

export function buildTapTriggeredStackItem(
  trigger: TapTrigger,
  tappedPermanentId: string,
  triggerId: string,
  tappedPermanent?: any,
  sourcePermanent?: any,
): TapTriggeredStackItem {
  const sourcePermanentSnapshot = snapshotPermanentForTapUntapTrigger(sourcePermanent);
  const stackItem: TapTriggeredStackItem = {
    id: triggerId,
    type: 'triggered_ability',
    controller: String(trigger.controllerId || ''),
    source: String(trigger.permanentId || ''),
    sourceName: String(trigger.cardName || 'Triggered ability'),
    description: String(trigger.description || ''),
    effect: String(trigger.effect || trigger.description || ''),
    triggerType: 'tap',
    mandatory: Boolean(trigger.mandatory),
    triggeringPermanentId: String(tappedPermanentId || ''),
    ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    ...(trigger.reflexiveWhenYouDo ? { reflexiveWhenYouDo: trigger.reflexiveWhenYouDo } : null),
    ...(trigger.delayedEndStep ? { delayedEndStep: trigger.delayedEndStep } : null),
    effectData: {
      tappedPermanentId: String(tappedPermanentId || ''),
      tappedPermanentName: String(tappedPermanent?.card?.name || ''),
      tappedPermanentController: String(tappedPermanent?.controller || ''),
      tappedPermanentTypeLine: String(tappedPermanent?.card?.type_line || ''),
    },
  };

  if (trigger.createsToken) {
    stackItem.effectData = {
      ...(stackItem.effectData || {}),
      createsToken: true,
      tokenDetails: trigger.tokenDetails,
    };
  }

  return stackItem;
}

export function serializeTapTriggeredStackItem(stackItem: TapTriggeredStackItem): Record<string, unknown> {
  return {
    triggerId: stackItem.id,
    sourceId: stackItem.source,
    sourceName: stackItem.sourceName,
    controllerId: stackItem.controller,
    description: stackItem.description,
    triggerType: stackItem.triggerType,
    effect: stackItem.effect,
    mandatory: stackItem.mandatory,
    triggeringPermanentId: stackItem.triggeringPermanentId,
    permanentId: stackItem.source,
    ...(stackItem.card && typeof stackItem.card === 'object' ? { card: stackItem.card } : null),
    ...(stackItem.sourcePermanentSnapshot && typeof stackItem.sourcePermanentSnapshot === 'object'
      ? { sourcePermanentSnapshot: stackItem.sourcePermanentSnapshot }
      : null),
    ...(stackItem.effectData ? { effectData: stackItem.effectData } : null),
  };
}

function snapshotPermanentForTapUntapTrigger(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;
  return {
    id: String(permanent?.id || ''),
    controller: String(permanent?.controller || ''),
    owner: String(permanent?.owner || permanent?.controller || ''),
    tapped: permanent?.tapped === true,
    counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
    card: permanent?.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
  };
}

function findBattlefieldPermanentById(ctx: GameContext, permanentId: string): any | undefined {
  const normalizedPermanentId = String(permanentId || '').trim();
  if (!normalizedPermanentId) return undefined;
  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
  return battlefield.find((permanent: any) => String(permanent?.id || '') === normalizedPermanentId);
}

// ============================================================================
// Untap Trigger Detection (Bear Umbra, Nature's Will, etc.)
// ============================================================================

/**
 * Detect untap triggers from permanents on the battlefield.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_UNTAP_TRIGGERS table serves as an
 * optimization fallback for special handling.
 * 
 * Patterns detected:
 * - "Whenever ~ attacks, untap all lands you control"
 * - "Whenever ~ deals combat damage to a player, untap all lands/creatures you control"
 * - "Whenever enchanted/equipped creature attacks, untap..."
 */
export function detectUntapTriggers(card: any, permanent: any): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Use shared utility function for regex escaping (make lowercase for case-insensitive match)
  const cardNameEscaped = escapeCardNameForRegex(cardName).toLowerCase();
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  // "Whenever [creature] attacks, untap all lands you control"
  const attackUntapLandsPattern = new RegExp(`whenever (?:this creature|enchanted creature|equipped creature|~|${cardNameEscaped}) attacks,?\\s*(?:[^.]*)?untap all lands you control`, 'i');
  const attackUntapLandsMatch = oracleText.match(attackUntapLandsPattern);
  if (attackUntapLandsMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'attack',
      untapType: 'lands',
      effect: 'Untap all lands you control',
    });
  }
  
  // "Whenever [creature] attacks, untap all creatures you control"
  const attackUntapCreaturesPattern = new RegExp(`whenever (?:this creature|enchanted creature|equipped creature|~|${cardNameEscaped}) attacks,?\\s*(?:[^.]*)?untap all creatures you control`, 'i');
  const attackUntapCreaturesMatch = oracleText.match(attackUntapCreaturesPattern);
  if (attackUntapCreaturesMatch && !triggers.some(t => t.triggerOn === 'attack' && t.untapType === 'creatures')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'attack',
      untapType: 'creatures',
      effect: 'Untap all creatures you control',
    });
  }
  
  // "Whenever [creature] deals combat damage to a player, untap all lands you control"
  const combatDamageUntapLandsPattern = new RegExp(`whenever (?:this creature|~|enchanted creature|equipped creature|${cardNameEscaped}) deals combat damage to (?:a player|an opponent),?\\s*(?:[^.]*)?untap all lands you control`, 'i');
  const combatDamageUntapLandsMatch = oracleText.match(combatDamageUntapLandsPattern);
  if (combatDamageUntapLandsMatch && !triggers.some(t => t.triggerOn === 'combat_damage' && t.untapType === 'lands')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'combat_damage',
      untapType: 'lands',
      effect: 'Untap all lands you control',
    });
  }
  
  // "Whenever [creature] deals combat damage to a player, untap all creatures you control"
  const combatDamageUntapCreaturesPattern = new RegExp(`whenever (?:~|enchanted creature|equipped creature|${cardNameEscaped}) deals combat damage to (?:a player|an opponent),?\\s*(?:[^.]*)?untap all creatures you control`, 'i');
  const combatDamageUntapCreaturesMatch = oracleText.match(combatDamageUntapCreaturesPattern);
  if (combatDamageUntapCreaturesMatch && !triggers.some(t => t.triggerOn === 'combat_damage' && t.untapType === 'creatures')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'combat_damage',
      untapType: 'creatures',
      effect: 'Untap all creatures you control',
    });
  }
  
  // "Whenever [creature] deals damage to a player, untap all lands you control" (any damage, not just combat)
  const damageUntapLandsPattern = new RegExp(`whenever (?:this creature|~|enchanted creature|equipped creature|${cardNameEscaped}) deals damage to (?:a player|an opponent),?\\s*(?:[^.]*)?untap all lands you control`, 'i');
  const damageUntapLandsMatch = oracleText.match(damageUntapLandsPattern);
  if (damageUntapLandsMatch && !triggers.some(t => t.triggerOn === 'damage_to_player' && t.untapType === 'lands')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'damage_to_player',
      untapType: 'lands',
      effect: 'Untap all lands you control',
    });
  }
  
  // ===== KNOWN CARDS TABLE (Optimization/Enhancement) =====
  // Use the table to handle special cases not caught by dynamic patterns
  // Only add if not already detected dynamically
  for (const [knownName, info] of Object.entries(KNOWN_UNTAP_TRIGGERS)) {
    if (lowerName.includes(knownName) && !triggers.some(t => t.triggerOn === info.triggerOn && t.untapType === info.untapType)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerOn: info.triggerOn,
        untapType: info.untapType,
        effect: info.effect,
      });
    }
  }
  
  return triggers;
}

/**
 * Get all untap triggers that should fire when a creature attacks
 */
export function getAttackUntapTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check the attacking creature itself
  const selfTriggers = detectUntapTriggers(attackingCreature.card, attackingCreature);
  for (const trigger of selfTriggers) {
    if (trigger.triggerOn === 'attack') {
      triggers.push(trigger);
    }
  }
  
  // Check auras/equipment attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== attackingController) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    const isAura = typeLine.includes('aura');
    const isEquipment = typeLine.includes('equipment');
    
    if (isAura || isEquipment) {
      const attachedTo = permanent.attachedTo;
      if (attachedTo === attackingCreature.id) {
        const attachmentTriggers = detectUntapTriggers(permanent.card, permanent);
        for (const trigger of attachmentTriggers) {
          if (trigger.triggerOn === 'attack') {
            triggers.push(trigger);
          }
        }
      }
    }
  }
  
  return triggers;
}

/**
 * Get all untap triggers that should fire when a creature deals combat damage to a player
 */
export function getCombatDamageUntapTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check the attacking creature itself
  const selfTriggers = detectUntapTriggers(attackingCreature.card, attackingCreature);
  for (const trigger of selfTriggers) {
    if (trigger.triggerOn === 'combat_damage' || trigger.triggerOn === 'damage_to_player') {
      triggers.push(trigger);
    }
  }
  
  // Check auras/equipment attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== attackingController) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    const isAura = typeLine.includes('aura');
    const isEquipment = typeLine.includes('equipment');
    
    if (isAura || isEquipment) {
      const attachedTo = permanent.attachedTo;
      if (attachedTo === attackingCreature.id) {
        const attachmentTriggers = detectUntapTriggers(permanent.card, permanent);
        for (const trigger of attachmentTriggers) {
          if (trigger.triggerOn === 'combat_damage' || trigger.triggerOn === 'damage_to_player') {
            triggers.push(trigger);
          }
        }
      }
    }
  }
  
  return triggers;
}

/**
 * Execute an untap trigger effect
 */
export function executeUntapTrigger(
  ctx: GameContext,
  trigger: UntapTrigger
): void {
  const battlefield = ctx.state?.battlefield || [];
  
  debug(2, `[executeUntapTrigger] ${trigger.cardName}: ${trigger.effect}`);
  
  switch (trigger.untapType) {
    case 'lands':
      // Untap all lands the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        const typeLine = (permanent.card?.type_line || '').toLowerCase();
        if (typeLine.includes('land') && permanent.tapped) {
          permanent.tapped = false;
          queueBecomesUntappedTriggers(ctx, permanent);
          debug(2, `[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
      
    case 'creatures':
      // Untap all creatures the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        const typeLine = (permanent.card?.type_line || '').toLowerCase();
        if (typeLine.includes('creature') && permanent.tapped) {
          permanent.tapped = false;
          queueBecomesUntappedTriggers(ctx, permanent);
          debug(2, `[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
      
    case 'all':
      // Untap all permanents the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        if (permanent.tapped) {
          permanent.tapped = false;
          queueBecomesUntappedTriggers(ctx, permanent);
          debug(2, `[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
  }
  
  if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
}

// ============================================================================
// Tap Trigger Detection (Judge of Currents, Emmara, etc.)
// ============================================================================

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  return extractCreatureTypesFromTypeLine(typeLine).map((type) => String(type || '').toLowerCase());
}

function isOptionalTapTriggerEffect(effectText: string): boolean {
  const normalized = String(effectText || '').trim();
  if (!/\byou may\b/i.test(normalized)) {
    return false;
  }
  // "you may pay {cost}. If you do, ..." is still a mandatory trigger; only the cost/effect is optional.
  if (/^\s*you may pay\b/i.test(normalized)) {
    return false;
  }
  return true;
}

// detectTapTriggers lives in tap-detection.ts (leftover-merged).

/**
 * Get all tap triggers that should fire when a permanent becomes tapped
 */
function appendParsedTapLines(
  ctx: GameContext,
  triggers: TapTrigger[],
  subjectPermanent: any,
  event: 'becomes_tapped' | 'becomes_untapped',
): void {
  const battlefield = ctx.state?.battlefield || [];
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    const lines = collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event,
      subjectPermanent,
      subjectControllerId: String(subjectPermanent?.controller || ''),
      sourcePermanent: permanent,
    });
    for (const line of lines) {
      const effect = line.effect.toLowerCase();
      const already = triggers.some((trigger) => (
        String(trigger.permanentId || '') === String(permanent.id || '')
        && String(trigger.effect || trigger.description || '').toLowerCase().includes(effect.slice(0, 24))
      ));
      if (already) continue;
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: String(permanent.controller || ''),
        description: line.effect,
        effect: line.effect,
        triggerCondition: event,
        affectedType: 'any',
        mandatory: !/\byou may\b/i.test(line.effect),
        ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
        ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
      });
    }
  }
}

/**
 * Get all tap triggers that should fire when a permanent becomes tapped
 */
export function getTapTriggers(
  ctx: GameContext,
  tappedPermanent: any,
  tappedByPlayerId: string
): TapTrigger[] {
  const triggers: TapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const tappedTypeLine = (tappedPermanent?.card?.type_line || '').toLowerCase();
  const isCreature = tappedTypeLine.includes('creature');
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectTapTriggers(permanent.card, permanent, ctx.state);
    
    for (const trigger of permTriggers) {
      if (trigger.triggerCondition === 'becomes_untapped') continue;
      if (shouldSkipFirstTimeEachTurnTrigger(ctx.state, trigger)) continue;
      // Only trigger for the controller's permanents becoming tapped
      if (permanent.controller !== tappedByPlayerId) continue;
      
      let shouldTrigger = false;
      
      switch (trigger.affectedType) {
        case 'any':
          shouldTrigger = tapPermanentMatchesPhrase('a permanent', tappedPermanent, permanent) ?? true;
          break;
        case 'creature':
          shouldTrigger = tapPermanentMatchesPhrase('a creature', tappedPermanent, permanent) ?? isCreature;
          break;
        case 'tribal_type':
          if (trigger.tribalType) {
            shouldTrigger = permanentHasCreatureTypeNow(tappedPermanent, trigger.tribalType);
            if (shouldTrigger && trigger.nontokenOnly && tappedPermanent?.isToken) {
              shouldTrigger = false;
            }
          }
          break;
        case 'self':
          // Self-referential triggers only fire when this specific permanent is tapped
          shouldTrigger = permanent.id === tappedPermanent.id;
          break;
        case 'equipped_creature':
          shouldTrigger = tapPermanentMatchesPhrase('equipped creature', tappedPermanent, permanent)
            ?? (isCreature && String((permanent as any).attachedTo || '') === String(tappedPermanent.id || ''));
          break;
        case 'enchanted_creature':
          shouldTrigger = tapPermanentMatchesPhrase('enchanted creature', tappedPermanent, permanent)
            ?? (isCreature && String((permanent as any).attachedTo || '') === String(tappedPermanent.id || ''));
          break;
      }
      
      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }

  appendParsedTapLines(ctx, triggers, tappedPermanent, 'becomes_tapped');
  return triggers;
}

export type TapTriggerEventEntry = {
  trigger: TapTrigger;
  tappedPermanentId: string;
};

function tapTriggerBatchKey(trigger: TapTrigger): string {
  return [
    String(trigger.permanentId || ''),
    String(trigger.tribalType || ''),
    trigger.nontokenOnly ? 'nontoken' : 'any',
    trigger.oneOrMoreBatch ? 'batch' : 'single',
  ].join('|');
}

/**
 * Collect tap triggers for a single tap event (one or more permanents tapped together).
 * "Whenever one or more … become tapped" abilities fire once per event, not per permanent.
 */
export function collectTapTriggersForTapEvent(
  ctx: GameContext,
  tappedPermanentIds: string[],
  tappedByPlayerId: string,
): TapTriggerEventEntry[] {
  const battlefield = ctx.state?.battlefield || [];
  const uniqueTappedIds = Array.from(new Set(tappedPermanentIds.map((id) => String(id).trim()).filter(Boolean)));
  if (uniqueTappedIds.length === 0) return [];

  const rawEntries: TapTriggerEventEntry[] = [];
  for (const tappedPermanentId of uniqueTappedIds) {
    const tappedPermanent = battlefield.find((perm: any) => perm && String(perm.id) === tappedPermanentId);
    if (!tappedPermanent) continue;

    const tappedPermanentController = String(tappedPermanent.controller || tappedByPlayerId || '').trim();
    const triggers = getTapTriggers(ctx, tappedPermanent, tappedPermanentController);
    for (const trigger of triggers) {
      rawEntries.push({ trigger, tappedPermanentId });
    }
  }

  const seenBatchKeys = new Set<string>();
  const result: TapTriggerEventEntry[] = [];
  for (const entry of rawEntries) {
    if (entry.trigger.oneOrMoreBatch) {
      const batchKey = tapTriggerBatchKey(entry.trigger);
      if (seenBatchKeys.has(batchKey)) continue;
      seenBatchKeys.add(batchKey);
    }
    result.push(entry);
  }
  return result;
}

export function getBecomesUntappedTriggers(
  ctx: GameContext,
  untappedPermanent: any,
): TapTrigger[] {
  const triggers: TapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const untappedTypeLine = String(untappedPermanent?.card?.type_line || '').toLowerCase();
  const isCreature = untappedTypeLine.includes('creature');

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permTriggers = detectTapTriggers(permanent.card, permanent, ctx.state);
    for (const trigger of permTriggers) {
      if (trigger.triggerCondition !== 'becomes_untapped') continue;

      let shouldTrigger = false;
      switch (trigger.affectedType) {
        case 'any':
          shouldTrigger = tapPermanentMatchesPhrase('a permanent', untappedPermanent, permanent, 'becomes_untapped') ?? true;
          break;
        case 'creature':
          shouldTrigger = tapPermanentMatchesPhrase('a creature', untappedPermanent, permanent, 'becomes_untapped') ?? isCreature;
          break;
        case 'tribal_type':
          if (trigger.tribalType) {
            shouldTrigger = permanentHasCreatureTypeNow(untappedPermanent, trigger.tribalType);
          }
          break;
        case 'self':
          shouldTrigger = permanent.id === untappedPermanent.id;
          break;
      }

      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }

  appendParsedTapLines(ctx, triggers, untappedPermanent, 'becomes_untapped');
  return triggers;
}

export function queueBecomesUntappedTriggers(
  ctx: GameContext,
  untappedPermanent: any,
): any[] {
  if (!untappedPermanent?.id) return [];
  if ((ctx as any)?.isReplaying) return [];

  const triggers = orderTriggersByAPNAP(ctx, getBecomesUntappedTriggers(ctx, untappedPermanent));
  if (triggers.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];

  for (const trigger of triggers) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) continue;

    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = snapshotPermanentForTapUntapTrigger(findBattlefieldPermanentById(ctx, trigger.permanentId));
    const effectData = {
      untappedPermanentId: String(untappedPermanent.id || ''),
      untappedPermanentName: String(untappedPermanent?.card?.name || ''),
      untappedPermanentController: String(untappedPermanent?.controller || ''),
      untappedPermanentTypeLine: String(untappedPermanent?.card?.type_line || ''),
    };
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: trigger.controllerId,
      source: trigger.permanentId,
      permanentId: trigger.permanentId,
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      triggerType: 'untap',
      mandatory: trigger.mandatory !== false,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      ...(trigger.reflexiveWhenYouDo ? { reflexiveWhenYouDo: trigger.reflexiveWhenYouDo } : null),
      ...(trigger.delayedEndStep ? { delayedEndStep: trigger.delayedEndStep } : null),
      triggeringPermanentId: String(untappedPermanent.id || ''),
      effectData,
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          controllerId: trigger.controllerId,
          description: effect,
          triggerType: 'untap',
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          triggeringPermanentId: String(untappedPermanent.id || ''),
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          effectData,
        });
      } catch (err) {
        debugWarn(1, '[untapTrigger] Failed to persist generic untap trigger:', err);
      }
    }
  }

  return queued;
}

