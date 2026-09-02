/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: top-level activateBattlefieldAbility helpers
 * (split-second, station threshold, tap/untap parse, mana-cost payment,
 * counter-target queue, activated-ability extraction/scope, cost parse).
 *
 * Public entry symbols: parseTapUntapAbilityText,
 * queueCounterTargetStepForBattlefieldAbility, getActivatedAbilityScopeText,
 * buildActivatedAbilityOracleTextForStack, plus the unexported helpers the
 * parent still calls.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { findPermanentsWithCreatureType } from "../../../../shared/src/creatureTypes";
import {
  isActivatableStationThresholdEffect,
  isRecognizedActivatedAbilityCostText,
  readStationChargeCreatureThresholdFromOracleText,
} from "../../../../rules-engine/src/stationPermanentUtils.js";
import { appendEvent } from "../../db";
import { adjustActivationManaCostForPayment, isActivatedManaAbilityText } from "../../state/modules/ability-cost-adjustments.js";
import type { ActivatedAbilityConditionRequirement } from "../../state/modules/activated-ability-conditions.js";
import { countArtifacts } from "../../state/modules/game-state-effects.js";
import { canPayManaCostWithAvailableSources } from "../../state/modules/mana-check.js";
import { serializeAbilityActivatedTriggeredStackItem } from "../../state/modules/triggers/ability-activated.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { parseWordNumber } from "../../state/utils";
import { parseStationAbilities } from "../../utils/stationParser.js";
import { debugWarn } from "../../utils/debug.js";
import { resolveManaAbilityLifeEffect } from "../../state/modules/mana-abilities-handlers/manaAbilitySelfDamage.js";
import {
  calculateTotalAvailableMana,
  consumeManaFromPool,
  getOrInitManaPool,
  parseManaCost,
  validateManaPayment,
} from "../util";
import {
  calculateInteractionManaPoolDelta,
  persistQueuedBattlefieldAbilityStepActivation,
} from "./interactionActivationEventPersistence.js";


export function cardHasSplitSecond(card: any): boolean {
  if (!card) return false;
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const oracleText = String(card.oracle_text || '').toLowerCase();
  return keywords.some((k: any) => String(k).toLowerCase() === 'split second') || oracleText.includes('split second');
}

export function persistAbilityActivatedTriggerPushes(gameId: string, game: any, triggeredAbilities: any[]): void {
  for (const triggeredAbility of Array.isArray(triggeredAbilities) ? triggeredAbilities : []) {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', serializeAbilityActivatedTriggeredStackItem(triggeredAbility));
    } catch (err) {
      debugWarn(1, '[activateBattlefieldAbility] appendEvent(pushTriggeredAbility ability-activated) failed:', err);
    }
  }
}

export function isSplitSecondLockActive(state: any): boolean {
  const stack = state?.stack;
  if (!Array.isArray(stack) || stack.length === 0) return false;
  for (const item of stack) {
    const card = item?.card ?? item?.spell?.card ?? item?.sourceCard ?? item?.source?.card;
    if (cardHasSplitSecond(card)) return true;
  }
  return false;
}

export function getMetalcraftInactiveErrorPayload(game: any, playerId: string) {
  const artifactCount = countArtifacts(game as any, playerId);
  return {
    code: 'METALCRAFT_NOT_ACTIVE',
    message: `Metalcraft is not active. You control ${artifactCount} artifacts (need 3 or more).`,
  };
}

export function getActivatedAbilityConditionErrorPayload(
  requirement: ActivatedAbilityConditionRequirement,
  game: any,
  playerId: string,
  cardName: string,
) {
  if (requirement.key === 'metalcraft') {
    return getMetalcraftInactiveErrorPayload(game, playerId);
  }

  return {
    code: requirement.errorCode,
    message: requirement.getFailureMessage(cardName),
  };
}

export function getManaAbilityLifeEffect(card: any, producesColoredMana: boolean): {
  amount: number;
  isDamage: boolean;
} {
  return resolveManaAbilityLifeEffect({ card, producesColoredMana });
}

export function parseStationThreshold(oracleText: string): number {
  return readStationChargeCreatureThresholdFromOracleText(oracleText);
}

