// server/src/state/modules/counters_tokens-handlers/countersTokensDeathTriggerStack.ts
// Origin parent: server/src/state/modules/counters_tokens.ts
// Cluster moved: inferDeathTriggerStackMetadata + pushDeathTriggerOntoStack
// plus exclusive helpers getSubtypeWordsFromTypeLine, isPermanentTypeLine,
// unwrapOptionalManaPaymentSuccessText, applyBattlefieldReturnCharacteristicMetadata,
// and DeathTriggerStackMetadata.
// Public entry symbols: pushDeathTriggerOntoStack.

import type { GameContext } from "../../context.js";
import { uid } from "../../utils.js";
import { appendEvent } from "../../../db/index.js";
import { debugWarn } from "../../../utils/debug.js";
import { inferManaValueConstraintFromText } from "../graveyard-mana-value.js";
import { pushTriggerDoublerCopies } from "../triggers/combat.js";

type DeathTriggerStackMetadata = {
  requiresTarget?: true;
  needsTargetSelection?: true;
  targetZone?: 'graveyard';
  targetDestination?: 'hand' | 'battlefield';
  targetGraveyardScope?: 'your' | 'any';
  destinationUsesSelectedCardOwner?: true;
  battlefieldControllerMode?: 'owner';
  delayedReturnAt?: 'next_end_step' | 'next_upkeep_selected_card_owner';
  battlefieldTapped?: true;
  battlefieldCounters?: Record<string, number>;
  battlefieldFaceDown?: true;
  battlefieldTurnFaceUp?: true;
  battlefieldSuspected?: true;
  battlefieldSetTypeLine?: string;
  battlefieldSetOracleText?: string;
  battlefieldLoseAllOtherTypes?: true;
  battlefieldGrantedTypes?: string[];
  targetFilterTypes?: string[];
  targetFilterRequiredTypeWords?: string[];
  targetFilterExcludeTypes?: string[];
  targetFilterPermanentOnly?: true;
  targetFilterExactManaValue?: number;
  targetFilterMinManaValue?: number;
  targetFilterMaxManaValue?: number;
  boundGraveyardCardId?: string;
  boundGraveyardOwnerId?: string;
};

function getSubtypeWordsFromTypeLine(typeLineValue: string): string[] {
  const typeLine = String(typeLineValue || '').toLowerCase();
  const subtypeSection = typeLine.includes('—')
    ? typeLine.split('—').slice(1).join(' ')
    : typeLine.includes('-')
      ? typeLine.split('-').slice(1).join(' ')
      : '';
  if (!subtypeSection) {
    return [];
  }

  return subtypeSection
    .split(/[^a-z0-9']+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isPermanentTypeLine(typeLineValue: string): boolean {
  const typeLine = String(typeLineValue || '').toLowerCase();
  return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some((type) => typeLine.includes(type));
}

function unwrapOptionalManaPaymentSuccessText(effectText: string): string {
  const text = String(effectText || '').trim();
  const match = text.match(/^you\s+may\s+pay\s+\{[^}]+\}(?:\{[^}]+\})*\.\s*if\s+you\s+do,?\s*([\s\S]+)$/i);
  return String(match?.[1] || text).trim();
}

