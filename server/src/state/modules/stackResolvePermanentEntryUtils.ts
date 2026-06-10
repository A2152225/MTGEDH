import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, parsePT } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { mergeRetainedCountersForBattlefieldEntry } from '../../../../shared/src/zoneRetainedCounters.js';
import { detectEntersWithCounters } from './detectEntersWithCounters.js';
import { checkPermanentEntersTapped } from './triggerPermanentEntersTapped.js';
import { creatureWillHaveHaste } from './creatureEntryHasteUtils.js';
import { applyCounterModifications } from './counters_tokens.js';
import { evaluateBattlefieldEntryReplacementEvent } from './replacement-effects.js';
import { applyTriggeredReanimationEntryRiders } from './triggerReanimationRiders.js';
import { isCreatureNow } from '../creatureTypeNow.js';
import {
  createMutatedPermanent,
  getMutatedPermanentAbilities,
  getMutatedPermanentCharacteristics,
} from '../../../../rules-engine/src/keywordAbilities/mutate.js';
import { syncArcaneAdaptationForNewCreature } from './chosen-creature-type.js';
import { applyMetallicMimicEntryBonus } from './triggerChosenTypeSpellUtils.js';
import { cardEntersPrepared, setPermanentPrepared } from './prepared.js';
import { inferTriggeredAbilityTargetMetadata } from './inferTriggeredAbilityTargetMetadata.js';
import { parseTriggeredAbilitiesFromText, TriggerEvent as ParsedTriggerEvent } from '../../../../rules-engine/src/triggeredAbilities.js';
import type {
  PermanentBattlefieldEntryOptions,
  PermanentBattlefieldEntryOutcome,
} from './stackResolveSharedTypes.js';

export type { PermanentBattlefieldEntryOutcome } from './stackResolveSharedTypes.js';

function getEnteringPlaneswalkerLoyaltyValue(_state: unknown, _controller: unknown, card: any): number | undefined {
  const loyalty = card?.loyalty != null ? parseInt(String(card.loyalty), 10) : NaN;
  return Number.isFinite(loyalty) ? loyalty : undefined;
}

function buildFullTriggeredAbilityText(trigger: any): string {
  const keywordRaw = String(trigger?.keyword || 'when').toLowerCase();
  const keyword = keywordRaw === 'at' ? 'At' : keywordRaw === 'whenever' ? 'Whenever' : 'When';
  const condition = String(trigger?.triggerFilter || trigger?.condition || 'this creature mutates').trim();
  const effect = String(trigger?.effect || '').trim();
  const interveningIf = String(trigger?.interveningIfClause || '').trim();

  if (!condition) {
    return effect;
  }

  if (interveningIf) {
    return `${keyword} ${condition}, if ${interveningIf}, ${effect}`.trim();
  }

  return `${keyword} ${condition}, ${effect}`.trim();
}