export function parseThresholdRestrictedActivatedAbility(rawText: string): {
  threshold: number;
  cost: string;
  effect: string;
} | null {
  const trimmed = String(rawText || '').trim();
  const withColon = trimmed.match(/^(\d+)\+\s*\|\s*([^:]+):\s*(.+)$/is);
  if (withColon) {
    const threshold = parseInt(withColon[1], 10);
    if (!Number.isFinite(threshold)) {
      return null;
    }
    return {
      threshold,
      cost: withColon[2].trim(),
      effect: withColon[3].trim(),
    };
  }

  const thresholdOnly = trimmed.match(/^(\d+)\+\s*\|\s*(.+)$/is);
  if (thresholdOnly) {
    const threshold = parseInt(thresholdOnly[1], 10);
    const effect = String(thresholdOnly[2] || '').trim();
    if (!Number.isFinite(threshold) || !effect) {
      return null;
    }
    return {
      threshold,
      cost: '',
      effect,
    };
  }

  return null;
}

export function resolveThresholdRestrictedActivatedAbility(ability: {
  cost: string;
  effect: string;
  fullText: string;
}): ReturnType<typeof parseThresholdRestrictedActivatedAbility> {
  const fromFullText = parseThresholdRestrictedActivatedAbility(ability.fullText);
  if (fromFullText) {
    return fromFullText;
  }
  return parseThresholdRestrictedActivatedAbility(`${ability.cost}: ${ability.effect}`);
}

// ============================================================================
// Tap/Untap Ability Text Parsing
// ============================================================================


/**
 * Parse ability text to determine tap/untap target parameters.
 * 
 * Analyzes oracle text to extract information about tap/untap abilities including:
 * - Action type (tap, untap, or both)
 * - Target types (creature, land, artifact, etc.)
 * - Number of targets required
 * - Controller restrictions (you control, opponent controls, any)
 * - Source exclusion (abilities that say "another target")
 * 
 * @param text - The oracle text of the ability to parse
 * @returns Object with parsed parameters, or null if text doesn't describe a tap/untap ability
 * 
 * @example
 * parseTapUntapAbilityText("Untap another target creature or land")
 * // Returns: { action: 'untap', types: ['creature', 'land'], count: 1, excludeSource: true, controller: 'any' }
 * 
 * @example
 * parseTapUntapAbilityText("Tap or untap target permanent")
 * // Returns: { action: 'both', types: ['permanent'], count: 1, excludeSource: false, controller: 'any' }
 * 
 * @example
 * parseTapUntapAbilityText("Untap two target lands")
 * // Returns: { action: 'untap', types: ['land'], count: 2, excludeSource: false, controller: 'any' }
 */
export function parseTapUntapAbilityText(text: string): {
  action: 'tap' | 'untap' | 'both';
  types: string[];
  count: number;
  excludeSource: boolean;
  controller?: 'you' | 'opponent' | 'any';
} | null {
  const lowerText = text.toLowerCase();

  const hasTapUntapTargetPattern =
    /(?:tap or untap|untap or tap)\b[^.:]*\btarget\b/i.test(lowerText) ||
    /\b(?:tap|untap)\b[^.:]*\btarget\b/i.test(lowerText);
  if (!hasTapUntapTargetPattern) {
    return null;
  }
  
  // Check for tap/untap action
  let action: 'tap' | 'untap' | 'both' = 'untap';
  if (lowerText.includes('tap or untap') || lowerText.includes('untap or tap')) {
    action = 'both';
  } else if (lowerText.includes('untap')) {
    action = 'untap';
  } else if (lowerText.includes('tap')) {
    action = 'tap';
  } else {
    return null; // Not a tap/untap ability
  }

  // Extract target count
  let count = 1;
  const numberWords: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
  };
  
  const countMatch = lowerText.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|up to (\d+))\s+target/);
  if (countMatch) {
    if (countMatch[2]) {
      // "up to N" format
      count = parseInt(countMatch[2], 10);
    } else {
      // Number word format
      const word = countMatch[1];
      count = numberWords[word] || 1;
    }
  }

  // Extract target types
  const types: string[] = [];
  const typePattern = /target (creature|land|artifact|enchantment|planeswalker|permanent|creature or land|land or creature)s?/g;
  
  let match;
  while ((match = typePattern.exec(lowerText)) !== null) {
    const typeStr = match[1];
    if (typeStr.includes(' or ')) {
      // Handle "creature or land"
      types.push(...typeStr.split(' or ').map(t => t.trim()));
    } else {
      types.push(typeStr);
    }
  }

  // Default to 'permanent' if no specific type found
  if (types.length === 0) {
    types.push('permanent');
  }

  // Check for "another" (exclude source)
  const excludeSource = lowerText.includes('another target') || lowerText.includes('target other');

  // Check for controller restrictions
  let controller: 'you' | 'opponent' | 'any' = 'any';
  if (lowerText.includes('you control')) {
    controller = 'you';
  } else if (lowerText.includes('opponent controls') || lowerText.includes('an opponent controls')) {
    controller = 'opponent';
  }

  return {
    action,
    types,
    count,
    excludeSource,
    controller,
  };
}