function applyBattlefieldReturnCharacteristicMetadata(metadata: DeathTriggerStackMetadata, effectText: string): void {
  const normalized = String(effectText || '').replace(/[’]/g, "'").trim();
  const lower = normalized.toLowerCase();

  const treasureArtifactMatch = normalized.match(/\bit'?s\s+a\s+treasure\s+artifact\s+with\s+"([^"]+)"\s+and\s+it\s+loses\s+all\s+other\s+card\s+types\.?/i);
  if (treasureArtifactMatch) {
    metadata.battlefieldSetTypeLine = 'Artifact - Treasure';
    metadata.battlefieldSetOracleText = String(treasureArtifactMatch[1] || '').trim();
    metadata.battlefieldLoseAllOtherTypes = true;
  }

  if (/\bif\s+it'?s\s+a\s+creature,\s+it'?s\s+a\s+zombie\s+in\s+addition\s+to\s+its\s+other\s+creature\s+types\.?/i.test(lower)) {
    metadata.battlefieldGrantedTypes = Array.from(new Set([...(metadata.battlefieldGrantedTypes || []), 'Zombie']));
  }
}

function inferDeathTriggerStackMetadata(effectText: string, dyingPermanent: any, gameState?: any): DeathTriggerStackMetadata {
  const normalizedEffectText = unwrapOptionalManaPaymentSuccessText(effectText);
  const lower = String(normalizedEffectText || '').toLowerCase();
  const metadata: DeathTriggerStackMetadata = {};
  const underlyingCard = (dyingPermanent as any)?.faceUpCard || dyingPermanent?.card;
  const underlyingTypeLine = String(underlyingCard?.type_line || '');
  const boundCardId = String(underlyingCard?.id || '').trim();
  const boundOwnerId = String(dyingPermanent?.owner || dyingPermanent?.controller || '').trim();
  const dyingSubtypeWords = getSubtypeWordsFromTypeLine(underlyingTypeLine);
  applyBattlefieldReturnCharacteristicMetadata(metadata, normalizedEffectText);

  const isBoundSelfExileReflexive = boundCardId && /(?:^|\.\s*then\s+)you\s+may\s+exile\s+(?:it|this card)\.\s*(?:when|if)\s+you\s+do,?/i.test(normalizedEffectText);
  if (isBoundSelfExileReflexive) {
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
    return metadata;
  }

  if (lower.includes("if it's a permanent card") || lower.includes("if it is a permanent card")) {
    if (!isPermanentTypeLine(underlyingTypeLine)) {
      return metadata;
    }
  }

  const subtypeCardConditionMatch = lower.match(/if\s+it'?s\s+an?\s+([a-z0-9' -]+?)\s+card/);
  if (subtypeCardConditionMatch) {
    const requiredSubtypeWords = String(subtypeCardConditionMatch[1] || '')
      .split(/[^a-z0-9']+/i)
      .map((part) => part.trim())
      .filter(Boolean);
    const nonSubtypeTypeWords = new Set(['artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'permanent', 'planeswalker', 'sorcery']);
    const appliesSubtypeGate = requiredSubtypeWords.length > 0 && !requiredSubtypeWords.every((word) => nonSubtypeTypeWords.has(word));
    if (appliesSubtypeGate && !requiredSubtypeWords.every((word) => dyingSubtypeWords.includes(word))) {
      return metadata;
    }
  }

  if (lower.includes('at the beginning of the next end step') || lower.includes('at beginning of next end step')) {
    metadata.delayedReturnAt = 'next_end_step';
  }
  if (
    lower.includes('at the beginning of their next upkeep') ||
    lower.includes('at beginning of their next upkeep') ||
    lower.includes("at the beginning of its owner's next upkeep") ||
    lower.includes("at beginning of its owner's next upkeep")
  ) {
    metadata.delayedReturnAt = 'next_upkeep_selected_card_owner';
  }

  if (lower.includes('return it to the battlefield tapped') || lower.includes('return that card to the battlefield tapped')) {
    metadata.battlefieldTapped = true;
  }
  if (lower.includes('face down')) {
    metadata.battlefieldFaceDown = true;
  }
  if (lower.includes('turn it face up')) {
    metadata.battlefieldTurnFaceUp = true;
  }
  if (lower.includes('suspect it')) {
    metadata.battlefieldSuspected = true;
  }
  if ((lower.includes('to the battlefield') && /\btapped\b/.test(lower)) || lower.includes('tapped under') || lower.includes('face down and tapped') || lower.includes('tapped and face down')) {
    metadata.battlefieldTapped = true;
  }

  const battlefieldCounters: Record<string, number> = {};
  if (
    lower.includes('with a +1/+1 counter on it') ||
    lower.includes('with an additional +1/+1 counter on it') ||
    lower.includes('with +1/+1 counter')
  ) {
    battlefieldCounters['+1/+1'] = 1;
  }
  if (lower.includes('with a flying counter on it')) {
    battlefieldCounters['flying'] = 1;
  }
  if (lower.includes('with a finality counter on it')) {
    battlefieldCounters['finality'] = 1;
  }
  if (Object.keys(battlefieldCounters).length > 0) {
    metadata.battlefieldCounters = battlefieldCounters;
  }

  if (
    lower.includes('target') &&
    (lower.includes('from your graveyard') || lower.includes('from a graveyard') || lower.includes('from any graveyard'))
  ) {
    metadata.requiresTarget = true;
    metadata.needsTargetSelection = true;
    metadata.targetZone = 'graveyard';
    metadata.targetGraveyardScope = lower.includes('from your graveyard') ? 'your' : 'any';

    if (/to its owner['’]s hand/.test(lower)) {
      metadata.targetDestination = 'hand';
      metadata.destinationUsesSelectedCardOwner = true;
    } else if (lower.includes('to your hand')) {
      metadata.targetDestination = 'hand';
    } else if (/under its owner['’]s control/.test(lower)) {
      metadata.targetDestination = 'battlefield';
      metadata.battlefieldControllerMode = 'owner';
    } else if (lower.includes('to the battlefield')) {
      metadata.targetDestination = 'battlefield';
    }

    if (lower.includes('target permanent card')) {
      metadata.targetFilterPermanentOnly = true;
    } else {
      const manaValueConstraint = inferManaValueConstraintFromText(normalizedEffectText, {
        gameState,
        controllerId: String(dyingPermanent?.controller || dyingPermanent?.owner || '').trim() || undefined,
        sourceName: String(dyingPermanent?.card?.name || dyingPermanent?.name || '').trim() || undefined,
        sourcePermanent: dyingPermanent,
      });
      metadata.targetFilterExactManaValue = manaValueConstraint.targetFilterExactManaValue;
      metadata.targetFilterMinManaValue = manaValueConstraint.targetFilterMinManaValue;
      metadata.targetFilterMaxManaValue = manaValueConstraint.targetFilterMaxManaValue;

      const nonSubtypeCreatureMatch = lower.match(/target\s+non-([a-z0-9'-]+(?:\s+[a-z0-9'-]+)*)\s+creature\s+card/);
      if (nonSubtypeCreatureMatch) {
        metadata.targetFilterTypes = ['creature'];
        metadata.targetFilterExcludeTypes = String(nonSubtypeCreatureMatch[1] || '')
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .map((word) => word.trim())
          .filter(Boolean);
      } else {
        const requiredTypeCreatureMatch = lower.match(/target\s+([a-z0-9'-]+(?:\s+[a-z0-9'-]+)*)\s+creature\s+card/);
        if (requiredTypeCreatureMatch) {
          metadata.targetFilterTypes = ['creature'];
          metadata.targetFilterRequiredTypeWords = String(requiredTypeCreatureMatch[1] || '')
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .map((word) => word.trim())
            .filter(Boolean);
        }
      }
    }

    if (!Array.isArray(metadata.targetFilterRequiredTypeWords) || metadata.targetFilterRequiredTypeWords.length === 0) {
      if (lower.includes('target creature card')) {
        metadata.targetFilterTypes = ['creature'];
      } else if (lower.includes('target artifact card')) {
      metadata.targetFilterTypes = ['artifact'];
      } else if (lower.includes('target enchantment card')) {
        metadata.targetFilterTypes = ['enchantment'];
      } else if (lower.includes('target land card')) {
        metadata.targetFilterTypes = ['land'];
      } else if (lower.includes('target planeswalker card')) {
        metadata.targetFilterTypes = ['planeswalker'];
      } else if (lower.includes('target instant or sorcery card')) {
        metadata.targetFilterTypes = ['instant', 'sorcery'];
      }
    }

    return metadata;
  }

  if (!boundCardId) {
    return metadata;
  }

  if (/^return (?:that card|it) to its owner['’]s hand\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'hand';
    metadata.destinationUsesSelectedCardOwner = true;
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to its owner['’]s hand at the beginning of the next end step\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'hand';
    metadata.destinationUsesSelectedCardOwner = true;
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return to owner['’]s hand at beginning of next end step\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'hand';
    metadata.destinationUsesSelectedCardOwner = true;
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to your hand\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'hand';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to the battlefield(?: tapped)? under its owner['’]s control(?: with [^.]+?)?(?: at the beginning of (?:the next end step|their next upkeep|its owner['’]s next upkeep))?\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.battlefieldControllerMode = 'owner';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to the battlefield(?: tapped)? under your control(?: with [^.]+?)?(?: at the beginning of the next end step)?\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return creature to battlefield under your control(?: with (?:an additional )?\+1\/\+1 counter(?: on it)?)? at beginning of next end step\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to the battlefield under its owner['’]s control\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.battlefieldControllerMode = 'owner';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to the battlefield under its owner['’]s control at the beginning of the next end step\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.battlefieldControllerMode = 'owner';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return to battlefield under owner['’]s control at beginning of next end step\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.battlefieldControllerMode = 'owner';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to the battlefield under your control\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to the battlefield under your control at the beginning of the next end step\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return to battlefield under your control with an additional \+1\/\+1 counter on it at beginning of next end step/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to the battlefield\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return (?:that card|it) to the battlefield(?: tapped)? under its owner['’]s control at the beginning of (?:their|its owner['’]s) next upkeep\.?$/i.test(normalizedEffectText)) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.battlefieldControllerMode = 'owner';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
  } else if (/^return\b/i.test(normalizedEffectText) && lower.includes('to the battlefield')) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'battlefield';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
    if (/under (?:its )?owner['’]s control/.test(lower)) {
      metadata.battlefieldControllerMode = 'owner';
    }
  } else if (/^return\b/i.test(normalizedEffectText) && (lower.includes("to its owner's hand") || lower.includes("to owner's hand") || lower.includes('to your hand'))) {
    metadata.targetZone = 'graveyard';
    metadata.targetDestination = 'hand';
    metadata.boundGraveyardCardId = boundCardId;
    metadata.boundGraveyardOwnerId = boundOwnerId || undefined;
    if (lower.includes("to its owner's hand") || lower.includes("to owner's hand")) {
      metadata.destinationUsesSelectedCardOwner = true;
    }
  }

  return metadata;
}

function pushDeathTriggerOntoStack(ctx: GameContext, trigger: any, dyingPermanent: any): void {
  // Replay applies persisted pushTriggeredAbility events. Re-emitting here duplicates
  // stack items and appends out-of-order Deathmantle/etc. orphans after undo/restore.
  if ((ctx as any).isReplaying) {
    return;
  }
  const state = ctx.state as any;
  const triggerId = uid('trigger');
  const effectText = String(trigger?.effect || '').trim();
  const metadata = trigger?.queueKeywordChoice === true
    ? {}
    : inferDeathTriggerStackMetadata(effectText, dyingPermanent, (ctx as any).state);
  const sourcePermanentSnapshot = (() => {
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const sourceId = String(trigger?.source?.permanentId || '').trim();
    if (!sourceId) return null;
    if (String(dyingPermanent?.id || '').trim() === sourceId) {
      return dyingPermanent;
    }
    const fromBattlefield = battlefield.find((permanent: any) => String(permanent?.id || '') === sourceId);
    if (fromBattlefield) return fromBattlefield;
    if (trigger?.source?.isEmblem === true) {
      const emblems = Array.isArray(state?.emblems) ? state.emblems : [];
      const emblem = emblems.find((entry: any) => String(entry?.id || '') === sourceId);
      if (!emblem) return null;
      return {
        id: sourceId,
        controller: String(emblem.controller || trigger.source.controllerId || ''),
        isEmblem: true,
        card: {
          name: String(trigger.source.cardName || emblem.sourceName || 'Emblem'),
          type_line: 'Emblem',
          oracle_text: String(emblem.effect || effectText || ''),
        },
      };
    }
    return null;
  })();
  const sourceCard = sourcePermanentSnapshot?.card || null;

  const stackItem = {
    id: triggerId,
    type: 'triggered_ability',
    controller: (() => {
      const fromSource = String(trigger?.source?.controllerId || '').trim();
      if (fromSource) return fromSource;
      const fromSnapshot = String(sourcePermanentSnapshot?.controller || '').trim();
      if (fromSnapshot) return fromSnapshot;
      const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
      const sourceId = String(trigger?.source?.permanentId || '').trim();
      const live = sourceId
        ? battlefield.find((permanent: any) => String(permanent?.id || '') === sourceId)
        : null;
      return String(live?.controller || '').trim() || undefined;
    })(),
    source: trigger.source.permanentId,
    permanentId: trigger.source.permanentId,
    sourceName: trigger.source.cardName,
    description: effectText,
    triggerType: 'creature_dies',
    effect: effectText,
    mandatory: true,
    ...(trigger?.source?.isEmblem === true ? { isEmblemSource: true } : null),
    ...(typeof trigger?.value !== 'undefined' ? { value: trigger.value } : null),
    ...(sourceCard ? { card: sourceCard } : null),
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
    ...(dyingPermanent ? { dyingCreature: dyingPermanent } : null),
    ...(typeof trigger?.referenceAmount === 'number' && Number.isFinite(trigger.referenceAmount)
      ? { referenceAmount: Math.max(0, Math.floor(trigger.referenceAmount)) }
      : null),
    ...(trigger.requiresChoice === true ? { requiresChoice: true } : null),
    ...(Array.isArray(trigger.modalOptions) ? { modalOptions: trigger.modalOptions } : null),
    ...(metadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
    ...(metadata.targetZone ? { targetZone: metadata.targetZone } : null),
    ...(metadata.targetDestination ? { targetDestination: metadata.targetDestination } : null),
    ...(metadata.targetGraveyardScope ? { targetGraveyardScope: metadata.targetGraveyardScope } : null),
    ...(metadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
    ...(metadata.battlefieldControllerMode ? { battlefieldControllerMode: metadata.battlefieldControllerMode } : null),
    ...(metadata.delayedReturnAt ? { delayedReturnAt: metadata.delayedReturnAt } : null),
    ...(trigger.reflexiveWhenYouDo ? { reflexiveWhenYouDo: trigger.reflexiveWhenYouDo } : null),
    ...(trigger.delayedEndStep ? { delayedEndStep: trigger.delayedEndStep } : null),
    ...(metadata.battlefieldTapped === true ? { battlefieldTapped: true } : null),
    ...(metadata.battlefieldCounters ? { battlefieldCounters: metadata.battlefieldCounters } : null),
    ...(metadata.battlefieldFaceDown === true ? { battlefieldFaceDown: true } : null),
    ...(metadata.battlefieldTurnFaceUp === true ? { battlefieldTurnFaceUp: true } : null),
    ...(metadata.battlefieldSuspected === true ? { battlefieldSuspected: true } : null),
    ...(metadata.battlefieldSetTypeLine ? { battlefieldSetTypeLine: metadata.battlefieldSetTypeLine } : null),
    ...(typeof metadata.battlefieldSetOracleText === 'string' ? { battlefieldSetOracleText: metadata.battlefieldSetOracleText } : null),
    ...(metadata.battlefieldLoseAllOtherTypes === true ? { battlefieldLoseAllOtherTypes: true } : null),
    ...(Array.isArray(metadata.battlefieldGrantedTypes) ? { battlefieldGrantedTypes: metadata.battlefieldGrantedTypes } : null),
    ...(Array.isArray(metadata.targetFilterTypes) ? { targetFilterTypes: metadata.targetFilterTypes } : null),
    ...(Array.isArray(metadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: metadata.targetFilterRequiredTypeWords } : null),
    ...(Array.isArray(metadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: metadata.targetFilterExcludeTypes } : null),
    ...(metadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
    ...(typeof metadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: metadata.targetFilterExactManaValue } : null),
    ...(typeof metadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: metadata.targetFilterMinManaValue } : null),
    ...(typeof metadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: metadata.targetFilterMaxManaValue } : null),
    ...(metadata.boundGraveyardCardId ? { boundGraveyardCardId: metadata.boundGraveyardCardId } : null),
    ...(metadata.boundGraveyardOwnerId ? { boundGraveyardOwnerId: metadata.boundGraveyardOwnerId } : null),
  } as any;

  state.stack = state.stack || [];
  state.stack.push(stackItem);
  // Live path: death pushes do not go through applyEvent before priority, so double here.
  try {
    pushTriggerDoublerCopies(state, stackItem);
  } catch (err) {
    debugWarn(1, '[movePermanentToGraveyard] pushTriggerDoublerCopies failed:', err);
  }

  const gameId = String((ctx as any)?.gameId || '').trim();
  if (!gameId) {
    return;
  }

  try {
    appendEvent(gameId, state.seq ?? 0, 'pushTriggeredAbility', {
      triggerId,
      sourceId: trigger.source.permanentId,
      permanentId: trigger.source.permanentId,
      sourceName: trigger.source.cardName,
      controllerId: stackItem.controller || trigger.source.controllerId,
      description: effectText,
      triggerType: 'creature_dies',
      effect: effectText,
      mandatory: true,
      ...(trigger?.source?.isEmblem === true ? { isEmblemSource: true } : null),
      ...(typeof trigger?.value !== 'undefined' ? { value: trigger.value } : null),
      ...(sourceCard ? { card: sourceCard } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      ...(dyingPermanent ? { dyingCreature: dyingPermanent } : null),
      ...(typeof trigger?.referenceAmount === 'number' && Number.isFinite(trigger.referenceAmount)
        ? { referenceAmount: Math.max(0, Math.floor(trigger.referenceAmount)) }
        : null),
      ...(trigger.requiresChoice === true ? { requiresChoice: true } : null),
      ...(Array.isArray(trigger.modalOptions) ? { modalOptions: trigger.modalOptions } : null),
      ...(metadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
      ...(metadata.targetZone ? { targetZone: metadata.targetZone } : null),
      ...(metadata.targetDestination ? { targetDestination: metadata.targetDestination } : null),
      ...(metadata.targetGraveyardScope ? { targetGraveyardScope: metadata.targetGraveyardScope } : null),
      ...(metadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
      ...(metadata.battlefieldControllerMode ? { battlefieldControllerMode: metadata.battlefieldControllerMode } : null),
      ...(metadata.delayedReturnAt ? { delayedReturnAt: metadata.delayedReturnAt } : null),
      ...(metadata.battlefieldTapped === true ? { battlefieldTapped: true } : null),
      ...(metadata.battlefieldCounters ? { battlefieldCounters: metadata.battlefieldCounters } : null),
      ...(metadata.battlefieldFaceDown === true ? { battlefieldFaceDown: true } : null),
      ...(metadata.battlefieldTurnFaceUp === true ? { battlefieldTurnFaceUp: true } : null),
      ...(metadata.battlefieldSuspected === true ? { battlefieldSuspected: true } : null),
      ...(metadata.battlefieldSetTypeLine ? { battlefieldSetTypeLine: metadata.battlefieldSetTypeLine } : null),
      ...(typeof metadata.battlefieldSetOracleText === 'string' ? { battlefieldSetOracleText: metadata.battlefieldSetOracleText } : null),
      ...(metadata.battlefieldLoseAllOtherTypes === true ? { battlefieldLoseAllOtherTypes: true } : null),
      ...(Array.isArray(metadata.battlefieldGrantedTypes) ? { battlefieldGrantedTypes: metadata.battlefieldGrantedTypes } : null),
      ...(Array.isArray(metadata.targetFilterTypes) ? { targetFilterTypes: metadata.targetFilterTypes } : null),
      ...(Array.isArray(metadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: metadata.targetFilterRequiredTypeWords } : null),
      ...(Array.isArray(metadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: metadata.targetFilterExcludeTypes } : null),
      ...(metadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
      ...(typeof metadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: metadata.targetFilterExactManaValue } : null),
      ...(typeof metadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: metadata.targetFilterMinManaValue } : null),
      ...(typeof metadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: metadata.targetFilterMaxManaValue } : null),
      ...(metadata.boundGraveyardCardId ? { boundGraveyardCardId: metadata.boundGraveyardCardId } : null),
      ...(metadata.boundGraveyardOwnerId ? { boundGraveyardOwnerId: metadata.boundGraveyardOwnerId } : null),
    });
  } catch (err) {
    debugWarn(1, '[movePermanentToGraveyard] appendEvent(pushTriggeredAbility death) failed:', err);
  }
}


export { pushDeathTriggerOntoStack };