function queueMutateTriggeredAbilities(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  if ((ctx as any).isReplaying) {
    return;
  }

  const permanentId = String(permanent?.id || '').trim();
  const sourceName = String(permanent?.card?.name || 'Triggered ability').trim();
  if (!permanentId) {
    return;
  }

  const cardsToInspect = Array.isArray((permanent as any)?.mutatedStack) && (permanent as any).mutatedStack.length > 0
    ? (permanent as any).mutatedStack
    : [
        {
          name: sourceName,
          oracleText: String(permanent?.card?.oracle_text || '').trim(),
        },
      ];
  const mutateTriggers = cardsToInspect.flatMap((entry: any) => {
    const oracleText = String(entry?.oracleText || '').trim();
    if (!oracleText) return [];
    return parseTriggeredAbilitiesFromText(
      oracleText,
      permanentId,
      controller,
      String(entry?.name || sourceName).trim() || sourceName,
    ).filter((trigger) => trigger?.event === ParsedTriggerEvent.MUTATES);
  });
  if (mutateTriggers.length === 0) {
    return;
  }

  const state: any = (ctx as any).state;
  state.stack = state.stack || [];
  const gameId = String((ctx as any).gameId || '').trim();

  for (const trigger of mutateTriggers) {
    const effectText = String(trigger?.effect || '').trim();
    if (!effectText) continue;

    const fullText = buildFullTriggeredAbilityText(trigger);
    const {
      requiresTarget,
      targetType,
      targetConstraint,
      targetZone,
      targetDestination,
      targetGraveyardScope,
      destinationUsesSelectedCardOwner,
      battlefieldControllerMode,
      battlefieldCounters,
      targetAction,
      targetFilterTypes,
      targetFilterRequiredTypeWords,
      targetFilterExcludeTypes,
      targetFilterPermanentOnly,
      targetFilterExactManaValue,
      targetFilterMinManaValue,
      targetFilterMaxManaValue,
      targetTotalPowerLimit,
      targetCastWithoutPayingManaCost,
      targetCastIsOptional,
      minTargets,
      maxTargets,
    } = inferTriggeredAbilityTargetMetadata(effectText, {
      gameState: state,
      controllerId: controller,
      sourceName,
      sourcePermanent: permanent,
    });
    const triggerId = uid('trigger');

    state.stack.push({
      id: triggerId,
      type: 'triggered_ability',
      controller,
      source: permanentId,
      sourceName,
      description: effectText,
      triggerType: 'triggered_ability',
      effect: fullText,
      mandatory: trigger?.optional !== true,
      ...(requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
      ...(targetType ? { targetType } : null),
      ...(targetConstraint ? { targetConstraint } : null),
      ...(targetZone ? { targetZone } : null),
      ...(targetDestination ? { targetDestination } : null),
      ...(targetGraveyardScope ? { targetGraveyardScope } : null),
      ...(destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
      ...(battlefieldControllerMode ? { battlefieldControllerMode } : null),
      ...(battlefieldCounters ? { battlefieldCounters } : null),
      ...(targetAction ? { targetAction } : null),
      ...(Array.isArray(targetFilterTypes) ? { targetFilterTypes } : null),
      ...(Array.isArray(targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords } : null),
      ...(Array.isArray(targetFilterExcludeTypes) ? { targetFilterExcludeTypes } : null),
      ...(targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
      ...(typeof targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue } : null),
      ...(typeof targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue } : null),
      ...(typeof targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue } : null),
      ...(typeof targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit } : null),
      ...(targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
      ...(targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
      ...(typeof minTargets === 'number' ? { minTargets } : null),
      ...(typeof maxTargets === 'number' ? { maxTargets } : null),
    } as any);

    if (gameId) {
      try {
        appendEvent(gameId, (state as any).seq ?? 0, 'pushTriggeredAbility', {
          triggerId,
          sourceId: permanentId,
          permanentId,
          sourceName,
          controllerId: controller,
          description: effectText,
          triggerType: 'triggered_ability',
          effect: fullText,
          mandatory: trigger?.optional !== true,
          ...(requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
          ...(targetType ? { targetType } : null),
          ...(targetConstraint ? { targetConstraint } : null),
          ...(targetZone ? { targetZone } : null),
          ...(targetDestination ? { targetDestination } : null),
          ...(targetGraveyardScope ? { targetGraveyardScope } : null),
          ...(destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
          ...(battlefieldControllerMode ? { battlefieldControllerMode } : null),
          ...(battlefieldCounters ? { battlefieldCounters } : null),
          ...(targetAction ? { targetAction } : null),
          ...(Array.isArray(targetFilterTypes) ? { targetFilterTypes } : null),
          ...(Array.isArray(targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords } : null),
          ...(Array.isArray(targetFilterExcludeTypes) ? { targetFilterExcludeTypes } : null),
          ...(targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
          ...(typeof targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue } : null),
          ...(typeof targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue } : null),
          ...(typeof targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue } : null),
          ...(typeof targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit } : null),
          ...(targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
          ...(targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
          ...(typeof minTargets === 'number' ? { minTargets } : null),
          ...(typeof maxTargets === 'number' ? { maxTargets } : null),
        });
      } catch (err) {
        debugWarn(1, '[resolveTopOfStack] appendEvent(pushTriggeredAbility mutate) failed:', err);
      }
    }
  }
}



export function resolvePermanentSpellBattlefieldEntry(
  ctx: GameContext,
  options: PermanentBattlefieldEntryOptions,
): PermanentBattlefieldEntryOutcome {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const effectiveTypeLine = options.effectiveTypeLine;
  const item = options.item;
  const targets = options.targets;
  const fallbackOracleText = options.fallbackOracleText;

  // Permanent spell resolves - move to battlefield
  const tl = (effectiveTypeLine || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const isPlaneswalker = /\bplaneswalker\b/.test(tl);
  
  // Check if this was cast with morph (face-down)
  const wasCastWithMorph = (item as any).wasCastWithMorph || false;
  const morphCost = wasCastWithMorph ? (item as any).morphCost : undefined;
  
  let baseP: number | undefined;
  let baseT: number | undefined;
  
  if (wasCastWithMorph) {
    // Face-down creatures are always 2/2 colorless
    baseP = 2;
    baseT = 2;
  } else {
    baseP = isCreature ? parsePT((effectiveCard as any).power) : undefined;
    baseT = isCreature ? parsePT((effectiveCard as any).toughness) : undefined;
  }
  
  // Check if the creature has haste from any source (own text or battlefield effects)
  // Rule 702.10: Haste allows ignoring summoning sickness
  const battlefield = state.battlefield || [];
  const gainsHasteUntilEndOfTurnFromManaSpent = isCreature && (
    (item as any).gainsHasteUntilEndOfTurnFromManaSpent === true ||
    (item as any).card?.gainsHasteUntilEndOfTurnFromManaSpent === true
  );
  const hasHaste = isCreature && (
    gainsHasteUntilEndOfTurnFromManaSpent ||
    creatureWillHaveHaste(effectiveCard, controller, battlefield)
  );
  
  // Creatures have summoning sickness when they enter (unless they have haste)
  // Rule 302.6: A creature's activated ability with tap/untap symbol can't be
  // activated unless the creature has been under controller's control since 
  // their most recent turn began.
  const hasSummoningSickness = isCreature && !hasHaste;
  
  // Initialize counters - planeswalkers enter with loyalty counters equal to their printed loyalty
  const initialCounters: Record<string, number> = {};
  if (isPlaneswalker) {
    const startingLoyalty = getEnteringPlaneswalkerLoyaltyValue(state, controller, effectiveCard);
    if (typeof startingLoyalty === 'number' && !Number.isNaN(startingLoyalty)) {
      initialCounters.loyalty = startingLoyalty;
      debug(2, `[resolveTopOfStack] Planeswalker ${effectiveCard.name} enters with ${startingLoyalty} loyalty`);
    }
  }
  
  // Special handling for Jeska, Thrice Reborn and similar cards
  // "Jeska enters with a loyalty counter on her for each time you've cast a commander from the command zone this game."
  const oracleTextLower = String((effectiveCard as any)?.oracle_text || fallbackOracleText || '').toLowerCase();
  if (isPlaneswalker && (
    oracleTextLower.includes("enters with a loyalty counter") && 
    oracleTextLower.includes("for each time") && 
    oracleTextLower.includes("commander from the command zone")
  )) {
    // Count commander casts from tax
    // Per MTG rules, commander tax increases by {2} for each time the commander has been cast
    // from the command zone. Therefore, tax / 2 = number of times cast from command zone.
    const commandZone = (state as any).commandZone?.[controller];
    let totalCommanderCasts = 0;
    
    if (commandZone?.taxById) {
      // Sum up all commander casts: (tax / 2) for each commander in the command zone
      for (const [, tax] of Object.entries(commandZone.taxById)) {
        const taxNumber = typeof tax === 'number' ? tax : 0;
        // Commander tax = 2 * number_of_casts, so casts = tax / 2
        totalCommanderCasts += Math.floor(taxNumber / 2);
      }
    }
    
    // Add loyalty for each commander cast (including Jeska herself if she was just cast from command zone)
    if (totalCommanderCasts > 0) {
      initialCounters.loyalty = (initialCounters.loyalty || 0) + totalCommanderCasts;
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} (Jeska-style): enters with ${totalCommanderCasts} additional loyalty for commander casts`);
    }
  }
  
  // Check for "enters with counters" patterns (Zack Fair, modular creatures, sagas, etc.)
  const etbCounters = detectEntersWithCounters(effectiveCard);
  for (const [counterType, count] of Object.entries(etbCounters)) {
    initialCounters[counterType] = (initialCounters[counterType] || 0) + count;
    debug(2, `[resolveTopOfStack] ${effectiveCard.name} enters with ${count} ${counterType} counter(s)`);
  }

  const explicitEntryCounters = ((item as any).entersBattlefieldWithCounters && typeof (item as any).entersBattlefieldWithCounters === 'object')
    ? (item as any).entersBattlefieldWithCounters as Record<string, number>
    : ((effectiveCard as any)?.entersBattlefieldWithCounters && typeof (effectiveCard as any).entersBattlefieldWithCounters === 'object')
      ? (effectiveCard as any).entersBattlefieldWithCounters as Record<string, number>
      : undefined;
  if (explicitEntryCounters) {
    for (const [counterType, rawCount] of Object.entries(explicitEntryCounters)) {
      const count = Number(rawCount || 0);
      if (!Number.isFinite(count) || count <= 0) continue;
      // Cast-time metadata like escape counters may also be recognizable from Oracle text.
      // Merge by max so a duplicated source does not double-count on entry.
      initialCounters[counterType] = Math.max(Number(initialCounters[counterType] || 0), count);
    }
  }
  
  // Yuna, Grand Summoner: "When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it."
  if (isCreature && (state as any).yunaNextCreatureFlags?.[controller]) {
    initialCounters['+1/+1'] = (initialCounters['+1/+1'] || 0) + 2;
    debug(2, `[resolveTopOfStack] Yuna's Grand Summon: ${effectiveCard.name} enters with 2 additional +1/+1 counters`);
    // Clear the flag
    delete (state as any).yunaNextCreatureFlags[controller];
  }
  
  // Check if this creature should enter tapped due to effects like Authority of the Consuls, Blind Obedience, etc.
  const shouldEnterTapped = checkPermanentEntersTapped(state.battlefield || [], controller, effectiveCard);
  
  state.battlefield = state.battlefield || [];
  const newPermId = uid("perm");
  
  // Apply counter modifiers (Doubling Season, Vorinclex, etc.) to ETB counters
  // Need to create a temporary permanent to apply modifiers
  const retainedEntryCounters = mergeRetainedCountersForBattlefieldEntry(
    effectiveCard,
    String((item as any).source || (effectiveCard as any)?.castSourceZone || 'hand'),
    initialCounters
  ) || {};
  const tempPerm = { id: newPermId, controller, counters: {} };
  state.battlefield.push(tempPerm as any);
  const modifiedCounters = applyCounterModifications(state, newPermId, retainedEntryCounters);
  state.battlefield.pop(); // Remove temp permanent
  const copiedPermanentSpellBecomesToken = (item as any).isCopy === true;
  const entryReplacement = evaluateBattlefieldEntryReplacementEvent({
    state,
    card: effectiveCard,
    controllerId: String(controller),
    entersTapped: shouldEnterTapped,
    entryCounters: modifiedCounters,
    entersTransformed: Boolean((effectiveCard as any)?.transformed || (item as any)?.transformed),
    entersFaceDown: wasCastWithMorph,
    copySourceId: copiedPermanentSpellBecomesToken ? String((item as any).copiedFromStackItemId || (item as any).copiedFromPermanentId || '') : undefined,
    cause: 'spell_resolution',
  });
  
  const newPermanent: any = {
    id: newPermId,
    controller,
    owner: controller,
    tapped: shouldEnterTapped,
    ...(copiedPermanentSpellBecomesToken ? { isToken: true } : {}),
    counters: Object.keys(modifiedCounters).length > 0 ? modifiedCounters : undefined,
    ...(entryReplacement.applied ? { battlefieldEntryReplacement: entryReplacement } : {}),
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    card: wasCastWithMorph ? { 
      // Face-down card - show generic 2/2 colorless creature
      name: "Face-down Creature",
      type_line: "Creature",
      zone: "battlefield",
      power: "2",
      toughness: "2",
    } : (() => {
      const nextCard: any = { ...effectiveCard, zone: "battlefield" };
      if ('counters' in nextCard) delete nextCard.counters;
      return nextCard;
    })(),
    // Preserve isCommander flag from stack item if it exists
    isCommander: (item as any).card?.isCommander || (effectiveCard as any).isCommander || false,
  };

  if (copiedPermanentSpellBecomesToken && newPermanent.card) {
    (newPermanent.card as any).isToken = true;
  }

  const leaveBattlefieldReplacementDestination = String(
    (effectiveCard as any)?.leaveBattlefieldReplacementDestination || (item as any)?.card?.leaveBattlefieldReplacementDestination || ''
  ).trim().toLowerCase();
  const leaveBattlefieldReplacementSourceName = String(
    (effectiveCard as any)?.leaveBattlefieldReplacementSourceName || (item as any)?.card?.leaveBattlefieldReplacementSourceName || ''
  ).trim();
  const leaveBattlefieldReplacementLifeGain = Number(
    (effectiveCard as any)?.leaveBattlefieldReplacementLifeGain || (item as any)?.card?.leaveBattlefieldReplacementLifeGain || 0
  );
  if (leaveBattlefieldReplacementDestination === 'exile') {
    (newPermanent as any).leaveBattlefieldReplacementDestination = 'exile';
    (newPermanent.card as any).leaveBattlefieldReplacementDestination = 'exile';
    if (leaveBattlefieldReplacementSourceName) {
      (newPermanent as any).leaveBattlefieldReplacementSourceName = leaveBattlefieldReplacementSourceName;
      (newPermanent.card as any).leaveBattlefieldReplacementSourceName = leaveBattlefieldReplacementSourceName;
    }
    if (leaveBattlefieldReplacementLifeGain > 0) {
      (newPermanent as any).leaveBattlefieldReplacementLifeGain = leaveBattlefieldReplacementLifeGain;
      (newPermanent.card as any).leaveBattlefieldReplacementLifeGain = leaveBattlefieldReplacementLifeGain;
    }
  }

  // Propagate relevant cast metadata from the stack item onto the permanent/card.
  // This enables ETB intervening-if clauses like "if {R} was spent to cast it".
  if ((item as any).manaColorsSpent && Array.isArray((item as any).manaColorsSpent) && !wasCastWithMorph) {
    (newPermanent as any).manaColorsSpent = (item as any).manaColorsSpent;
    (newPermanent.card as any).manaColorsSpent = (item as any).manaColorsSpent;
  }

  if (typeof (item as any).manaSpentTotal === 'number' && !Number.isNaN((item as any).manaSpentTotal) && !wasCastWithMorph) {
    (newPermanent as any).manaSpentTotal = (item as any).manaSpentTotal;
    (newPermanent.card as any).manaSpentTotal = (item as any).manaSpentTotal;
  }

  if ((item as any).manaSpentBreakdown && typeof (item as any).manaSpentBreakdown === 'object' && !wasCastWithMorph) {
    (newPermanent as any).manaSpentBreakdown = (item as any).manaSpentBreakdown;
    (newPermanent.card as any).manaSpentBreakdown = (item as any).manaSpentBreakdown;
  }

  // Alternate-cost id (e.g., surge/spectacle/madness/prowl) for intervening-if and other templates.
  if (typeof (item as any).alternateCostId === 'string' && (item as any).alternateCostId.length > 0 && !wasCastWithMorph) {
    (newPermanent as any).alternateCostId = (item as any).alternateCostId;
    (newPermanent.card as any).alternateCostId = (item as any).alternateCostId;
  }

  // Convoke-derived metadata: how many creatures contributed mana.
  if (typeof (item as any).manaFromCreaturesSpent === 'number' && !Number.isNaN((item as any).manaFromCreaturesSpent) && !wasCastWithMorph) {
    (newPermanent as any).manaFromCreaturesSpent = (item as any).manaFromCreaturesSpent;
    (newPermanent.card as any).manaFromCreaturesSpent = (item as any).manaFromCreaturesSpent;
  }
  if (Array.isArray((item as any).convokeTappedCreatures) && !wasCastWithMorph) {
    (newPermanent as any).convokeTappedCreatures = (item as any).convokeTappedCreatures;
    (newPermanent.card as any).convokeTappedCreatures = (item as any).convokeTappedCreatures;
  }

  // Track cast origin (best-effort) for intervening-if clauses like "if you cast it" / "if you cast it from your hand".
  // Only set these on permanents created from resolving a stack item.
  (newPermanent as any).enteredFromCast = true;
  (newPermanent.card as any).enteredFromCast = true;
  if (typeof (item as any).castFromHand === 'boolean') {
    (newPermanent as any).castFromHand = (item as any).castFromHand;
    (newPermanent.card as any).castFromHand = (item as any).castFromHand;
  }
  if (typeof (item as any).source === 'string' && (item as any).source.length > 0) {
    (newPermanent as any).castSourceZone = (item as any).source;
    (newPermanent.card as any).castSourceZone = (item as any).source;
  }
  if (String((effectiveCard as any)?.castWithAbility || (item as any)?.card?.castWithAbility || '').trim().toLowerCase() === 'escape') {
    (newPermanent as any).escapedFrom = 'graveyard';
    (newPermanent.card as any).escapedFrom = 'graveyard';
  }
  if (gainsHasteUntilEndOfTurnFromManaSpent) {
    (newPermanent as any).temporaryAbilities = Array.isArray((newPermanent as any).temporaryAbilities)
      ? (newPermanent as any).temporaryAbilities
      : [];
    const alreadyHasTemporaryHaste = (newPermanent as any).temporaryAbilities.some((entry: any) =>
      String(entry?.ability || entry?.keyword || entry?.name || '').toLowerCase() === 'haste'
    );
    if (!alreadyHasTemporaryHaste) {
      (newPermanent as any).temporaryAbilities.push({ ability: 'haste', expiresAt: 'end_of_turn' });
    }
    newPermanent.summoningSickness = false;
  }
  
  // Store face-down information
  if (wasCastWithMorph) {
    newPermanent.isFaceDown = true;
    newPermanent.faceDownType = 'morph';
    newPermanent.faceUpCard = effectiveCard; // Store the actual card hidden
    newPermanent.morphCost = morphCost;
  }
  
  // Add loyalty metadata only for planeswalkers
  if (isPlaneswalker) {
    // Keep both for client display: loyalty = current counters, baseLoyalty = printed
    newPermanent.loyalty = modifiedCounters.loyalty ?? initialCounters.loyalty;
    newPermanent.baseLoyalty = initialCounters.loyalty ?? 0;
    debug(1, `[PLANESWALKER DEBUG] ${effectiveCard.name} entering battlefield:`, {
      loyalty: newPermanent.loyalty,
      baseLoyalty: newPermanent.baseLoyalty,
      counters: newPermanent.counters,
      hasOracleText: !!effectiveCard.oracle_text,
      oracleTextLength: effectiveCard.oracle_text?.length || 0,
    });
  }

  applyTriggeredReanimationEntryRiders(
    ctx,
    newPermanent,
    String(effectiveCard?.name || (item as any)?.card?.name || 'Permanent'),
    controller,
    String(effectiveCard?.oracle_text || ''),
  );

  const isMutatingSpell =
    !wasCastWithMorph &&
    isCreature &&
    (
      (effectiveCard as any)?.isMutating === true ||
      String((item as any)?.alternateCostId || (effectiveCard as any)?.alternateCostId || '').toLowerCase().trim() === 'mutate'
    );

  if (isMutatingSpell) {
    const mutateTargetId = String((effectiveCard as any)?.mutateTarget || targets?.[0] || '').trim();
    const mutateOnTop = Boolean((effectiveCard as any)?.mutateOnTop);
    const mutateTarget = mutateTargetId
      ? (state.battlefield || []).find((perm: any) => perm && String(perm.id || '') === mutateTargetId)
      : null;
    const mutateTargetTypeLine = String(mutateTarget?.card?.type_line || '').toLowerCase();
    const spellOwner = String(controller || '').trim();
    const targetOwner = String((mutateTarget as any)?.owner || (mutateTarget as any)?.controller || '').trim();
    const legalMutateTarget = Boolean(
      mutateTarget &&
      isCreatureNow(mutateTarget) &&
      !mutateTargetTypeLine.includes('human') &&
      targetOwner &&
      targetOwner === spellOwner
    );

    if (legalMutateTarget) {
      const existingMutatedStack = Array.isArray((mutateTarget as any).mutatedStack)
        ? ((mutateTarget as any).mutatedStack as any[])
        : [];
      const mutatingCardId = String((effectiveCard as any)?.id || '').trim();
      const alreadyMerged = Boolean(mutatingCardId) && existingMutatedStack.some((entry: any) => String(entry?.id || '') === mutatingCardId);

      if (!alreadyMerged) {
        const existingMutation = existingMutatedStack.length > 0
          ? {
              permanentId: String((mutateTarget as any).id || mutateTargetId),
              controller: String((mutateTarget as any).controller || controller),
              owner: targetOwner,
              cardStack: existingMutatedStack.map((entry: any) => ({
                id: String(entry?.id || ''),
                name: String(entry?.name || ''),
                typeLine: String(entry?.typeLine || ''),
                oracleText: String(entry?.oracleText || ''),
                power: entry?.power,
                toughness: entry?.toughness,
                manaCost: entry?.manaCost,
                isOriginal: entry?.isOriginal === true,
                isCommander: entry?.isCommander === true,
              })),
              mutationCount: Number((mutateTarget as any).mutationCount || Math.max(1, existingMutatedStack.length - 1)),
              summoningSicknessInherited: !(mutateTarget as any).summoningSickness,
            }
          : undefined;

        const mutatedPermanent = createMutatedPermanent(
          mutateTarget,
          {
            ...(effectiveCard as any),
            isCommander: (item as any).card?.isCommander || (effectiveCard as any).isCommander || false,
          },
          mutateOnTop,
          existingMutation as any,
        );
        const topCharacteristics = getMutatedPermanentCharacteristics(mutatedPermanent);
        const combinedAbilities = getMutatedPermanentAbilities(mutatedPermanent);
        const topCardEntry = mutatedPermanent.cardStack[0];

        (mutateTarget as any).mutatedStack = mutatedPermanent.cardStack.map((entry: any) => ({
          id: entry.id,
          name: entry.name,
          typeLine: entry.typeLine,
          oracleText: entry.oracleText,
          power: entry.power,
          toughness: entry.toughness,
          manaCost: entry.manaCost,
          isOriginal: entry.isOriginal,
          isCommander: entry.isCommander,
          imageUrl: entry.id === mutatingCardId
            ? ((effectiveCard as any)?.image_uris?.small || (effectiveCard as any)?.image_uris?.normal)
            : undefined,
        }));
        (mutateTarget as any).mutationCount = mutatedPermanent.mutationCount;
        (mutateTarget as any).timesMutated = mutatedPermanent.mutationCount;
        (mutateTarget as any).card = {
          ...((mutateTarget as any).card || {}),
          ...(mutateOnTop ? { ...(effectiveCard as any) } : {}),
          id: topCardEntry?.id || (mutateTarget as any).card?.id,
          name: topCharacteristics.name || (mutateTarget as any).card?.name,
          type_line: topCharacteristics.typeLine || (mutateTarget as any).card?.type_line,
          power: topCharacteristics.power ?? (mutateTarget as any).card?.power,
          toughness: topCharacteristics.toughness ?? (mutateTarget as any).card?.toughness,
          mana_cost: topCharacteristics.manaCost ?? (mutateTarget as any).card?.mana_cost,
          oracle_text: combinedAbilities.join('\n') || (mutateTarget as any).card?.oracle_text || '',
          zone: 'battlefield',
        };

        const parsedTopPower = parsePT(topCharacteristics.power);
        const parsedTopToughness = parsePT(topCharacteristics.toughness);
        if (parsedTopPower !== undefined) {
          (mutateTarget as any).basePower = parsedTopPower;
        }
        if (parsedTopToughness !== undefined) {
          (mutateTarget as any).baseToughness = parsedTopToughness;
        }
        (mutateTarget as any).isCommander = mutatedPermanent.cardStack.some((entry: any) => entry?.isCommander === true);

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId && mutatingCardId) {
            appendEvent(replayGameId, (state as any).seq ?? 0, 'mutatePermanent', {
              playerId: controller,
              targetPermanentId: String((mutateTarget as any).id || mutateTargetId),
              targetPermanentName: String((mutateTarget as any).card?.name || 'Creature'),
              onTop: mutateOnTop,
              mutatingCard: {
                ...(effectiveCard as any),
                zone: 'battlefield',
              },
            });
          }
        } catch (err) {
          debugWarn(1, '[resolveTopOfStack] appendEvent(mutatePermanent) failed:', err);
        }

        queueMutateTriggeredAbilities(ctx, mutateTarget, controller);

        debug(2, `[resolveTopOfStack] ${effectiveCard.name || 'Mutating creature'} merged with ${String((mutateTarget as any).card?.name || mutateTargetId)}`);
      }

      return { mutateResolved: true };
    }

    debug(2, `[resolveTopOfStack] ${effectiveCard.name || 'Mutating creature'} has no legal mutate target on resolution; resolving as a normal creature`);
  }
  
  state.battlefield.push(newPermanent);
  syncArcaneAdaptationForNewCreature(state, newPermanent);
  applyMetallicMimicEntryBonus(ctx, newPermanent, controller as PlayerID);

  if (cardEntersPrepared(newPermanent.card)) {
    setPermanentPrepared(state, newPermanent);
  }
  
  // Handle Aura and bestow-style enchantment attachments.
  // Bestow permanents stay enchantment creatures in this model but still attach
  // to a target creature while bestowed.
  // IMPORTANT: This must be done AFTER pushing to battlefield so the permanent exists
  const isAura = tl.includes('enchantment') && tl.includes('aura');
  const isBestowAttachment = tl.includes('enchantment') && tl.includes('creature') && /\bbestow\b/i.test(String(effectiveCard.oracle_text || ''));
  const isEquipment = tl.includes('equipment');
  if ((isAura || isBestowAttachment || isEquipment) && targets && targets.length > 0) {
    const targetId = targets[0];
    const targetPerm = state.battlefield.find((p: any) => p?.id === targetId);
    
    if (targetPerm) {
      // Set attachedTo on the aura/equipment
      newPermanent.attachedTo = targetId;
      
      // Track attachment on the target permanent
      // Use attachedEquipment for equipment (existing pattern) and attachments for auras
      if (isEquipment) {
        (targetPerm as any).attachedEquipment = (targetPerm as any).attachedEquipment || [];
        if (!(targetPerm as any).attachedEquipment.includes(newPermId)) {
          (targetPerm as any).attachedEquipment.push(newPermId);
        }
        debug(2, `[resolveTopOfStack] Equipment ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);
      } else {
        // For Auras and bestowed enchantment creatures, use the standard attachments field.
        (targetPerm as any).attachments = (targetPerm as any).attachments || [];
        if (!(targetPerm as any).attachments.includes(newPermId)) {
          (targetPerm as any).attachments.push(newPermId);
        }
        debug(2, `[resolveTopOfStack] ${isBestowAttachment ? 'Bestow permanent' : 'Aura'} ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            appendEvent(replayGameId, (state as any).seq ?? 0, 'attachEnchantmentPermanent', {
              playerId: controller,
              enchantmentId: newPermId,
              enchantmentName: effectiveCard.name || 'Enchantment',
              targetPermanentId: targetId,
              targetPermanentName: targetPerm.card?.name || 'Permanent',
            });
          }
        } catch (err) {
          debugWarn(1, '[resolveTopOfStack] appendEvent(attachEnchantmentPermanent) failed:', err);
        }
      }
    } else {
      debugWarn(2, `[resolveTopOfStack] ${isEquipment ? 'Equipment' : (isBestowAttachment ? 'Bestow permanent' : 'Aura')} ${effectiveCard.name} target ${targetId} not found on battlefield`);
    }
  }
  
  // Build a readable status message for logging
  let statusNote = '';
  if (shouldEnterTapped) {
    statusNote = ' (enters tapped)';
  } else if (hasSummoningSickness) {
    statusNote = ' (summoning sickness)';
  } else if (hasHaste) {
    statusNote = ' (haste)';
  }
  debug(2, `[resolveTopOfStack] Permanent ${effectiveCard.name || 'unnamed'} entered battlefield under ${controller}${statusNote}`);


  return {
    mutateResolved: false,
    newPermanent,
    newPermId,
    isCreature,
    shouldEnterTapped,
    hasSummoningSickness,
    hasHaste,
  };
}
