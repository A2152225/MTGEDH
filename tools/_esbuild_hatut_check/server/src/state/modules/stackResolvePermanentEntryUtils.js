import { uid, parsePT } from "../utils.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { appendEvent } from "../../db/index.js";
import { mergeRetainedCountersForBattlefieldEntry } from "../../../../shared/src/zoneRetainedCounters.js";
import { detectEntersWithCounters } from "./detectEntersWithCounters.js";
import { deriveSelfEntryCountersFromOracleIR } from "../../../../rules-engine/src/oracleIRSelfEntryCounters.js";
import { resolveCommanderCastsFromCommandZoneThisGame } from "../../../../rules-engine/src/oracleIRExecutorCommanderCastCount.js";
import { checkPermanentEntersTapped } from "./triggerPermanentEntersTapped.js";
import { creatureWillHaveHaste } from "./creatureEntryHasteUtils.js";
import { applyCounterModifications } from "./counters_tokens.js";
import { evaluateBattlefieldEntryReplacementEvent } from "./replacement-effects.js";
import { applyTriggeredReanimationEntryRiders } from "./triggerReanimationRiders.js";
import { scheduleWarpDelayedExileOnPermanentEntry } from "./warpDelayedEffects.js";
import {
  scheduleKeywordCastDelayedEffectsOnPermanentEntry,
  spellWasCastWithBlitzPaid,
  spellWasCastWithDashPaid
} from "./keywordCastDelayedEffects.js";
import { applySneakPermanentBattlefieldEntry } from "./sneakCastUtils.js";
import { isCreatureNow } from "../creatureTypeNow.js";
import {
  createMutatedPermanent,
  getMutatedPermanentAbilities,
  getMutatedPermanentCharacteristics
} from "../../../../rules-engine/src/keywordAbilities/mutate.js";
import { syncArcaneAdaptationForNewCreature } from "./chosen-creature-type.js";
import { applyMetallicMimicEntryBonus } from "./triggerChosenTypeSpellUtils.js";
import { cardEntersPrepared, setPermanentPrepared } from "./prepared.js";
import { hydratePermanentCardOracleInPlace, hydrateCardOracleInPlace } from "./cardOracleHydration.js";
import { lookupLocalCardByNameSync } from "../../services/localCardLookup.js";
import { inferTriggeredAbilityTargetMetadata } from "./inferTriggeredAbilityTargetMetadata.js";
import { parseTriggeredAbilitiesFromText, TriggerEvent as ParsedTriggerEvent } from "../../../../rules-engine/src/triggeredAbilities.js";
import { detectMutateTriggers } from "./triggered-abilities.js";
function readPrintedLoyalty(source) {
  if (!source || typeof source !== "object") return void 0;
  const raw = source.loyalty;
  if (raw == null || String(raw).trim() === "") return void 0;
  const parsed = parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function getEnteringPlaneswalkerLoyaltyValue(_state, _controller, card) {
  if (!card || typeof card !== "object") return void 0;
  hydrateCardOracleInPlace(card);
  const direct = readPrintedLoyalty(card);
  if (direct != null) return direct;
  const faces = Array.isArray(card.card_faces) ? card.card_faces : [];
  for (const face of faces) {
    const faceLoyalty = readPrintedLoyalty(face);
    if (faceLoyalty != null) return faceLoyalty;
  }
  const cardName = String(card.name || "").trim();
  if (!cardName) return void 0;
  const record = lookupLocalCardByNameSync(cardName);
  const fromLookup = readPrintedLoyalty(record);
  if (fromLookup != null) return fromLookup;
  const lookupFaces = Array.isArray(record?.card_faces) ? record.card_faces : [];
  for (const face of lookupFaces) {
    const faceLoyalty = readPrintedLoyalty(face);
    if (faceLoyalty != null) return faceLoyalty;
  }
  return void 0;
}
function buildFullTriggeredAbilityText(trigger) {
  const keywordRaw = String(trigger?.keyword || "when").toLowerCase();
  const keyword = keywordRaw === "at" ? "At" : keywordRaw === "whenever" ? "Whenever" : "When";
  const condition = String(trigger?.triggerFilter || trigger?.condition || "this creature mutates").trim();
  const effect = String(trigger?.effect || "").trim();
  const interveningIf = String(trigger?.interveningIfClause || "").trim();
  if (!condition) {
    return effect;
  }
  if (interveningIf) {
    return `${keyword} ${condition}, if ${interveningIf}, ${effect}`.trim();
  }
  return `${keyword} ${condition}, ${effect}`.trim();
}
function queueMutateTriggeredAbilities(ctx, permanent, controller) {
  if (ctx.isReplaying) {
    return;
  }
  const permanentId = String(permanent?.id || "").trim();
  const sourceName = String(permanent?.card?.name || "Triggered ability").trim();
  if (!permanentId) {
    return;
  }
  const cardsToInspect = Array.isArray(permanent?.mutatedStack) && permanent.mutatedStack.length > 0 ? permanent.mutatedStack : [
    {
      name: sourceName,
      oracleText: String(permanent?.card?.oracle_text || "").trim()
    }
  ];
  const mutateTriggers = cardsToInspect.flatMap((entry) => {
    const oracleText = String(entry?.oracleText || "").trim();
    if (!oracleText) return [];
    return parseTriggeredAbilitiesFromText(
      oracleText,
      permanentId,
      controller,
      String(entry?.name || sourceName).trim() || sourceName
    ).filter((trigger) => trigger?.event === ParsedTriggerEvent.MUTATES);
  });
  const seenMutateEffects = new Set(
    mutateTriggers.map((trigger) => String(trigger?.effect || "").trim().toLowerCase()).filter(Boolean)
  );
  for (const entry of cardsToInspect) {
    const oracleText = String(entry?.oracleText || "").trim();
    if (!oracleText) continue;
    const detected = detectMutateTriggers(
      { name: String(entry?.name || sourceName).trim() || sourceName, oracle_text: oracleText },
      permanent
    );
    for (const extra of detected) {
      const effect = String(extra.effect || extra.description || "").trim();
      if (!effect || seenMutateEffects.has(effect.toLowerCase())) continue;
      seenMutateEffects.add(effect.toLowerCase());
      mutateTriggers.push({
        event: ParsedTriggerEvent.MUTATES,
        effect,
        optional: extra.mandatory === false,
        keyword: "whenever",
        condition: "this creature mutates"
      });
    }
  }
  if (mutateTriggers.length === 0) {
    return;
  }
  const state = ctx.state;
  state.stack = state.stack || [];
  const gameId = String(ctx.gameId || "").trim();
  for (const trigger of mutateTriggers) {
    const effectText = String(trigger?.effect || "").trim();
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
      maxTargets
    } = inferTriggeredAbilityTargetMetadata(effectText, {
      gameState: state,
      controllerId: controller,
      sourceName,
      sourcePermanent: permanent
    });
    const triggerId = uid("trigger");
    state.stack.push({
      id: triggerId,
      type: "triggered_ability",
      controller,
      source: permanentId,
      sourceName,
      description: effectText,
      triggerType: "triggered_ability",
      effect: fullText,
      mandatory: trigger?.optional !== true,
      ...requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null,
      ...targetType ? { targetType } : null,
      ...targetConstraint ? { targetConstraint } : null,
      ...targetZone ? { targetZone } : null,
      ...targetDestination ? { targetDestination } : null,
      ...targetGraveyardScope ? { targetGraveyardScope } : null,
      ...destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null,
      ...battlefieldControllerMode ? { battlefieldControllerMode } : null,
      ...battlefieldCounters ? { battlefieldCounters } : null,
      ...targetAction ? { targetAction } : null,
      ...Array.isArray(targetFilterTypes) ? { targetFilterTypes } : null,
      ...Array.isArray(targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords } : null,
      ...Array.isArray(targetFilterExcludeTypes) ? { targetFilterExcludeTypes } : null,
      ...targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null,
      ...typeof targetFilterExactManaValue === "number" ? { targetFilterExactManaValue } : null,
      ...typeof targetFilterMinManaValue === "number" ? { targetFilterMinManaValue } : null,
      ...typeof targetFilterMaxManaValue === "number" ? { targetFilterMaxManaValue } : null,
      ...typeof targetTotalPowerLimit === "number" ? { targetTotalPowerLimit } : null,
      ...targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null,
      ...targetCastIsOptional === true ? { targetCastIsOptional: true } : null,
      ...typeof minTargets === "number" ? { minTargets } : null,
      ...typeof maxTargets === "number" ? { maxTargets } : null
    });
    if (gameId) {
      try {
        appendEvent(gameId, state.seq ?? 0, "pushTriggeredAbility", {
          triggerId,
          sourceId: permanentId,
          permanentId,
          sourceName,
          controllerId: controller,
          description: effectText,
          triggerType: "triggered_ability",
          effect: fullText,
          mandatory: trigger?.optional !== true,
          ...requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null,
          ...targetType ? { targetType } : null,
          ...targetConstraint ? { targetConstraint } : null,
          ...targetZone ? { targetZone } : null,
          ...targetDestination ? { targetDestination } : null,
          ...targetGraveyardScope ? { targetGraveyardScope } : null,
          ...destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null,
          ...battlefieldControllerMode ? { battlefieldControllerMode } : null,
          ...battlefieldCounters ? { battlefieldCounters } : null,
          ...targetAction ? { targetAction } : null,
          ...Array.isArray(targetFilterTypes) ? { targetFilterTypes } : null,
          ...Array.isArray(targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords } : null,
          ...Array.isArray(targetFilterExcludeTypes) ? { targetFilterExcludeTypes } : null,
          ...targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null,
          ...typeof targetFilterExactManaValue === "number" ? { targetFilterExactManaValue } : null,
          ...typeof targetFilterMinManaValue === "number" ? { targetFilterMinManaValue } : null,
          ...typeof targetFilterMaxManaValue === "number" ? { targetFilterMaxManaValue } : null,
          ...typeof targetTotalPowerLimit === "number" ? { targetTotalPowerLimit } : null,
          ...targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null,
          ...targetCastIsOptional === true ? { targetCastIsOptional: true } : null,
          ...typeof minTargets === "number" ? { minTargets } : null,
          ...typeof maxTargets === "number" ? { maxTargets } : null
        });
      } catch (err) {
        debugWarn(1, "[resolveTopOfStack] appendEvent(pushTriggeredAbility mutate) failed:", err);
      }
    }
  }
}
function resolvePermanentSpellBattlefieldEntry(ctx, options) {
  const state = ctx.state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const effectiveTypeLine = options.effectiveTypeLine;
  const item = options.item;
  const targets = options.targets;
  const fallbackOracleText = options.fallbackOracleText;
  const tl = (effectiveTypeLine || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const isPlaneswalker = /\bplaneswalker\b/.test(tl);
  const wasCastWithMorph = item.wasCastWithMorph || false;
  const morphCost = wasCastWithMorph ? item.morphCost : void 0;
  let baseP;
  let baseT;
  if (wasCastWithMorph) {
    baseP = 2;
    baseT = 2;
  } else {
    baseP = isCreature ? parsePT(effectiveCard.power) : void 0;
    baseT = isCreature ? parsePT(effectiveCard.toughness) : void 0;
  }
  const battlefield = state.battlefield || [];
  const gainsHasteUntilEndOfTurnFromManaSpent = isCreature && (item.gainsHasteUntilEndOfTurnFromManaSpent === true || item.card?.gainsHasteUntilEndOfTurnFromManaSpent === true);
  const hasHaste = isCreature && (gainsHasteUntilEndOfTurnFromManaSpent || spellWasCastWithDashPaid(item, effectiveCard) || spellWasCastWithBlitzPaid(item, effectiveCard) || creatureWillHaveHaste(effectiveCard, controller, battlefield));
  const hasSummoningSickness = isCreature && !hasHaste;
  const initialCounters = {};
  if (isPlaneswalker) {
    const startingLoyalty = getEnteringPlaneswalkerLoyaltyValue(state, controller, effectiveCard);
    if (typeof startingLoyalty === "number" && !Number.isNaN(startingLoyalty)) {
      initialCounters.loyalty = startingLoyalty;
      debug(2, `[resolveTopOfStack] Planeswalker ${effectiveCard.name} enters with ${startingLoyalty} loyalty`);
    }
  }
  const oracleTextLower = String(effectiveCard?.oracle_text || fallbackOracleText || "").toLowerCase();
  if (isPlaneswalker && (oracleTextLower.includes("enters with a loyalty counter") && oracleTextLower.includes("for each time") && oracleTextLower.includes("commander from the command zone"))) {
    const totalCommanderCasts = resolveCommanderCastsFromCommandZoneThisGame(state, controller);
    if (totalCommanderCasts > 0) {
      initialCounters.loyalty = (initialCounters.loyalty || 0) + totalCommanderCasts;
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} (Jeska-style): enters with ${totalCommanderCasts} additional loyalty for commander casts`);
    }
  }
  const etbCounters = detectEntersWithCounters(effectiveCard);
  for (const [counterType, count] of Object.entries(etbCounters)) {
    initialCounters[counterType] = (initialCounters[counterType] || 0) + count;
    debug(2, `[resolveTopOfStack] ${effectiveCard.name} enters with ${count} ${counterType} counter(s)`);
  }
  const spellXValue = Number(item?.xValue ?? item?.card?.xValue ?? effectiveCard?.xValue);
  const wasCastKicked = item?.wasKicked === true || item?.card?.wasKicked === true || effectiveCard?.wasKicked === true || Number(item?.timesKicked ?? item?.card?.timesKicked ?? effectiveCard?.timesKicked) > 0 || Number(item?.kickerPaidCount ?? item?.card?.kickerPaidCount ?? effectiveCard?.kickerPaidCount) > 0;
  const irEntryCounters = deriveSelfEntryCountersFromOracleIR({
    oracleText: String(effectiveCard?.oracle_text || fallbackOracleText || ""),
    cardName: String(effectiveCard?.name || item?.cardName || ""),
    xValue: Number.isFinite(spellXValue) ? spellXValue : void 0,
    wasKicked: wasCastKicked
  });
  if (irEntryCounters) {
    for (const [counterType, rawCount] of Object.entries(irEntryCounters)) {
      const count = Number(rawCount || 0);
      if (!Number.isFinite(count) || count <= 0) continue;
      initialCounters[counterType] = Math.max(Number(initialCounters[counterType] || 0), count);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} enters with ${count} ${counterType} counter(s) from self-entry replacement`);
    }
  }
  const explicitEntryCounters = item.entersBattlefieldWithCounters && typeof item.entersBattlefieldWithCounters === "object" ? item.entersBattlefieldWithCounters : effectiveCard?.entersBattlefieldWithCounters && typeof effectiveCard.entersBattlefieldWithCounters === "object" ? effectiveCard.entersBattlefieldWithCounters : void 0;
  if (explicitEntryCounters) {
    for (const [counterType, rawCount] of Object.entries(explicitEntryCounters)) {
      const count = Number(rawCount || 0);
      if (!Number.isFinite(count) || count <= 0) continue;
      initialCounters[counterType] = Math.max(Number(initialCounters[counterType] || 0), count);
    }
  }
  if (isCreature && state.yunaNextCreatureFlags?.[controller]) {
    initialCounters["+1/+1"] = (initialCounters["+1/+1"] || 0) + 2;
    debug(2, `[resolveTopOfStack] Yuna's Grand Summon: ${effectiveCard.name} enters with 2 additional +1/+1 counters`);
    delete state.yunaNextCreatureFlags[controller];
  }
  const shouldEnterTapped = checkPermanentEntersTapped(state.battlefield || [], controller, effectiveCard);
  state.battlefield = state.battlefield || [];
  const newPermId = String(options.preferredPermanentId || item?.id || "").trim() || uid("perm");
  const retainedEntryCounters = mergeRetainedCountersForBattlefieldEntry(
    effectiveCard,
    String(item.source || effectiveCard?.castSourceZone || "hand"),
    initialCounters
  ) || {};
  const tempPerm = { id: newPermId, controller, counters: {} };
  state.battlefield.push(tempPerm);
  const modifiedCounters = applyCounterModifications(state, newPermId, retainedEntryCounters);
  state.battlefield.pop();
  const copiedPermanentSpellBecomesToken = item.isCopy === true;
  const entryReplacement = evaluateBattlefieldEntryReplacementEvent({
    state,
    card: effectiveCard,
    controllerId: String(controller),
    entersTapped: shouldEnterTapped,
    entryCounters: modifiedCounters,
    entersTransformed: Boolean(effectiveCard?.transformed || item?.transformed),
    entersFaceDown: wasCastWithMorph,
    copySourceId: copiedPermanentSpellBecomesToken ? String(item.copiedFromStackItemId || item.copiedFromPermanentId || "") : void 0,
    cause: "spell_resolution"
  });
  const newPermanent = {
    id: newPermId,
    controller,
    owner: controller,
    tapped: shouldEnterTapped,
    ...copiedPermanentSpellBecomesToken ? { isToken: true } : {},
    counters: Object.keys(modifiedCounters).length > 0 ? modifiedCounters : void 0,
    ...entryReplacement.applied ? { battlefieldEntryReplacement: entryReplacement } : {},
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    ...isCreature ? { enteredThisTurn: true } : {},
    card: wasCastWithMorph ? {
      // Face-down card - show generic 2/2 colorless creature
      name: "Face-down Creature",
      type_line: "Creature",
      zone: "battlefield",
      power: "2",
      toughness: "2"
    } : (() => {
      const nextCard = { ...effectiveCard, zone: "battlefield" };
      if ("counters" in nextCard) delete nextCard.counters;
      return nextCard;
    })(),
    // Preserve isCommander flag from stack item if it exists
    isCommander: item.card?.isCommander || effectiveCard.isCommander || false
  };
  if (copiedPermanentSpellBecomesToken && newPermanent.card) {
    newPermanent.card.copiedFromCardId = String(effectiveCard?.id || "").trim() || void 0;
    newPermanent.card.id = newPermId;
    newPermanent.card.isToken = true;
  }
  const leaveBattlefieldReplacementDestination = String(
    effectiveCard?.leaveBattlefieldReplacementDestination || item?.card?.leaveBattlefieldReplacementDestination || ""
  ).trim().toLowerCase();
  const leaveBattlefieldReplacementSourceName = String(
    effectiveCard?.leaveBattlefieldReplacementSourceName || item?.card?.leaveBattlefieldReplacementSourceName || ""
  ).trim();
  const leaveBattlefieldReplacementLifeGain = Number(
    effectiveCard?.leaveBattlefieldReplacementLifeGain || item?.card?.leaveBattlefieldReplacementLifeGain || 0
  );
  if (leaveBattlefieldReplacementDestination === "exile") {
    newPermanent.leaveBattlefieldReplacementDestination = "exile";
    newPermanent.card.leaveBattlefieldReplacementDestination = "exile";
    if (leaveBattlefieldReplacementSourceName) {
      newPermanent.leaveBattlefieldReplacementSourceName = leaveBattlefieldReplacementSourceName;
      newPermanent.card.leaveBattlefieldReplacementSourceName = leaveBattlefieldReplacementSourceName;
    }
    if (leaveBattlefieldReplacementLifeGain > 0) {
      newPermanent.leaveBattlefieldReplacementLifeGain = leaveBattlefieldReplacementLifeGain;
      newPermanent.card.leaveBattlefieldReplacementLifeGain = leaveBattlefieldReplacementLifeGain;
    }
  }
  if (item.manaColorsSpent && Array.isArray(item.manaColorsSpent) && !wasCastWithMorph) {
    newPermanent.manaColorsSpent = item.manaColorsSpent;
    newPermanent.card.manaColorsSpent = item.manaColorsSpent;
  }
  if (typeof item.manaSpentTotal === "number" && !Number.isNaN(item.manaSpentTotal) && !wasCastWithMorph) {
    newPermanent.manaSpentTotal = item.manaSpentTotal;
    newPermanent.card.manaSpentTotal = item.manaSpentTotal;
  }
  if (item.manaSpentBreakdown && typeof item.manaSpentBreakdown === "object" && !wasCastWithMorph) {
    newPermanent.manaSpentBreakdown = item.manaSpentBreakdown;
    newPermanent.card.manaSpentBreakdown = item.manaSpentBreakdown;
  }
  if (typeof item.alternateCostId === "string" && item.alternateCostId.length > 0 && !wasCastWithMorph) {
    newPermanent.alternateCostId = item.alternateCostId;
    newPermanent.card.alternateCostId = item.alternateCostId;
  }
  if (typeof item.manaFromCreaturesSpent === "number" && !Number.isNaN(item.manaFromCreaturesSpent) && !wasCastWithMorph) {
    newPermanent.manaFromCreaturesSpent = item.manaFromCreaturesSpent;
    newPermanent.card.manaFromCreaturesSpent = item.manaFromCreaturesSpent;
  }
  if (Array.isArray(item.convokeTappedCreatures) && !wasCastWithMorph) {
    newPermanent.convokeTappedCreatures = item.convokeTappedCreatures;
    newPermanent.card.convokeTappedCreatures = item.convokeTappedCreatures;
  }
  newPermanent.enteredFromCast = true;
  newPermanent.card.enteredFromCast = true;
  const chosenCreatureType = String(
    item?.chosenCreatureType || effectiveCard?.chosenCreatureType || item?.card?.chosenCreatureType || ""
  ).trim();
  if (chosenCreatureType) {
    newPermanent.chosenCreatureType = chosenCreatureType;
    if (newPermanent.card && typeof newPermanent.card === "object") {
      newPermanent.card.chosenCreatureType = chosenCreatureType;
    }
  }
  const chosenColor = String(
    item?.chosenColor || effectiveCard?.chosenColor || item?.card?.chosenColor || ""
  ).trim();
  if (chosenColor) {
    newPermanent.chosenColor = chosenColor;
    if (newPermanent.card && typeof newPermanent.card === "object") {
      newPermanent.card.chosenColor = chosenColor;
    }
  }
  const chosenCardName = String(
    item?.chosenCardName || effectiveCard?.chosenCardName || item?.card?.chosenCardName || ""
  ).trim();
  if (chosenCardName) {
    newPermanent.chosenCardName = chosenCardName;
    if (newPermanent.card && typeof newPermanent.card === "object") {
      newPermanent.card.chosenCardName = chosenCardName;
    }
  }
  const chosenPlayer = String(
    item?.chosenPlayer || effectiveCard?.chosenPlayer || item?.card?.chosenPlayer || ""
  ).trim();
  if (chosenPlayer) {
    newPermanent.chosenPlayer = chosenPlayer;
    if (newPermanent.card && typeof newPermanent.card === "object") {
      newPermanent.card.chosenPlayer = chosenPlayer;
    }
  }
  if (typeof item.castFromHand === "boolean") {
    newPermanent.castFromHand = item.castFromHand;
    newPermanent.card.castFromHand = item.castFromHand;
  }
  if (typeof item.source === "string" && item.source.length > 0) {
    newPermanent.castSourceZone = item.source;
    newPermanent.card.castSourceZone = item.source;
  }
  if (String(effectiveCard?.castWithAbility || item?.card?.castWithAbility || "").trim().toLowerCase() === "escape") {
    newPermanent.escapedFrom = "graveyard";
    newPermanent.card.escapedFrom = "graveyard";
  }
  if (gainsHasteUntilEndOfTurnFromManaSpent) {
    newPermanent.temporaryAbilities = Array.isArray(newPermanent.temporaryAbilities) ? newPermanent.temporaryAbilities : [];
    const alreadyHasTemporaryHaste = newPermanent.temporaryAbilities.some(
      (entry) => String(entry?.ability || entry?.keyword || entry?.name || "").toLowerCase() === "haste"
    );
    if (!alreadyHasTemporaryHaste) {
      newPermanent.temporaryAbilities.push({ ability: "haste", expiresAt: "end_of_turn" });
    }
    newPermanent.summoningSickness = false;
  }
  if (wasCastWithMorph) {
    newPermanent.isFaceDown = true;
    newPermanent.faceDownType = "morph";
    newPermanent.faceUpCard = effectiveCard;
    newPermanent.morphCost = morphCost;
  }
  if (isPlaneswalker) {
    const resolvedLoyalty = modifiedCounters.loyalty ?? initialCounters.loyalty ?? getEnteringPlaneswalkerLoyaltyValue(state, controller, effectiveCard);
    if (typeof resolvedLoyalty === "number" && resolvedLoyalty > 0) {
      newPermanent.loyalty = resolvedLoyalty;
      newPermanent.baseLoyalty = resolvedLoyalty;
      if (!newPermanent.counters || typeof newPermanent.counters !== "object") {
        newPermanent.counters = { loyalty: resolvedLoyalty };
      } else if (newPermanent.counters.loyalty == null) {
        newPermanent.counters.loyalty = resolvedLoyalty;
      }
    } else {
      debugWarn(1, `[PLANESWALKER] ${effectiveCard.name} entering without loyalty counters`);
    }
    debug(1, `[PLANESWALKER DEBUG] ${effectiveCard.name} entering battlefield:`, {
      loyalty: newPermanent.loyalty,
      baseLoyalty: newPermanent.baseLoyalty,
      counters: newPermanent.counters,
      hasOracleText: !!effectiveCard.oracle_text,
      oracleTextLength: effectiveCard.oracle_text?.length || 0
    });
  }
  applyTriggeredReanimationEntryRiders(
    ctx,
    newPermanent,
    String(effectiveCard?.name || item?.card?.name || "Permanent"),
    controller,
    String(effectiveCard?.oracle_text || "")
  );
  scheduleWarpDelayedExileOnPermanentEntry(
    ctx,
    newPermanent,
    controller,
    String(effectiveCard?.name || item?.card?.name || "Permanent"),
    item
  );
  scheduleKeywordCastDelayedEffectsOnPermanentEntry(
    ctx,
    newPermanent,
    controller,
    String(effectiveCard?.name || item?.card?.name || "Permanent"),
    item
  );
  applySneakPermanentBattlefieldEntry(newPermanent, item);
  hydratePermanentCardOracleInPlace(newPermanent);
  const isMutatingSpell = !wasCastWithMorph && isCreature && (effectiveCard?.isMutating === true || String(item?.alternateCostId || effectiveCard?.alternateCostId || "").toLowerCase().trim() === "mutate");
  if (isMutatingSpell) {
    const mutateTargetId = String(effectiveCard?.mutateTarget || targets?.[0] || "").trim();
    const mutateOnTop = Boolean(effectiveCard?.mutateOnTop);
    const mutateTarget = mutateTargetId ? (state.battlefield || []).find((perm) => perm && String(perm.id || "") === mutateTargetId) : null;
    const mutateTargetTypeLine = String(mutateTarget?.card?.type_line || "").toLowerCase();
    const spellOwner = String(controller || "").trim();
    const targetOwner = String(mutateTarget?.owner || mutateTarget?.controller || "").trim();
    const legalMutateTarget = Boolean(
      mutateTarget && isCreatureNow(mutateTarget) && !mutateTargetTypeLine.includes("human") && targetOwner && targetOwner === spellOwner
    );
    if (legalMutateTarget) {
      const existingMutatedStack = Array.isArray(mutateTarget.mutatedStack) ? mutateTarget.mutatedStack : [];
      const mutatingCardId = String(effectiveCard?.id || "").trim();
      const alreadyMerged = Boolean(mutatingCardId) && existingMutatedStack.some((entry) => String(entry?.id || "") === mutatingCardId);
      if (!alreadyMerged) {
        const existingMutation = existingMutatedStack.length > 0 ? {
          permanentId: String(mutateTarget.id || mutateTargetId),
          controller: String(mutateTarget.controller || controller),
          owner: targetOwner,
          cardStack: existingMutatedStack.map((entry) => ({
            id: String(entry?.id || ""),
            name: String(entry?.name || ""),
            typeLine: String(entry?.typeLine || ""),
            oracleText: String(entry?.oracleText || ""),
            power: entry?.power,
            toughness: entry?.toughness,
            manaCost: entry?.manaCost,
            isOriginal: entry?.isOriginal === true,
            isCommander: entry?.isCommander === true
          })),
          mutationCount: Number(mutateTarget.mutationCount || Math.max(1, existingMutatedStack.length - 1)),
          summoningSicknessInherited: !mutateTarget.summoningSickness
        } : void 0;
        const mutatedPermanent = createMutatedPermanent(
          mutateTarget,
          {
            ...effectiveCard,
            isCommander: item.card?.isCommander || effectiveCard.isCommander || false
          },
          mutateOnTop,
          existingMutation
        );
        const topCharacteristics = getMutatedPermanentCharacteristics(mutatedPermanent);
        const combinedAbilities = getMutatedPermanentAbilities(mutatedPermanent);
        const topCardEntry = mutatedPermanent.cardStack[0];
        mutateTarget.mutatedStack = mutatedPermanent.cardStack.map((entry) => ({
          id: entry.id,
          name: entry.name,
          typeLine: entry.typeLine,
          oracleText: entry.oracleText,
          power: entry.power,
          toughness: entry.toughness,
          manaCost: entry.manaCost,
          isOriginal: entry.isOriginal,
          isCommander: entry.isCommander,
          imageUrl: entry.id === mutatingCardId ? effectiveCard?.image_uris?.small || effectiveCard?.image_uris?.normal : void 0
        }));
        mutateTarget.mutationCount = mutatedPermanent.mutationCount;
        mutateTarget.timesMutated = mutatedPermanent.mutationCount;
        mutateTarget.card = {
          ...mutateTarget.card || {},
          ...mutateOnTop ? { ...effectiveCard } : {},
          id: topCardEntry?.id || mutateTarget.card?.id,
          name: topCharacteristics.name || mutateTarget.card?.name,
          type_line: topCharacteristics.typeLine || mutateTarget.card?.type_line,
          power: topCharacteristics.power ?? mutateTarget.card?.power,
          toughness: topCharacteristics.toughness ?? mutateTarget.card?.toughness,
          mana_cost: topCharacteristics.manaCost ?? mutateTarget.card?.mana_cost,
          oracle_text: combinedAbilities.join("\n") || mutateTarget.card?.oracle_text || "",
          zone: "battlefield"
        };
        const parsedTopPower = parsePT(topCharacteristics.power);
        const parsedTopToughness = parsePT(topCharacteristics.toughness);
        if (parsedTopPower !== void 0) {
          mutateTarget.basePower = parsedTopPower;
        }
        if (parsedTopToughness !== void 0) {
          mutateTarget.baseToughness = parsedTopToughness;
        }
        mutateTarget.isCommander = mutatedPermanent.cardStack.some((entry) => entry?.isCommander === true);
        try {
          const replayGameId = String(ctx.gameId || "").trim();
          if (replayGameId && mutatingCardId && !ctx.isReplaying) {
            appendEvent(replayGameId, state.seq ?? 0, "mutatePermanent", {
              playerId: controller,
              targetPermanentId: String(mutateTarget.id || mutateTargetId),
              targetPermanentName: String(mutateTarget.card?.name || "Creature"),
              onTop: mutateOnTop,
              mutatingCard: {
                ...effectiveCard,
                zone: "battlefield"
              }
            });
          }
        } catch (err) {
          debugWarn(1, "[resolveTopOfStack] appendEvent(mutatePermanent) failed:", err);
        }
        queueMutateTriggeredAbilities(ctx, mutateTarget, controller);
        debug(2, `[resolveTopOfStack] ${effectiveCard.name || "Mutating creature"} merged with ${String(mutateTarget.card?.name || mutateTargetId)}`);
      }
      return { mutateResolved: true };
    }
    debug(2, `[resolveTopOfStack] ${effectiveCard.name || "Mutating creature"} has no legal mutate target on resolution; resolving as a normal creature`);
  }
  state.battlefield.push(newPermanent);
  syncArcaneAdaptationForNewCreature(state, newPermanent);
  applyMetallicMimicEntryBonus(ctx, newPermanent, controller);
  if (cardEntersPrepared(newPermanent.card)) {
    setPermanentPrepared(state, newPermanent);
  }
  const isAura = tl.includes("enchantment") && tl.includes("aura");
  const isBestowAttachment = tl.includes("enchantment") && tl.includes("creature") && /\bbestow\b/i.test(String(effectiveCard.oracle_text || ""));
  const isEquipment = tl.includes("equipment");
  if ((isAura || isBestowAttachment || isEquipment) && targets && targets.length > 0) {
    const targetId = targets[0];
    const targetPerm = state.battlefield.find((p) => p?.id === targetId);
    if (targetPerm) {
      newPermanent.attachedTo = targetId;
      if (isEquipment) {
        targetPerm.attachedEquipment = targetPerm.attachedEquipment || [];
        if (!targetPerm.attachedEquipment.includes(newPermId)) {
          targetPerm.attachedEquipment.push(newPermId);
        }
        debug(2, `[resolveTopOfStack] Equipment ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);
      } else {
        targetPerm.attachments = targetPerm.attachments || [];
        if (!targetPerm.attachments.includes(newPermId)) {
          targetPerm.attachments.push(newPermId);
        }
        debug(2, `[resolveTopOfStack] ${isBestowAttachment ? "Bestow permanent" : "Aura"} ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);
        try {
          const replayGameId = String(ctx.gameId || "").trim();
          if (replayGameId && !ctx.isReplaying) {
            appendEvent(replayGameId, state.seq ?? 0, "attachEnchantmentPermanent", {
              playerId: controller,
              enchantmentId: newPermId,
              enchantmentName: effectiveCard.name || "Enchantment",
              targetPermanentId: targetId,
              targetPermanentName: targetPerm.card?.name || "Permanent"
            });
          }
        } catch (err) {
          debugWarn(1, "[resolveTopOfStack] appendEvent(attachEnchantmentPermanent) failed:", err);
        }
      }
    } else {
      debugWarn(2, `[resolveTopOfStack] ${isEquipment ? "Equipment" : isBestowAttachment ? "Bestow permanent" : "Aura"} ${effectiveCard.name} target ${targetId} not found on battlefield`);
    }
  }
  let statusNote = "";
  if (shouldEnterTapped) {
    statusNote = " (enters tapped)";
  } else if (hasSummoningSickness) {
    statusNote = " (summoning sickness)";
  } else if (hasHaste) {
    statusNote = " (haste)";
  }
  debug(2, `[resolveTopOfStack] Permanent ${effectiveCard.name || "unnamed"} entered battlefield under ${controller}${statusNote}`);
  return {
    mutateResolved: false,
    newPermanent,
    newPermId,
    isCreature,
    shouldEnterTapped,
    hasSummoningSickness,
    hasHaste
  };
}
export {
  queueMutateTriggeredAbilities,
  resolvePermanentSpellBattlefieldEntry
};