/**
 * Helper function to parse activation cost from oracle text.
 * Extracts mana cost and whether the ability requires tapping.
 * 
 * @param oracleText - The oracle text to parse (should be lowercase)
 * @param abilityPattern - Regex pattern to match the ability (e.g., /untap|tap|move/)
 * @returns Object with requiresTap flag and manaCost string
 */
export function parseActivationCost(oracleText: string, abilityPattern: RegExp): {
  requiresTap: boolean;
  manaCost: string;
  costText: string;
} {
  const costMatch = oracleText.match(new RegExp(`([^:]+?):\\s*${abilityPattern.source}`, 'i'));
  const costStr = costMatch ? costMatch[1].trim() : "";
  
  const requiresTap = costStr.includes('{t}') || costStr.includes('tap');
  const manaCostMatch = costStr.match(/\{[^}]+\}/g);
  const manaCost = manaCostMatch ? manaCostMatch.filter(c => !/\{t\}/i.test(c)).join('') : "";
  
  return { requiresTap, manaCost, costText: costStr };
}

type BattlefieldManaPaymentResult = 'paid' | 'queued' | 'failed';

export function payBattlefieldAbilityManaCostOrQueue(params: {
  game: any;
  gameId: string;
  pid: string;
  permanentId: string;
  abilityId: string;
  cardName: string;
  card: any;
  manaCost: string;
  requiresTap: boolean;
  activatedAbilityText: string;
  activationPaymentContext: string;
  deferredActivationFields?: Record<string, unknown>;
}): BattlefieldManaPaymentResult {
  const battlefield = Array.isArray(params.game.state?.battlefield) ? params.game.state.battlefield : [];
  const sourcePermanent = battlefield.find((perm: any) => perm && String(perm.id) === String(params.permanentId));
  const isManaAbility = isActivatedManaAbilityText(params.activatedAbilityText);
  const costAdjustment = adjustActivationManaCostForPayment({
    state: params.game.state,
    activatorId: params.pid,
    sourceCard: params.card,
    sourceZone: 'battlefield',
    sourceController: String(sourcePermanent?.controller || params.pid),
    sourcePermanent,
    sourceId: params.permanentId,
    isManaAbility,
    manaCostString: params.manaCost,
    sourceName: params.cardName,
  });
  const effectiveManaCost = costAdjustment.adjustedManaCost || params.manaCost;
  const parsedCost = parseManaCost(effectiveManaCost);
  const pool = getOrInitManaPool(params.game.state, params.pid);
  const totalAvailable = calculateTotalAvailableMana(pool, []);
  const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);

  if (!validationError) {
    consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateBattlefieldAbility:${params.activationPaymentContext}]`);
    return 'paid';
  }

  if (!canPayManaCostWithAvailableSources(params.game.state, params.pid, parsedCost)) {
    return 'failed';
  }

  ResolutionQueueManager.addStep(params.gameId, {
    type: ResolutionStepType.MANA_PAYMENT_CHOICE,
    playerId: params.pid as PlayerID,
    sourceId: params.permanentId,
    sourceName: params.cardName,
    sourceImage: (params.card as any)?.image_uris?.small || (params.card as any)?.image_uris?.normal,
    description: `Choose how to pay ${effectiveManaCost} for ${params.cardName}.`,
    mandatory: true,
    activationPaymentChoice: true,
    activationPaymentContext: params.activationPaymentContext,
    confirmLabel: 'Pay and Activate',
    permanentId: params.permanentId,
    abilityId: params.abilityId,
    cardName: params.cardName,
    activatedAbilityText: params.activatedAbilityText,
    manaCost: effectiveManaCost,
    requiresTap: params.requiresTap,
    ...(params.deferredActivationFields || null),
  } as any);

  return 'queued';
}

export function buildCounterTargetValidTargets(
  gameState: any,
  pid: string,
  targetType: string,
  targetController: 'opponent' | 'any' | 'you',
): Array<{ id: string; label: string; description: string; imageUrl?: string }> {
  const battlefield = gameState?.battlefield || [];
  const targetTypeLower = String(targetType || '').toLowerCase();
  const wantsCreature = targetTypeLower.includes('creature');

  return (Array.isArray(battlefield) ? battlefield : []).filter((perm: any) => {
    if (!perm || typeof perm.id !== 'string') return false;
    if (wantsCreature) {
      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return false;
    }
    if (targetController === 'you' && perm.controller !== pid) return false;
    if (targetController === 'opponent' && perm.controller === pid) return false;
    return true;
  }).map((perm: any) => ({
    id: String(perm.id),
    label: String(perm.card?.name || 'permanent'),
    description: 'permanent',
    imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
  }));
}

export function queueCounterTargetStepForBattlefieldAbility(params: {
  gameId: string;
  game: any;
  pid: string;
  permanentId: string;
  abilityId: string;
  card: any;
  cardName: string;
  scopedAbilityFullText: string;
  counterType: string;
  targetController: 'opponent' | 'any' | 'you';
  scalingText: string | null;
  targetType: string;
  requiresTap?: boolean;
  manaPoolBeforePayment?: Record<string, number>;
  poolAfterPayment?: any;
  tappedPermanentIds?: string[];
}): ReturnType<typeof ResolutionQueueManager.addStep> | null {
  const wantsCreature = String(params.targetType || '').toLowerCase().includes('creature');
  const validTargets = buildCounterTargetValidTargets(
    params.game.state,
    params.pid,
    params.targetType,
    params.targetController,
  );
  if (validTargets.length === 0) {
    return null;
  }

  const counterStep = ResolutionQueueManager.addStep(params.gameId, {
    type: ResolutionStepType.COUNTER_TARGET,
    playerId: params.pid as PlayerID,
    sourceId: params.permanentId,
    sourceName: params.cardName,
    sourceImage: (params.card as any)?.image_uris?.small || (params.card as any)?.image_uris?.normal,
    description: params.scopedAbilityFullText,
    mandatory: true,
    counterType: params.counterType,
    targetController: params.targetController,
    oracleText: params.scopedAbilityFullText,
    scalingText: params.scalingText,
    validTargets,
    targetTypes: wantsCreature ? ['creature'] : ['permanent'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: String(params.targetType || '').toLowerCase() || 'target',
    title: `${params.cardName} - Add ${params.counterType} counter`,
  });

  if (typeof params.game.bumpSeq === 'function') {
    params.game.bumpSeq();
  }

  persistQueuedBattlefieldAbilityStepActivation({
    gameId: params.gameId,
    game: params.game,
    playerId: String(params.pid),
    permanentId: String(params.permanentId),
    abilityId: String(params.abilityId),
    cardName: params.cardName,
    activatedAbilityText: String(params.scopedAbilityFullText || '').trim(),
    tappedPermanents: params.requiresTap || (params.tappedPermanentIds || []).length > 0
      ? Array.from(new Set([...(params.tappedPermanentIds || []), ...(params.requiresTap ? [String(params.permanentId)] : [])]))
      : undefined,
    paymentManaDelta: params.manaPoolBeforePayment && params.poolAfterPayment
      ? calculateInteractionManaPoolDelta(params.manaPoolBeforePayment, params.poolAfterPayment)
      : undefined,
    queuedStep: {
      id: String((counterStep as any).id || ''),
      type: ResolutionStepType.COUNTER_TARGET,
      playerId: params.pid,
      sourceId: params.permanentId,
      sourceName: params.cardName,
      sourceImage: (params.card as any)?.image_uris?.small || (params.card as any)?.image_uris?.normal,
      description: params.scopedAbilityFullText,
      mandatory: true,
      counterType: params.counterType,
      targetController: params.targetController,
      oracleText: params.scopedAbilityFullText,
      scalingText: params.scalingText,
      validTargets: validTargets.map((target) => ({ ...target })),
      targetTypes: wantsCreature ? ['creature'] : ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: String(params.targetType || '').toLowerCase() || 'target',
      title: `${params.cardName} - Add ${params.counterType} counter`,
    },
  });

  return counterStep;
}

export function costRequiresSelfExert(costText: string): boolean {
  return /\bexert\s+(?:this(?:\s+\w+)?|~|it)\b/i.test(String(costText || ''));
}

  export function normalizeSelectedXValue(raw: unknown): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return Math.max(0, Math.floor(raw));
  }

  export function applyXValueToText(text: string, xValue?: number): string {
    if (typeof xValue !== 'number' || !Number.isFinite(xValue)) return String(text || '');
    return String(text || '')
      .replace(/\{X\}/gi, `{${xValue}}`)
      .replace(/\bX\b/g, String(xValue))
      .replace(/\bx\b/g, String(xValue));
  }

export function extractActivatedAbilitiesFromText(text: string): Array<{ cost: string; effect: string; fullText: string }> {
  const extracted: Array<{ cost: string; effect: string; fullText: string }> = [];
  const seen = new Set<string>();

  const pushColonAbility = (costRaw: string, effectRaw: string) => {
    const cost = String(costRaw || '')
      .trim()
      .replace(/^(?:boast|forecast|channel|exhaust)\s*[—–-]\s*/i, '')
      .trim();
    const effect = String(effectRaw || '').trim();
    if (!cost || !effect) return;
    if (!isRecognizedActivatedAbilityCostText(cost)) {
      return;
    }

    const fullText = `${cost}: ${effect}`.trim();
    const dedupeKey = `${cost}::${effect}`.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    extracted.push({ cost, effect, fullText });
  };

  const pushThresholdGatedAbility = (threshold: number, effectRaw: string, fullTextRaw?: string) => {
    if (!Number.isFinite(threshold) || threshold <= 0) return;

    const effect = String(effectRaw || '').trim();
    if (!effect) return;

    const innerColon = effect.match(/^([^:]+):\s*(.+)$/s);
    if (innerColon && isRecognizedActivatedAbilityCostText(innerColon[1])) {
      const cost = `${threshold}+ | ${innerColon[1].trim()}`;
      const innerEffect = innerColon[2].trim();
      const fullText = String(fullTextRaw || `${cost}: ${innerEffect}`).trim();
      const dedupeKey = `${cost}::${innerEffect}`.toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      extracted.push({ cost, effect: innerEffect, fullText });
      return;
    }

    if (!isActivatableStationThresholdEffect(effect)) {
      return;
    }

    const cost = `${threshold}+ |`;
    const fullText = String(fullTextRaw || `${threshold}+ | ${effect}`).trim();
    const dedupeKey = `${cost}::${effect}`.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    extracted.push({ cost, effect, fullText });
  };

  for (const rawLine of String(text || '').split(/\r?\n+/)) {
    const line = rawLine.trim();
    if (/^Station\s*\(/i.test(line)) continue;

    const thresholdLine = line.match(/^(\d+)\+\s*\|\s*(.+)$/);
    if (thresholdLine) {
      pushThresholdGatedAbility(parseInt(thresholdLine[1], 10), thresholdLine[2], line);
      continue;
    }

    if (!line.includes(':')) continue;
    const lineMatch = line.match(/^([^:]+):\s*(.+)$/);
    if (lineMatch) {
      pushColonAbility(lineMatch[1], lineMatch[2]);
    }
  }

  for (const section of parseStationAbilities(text)) {
    if (section.threshold <= 0) {
      for (const ability of section.abilities) {
        if (/^\d+\+\s*\|/.test(ability)) continue;
        if (!ability.includes(':')) continue;
        const lineMatch = ability.match(/^([^:]+):\s*(.+)$/);
        if (lineMatch) {
          pushColonAbility(lineMatch[1], lineMatch[2]);
        }
      }
      continue;
    }

    for (const ability of section.abilities) {
      if (/^\d+\+\s*\|/.test(ability)) continue;
      pushThresholdGatedAbility(section.threshold, ability, `${section.threshold}+ | ${ability}`);
    }
  }

  if (extracted.length > 0) {
    return extracted;
  }

  // Single-line oracle: keep the full post-cost effect (multi-sentence riders), not just
  // the first sentence. The legacy fallback regex below stops at the first period.
  const inlineActivated = String(text || '').trim();
  const inlineMatch = inlineActivated.match(/^((?:\{[^}]+\}|[^:])+):\s*([\s\S]+)$/);
  if (inlineMatch) {
    const effect = String(inlineMatch[2] || '')
      .replace(/\s*\(?Activate only as a sorcery\)?\.?\s*$/i, '')
      .replace(/\s*\(?Activate only any time you could cast a sorcery\)?\.?\s*$/i, '')
      .trim();
    pushColonAbility(inlineMatch[1], effect);
    if (extracted.length > 0) {
      return extracted;
    }
  }

  const abilityPattern = /([^:]+):\s*([^.]+\.?)/gi;
  let match;
  while ((match = abilityPattern.exec(text)) !== null) {
    pushColonAbility(match[1], match[2]);
  }

  return extracted;
}

export function getActivatedAbilityScopeText(oracleText: string, abilityId: string): {
  abilityText: string;
  fullAbilityText: string;
} {
  let abilityIndex = 0;
  const abilityMatch = abilityId.match(/-(\d+)$/);
  if (abilityMatch) {
    abilityIndex = parseInt(abilityMatch[1], 10);
    if (isNaN(abilityIndex)) abilityIndex = 0;
  }

  const abilities = extractActivatedAbilitiesFromText(oracleText);
  const selectedAbility = abilityIndex < abilities.length ? abilities[abilityIndex] : null;
  if (!selectedAbility) {
    return { abilityText: '', fullAbilityText: '' };
  }

  return {
    abilityText: selectedAbility.effect,
    fullAbilityText: selectedAbility.fullText,
  };
}

export function buildActivatedAbilityOracleTextForStack(params: {
  selectedAbilityFullText?: string;
  selectedAbilityOracleLine?: string;
  abilityConditionText?: string;
  manaCost?: string;
  abilityText?: string;
}): string {
  const fullLine = String(
    params.selectedAbilityFullText
    || params.selectedAbilityOracleLine
    || '',
  ).trim();
  if (fullLine) return fullLine;

  const conditionText = String(params.abilityConditionText || '').trim();
  if (conditionText.includes(':')) return conditionText;

  const manaCost = String(params.manaCost || '').trim();
  const effectText = String(params.abilityText || '').trim();
  if (manaCost && effectText) return `${manaCost}: ${effectText}`;
  return conditionText || effectText;
}


// Simple unique ID generator for this module
let idCounter = 0;
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Find all untapped permanents controlled by a player that have a specific creature type.
 * This is used for abilities like "Tap four untapped Merfolk you control".
 * Uses the shared implementation that handles Tribal, Kindred, and Changelings.
 */
export function findUntappedPermanentsWithCreatureType(
  battlefield: any[],
  playerId: string,
  creatureType: string
): any[] {
  return findPermanentsWithCreatureType(battlefield, playerId, creatureType, true);
}

/**
 * Parse an ability cost to detect tap requirements.
 * Returns info about what needs to be tapped.
 * Examples:
 * - "Tap four untapped Merfolk you control" -> { count: 4, creatureType: "merfolk", tapSelf: false }
 * - "{T}, Sacrifice ~" -> { tapSelf: true }
 */
export function parseAbilityCost(oracleText: string): {
  tapSelf?: boolean;
  tapCount?: number;
  tapCreatureType?: string;
  sacrificeSelf?: boolean;
  payLife?: number;
  payMana?: string;
} {
  const text = oracleText.toLowerCase();
  const result: any = {};
  
  // Check for tap self
  if (text.includes("{t}") || text.includes("{t},") || text.includes("{t}:")) {
    result.tapSelf = true;
  }
  
  // Check for sacrifice self
  if (text.includes("sacrifice ~") || text.includes("sacrifice this")) {
    result.sacrificeSelf = true;
  }
  
  // Check for pay life
  const lifeMatch = text.match(/pay (\d+) life/);
  if (lifeMatch) {
    result.payLife = parseInt(lifeMatch[1], 10);
  }
  
  // Check for tapping multiple creatures of a type
  // Pattern: "Tap X untapped [Type] you control"
  // Use \w+ instead of [a-z]+ to properly capture creature types
  const tapCreaturesMatch = text.match(/tap (\w+|\d+) untapped (\w+)(?:s)? you control/i);
  if (tapCreaturesMatch) {
    const countStr = tapCreaturesMatch[1];
    result.tapCount = parseWordNumber(countStr, 1);
    result.tapCreatureType = tapCreaturesMatch[2];
  }
  
  // Check for mana cost
  const manaMatch = text.match(/\{([wubrgc0-9]+)\}/gi);
  if (manaMatch && manaMatch.length > 0) {
    // Filter out {T} which is tap symbol
    const manaCosts = manaMatch.filter(m => m.toLowerCase() !== "{t}");
    if (manaCosts.length > 0) {
      result.payMana = manaCosts.join("");
    }
  }
  
  return result;
}
