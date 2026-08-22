// server/src/state/modules/applyEvent.ts
// Event application / replay / reset helpers.
//
// Exports:
// - applyEvent(ctx, e)
// - replay(ctx, events)
// - reset(ctx, preservePlayers)
// - skip(ctx, playerId)
// - unskip(ctx, playerId)
// - remove(ctx, playerId)
//
// Defensive implementation: tolerates unknown event types and missing engine helpers.
import { createContext, type GameContext } from "../context";
import type { PlayerID, GameEvent } from "../types";

import { recordCardLeftGraveyardThisTurn, recordCardPutIntoGraveyardThisTurn } from "./turn-tracking.js";
import { pushCardToPlayerGraveyardWithReplacements, buildDiscardProvenanceFields } from "./graveyardEntryUtils.js";
import {
  repairReplayCardSourceZones,
  repairCardIdAwayFromZones,
  repairAllDualZoneGhosts,
  isImpossibleFaceUpNonPermanentBattlefieldCard,
  isFaceDownBattlefieldPermanentFlags,
} from "./stackReplayUtils.js";

import {
  importDeckResolved,
  shuffleLibrary,
  drawCards,
  drawCardsByIds,
  selectFromLibrary,
  moveHandToLibrary,
  reorderHand as zonesReorderHand,
  shuffleHand as zonesShuffleHand,
  peekTopN,
  searchLibrary,
  reconcileZonesConsistency,
  applyScry,
  applySurveil,
  movePermanentToHand,
  applyExplore,
  applyDredgeDrawReplacementChoice,
  applyZursWeirdingOpponentChoice,
} from "./zones";
import { setCommander, castCommander, moveCommanderToCZ } from "./commander";
import { markExhaustAbilityActivated } from './keywordActivationState.js';
import { applyArcaneAdaptationToControllerCreatures } from "./chosen-creature-type.js";
import { applyPermanentBecomeCopyOfTargetPermanent } from "./permanent-copy.js";
import { pushTriggerDoublerCopies } from "./triggers/combat.js";
import { calculateAllPTBonuses, calculateVariablePT, exchangePermanentOracleText, parsePT } from "../utils";
import { filterLibraryCardsForSearch } from "../../socket/library-search.js";
import { applyLoopShortcutStatePatch } from "../../socket/loopShortcutSustain.js";
import {
  updateCounters,
  applyUpdateCountersBulk,
  createToken,
  destroyPermanent,
  removePermanent,
  movePermanentToGraveyard,
  trackCountersPlacedThisTurn,
  trackPermanentSacrificedThisTurn,
  applyEngineEffects,
  runSBA,
  movePermanentToExile,
} from "./counters_tokens";
import { cleanupCardLeavingExile, removePlayableFromExileForCard, stripPlayableFromExileTags } from "./playable-from-exile";
import { cardFromHideawayToHand, clearStoredHideawayCard, storeHideawayExiledCard } from "./hideawayExile.js";
import { buildEmbalmOrEternalizeTokenPermanent } from "./graveyard-tokens.js";
import { clearPreparedPermanent, syncPreparedPermanentAfterControlChange } from "./prepared.js";
import { transformPermanentToFace } from "./day-night.js";
import { processEquippedTriggers } from "./triggerEmissionFamilyUtils.js";
import {
  applyDivineReckoningBatchResult,
  applyPrisonersDilemmaBatchResult,
  clearDivineReckoningChoiceBatch,
  clearPrisonersDilemmaChoiceBatch,
  createDivineReckoningChoiceBatch,
  createPrisonersDilemmaChoiceBatch,
  recordDivineReckoningChoice,
  recordPrisonersDilemmaChoice,
} from "./spellLegacyChoiceBatchUtils.js";
import { castSpell } from "./stackCastSpellUtils.js";
import { exileEntireStack } from "./stackExileUtils.js";
import { playLand } from "./stackPlayLandUtils.js";
import { resolveLandWouldEnterSacrificeChoice, resolveWouldEnterDiscardLandChoice } from "./land-would-enter-replacement.js";
import { pushStack } from "./stackPushUtils.js";
import { resolveTopOfStack } from "./stackResolveTopOfStackUtils.js";
import { triggerETBEffectsForToken } from "./triggerEtbEntryEffects.js";
import { applyRoomDoorLockOrUnlockChoice } from "./triggers/room.js";
import { applyMyriadTokenCopies } from "./triggerMyriadTokenUtils.js";
import { applyGraveyardPermissionEffectsFromText, applyTemporaryGraveyardKeywordGrantFromText, buildCastFromGraveyardCard, getMatchingGraveyardCastingPermission } from "./graveyard-permissions.js";
import { shouldExileStackCardInsteadOfGraveyard } from "./stack-zone-replacements.js";
import { processSpellCounteredTriggers } from "./spellCounteredTriggerUtils.js";
import {
  buildDurablePlayableFromExilePermission,
  getDurableCommandZonePermissionForCard,
  getDurableLandPlayPermissionForCard,
  getDurableLibraryPermissionForCard,
  getDurablePlayableFromExilePermissionForCard,
  recordDurablePermissionUse,
  upsertDurablePermission,
} from "./durable-permissions.js";
import {
  resolveCastPermissionId,
  resolveDurablePermissionForCastReplay,
} from "./castIntent.js";
import { permanentHasKeyword } from "./keyword-handlers";
import { nextTurn, nextStep, passPriority } from "./turn";
import {
  createMutatedPermanent,
  getMutatedPermanentAbilities,
  getMutatedPermanentCharacteristics,
} from "../../../../rules-engine/src/keywordAbilities/mutate.js";

function getReplayStartingPlayerId(state: any): string {
  return String(state?.startingPlayerId || state?.startingPlayer || state?.turnPlayer || '').trim();
}

function getReplayOpeningHandBattlefieldCounters(state: any, card: any, playerId?: string): Record<string, number> {
  const cardName = String(card?.name || '').toLowerCase();
  const startingPlayerId = getReplayStartingPlayerId(state);
  if (cardName === 'gemstone caverns' && startingPlayerId && playerId && playerId !== startingPlayerId) {
    return { luck: 1 };
  }
  return {};
}

function replayAddCreatureType(permanent: any, typeToAdd: string): void {
  if (!permanent?.card) {
    permanent.card = permanent.card || {};
  }
  const formattedType = String(typeToAdd || '').trim().replace(/^./, (char) => char.toUpperCase());
  if (!formattedType) return;
  const currentTypeLine = String(permanent.card.type_line || '');
  if (currentTypeLine.toLowerCase().includes(formattedType.toLowerCase())) {
    return;
  }
  permanent.card.type_line = currentTypeLine.includes('—')
    ? `${currentTypeLine} ${formattedType}`
    : `${currentTypeLine} — ${formattedType}`;
}

function markReplayPermanentEnteredFromZone(permanent: any, zone: string): void {
  const normalizedZone = String(zone || '').trim().toLowerCase();
  if (!permanent || !normalizedZone) return;

  permanent.enteredFromZone = normalizedZone;
  if (normalizedZone === 'graveyard') {
    permanent.enteredFromGraveyard = true;
  }

  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card = {
      ...(permanent.card as any),
      enteredFromZone: normalizedZone,
      ...(normalizedZone === 'graveyard' ? { enteredFromGraveyard: true } : null),
    };
  }

  if (permanent.faceUpCard && typeof permanent.faceUpCard === 'object') {
    permanent.faceUpCard = {
      ...(permanent.faceUpCard as any),
      enteredFromZone: normalizedZone,
      ...(normalizedZone === 'graveyard' ? { enteredFromGraveyard: true } : null),
    };
  }
}

function applyReplayBattlefieldReturnCharacteristics(permanent: any, metadata: any): void {
  if (!permanent || !metadata) return;

  const setTypeLine = String(metadata?.battlefieldSetTypeLine || '').trim();
  if (setTypeLine) {
    permanent.card = { ...(permanent.card || {}), type_line: setTypeLine };
    const isCreature = setTypeLine.toLowerCase().includes('creature');
    if (isCreature) {
      permanent.basePower = parsePT(permanent.card?.power);
      permanent.baseToughness = parsePT(permanent.card?.toughness);
      permanent.summoningSickness = true;
    } else {
      delete permanent.basePower;
      delete permanent.baseToughness;
      delete permanent.summoningSickness;
      delete permanent.card.power;
      delete permanent.card.toughness;
    }
  }

  if (typeof metadata?.battlefieldSetOracleText === 'string') {
    permanent.card = { ...(permanent.card || {}), oracle_text: String(metadata.battlefieldSetOracleText) };
  }

  if (metadata?.battlefieldLoseAllOtherTypes === true && setTypeLine) {
    delete permanent.addedTypes;
    delete permanent.grantedTypes;
  }

  const grantedTypes = Array.isArray(metadata?.battlefieldGrantedTypes) ? metadata.battlefieldGrantedTypes : [];
  for (const typeName of grantedTypes) {
    replayAddCreatureType(permanent, String(typeName || ''));
  }
}

function resolveReplayCommanderId(ctx: any, event: any): string {
  const explicitCommanderId = String(event?.commanderId || '').trim();
  if (explicitCommanderId) return explicitCommanderId;

  const playerId = String(event?.playerId || '').trim();
  const commanderInfo = playerId ? (ctx?.state as any)?.commandZone?.[playerId] : undefined;
  const knownCommanderIds = Array.isArray(commanderInfo?.commanderIds)
    ? commanderInfo.commanderIds.map((id: any) => String(id || '').trim()).filter(Boolean)
    : [];

  const fallbackIds = [event?.cardId, event?.card?.id]
    .map((id: any) => String(id || '').trim())
    .filter(Boolean);

  for (const fallbackId of fallbackIds) {
    if (knownCommanderIds.length === 0 || knownCommanderIds.includes(fallbackId)) {
      return fallbackId;
    }
  }

  const fallbackNames = [event?.cardName, event?.card?.name]
    .map((name: any) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
  const commanderCards = Array.isArray(commanderInfo?.commanderCards) ? commanderInfo.commanderCards : [];
  for (const fallbackName of fallbackNames) {
    const matchedCommander = commanderCards.find((card: any) => String(card?.name || '').trim().toLowerCase() === fallbackName);
    const matchedId = String(matchedCommander?.id || '').trim();
    if (matchedId) {
      return matchedId;
    }
  }

  return '';
}

function normalizeReplayEffectProgramMetadata(metadata: any): Record<string, any> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const effectProgramId = String(metadata.effectProgramId || '').trim();
  const effectProgramStepId = String(metadata.effectProgramStepId || '').trim();
  if (!effectProgramId || !effectProgramStepId) {
    return undefined;
  }

  return {
    effectProgramId,
    effectProgramFamily: metadata.effectProgramFamily ? String(metadata.effectProgramFamily) : undefined,
    effectProgramSourceId: metadata.effectProgramSourceId ? String(metadata.effectProgramSourceId) : undefined,
    effectProgramSourceName: metadata.effectProgramSourceName ? String(metadata.effectProgramSourceName) : undefined,
    effectProgramCursor: Number(metadata.effectProgramCursor || 0),
    effectProgramStepId,
    effectProgramBindingKey: String(metadata.effectProgramBindingKey || ''),
    effectProgramClause: metadata.effectProgramClause,
  };
}

function normalizeChosenTargetRefs(state: any, spec: any, chosen: any[]): any[] {
  return (Array.isArray(chosen) ? chosen : []).map((target: any) => {
    if (!target || typeof target !== 'string') return target;

    if (
      spec?.op === 'COUNTER_TARGET_SPELL' ||
      spec?.op === 'COUNTER_TARGET_ABILITY' ||
      (Array.isArray(state?.stack) && state.stack.some((stackItem: any) => String(stackItem?.id || '') === target))
    ) {
      return { kind: 'stack', id: target };
    }

    if (Array.isArray(state?.players) && state.players.some((player: any) => String(player?.id || '') === target)) {
      return { kind: 'player', id: target };
    }

    return { kind: 'permanent', id: target };
  });
}

function resolveReplayCommanderCard(ctx: any, event: any, commanderId: string): any | undefined {
  if (event?.card && typeof event.card === 'object' && !Array.isArray(event.card)) {
    return event.card;
  }

  const playerId = String(event?.playerId || '').trim();
  const commanderInfo = playerId ? (ctx?.state as any)?.commandZone?.[playerId] : undefined;
  const commanderCards = Array.isArray(commanderInfo?.commanderCards) ? commanderInfo.commanderCards : [];

  if (commanderId) {
    const matchedById = commanderCards.find((card: any) => String(card?.id || '').trim() === commanderId);
    if (matchedById) return matchedById;
  }

  const fallbackNames = [event?.cardName, event?.card?.name]
    .map((name: any) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
  for (const fallbackName of fallbackNames) {
    const matchedByName = commanderCards.find((card: any) => String(card?.name || '').trim().toLowerCase() === fallbackName);
    if (matchedByName) return matchedByName;
  }

  return undefined;
}

function getReplayLibraryForPlayer(ctx: any, playerId: string): any[] {
  if (Array.isArray(ctx?.libraries?.get?.(playerId))) {
    return ctx.libraries.get(playerId);
  }
  if (Array.isArray(ctx?.libraries?.[playerId])) {
    return ctx.libraries[playerId];
  }
  return [];
}

function findReplayCardInZone(ctx: any, playerId: string, zone: string, cardId: string): any | undefined {
  const normalizedZone = String(zone || '').toLowerCase().trim();
  const normalizedCardId = String(cardId || '').trim();
  if (!normalizedZone || !normalizedCardId) return undefined;

  if (normalizedZone === 'library') {
    return getReplayLibraryForPlayer(ctx, playerId).find((card: any) => String(card?.id || '') === normalizedCardId);
  }

  const zoneCards = (ctx?.state as any)?.zones?.[playerId]?.[normalizedZone];
  if (Array.isArray(zoneCards)) {
    const card = zoneCards.find((entry: any) => String(entry?.id || '') === normalizedCardId);
    if (card) return card;
  }

  if (normalizedZone === 'exile') {
    const zones = (ctx?.state as any)?.zones;
    if (zones && typeof zones === 'object') {
      for (const playerZones of Object.values(zones) as any[]) {
        const exileCards = Array.isArray(playerZones?.exile) ? playerZones.exile : [];
        const card = exileCards.find((entry: any) => String(entry?.id || '') === normalizedCardId);
        if (card) return card;
      }
    }
  }

  const playerEntry = Array.isArray((ctx?.state as any)?.players)
    ? ((ctx.state as any).players as any[]).find((entry: any) => String(entry?.id || '') === playerId)
    : undefined;
  const playerZoneCards = playerEntry && Array.isArray(playerEntry[normalizedZone]) ? playerEntry[normalizedZone] : [];
  return playerZoneCards.find((entry: any) => String(entry?.id || '') === normalizedCardId);
}

function resolveReplayCardForPermissionUse(ctx: any, event: any, zone: string, cardData: any): any {
  if (cardData && typeof cardData === 'object') return cardData;

  const playerId = String(event?.playerId || '').trim();
  const cardId = String(cardData || '').trim();
  if (!playerId || !cardId) return { id: cardId || cardData };

  if (zone === 'command') {
    return resolveReplayCommanderCard(ctx, event, cardId) || { id: cardId };
  }

  return findReplayCardInZone(ctx, playerId, zone, cardId) || { id: cardId };
}

function recordReplayDurablePermissionUse(state: any, permission: any): void {
  if (!permission) return;
  const permissionId = resolveCastPermissionId(permission)
    || String(typeof permission === 'string' ? permission : permission?.id || '').trim();
  if (!permissionId && typeof permission?.kind !== 'string') return;
  recordDurablePermissionUse(
    state,
    typeof permission?.kind === 'string' ? permission : permissionId,
  );
}
import { join, leave as leaveModule } from "./join";
import { resolveSpell } from "../../rules-engine/targeting";
import { evaluateAction } from "../../rules-engine/index";
import { mulberry32 } from "../../utils/rng";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { hydratePermanentCardOracleInPlace } from "./cardOracleHydration.js";
import { checkGraveyardTrigger, parsePlaneswalkerAbilities } from "./triggered-abilities.js";
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from "./triggers/damage-received.js";
import { calculateModifiedDamage, processLifeChange, resolveOpponentDirectedDamage } from "./game-state-effects";
import { markEchoPaid, sacrificePermanent } from "./upkeep-triggers";
import { ResolutionQueueManager, ResolutionStepType } from "../resolution/index.js";
import { applyEffectProgramChoiceBindingOnReplay } from "../effects/effectProgramReplayRestore.js";
import { restoreOracleIrLedgerOnState, restoreOracleIrPendingCompoundResumeOnState, clearOracleIrPendingCompoundResumeOnState } from "./oracleIrTransitionPipeline.js";
import { ensureDeferredOracleIrStackItem } from "./oracleIrDeferredStackFinalize.js";
import {
  consumeReplayedTriggeredAbilityStackItems,
  consumeReplayedActivatedAbilityStackItems,
  finalizeGameStateAfterReplay,
  replayPopTopOfStackDuringEventReplay,
  replayResolveAllTriggersDuringEventReplay,
  replayEnsureAsEntersPermanentFromPromptSteps,
  replayEnsureInterveningIfSubjectOnBattlefield,
} from "./replay-prompt-cleanup.js";
import { resolvePromptZoneHandRestore } from "./promptZoneHandSnapshot.js";
import { applyKeywordPromptResolveOutcome } from "./keywordPromptReplayOutcomes.js";
import { applyBattlefieldPermanentReplayPatch } from "../effects/battlefieldPermanentReplayPersistence.js";
import { applyJoinForcesPaidManaPowerPump } from "./joinForcesResolutionQueue.js";
import { parseManaCost } from "./mana-check.js";
import { addRestrictedManaToPool, calculateManaProduction, consumeManaFromPool, getOrInitManaPool, recordCreatureSpellHasteManaProduced, resolveManaCostForPoolPayment } from "../../socket/util.js";
import { parseUpgradeAbilities as parseCreatureUpgradeAbilities } from "../../../../rules-engine/src/creatureUpgradeAbilities.js";
import { detectTutorEffect, getActivatedAbilityScopeText, parseSearchCriteria } from "../../socket/interaction.js";
import { getOpponentMayPayDrawCount, getOpponentMayPayTreasureCount } from "./opponent-may-pay-utils.js";
import { consumeReflexiveManaAmountFromPool } from "./reflexive-triggers.js";
import { moveKynaiosLandFromHandToBattlefield } from "../resolution/handlers/kynaiosChoice.js";
import { applyTriggerOrderToStack } from "../resolution/handlers/triggerOrder.js";
import { executeTriggeredAbilityEffectWithOracleIR } from "../../../../rules-engine/src/triggeredAbilities.js";
import { applyDamageToPermanentWithCounterEffects } from "./counter-common-effects.js";
import {
  applyCreatureDamageFromSource,
  applyFightDamageBetweenCreatures,
  applyPoisonCountersToPlayer,
  inferInfectWitherFlags,
  resolvePlayerDamage,
} from "./combat-damage-processing.js";
import {
  markDungeonCompleted,
  normalizeDungeonProgress,
} from "./dungeons.js";
import {
  applyAutomaticDungeonRoomEffect,
  applyDungeonTargetCreatureEffect,
  applyDungeonTargetPlayerEffect,
} from "./dungeon-effects.js";

/* -------- Helpers ---------- */

/**
 * Generate a deterministic ID for permanents during replay.
 * Uses the game's RNG if available, otherwise uses a counter based on the card ID.
 * This ensures IDs are consistent across replays with the same RNG seed.
 */
function generateDeterministicId(ctx: any, prefix: string, cardId: string): string {
  // Use the game's RNG if available for deterministic ID generation
  if (typeof ctx.rng === 'function') {
    const rngValue = Math.floor(ctx.rng() * 0xFFFFFFFF).toString(36);
    return `${prefix}_${cardId}_${rngValue}`;
  }
  // Fallback: use card ID with a counter (incremented on ctx)
  ctx._idCounter = (ctx._idCounter || 0) + 1;
  return `${prefix}_${cardId}_${ctx._idCounter}`;
}

function getCurrentCombatPowerSnapshot(permanent: any, state: any): number {
  const card = permanent?.card || {};

  let basePower = parsePT((permanent as any)?.basePower);
  if (!Number.isFinite(basePower as number)) {
    basePower = parsePT(card?.power);
  }

  if (!Number.isFinite(basePower as number)) {
    const variablePT = calculateVariablePT({ ...(card || {}), controller: (permanent as any)?.controller }, state);
    if (variablePT && Number.isFinite(variablePT.power)) {
      basePower = Number(variablePT.power);
    }
  }

  const plusCounters = Number((permanent as any)?.counters?.['+1/+1'] || 0);
  const minusCounters = Number((permanent as any)?.counters?.['-1/-1'] || 0);
  let otherCounterPower = 0;

  if ((permanent as any)?.counters && typeof (permanent as any).counters === 'object') {
    for (const [counterType, amountRaw] of Object.entries((permanent as any).counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      const counterMatch = String(counterType).match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (!counterMatch) continue;
      otherCounterPower += parseInt(counterMatch[1], 10) * Number(amountRaw || 0);
    }
  }

  const allBonuses = calculateAllPTBonuses(permanent, state);
  return Math.max(
    0,
    Number(basePower || 0) + plusCounters - minusCounters + otherCounterPower + Number(allBonuses.power || 0)
  );
}

function clearReplayDanceWithCalamitySteps(gameId: string, playerId: string, effectId: string): void {
  if (!gameId) return;

  try {
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    const matchesDanceStep = (step: any): boolean => {
      if (!step) return false;
      const stepType = String(step?.type || '');
      if (String(step?.playerId || '') !== playerId) return false;

      if (stepType === String(ResolutionStepType.DANCE_WITH_CALAMITY) || stepType === String(ResolutionStepType.DANCE_WITH_CALAMITY_CAST)) {
        return !effectId || String(step?.effectId || '') === effectId;
      }

      if (stepType === String(ResolutionStepType.OPTION_CHOICE) && (step as any)?.danceWithCalamityCastPrompt === true) {
        return !effectId || String((step as any)?.danceWithCalamityEffectId || '') === effectId;
      }

      return false;
    };

    const activeStepMatched = matchesDanceStep(queue?.activeStep);
    const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

    if (activeStepMatched) {
      queue.activeStep = undefined;
    }
    if (Array.isArray(queue?.steps) && beforeCount > 0) {
      queue.steps = queue.steps.filter((step: any) => !matchesDanceStep(step));
    }
    if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
      queue.seq = Number(queue?.seq || 0) + 1;
    }
  } catch {
    // best-effort only
  }
}

function clearReplayQueuedSteps(gameId: string, predicate: (step: any) => boolean): void {
  if (!gameId) return;

  try {
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    const activeStepMatched = predicate(queue?.activeStep);
    const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

    if (activeStepMatched) {
      queue.activeStep = undefined;
    }
    if (Array.isArray(queue?.steps) && beforeCount > 0) {
      queue.steps = queue.steps.filter((step: any) => !predicate(step));
    }
    if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
      queue.seq = Number(queue?.seq || 0) + 1;
    }
  } catch {
    // best-effort only
  }
}

function clearReplayQueuedStepById(gameId: string, resolvedStepId: string): void {
  const stepId = String(resolvedStepId || '').trim();
  if (!gameId || !stepId) return;

  clearReplayQueuedSteps(gameId, (step: any) => String(step?.id || '').trim() === stepId);
}

function cloneReplayPayload<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function incrementReplayTokenCreatedTracking(state: any, controllerId: string, amount: number): void {
  const count = Math.max(0, Math.floor(Number(amount || 0)));
  if (!state || !controllerId || count <= 0) return;

  state.tokensCreatedThisTurn = state.tokensCreatedThisTurn || {};
  state.tokenCreatedThisTurn = state.tokenCreatedThisTurn || {};
  state.createdTokenThisTurn = state.createdTokenThisTurn || {};
  state.tokensCreatedThisTurn[controllerId] = Number(state.tokensCreatedThisTurn[controllerId] || 0) + count;
  state.tokenCreatedThisTurn[controllerId] = Number(state.tokenCreatedThisTurn[controllerId] || 0) + count;
  state.createdTokenThisTurn[controllerId] = Number(state.createdTokenThisTurn[controllerId] || 0) + count;
}

function matchesMirrormindOriginalReplayToken(permanent: any, original: any, controllerId: string, desiredTokenIds: Set<string>): boolean {
  if (!permanent || permanent.isToken !== true) return false;
  if (desiredTokenIds.has(String(permanent.id || ''))) return false;
  if (controllerId && String(permanent.controller || '') !== controllerId) return false;

  const originalName = String(original?.name || '').trim();
  if (originalName && String(permanent?.card?.name || '').trim() !== originalName) return false;

  const originalTypeLine = String(original?.options?.typeLine || '').trim();
  if (originalTypeLine && String(permanent?.card?.type_line || '').trim() !== originalTypeLine) return false;

  if (original?.basePower != null && Number(permanent?.basePower) !== Number(original.basePower)) return false;
  if (original?.baseToughness != null && Number(permanent?.baseToughness) !== Number(original.baseToughness)) return false;

  return true;
}

function restoreMirrormindReplayTokens(ctx: GameContext, event: any): void {
  const state = ctx.state as any;
  state.battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];

  const controllerId = String(event?.playerId || event?.mirrormindCrownOriginalTokenCreate?.controller || '').trim();
  const original = event?.mirrormindCrownOriginalTokenCreate || {};
  const snapshots = Array.isArray(event?.createdTokenPermanents)
    ? event.createdTokenPermanents.filter((entry: any) => entry && typeof entry === 'object')
    : [];
  const desiredTokenIds = new Set<string>(snapshots.map((entry: any) => String(entry?.id || '')).filter(Boolean));

  let removedReplayCreatedOriginals = 0;
  if (desiredTokenIds.size > 0) {
    state.battlefield = state.battlefield.filter((permanent: any) => {
      if (!matchesMirrormindOriginalReplayToken(permanent, original, controllerId, desiredTokenIds)) {
        return true;
      }
      removedReplayCreatedOriginals += 1;
      return false;
    });
  }

  let addedSnapshots = 0;
  for (const snapshot of snapshots) {
    const snapshotId = String(snapshot?.id || '').trim();
    if (!snapshotId) continue;
    const alreadyPresent = state.battlefield.some((permanent: any) => String(permanent?.id || '') === snapshotId);
    if (alreadyPresent) continue;
    state.battlefield.push(cloneReplayPayload(snapshot));
    addedSnapshots += 1;
  }

  const equipmentId = String(event?.mirrormindCrownEquipmentId || event?.sourceId || '').trim();
  if (equipmentId) {
    state.mirrormindCrownUsedThisTurn = state.mirrormindCrownUsedThisTurn || {};
    state.mirrormindCrownUsedThisTurn[equipmentId] = true;
  }

  incrementReplayTokenCreatedTracking(state, controllerId, Math.max(0, addedSnapshots - removedReplayCreatedOriginals));
}

function removeReplayCommanderCardFromZones(state: any, playerId: string, commanderId: string, cardId: string): void {
  const zones = state?.zones?.[playerId];
  const ids = new Set([commanderId, cardId].map((id) => String(id || '').trim()).filter(Boolean));
  if (ids.size === 0) return;

  const removeFromArrayZone = (zoneName: string) => {
    const zone = zones?.[zoneName];
    if (!Array.isArray(zone)) return;
    zones[zoneName] = zone.filter((card: any) => !ids.has(String(card?.id || '')));
    const countKey = `${zoneName}Count`;
    if (typeof zones[countKey] === 'number') zones[countKey] = zones[zoneName].length;
  };

  for (const zoneName of ['commandZone', 'graveyard', 'exile', 'hand', 'library']) {
    removeFromArrayZone(zoneName);
  }

  if (Array.isArray(state?.battlefield)) {
    state.battlefield = state.battlefield.filter((permanent: any) => {
      const permanentId = String(permanent?.id || '').trim();
      const permanentCardId = String(permanent?.card?.id || '').trim();
      return !ids.has(permanentId) && !ids.has(permanentCardId);
    });
  }
}

function putReplayCommanderCardInDestination(ctx: GameContext, playerId: string, destinationZone: string, libraryPosition: string, card: any, exileTag?: any): void {
  if (!playerId || !card || typeof card !== 'object') return;
  const state = ctx.state as any;
  state.zones = state.zones || {};
  const zones = state.zones[playerId] = state.zones[playerId] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };

  const zoneName = ['graveyard', 'exile', 'hand', 'library'].includes(destinationZone) ? destinationZone : 'graveyard';
  const zoneCard = {
    ...cloneReplayPayload(card),
    ...(zoneName === 'exile' && exileTag && typeof exileTag === 'object' ? cloneReplayPayload(exileTag) : {}),
    zone: zoneName,
  };
  const cardId = String(zoneCard.id || '').trim();

  if (zoneName === 'library') {
    const libraryFromContext = (ctx as any).libraries?.get?.(playerId);
    const library = Array.isArray(libraryFromContext)
      ? libraryFromContext
      : (Array.isArray(zones.library) ? zones.library : (zones.library = []));
    const alreadyPresent = library.some((entry: any) => cardId && String(entry?.id || '') === cardId);
    if (!alreadyPresent) {
      if (libraryPosition === 'bottom' || libraryPosition === 'shuffle') {
        library.push(zoneCard);
      } else {
        library.unshift(zoneCard);
      }
    }
    zones.libraryCount = library.length;
    if ((ctx as any).libraries?.set) (ctx as any).libraries.set(playerId, library);
    return;
  }

  zones[zoneName] = Array.isArray(zones[zoneName]) ? zones[zoneName] : [];
  const alreadyPresent = zones[zoneName].some((entry: any) => cardId && String(entry?.id || '') === cardId);
  if (!alreadyPresent) {
    zones[zoneName].push(zoneCard);
    const countKey = `${zoneName}Count`;
    zones[countKey] = zones[zoneName].length;
  }
}

function addReplayQueuedStepIfMissing(
  gameId: string,
  rawQueuedStep: unknown,
  defaults: { playerId?: string; description?: string } = {}
): void {
  if (!gameId || !rawQueuedStep || typeof rawQueuedStep !== 'object' || Array.isArray(rawQueuedStep)) return;

  const queuedStep = rawQueuedStep as Record<string, any>;
  const queuedStepType = String(queuedStep.type || '').trim();
  if (!queuedStepType) return;

  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  const queuedStepId = String(queuedStep.id || '').trim();
  const alreadyPresent = Boolean(
    (queuedStepId && queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
    (queuedStepId && Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
  );
  if (alreadyPresent) return;

  ResolutionQueueManager.addStep(gameId, {
    ...queuedStep,
    ...(queuedStepId ? { id: queuedStepId } : {}),
    type: queuedStepType as any,
    playerId: String(queuedStep.playerId || defaults.playerId || '') as any,
    description: String(queuedStep.description || defaults.description || ''),
    mandatory: queuedStep.mandatory !== false,
  } as any);
}

function matchesDungeonRoomPenaltyChoiceStep(step: any, event: any): boolean {
  const stepChoice = step?.dungeonRoomPenaltyChoice;
  if (!stepChoice || !event) return false;

  return (
    String(step?.playerId || '').trim() === String(event?.playerId || '').trim() &&
    String(step?.sourceId || '').trim() === String(event?.sourceId || '').trim() &&
    String(stepChoice?.dungeonId || '').trim() === String(event?.dungeonId || '').trim() &&
    String(stepChoice?.roomId || '').trim() === String(event?.currentRoomId || '').trim()
  );
}

function matchesDungeonRoomPaymentStep(step: any, event: any): boolean {
  const stepPayment = step?.dungeonRoomPayment;
  const eventPayment = event?.dungeonRoomPayment;
  if (!stepPayment || !eventPayment) return false;

  return (
    String(step?.playerId || '').trim() === String(event?.playerId || '').trim() &&
    String(step?.sourceId || '').trim() === String(event?.sourceId || '').trim() &&
    String(stepPayment?.dungeonId || '').trim() === String(eventPayment?.dungeonId || '').trim() &&
    String(stepPayment?.roomId || '').trim() === String(eventPayment?.roomId || '').trim() &&
    String(stepPayment?.paymentType || '').trim() === String(eventPayment?.paymentType || '').trim()
  );
}

function matchesSacrificeSelectionResolveStep(step: any, event: any): boolean {
  if (!step || !event || step?.sacrificeSelection !== true) return false;

  const stepPlayerId = String(step?.playerId || '').trim();
  const eventPlayerId = String(event?.playerId || '').trim();
  if (stepPlayerId !== eventPlayerId) return false;

  const stepSourceId = String(step?.sourceId || '').trim();
  const eventSourceId = String(event?.sourceId || '').trim();
  if (stepSourceId && eventSourceId && stepSourceId !== eventSourceId) return false;

  const stepSourceName = String(step?.sacrificeSourceName || step?.sourceName || '').trim();
  const eventSourceName = String(event?.sourceName || '').trim();
  if (stepSourceName && eventSourceName && stepSourceName !== eventSourceName) return false;

  return String(step?.sacrificePermanentType || 'permanent').trim() === String(event?.permanentType || 'permanent').trim();
}

function matchesDungeonRoomFreeCastChoiceStep(step: any, event: any): boolean {
  const stepChoice = step?.dungeonRoomFreeCastFromHandChoice;
  if (!stepChoice || !event) return false;

  return (
    String(step?.playerId || '').trim() === String(event?.playerId || '').trim() &&
    String(step?.sourceId || '').trim() === String(event?.sourceId || '').trim() &&
    String(stepChoice?.dungeonId || '').trim() === String(event?.dungeonId || '').trim() &&
    String(stepChoice?.roomId || '').trim() === String(event?.currentRoomId || '').trim()
  );
}

function matchesDungeonRoomThroneChoiceStep(step: any, event: any): boolean {
  const stepChoice = step?.dungeonRoomThroneChoice;
  if (!stepChoice || !event) return false;

  return (
    String(step?.playerId || '').trim() === String(event?.playerId || '').trim() &&
    String(step?.sourceId || '').trim() === String(event?.sourceId || '').trim() &&
    String(stepChoice?.dungeonId || '').trim() === String(event?.dungeonId || '').trim() &&
    String(stepChoice?.roomId || '').trim() === String(event?.currentRoomId || '').trim()
  );
}

function ensureReplayPlayerZones(stateAny: any, playerId: string): any {
  const zones = stateAny.zones = stateAny.zones || {};
  return (zones[playerId] = zones[playerId] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  });
}

function mergeCardsIntoReplayExile(playerZones: any, cards: any[]): void {
  const exile = playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];
  const byId = new Set(exile.map((card: any) => String(card?.id || '')).filter(Boolean));
  for (const card of Array.isArray(cards) ? cards : []) {
    const cardId = String(card?.id || '').trim();
    if (!cardId || byId.has(cardId)) continue;
    exile.push({ ...card, zone: 'exile' });
    byId.add(cardId);
  }
  playerZones.exileCount = exile.length;
}

const MANA_CODE_TO_POOL_KEY: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

const MANA_NAME_TO_CODE: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

function normalizeManaColorCode(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (MANA_CODE_TO_POOL_KEY[upper]) return upper;
  const lower = raw.toLowerCase();
  return MANA_NAME_TO_CODE[lower];
}

function normalizeRecordedManaMap(raw: unknown): Record<string, number> {
  const normalized: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalized;

  for (const [key, amountRaw] of Object.entries(raw as Record<string, unknown>)) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount)) continue;

    const lowerKey = String(key || '').trim().toLowerCase();
    if (lowerKey && Object.values(MANA_CODE_TO_POOL_KEY).includes(lowerKey)) {
      normalized[lowerKey] = (normalized[lowerKey] || 0) + amount;
      continue;
    }

    const code = normalizeManaColorCode(key);
    const poolKey = code ? MANA_CODE_TO_POOL_KEY[code] : undefined;
    if (poolKey) {
      normalized[poolKey] = (normalized[poolKey] || 0) + amount;
    }
  }

  return normalized;
}

function getPermanentSpellTypeWords(card: any): string[] {
  const typeLine = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return ['artifact', 'creature', 'enchantment', 'planeswalker', 'battle']
    .filter((typeWord) => new RegExp(`\\b${typeWord}\\b`, 'i').test(typeLine));
}

function recordGraveyardPermanentTypesCastThisTurn(state: any, playerId: string, card: any): void {
  const permanentTypes = getPermanentSpellTypeWords(card);
  if (permanentTypes.length === 0) return;

  state.graveyardPermanentTypesCastThisTurn = state.graveyardPermanentTypesCastThisTurn || {};
  const playerEntry = state.graveyardPermanentTypesCastThisTurn[String(playerId)] =
    state.graveyardPermanentTypesCastThisTurn[String(playerId)] || {};

  for (const typeWord of permanentTypes) {
    playerEntry[typeWord] = true;
  }
}

function inferLegacyManaReplay(rawState: any, permanent: any, playerId: string, manaColor: unknown, abilityId?: unknown): Record<string, number> {
  const chosenColor = normalizeManaColorCode(manaColor);
  const manaProduction = calculateManaProduction(rawState, permanent, playerId, chosenColor, abilityId != null ? String(abilityId) : undefined);
  const addsAllColorsAtOnce = Array.isArray(manaProduction.colors)
    && manaProduction.requiresColorChoice !== true
    && manaProduction.colors.length > 1;
  if (addsAllColorsAtOnce) {
    const amountPerColor = Math.max(1, Math.floor(Number(manaProduction.totalAmount || 0) / manaProduction.colors.length));
    const replayAddedMana: Record<string, number> = {};
    for (const manaSymbol of manaProduction.colors) {
      const poolKey = MANA_CODE_TO_POOL_KEY[String(manaSymbol || '').toUpperCase()];
      if (!poolKey) continue;
      replayAddedMana[poolKey] = Number(replayAddedMana[poolKey] || 0) + amountPerColor;
    }
    return replayAddedMana;
  }

  const producedColor = chosenColor || normalizeManaColorCode(manaProduction.colors?.[0]);
  const poolKey = producedColor ? MANA_CODE_TO_POOL_KEY[producedColor] : undefined;
  if (!poolKey) return {};

  return {
    [poolKey]: Number(manaProduction.totalAmount || 0),
  };
}

function applyRecordedManaToPool(ctx: any, playerId: string, rawMana: unknown): void {
  const normalized = normalizeRecordedManaMap(rawMana);
  if (Object.keys(normalized).length === 0) return;

  const pool = getOrInitManaPool(ctx.state, playerId);
  for (const [poolKey, amount] of Object.entries(normalized)) {
    pool[poolKey] = Number(pool[poolKey] || 0) + Number(amount || 0);
  }
}

function inferLegacyManaLifeEffect(permanent: any, manaColor: unknown): { amount: number; isDamage: boolean } {
  const chosenColor = normalizeManaColorCode(manaColor);
  const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();
  if (chosenColor === 'C') return { amount: 0, isDamage: false };

  const isDamage = oracleText.includes('deals 1 damage to you');
  const isLifePayment = !isDamage && oracleText.includes('{t},') && oracleText.includes('pay 1 life');

  if (!isDamage && !isLifePayment) {
    return { amount: 0, isDamage: false };
  }

  return { amount: 1, isDamage };
}

function getReplayManaActivationCostKey(playerId: string, permanentId: unknown, abilityId?: unknown): string {
  const normalizedPlayerId = String(playerId || '').trim();
  const normalizedPermanentId = String(permanentId || '').trim();
  const normalizedAbilityId = String(abilityId || '').trim();
  if (!normalizedPlayerId || !normalizedPermanentId) {
    return '';
  }

  return normalizedAbilityId
    ? `${normalizedPlayerId}:${normalizedPermanentId}:${normalizedAbilityId}`
    : `${normalizedPlayerId}:${normalizedPermanentId}`;
}

function rememberReplayManaActivationLifeCost(rawState: any, playerId: string, permanentId: unknown, abilityId: unknown, paidLife: number): void {
  const key = getReplayManaActivationCostKey(playerId, permanentId, abilityId);
  const finalPaidLife = Number(paidLife || 0);
  if (!key || !Number.isFinite(finalPaidLife) || finalPaidLife <= 0) {
    return;
  }

  const stateAny = rawState as any;
  stateAny._replayManaActivationLifeCosts = stateAny._replayManaActivationLifeCosts || {};
  stateAny._replayManaActivationLifeCosts[key] = finalPaidLife;
}

function consumeReplayManaActivationLifeCost(rawState: any, playerId: string, permanentId: unknown, abilityId: unknown): number {
  const key = getReplayManaActivationCostKey(playerId, permanentId, abilityId);
  if (!key) {
    return 0;
  }

  const stateAny = rawState as any;
  const markerMap = stateAny._replayManaActivationLifeCosts;
  if (!markerMap || typeof markerMap !== 'object') {
    return 0;
  }

  const paidLife = Number(markerMap[key] || 0);
  delete markerMap[key];
  if (Object.keys(markerMap).length === 0) {
    delete stateAny._replayManaActivationLifeCosts;
  }

  return Number.isFinite(paidLife) && paidLife > 0 ? paidLife : 0;
}

function applyManaAbilityLifeLoss(ctx: any, playerId: string, amount: number, tracksDamage: boolean): void {
  const finalAmount = Number(amount || 0);
  if (!playerId || finalAmount <= 0) return;

  (ctx.state as any).life = (ctx.state as any).life || {};
  const startingLife = Number((ctx.state as any).startingLife || 40);
  const currentLife = Number((ctx.state as any).life?.[playerId] ?? startingLife);
  (ctx.state as any).life[playerId] = Math.max(0, currentLife - finalAmount);

  try {
    if (tracksDamage) {
      (ctx.state as any).damageTakenThisTurnByPlayer = (ctx.state as any).damageTakenThisTurnByPlayer || {};
      (ctx.state as any).damageTakenThisTurnByPlayer[String(playerId)] =
        (((ctx.state as any).damageTakenThisTurnByPlayer[String(playerId)] || 0) + finalAmount);
    }

    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
    (ctx.state as any).lifeLostThisTurn[String(playerId)] =
      (((ctx.state as any).lifeLostThisTurn[String(playerId)] || 0) + finalAmount);
  } catch {
    // best-effort only
  }

  const player = ((ctx.state as any).players || []).find((p: any) => p?.id === playerId);
  if (player) { 
    player.life = (ctx.state as any).life[playerId];
  }
}

function applyRecordedLifePayment(ctx: GameContext, playerId: string, rawAmount: unknown): void {
  const paidLife = Number(rawAmount || 0);
  if (!playerId || !Number.isFinite(paidLife) || paidLife <= 0) return;

  (ctx.state as any).life = (ctx.state as any).life || {};
  const currentLife = Number((ctx.state as any).life?.[playerId] ?? ctx.state.startingLife ?? 40);
  (ctx.state as any).life[playerId] = Math.max(0, currentLife - paidLife);
  (ctx as any).life = (ctx as any).life || {};
  (ctx as any).life[playerId] = (ctx.state as any).life[playerId];

  try {
    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
    (ctx.state as any).lifeLostThisTurn[String(playerId)] =
      (((ctx.state as any).lifeLostThisTurn[String(playerId)] || 0) + paidLife);
  } catch {
    // best-effort only
  }

  const player = ((ctx.state as any).players || []).find((p: any) => p?.id === playerId);
  if (player) {
    player.life = (ctx.state as any).life[playerId];
  }
}

function buildDisturbCastCard(card: any): any {
  const disturbFace = Array.isArray(card?.card_faces) ? card.card_faces[1] : undefined;
  const manaCost = disturbFace?.mana_cost ?? disturbFace?.manaCost ?? card?.mana_cost ?? card?.manaCost;
  return {
    ...card,
    ...(disturbFace || {}),
    id: card?.id,
    name: disturbFace?.name || card?.name,
    type_line: disturbFace?.type_line || disturbFace?.typeLine || card?.type_line,
    oracle_text: disturbFace?.oracle_text || disturbFace?.oracleText || card?.oracle_text,
    mana_cost: manaCost,
    manaCost,
    colors: Array.isArray(disturbFace?.colors) ? disturbFace.colors : card?.colors,
    image_uris: disturbFace?.image_uris || card?.image_uris,
    faceIndex: disturbFace ? 1 : (card?.faceIndex ?? 0),
    zone: 'stack',
    castWithAbility: 'disturb',
    transformed: true,
  };
}

function getOrInitReplayPlayerZones(state: any, playerId: string): any {
  state.zones = state.zones || {};
  const zones = (state.zones[playerId] = state.zones[playerId] || {});
  zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
  zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
  zones.exile = Array.isArray(zones.exile) ? zones.exile : [];
  zones.handCount = Array.isArray(zones.hand) ? zones.hand.length : Number(zones.handCount || 0);
  zones.graveyardCount = Array.isArray(zones.graveyard) ? zones.graveyard.length : Number(zones.graveyardCount || 0);
  zones.exileCount = Array.isArray(zones.exile) ? zones.exile.length : Number(zones.exileCount || 0);
  return zones;
}

function applyReplayCardUpdates(targetCard: any, rawUpdates: unknown): void {
  if (!targetCard || !rawUpdates || typeof rawUpdates !== 'object' || Array.isArray(rawUpdates)) return;

  for (const [key, value] of Object.entries(rawUpdates as Record<string, unknown>)) {
    if (!key) continue;
    if (value === null) {
      delete targetCard[key];
      continue;
    }
    if (Array.isArray(value)) {
      targetCard[key] = value.slice();
      continue;
    }
    if (value && typeof value === 'object') {
      targetCard[key] = { ...(value as Record<string, unknown>) };
      continue;
    }
    targetCard[key] = value;
  }
}

function applyReplayHandCardMove(ctx: GameContext, playerId: string, moveSpec: any): void {
  const cardId = String(moveSpec?.cardId || '').trim();
  const destination = String(moveSpec?.destination || '').trim().toLowerCase();
  if (!playerId || !cardId || !destination) return;

  const zones = getOrInitReplayPlayerZones(ctx.state as any, playerId);
  const hand = zones.hand as any[];
  const handIndex = hand.findIndex((card: any) => card && String(card.id || '') === cardId);
  if (handIndex === -1) return;

  const [card] = hand.splice(handIndex, 1);
  if (!card) return;

  const movedCard = { ...card };
  applyReplayCardUpdates(movedCard, moveSpec?.cardUpdates);

  if (destination === 'graveyard') {
    movedCard.zone = 'graveyard';
    (zones.graveyard as any[]).push(movedCard);
    zones.graveyardCount = (zones.graveyard as any[]).length;
    recordCardPutIntoGraveyardThisTurn(ctx as any, String(playerId), movedCard, { fromBattlefield: false });
  } else if (destination === 'exile') {
    movedCard.zone = 'exile';
    (zones.exile as any[]).push(movedCard);
    zones.exileCount = (zones.exile as any[]).length;
  } else if (destination === 'hand') {
    movedCard.zone = 'hand';
    hand.push(movedCard);
  }

  zones.handCount = hand.length;
}

function applyReplayCardUpdatesInHand(ctx: GameContext, playerId: string, cardId: string, rawUpdates: unknown): void {
  if (!playerId || !cardId) return;

  const zones = getOrInitReplayPlayerZones(ctx.state as any, playerId);
  const card = (zones.hand as any[]).find((entry: any) => entry && String(entry.id || '') === cardId);
  if (!card) return;

  applyReplayCardUpdates(card, rawUpdates);
}

function applyReplaySacrificedPermanent(ctx: GameContext, permanentId: string): void {
  const normalizedPermanentId = String(permanentId || '').trim();
  if (!normalizedPermanentId) return;

  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === normalizedPermanentId);
  if (!permanent) return;

  const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
    ? { ...(permanent.card || {}), zone: 'graveyard' }
    : null;
  const graveyardOwnerId = String(permanent?.owner || permanent?.controller || '').trim();

  try {
    trackPermanentSacrificedThisTurn(ctx.state, permanent);
  } catch {
    // best-effort only
  }

  movePermanentToGraveyard(ctx as any, normalizedPermanentId, true);

  if (tokenGraveyardSnapshot && graveyardOwnerId) {
    const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
    const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
      hand: [],
      handCount: 0,
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    });
    playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

    const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
      if (!card) return false;
      const cardId = String((card as any).id || '').trim();
      const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
      if (cardId && snapshotId) return cardId === snapshotId;
      return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
    });

    if (!alreadyPresent) {
      (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
      playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
    }
  }
}

function applyRecordedPlayLandReplayState(ctx: GameContext, event: any): void {
  const playerId = String(event?.playerId || '').trim();
  const cardId = String(event?.card?.id || event?.cardId || '').trim();
  const persistedPermanentId = String(event?.permanentId || '').trim();
  const graveyardPermissionId = resolveCastPermissionId(event);
  const graveyardPermissionSourceName = String(event?.graveyardPermissionSourceName || event?.card?.graveyardPermissionSourceName || '').trim();
  if (!playerId || !cardId) return;

  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? ((ctx.state as any).battlefield as any[]) : [];
  const permanent = [...battlefield].reverse().find((entry: any) =>
    String(entry?.controller || '') === playerId && String(entry?.card?.id || '') === cardId
  );
  if (!permanent) return;
  if (persistedPermanentId) {
    permanent.id = persistedPermanentId;
  }

  if (graveyardPermissionId) {
    permanent.graveyardPermissionId = graveyardPermissionId;
    permanent.castPermissionId = graveyardPermissionId;
    if (permanent.card && typeof permanent.card === 'object') {
      permanent.card.graveyardPermissionId = graveyardPermissionId;
      permanent.card.castPermissionId = graveyardPermissionId;
    }
  }

  if (graveyardPermissionSourceName) {
    permanent.graveyardPermissionSourceName = graveyardPermissionSourceName;
    if (permanent.card && typeof permanent.card === 'object') {
      permanent.card.graveyardPermissionSourceName = graveyardPermissionSourceName;
    }
  }

  if (typeof event?.entersTapped === 'boolean') {
    permanent.tapped = event.entersTapped;
  }

  if (event?.paidLife != null) {
    applyRecordedLifePayment(ctx, playerId, event.paidLife);
  }
}

function resolveReplayPermanentByEvent(ctx: GameContext, options: {
  permanentId?: unknown;
  playerId?: unknown;
  cardName?: unknown;
}): any | undefined {
  const requestedPermanentId = String(options?.permanentId || '').trim();
  const playerId = String(options?.playerId || '').trim();
  const cardName = String(options?.cardName || '').trim().toLowerCase();
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  if (battlefield.length === 0) {
    return undefined;
  }

  const stateAny = ctx.state as any;
  const replayPermanentAliases = (stateAny.replayPermanentAliases = stateAny.replayPermanentAliases || {});
  const aliasedPermanentId = requestedPermanentId && typeof replayPermanentAliases[requestedPermanentId] === 'string'
    ? String(replayPermanentAliases[requestedPermanentId] || '').trim()
    : '';

  const directMatch = battlefield.find((entry: any) => {
    const entryId = String(entry?.id || '').trim();
    return entryId !== '' && (entryId === requestedPermanentId || entryId === aliasedPermanentId);
  });
  if (directMatch) {
    if (requestedPermanentId && aliasedPermanentId && aliasedPermanentId !== requestedPermanentId) {
      replayPermanentAliases[requestedPermanentId] = String(directMatch.id || '');
    }
    return directMatch;
  }

  if (!playerId || !cardName) {
    return undefined;
  }

  const fallbackMatches = battlefield.filter((entry: any) =>
    String(entry?.controller || '').trim() === playerId &&
    String(entry?.card?.name || '').trim().toLowerCase() === cardName
  );
  if (fallbackMatches.length !== 1) {
    return undefined;
  }

  const resolvedPermanent = fallbackMatches[0];
  if (requestedPermanentId) {
    replayPermanentAliases[requestedPermanentId] = String(resolvedPermanent?.id || '').trim();
  }
  return resolvedPermanent;
}

function consumeRecordedManaCostFromPool(pool: Record<string, number>, manaCost?: string): void {
  if (!pool || !manaCost) return;

  try {
    const resolved = resolveManaCostForPoolPayment(pool as any, manaCost);
    if (resolved && (resolved as any).ok) {
      consumeManaFromPool(pool as any, (resolved as any).coloredCost || {}, (resolved as any).genericCost || 0);
      return;
    }
  } catch {
    // Fall through to the conservative legacy spender below.
  }

  const parsedCost = parseManaCost(manaCost);
  const colorMap: Record<string, keyof typeof pool> = {
    W: 'white',
    U: 'blue',
    B: 'black',
    R: 'red',
    G: 'green',
    C: 'colorless',
  };

  for (const [symbol, amount] of Object.entries(parsedCost.colors || {})) {
    const poolKey = colorMap[String(symbol).toUpperCase()];
    if (!poolKey) continue;
    const current = Number(pool[poolKey] || 0);
    pool[poolKey] = Math.max(0, current - Number(amount || 0));
  }

  let remainingGeneric = Number(parsedCost.generic || 0);
  const spendOrder: Array<keyof typeof pool> = ['colorless', 'white', 'blue', 'black', 'red', 'green'];
  for (const poolKey of spendOrder) {
    if (remainingGeneric <= 0) break;
    const available = Number(pool[poolKey] || 0);
    if (available <= 0) continue;
    const spent = Math.min(available, remainingGeneric);
    pool[poolKey] = available - spent;
    remainingGeneric -= spent;
  }
}

function resolveOpponentMayPaySourceController(ctx: GameContext, e: any): string {
  const persistedSourceController = String(e?.sourceController || '').trim();
  if (persistedSourceController) {
    return persistedSourceController;
  }

  const sourceName = String(e?.sourceName || '').trim().toLowerCase();
  if (!sourceName) {
    return '';
  }

  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const matches = battlefield.filter((permanent: any) =>
    String(permanent?.card?.name || '').trim().toLowerCase() === sourceName
  );

  if (matches.length === 1) {
    return String(matches[0]?.controller || '').trim();
  }

  return '';
}

function applyAIActivateAbilityReplay(ctx: GameContext, e: any): void {
  const playerId = String(e?.playerId || '').trim();
  const permanentId = String(e?.permanentId || '').trim();
  if (!playerId || !permanentId) {
    return;
  }

  const stateAny = ctx.state as any;
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId);
  const sourceName = String(e?.cardName || permanent?.card?.name || 'Ability').trim() || 'Ability';
  const abilityType = String(e?.abilityType || '').trim().toLowerCase();
  const activatedAbilityText = String(e?.activatedAbilityText || e?.abilityText || permanent?.card?.oracle_text || '').trim();

  try {
    const tapped = Array.isArray(e?.tappedPermanents) ? e.tappedPermanents : [];
    if (tapped.length > 0) {
      const tappedSet = new Set(tapped.map((id: any) => String(id)));
      for (const entry of battlefield as any[]) {
        if (entry && tappedSet.has(String(entry.id || ''))) {
          (entry as any).tapped = true;
        }
      }
    }
  } catch {
    // best-effort only
  }

  try {
    const paid = Number(e?.lifePaidForCost || 0);
    if (Number.isFinite(paid) && paid > 0) {
      stateAny.life = stateAny.life || {};
      const current = Number(stateAny.life?.[playerId] ?? ctx.state.startingLife ?? 40);
      stateAny.life[playerId] = Math.max(0, current - paid);
      stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
      stateAny.lifeLostThisTurn[String(playerId)] =
        ((stateAny.lifeLostThisTurn[String(playerId)] || 0) + paid);

      const player = Array.isArray(stateAny.players)
        ? stateAny.players.find((entry: any) => entry && String(entry.id || '') === playerId)
        : null;
      if (player) {
        player.life = stateAny.life[playerId];
      }
    }
  } catch {
    // best-effort only
  }

  try {
    const sacrificed = Array.isArray(e?.sacrificedPermanents) ? e.sacrificedPermanents : [];
    for (const rawId of sacrificed) {
      const id = String(rawId || '').trim();
      if (!id) continue;
      applyReplaySacrificedPermanent(ctx, id);
    }
  } catch {
    // best-effort only
  }

  if (abilityType === 'humble-defector') {
    drawCards(ctx as any, playerId, 2);

    const targetOpponentId = String(e?.targetOpponentId || '').trim();
    if (targetOpponentId) {
      const humbleDefector = Array.isArray(ctx.state?.battlefield)
        ? (ctx.state.battlefield as any[]).find((entry: any) => entry && String(entry.id || '') === permanentId)
        : null;
      if (humbleDefector) {
        const previousController = String((humbleDefector as any).controller || '');
        (humbleDefector as any).controller = targetOpponentId;
        syncPreparedPermanentAfterControlChange(ctx.state, humbleDefector, previousController);
        (humbleDefector as any).summoningSickness = true;
      }
    }

    ctx.bumpSeq();
    return;
  }

  const usesStack = e?.usesStack !== false;
  if (!usesStack || !activatedAbilityText) {
    ctx.bumpSeq();
    return;
  }

  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const stack = stateAny.stack as any[];
  const existing = stack.find((item: any) =>
    item &&
    String(item.type || '') === 'ability' &&
    String(item.controller || '') === playerId &&
    String(item.source || '') === permanentId &&
    String(item.activatedAbilityText || item.description || '') === activatedAbilityText
  );
  if (existing) {
    ctx.bumpSeq();
    return;
  }

  const stackItem: any = {
    id: generateDeterministicId(ctx, 'ability_ai', `${permanentId}:${abilityType || activatedAbilityText}`),
    type: 'ability',
    controller: playerId,
    source: permanentId,
    sourceName,
    description: activatedAbilityText,
    activatedAbilityText,
    card: {
      id: permanentId,
      name: `${sourceName} (ability)`,
      type_line: 'Activated Ability',
      oracle_text: activatedAbilityText || String(permanent?.card?.oracle_text || ''),
      image_uris: permanent?.card?.image_uris,
    },
    targets: [],
  };

  if (abilityType === 'fetch-land') {
    stackItem.abilityType = 'fetch-land';
    stackItem.searchParams = e?.searchParams ? { ...(e.searchParams as Record<string, unknown>) } : undefined;
  }

  stack.push(stackItem);
  ctx.bumpSeq();
}

function applyOpponentMayPayResolve(ctx: GameContext, e: any): void {
  const decidingPlayer = String(e?.decidingPlayer || e?.playerId || '').trim();
  const sourceName = String(e?.sourceName || '').trim();
  const manaCost = String(e?.manaCost || '').trim();
  const willPay = e?.willPay === true;
  const effectText = String(e?.declineEffect || e?.triggerText || '').trim();

  if (willPay) {
    if (e?.manaAlreadyPaid === true) {
      return;
    }
    if (decidingPlayer && manaCost) {
      const stateAny = ctx.state as any;
      stateAny.manaPool = stateAny.manaPool || {};
      stateAny.manaPool[decidingPlayer] = stateAny.manaPool[decidingPlayer] || {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      };

      consumeRecordedManaCostFromPool(stateAny.manaPool[decidingPlayer], manaCost);
      ctx.bumpSeq();
    }
    return;
  }

  const sourceController = resolveOpponentMayPaySourceController(ctx, e);
  if (!sourceController) {
    debugWarn(2, `[applyEvent] opponentMayPayResolve: missing sourceController for ${sourceName || 'unknown source'}`);
    return;
  }

  const recordedDrawCount = Math.max(0, Number(e?.declineDrawCount ?? 0) || 0);
  const recordedTreasureCount = Math.max(0, Number(e?.declineTreasureCount ?? 0) || 0);
  const drawCount = recordedDrawCount > 0 ? recordedDrawCount : getOpponentMayPayDrawCount(sourceName, effectText);
  const treasureCount = recordedTreasureCount > 0
    ? recordedTreasureCount
    : getOpponentMayPayTreasureCount(sourceName, effectText);

  let appliedDeclineOutcome = false;
  if (drawCount > 0) {
    drawCards(ctx as any, sourceController as PlayerID, drawCount);
    appliedDeclineOutcome = true;
  }

  if (treasureCount > 0) {
    createToken(
      ctx as any,
      sourceController as PlayerID,
      'Treasure',
      treasureCount,
      undefined,
      undefined,
      {
        colors: [],
        typeLine: 'Token Artifact — Treasure',
        abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
        isArtifact: true,
        skipEventPersistence: true,
      }
    );
    appliedDeclineOutcome = true;
  }

  if (appliedDeclineOutcome) {
    return;
  }

  debugWarn(
    2,
    `[applyEvent] opponentMayPayResolve: unsupported decline effect for ${sourceName || 'unknown source'} (${effectText || 'no effect text'})`
  );
}

function extractReplayActivationCost(fullAbilityText: string): {
  requiresTap: boolean;
  manaCost: string;
  sacrificesSource: boolean;
} {
  const costMatch = String(fullAbilityText || '').match(/^([^:]+):/i);
  const costStr = String(costMatch?.[1] || '').trim().toLowerCase();
  const manaCostMatch = costStr.match(/\{[^}]+\}/g);
  const manaCost = manaCostMatch
    ? manaCostMatch.filter(symbol => !/^\{[tq]\}$/i.test(symbol)).join('')
    : '';

  return {
    requiresTap: costStr.includes('{t}') || costStr.includes('tap'),
    manaCost,
    sacrificesSource: /\bsacrifice\s+(?:this|~)\b/i.test(costStr),
  };
}

function snapshotLibraryForReplay(ctx: GameContext, playerId: string): any[] {
  const zoneLibrary = ((ctx.state as any)?.zones?.[playerId]?.library || []) as any[];
  const libraryCards = ctx.libraries.get(playerId as any) || zoneLibrary;
  return libraryCards.map((libraryCard: any) => ({
    id: libraryCard.id,
    name: libraryCard.name,
    type_line: libraryCard.type_line,
    oracle_text: libraryCard.oracle_text,
    image_uris: libraryCard.image_uris,
    card_faces: libraryCard.card_faces,
    layout: libraryCard.layout,
    mana_cost: libraryCard.mana_cost,
    cmc: libraryCard.cmc,
    colors: libraryCard.colors,
    power: libraryCard.power,
    toughness: libraryCard.toughness,
    loyalty: libraryCard.loyalty,
    color_identity: libraryCard.color_identity,
  }));
}

function cloneLibraryCards(cards: any[]): any[] {
  return Array.isArray(cards) ? cards.map((card: any) => ({ ...card, zone: 'library' })) : [];
}

function getPlayerLibraryFromContext(ctx: any, playerId: string): any[] {
  const pid = String(playerId || '').trim();
  if (!pid) return [];
  const fromMap = ctx?.libraries?.get?.(pid);
  if (Array.isArray(fromMap) && fromMap.length > 0) {
    return fromMap.map((card: any) => ({ ...card }));
  }
  const fromZones = (ctx?.state as any)?.zones?.[pid]?.library;
  return Array.isArray(fromZones) ? fromZones.map((card: any) => ({ ...card })) : [];
}

function extractLibraryCardsByIds(library: readonly any[], ids: readonly string[]): {
  remainder: any[];
  extracted: any[];
} {
  const lib = Array.isArray(library) ? library.map((card: any) => ({ ...card })) : [];
  const extracted: any[] = [];
  for (const rawId of ids) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    const idx = lib.findIndex((card: any) => String(card?.id || '') === id);
    if (idx < 0) continue;
    extracted.push({ ...lib.splice(idx, 1)[0], zone: 'library' });
  }
  return {
    remainder: lib.map((card: any) => ({ ...card, zone: 'library' })),
    extracted,
  };
}

function buildLibraryAfterPutOnBottom(library: readonly any[], orderedBottomIds: readonly string[]): any[] {
  const { remainder, extracted } = extractLibraryCardsByIds(library, orderedBottomIds);
  return [...remainder, ...extracted];
}

function buildLibraryAfterPutOnTop(
  library: readonly any[],
  orderedTopIds: readonly string[],
  shuffledRemainderIds?: readonly string[],
): any[] {
  const { remainder, extracted: topCards } = extractLibraryCardsByIds(library, orderedTopIds);
  if (Array.isArray(shuffledRemainderIds) && shuffledRemainderIds.length > 0) {
    const { remainder: leftover, extracted: remainderOrdered } = extractLibraryCardsByIds(remainder, shuffledRemainderIds);
    return [...topCards, ...remainderOrdered, ...leftover];
  }
  return [...topCards, ...remainder];
}

function buildLibraryAfterAppendOrderedBottom(
  library: readonly any[],
  orderedCardIds: readonly string[],
  bottomCards: readonly any[],
): any[] {
  const lib = Array.isArray(library) ? library.map((card: any) => ({ ...card, zone: 'library' })) : [];
  const byId = new Map<string, any>(
    (Array.isArray(bottomCards) ? bottomCards : []).map((card: any) => [String(card?.id || ''), card]),
  );
  for (const rawId of orderedCardIds) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    const card = byId.get(id);
    if (card) {
      lib.push({ ...card, zone: 'library' });
    }
  }
  return lib;
}

function reorderLibraryByIdList(library: readonly any[], orderedIds: readonly string[]): any[] {
  const byId = new Map<string, any>();
  for (const card of Array.isArray(library) ? library : []) {
    const id = String(card?.id || '').trim();
    if (id) byId.set(id, card);
  }
  const ordered: any[] = [];
  const seen = new Set<string>();
  for (const rawId of orderedIds) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    const card = byId.get(id);
    if (card) {
      ordered.push({ ...card, zone: 'library' });
      seen.add(id);
    }
  }
  for (const card of Array.isArray(library) ? library : []) {
    const id = String(card?.id || '').trim();
    if (id && !seen.has(id)) {
      ordered.push({ ...card, zone: 'library' });
    }
  }
  return ordered;
}

function buildLibraryAfterRemovingSelectedCards(
  library: readonly any[],
  selectedCardIds: readonly string[],
): any[] {
  const removeSet = new Set(
    selectedCardIds.map((id) => String(id || '').trim()).filter(Boolean),
  );
  return (Array.isArray(library) ? library : [])
    .filter((card: any) => !removeSet.has(String(card?.id || '')))
    .map((card: any) => ({ ...card, zone: 'library' }));
}

function buildLibraryAfterSearchResolve(
  library: readonly any[],
  selectedCardIds: readonly string[],
  remainingLibraryIds?: readonly string[],
): any[] {
  if (Array.isArray(remainingLibraryIds)) {
    const { extracted: selectedCards } = extractLibraryCardsByIds(library, selectedCardIds);
    return buildLibraryFromRemainingIds(library, selectedCards, remainingLibraryIds);
  }
  return buildLibraryAfterRemovingSelectedCards(library, selectedCardIds);
}

function buildLibraryAfterCascadeResolve(
  library: readonly any[],
  exiledCards: readonly any[],
  remainingLibraryIds: readonly string[],
  bottomCardIds: readonly string[],
): any[] {
  const byId = new Map<string, any>();
  for (const card of [...library, ...exiledCards]) {
    const id = String(card?.id || '').trim();
    if (id) byId.set(id, card);
  }
  const remaining = remainingLibraryIds
    .map((id) => byId.get(String(id || '').trim()))
    .filter(Boolean)
    .map((card: any) => ({ ...card, zone: 'library' }));
  const bottom = bottomCardIds
    .map((id) => byId.get(String(id || '').trim()))
    .filter(Boolean)
    .map((card: any) => ({ ...card, zone: 'library' }));
  return [...remaining, ...bottom];
}

function buildLibraryAfterPonderResolve(
  library: readonly any[],
  params: {
    lookedAtCardIds: readonly string[];
    libraryTopOrder?: readonly string[];
    shuffledLibraryIds?: readonly string[];
    shouldShuffle?: boolean;
    toHandCardIds?: readonly string[];
    drawnCardId?: string;
    lookedAtCards?: readonly any[];
  },
): any[] {
  const cardById = new Map<string, any>();
  for (const card of [...library, ...(params.lookedAtCards || [])]) {
    const id = String(card?.id || '').trim();
    if (id) cardById.set(id, card);
  }

  const toHandSet = new Set((params.toHandCardIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  const drawnId = String(params.drawnCardId || '').trim();
  const { remainder, extracted } = extractLibraryCardsByIds(library, params.lookedAtCardIds);

  if (params.shouldShuffle && Array.isArray(params.shuffledLibraryIds) && params.shuffledLibraryIds.length > 0) {
    const shufflePool = [
      ...remainder,
      ...extracted.filter((card: any) => {
        const id = String(card?.id || '').trim();
        return id && !toHandSet.has(id) && id !== drawnId;
      }),
    ];
    return reorderLibraryByIdList(shufflePool, params.shuffledLibraryIds);
  }

  const backToLibraryIds = (params.libraryTopOrder || [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && !toHandSet.has(id) && id !== drawnId);
  const backCards = backToLibraryIds
    .map((id) => cardById.get(id))
    .filter(Boolean)
    .map((card: any) => ({ ...card, zone: 'library' }));
  return [...backCards, ...remainder];
}

function buildLibraryFromRemainingIds(
  library: readonly any[],
  extraCards: readonly any[],
  remainingLibraryIds: readonly string[],
): any[] {
  const byId = new Map<string, any>();
  for (const card of [...library, ...extraCards]) {
    const id = String(card?.id || '').trim();
    if (id) byId.set(id, card);
  }
  return remainingLibraryIds
    .map((id) => byId.get(String(id || '').trim()))
    .filter(Boolean)
    .map((card: any) => ({ ...card, zone: 'library' }));
}

function eventHasOwnField(event: unknown, field: string): boolean {
  return Boolean(event && typeof event === 'object' && Object.prototype.hasOwnProperty.call(event, field));
}

/**
 * reset(ctx, preservePlayers)
 * Conservative fallback reset used when no specialized engine reset is available.
 */
export function reset(ctx: any, preservePlayers = false): void {
  if (!ctx) throw new Error("reset: missing ctx");

  // Clear unified ResolutionQueue state for this game. This prevents stale
  // pending interactions from blocking subsequent replays/undo.
  try {
    const gameId = (ctx as any).gameId;
    if (typeof gameId === 'string' && gameId.trim()) {
      ResolutionQueueManager.clearAllSteps(gameId);
    }
  } catch {
    // best-effort only
  }

  // Prefer specialized reset if present on ctx or a global replayModule
  try {
    // @ts-ignore - global replayModule if present
    const globalObj = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
    if (
      typeof (globalObj as any).replayModule !== "undefined" &&
      (globalObj as any).replayModule &&
      typeof (globalObj as any).replayModule.reset === "function"
    ) {
      (globalObj as any).replayModule.reset(ctx, preservePlayers);
      return;
    }
  } catch {
    // continue to fallback
  }

  if (typeof ctx.reset === "function") {
    try {
      ctx.reset(preservePlayers);
      return;
    } catch (err) {
      debugWarn(2, "reset: ctx.reset threw, falling back:", err);
    }
  }

  // Fallback conservative reset
  try {
    const currentState = (ctx.state && typeof ctx.state === 'object') ? ctx.state : {};
    const preservedGameId = String((currentState as any).id || ctx.gameId || '').trim() || String(ctx.gameId || 'game');
    const preservedFormat = (currentState as any).format;
    const preservedStartingLife = Number((currentState as any).startingLife);
    const preservedTurnDirection = Number((currentState as any).turnDirection);

    const preservedZonesRef = (currentState as any).zones && typeof (currentState as any).zones === 'object'
      ? (currentState as any).zones
      : {};
    const preservedLifeRef = (currentState as any).life && typeof (currentState as any).life === 'object'
      ? (currentState as any).life
      : {};
    const preservedCommandZoneRef = (currentState as any).commandZone && typeof (currentState as any).commandZone === 'object'
      ? (currentState as any).commandZone
      : {};
    const preservedLandsPlayedThisTurnRef = (currentState as any).landsPlayedThisTurn && typeof (currentState as any).landsPlayedThisTurn === 'object'
      ? (currentState as any).landsPlayedThisTurn
      : {};
    // Snapshot mana pool (object values, not reference) to survive the reset for
    // replay scenarios that depend on the initial mana state.
    const preservedManaPool: Record<string, any> = {};
    if (preservePlayers && (currentState as any).manaPool && typeof (currentState as any).manaPool === 'object') {
      for (const [pid, pool] of Object.entries((currentState as any).manaPool)) {
        if (pool && typeof pool === 'object') {
          preservedManaPool[pid] = { ...(pool as any) };
        }
      }
    }
    const preservedGraveyards: Record<string, any[]> = {};
    const preservedPlayers = preservePlayers && Array.isArray((currentState as any).players)
      ? ((currentState as any).players as any[]).map((player: any) => ({ ...player }))
      : [];

    // preserve participants list if requested
    let participantsBackup: Array<any> = [];
    if (preservePlayers) {
      if (typeof ctx.participants === "function") {
        try {
          participantsBackup = ctx.participants().slice();
        } catch {
          participantsBackup = [];
        }
      } else if (Array.isArray((ctx as any).participantsList)) {
        participantsBackup = (ctx as any).participantsList.slice();
      }
    }

    const freshCtx = createContext(preservedGameId);
    const targetState = currentState as Record<string, any>;
    for (const key of Object.keys(preservedZonesRef)) {
      delete preservedZonesRef[key];
    }
    for (const key of Object.keys(preservedLifeRef)) {
      delete preservedLifeRef[key];
    }
    for (const key of Object.keys(preservedCommandZoneRef)) {
      delete preservedCommandZoneRef[key];
    }
    for (const key of Object.keys(preservedLandsPlayedThisTurnRef)) {
      delete preservedLandsPlayedThisTurnRef[key];
    }
    for (const key of Object.keys(targetState)) {
      delete targetState[key];
    }
    Object.assign(targetState, freshCtx.state);
    targetState.zones = preservedZonesRef;
    targetState.life = preservedLifeRef;
    targetState.commandZone = preservedCommandZoneRef;
    targetState.landsPlayedThisTurn = preservedLandsPlayedThisTurnRef;
    ctx.state = targetState;

    if (preservedFormat != null) {
      (ctx.state as any).format = preservedFormat;
    }
    if (Number.isFinite(preservedStartingLife) && preservedStartingLife > 0) {
      (ctx.state as any).startingLife = preservedStartingLife;
    }
    if (Number.isFinite(preservedTurnDirection) && Math.abs(preservedTurnDirection) === 1) {
      (ctx.state as any).turnDirection = preservedTurnDirection;
    }


    ctx.libraries = new Map<string, any[]>();
    ctx.life = (ctx.state as any).life || {};
    ctx.poison = {};
    ctx.experience = {};
    ctx.commandZone = (ctx.state as any).commandZone || {};
    ctx.pendingInitialDraw = new Set<string>();
    ctx.handVisibilityGrants = new Map();
    ctx.revealedLibraryTopByOwner = new Map();
    ctx.inactive = new Set<string>();
    ctx.landsPlayedThisTurn = (ctx.state as any).landsPlayedThisTurn || {};
    if (Object.keys(preservedManaPool).length > 0) {
      (ctx.state as any).manaPool = (ctx.state as any).manaPool || {};
      for (const [pid, pool] of Object.entries(preservedManaPool)) {
        (ctx.state as any).manaPool[pid] = pool;
      }
      ctx.manaPool = (ctx.state as any).manaPool;
    }
    ctx.maxLandsPerTurn = {};
    ctx.additionalDrawsPerTurn = {};
    ctx.manaPool = {};

    if (!preservePlayers) {
      (ctx.state as any).players = [];
    } else {
      (ctx.state as any).players = preservedPlayers;

      const playerIds = preservedPlayers.length > 0
        ? preservedPlayers.map((player: any) => String(player?.id || '').trim()).filter(Boolean)
        : participantsBackup.map((participant) => String(participant?.playerId || '').trim()).filter(Boolean);

      for (const pid of playerIds) {
        (ctx.state as any).zones[pid] = {
          hand: [],
          handCount: 0,
          library: [],
          libraryCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        };
        ctx.libraries.set(pid, []);
        ctx.life[pid] = Number((ctx.state as any).startingLife || 40);
        ctx.poison[pid] = 0;
        ctx.experience[pid] = 0;

        const playerEntry = ((ctx.state as any).players || []).find((player: any) => String(player?.id || '').trim() === pid);
        if (playerEntry) {
          playerEntry.life = ctx.life[pid];
        }
      }
    }

    // Clear pending initial draw flags to avoid double-draws
    if (
      (ctx as any).pendingInitialDraw &&
      typeof (ctx as any).pendingInitialDraw.clear === "function"
    ) {
      (ctx as any).pendingInitialDraw.clear();
    } else {
      (ctx as any).pendingInitialDraw = new Set<string>();
    }

    // Clear RNG state so it can be properly re-initialized from rngSeed event during replay
    // This is critical for undo to work correctly - the RNG must be reset to produce
    // the same shuffle/draw sequence when events are replayed
    try {
      ctx.rngSeed = null;
      // Create a fresh RNG function that will be replaced by rngSeed event
      // Using a new random seed as fallback in case no rngSeed event exists
      const fallbackSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      ctx.rng = mulberry32(fallbackSeed);
    } catch {
      // ignore RNG reset errors
    }

    // Reset bump/seq if present
    try {
      if (ctx.passesInRow && typeof ctx.passesInRow === "object" && "value" in ctx.passesInRow) {
        ctx.passesInRow.value = 0;
      }
      if (ctx.seq && typeof ctx.seq === "object" && "value" in ctx.seq)
        ctx.seq.value = 0;
      if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
    } catch {
      // ignore
    }
  } catch (err) {
    debugWarn(1, "reset fallback failed:", err);
  }
}

/* Skip / unskip / remove fallbacks (prefer module implementations) */
export function skip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("skip: missing ctx");
  if (typeof (ctx as any).skip === "function") {
    (ctx as any).skip(playerId);
    return;
  }
  try {
    if (!((ctx as any).inactive instanceof Set))
      (ctx as any).inactive = new Set<PlayerID>();
    (ctx as any).inactive.add(playerId);
    if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, "skip fallback failed:", err);
  }
}

export function unskip(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("unskip: missing ctx");
  if (typeof (ctx as any).unskip === "function") {
    (ctx as any).unskip(playerId);
    return;
  }
  try {
    if ((ctx as any).inactive instanceof Set)
      (ctx as any).inactive.delete(playerId);
    if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, "unskip fallback failed:", err);
  }
}

export function remove(ctx: any, playerId: PlayerID): void {
  if (!ctx) throw new Error("remove: missing ctx");
  if (typeof (ctx as any).remove === "function") {
    (ctx as any).remove(playerId);
    return;
  }
  try {
    // Remove from participants list
    if (Array.isArray((ctx as any).participantsList)) {
      const idx = (ctx as any).participantsList.findIndex(
        (p: any) => p.playerId === playerId
      );
      if (idx !== -1) (ctx as any).participantsList.splice(idx, 1);
    }
    // Remove player data from state and maps
    if (Array.isArray(ctx.state?.players)) {
      const i = (ctx.state.players as any[]).findIndex(
        (p: any) => p.id === playerId
      );
      if (i >= 0) (ctx.state.players as any[]).splice(i, 1);
    }
    if (ctx.libraries && typeof ctx.libraries.delete === "function")
      ctx.libraries.delete(playerId);
    if (ctx.state.zones && ctx.state.zones[playerId])
      delete ctx.state.zones[playerId];
    if (ctx.life && ctx.life[playerId] !== undefined) delete ctx.life[playerId];
    if (ctx.poison && ctx.poison[playerId] !== undefined)
      delete ctx.poison[playerId];
    if (ctx.experience && ctx.experience[playerId] !== undefined)
      delete ctx.experience[playerId];
    if (ctx.grants instanceof Map) {
      for (const [owner, set] of ctx.grants.entries()) {
        if (set instanceof Set && set.has(playerId)) set.delete(playerId);
      }
    }
    try {
      if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
    } catch {}
  } catch (err) {
    debugWarn(1, "remove fallback failed:", err);
  }
}

/* -------- Core applyEvent implementation ---------- */

/**
 * Apply a single persisted game event into the provided GameContext.
 * Tolerant: unknown event types are logged and ignored.
 */
export function applyEvent(ctx: GameContext, e: GameEvent) {
  if (!e || typeof e.type !== "string") return;

  try {
    switch (e.type) {
      case "rngSeed": {
        ctx.rngSeed = (e as any).seed >>> 0;
        try {
          (ctx.state as any).rngSeed = ctx.rngSeed;
        } catch {}
        // mulberry32 inline
        ctx.rng = (function (seed: number) {
          let t = seed >>> 0;
          return function () {
            t = (t + 0x6d2b79f5) >>> 0;
            let r = t;
            r = Math.imul(r ^ (r >>> 15), r | 1);
            r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
          };
        })(ctx.rngSeed);
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "loopShortcutBatchStart":
      case "loopShortcutBatchEnd": {
        // Markers only — real mutations are either per-action events or loopShortcutBatchApply.
        break;
      }

      case "loopShortcutBatchApply": {
        // Compressed end-state from a self-sustaining (or large) Loop Shortcut batch.
        try {
          applyLoopShortcutStatePatch(ctx.state as any, (e as any).statePatch);
        } catch (err) {
          debugWarn(1, "[applyEvent] loopShortcutBatchApply failed", err);
        }
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "proposeLoopShortcut": {
        // Multiplayer CR 731-style consent: live sets state.pendingLoopShortcut.
        // When opponentIds is empty, live auto-approves and clears pending in the same handler
        // (no resolveLoopShortcutConsent event) — mirror that end state.
        try {
          const proposalId = String((e as any).proposalId || "").trim();
          const proposerId = String((e as any).proposerId || "").trim();
          const requestedIterations = Math.max(
            1,
            Math.min(1000, Math.floor(Number((e as any).requestedIterations) || 1)),
          );
          const name = String((e as any).name || "Loop Shortcut").trim() || "Loop Shortcut";
          const summary =
            String((e as any).summary || "").trim() || (requestedIterations + " iteration(s)");
          const opponentIds = Array.isArray((e as any).opponentIds)
            ? (e as any).opponentIds
                .map((id: any) => String(id || "").trim())
                .filter((id: string) => !!id)
            : [];

          if (proposalId && proposerId) {
            if (opponentIds.length === 0) {
              delete (ctx.state as any).pendingLoopShortcut;
            } else {
              (ctx.state as any).pendingLoopShortcut = {
                id: proposalId,
                proposerId,
                name,
                summary,
                requestedIterations,
                status: "pending",
                createdAt: Number((e as any).createdAt) || 0,
                responses: {},
              };
            }
          }
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(proposeLoopShortcut): failed", err);
        }
        break;
      }

      case "resolveLoopShortcutConsent": {
        // Live: marks proposal approved + effectiveIterations, notifies clients, then clears pending.
        // Lasting GameContext mutation is clearing pendingLoopShortcut (consent outcome is socket-only).
        try {
          delete (ctx.state as any).pendingLoopShortcut;
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(resolveLoopShortcutConsent): failed", err);
        }
        break;
      }

      case "setTurnDirection": {
        (ctx.state as any).turnDirection = (e as any).direction;
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "claimTurn": {
        // Pregame: claim first turn. Live: game-actions claimMyTurn.
        try {
          const by = String((e as any).by || (e as any).playerId || "").trim();
          if (by) {
            (ctx.state as any).turnPlayer = by;
            // Best-effort: only set starting player if missing (mirrors live).
            if (!(ctx.state as any).startingPlayerId) {
              (ctx.state as any).startingPlayerId = by;
              (ctx.state as any).startingPlayer = by;
            }
          }
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(claimTurn): failed", err);
        }
        break;
      }

      case "randomizeStartingPlayer": {
        // Pregame: random first player. Live: game-actions randomizeStartingPlayer.
        try {
          const selected = String((e as any).selectedPlayerId || "").trim();
          if (selected) {
            (ctx.state as any).turnPlayer = selected;
            (ctx.state as any).startingPlayerId = selected;
            (ctx.state as any).startingPlayer = selected;
          }
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(randomizeStartingPlayer): failed", err);
        }
        break;
      }

      case "autoAssignTurn": {
        // Pregame/solo: auto-assign turnPlayer when only one player. Live: nextTurn path.
        try {
          const playerId = String((e as any).playerId || "").trim();
          if (playerId) {
            (ctx.state as any).turnPlayer = playerId;
          }
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(autoAssignTurn): failed", err);
        }
        break;
      }

      case "join": {
        // Rebuild roster entries when replaying from persisted events.
        // Socket join flow handles live connections; this is strictly for replay-after-restart.
        const pid = (e as any).playerId as PlayerID | undefined;
        const name = (e as any).name as string | undefined;
        const seatToken = (e as any).seatToken as string | undefined;
        const spectator = Boolean((e as any).spectator);
        const isAI = Boolean((e as any).isAI);
        const strategy = typeof (e as any).strategy === 'string' ? String((e as any).strategy) : undefined;
        const difficulty = Number.isFinite(Number((e as any).difficulty)) ? Number((e as any).difficulty) : undefined;

        if (!pid || !name) {
          break;
        }

        try {
          (ctx.state as any).players = (ctx.state as any).players || [];
          const playersArr = (ctx.state as any).players as any[];
          let existing = playersArr.find((p: any) => p.id === pid);
          if (!existing) {
            existing = {
              id: pid,
              name,
              spectator,
              seatToken,
              isAI,
              strategy,
              difficulty,
              aiStrategy: strategy,
              aiDifficulty: difficulty,
            };
            playersArr.push(existing);
          } else {
            // Ensure basic fields are set
            if (!existing.name) existing.name = name;
            if (typeof existing.spectator === "undefined")
              existing.spectator = spectator;
            if (!existing.seatToken && seatToken)
              existing.seatToken = seatToken;
            if (typeof existing.isAI === "undefined")
              existing.isAI = isAI;
            if (!existing.strategy && strategy)
              existing.strategy = strategy;
            if (typeof existing.difficulty === 'undefined' && typeof difficulty === 'number')
              existing.difficulty = difficulty;
            if (!existing.aiStrategy && strategy)
              existing.aiStrategy = strategy;
            if (typeof existing.aiDifficulty === 'undefined' && typeof difficulty === 'number')
              existing.aiDifficulty = difficulty;
          }
          
          // Set turnPlayer and priority if not already set (non-spectators only)
          // This matches the behavior in join.ts addPlayerIfMissing()
          if (!spectator) {
            if (!(ctx.state as any).turnPlayer) {
              (ctx.state as any).turnPlayer = pid;
            }
            if (!(ctx.state as any).priority) {
              (ctx.state as any).priority = pid;
            }
            
            // Initialize life, poison, experience for non-spectator players
            const startingLife = ctx.state.startingLife ?? 40;
            if (ctx.life) {
              ctx.life[pid] = ctx.life[pid] ?? startingLife;
              // Keep state + player refs in sync for consumers/tests that read player.life.
              (ctx.state as any).life = (ctx.state as any).life || {};
              (ctx.state as any).life[pid] = (ctx.state as any).life[pid] ?? ctx.life[pid];
              if (existing && typeof (existing as any).life === 'undefined') {
                (existing as any).life = ctx.life[pid];
              }
            }
            if (ctx.poison) ctx.poison[pid] = ctx.poison[pid] ?? 0;
            if (ctx.experience) ctx.experience[pid] = ctx.experience[pid] ?? 0;
            
            // Initialize zones
            const zones = ctx.state.zones = ctx.state.zones || {};
            zones[pid] = zones[pid] ?? { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            
            // Initialize landsPlayedThisTurn
            if (ctx.state.landsPlayedThisTurn) {
              ctx.state.landsPlayedThisTurn[pid] = ctx.state.landsPlayedThisTurn[pid] ?? 0;
            }

            if (isAI) {
              const stateAny = ctx.state as any;
              if (!(stateAny.autoPassPlayers instanceof Set)) {
                stateAny.autoPassPlayers = new Set();
              }
              stateAny.autoPassPlayers.add(pid);
            }
          }
          
          // Zones will be normalized by reconcileZonesConsistency after replay.
        } catch (err) {
          debugWarn(1, "applyEvent(join): failed to rebuild player", err);
        }
        break;
      }

      case "concededPlayerCleanup": {
        const playerId = String((e as any).playerId || '').trim();
        if (!playerId) break;

        try {
          const stateAny = ctx.state as any;
          const zones = stateAny.zones = stateAny.zones || {};
          const playerZones = zones[playerId] = zones[playerId] || {
            hand: [],
            handCount: 0,
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];

          const permanentIds = Array.isArray((e as any).permanentIds)
            ? ((e as any).permanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];
          const battlefield = Array.isArray(ctx.state?.battlefield) ? (ctx.state.battlefield as any[]) : [];

          for (const permanentId of permanentIds) {
            const exists = battlefield.some((entry: any) => entry && String(entry.id || '') === permanentId);
            if (exists) {
              movePermanentToExile(ctx as any, permanentId);
            }
          }

          const players = Array.isArray(stateAny.players) ? stateAny.players : [];
          const player = players.find((entry: any) => entry && String(entry.id || '') === playerId);
          if (player) {
            (player as any).hasLost = true;
            (player as any).eliminated = true;
            (player as any).lossReason = String((e as any).lossReason || 'Conceded');
          }

          if (stateAny.autoPassForTurn && typeof stateAny.autoPassForTurn === 'object') {
            delete stateAny.autoPassForTurn[playerId];
          }
          if (stateAny.autoPassPlayers instanceof Set) {
            stateAny.autoPassPlayers.delete(playerId);
          }
          if (stateAny.priorityClaimed instanceof Set) {
            stateAny.priorityClaimed.delete(playerId);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(concededPlayerCleanup): failed', err);
        }
        break;
      }

      case "leave": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const deferred = (e as any).deferred === true;

          if (!deferred) {
            leaveModule(ctx as any, playerId as any);
            break;
          }

          const stateAny = ctx.state as any;
          const players = Array.isArray(stateAny.players) ? stateAny.players : [];
          const player = players.find((entry: any) => entry && String(entry.id || '') === playerId);

          if (player) {
            (player as any).conceded = true;
            (player as any).concededAt = Number((e as any).leftAt || Date.now());
            (player as any).departureMode = 'leave';
            (player as any).leftGame = true;
            (player as any).leftAt = Number((e as any).leftAt || Date.now());
            (player as any).connected = false;
            try { delete (player as any).socketId; } catch {}
          }

          if (!stateAny.autoPassForTurn || typeof stateAny.autoPassForTurn !== 'object') {
            stateAny.autoPassForTurn = {};
          }
          if (playerId) {
            stateAny.autoPassForTurn[playerId] = true;
          }
          if (stateAny.priorityClaimed instanceof Set) {
            stateAny.priorityClaimed.delete(playerId);
          }
          if (String(stateAny._pauseHumanAutoPassUntilActionFor || '') === playerId) {
            delete stateAny._pauseHumanAutoPassUntilActionFor;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(leave): failed', err);
        }
        break;
      }

      case "restart": {
        reset(ctx as any, Boolean((e as any).preservePlayers));
        break;
      }

      case "resetGame": {
        // historical event alias - map to the restart/reset semantics
        const preserve =
          (e as any).preservePlayers ?? (e as any).preserve ?? false;
        reset(ctx as any, Boolean(preserve));
        break;
      }

      case "removePlayer": {
        remove(ctx as any, (e as any).playerId);
        break;
      }

      case "skipPlayer": {
        skip(ctx as any, (e as any).playerId);
        break;
      }

      case "unskipPlayer": {
        unskip(ctx as any, (e as any).playerId);
        break;
      }

      case "spectatorGrant": {
        const owner = (e as any).owner as PlayerID;
        const spectator = (e as any).spectator as PlayerID;
        const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
        set.add(spectator);
        ctx.grants.set(owner, set);
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "spectatorRevoke": {
        const owner = (e as any).owner as PlayerID;
        const spectator = (e as any).spectator as PlayerID;
        const set = ctx.grants.get(owner) ?? new Set<PlayerID>();
        set.delete(spectator);
        ctx.grants.set(owner, set);
        try {
          if (typeof ctx.bumpSeq === "function") ctx.bumpSeq();
        } catch {}
        break;
      }

      case "deckImportResolved": {
        importDeckResolved(
          ctx as any,
          (e as any).playerId,
          (e as any).cards || []
        );
        break;
      }

      case "shuffleLibrary": {
        const shufflePlayerId = String((e as any).playerId || '').trim();
        const shuffledLibraryIds = (Array.isArray((e as any).shuffledLibraryIds) ? (e as any).shuffledLibraryIds : [])
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean);
        if (shufflePlayerId && shuffledLibraryIds.length > 0) {
          const library = getPlayerLibraryFromContext(ctx, shufflePlayerId);
          const currentIds = library
            .map((card: any) => String(card?.id || '').trim())
            .filter(Boolean);
          const alreadyOrdered = currentIds.length === shuffledLibraryIds.length
            && currentIds.every((id, index) => id === shuffledLibraryIds[index]);
          if (alreadyOrdered) {
            break;
          }
          const libraryAfter = buildLibraryFromRemainingIds(library, [], shuffledLibraryIds);
          const zones = (ctx.state as any).zones || {};
          const z = zones[shufflePlayerId] = zones[shufflePlayerId] || {};
          z.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(shufflePlayerId, cloneLibraryCards(libraryAfter));
          }
        } else if (shufflePlayerId) {
          shuffleLibrary(ctx as any, shufflePlayerId as any);
        }
        break;
      }

      case "drawCards": {
        const drawPlayerId = (e as any).playerId;
        const drawnCardIds = (Array.isArray((e as any).drawnCardIds) ? (e as any).drawnCardIds : [])
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean);
        if (drawnCardIds.length > 0) {
          drawCardsByIds(ctx as any, drawPlayerId, drawnCardIds);
        } else {
          drawCards(
            ctx as any,
            drawPlayerId,
            (e as any).count || 1,
            { skipEventPersistence: true },
          );
        }
        clearOracleIrPendingCompoundResumeOnState(ctx.state);
        break;
      }

      case "selectFromLibrary": {
        selectFromLibrary(
          ctx as any,
          (e as any).playerId,
          (e as any).cardIds || [],
          (e as any).moveTo
        );
        break;
      }

      case "handIntoLibrary": {
        moveHandToLibrary(ctx as any, (e as any).playerId);
        break;
      }

      case "setCommander": {
        const pid = (e as any).playerId;
        // Check hand count BEFORE calling setCommander to know if we need opening draw
        const zones = ctx.state.zones || {};
        const zonesBefore = zones[pid];
        const handCountBefore = zonesBefore
          ? (typeof zonesBefore.handCount === "number" ? zonesBefore.handCount : (Array.isArray(zonesBefore.hand) ? zonesBefore.hand.length : 0))
          : 0;
        
        setCommander(
          ctx as any,
          pid,
          (e as any).commanderNames || [],
          (e as any).commanderIds || [],
          (e as any).colorIdentity || []
        );
        
        // For backward compatibility with old games that don't have separate shuffle/draw events:
        // If hand was empty before and is still empty after setCommander, we need to check if
        // the next events include shuffleLibrary/drawCards. If not, we'll do it here.
        // This flag can be checked by the replay function to decide.
        // For now, mark that setCommander was called with empty hand for potential follow-up.
        if (handCountBefore === 0) {
          (ctx as any)._setCommanderCalledWithEmptyHand = pid;
        }
        break;
      }

      case "castCommander": {
        const playerId = (e as any).playerId;
        const commanderId = resolveReplayCommanderId(ctx, e);
        const commanderCard = resolveReplayCommanderCard(ctx, e, commanderId);
        debug(1, `[applyEvent] Replaying castCommander event:`, { playerId, commanderId });

        if (!(e as any).commanderId && commanderId) {
          debugWarn(1, `[applyEvent] Recovered legacy castCommander replay event without commanderId`, {
            playerId,
            commanderId,
            cardId: (e as any).cardId,
            cardName: (e as any).cardName,
          });
        }
        
        if (!commanderId) {
          debugError(1, `[applyEvent] CRITICAL: castCommander event has undefined commanderId!`, {
            event: e,
            playerId
          });
          debugWarn(1, `[applyEvent] Skipping castCommander event with undefined commanderId to prevent infinite loop`);
          break;
        }
        
        if (playerId && commanderCard) {
          pushStack(ctx as any, {
            id: generateDeterministicId(ctx as any, 'stack', commanderId),
            type: 'spell',
            controller: playerId,
            source: 'command',
            fromZone: 'command',
            castSourceZone: 'command',
            card: {
              ...commanderCard,
              zone: 'stack',
              isCommander: true,
              source: 'command',
              fromZone: 'command',
              castSourceZone: 'command',
            },
            targets: [],
          } as any);
        } else {
          debugWarn(1, `[applyEvent] Unable to rebuild commander stack item during castCommander replay`, {
            playerId,
            commanderId,
            hasCardSnapshot: !!(e as any).card,
          });
        }

        castCommander(
          ctx as any,
          playerId,
          commanderId
        );
        break;
      }

      case "moveCommanderToCZ": {
        moveCommanderToCZ(
          ctx as any,
          (e as any).playerId,
          (e as any).commanderId
        );
        break;
      }

      case "commanderZoneChoice": {
        const pid = String((e as any).playerId || '').trim();
        const commanderId = String((e as any).commanderId || '').trim();
        const moveToCommandZone = (e as any).moveToCommandZone === true;
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const destinationZone = String((e as any).destinationZone || (e as any).fromZone || 'graveyard').trim().toLowerCase();
        const libraryPosition = String((e as any).libraryPosition || 'shuffle').trim().toLowerCase();
        const card = (e as any).card && typeof (e as any).card === 'object' ? (e as any).card : undefined;
        const cardId = String(card?.id || '').trim();

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.commanderZoneChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!commanderId || String((step as any)?.commanderId || (step as any)?.card?.id || '').trim() === commanderId)
              );
            });
          }

          if (moveToCommandZone) {
            // Mirror live resolution.ts commander->CZ path. Previously only
            // moveCommanderToCZ ran, leaving BF/stack/zone ghosts after undo/replay
            // which made getCommandZoneCommanderCandidates exclude the commander.
            moveCommanderToCZ(ctx as any, pid, commanderId || cardId);

            const stateAny = ctx.state as any;
            const ids = new Set(
              [commanderId, cardId, String((e as any).sourceId || '').trim()]
                .map((id) => String(id || '').trim())
                .filter(Boolean),
            );

            // Remove from destination/source zones and battlefield (same helper used
            // by the non-CZ branch). This also clears a stale zones.commandZone entry
            // so we can re-insert a clean card below.
            removeReplayCommanderCardFromZones(stateAny, pid, commanderId, cardId);

            // Also drop an actual commander SPELL still on the stack (not triggers).
            if (Array.isArray(stateAny.stack) && ids.size > 0) {
              stateAny.stack = stateAny.stack.filter((item: any) => {
                const itemType = String(item?.type || '').toLowerCase();
                if (itemType && itemType !== 'spell') return true;
                const spellCard = item?.card || item?.spell?.card;
                const spellCardId = String(spellCard?.id || '').trim();
                const spellId = String(item?.id || '').trim();
                return !ids.has(spellCardId) && !ids.has(spellId);
              });
            }

            // Ensure the card object is present in zones.commandZone for UI/view.
            if (pid) {
              stateAny.zones = stateAny.zones || {};
              const zones = stateAny.zones[pid] = stateAny.zones[pid] || {};
              zones.commandZone = Array.isArray(zones.commandZone) ? zones.commandZone : [];
              const czCard = card && typeof card === 'object'
                ? { ...card, zone: 'command' }
                : { id: commanderId || cardId, zone: 'command' };
              const czCardId = String(czCard?.id || '').trim();
              const alreadyInZonesCZ = zones.commandZone.some(
                (c: any) => czCardId && String(c?.id || '').trim() === czCardId,
              );
              if (!alreadyInZonesCZ && (czCardId || czCard?.name)) {
                zones.commandZone.push(czCard);
              }
              zones.commandZoneCount = zones.commandZone.length;

              // Keep commanderCards snapshot in sync if somehow missing.
              const czInfo = stateAny.commandZone?.[pid];
              if (czInfo && Array.isArray(czInfo.commanderCards) && czCardId) {
                const hasSnapshot = czInfo.commanderCards.some(
                  (c: any) => String(c?.id || '').trim() === czCardId,
                );
                if (!hasSnapshot) {
                  czInfo.commanderCards.push({ ...czCard });
                }
              }
            }
          } else if (pid && (commanderId || cardId)) {
            removeReplayCommanderCardFromZones(ctx.state as any, pid, commanderId, cardId);
            putReplayCommanderCardInDestination(ctx as any, pid, destinationZone, libraryPosition, card || { id: commanderId }, (e as any).exileTag);

            const commandZoneInfo = (ctx.state as any)?.commandZone?.[pid];
            if (commandZoneInfo && Array.isArray(commandZoneInfo.inCommandZone)) {
              commandZoneInfo.inCommandZone = commandZoneInfo.inCommandZone.filter((id: any) => String(id || '') !== commanderId && String(id || '') !== cardId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(commanderZoneChoice): failed", err);
        }
        break;
      }

      case "updateCounters": {
        updateCounters(
          ctx as any,
          (e as any).permanentId,
          (e as any).deltas || {},
          {
            skipCounterModifications: (e as any).skipCounterModifications === true,
            deferRunSBA: (e as any).deferRunSBA === true,
            skipEventPersistence: true,
          },
        );
        break;
      }

      case "updateCountersBulk": {
        applyUpdateCountersBulk(ctx as any, (e as any).updates || [], {
          skipCounterModifications: (e as any).skipCounterModifications === true,
          deferRunSBA: (e as any).deferRunSBA === true,
          skipEventPersistence: true,
        });
        break;
      }

      case "createToken": {
        createToken(
          ctx as any,
          (e as any).controller,
          (e as any).name,
          (e as any).count,
          (e as any).basePower,
          (e as any).baseToughness,
          { skipEventPersistence: true },
        );
        break;
      }

      case "removePermanent": {
        removePermanent(ctx as any, (e as any).permanentId);
        break;
      }

      case "dealDamage": {
        // Handle both legacy effects format and new action format
        let effects: any[] = (e as any).effects || [];
        const amount = Math.max(0, Number((e as any).amount ?? 0));
        const targetPermanentId = String((e as any).targetPermanentId || '').trim();
        const targetPlayerId = String((e as any).targetPlayerId || '').trim();
        const sourcePermanentId = String((e as any).sourcePermanentId || (e as any).sourceCreatureId || '').trim();
        const infectWither = inferInfectWitherFlags(ctx as any, {
          sourcePermanentId,
          infect: Boolean((e as any).infect),
          wither: Boolean((e as any).wither),
        });

        if (targetPlayerId && amount > 0) {
          resolvePlayerDamage(ctx as any, {
            targetPlayerId,
            amount,
            isCombatDamage: Boolean((e as any).combatDamage),
            sourcePermanent: infectWither.sourcePermanent || undefined,
            sourceCard: (e as any).sourceCard,
          });
        } else if (targetPermanentId && amount > 0) {
          // Turn-tracking for intervening-if: creature→creature damage relationships for engine-driven damage events.
          // Best-effort: only records when the event explicitly provides a source permanent id and both are creatures.
          try {
            const stateAny = ctx.state as any;
            const targetId = String(targetPermanentId);
            const dmg = amount;

            if (sourcePermanentId && targetId && dmg > 0) {
              const battlefield = (ctx.state as any).battlefield || [];
              const sourcePerm = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
              const targetPerm = battlefield.find((p: any) => String(p?.id) === targetId);
              const sourceTL = String(sourcePerm?.card?.type_line || '').toLowerCase();
              const targetTL = String(targetPerm?.card?.type_line || '').toLowerCase();
              if (sourcePerm && targetPerm && sourceTL.includes('creature') && targetTL.includes('creature')) {
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] =
                  stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[sourcePermanentId][targetId] = true;
              }
            }
          } catch {
            // best-effort only
          }

          const battlefield = (ctx.state as any).battlefield || [];
          const targetPerm = battlefield.find((p: any) => String(p?.id) === targetPermanentId);
          if (targetPerm && infectWither.sourcePermanent && (infectWither.infect || infectWither.wither)) {
            applyCreatureDamageFromSource(
              ctx as any,
              infectWither.sourcePermanent,
              targetPerm,
              amount,
              'damageMarked',
            );
          } else {
            const action = {
              type: 'DEAL_DAMAGE' as const,
              targetPermanentId,
              amount,
              wither: infectWither.wither,
              infect: infectWither.infect,
            };
            effects = [...evaluateAction(ctx.state, action)];
          }
        }
        
        try {
          applyEngineEffects(ctx as any, effects);
        } catch {}
        try {
          runSBA(ctx as any);
        } catch {}
        break;
      }

      case "resolveSpell": {
        // Execute spell effects based on spec and chosen targets
        const spec = (e as any).spec;
        const chosen = normalizeChosenTargetRefs(ctx.state, spec, (e as any).chosen || []);
        const caster = (e as any).caster as PlayerID;
        
        // P1a: COUNTER_TARGET_* categorize resolve + former special-case path deleted.
        // Countering goes through Oracle IR → executeSpellEffect CounterSpell/CounterAbility
        // (or counterStackItem / applyEvent effect switch when those effects are emitted).
        if (spec && typeof resolveSpell === 'function') {
          try {
            const effects = resolveSpell(spec, chosen, ctx.state, caster);
            // Apply each effect
            for (const eff of effects) {
              switch (eff.kind) {
                case 'DestroyPermanent':
                  destroyPermanent(ctx as any, eff.id);
                  break;
                case 'MoveToExile':
                  movePermanentToExile(ctx as any, eff.id);
                  break;
                case 'BouncePermanent':
                  movePermanentToHand(ctx as any, (eff as any).id);
                  break;
                case 'TapPermanent': {
                  const perm = ctx.state.battlefield.find((p: any) => p.id === (eff as any).id);
                  if (perm) (perm as any).tapped = true;
                  break;
                }
                case 'UntapPermanent': {
                  const perm = ctx.state.battlefield.find((p: any) => p.id === (eff as any).id);
                  if (perm) (perm as any).tapped = false;
                  break;
                }
                case 'AddCountersPermanent':
                  updateCounters(ctx as any, (eff as any).id, { [(eff as any).counterType]: (eff as any).amount });
                  // Turn-tracking for intervening-if: "if you put a counter on a creature this turn".
                  // Best-effort: only marks true when the spell's caster is known and the target is a creature.
                  try {
                    const targetPerm = ctx.state.battlefield.find((p: any) => p?.id === (eff as any).id);
                    const tl = String(targetPerm?.card?.type_line || '').toLowerCase();
                    if (caster && tl.includes('creature')) {
                      const stateAny = ctx.state as any;
                      stateAny.putCounterOnCreatureThisTurn = stateAny.putCounterOnCreatureThisTurn || {};
                      stateAny.putCounterOnCreatureThisTurn[String(caster)] = true;
                    }
                  } catch {
                    // best-effort only
                  }
                  break;
                case 'DamagePermanent': {
                  // Apply damage to permanent (may kill it via SBA)
                  const perm = ctx.state.battlefield.find((p: any) => p.id === eff.id);
                  if (perm) {
                    const sourcePermanentId = String((eff as any).sourcePermanentId || (eff as any).sourceId || '');
                    const sourcePerm = sourcePermanentId
                      ? ctx.state.battlefield.find((p: any) => String(p?.id) === sourcePermanentId)
                      : null;
                    if (sourcePerm) {
                      applyCreatureDamageFromSource(ctx as any, sourcePerm, perm, eff.amount, 'damage');
                    } else {
                      const { amount: modified } = calculateModifiedDamage(
                        ctx as any,
                        eff.amount,
                        String(caster || ''),
                        String((perm as any)?.controller || ''),
                        undefined,
                        false,
                        String((perm as any)?.id || '') || undefined,
                      );
                      applyDamageToPermanentWithCounterEffects(perm, modified, 'damage');
                    }
                  }
                  break;
                }
                case 'DamagePlayer': {
                  const playerId = String((eff as any).playerId || '');
                  const dmg = Math.max(0, Number((eff as any).amount ?? 0));
                  if (!playerId || dmg <= 0) break;

                  let sourceControllerId = String(caster || '');
                  let sourceCard: any;
                  const sourcePermanentId = String((eff as any).sourcePermanentId || (eff as any).sourceId || '');
                  const sourcePerm = sourcePermanentId
                    ? ctx.state.battlefield.find((p: any) => String(p?.id) === sourcePermanentId)
                    : null;
                  if (sourcePerm?.controller) {
                    sourceControllerId = String(sourcePerm.controller);
                    sourceCard = sourcePerm?.card;
                  }

                  const replacement = resolveOpponentDirectedDamage(ctx as any, {
                    sourceControllerId,
                    targetPlayerId: playerId,
                    damageAmount: dmg,
                    sourceCard,
                  });
                  const actualDmg = replacement.damageDealt;
                  const resolved = resolvePlayerDamage(ctx as any, {
                    targetPlayerId: playerId,
                    amount: actualDmg,
                    sourcePermanent: sourcePerm || undefined,
                    sourceCard,
                    skipAmountReplacements: true,
                  });

                  // Track per-turn damage/life loss for intervening-if templates.
                  try {
                    (ctx.state as any).damageTakenThisTurnByPlayer = (ctx.state as any).damageTakenThisTurnByPlayer || {};
                    (ctx.state as any).damageTakenThisTurnByPlayer[playerId] =
                      ((ctx.state as any).damageTakenThisTurnByPlayer[playerId] || 0) + resolved.damageDealt;
                  } catch {}
                  try {
                    if (resolved.lifeLost > 0) {
                      (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
                      (ctx.state as any).lifeLostThisTurn[playerId] =
                        ((ctx.state as any).lifeLostThisTurn[playerId] || 0) + resolved.lifeLost;
                    }
                  } catch {}

                  // Best-effort attribution: if the effect includes a source battlefield creature.
                  try {
                    if (sourcePermanentId && resolved.damageDealt > 0) {
                      const battlefield = (ctx.state as any).battlefield || [];
                      const attributionSource = battlefield.find((p: any) => String(p?.id) === sourcePermanentId);
                      const tl = String(attributionSource?.card?.type_line || '').toLowerCase();
                      if (attributionSource && tl.includes('creature')) {
                        (ctx.state as any).creaturesThatDealtDamageToPlayer = (ctx.state as any).creaturesThatDealtDamageToPlayer || {};
                        const perPlayer = (((ctx.state as any).creaturesThatDealtDamageToPlayer[playerId] =
                          (ctx.state as any).creaturesThatDealtDamageToPlayer[playerId] || {}) as any);
                        perPlayer[sourcePermanentId] = {
                          creatureName: String(attributionSource?.card?.name || sourcePermanentId),
                          totalDamage: (perPlayer[sourcePermanentId]?.totalDamage || 0) + resolved.damageDealt,
                          lastDamageTime: Date.now(),
                        };
                      }
                    }
                  } catch {}
                  break;
                }
                case 'GainLife': {
                  const playerId = (eff as any).playerId as PlayerID;
                  const amount = Math.max(0, Number((eff as any).amount ?? 0));
                  if (!playerId || amount <= 0) break;

                  const { finalAmount } = processLifeChange(ctx as any, playerId, amount, true);
                  if (finalAmount === 0) break;

                  (ctx.state as any).life = (ctx.state as any).life || {};
                  const players = (ctx.state as any).players || [];
                  const player = players.find((p: any) => p.id === playerId);
                  const startingLife = (ctx.state as any).startingLife ?? 40;
                  const current = (ctx.state as any).life[playerId] ?? (ctx as any).life?.[playerId] ?? player?.life ?? startingLife;
                  const next = current + finalAmount;
                  (ctx.state as any).life[playerId] = next;
                  (ctx as any).life = (ctx as any).life || {};
                  (ctx as any).life[playerId] = next;
                  if (player) player.life = next;

                  // Track life gained this turn.
                  try {
                    (ctx.state as any).lifeGainedThisTurn = (ctx.state as any).lifeGainedThisTurn || {};
                    (ctx.state as any).lifeGainedThisTurn[String(playerId)] =
                      ((ctx.state as any).lifeGainedThisTurn[String(playerId)] || 0) + finalAmount;
                  } catch {}
                  break;
                }
                case 'LoseLife': {
                  const playerId = (eff as any).playerId as PlayerID;
                  const amount = Math.max(0, Number((eff as any).amount ?? 0));
                  if (!playerId || amount <= 0) break;

                  const { finalAmount } = processLifeChange(ctx as any, playerId, amount, false);
                  if (finalAmount === 0) break;

                  (ctx.state as any).life = (ctx.state as any).life || {};
                  const players = (ctx.state as any).players || [];
                  const player = players.find((p: any) => p.id === playerId);
                  const startingLife = (ctx.state as any).startingLife ?? 40;
                  const current = (ctx.state as any).life[playerId] ?? (ctx as any).life?.[playerId] ?? player?.life ?? startingLife;
                  const next = current - Math.abs(finalAmount);
                  (ctx.state as any).life[playerId] = next;
                  (ctx as any).life = (ctx as any).life || {};
                  (ctx as any).life[playerId] = next;
                  if (player) player.life = next;

                  // Track life lost this turn.
                  try {
                    (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
                    (ctx.state as any).lifeLostThisTurn[String(playerId)] =
                      ((ctx.state as any).lifeLostThisTurn[String(playerId)] || 0) + Math.abs(finalAmount);
                  } catch {}
                  break;
                }
                case 'DrawCards':
                  if ((eff as any).playerId && (eff as any).count) {
                    try {
                      drawCards(ctx as any, (eff as any).playerId, Number((eff as any).count));
                    } catch {}
                  }
                  break;
                case 'RequestDiscard':
                  if ((eff as any).playerId && (eff as any).count) {
                    (ctx.state as any).pendingDiscard = (ctx.state as any).pendingDiscard || {};
                    (ctx.state as any).pendingDiscard[(eff as any).playerId] = {
                      count: Number((eff as any).count),
                      source: (e as any)?.cardId || 'spell',
                      reason: 'spell_effect',
                    };
                  }
                  break;
                case 'CreateToken':
                  try {
                    createToken(
                      ctx as any,
                      (eff as any).controller,
                      (eff as any).name,
                      (eff as any).count,
                      (eff as any).basePower,
                      (eff as any).baseToughness,
                      (eff as any).options
                    );
                  } catch {}
                  break;
                case 'QueueScry':
                  if ((eff as any).playerId && (eff as any).count) {
                    (ctx.state as any).pendingScry = (ctx.state as any).pendingScry || {};
                    (ctx.state as any).pendingScry[(eff as any).playerId] = Number((eff as any).count);
                  }
                  break;
                case 'QueueSurveil':
                  if ((eff as any).playerId && (eff as any).count) {
                    (ctx.state as any).pendingSurveil = (ctx.state as any).pendingSurveil || {};
                    (ctx.state as any).pendingSurveil[(eff as any).playerId] = Number((eff as any).count);
                  }
                  break;
                case 'MillCards': {
                  const playerId = (eff as any).playerId as PlayerID;
                  const count = Math.max(0, Number((eff as any).count ?? 0));
                  if (!playerId || count <= 0) break;

                  const lib = (ctx as any).libraries?.get?.(playerId);
                  const zones = (ctx.state as any).zones || ((ctx.state as any).zones = {});
                  const z = (zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

                  if (lib && Array.isArray(lib)) {
                    for (let i = 0; i < count && lib.length > 0; i++) {
                      const milled = lib.shift();
                      if (milled) {
                        pushCardToPlayerGraveyardWithReplacements(ctx as any, String(playerId), milled, z.graveyard);
                      }
                    }
                    (ctx as any).libraries?.set?.(playerId, lib);
                    z.libraryCount = lib.length;
                    z.graveyardCount = z.graveyard.length;
                  }
                  break;
                }
                case 'GoadPermanent': {
                  const id = String((eff as any).id || '');
                  const goaderId = (eff as any).goaderId as PlayerID;
                  if (!id || !goaderId) break;
                  const idx = ctx.state.battlefield.findIndex((p: any) => p.id === id);
                  if (idx < 0) break;

                  const perm = ctx.state.battlefield[idx] as any;
                  const existing = perm.goadedBy || [];
                  if (!existing.includes(goaderId)) {
                    perm.goadedBy = [...existing, goaderId];
                  }
                  const currentTurn = Number((ctx.state as any).turnNumber ?? 0) || 0;
                  const expiryTurn = currentTurn + 1;
                  perm.goadedUntil = { ...(perm.goadedUntil || {}), [goaderId]: expiryTurn };
                  break;
                }
                case 'CounterSpell': {
                  // Counter a spell on the stack
                  const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === eff.stackItemId);
                  if (stackIdx >= 0) {
                    const countered = ctx.state.stack.splice(stackIdx, 1)[0];
                    // Move the countered spell to its replacement destination
                    const controller = (countered as any).controller as PlayerID;
                    const zones = ctx.state.zones = ctx.state.zones || {};
                    zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
                    if ((countered as any).card) {
                      if ((countered as any).card?.ceaseOnCounter === true) {
                        // Copied spells cease to exist instead of changing zones.
                      } else if (shouldExileStackCardInsteadOfGraveyard(countered)) {
                        const exile = (zones[controller] as any).exile = (zones[controller] as any).exile || [];
                        exile.push({ ...(countered as any).card, zone: 'exile' });
                        (zones[controller] as any).exileCount = exile.length;
                      } else {
                        const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
                        gy.push({ ...(countered as any).card, zone: 'graveyard' });
                        recordCardPutIntoGraveyardThisTurn(ctx as any, String(controller), (countered as any).card, { fromBattlefield: false });
                        (zones[controller] as any).graveyardCount = gy.length;
                      }
                    }
                    try {
                      processSpellCounteredTriggers(ctx as any, {
                        counteringControllerId: String(caster || ''),
                        counteredControllerId: String(controller || ''),
                        counteredStackItemId: String((countered as any)?.id || eff.stackItemId || ''),
                        counteredCardName: String((countered as any)?.card?.name || 'spell'),
                        counteringSourceName: 'Counter',
                        counteredWasSpell: true,
                      });
                    } catch {
                      // best-effort
                    }
                  }
                  break;
                }
                case 'CounterAbility': {
                  // Counter an ability on the stack (just remove it)
                  const stackIdx = ctx.state.stack.findIndex((s: any) => s.id === eff.stackItemId);
                  if (stackIdx >= 0) {
                    ctx.state.stack.splice(stackIdx, 1);
                  }
                  break;
                }
              }
            }
            // Run state-based actions after applying effects
            runSBA(ctx as any);
            ctx.bumpSeq();
          } catch (err) {
            debugWarn(1, '[applyEvent] resolveSpell failed:', err);
          }
        }
        break;
      }

      case "pushStack": {
        pushStack(ctx as any, (e as any).item);
        break;
      }

      case "resolveTopOfStack": {
        // Live resolution re-runs IR/triggers and drifts zones; outcomes are in
        // executeEffect / mutation events. During replay, only pop the resolved item
        // (plus any consecutive Always-No optional triggers drained in the same live call).
        if ((ctx as any).isReplaying) {
          replayPopTopOfStackDuringEventReplay(ctx as any);
        } else {
          resolveTopOfStack(ctx as any);
        }
        break;
      }

      case "resolveAllTriggers": {
        // Live path resolves the whole stack via direct resolveTopOfStack() calls
        // without per-item events, then logs one resolveAllTriggers { count }.
        // Without a replay pop, every historical pushTriggeredAbility (e.g. Aura
        // Shards from the whole game) reappears on the stack after restart.
        if ((ctx as any).isReplaying) {
          replayResolveAllTriggersDuringEventReplay(
            ctx as any,
            Number((e as any).count ?? 0),
          );
        }
        break;
      }

      case "sundialActivated": {
        try {
          const playerId = String((e as any).by || (e as any).playerId || '').trim();
          const paid = String((e as any).paid || '').trim();
          const battlefield = Array.isArray(ctx.state?.battlefield) ? (ctx.state.battlefield as any[]) : [];
          const sundial = battlefield.find((perm: any) =>
            perm &&
            String(perm.controller || '') === playerId &&
            String(perm.card?.name || '').toLowerCase().includes('sundial of the infinite')
          );

          if (playerId && paid) {
            const pool = getOrInitManaPool(ctx.state as any, playerId as any);
            consumeRecordedManaCostFromPool(pool as any, paid);
          }

          if (sundial) {
            (sundial as any).tapped = Boolean((e as any).tapped);
          }

          exileEntireStack(ctx as any, playerId as any);
          nextTurn(ctx as any);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sundialActivated): failed', err);
        }
        break;
      }

      case "playLand": {
        // Turn-tracking: persisted events include fromZone (hand/graveyard). Use this as
        // authoritative positive evidence for intervening-if templates.
        try {
          const playerId = String((e as any).playerId);
          const fromZone = String((e as any).fromZone || '').toLowerCase();
          const stateAny = (ctx.state as any) as any;
          if (fromZone === 'graveyard') {
            stateAny.playedLandFromGraveyardThisTurn = stateAny.playedLandFromGraveyardThisTurn || {};
            stateAny.playedLandFromGraveyardThisTurn[playerId] = true;
          }
        } catch {
          // best-effort only
        }

        // Prefer full card object for replay (contains all card data)
        // Fall back to cardId for backward compatibility with old events
        const cardData = (e as any).card || (e as any).cardId;
        const fromZone = String((e as any).fromZone || '').toLowerCase().trim();
        const playerId = String((e as any).playerId || '').trim();
        const cardForPermission = resolveReplayCardForPermissionUse(ctx as any, e, fromZone, cardData);
        const battlefieldLengthBefore = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield.length : 0;
        const durablePermissionToRecord = playerId
          ? resolveDurablePermissionForCastReplay(
            ctx.state as any,
            e as any,
            fromZone === 'library'
              ? getDurableLibraryPermissionForCard(ctx.state as any, playerId as any, cardForPermission, 'play')
              : fromZone === 'exile'
                ? getDurablePlayableFromExilePermissionForCard(ctx.state as any, playerId as any, cardForPermission, 'play')
                  || getDurableLandPlayPermissionForCard(ctx.state as any, playerId as any, 'exile', cardForPermission)
                : fromZone === 'graveyard'
                  ? getMatchingGraveyardCastingPermission(ctx.state as any, playerId as any, cardForPermission, 'play')
                    || getDurableLandPlayPermissionForCard(ctx.state as any, playerId as any, 'graveyard', cardForPermission)
                  : undefined,
          )
          : undefined;

        // Defensive replay hardening: if the persisted event indicates the land
        // was played from true exile, ensure any impulse-style tags/permissions
        // are cleaned up even if playLand can't infer the source from current zones.
        try {
          if (fromZone === 'exile') {
            const cardObj = typeof cardData === 'string' ? { id: cardData } : cardData;
            cleanupCardLeavingExile((ctx.state as any) as any, cardObj);
          }
        } catch {
          // best-effort only
        }
        playLand(ctx as any, (e as any).playerId, cardData);
        try {
          const battlefieldLengthAfter = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield.length : 0;
          if (playerId && battlefieldLengthAfter > battlefieldLengthBefore) {
            recordReplayDurablePermissionUse(ctx.state as any, durablePermissionToRecord);
          }
        } catch {
          // best-effort only
        }
        applyRecordedPlayLandReplayState(ctx, e);
        break;
      }

      case "castSpell": {
        // Turn-tracking: "a spell was warped this turn" (702.185c) means it was cast for its warp cost.
        // Persisted events may include alternateCostId; older streams may only have it on the card object.
        try {
          const pid = String((e as any).playerId || '');
          const alt =
            (e as any).alternateCostId ??
            (e as any).alternate_cost_id ??
            (e as any).card?.alternateCostId ??
            (e as any).card?.card?.alternateCostId;
          const altLower = String(alt || '').toLowerCase().trim();
          if (pid && altLower === 'warp') {
            const stateAny = (ctx.state as any) as any;
            stateAny.spellWasWarpedThisTurn = stateAny.spellWasWarpedThisTurn || {};
            stateAny.spellWasWarpedThisTurn[pid] = true;
          }
        } catch {
          // best-effort only
        }

        // Turn-tracking: persisted castSpell events can carry `fromZone`.
        // Use this as authoritative positive evidence during replay.
        try {
          const pid = String((e as any).playerId || '').trim();
          const fromZone = String((e as any).fromZone || '').toLowerCase().trim();
          if (pid && fromZone === 'graveyard') {
            const stateAny = (ctx.state as any) as any;
            stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
            stateAny.castFromGraveyardThisTurn[pid] = true;
            recordGraveyardPermanentTypesCastThisTurn(stateAny, pid, (e as any).card);
          }
          if (pid && fromZone === 'exile') {
            const stateAny = (ctx.state as any) as any;
            stateAny.castFromExileThisTurn = stateAny.castFromExileThisTurn || {};
            stateAny.castFromExileThisTurn[pid] = true;
          }
          if (pid && fromZone === 'library') {
            const stateAny = (ctx.state as any) as any;
            stateAny.castFromLibraryThisTurn = stateAny.castFromLibraryThisTurn || {};
            stateAny.castFromLibraryThisTurn[pid] = true;
          }
        } catch {
          // best-effort only
        }

        try {
          const tappedPermanents = Array.isArray((e as any).tappedPermanents)
            ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
            : [];
          if (tappedPermanents.length > 0) {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            for (const permanentId of tappedPermanents) {
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId);
              if (permanent) {
                (permanent as any).tapped = true;
              }
            }
          }
        } catch {
          // best-effort only
        }

        try {
          const sacrificedPermanents = Array.isArray((e as any).sacrificedPermanents)
            ? ((e as any).sacrificedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
            : [];
          for (const permanentId of sacrificedPermanents) {
            applyReplaySacrificedPermanent(ctx, permanentId);
          }
        } catch {
          // best-effort only
        }

        try {
          const playerId = String((e as any).playerId || '').trim();
          const manaDelta = (e as any).paymentManaDelta;
          if (playerId && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
            const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
            for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
              const amount = Number(rawAmount || 0);
              if (!Number.isFinite(amount) || amount === 0) continue;
              pool[poolKey] = Number(pool[poolKey] || 0) + amount;
            }
          }
        } catch {
          // best-effort only
        }

        // Web-slinging's return-to-hand is a nonmana cost paid before the spell
        // reaches the stack. Persisted casts carry the exact permanent ID so a
        // restart/undo never needs to infer a fresh legal selection.
        try {
          const alternateCostId = String((e as any).alternateCostId || '').trim().toLowerCase();
          const returnedCreatureId = String(
            (e as any).webSlingingReturnedCreatureId
            || (e as any).card?.webSlingingReturnedCreatureId
            || '',
          ).trim();
          if (alternateCostId === 'web_slinging' && returnedCreatureId) {
            const stillOnBattlefield = (ctx.state.battlefield || []).some(
              (permanent: any) => String(permanent?.id || '') === returnedCreatureId,
            );
            if (stillOnBattlefield) {
              movePermanentToHand(ctx as any, returnedCreatureId);
            }
          }
        } catch {
          // The cast event remains replayable even if an older stream omitted
          // the selected permanent or an intervening effect already moved it.
        }

        const stackLengthBefore = ctx.state.stack?.length || 0;

        // Prefer full card object for replay (contains all card data)
        // Fall back to cardId for backward compatibility with old events
        const fromZone = String((e as any).fromZone || '').toLowerCase().trim();
        let spellCardData = (e as any).card || (e as any).cardId;
        if (fromZone === 'command' && typeof spellCardData === 'string') {
          const commanderCard = resolveReplayCommanderCard(ctx as any, e, String(spellCardData));
          if (commanderCard) {
            spellCardData = commanderCard;
          }
        }
        if ((fromZone === 'library' || fromZone === 'graveyard' || fromZone === 'exile') && typeof spellCardData === 'string') {
          const replayCard = resolveReplayCardForPermissionUse(ctx as any, e, fromZone, spellCardData);
          if (replayCard && typeof replayCard === 'object') {
            spellCardData = replayCard;
          }
        }
        if (fromZone === 'library' && typeof spellCardData === 'string') {
          const library = getReplayLibraryForPlayer(ctx as any, String((e as any).playerId || '').trim());
          const libraryCard = library.find((card: any) => String(card?.id || '') === String(spellCardData));
          if (libraryCard) {
            spellCardData = libraryCard;
          }
        }

        const playerIdForDurablePermissionUse = String((e as any).playerId || '').trim();
        const cardForDurablePermissionUse = typeof spellCardData === 'object' && spellCardData
          ? spellCardData
          : { id: spellCardData };
        const durablePermissionToRecord = playerIdForDurablePermissionUse
          ? resolveDurablePermissionForCastReplay(
            ctx.state as any,
            e as any,
            fromZone === 'library'
              ? getDurableLibraryPermissionForCard(ctx.state as any, playerIdForDurablePermissionUse as any, cardForDurablePermissionUse, 'cast')
              : fromZone === 'command'
                ? getDurableCommandZonePermissionForCard(ctx.state as any, playerIdForDurablePermissionUse as any, cardForDurablePermissionUse, 'cast')
                : fromZone === 'exile'
                  ? getDurablePlayableFromExilePermissionForCard(ctx.state as any, playerIdForDurablePermissionUse as any, cardForDurablePermissionUse, 'cast')
                  : fromZone === 'graveyard'
                    ? getMatchingGraveyardCastingPermission(ctx.state as any, playerIdForDurablePermissionUse as any, cardForDurablePermissionUse, 'cast')
                    : undefined,
          )
          : undefined;

        if (fromZone === 'library') {
          const library = getReplayLibraryForPlayer(ctx as any, String((e as any).playerId || '').trim());
          const spellCardId = String((spellCardData as any)?.id || (e as any).cardId || '').trim();
          const libraryIdx = library.findIndex((card: any) => String(card?.id || '') === spellCardId);
          if (libraryIdx !== -1) {
            const [removedCard] = library.splice(libraryIdx, 1);
            if (typeof spellCardData === 'string') {
              spellCardData = removedCard;
            }
          }
        }

        // Defensive replay hardening: if the persisted event indicates the spell
        // was cast from true exile, ensure any impulse-style tags/permissions are
        // cleaned up even if castSpell can't infer the source from current zones.
        try {
          if (fromZone === 'exile') {
            const cardObj = typeof spellCardData === 'string' ? { id: spellCardData } : spellCardData;
            const preparedSourcePermanentId = String((cardObj as any)?.preparedSourcePermanentId || '').trim();
            if (preparedSourcePermanentId) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '') === preparedSourcePermanentId);
              if (sourcePermanent) {
                clearPreparedPermanent((ctx.state as any) as any, sourcePermanent, {
                  preserveExileCardId: String((cardObj as any)?.id || '').trim(),
                });
              }
            }
            cleanupCardLeavingExile((ctx.state as any) as any, cardObj);
          }
        } catch {
          // best-effort only
        }
        castSpell(
          ctx as any,
          (e as any).playerId,
          typeof spellCardData === 'object' && spellCardData
            ? { ...spellCardData, ...(fromZone ? { fromZone } : {}) }
            : spellCardData,
          (e as any).targets,
          (e as any).xValue
        );

        try {
          const stackLengthAfter = ctx.state.stack?.length || 0;
          if (playerIdForDurablePermissionUse && stackLengthAfter > stackLengthBefore) {
            recordReplayDurablePermissionUse(ctx.state as any, durablePermissionToRecord);
          }
        } catch {
          // best-effort only
        }

        // Intervening-if support: persist replay-stable cast/payment metadata onto the new stack item.
        try {
          const stackArr = (ctx.state.stack || []) as any[];
          if (stackArr.length > stackLengthBefore && stackArr.length > 0) {
            const topStackItem = stackArr[stackArr.length - 1];
            const persistedStackItemId = String((e as any).stackItemId || '').trim();

            if (persistedStackItemId) {
              (topStackItem as any).id = persistedStackItemId;
            }

            const applyToStackItem = (key: string, value: any) => {
              (topStackItem as any)[key] = value;
              if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                (topStackItem as any).card[key] = value;
              }
            };

            if ((e as any).targetGrouping && typeof (e as any).targetGrouping === 'object') {
              applyToStackItem('targetGrouping', (e as any).targetGrouping);
            }

            // Provenance
            if (typeof (e as any).fromZone === 'string' && (e as any).fromZone) {
              const fromZone = String((e as any).fromZone);
              const fromZoneLower = fromZone.toLowerCase().trim();
              applyToStackItem('fromZone', fromZone);
              applyToStackItem('castSourceZone', fromZone);
              applyToStackItem('source', fromZone);

              if (fromZoneLower === 'hand') {
                applyToStackItem('castFromHand', true);
              }
              if (fromZoneLower === 'exile') {
                applyToStackItem('castFromExile', true);
              }
              if (fromZoneLower === 'graveyard') {
                applyToStackItem('castFromGraveyard', true);
              }
              if (fromZoneLower === 'command') {
                applyToStackItem('isCommander', true);
              }
            }
            if ((e as any).castFromHand === true) {
              applyToStackItem('castFromHand', true);
              applyToStackItem('source', 'hand');
              applyToStackItem('castSourceZone', 'hand');
            }
            if ((e as any).castWithoutPayingManaCost === true) {
              applyToStackItem('castWithoutPayingManaCost', true);
            }
            const graveyardPermissionId = resolveCastPermissionId(e as any);
            if (graveyardPermissionId) {
              applyToStackItem('graveyardPermissionId', graveyardPermissionId);
              applyToStackItem('castPermissionId', graveyardPermissionId);
            }
            const graveyardPermissionSourceName =
              (e as any).graveyardPermissionSourceName ??
              (e as any).card?.graveyardPermissionSourceName ??
              (e as any).card?.card?.graveyardPermissionSourceName;
            if (graveyardPermissionSourceName) {
              applyToStackItem('graveyardPermissionSourceName', String(graveyardPermissionSourceName));
            }
            const graveyardPermissionCostMode =
              (e as any).graveyardPermissionCostMode ??
              (e as any).card?.graveyardPermissionCostMode ??
              (e as any).card?.card?.graveyardPermissionCostMode;
            if (graveyardPermissionCostMode) {
              applyToStackItem('graveyardPermissionCostMode', String(graveyardPermissionCostMode));
              if (String(graveyardPermissionCostMode) === 'without_paying_mana_cost') {
                applyToStackItem('castWithoutPayingManaCost', true);
              }
            }
            if ((e as any).exileAfterResolution === true || (e as any).card?.exileAfterResolution === true || (e as any).card?.card?.exileAfterResolution === true) {
              applyToStackItem('exileAfterResolution', true);
            }
            const leaveBattlefieldReplacementDestination =
              (e as any).leaveBattlefieldReplacementDestination ??
              (e as any).card?.leaveBattlefieldReplacementDestination ??
              (e as any).card?.card?.leaveBattlefieldReplacementDestination;
            if (String(leaveBattlefieldReplacementDestination || '') === 'exile') {
              applyToStackItem('leaveBattlefieldReplacementDestination', 'exile');
            }
            const leaveBattlefieldReplacementSourceName =
              (e as any).leaveBattlefieldReplacementSourceName ??
              (e as any).card?.leaveBattlefieldReplacementSourceName ??
              (e as any).card?.card?.leaveBattlefieldReplacementSourceName;
            if (leaveBattlefieldReplacementSourceName) {
              applyToStackItem('leaveBattlefieldReplacementSourceName', String(leaveBattlefieldReplacementSourceName));
            }
            const leaveBattlefieldReplacementLifeGain = Number(
              (e as any).leaveBattlefieldReplacementLifeGain ??
              (e as any).card?.leaveBattlefieldReplacementLifeGain ??
              (e as any).card?.card?.leaveBattlefieldReplacementLifeGain ??
              0
            );
            if (leaveBattlefieldReplacementLifeGain > 0) {
              applyToStackItem('leaveBattlefieldReplacementLifeGain', leaveBattlefieldReplacementLifeGain);
            }
            if (typeof (e as any).faceIndex === 'number') {
              applyToStackItem('faceIndex', Number((e as any).faceIndex));
            }
            if (typeof (e as any).castAsAdventure === 'boolean') {
              applyToStackItem('castAsAdventure', (e as any).castAsAdventure);
            }
            if ((e as any).giftPromised === true) {
              applyToStackItem('giftPromised', true);
            }
            if (typeof (e as any).giftRecipient === 'string' && (e as any).giftRecipient) {
              applyToStackItem('giftRecipient', String((e as any).giftRecipient));
            }
            if (typeof (e as any).giftType === 'string' && (e as any).giftType) {
              applyToStackItem('giftType', String((e as any).giftType));
            }
            if (Array.isArray((e as any).copyRetargetValidTargets)) {
              applyToStackItem('copyRetargetValidTargets', (e as any).copyRetargetValidTargets.map((target: any) => (
                target && typeof target === 'object' && !Array.isArray(target)
                  ? { ...target }
                  : target
              )));
            }
            if (Array.isArray((e as any).copyRetargetTargetTypes)) {
              applyToStackItem('copyRetargetTargetTypes', (e as any).copyRetargetTargetTypes.slice());
            }
            if (typeof (e as any).copyRetargetMinTargets === 'number') {
              applyToStackItem('copyRetargetMinTargets', Number((e as any).copyRetargetMinTargets));
            }
            if (typeof (e as any).copyRetargetMaxTargets === 'number') {
              applyToStackItem('copyRetargetMaxTargets', Number((e as any).copyRetargetMaxTargets));
            }
            if (typeof (e as any).copyRetargetTargetDescription === 'string' && (e as any).copyRetargetTargetDescription) {
              applyToStackItem('copyRetargetTargetDescription', String((e as any).copyRetargetTargetDescription));
            }

            // Alternate-cost identifier
            const alt =
              (e as any).alternateCostId ??
              (e as any).alternate_cost_id ??
              (e as any).card?.alternateCostId ??
              (e as any).card?.card?.alternateCostId;
            if (alt) {
              applyToStackItem('alternateCostId', alt);
              const altLower = String(alt || '').toLowerCase().trim();
              // Best-effort boolean flags for common alternate cost templates.
              applyToStackItem('prowlCostWasPaid', altLower === 'prowl');
              applyToStackItem('surgeCostWasPaid', altLower === 'surge');
              applyToStackItem('madnessCostWasPaid', altLower === 'madness');
              applyToStackItem('spectacleCostWasPaid', altLower === 'spectacle');
              applyToStackItem('webSlingingCostWasPaid', altLower === 'web_slinging' || (e as any).webSlingingCostWasPaid === true);
              if (altLower === 'web_slinging' || (e as any).webSlingingCostWasPaid === true) {
                applyToStackItem('castUsingWebSlinging', true);
                const returnedId = String(
                  (e as any).webSlingingReturnedCreatureId
                  || (e as any).card?.webSlingingReturnedCreatureId
                  || '',
                ).trim();
                if (returnedId) applyToStackItem('webSlingingReturnedCreatureId', returnedId);
              }
            }

            // Mana/payment metadata
            if ((e as any).manaPayment && typeof (e as any).manaPayment === 'object') {
              const manaPayment = (e as any).manaPayment;
              applyToStackItem('manaPayment', Array.isArray(manaPayment) ? manaPayment.slice() : { ...manaPayment });
            }
            if (typeof (e as any).manaSpentTotal === 'number') {
              applyToStackItem('manaSpentTotal', (e as any).manaSpentTotal);
            }
            if ((e as any).manaSpentBreakdown && typeof (e as any).manaSpentBreakdown === 'object') {
              applyToStackItem('manaSpentBreakdown', { ...(e as any).manaSpentBreakdown });
            }
            if ((e as any).snowManaSpentByColor && typeof (e as any).snowManaSpentByColor === 'object') {
              applyToStackItem('snowManaSpentByColor', { ...(e as any).snowManaSpentByColor });
            }
            if (Array.isArray((e as any).snowManaColorsSpent)) {
              applyToStackItem('snowManaColorsSpent', (e as any).snowManaColorsSpent.slice());
            }
            if ((e as any).snowManaSpentKnown === true && typeof (e as any).snowManaSpent === 'boolean') {
              applyToStackItem('snowManaSpentKnown', true);
              applyToStackItem('snowManaSpent', (e as any).snowManaSpent);
            }
            if ((e as any).snowManaOfSpellColorsSpentKnown === true && typeof (e as any).snowManaOfSpellColorsSpent === 'boolean') {
              applyToStackItem('snowManaOfSpellColorsSpentKnown', true);
              applyToStackItem('snowManaOfSpellColorsSpent', (e as any).snowManaOfSpellColorsSpent);
            }
            if (typeof (e as any).convergeValue === 'number') {
              applyToStackItem('convergeValue', (e as any).convergeValue);
            }
            if (Array.isArray((e as any).manaSpentColors)) {
              applyToStackItem('manaSpentColors', (e as any).manaSpentColors.slice());
              applyToStackItem('manaColorsSpent', (e as any).manaSpentColors.slice());
            }
            if (Array.isArray((e as any).manaColorsSpent)) {
              applyToStackItem('manaColorsSpent', (e as any).manaColorsSpent.slice());
              if (!Array.isArray((e as any).manaSpentColors)) {
                applyToStackItem('manaSpentColors', (e as any).manaColorsSpent.slice());
              }
            }
            if (Array.isArray((e as any).convokeTappedCreatures)) {
              applyToStackItem('convokeTappedCreatures', (e as any).convokeTappedCreatures.slice());
            }
            if (typeof (e as any).manaFromCreaturesSpent === 'number') {
              applyToStackItem('manaFromCreaturesSpent', (e as any).manaFromCreaturesSpent);
            }
            if ((e as any).cantBeCountered === true) {
              applyToStackItem('cantBeCountered', true);
            }
            if (Array.isArray((e as any).cantBeCounteredBySourceColors)) {
              applyToStackItem('cantBeCounteredBySourceColors', (e as any).cantBeCounteredBySourceColors.slice());
            }
            const rawCounterImmunity = (e as any).counterImmunity;
            if (rawCounterImmunity !== undefined) {
              if (rawCounterImmunity === true) {
                applyToStackItem('counterImmunity', { unconditional: true });
                applyToStackItem('cantBeCountered', true);
              } else if (Array.isArray(rawCounterImmunity)) {
                applyToStackItem('counterImmunity', rawCounterImmunity.slice());
              } else if (rawCounterImmunity && typeof rawCounterImmunity === 'object') {
                applyToStackItem('counterImmunity', { ...rawCounterImmunity });
                if ((rawCounterImmunity as any).unconditional === true || (rawCounterImmunity as any).cantBeCountered === true) {
                  applyToStackItem('cantBeCountered', true);
                }
                const sourceColors =
                  (rawCounterImmunity as any).counterSourceColors ??
                  (rawCounterImmunity as any).sourceColors ??
                  (rawCounterImmunity as any).onlyAgainstSourceColors ??
                  (rawCounterImmunity as any).cantBeCounteredBySourceColors;
                if (!Array.isArray((e as any).cantBeCounteredBySourceColors) && Array.isArray(sourceColors)) {
                  applyToStackItem('cantBeCounteredBySourceColors', sourceColors.slice());
                }
              }
            }
            if ((e as any).entersBattlefieldWithCounters && typeof (e as any).entersBattlefieldWithCounters === 'object') {
              applyToStackItem('entersBattlefieldWithCounters', { ...(e as any).entersBattlefieldWithCounters });
            } else if (
              (e as any).card?.entersBattlefieldWithCounters
              && typeof (e as any).card.entersBattlefieldWithCounters === 'object'
            ) {
              applyToStackItem('entersBattlefieldWithCounters', { ...(e as any).card.entersBattlefieldWithCounters });
            }
            const timesKickedRaw = (e as any).timesKicked ?? (e as any).kickerPaidCount ?? (e as any).card?.timesKicked ?? (e as any).card?.kickerPaidCount;
            const timesKicked = Number.isFinite(Number(timesKickedRaw)) ? Math.max(0, Math.floor(Number(timesKickedRaw))) : undefined;
            if (timesKicked != null && timesKicked > 0) {
              applyToStackItem('timesKicked', timesKicked);
              applyToStackItem('kickerPaidCount', timesKicked);
              applyToStackItem('wasKicked', true);
            } else if ((e as any).wasKicked === true || (e as any).card?.wasKicked === true) {
              applyToStackItem('wasKicked', true);
            }
            if ((e as any).gainsHasteUntilEndOfTurnFromManaSpent === true) {
              applyToStackItem('gainsHasteUntilEndOfTurnFromManaSpent', true);
            }

            // Positive-only evidence flags
            if ((e as any).manaFromTreasureSpent === true) {
              applyToStackItem('manaFromTreasureSpent', true);
            }
            if ((e as any).manaFromTreasureSpentKnown === true && typeof (e as any).manaFromTreasureSpent === 'boolean') {
              applyToStackItem('manaFromTreasureSpentKnown', true);
              applyToStackItem('manaFromTreasureSpent', (e as any).manaFromTreasureSpent);
            }
            // Additional cost payment metadata (deterministic when explicitly known).
            if ((e as any).additionalCostPaidKnown === true && typeof (e as any).additionalCostPaid === 'boolean') {
              const v = (e as any).additionalCostPaid;
              applyToStackItem('additionalCostPaidKnown', true);
              applyToStackItem('additionalCostPaid', v);
              // Keep legacy aliases in sync.
              applyToStackItem('additionalCostWasPaid', v);
              applyToStackItem('paidAdditionalCost', v);
            } else if ((e as any).additionalCostWasPaid === true || (e as any).paidAdditionalCost === true || (e as any).additionalCostPaid === true) {
              // Positive-only evidence.
              applyToStackItem('additionalCostWasPaid', true);
              applyToStackItem('paidAdditionalCost', true);
              applyToStackItem('additionalCostPaid', true);
            }
            if ((e as any).evidenceCollected === true || (e as any).evidenceWasCollected === true || (e as any).collectedEvidence === true) {
              applyToStackItem('evidenceCollected', true);
              applyToStackItem('evidenceWasCollected', true);
              applyToStackItem('collectedEvidence', true);
            }

            // Bargain (explicit, replay-stable boolean if present)
            const rawWasBargained =
              (e as any).wasBargained ??
              (e as any).bargained ??
              (e as any).card?.wasBargained ??
              (e as any).card?.card?.wasBargained;
            if (typeof rawWasBargained === 'boolean') {
              applyToStackItem('wasBargained', rawWasBargained);
              if ((e as any).bargainResolved === true) {
                applyToStackItem('bargainResolved', true);
              }
            }

            const rawTeamworkWasPaid =
              (e as any).teamworkWasPaid ??
              (e as any).card?.teamworkWasPaid ??
              (e as any).card?.card?.teamworkWasPaid;
            if (typeof rawTeamworkWasPaid === 'boolean') {
              applyToStackItem('teamworkWasPaid', rawTeamworkWasPaid);
              if ((e as any).teamworkResolved === true) {
                applyToStackItem('teamworkResolved', true);
              }
            }
          }
        } catch {
          // best-effort only
        }

        try {
          const stateAny = (ctx.state as any) as any;
          const delayedEntries = Array.isArray(stateAny.delayedSpellCopiesThisTurn)
            ? stateAny.delayedSpellCopiesThisTurn
            : [];
          const playerId = String((e as any).playerId || '').trim();
          const spellTypeLine = String((spellCardData as any)?.type_line || (e as any)?.card?.type_line || '').toLowerCase();
          if (
            delayedEntries.length > 0
            && playerId
            && (spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery'))
          ) {
            stateAny.delayedSpellCopiesThisTurn = delayedEntries.filter((entry: any) => !(
              String(entry?.controllerId || '').trim() === playerId
              && String(entry?.spellType || '').trim() === 'instant_or_sorcery'
            ));
          }
        } catch {
          // best-effort only
        }

        // Replay: once castSpell is applied, drop any pre-cast payment/target prompts and
        // pendingSpellCasts for this card so restore/undo does not re-ask for mana.
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const castCardId = String(
            (typeof spellCardData === 'object' && spellCardData ? (spellCardData as any).id : '')
            || (e as any).cardId
            || '',
          ).trim();
          const effectIdFromEvent = String((e as any).effectId || '').trim();
          const pending = (ctx.state as any)?.pendingSpellCasts;
          if (pending && typeof pending === 'object') {
            for (const [eid, cast] of Object.entries(pending)) {
              const castCard = String((cast as any)?.cardId || '').trim();
              if (
                (effectIdFromEvent && String(eid) === effectIdFromEvent)
                || (castCardId && castCard === castCardId)
              ) {
                delete pending[eid];
              }
            }
          }
          if (replayGameId && (castCardId || effectIdFromEvent)) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepEffectId = String(step?.effectId || step?.spellCastContext?.effectId || '').trim();
              const stepCardId = String(
                step?.cardId || step?.spellCastContext?.cardId || step?.sourceId || '',
              ).trim();
              if (effectIdFromEvent && stepEffectId === effectIdFromEvent) return true;
              if (!castCardId || stepCardId !== castCardId) return false;
              const stepType = String(step?.type || '');
              return (
                step?.spellPaymentRequired === true
                || stepType === 'mana_payment_choice'
                || stepType === 'target_selection'
                || stepType === 'mode_selection'
                || stepType === 'additional_cost_payment'
                || stepType === 'x_value_selection'
                || stepType === 'mutate_target_selection'
                || stepType === 'option_choice'
              );
            });
          }
        } catch {
          // best-effort only
        }
        break;
      }

      case "castSpellContinuation": {
        const playerId = String((e as any).playerId || '').trim();
        const cardId = String((e as any).cardId || '').trim();

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          clearReplayQueuedStepById(replayGameId, String((e as any).resolvedStepId || '').trim());

          const rawQueuedStep = (e as any).queuedResolutionStep;
          const rawQueuedSteps = Array.isArray((e as any).queuedResolutionSteps)
            ? ((e as any).queuedResolutionSteps as any[]).filter((step) => step && typeof step === 'object' && !Array.isArray(step))
            : [];
          const pendingSpellCast = (e as any).pendingSpellCast;
          const pendingEffectId = String((e as any).effectId || (pendingSpellCast as any)?.effectId || '').trim();
          const queuedStepsToReplayRaw = rawQueuedSteps.length > 0
            ? rawQueuedSteps
            : (rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) ? [rawQueuedStep] : []);
          const effectProgramMetadata = normalizeReplayEffectProgramMetadata((e as any).effectProgram);
          const queuedStepsToReplay = queuedStepsToReplayRaw.map((queuedStep) => (
            effectProgramMetadata
              ? {
                  ...(queuedStep as any),
                  effectProgramPrompt: true,
                  ...effectProgramMetadata,
                }
              : queuedStep
          ));
          const hasQueuedStepsToReplay = replayGameId
            && queuedStepsToReplay.length > 0
            && queuedStepsToReplay.every((step: any) => String(step?.type || '').trim().length > 0);
          if (hasQueuedStepsToReplay) {
            if (pendingEffectId && pendingSpellCast && typeof pendingSpellCast === 'object' && !Array.isArray(pendingSpellCast)) {
              const stateAny = ctx.state as any;
              stateAny.pendingSpellCasts = stateAny.pendingSpellCasts || {};
              stateAny.pendingSpellCasts[pendingEffectId] = { ...(pendingSpellCast as any) };
            }

            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            for (const queuedStep of queuedStepsToReplay) {
              const queuedStepType = String((queuedStep as any)?.type || '').trim();
              const queuedStepId = String((queuedStep as any)?.id || '').trim();
              const alreadyPresent = Boolean(
                (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
                (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
              );

              if (!alreadyPresent) {
                ResolutionQueueManager.addStep(replayGameId, {
                  ...(queuedStep as any),
                  ...(queuedStepId ? { id: queuedStepId } : {}),
                  type: queuedStepType as any,
                  playerId: String((queuedStep as any).playerId || playerId || '') as any,
                  description: String((queuedStep as any).description || ''),
                  mandatory: (queuedStep as any).mandatory !== false,
                } as any, { allowDuringReplay: true });
              }
            }

            ctx.bumpSeq();
            break;
          }

          if (playerId && (e as any).lifePaid != null) {
            applyRecordedLifePayment(ctx, playerId, (e as any).lifePaid);
          }

          const moveHandCards = Array.isArray((e as any).moveHandCards) ? (e as any).moveHandCards : [];
          for (const moveSpec of moveHandCards) {
            applyReplayHandCardMove(ctx, playerId, moveSpec);
          }

          if (playerId && cardId && (e as any).cardUpdates && typeof (e as any).cardUpdates === 'object') {
            applyReplayCardUpdatesInHand(ctx, playerId, cardId, (e as any).cardUpdates);
          }

          const sacrificedPermanentIds = Array.isArray((e as any).sacrificedPermanentIds)
            ? (e as any).sacrificedPermanentIds
            : (Array.isArray((e as any).sacrificedPermanents) ? (e as any).sacrificedPermanents : []);
          // Additional-cost sacrifices are deferred until castSpell commits. Store the
          // selection on the card for the later cast; do not sac here or a cancelled /
          // aborted cast leaves the permanent dead while the spell remains in hand.
          if ((e as any).deferAdditionalCostSacrifice === true && playerId && cardId) {
            const pendingIds = sacrificedPermanentIds.map((id: any) => String(id || '').trim()).filter(Boolean);
            applyReplayCardUpdatesInHand(ctx, playerId, cardId, {
              pendingAdditionalCostSacrificeIds: pendingIds,
              additionalCostPaid: true,
            });
          } else {
            for (const permanentId of sacrificedPermanentIds) {
              applyReplaySacrificedPermanent(ctx, String(permanentId || ''));
            }
          }

          const removedCountersForCost = Array.isArray((e as any).removedCountersForCost) ? (e as any).removedCountersForCost : [];
          for (const entry of removedCountersForCost) {
            const permanentId = String(entry?.permanentId || '').trim();
            const counterType = String(entry?.counterType || '').trim();
            const count = Number(entry?.count || 0);
            if (!permanentId || !counterType || !Number.isFinite(count) || count <= 0) continue;
            updateCounters(ctx as any, permanentId, { [counterType]: -count });
          }

          const revealedCardIdsForCost = Array.isArray((e as any).revealedCardIdsForCost)
            ? (e as any).revealedCardIdsForCost.map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          if (playerId && cardId && revealedCardIdsForCost.length > 0) {
            const stateAny = ctx.state as any;
            stateAny.revealedCardIdsForCostBySpell = stateAny.revealedCardIdsForCostBySpell || {};
            stateAny.revealedCardIdsForCostBySpell[cardId] = revealedCardIdsForCost;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(castSpellContinuation): failed', err);
        }
        break;
      }

      case "resolveTopOfStackPrompt": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          let stateMutated = false;
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const rawQueuedSteps = Array.isArray((e as any).queuedResolutionSteps)
            ? ((e as any).queuedResolutionSteps as any[]).filter((step) => step && typeof step === 'object' && !Array.isArray(step))
            : [];
          const queuedStepsToReplayRaw = rawQueuedSteps.length > 0
            ? rawQueuedSteps
            : (rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) ? [rawQueuedStep] : []);
          const effectProgramMetadata = normalizeReplayEffectProgramMetadata((e as any).effectProgram);
          const queuedStepsToReplay = queuedStepsToReplayRaw.map((queuedStep) => (
            effectProgramMetadata
              ? {
                  ...(queuedStep as any),
                  effectProgramPrompt: true,
                  ...effectProgramMetadata,
                }
              : queuedStep
          ));

          for (const queuedStep of queuedStepsToReplay) {
            const stepPlayerId = String((queuedStep as any)?.playerId || playerId || '').trim();
            // Prefer zoneHandSnapshot (full cards). Never restore ChoiceOption `hand` stubs.
            const handSnapshot = resolvePromptZoneHandRestore(queuedStep);
            if (stepPlayerId && handSnapshot) {
              const stateAny = ctx.state as any;
              const zones = stateAny.zones = stateAny.zones || {};
              const z = zones[stepPlayerId] = zones[stepPlayerId] || {};
              z.hand = handSnapshot.map((card: any) => ({ ...card, zone: 'hand' }));
              z.handCount = z.hand.length;
              // Prompt hand snapshots can predate a sacrifice/fetch. After undo/replay,
              // strip any restored hand cards that already live in GY/exile/BF.
              const repaired = repairAllDualZoneGhosts(ctx);
              if (repaired > 0) {
                debug(1, `applyEvent(resolveTopOfStackPrompt): scrubbed ${repaired} dual-zone hand ghost(s) for ${stepPlayerId}`);
              }
              stateMutated = true;
            }
          }

          const deferredSourceId = String(
            (e as any).sourceId
            || (queuedStepsToReplay[0] as any)?.sourceId
            || (queuedStepsToReplay[0] as any)?.oracleIrSourceId
            || '',
          ).trim();
          const hasOracleIrQueuedChoice = queuedStepsToReplay.some(
            (step: any) => String(step?.oracleIrChoiceStepJson || step?.oracleIrResumeStepsJson || '').trim(),
          );
          if (hasOracleIrQueuedChoice) {
            ensureDeferredOracleIrStackItem(ctx, deferredSourceId || undefined);
            stateMutated = true;
          }

          const pendingCascadeEntry = (e as any).pendingCascadeEntry && typeof (e as any).pendingCascadeEntry === 'object' && !Array.isArray((e as any).pendingCascadeEntry)
            ? { ...((e as any).pendingCascadeEntry as Record<string, any>) }
            : undefined;
          const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
          const hasRemainingLibraryIdsField = eventHasOwnField(e, 'remainingLibraryIds');
          const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
            ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
            : [];
          const shouldSyncCascadeLibrary = Boolean(
            playerId && (pendingCascadeEntry || hasLibraryAfterField || hasRemainingLibraryIdsField),
          );

          if (shouldSyncCascadeLibrary) {
            const stateAny = ctx.state as any;
            const zones = stateAny.zones = stateAny.zones || {};
            const z = zones[playerId] = zones[playerId] || {
              hand: [],
              handCount: 0,
              library: [],
              libraryCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            };

            let libraryAfter: any[] | undefined;
            if (hasLibraryAfterField) {
              libraryAfter = cloneLibraryCards((e as any).libraryAfter as any[]);
            } else if (hasRemainingLibraryIdsField || pendingCascadeEntry) {
              const exiledCards = Array.isArray(pendingCascadeEntry?.exiledCards)
                ? (pendingCascadeEntry.exiledCards as any[])
                : [];
              libraryAfter = buildLibraryFromRemainingIds(
                getPlayerLibraryFromContext(ctx, playerId),
                exiledCards,
                remainingLibraryIds,
              );
            }
            if (libraryAfter) {
              z.library = cloneLibraryCards(libraryAfter);
              z.libraryCount = libraryAfter.length;
              if (ctx.libraries?.set) {
                ctx.libraries.set(playerId as any, cloneLibraryCards(libraryAfter));
              }
              stateMutated = true;
            }

            if (pendingCascadeEntry) {
              stateAny.pendingCascade = stateAny.pendingCascade || {};
              const playerQueue = Array.isArray(stateAny.pendingCascade[playerId]) ? stateAny.pendingCascade[playerId] : [];
              const normalizedEntry: any = {
                ...pendingCascadeEntry,
                hitCard: pendingCascadeEntry.hitCard && typeof pendingCascadeEntry.hitCard === 'object'
                  ? { ...(pendingCascadeEntry.hitCard as any) }
                  : pendingCascadeEntry.hitCard,
                exiledCards: Array.isArray(pendingCascadeEntry.exiledCards)
                  ? (pendingCascadeEntry.exiledCards as any[]).map((card: any) => ({ ...card }))
                  : [],
                awaiting: pendingCascadeEntry.awaiting === true,
              };

              const effectId = String(normalizedEntry.effectId || '').trim();
              const sourceCardId = String(normalizedEntry.sourceCardId || '').trim();
              const sourceName = String(normalizedEntry.sourceName || '').trim();
              const instance = Number(normalizedEntry.instance || 0);
              const existingIndex = playerQueue.findIndex((entry: any) => {
                if (!entry || typeof entry !== 'object') return false;
                if (effectId && String(entry.effectId || '').trim() === effectId) return true;
                if (sourceCardId && String(entry.sourceCardId || '').trim() === sourceCardId) {
                  return instance <= 0 || Number(entry.instance || 0) === instance;
                }
                return Boolean(sourceName) && String(entry.sourceName || '').trim() === sourceName;
              });

              if (existingIndex >= 0) {
                playerQueue[existingIndex] = normalizedEntry;
              } else {
                playerQueue.unshift(normalizedEntry);
              }

              stateAny.pendingCascade[playerId] = playerQueue;
              stateMutated = true;
            }
          }

          if (replayGameId && queuedStepsToReplay.length > 0) {
            if ((ctx as any).isReplaying) {
              replayEnsureAsEntersPermanentFromPromptSteps(
                ctx as any,
                queuedStepsToReplay,
                deferredSourceId,
              );
            }
            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            for (const queuedStep of queuedStepsToReplay) {
              const queuedStepId = String((queuedStep as any)?.id || '').trim();
              const queuedStepType = String((queuedStep as any)?.type || '').trim();
              if (!queuedStepType) continue;

              const alreadyPresent = Boolean(
                (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
                (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
              );

              if (!alreadyPresent) {
                ResolutionQueueManager.addStep(replayGameId, {
                  ...(queuedStep as any),
                  ...(queuedStepId ? { id: queuedStepId } : {}),
                  type: queuedStepType as any,
                  playerId: String((queuedStep as any).playerId || playerId || '') as any,
                  description: String((queuedStep as any).description || ''),
                  mandatory: (queuedStep as any).mandatory !== false,
                } as any, { allowDuringReplay: true });
                stateMutated = true;
              }
            }
          }

          if (stateMutated) {
            ctx.bumpSeq();
          }
        } catch (err) {
          debugWarn(1, 'applyEvent(resolveTopOfStackPrompt): failed', err);
        }
        break;
      }

      case "optionalTriggeredAbilityChoice": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const choice = String((e as any).choice || 'no').trim().toLowerCase();
          const deferredTriggeredAbilityItem = (e as any).deferredTriggeredAbilityItem;
          const sourceName = String((e as any).sourceName || 'Ability').trim() || 'Ability';
          const effectProgramMetadata = normalizeReplayEffectProgramMetadata((e as any).effectProgram);

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              if (effectProgramMetadata?.effectProgramId) {
                return (
                  (step as any)?.effectProgramPrompt === true &&
                  String((step as any)?.effectProgramId || '').trim() === effectProgramMetadata.effectProgramId
                );
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.optionalTriggeredAbilityPrompt === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          if (choice !== 'yes') {
            ctx.bumpSeq();
            break;
          }

          const choiceBinding = (e as any).choiceBinding;
          if (
            !deferredTriggeredAbilityItem
            && effectProgramMetadata
            && choiceBinding
            && typeof choiceBinding === 'object'
          ) {
            applyEffectProgramChoiceBindingOnReplay(ctx, replayGameId, {
              playerId: String((e as any).playerId || '').trim(),
              sourceId,
              sourceName,
              resolvedStepId,
              effectProgram: effectProgramMetadata as any,
              choiceBinding,
              deferredTriggeredAbilityItem,
            }, { queuePendingChoices: false });
            ctx.bumpSeq();
            break;
          }

          if (!deferredTriggeredAbilityItem || typeof deferredTriggeredAbilityItem !== 'object') {
            debugWarn(1, `applyEvent(optionalTriggeredAbilityChoice): missing deferred trigger payload for ${sourceName}`);
            break;
          }

          const directEffectText = String(
            (deferredTriggeredAbilityItem as any)?.effect
            || (deferredTriggeredAbilityItem as any)?.description
            || ''
          ).trim();
          const controllerId = String((deferredTriggeredAbilityItem as any)?.controller || (e as any)?.playerId || '').trim();
          // Temporarily restore the stored turn number so the graveyard permission
          // marker is set to the correct turn (important for replay-from-scratch).
          const eventTurnNumber = Number((e as any).turnNumber || 0);
          const prevTurnNumber = Number((ctx.state as any).turnNumber ?? (ctx.state as any).turn ?? 0) || 0;
          const prevTurnPlayer = String((ctx.state as any).turnPlayer || '').trim();
          // Temporarily restore turn context so graveyard permission checks (e.g. "it's your turn")
          // see the correct values from when the event was originally applied.
          if (eventTurnNumber > 0 && eventTurnNumber !== prevTurnNumber) {
            (ctx.state as any).turnNumber = eventTurnNumber;
            (ctx.state as any).turn = eventTurnNumber;
          }
          if (controllerId && (!prevTurnPlayer || prevTurnPlayer !== controllerId)) {
            (ctx.state as any).turnPlayer = controllerId;
          }
          if (
            controllerId &&
            applyGraveyardPermissionEffectsFromText(
              ctx as any,
              controllerId as PlayerID,
              sourceName,
              directEffectText,
              deferredTriggeredAbilityItem,
            ) > 0
          ) {
            // Restore original turn context after setting the permission
            if (eventTurnNumber > 0 && eventTurnNumber !== prevTurnNumber) {
              (ctx.state as any).turnNumber = prevTurnNumber || undefined;
              (ctx.state as any).turn = prevTurnNumber || undefined;
            }
            if (controllerId && (!prevTurnPlayer || prevTurnPlayer !== controllerId)) {
              (ctx.state as any).turnPlayer = prevTurnPlayer || '';
            }
            ctx.bumpSeq();
            break;
          }
          if (eventTurnNumber > 0 && eventTurnNumber !== prevTurnNumber) {
            (ctx.state as any).turnNumber = prevTurnNumber || undefined;
            (ctx.state as any).turn = prevTurnNumber || undefined;
          }
          if (controllerId && (!prevTurnPlayer || prevTurnPlayer !== controllerId)) {
            (ctx.state as any).turnPlayer = prevTurnPlayer || '';
          }

          // Full event-log replay must not live-resolve the deferred trigger.
          // Live resolveTopOfStack re-runs ETB/cast side effects (Altar of the Brood,
          // Aura Shards, token factories, etc.) which push *new* triggers that are
          // not balanced by later resolveTopOfStack events — leaving 10–20+ orphans
          // after restart even though the player's yes/no was already persisted.
          // Outcomes for the accepted ability live in subsequent mutation events.
          if ((ctx as any).isReplaying) {
            ctx.bumpSeq();
            break;
          }

          ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
          (ctx.state.stack as any[]).push({
            ...(deferredTriggeredAbilityItem as any),
            optionalTriggeredAbilityDecisionApplied: true,
          });

          resolveTopOfStack(ctx as any);
        } catch (err) {
          debugWarn(1, 'applyEvent(optionalTriggeredAbilityChoice): failed', err);
        }
        break;
      }

      case "optionalPaymentPromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const choiceId = String((e as any).choiceId || '').trim().toLowerCase();
          const paid = choiceId.startsWith('pay');
          const echoChoice = (e as any).echoChoice === true;

          if (paid) {
            const playerId = String((e as any).playerId || '').trim();
            const stateAny = ctx.state as any;
            const validationKind = String((e as any).optionalPaymentValidationKind || '').trim().toLowerCase();
            const energyCost = Number((e as any).energyCost || 0);
            const manaCost = String((e as any).manaCost || '').trim();
            if (playerId && energyCost > 0) {
              stateAny.energy = stateAny.energy || {};
              const currentEnergy = Number(stateAny.energy[playerId] || 0);
              stateAny.energy[playerId] = Math.max(0, currentEnergy - energyCost);
              stateAny.energyCount = stateAny.energyCount || {};
              stateAny.energyCount[playerId] = stateAny.energy[playerId];
            } else if (playerId && validationKind === 'mana' && manaCost) {
              stateAny.manaPool = stateAny.manaPool || {};
              stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
              consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);
            }

            if (echoChoice && sourceId) {
              markEchoPaid({ ...(ctx as any), zones: ctx.state?.zones } as any, sourceId);
            }
          } else if (echoChoice && sourceId) {
            const playerId = String((e as any).playerId || '').trim();
            if (playerId) {
              sacrificePermanent({ ...(ctx as any), zones: ctx.state?.zones } as any, sourceId, playerId);
            }
          }

          if (replayGameId) {
            const effectProgramMetadata = normalizeReplayEffectProgramMetadata((e as any).effectProgram);
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              if (effectProgramMetadata?.effectProgramId) {
                return (
                  (step as any)?.effectProgramPrompt === true &&
                  String((step as any)?.effectProgramId || '').trim() === effectProgramMetadata.effectProgramId
                );
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.optionalPaymentPrompt === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(optionalPaymentPromptResolve): failed', err);
        }
        break;
      }

      case "miraclePromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || (e as any).miracleCardId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const accepted = (e as any).accepted === true || String((e as any).choiceId || '').trim() === 'cast_miracle';

          if (!accepted && playerId && sourceId) {
            const zones = (ctx.state as any)?.zones?.[playerId];
            const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
            const card = hand.find((entry: any) => entry && String(entry.id || '') === sourceId);
            if (card) {
              delete (card as any).isFirstDrawnThisTurn;
              delete (card as any).drawnAt;
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.miraclePrompt === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                sourceId.length > 0 &&
                String((step as any)?.miracleCardId || (step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(miraclePromptResolve): failed', err);
        }
        break;
      }

      case "mutateCastModeChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || (e as any).mutateCardId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.mutateCastModeChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                sourceId.length > 0 &&
                String((step as any)?.mutateCardId || (step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mutateCastModeChoiceResolve): failed', err);
        }
        break;
      }

      case "mirrormindCrownTokenReplacementChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || (e as any).mirrormindCrownEquipmentId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.mirrormindCrownTokenReplacementChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.mirrormindCrownEquipmentId || (step as any)?.sourceId || '').trim() === sourceId)
              );
            });
          }

          restoreMirrormindReplayTokens(ctx as any, e as any);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mirrormindCrownTokenReplacementChoiceResolve): failed', err);
        }
        break;
      }

      case "mayAbilityResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const effectKey = String((e as any).effectKey || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.mayAbilityPrompt === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!effectKey || String((step as any)?.effectKey || '').trim() === effectKey)
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mayAbilityResolve): failed', err);
        }
        break;
      }

      case "upkeepSacrificeResolve": {
        try {
          clearReplayQueuedStepById(
            String((ctx as any).gameId || '').trim(),
            String((e as any).resolvedStepId || '').trim(),
          );
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(upkeepSacrificeResolve): failed', err);
        }
        break;
      }

      case "keywordPromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const stepType = String((e as any).stepType || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const permanentId = String((e as any).permanentId || (e as any).creatureId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const candidateStepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && candidateStepId === resolvedStepId) return true;

              if (stepType && String((step as any)?.type || '').trim() !== stepType) return false;
              if (playerId && String((step as any)?.playerId || '').trim() !== playerId) return false;

              const candidatePermanentId = String((step as any)?.permanentId || (step as any)?.creatureId || '').trim();
              const candidateSourceId = String((step as any)?.sourceId || '').trim();
              if (permanentId && candidatePermanentId && candidatePermanentId !== permanentId) return false;
              if (sourceId && candidateSourceId && candidateSourceId !== sourceId) return false;

              return Boolean(stepType || playerId || permanentId || sourceId);
            });
          }

          applyKeywordPromptResolveOutcome(ctx, e as Record<string, unknown>);

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(keywordPromptResolve): failed', err);
        }
        break;
      }

      case "reflexiveManaPaymentResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const paidAmount = Math.max(0, Math.floor(Number((e as any).paidAmount || 0)));
          const paymentUnit = String((e as any).paymentUnit || 'mana').trim() || 'mana';

          if (playerId && paidAmount > 0) {
            consumeReflexiveManaAmountFromPool(ctx.state as any, playerId, paymentUnit as any, paidAmount);
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.reflexiveManaPaymentChoice === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveManaPaymentResolve): failed', err);
        }
        break;
      }

      case "reflexiveFixedPaymentResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const paid = (e as any).paid === true;
          const manaCost = String((e as any).manaCost || '').trim();
          const lifeAmount = Math.max(0, Math.floor(Number((e as any).lifeAmount || 0)));

          if (paid && playerId) {
            if (manaCost) {
              const pool = getOrInitManaPool(ctx.state as any, playerId) as any;
              const resolved = resolveManaCostForPoolPayment(pool, manaCost);
              if (resolved.ok) {
                consumeManaFromPool(pool as any, resolved.coloredCost, resolved.genericCost, `[replay:reflexiveFixedPayment:${manaCost}]`);
              }
            }

            if (lifeAmount > 0) {
              applyRecordedLifePayment(ctx, playerId, lifeAmount);
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.reflexiveFixedPaymentChoice === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveFixedPaymentResolve): failed', err);
        }
        break;
      }

      case "reflexiveDiscardResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const cardIds = Array.isArray((e as any).cardIds)
            ? ((e as any).cardIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (playerId && cardIds.length > 0) {
            const playerZones = ensureReplayPlayerZones(ctx.state as any, playerId);
            const hand = Array.isArray(playerZones.hand) ? playerZones.hand as any[] : [];
            playerZones.hand = hand;
            playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
            const graveyard = playerZones.graveyard as any[];
            let movedCount = 0;

            for (const cardId of cardIds) {
              const handIndex = hand.findIndex((card: any) => card && String(card.id || '') === cardId);
              if (handIndex === -1) continue;
              const [card] = hand.splice(handIndex, 1);
              pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, card, graveyard, {
                extraFields: {
                  discardedByPlayerId: playerId,
                  discardedOnTurn: Number((ctx.state as any)?.turnNumber ?? (ctx.state as any)?.turn ?? 0) || 0,
                },
              });
              movedCount++;
            }

            playerZones.handCount = hand.length;
            playerZones.graveyardCount = graveyard.length;
            if (movedCount > 0) {
              const stateAny = ctx.state as any;
              stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
              stateAny.discardedCardThisTurn[playerId] = true;
              stateAny.anyPlayerDiscardedCardThisTurn = true;
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                (step as any)?.reflexiveDiscardWhenYouDo === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveDiscardResolve): failed', err);
        }
        break;
      }

      case "reflexiveConvertResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const converted = (e as any).converted === true;
          const faceIndex = Math.max(0, Math.min(1, Math.floor(Number((e as any).faceIndex ?? 1)))) as 0 | 1;

          if (converted && sourceId) {
            const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
            const permanent = battlefield.find((entry: any) => String(entry?.id || '') === sourceId);
            if (permanent) {
              transformPermanentToFace(permanent, faceIndex, ctx as any);
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                (step as any)?.reflexiveConvertWhenYouDo === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveConvertResolve): failed', err);
        }
        break;
      }

      case "reflexiveGraveyardExileResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const zoneOwnerId = String((e as any).zoneOwnerId || (e as any).targetPlayerId || playerId).trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const cardIds = Array.isArray((e as any).cardIds)
            ? ((e as any).cardIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (zoneOwnerId && cardIds.length > 0) {
            const playerZones = ensureReplayPlayerZones(ctx.state as any, zoneOwnerId);
            const graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard as any[] : [];
            playerZones.graveyard = graveyard;
            playerZones.exile = Array.isArray(playerZones.exile) ? playerZones.exile : [];
            const exile = playerZones.exile as any[];
            let movedCard: any | undefined;

            for (const cardId of cardIds) {
              const graveyardIndex = graveyard.findIndex((card: any) => card && String(card.id || '') === cardId);
              if (graveyardIndex === -1) continue;
              const [card] = graveyard.splice(graveyardIndex, 1);
              exile.push({ ...card, zone: 'exile' });
              movedCard = movedCard || card;
            }

            playerZones.graveyardCount = graveyard.length;
            playerZones.exileCount = exile.length;
            if (movedCard) {
              recordCardLeftGraveyardThisTurn(ctx as any, zoneOwnerId, movedCard);
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                ((step as any)?.reflexiveGraveyardExileWhenYouDo === true ||
                  (step as any)?.reflexiveBoundGraveyardSelfExileWhenYouDo === true) &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reflexiveGraveyardExileResolve): failed', err);
        }
        break;
      }

      case "castFromExilePromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const cardId = String((e as any).cardId || '').trim();
          const choice = String((e as any).choice || 'decline').trim().toLowerCase();
          const declineDestination = String((e as any).declineDestination || 'exile').trim().toLowerCase();
          const declineDamageEachOpponent = Number((e as any).declineDamageEachOpponent || 0);
          const declineDamageSourcePermanentId = String((e as any).declineDamageSourcePermanentId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                cardId.length > 0 &&
                String((step as any)?.castFromExileCardId || '').trim() === cardId &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId)
              );
            });
          }

          if (choice === 'cast') {
            ctx.bumpSeq();
            break;
          }

          const zones = ((ctx.state as any)?.zones || {})[playerId];
          const exile = Array.isArray(zones?.exile) ? zones.exile : undefined;
          if (!zones || !exile || !cardId) {
            ctx.bumpSeq();
            break;
          }

          const exileIndex = exile.findIndex((card: any) => card && String(card.id || '').trim() === cardId);
          if (exileIndex === -1) {
            ctx.bumpSeq();
            break;
          }

          let exiledCard = exile[exileIndex];

          if (declineDestination === 'exile') {
            cleanupCardLeavingExile((ctx.state as any) as any, exiledCard);
          } else {
            const [removedCard] = exile.splice(exileIndex, 1);
            exiledCard = removedCard;
            zones.exileCount = exile.length;
            cleanupCardLeavingExile((ctx.state as any) as any, exiledCard);
          }

          if (declineDestination === 'graveyard') {
            zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
            pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, exiledCard, zones.graveyard);
            zones.graveyardCount = zones.graveyard.length;
          } else if (declineDestination === 'hand') {
            const toHand = { ...exiledCard, zone: 'hand' };
            delete (toHand as any).canBePlayedBy;
            delete (toHand as any).playableUntilTurn;
            delete (toHand as any).withoutPayingManaCost;
            delete (toHand as any).castWithoutPayingManaCost;
            zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
            zones.hand.push(toHand);
            zones.handCount = zones.hand.length;
            const player = ((ctx.state as any)?.players || []).find(
              (entry: any) => String(entry?.id || '').trim() === playerId,
            );
            if (player) {
              player.hand = Array.isArray(player.hand) ? player.hand : [];
              player.hand.push({ ...toHand });
              if (Array.isArray(player.exile)) {
                const playerExileIndex = player.exile.findIndex(
                  (card: any) => String(card?.id || '').trim() === cardId,
                );
                if (playerExileIndex !== -1) player.exile.splice(playerExileIndex, 1);
              }
            }
          } else if (declineDestination === 'library_bottom_random') {
            const bottomed = { ...exiledCard, zone: 'library' };
            zones.library = Array.isArray(zones.library) ? zones.library : [];
            zones.library.push(bottomed);
            zones.libraryCount = zones.library.length;
            const lib = ctx.libraries?.get?.(playerId as any);
            if (Array.isArray(lib)) {
              lib.push({ ...bottomed });
              ctx.libraries.set(playerId as any, lib);
            } else if (ctx.libraries?.set) {
              ctx.libraries.set(playerId as any, [{ ...bottomed }]);
            }
          }

          if (Number.isFinite(declineDamageEachOpponent) && declineDamageEachOpponent > 0) {
            const startingLife = Number((ctx.state as any).startingLife || 40);
            (ctx.state as any).life = (ctx.state as any).life || {};

            const battlefield = Array.isArray((ctx.state as any).battlefield) ? (ctx.state as any).battlefield : [];
            const sourceCreature = declineDamageSourcePermanentId
              ? battlefield.find((perm: any) => perm && String(perm.id || '').trim() === declineDamageSourcePermanentId)
              : undefined;
            const sourceIsCreature = Boolean(String(sourceCreature?.card?.type_line || '').toLowerCase().includes('creature'));

            for (const player of (ctx.state as any).players || []) {
              const opponentId = String(player?.id || '').trim();
              if (!opponentId || opponentId === playerId) continue;

              const currentLife = Number((ctx.state as any).life[opponentId] ?? startingLife);
              (ctx.state as any).life[opponentId] = currentLife - declineDamageEachOpponent;

              (ctx.state as any).damageTakenThisTurnByPlayer = (ctx.state as any).damageTakenThisTurnByPlayer || {};
              (ctx.state as any).damageTakenThisTurnByPlayer[opponentId] =
                ((ctx.state as any).damageTakenThisTurnByPlayer[opponentId] || 0) + declineDamageEachOpponent;

              (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
              (ctx.state as any).lifeLostThisTurn[opponentId] =
                ((ctx.state as any).lifeLostThisTurn[opponentId] || 0) + declineDamageEachOpponent;

              if (sourceIsCreature && sourceCreature) {
                const sourcePermanentId = String(sourceCreature.id || '').trim();
                if (sourcePermanentId) {
                  (ctx.state as any).creaturesThatDealtDamageToPlayer = (ctx.state as any).creaturesThatDealtDamageToPlayer || {};
                  const perPlayer = (((ctx.state as any).creaturesThatDealtDamageToPlayer[opponentId] =
                    (ctx.state as any).creaturesThatDealtDamageToPlayer[opponentId] || {}) as any);
                  perPlayer[sourcePermanentId] = {
                    creatureName: String(sourceCreature.card?.name || 'Unknown Creature'),
                    totalDamage: (perPlayer[sourcePermanentId]?.totalDamage || 0) + declineDamageEachOpponent,
                    lastDamageTime: Date.now(),
                  };
                }
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(castFromExilePromptResolve): failed', err);
        }
        break;
      }

      case "castFromGraveyardPromptResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const cardId = String((e as any).cardId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                cardId.length > 0 &&
                String((step as any)?.castFromGraveyardCardId || '').trim() === cardId &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId)
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(castFromGraveyardPromptResolve): failed', err);
        }
        break;
      }

      case "copyTriggeredAbilityResolve": {
        try {
          const paid = (e as any).paid !== false;
          const triggerStackItemId = String((e as any).triggerStackItemId || '').trim();
          const triggeringStackItemId = String((e as any).triggeringStackItemId || '').trim();
          const copiedStackItemId = String((e as any).copiedStackItemId || '').trim();
          const controllerId = String((e as any).controllerId || '').trim();
          const sourceName = String((e as any).sourceName || 'Ability').trim() || 'Ability';
          const manaCost = String((e as any).manaCost || '').trim();

          ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
          const stack = ctx.state.stack as any[];
          if (triggerStackItemId) {
            const triggerIndex = stack.findIndex((item: any) => item && String(item.id || '').trim() === triggerStackItemId);
            if (triggerIndex >= 0) {
              stack.splice(triggerIndex, 1);
            }
          }
          if (!paid) {
            ctx.bumpSeq();
            break;
          }
          if (!triggeringStackItemId) break;

          const existingCopiedItem = copiedStackItemId
            ? stack.find((item: any) => item && String(item.id || '').trim() === copiedStackItemId)
            : null;
          if (!existingCopiedItem) {
            const original = stack.find((item: any) => item && String(item.id || '').trim() === triggeringStackItemId);
            if (!original) break;

            const copiedItem: any = {
              ...original,
              id: copiedStackItemId || generateDeterministicId(ctx, 'copied_ability', triggeringStackItemId),
              controller: String((original as any).controller || controllerId),
              targets: Array.isArray((original as any).targets)
                ? (original as any).targets.map((target: any) => (
                    target && typeof target === 'object' && !Array.isArray(target)
                      ? { ...target }
                      : target
                  ))
                : (original as any).targets,
              card: (original as any).card ? { ...(original as any).card } : (original as any).card,
              ability: (original as any).ability ? { ...(original as any).ability } : (original as any).ability,
              searchParams: (original as any).searchParams ? { ...(original as any).searchParams } : (original as any).searchParams,
              upgradeData: (original as any).upgradeData ? { ...(original as any).upgradeData } : (original as any).upgradeData,
              equipParams: (original as any).equipParams ? { ...(original as any).equipParams } : (original as any).equipParams,
              fortifyParams: (original as any).fortifyParams ? { ...(original as any).fortifyParams } : (original as any).fortifyParams,
              reconfigureParams: (original as any).reconfigureParams ? { ...(original as any).reconfigureParams } : (original as any).reconfigureParams,
              copiedFromStackItemId: triggeringStackItemId,
              copiedBySourceName: sourceName,
              isCopy: true,
            };

            stack.push(copiedItem);
          }

          const stateAny = ctx.state as any;
          const manaPool = controllerId ? stateAny?.manaPool?.[controllerId] : null;
          if (manaPool && manaCost) {
            consumeRecordedManaCostFromPool(manaPool, manaCost);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(copyTriggeredAbilityResolve): failed', err);
        }
        break;
      }

      case "copyTriggeredSpellResolve": {
        try {
          const sourceName = String((e as any).sourceName || 'Spell copy').trim() || 'Spell copy';
          const controllerId = String((e as any).controllerId || '').trim();
          const triggeringStackItemId = String((e as any).triggeringStackItemId || '').trim();
          const copiedStackItemId = String((e as any).copiedStackItemId || '').trim();
          if (!triggeringStackItemId) break;

          const stack = ctx.state.stack as any[];
          const existingCopiedItem = copiedStackItemId
            ? stack.find((item: any) => item && String(item.id || '').trim() === copiedStackItemId)
            : null;
          if (!existingCopiedItem) {
            const original = stack.find((item: any) => item && String(item.id || '').trim() === triggeringStackItemId);
            if (!original) break;

            const copiedItem: any = {
              ...original,
              id: copiedStackItemId || generateDeterministicId(ctx, 'copied_spell', triggeringStackItemId),
              type: String((original as any).type || 'spell'),
              controller: String((original as any).controller || controllerId),
              targets: Array.isArray((original as any).targets)
                ? (original as any).targets.map((target: any) => (
                    target && typeof target === 'object' && !Array.isArray(target)
                      ? { ...target }
                      : target
                  ))
                : (original as any).targets,
              card: (original as any).card ? { ...(original as any).card } : (original as any).card,
              spell: (original as any).spell ? { ...(original as any).spell } : (original as any).spell,
              searchParams: (original as any).searchParams ? { ...(original as any).searchParams } : (original as any).searchParams,
              targetRequirements: (original as any).targetRequirements ? { ...(original as any).targetRequirements } : (original as any).targetRequirements,
              manaPayment: (original as any).manaPayment
                ? (Array.isArray((original as any).manaPayment) ? [...(original as any).manaPayment] : { ...(original as any).manaPayment })
                : (original as any).manaPayment,
              counterImmunity: (original as any).counterImmunity
                ? (Array.isArray((original as any).counterImmunity) ? [...(original as any).counterImmunity] : { ...(original as any).counterImmunity })
                : (original as any).counterImmunity,
              entersBattlefieldWithCounters: (original as any).entersBattlefieldWithCounters
                ? { ...(original as any).entersBattlefieldWithCounters }
                : (original as any).entersBattlefieldWithCounters,
              copyRetargetValidTargets: Array.isArray((original as any).copyRetargetValidTargets)
                ? (original as any).copyRetargetValidTargets.map((target: any) => (
                    target && typeof target === 'object' && !Array.isArray(target)
                      ? { ...target }
                      : target
                  ))
                : (original as any).copyRetargetValidTargets,
              copyRetargetTargetTypes: Array.isArray((original as any).copyRetargetTargetTypes)
                ? [...(original as any).copyRetargetTargetTypes]
                : (original as any).copyRetargetTargetTypes,
              copiedFromStackItemId: triggeringStackItemId,
              copiedBySourceName: sourceName,
              isCopy: true,
            };

            stack.push(copiedItem);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(copyTriggeredSpellResolve): failed', err);
        }
        break;
      }

      case "resolvedSpellCopyChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.resolvedSpellCopyChoice === true &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(resolvedSpellCopyChoiceResolve): failed', err);
        }
        break;
      }

      case "resolvedSpellCopyResolve": {
        try {
          const rawCopiedSpell = (e as any).copiedSpell;
          if (!rawCopiedSpell || typeof rawCopiedSpell !== 'object' || Array.isArray(rawCopiedSpell)) {
            break;
          }

          ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
          const stack = ctx.state.stack as any[];
          const copiedSpellId = String((rawCopiedSpell as any).id || '').trim();
          const existingCopiedItem = copiedSpellId
            ? stack.find((item: any) => item && String(item.id || '').trim() === copiedSpellId)
            : null;

          if (!existingCopiedItem) {
            stack.push({
              ...(rawCopiedSpell as any),
              ...(copiedSpellId ? { id: copiedSpellId } : {}),
              targets: Array.isArray((rawCopiedSpell as any).targets)
                ? ((rawCopiedSpell as any).targets as any[]).map((target: any) => (
                    target && typeof target === 'object' && !Array.isArray(target)
                      ? { ...target }
                      : target
                  ))
                : (rawCopiedSpell as any).targets,
              card: (rawCopiedSpell as any).card && typeof (rawCopiedSpell as any).card === 'object' && !Array.isArray((rawCopiedSpell as any).card)
                ? { ...((rawCopiedSpell as any).card as Record<string, any>) }
                : (rawCopiedSpell as any).card,
              spell: (rawCopiedSpell as any).spell && typeof (rawCopiedSpell as any).spell === 'object' && !Array.isArray((rawCopiedSpell as any).spell)
                ? { ...((rawCopiedSpell as any).spell as Record<string, any>) }
                : (rawCopiedSpell as any).spell,
              searchParams: (rawCopiedSpell as any).searchParams && typeof (rawCopiedSpell as any).searchParams === 'object' && !Array.isArray((rawCopiedSpell as any).searchParams)
                ? { ...((rawCopiedSpell as any).searchParams as Record<string, any>) }
                : (rawCopiedSpell as any).searchParams,
              targetRequirements: (rawCopiedSpell as any).targetRequirements && typeof (rawCopiedSpell as any).targetRequirements === 'object' && !Array.isArray((rawCopiedSpell as any).targetRequirements)
                ? { ...((rawCopiedSpell as any).targetRequirements as Record<string, any>) }
                : (rawCopiedSpell as any).targetRequirements,
              manaPayment: (rawCopiedSpell as any).manaPayment
                ? (Array.isArray((rawCopiedSpell as any).manaPayment)
                    ? [...((rawCopiedSpell as any).manaPayment as any[])]
                    : { ...((rawCopiedSpell as any).manaPayment as Record<string, any>) })
                : (rawCopiedSpell as any).manaPayment,
              counterImmunity: (rawCopiedSpell as any).counterImmunity
                ? (Array.isArray((rawCopiedSpell as any).counterImmunity)
                    ? [...((rawCopiedSpell as any).counterImmunity as any[])]
                    : { ...((rawCopiedSpell as any).counterImmunity as Record<string, any>) })
                : (rawCopiedSpell as any).counterImmunity,
              entersBattlefieldWithCounters: (rawCopiedSpell as any).entersBattlefieldWithCounters && typeof (rawCopiedSpell as any).entersBattlefieldWithCounters === 'object' && !Array.isArray((rawCopiedSpell as any).entersBattlefieldWithCounters)
                ? { ...((rawCopiedSpell as any).entersBattlefieldWithCounters as Record<string, any>) }
                : (rawCopiedSpell as any).entersBattlefieldWithCounters,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(resolvedSpellCopyResolve): failed', err);
        }
        break;
      }

      case "copyRetargetChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const copyKind = String((e as any).copyKind || '').trim().toLowerCase();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                ((copyKind === 'spell' && (step as any)?.retargetSpellCopy === true) ||
                  (copyKind !== 'spell' && (step as any)?.retargetAbilityCopy === true)) &&
                sourceId.length > 0 &&
                String((step as any)?.sourceId || '').trim() === sourceId
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(copyRetargetChoiceResolve): failed', err);
        }
        break;
      }

      case "assignTriggeredAbilityTargets": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const triggerStackItemId = String((e as any).triggerStackItemId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const targets = Array.isArray((e as any).targets) ? (e as any).targets.map((t: any) => String(t)) : [];
          if (!triggerStackItemId) break;
          const stack: any[] = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
          const stackItem = stack.find((item: any) => item && String(item?.id || '') === triggerStackItemId);
          if (stackItem) {
            stackItem.targets = targets.slice();
          }
          if (replayGameId && resolvedStepId) {
            clearReplayQueuedStepById(replayGameId, resolvedStepId);
          }
          ctx.bumpSeq();
        } catch {
          // best-effort replay
        }
        break;
      }

      case "goadPermanent": {
        try {
          if (
            (ctx as any).isReplaying
            && ((e as any).oracleIrReplayMutation === true || (e as any).effectProgramMutation === true)
          ) {
            consumeReplayedTriggeredAbilityStackItems(ctx, e as Record<string, unknown>);
          }

          const permanentId = String((e as any).permanentId || '').trim();
          const goaderId = String((e as any).goaderId || '').trim() as PlayerID;
          if (!permanentId || !goaderId) break;

          const idx = ctx.state.battlefield.findIndex((p: any) => String(p?.id || '') === permanentId);
          if (idx < 0) break;

          const perm = ctx.state.battlefield[idx] as any;
          const existing = Array.isArray(perm.goadedBy) ? perm.goadedBy : [];
          if (!existing.includes(goaderId)) {
            perm.goadedBy = [...existing, goaderId];
          }

          const persistedExpiryTurn = Number((e as any).expiryTurn ?? 0);
          const currentTurn = Number((ctx.state as any).turnNumber ?? 0) || 0;
          const expiryTurn = persistedExpiryTurn > 0 ? persistedExpiryTurn : currentTurn + 1;
          perm.goadedUntil = { ...(perm.goadedUntil || {}), [goaderId]: expiryTurn };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(goadPermanent): failed', err);
        }
        break;
      }

      case "battlefieldPermanentPatch": {
        try {
          const permanentId = String((e as any).permanentId || '').trim();
          const patch = (e as any).patch;
          if (!permanentId || !patch || typeof patch !== 'object' || Array.isArray(patch)) break;

          const idx = ctx.state.battlefield.findIndex((p: any) => String(p?.id || '') === permanentId);
          if (idx < 0) break;

          applyBattlefieldPermanentReplayPatch(ctx.state.battlefield[idx] as any, patch as any);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(battlefieldPermanentPatch): failed', err);
        }
        break;
      }

      case "targetSelectionWardPrompt": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const rawQueuedSteps = Array.isArray((e as any).queuedResolutionSteps)
            ? ((e as any).queuedResolutionSteps as any[]).filter((step) => step && typeof step === 'object' && !Array.isArray(step))
            : [];
          const queuedStepsToReplay = rawQueuedSteps.length > 0
            ? rawQueuedSteps
            : (rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) ? [rawQueuedStep] : []);

          const targets = Array.isArray((e as any).targets)
            ? ((e as any).targets as any[]).map((targetId: any) => String(targetId || '').trim()).filter(Boolean)
            : [];

          if (sourceId && Array.isArray((ctx.state as any).stack)) {
            const stackItem = ((ctx.state as any).stack as any[]).find((item: any) => item && String(item.id || '') === sourceId);
            if (stackItem && targets.length > 0) {
              stackItem.targets = [...targets];
            }
          }

          if (replayGameId && queuedStepsToReplay.length > 0) {
            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            for (const queuedStep of queuedStepsToReplay) {
              const queuedStepId = String((queuedStep as any)?.id || '').trim();
              const queuedStepType = String((queuedStep as any)?.type || '').trim();
              if (!queuedStepType) continue;

              const alreadyPresent = Boolean(
                (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
                (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
              );

              if (!alreadyPresent) {
                ResolutionQueueManager.addStep(replayGameId, {
                  ...(queuedStep as any),
                  ...(queuedStepId ? { id: queuedStepId } : {}),
                  type: queuedStepType as any,
                  playerId: String((queuedStep as any).playerId || playerId || '') as any,
                  description: String((queuedStep as any).description || ''),
                  mandatory: (queuedStep as any).mandatory !== false,
                } as any);
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(targetSelectionWardPrompt): failed', err);
        }
        break;
      }

      case "wardPaymentResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const stepId = String((e as any).stepId || '').trim();

          if (replayGameId && stepId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => String((step as any)?.id || '').trim() === stepId);
          }

          try {
            const tapped = Array.isArray((e as any).tappedPermanents)
              ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (tapped.length > 0) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const tappedSet = new Set(tapped);
              for (const permanent of battlefield as any[]) {
                if (permanent && tappedSet.has(String((permanent as any).id || ''))) {
                  (permanent as any).tapped = true;
                }
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const manaDelta = (e as any).paymentManaDelta;
            if (playerId && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
              const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
              for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
                const amount = Number(rawAmount || 0);
                if (!Number.isFinite(amount) || amount === 0) continue;
                pool[poolKey] = Number(pool[poolKey] || 0) + amount;
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const sacrificed = Array.isArray((e as any).sacrificedPermanents)
              ? ((e as any).sacrificedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (sacrificed.length > 0) {
              for (const permanentId of sacrificed) {
                const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                const permanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === permanentId) as any;
                if (!permanent) continue;

                const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
                  ? { ...(permanent.card || {}), zone: 'graveyard' }
                  : null;
                const graveyardOwnerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
                movePermanentToGraveyard(ctx as any, permanentId, true);

                if (tokenGraveyardSnapshot && graveyardOwnerId) {
                  const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
                  const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                    hand: [],
                    handCount: 0,
                    libraryCount: 0,
                    graveyard: [],
                    graveyardCount: 0,
                    exile: [],
                    exileCount: 0,
                  });
                  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

                  const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                    if (!card) return false;
                    const cardId = String((card as any).id || '').trim();
                    const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                    if (cardId && snapshotId) return cardId === snapshotId;
                    return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
                  });

                  if (!alreadyPresent) {
                    (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
                  }
                }
              }
            }
          } catch {
            // best-effort only
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(wardPaymentResolve): failed', err);
        }
        break;
      }

      case "targetSelectionTapUntapPrompt": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const rawQueuedStep = (e as any).queuedResolutionStep;
          if (!replayGameId || !rawQueuedStep || typeof rawQueuedStep !== 'object' || Array.isArray(rawQueuedStep)) {
            ctx.bumpSeq();
            break;
          }

          const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
          const queuedStepId = String((rawQueuedStep as any)?.id || '').trim();
          const queuedStepType = String((rawQueuedStep as any)?.type || '').trim();
          const alreadyPresent = Boolean(
            (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
            (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
          );

          if (!alreadyPresent && queuedStepType) {
            ResolutionQueueManager.addStep(replayGameId, {
              ...(rawQueuedStep as any),
              ...(queuedStepId ? { id: queuedStepId } : {}),
              type: queuedStepType as any,
              playerId: String((rawQueuedStep as any).playerId || playerId || '') as any,
              description: String((rawQueuedStep as any).description || ''),
              mandatory: (rawQueuedStep as any).mandatory !== false,
            } as any);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(targetSelectionTapUntapPrompt): failed', err);
        }
        break;
      }

      case "crewVehicle": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const vehicleId = String((e as any).vehicleId || (e as any).sourceId || '').trim();
          const crewerIdsRaw = (e as any).crewerIds;
          const crewerIds = Array.isArray(crewerIdsRaw)
            ? crewerIdsRaw.map((id: any) => String(id ?? '')).filter((x: string) => x.length > 0)
            : [];

          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.TARGET_SELECTION) &&
                (step as any)?.crewAbility === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!vehicleId || String((step as any)?.vehicleId || (step as any)?.sourceId || '').trim() === vehicleId)
              );
            });
          }

          const battlefield = (ctx.state.battlefield || []) as any[];
          const vehicle = battlefield.find((p: any) => p && String(p.id) === vehicleId);
          if (!vehicle) break;

          // Mark vehicle as crewed until end of turn.
          (vehicle as any).crewed = true;
          (vehicle as any).grantedTypes = Array.isArray((vehicle as any).grantedTypes) ? (vehicle as any).grantedTypes : [];
          if (!(vehicle as any).grantedTypes.includes('Creature')) {
            (vehicle as any).grantedTypes.push('Creature');
          }

          // Tap the chosen crewers and record which creature subtypes crewed it.
          const crewedTypesLower: string[] = [];
          for (const crewerId of crewerIds) {
            const crewer = battlefield.find((p: any) => p && String(p.id) === String(crewerId));
            if (!crewer) continue;
            (crewer as any).tapped = true;

            const typeLine = String((crewer as any)?.card?.type_line || '');
            const dashIndex = typeLine.indexOf('—');
            if (dashIndex >= 0) {
              const subtypes = typeLine.substring(dashIndex + 1).trim();
              for (const t of subtypes.split(/\s+/)) {
                const lower = String(t || '').toLowerCase().trim();
                if (lower) crewedTypesLower.push(lower);
              }
            }
          }

          // Intervening-if support fields (best-effort today, but now deterministic when this event exists).
          (vehicle as any).crewedByCreatureCountThisTurn = crewerIds.length;
          if (crewedTypesLower.length > 0) {
            (vehicle as any).crewedByCreatureTypesThisTurn = Array.from(new Set(crewedTypesLower));
            (vehicle as any).crewedBySubtypesThisTurn = (vehicle as any).crewedByCreatureTypesThisTurn;
          }

          // Intervening-if support: track that this player tapped a nonland permanent this turn.
          if (pid) {
            const stateAny = ctx.state as any;
            stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
            stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
          }

          applyTemporaryGraveyardKeywordGrantFromText(
            ctx as any,
            pid as any,
            String(vehicle?.card?.name || 'Vehicle'),
            String(vehicle?.card?.oracle_text || vehicle?.card?.oracleText || ''),
            {
              id: vehicleId,
              sourceId: vehicleId,
              source: vehicleId,
              permanentId: vehicleId,
              card: vehicle?.card,
            },
          );

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(crewVehicle): failed', err);
        }
        break;
      }

      case "station_activated": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const stationId = String((e as any).stationId || '').trim();
          const creatureId = String((e as any).creatureId || '').trim();
          const counterType = String((e as any).counterType || 'charge').trim() || 'charge';
          const countersAdded = Math.max(0, Math.floor(Number((e as any).countersAdded || 0)));
          const totalCountersRaw = (e as any).totalCounters;
          const stationed = Boolean((e as any).stationed);
          const grantedTypesRaw = (e as any).grantedTypes;

          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              const stepStationId = String(
                (step as any)?.tapForCountersSource?.id
                  || (step as any)?.station?.id
                  || (step as any)?.sourceId
                  || '',
              ).trim();
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.STATION_CREATURE_SELECTION) &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!stationId || stepStationId === stationId)
              );
            });
          }

          const battlefield = (ctx.state.battlefield || []) as any[];
          const station = stationId
            ? battlefield.find((p: any) => p && String(p.id) === stationId)
            : null;

          if (station) {
            // Idempotent sync: IR may already have applied an updateCounters event earlier.
            const current = Number((station as any).counters?.[counterType] || 0);
            const desired = totalCountersRaw != null && totalCountersRaw !== ''
              ? Math.max(0, Math.floor(Number(totalCountersRaw)))
              : current + countersAdded;
            const delta = desired - current;
            if (delta !== 0) {
              updateCounters(ctx as any, stationId, { [counterType]: delta }, {
                skipEventPersistence: true,
                skipCounterModifications: true,
              });
            }

            if (stationed) {
              (station as any).stationed = true;
              (station as any).grantedTypes = Array.isArray((station as any).grantedTypes)
                ? (station as any).grantedTypes
                : [];
              const typesToGrant = Array.isArray(grantedTypesRaw) && grantedTypesRaw.length > 0
                ? grantedTypesRaw.map((t: any) => String(t || '').trim()).filter(Boolean)
                : ['Creature'];
              for (const typeName of typesToGrant) {
                if (!(station as any).grantedTypes.includes(typeName)) {
                  (station as any).grantedTypes.push(typeName);
                }
              }
            }
          }

          if (creatureId) {
            const creature = battlefield.find((p: any) => p && String(p.id) === creatureId);
            if (creature) {
              (creature as any).tapped = true;
              if (pid) {
                const stateAny = ctx.state as any;
                stateAny.tappedNonlandPermanentThisTurnByPlayer =
                  stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(station_activated): failed', err);
        }
        break;
      }

      case "enlist": {
        try {
          const pid = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const attackerId = String((e as any).attackerId || (e as any).sourceId || '').trim();
          const enlistedCreatureId = String((e as any).enlistedCreatureId || '').trim();

          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.TARGET_SELECTION) &&
                (step as any)?.enlistChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!attackerId || String((step as any)?.enlistAttackerId || (step as any)?.sourceId || '').trim() === attackerId)
              );
            });
          }

          if (!attackerId || !enlistedCreatureId) break;

          const battlefield = (ctx.state.battlefield || []) as any[];
          const attacker = battlefield.find((p: any) => p && String(p.id) === attackerId);
          const enlisted = battlefield.find((p: any) => p && String(p.id) === enlistedCreatureId);
          if (!attacker || !enlisted) break;

          const enlistedPower = getCurrentCombatPowerSnapshot(enlisted, ctx.state);

          // Tap the enlisted creature and record that enlist was used.
          (enlisted as any).tapped = true;
          (attacker as any).enlistedThisCombat = true;
          (attacker as any).enlistedCreatureThisCombat = true;
          (attacker as any).enlistedCreatureIdThisCombat = enlistedCreatureId;
          (attacker as any).temporaryPowerBoost = ((attacker as any).temporaryPowerBoost || 0) + enlistedPower;
          delete (attacker as any).effectivePower;
          delete (attacker as any).effectiveToughness;

          // Intervening-if support: track that this player tapped a nonland permanent this turn.
          if (pid) {
            const stateAny = ctx.state as any;
            stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
            stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(enlist): failed', err);
        }
        break;
      }

      case "exertChoice": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const attackerId = String((e as any).attackerId || (e as any).sourceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.OPTION_CHOICE)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                if ((step as any).exertChoice !== true) return false;
                const queuedAttackerId = String((step as any).exertAttackerId || (step as any).permanentId || (step as any).sourceId || '').trim();
                return !attackerId || queuedAttackerId === attackerId;
              });
            }
          }

          if ((e as any).cancelled === true || (e as any).exerted === false) break;
          if (!attackerId) break;

          const battlefield = (ctx.state.battlefield || []) as any[];
          const attacker = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === attackerId);
          if (!attacker) break;

          (attacker as any).doesntUntapNextTurn = true;
          (attacker as any).exertedThisTurn = true;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(exertChoice): failed', err);
        }
        break;
      }

      case "roomDoorChoice": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const roomPermanentId = String((e as any).roomPermanentId || '').trim();
          const choiceId = String((e as any).choiceId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.OPTION_CHOICE)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                if ((step as any).roomDoorLockOrUnlock !== true) return false;
                const queuedRoomId = String((step as any).roomPermanentId || (step as any).sourceId || '').trim();
                return !roomPermanentId || queuedRoomId === roomPermanentId;
              });
            }
          }

          if ((e as any).cancelled === true || !roomPermanentId || !choiceId) break;

          applyRoomDoorLockOrUnlockChoice(ctx as any, playerId as any, roomPermanentId, choiceId);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(roomDoorChoice): failed', err);
        }
        break;
      }

      case "nextTurn": {
        nextTurn(ctx as any);
        break;
      }

      case "nextStep": {
        nextStep(ctx as any);
        break;
      }

      case "skipToPhase": {
        // Skip to a specific phase/step - used when player clicks on phase buttons
        // Note: This is a simplified replay that just sets the phase/step directly
        // The full skipToPhase handler in socket/game-actions.ts handles triggers, draws, etc.
        // But those effects are persisted as separate events (drawCards, etc.)
        const targetStep = String((e as any).targetStep || (e as any).to || '').trim();
        const pendingPhaseSkip = ((e as any).pendingPhaseSkip && typeof (e as any).pendingPhaseSkip === 'object')
          ? { ...((e as any).pendingPhaseSkip as any) }
          : undefined;
        const triggerOrderRequests = Array.isArray((e as any).triggerOrderRequests)
          ? ((e as any).triggerOrderRequests as any[])
          : [];
        const untappedPermanentIds = Array.isArray((e as any).untappedPermanentIds)
          ? ((e as any).untappedPermanentIds as any[])
              .map((value: any) => String(value || '').trim())
              .filter((value: string) => value.length > 0)
          : [];
        const inferPhaseFromStep = (step: string): string | undefined => {
          switch (String(step || '').trim().toUpperCase()) {
            case 'UNTAP':
            case 'UPKEEP':
            case 'DRAW':
              return 'beginning';
            case 'MAIN1':
              return 'precombatMain';
            case 'BEGIN_COMBAT':
            case 'DECLARE_ATTACKERS':
            case 'DECLARE_BLOCKERS':
            case 'COMBAT_DAMAGE':
            case 'END_COMBAT':
              return 'combat';
            case 'MAIN2':
              return 'postcombatMain';
            case 'END_STEP':
            case 'CLEANUP':
              return 'ending';
            default:
              return undefined;
          }
        };
        const targetPhase = String(
          (e as any).targetPhase ||
          pendingPhaseSkip?.targetPhase ||
          inferPhaseFromStep(targetStep) ||
          ''
        ).trim();
        try {
          if (targetPhase) {
            (ctx.state as any).phase = targetPhase;
          }
          if (targetStep) {
            (ctx.state as any).step = targetStep;
          }
          if (pendingPhaseSkip) {
            (ctx.state as any).pendingPhaseSkip = pendingPhaseSkip;
          } else {
            delete (ctx.state as any).pendingPhaseSkip;
          }
          if ((e as any).priority) {
            (ctx.state as any).priority = (e as any).priority;
          }
          if (untappedPermanentIds.length > 0) {
            const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
            const untappedIdSet = new Set(untappedPermanentIds);
            for (const permanent of battlefield as any[]) {
              if (!permanent) continue;
              if (!untappedIdSet.has(String(permanent.id || ''))) continue;
              (permanent as any).tapped = false;
            }
          }
          if (!pendingPhaseSkip) {
            try {
              (ctx.state as any).combat = undefined;
              const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
              for (const permanent of battlefield as any[]) {
                if (!permanent) continue;
                if ((permanent as any).attacking !== undefined) (permanent as any).attacking = undefined;
                if ((permanent as any).blocking !== undefined) (permanent as any).blocking = undefined;
                if ((permanent as any).blockedBy !== undefined) (permanent as any).blockedBy = undefined;
              }
            } catch {
              // best-effort only
            }

            if (!(e as any).priority && (ctx.state as any).turnPlayer) {
              (ctx.state as any).priority = (ctx.state as any).turnPlayer;
            }
          }
          for (const request of triggerOrderRequests) {
            if (!request || typeof request !== 'object') continue;
            const requestPlayerId = String((request as any).playerId || '').trim();
            const requestTriggers = Array.isArray((request as any).triggers)
              ? ((request as any).triggers as any[]).filter((trigger: any) => trigger && String(trigger.id || '').trim())
              : [];
            if (!requestPlayerId || requestTriggers.length === 0) continue;

            const queue = ResolutionQueueManager.getQueue(ctx.gameId);
            const requestIds = requestTriggers.map((trigger: any) => String(trigger.id || '')).filter(Boolean);
            const alreadyPresent = queue.steps.some((step: any) => {
              if (!step || String((step as any).type || '') !== String(ResolutionStepType.TRIGGER_ORDER)) {
                return false;
              }
              if (String((step as any).playerId || '') !== requestPlayerId) {
                return false;
              }
              const existingIds = Array.isArray((step as any).triggers)
                ? ((step as any).triggers as any[]).map((trigger: any) => String(trigger?.id || '')).filter(Boolean)
                : [];
              return existingIds.length === requestIds.length && existingIds.every((id: string, index: number) => id === requestIds[index]);
            });

            if (!alreadyPresent) {
              ResolutionQueueManager.addStep(ctx.gameId, {
                type: ResolutionStepType.TRIGGER_ORDER,
                playerId: requestPlayerId as any,
                description: String((request as any).description || `Choose the order to put ${requestTriggers.length} triggered abilities on the stack`),
                mandatory: true,
                triggers: requestTriggers.map((trigger: any) => ({
                  id: String(trigger.id),
                  sourceName: String(trigger.sourceName || ''),
                  effect: String(trigger.effect || ''),
                  imageUrl: trigger.imageUrl,
                })),
                requireAll: (request as any).requireAll !== false,
              } as any);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(skipToPhase): failed", err);
        }
        break;
      }

      case "reorderHand": {
        zonesReorderHand(
          ctx as any,
          (e as any).playerId,
          (e as any).order || []
        );
        break;
      }

      case "updatePermanentPos": {
        const permanentId = String((e as any).permanentId || '').trim();
        if (!permanentId) break;

        const battlefield = Array.isArray((ctx.state as any)?.battlefield)
          ? (ctx.state as any).battlefield
          : [];
        const permanent = battlefield.find(
          (entry: any) => String(entry?.id || '') === permanentId
        );
        if (!permanent) break;

        const pos = {
          x: Math.round(Number((e as any).x || 0)),
          y: Math.round(Number((e as any).y || 0)),
          ...(typeof (e as any).z === 'number' && Number.isFinite((e as any).z)
            ? { z: Math.round((e as any).z) }
            : {}),
        };

        (permanent as any).pos = pos;
        (permanent as any).posX = pos.x;
        (permanent as any).posY = pos.y;
        if (typeof pos.z === 'number') {
          (permanent as any).posZ = pos.z;
        } else {
          delete (permanent as any).posZ;
        }
        ctx.bumpSeq();
        break;
      }

      case "shuffleHand": {
        zonesShuffleHand(ctx as any, (e as any).playerId);
        break;
      }

      case "scryResolve": {
        const pid = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesScryStep = (step: any): boolean => {
                if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
                return Boolean(step)
                  && String(step?.type || '') === String(ResolutionStepType.SCRY)
                  && String(step?.playerId || '') === pid;
              };

              const activeStepMatched = matchesScryStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesScryStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          applyScry(
            ctx as any,
            pid,
            Array.isArray((e as any).keepTopOrder)
              ? ((e as any).keepTopOrder as any[]).map((card: any) => String(card?.id || card || '')).filter(Boolean)
              : [],
            Array.isArray((e as any).bottomOrder)
              ? ((e as any).bottomOrder as any[]).map((card: any) => String(card?.id || card || '')).filter(Boolean)
              : []
          );

          const pendingScry = (ctx.state as any).pendingScry;
          if (pendingScry && typeof pendingScry === 'object') {
            delete pendingScry[pid];
            if (Object.keys(pendingScry).length === 0) {
              delete (ctx.state as any).pendingScry;
            }
          }

          restoreOracleIrLedgerOnState(
            ctx.state,
            (e as any).oracleIrStepLedger,
            (e as any).oracleIrAppliedStepKinds,
          );
          restoreOracleIrPendingCompoundResumeOnState(ctx.state, e);
          ensureDeferredOracleIrStackItem(ctx, String((e as any).oracleIrSourceId || (e as any).sourceId || '').trim() || undefined);
        } catch (err) {
          debugWarn(1, 'applyEvent(scryResolve): failed', err);
        }
        break;
      }

      case "surveilResolve": {
        const pid = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesSurveilStep = (step: any): boolean => {
                if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
                return Boolean(step)
                  && String(step?.type || '') === String(ResolutionStepType.SURVEIL)
                  && String(step?.playerId || '') === pid;
              };

              const activeStepMatched = matchesSurveilStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesSurveilStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          applySurveil(
            ctx as any,
            pid,
            Array.isArray((e as any).toGraveyard)
              ? ((e as any).toGraveyard as any[]).map((card: any) => String(card?.id || card || '')).filter(Boolean)
              : [],
            Array.isArray((e as any).keepTopOrder)
              ? ((e as any).keepTopOrder as any[]).map((card: any) => String(card?.id || card || '')).filter(Boolean)
              : []
          );

          const pendingSurveil = (ctx.state as any).pendingSurveil;
          if (pendingSurveil && typeof pendingSurveil === 'object') {
            delete pendingSurveil[pid];
            if (Object.keys(pendingSurveil).length === 0) {
              delete (ctx.state as any).pendingSurveil;
            }
          }

          restoreOracleIrLedgerOnState(
            ctx.state,
            (e as any).oracleIrStepLedger,
            (e as any).oracleIrAppliedStepKinds,
          );
          restoreOracleIrPendingCompoundResumeOnState(ctx.state, e);
          ensureDeferredOracleIrStackItem(ctx, String((e as any).oracleIrSourceId || (e as any).sourceId || '').trim() || undefined);
        } catch (err) {
          debugWarn(1, 'applyEvent(surveilResolve): failed', err);
        }
        break;
      }

      case "ponderEffectResolve": {
        const pid = String((e as any).playerId || '').trim();
        const targetPid = String((e as any).targetPlayerId || pid).trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || '').trim();
        const variant = String((e as any).variant || '').trim();
        const cancelled = (e as any).cancelled === true;
        const shouldShuffle = (e as any).shouldShuffle === true;
        const lookedAtCardIds = Array.isArray((e as any).lookedAtCardIds)
          ? ((e as any).lookedAtCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const libraryTopOrder = Array.isArray((e as any).libraryTopOrder)
          ? ((e as any).libraryTopOrder as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const shuffledLibraryIds = Array.isArray((e as any).shuffledLibraryIds)
          ? ((e as any).shuffledLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const toHandCardIds = Array.isArray((e as any).toHandCardIds)
          ? ((e as any).toHandCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const lookedAtCards = Array.isArray((e as any).lookedAtCards) ? (e as any).lookedAtCards as any[] : [];
        const toHandCards = Array.isArray((e as any).toHandCards) ? (e as any).toHandCards as any[] : [];
        const drawnCard = (e as any).drawnCard && typeof (e as any).drawnCard === 'object'
          ? { ...(e as any).drawnCard, zone: 'hand' }
          : null;
        const drawnCardId = String((e as any).drawnCardId || drawnCard?.id || '').trim();
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : cancelled
            ? cloneLibraryCards(getPlayerLibraryFromContext(ctx, targetPid))
            : buildLibraryAfterPonderResolve(getPlayerLibraryFromContext(ctx, targetPid), {
                lookedAtCardIds,
                libraryTopOrder,
                shuffledLibraryIds,
                shouldShuffle,
                toHandCardIds: toHandCardIds.length > 0
                  ? toHandCardIds
                  : toHandCards.map((card: any) => String(card?.id || '')).filter(Boolean),
                drawnCardId,
                lookedAtCards,
              });

        try {
          if (!pid || !targetPid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesPonderStep = (step: any): boolean => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.PONDER_EFFECT)) {
                  return false;
                }
                if (String(step?.playerId || '') !== pid) {
                  return false;
                }
                if (effectId && String(step?.effectId || '') === effectId) {
                  return true;
                }
                if (targetPid && String(step?.targetPlayerId || pid) !== targetPid) {
                  return false;
                }
                if (sourceName && String(step?.sourceName || '') === sourceName) {
                  return true;
                }
                return Boolean(variant) && String(step?.variant || '') === variant;
              };

              const activeStepMatched = matchesPonderStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesPonderStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const stateAny = ctx.state as any;
          const zones = stateAny.zones = stateAny.zones || {};
          const targetZones = zones[targetPid] = zones[targetPid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          const playerZones = zones[pid] = zones[pid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };

          targetZones.library = libraryAfter;
          targetZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(targetPid, cloneLibraryCards(libraryAfter));
          }

          if (toHandCards.length > 0) {
            playerZones.hand = Array.isArray(playerZones.hand) ? playerZones.hand : [];
            for (const card of toHandCards) {
              (playerZones.hand as any[]).push({ ...card, zone: 'hand' });
            }
            playerZones.handCount = (playerZones.hand as any[]).length;
          }

          if (drawnCard) {
            playerZones.hand = Array.isArray(playerZones.hand) ? playerZones.hand : [];
            (playerZones.hand as any[]).push({ ...drawnCard, zone: 'hand' });
            playerZones.handCount = (playerZones.hand as any[]).length;
          }

          if (stateAny.pendingPonder && typeof stateAny.pendingPonder === 'object') {
            delete stateAny.pendingPonder[pid];
            if (Object.keys(stateAny.pendingPonder).length === 0) {
              delete stateAny.pendingPonder;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(ponderEffectResolve): failed', err);
        }
        break;
      }

      case "bottomOrderResolve": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceId = String((e as any).sourceId || '').trim();
        const sourceName = String((e as any).sourceName || '').trim();
        const orderedCardIds = Array.isArray((e as any).orderedCardIds)
          ? ((e as any).orderedCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const shuffleAfter = (e as any).shuffleAfter === true;
        const bottomCards = Array.isArray((e as any).bottomCards) ? (e as any).bottomCards as any[] : [];
        const shuffledLibraryIds = Array.isArray((e as any).shuffledLibraryIds)
          ? ((e as any).shuffledLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        let libraryAfter = libraryAfterSnapshot;
        if (!hasLibraryAfterField) {
          libraryAfter = buildLibraryAfterAppendOrderedBottom(
            getPlayerLibraryFromContext(ctx, pid),
            orderedCardIds,
            bottomCards,
          );
          if (shuffleAfter && shuffledLibraryIds.length > 0) {
            libraryAfter = reorderLibraryByIdList(libraryAfter, shuffledLibraryIds);
          }
        }
        const matchesCardSet = (cards: any): boolean => {
          const candidateIds = Array.isArray(cards)
            ? cards.map((card: any) => String(card?.id || '')).filter(Boolean)
            : [];
          return orderedCardIds.length > 0
            && candidateIds.length === orderedCardIds.length
            && candidateIds.every((id: string) => orderedCardIds.includes(id));
        };

        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesBottomOrderStep = (step: any): boolean => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.BOTTOM_ORDER)) {
                  return false;
                }
                if (String(step?.playerId || '') !== pid) {
                  return false;
                }
                if (effectId && String(step?.effectId || '') === effectId) {
                  return true;
                }
                if (sourceId && String(step?.sourceId || '') === sourceId && matchesCardSet(step?.cards)) {
                  return true;
                }
                if (sourceName && String(step?.sourceName || '') === sourceName && matchesCardSet(step?.cards)) {
                  return true;
                }
                return false;
              };

              const activeStepMatched = matchesBottomOrderStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesBottomOrderStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const stateAny = ctx.state as any;
          const zones = stateAny.zones = stateAny.zones || {};
          const playerZones = zones[pid] = zones[pid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };

          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }

          if (stateAny.pendingBottomOrder && typeof stateAny.pendingBottomOrder === 'object') {
            const existing = Array.isArray(stateAny.pendingBottomOrder[pid]) ? stateAny.pendingBottomOrder[pid] : [];
            stateAny.pendingBottomOrder[pid] = existing.filter((entry: any) => {
              if (!entry || typeof entry !== 'object') {
                return false;
              }
              if (effectId && String(entry.effectId || '') === effectId) {
                return false;
              }
              if (sourceId && String(entry.sourceId || '') === sourceId && matchesCardSet(entry.cards)) {
                return false;
              }
              if (sourceName && String(entry.sourceName || '') === sourceName && matchesCardSet(entry.cards)) {
                return false;
              }
              return true;
            });

            if (!Array.isArray(stateAny.pendingBottomOrder[pid]) || stateAny.pendingBottomOrder[pid].length === 0) {
              delete stateAny.pendingBottomOrder[pid];
            }
            if (Object.keys(stateAny.pendingBottomOrder).length === 0) {
              delete stateAny.pendingBottomOrder;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(bottomOrderResolve): failed', err);
        }
        break;
      }

      case "limDulsVaultContinue": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || "Lim-Dul's Vault").trim();
        const sourceImage = (e as any).sourceImage;
        const lifePaid = Number((e as any).lifePaid || 0);
        const totalLifePaid = Number((e as any).totalLifePaid || 0);
        const orderedBottomIds = Array.isArray((e as any).orderedBottomIds)
          ? ((e as any).orderedBottomIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : orderedBottomIds.length > 0
            ? buildLibraryAfterPutOnBottom(getPlayerLibraryFromContext(ctx, pid), orderedBottomIds)
            : [];

        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesVaultStep = (step: any): boolean => {
                return Boolean(step)
                  && String(step?.type || '') === String(ResolutionStepType.LIM_DULS_VAULT)
                  && String(step?.playerId || '') === pid
                  && (!effectId || String(step?.effectId || '') === effectId);
              };

              const activeStepMatched = matchesVaultStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesVaultStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const stateAny = ctx.state as any;
          stateAny.life = stateAny.life || {};
          if (Number.isFinite(lifePaid) && lifePaid > 0) {
            const currentLife = Number(stateAny.life?.[pid] ?? stateAny.startingLife ?? 40);
            stateAny.life[pid] = currentLife - lifePaid;
          }
          if (Number.isFinite(lifePaid) && lifePaid > 0) {
            stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
            stateAny.lifeLostThisTurn[pid] = Number(stateAny.lifeLostThisTurn[pid] || 0) + lifePaid;
          }

          const zones = stateAny.zones = stateAny.zones || {};
          const playerZones = zones[pid] = zones[pid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }

          stateAny.pendingLimDulsVault = stateAny.pendingLimDulsVault || {};
          stateAny.pendingLimDulsVault[pid] = {
            effectId,
            sourceName,
            sourceImage,
            totalLifePaid,
            currentLife: Number(stateAny.life?.[pid] ?? stateAny.startingLife ?? 40),
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(limDulsVaultContinue): failed', err);
        }
        break;
      }

      case "limDulsVaultResolve": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const orderedTopIds = Array.isArray((e as any).orderedTopIds)
          ? ((e as any).orderedTopIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const shuffledRemainderIds = Array.isArray((e as any).shuffledRemainderIds)
          ? ((e as any).shuffledRemainderIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : orderedTopIds.length > 0
            ? buildLibraryAfterPutOnTop(
                getPlayerLibraryFromContext(ctx, pid),
                orderedTopIds,
                shuffledRemainderIds.length > 0 ? shuffledRemainderIds : undefined,
              )
            : [];

        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();
          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesVaultStep = (step: any): boolean => {
                return Boolean(step)
                  && String(step?.type || '') === String(ResolutionStepType.LIM_DULS_VAULT)
                  && String(step?.playerId || '') === pid
                  && (!effectId || String(step?.effectId || '') === effectId);
              };

              const activeStepMatched = matchesVaultStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }
              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesVaultStep(step));
              }
              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const stateAny = ctx.state as any;
          const zones = stateAny.zones = stateAny.zones || {};
          const playerZones = zones[pid] = zones[pid] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }

          if (stateAny.pendingLimDulsVault && typeof stateAny.pendingLimDulsVault === 'object') {
            delete stateAny.pendingLimDulsVault[pid];
            if (Object.keys(stateAny.pendingLimDulsVault).length === 0) {
              delete stateAny.pendingLimDulsVault;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(limDulsVaultResolve): failed', err);
        }
        break;
      }

      case "danceWithCalamityContinue": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || 'Dance with Calamity').trim();
        const sourceImage = (e as any).sourceImage;
        const totalManaValue = Number((e as any).totalManaValue || 0);
        const exiledCards = Array.isArray((e as any).exiledCards)
          ? ((e as any).exiledCards as any[]).map((card: any) => ({ ...card, zone: 'exile' }))
          : [];
        const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
          ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : buildLibraryFromRemainingIds(
              getPlayerLibraryFromContext(ctx, pid),
              exiledCards,
              remainingLibraryIds,
            );

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          mergeCardsIntoReplayExile(playerZones, exiledCards);
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }

          stateAny.pendingDanceWithCalamity = stateAny.pendingDanceWithCalamity || {};
          stateAny.pendingDanceWithCalamity[pid] = {
            effectId,
            sourceName,
            sourceImage,
            exiledCards,
            totalManaValue,
            stage: 'exile',
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamityContinue): failed', err);
        }
        break;
      }

      case "danceWithCalamityBeginCasting": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || 'Dance with Calamity').trim();
        const sourceImage = (e as any).sourceImage;
        const totalManaValue = Number((e as any).totalManaValue || 0);
        const spellCardIds = Array.isArray((e as any).spellCardIds)
          ? (e as any).spellCardIds.map((value: any) => String(value || '')).filter(Boolean)
          : [];

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          const existing = (stateAny.pendingDanceWithCalamity || {})[pid] || {};
          const replayExiledCards = Array.isArray(existing.exiledCards) && existing.exiledCards.length > 0
            ? existing.exiledCards
            : (Array.isArray(playerZones.exile) ? playerZones.exile.map((card: any) => ({ ...card, zone: 'exile' })) : []);
          stateAny.pendingDanceWithCalamity = stateAny.pendingDanceWithCalamity || {};
          stateAny.pendingDanceWithCalamity[pid] = {
            effectId,
            sourceName,
            sourceImage,
            exiledCards: replayExiledCards,
            totalManaValue,
            stage: 'select_casts',
            spellCardIds,
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamityBeginCasting): failed', err);
        }
        break;
      }

      case "danceWithCalamitySetCastOrder": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || 'Dance with Calamity').trim();
        const sourceImage = (e as any).sourceImage;
        const totalManaValue = Number((e as any).totalManaValue || 0);
        const orderedSpellIds = Array.isArray((e as any).orderedSpellIds)
          ? (e as any).orderedSpellIds.map((value: any) => String(value || '')).filter(Boolean)
          : [];

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          const existing = (stateAny.pendingDanceWithCalamity || {})[pid] || {};
          const replayExiledCards = Array.isArray(existing.exiledCards) && existing.exiledCards.length > 0
            ? existing.exiledCards
            : (Array.isArray(playerZones.exile) ? playerZones.exile.map((card: any) => ({ ...card, zone: 'exile' })) : []);
          stateAny.pendingDanceWithCalamity = stateAny.pendingDanceWithCalamity || {};
          stateAny.pendingDanceWithCalamity[pid] = {
            effectId,
            sourceName,
            sourceImage,
            exiledCards: replayExiledCards,
            totalManaValue,
            stage: 'cast_sequence',
            orderedSpellIds,
            nextCastIndex: 0,
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamitySetCastOrder): failed', err);
        }
        break;
      }

      case "danceWithCalamityAdvanceCast": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const sourceName = String((e as any).sourceName || 'Dance with Calamity').trim();
        const sourceImage = (e as any).sourceImage;
        const totalManaValue = Number((e as any).totalManaValue || 0);
        const orderedSpellIds = Array.isArray((e as any).orderedSpellIds)
          ? (e as any).orderedSpellIds.map((value: any) => String(value || '')).filter(Boolean)
          : [];
        const nextCastIndex = Math.max(0, Number((e as any).nextCastIndex || 0));

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          const existing = (stateAny.pendingDanceWithCalamity || {})[pid] || {};
          const replayExiledCards = Array.isArray(existing.exiledCards) && existing.exiledCards.length > 0
            ? existing.exiledCards
            : (Array.isArray(playerZones.exile) ? playerZones.exile.map((card: any) => ({ ...card, zone: 'exile' })) : []);
          stateAny.pendingDanceWithCalamity = stateAny.pendingDanceWithCalamity || {};
          stateAny.pendingDanceWithCalamity[pid] = {
            effectId,
            sourceName,
            sourceImage,
            exiledCards: replayExiledCards,
            totalManaValue,
            stage: 'cast_sequence',
            orderedSpellIds,
            nextCastIndex,
            queued: false,
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamityAdvanceCast): failed', err);
        }
        break;
      }

      case "danceWithCalamityResolve": {
        const pid = String((e as any).playerId || '').trim();
        const effectId = String((e as any).effectId || '').trim();
        const exiledCards = Array.isArray((e as any).exiledCards)
          ? ((e as any).exiledCards as any[]).map((card: any) => ({ ...card, zone: 'exile' }))
          : [];
        const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
          ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : buildLibraryFromRemainingIds(
              getPlayerLibraryFromContext(ctx, pid),
              exiledCards,
              remainingLibraryIds,
            );

        try {
          if (!pid) break;

          clearReplayDanceWithCalamitySteps(String((ctx as any).gameId || '').trim(), pid, effectId);

          const stateAny = ctx.state as any;
          const playerZones = ensureReplayPlayerZones(stateAny, pid);
          playerZones.library = libraryAfter;
          playerZones.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(pid, cloneLibraryCards(libraryAfter));
          }
          if (exiledCards.length > 0) {
            mergeCardsIntoReplayExile(playerZones, exiledCards);
          }

          if (stateAny.pendingDanceWithCalamity && typeof stateAny.pendingDanceWithCalamity === 'object') {
            delete stateAny.pendingDanceWithCalamity[pid];
            if (Object.keys(stateAny.pendingDanceWithCalamity).length === 0) {
              delete stateAny.pendingDanceWithCalamity;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(danceWithCalamityResolve): failed', err);
        }
        break;
      }

      case "lifeRedistributionResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const redistributionId = String((e as any).redistributionId || '').trim();
          const lifeByPlayerId = (e as any).lifeByPlayerId;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.LIFE_REDISTRIBUTION) &&
                (!redistributionId || String((step as any)?.redistributionId || '').trim() === redistributionId)
              );
            });
          }

          if (!lifeByPlayerId || typeof lifeByPlayerId !== 'object' || Array.isArray(lifeByPlayerId)) break;

          const startingLife = Number((ctx.state as any)?.startingLife ?? 40);
          for (const [targetPlayerId, lifeRaw] of Object.entries(lifeByPlayerId as Record<string, unknown>)) {
            const pid = String(targetPlayerId || '').trim();
            if (!pid) continue;
            const nextLife = Math.max(0, Math.floor(Number(lifeRaw) || 0));
            const current = Number((ctx.state as any)?.life?.[pid] ?? ctx.life?.[pid as PlayerID] ?? startingLife);

            (ctx.state as any).life = (ctx.state as any).life || {};
            (ctx.state as any).life[pid] = nextLife;
            if (ctx.life) ctx.life[pid as PlayerID] = nextLife;

            const players = Array.isArray((ctx.state as any).players) ? (ctx.state as any).players : [];
            const player = players.find((entry: any) => String(entry?.id || '').trim() === pid);
            if (player) player.life = nextLife;

            const diff = nextLife - current;
            const stateAny = ctx.state as any;
            if (diff > 0) {
              stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
              stateAny.lifeGainedThisTurn[pid] = (stateAny.lifeGainedThisTurn[pid] || 0) + diff;
            } else if (diff < 0) {
              stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
              stateAny.lifeLostThisTurn[pid] = (stateAny.lifeLostThisTurn[pid] || 0) + Math.abs(diff);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(lifeRedistributionResolve): failed', err);
        }
        break;
      }

      case "proliferateResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const proliferateId = String((e as any).proliferateId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.PROLIFERATE) &&
                (!playerId || String(step?.playerId || '').trim() === playerId) &&
                (!proliferateId || String(step?.proliferateId || '').trim() === proliferateId)
              );
            });
          }

          const targetIds = Array.isArray((e as any).targetIds)
            ? ((e as any).targetIds as any[])
                .map((value: any) => String(value || '').trim())
                .filter((value: string) => value.length > 0)
            : [];

          if (targetIds.length === 0) break;

          const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
          const players = Array.isArray(ctx.state?.players) ? ctx.state.players : [];

          for (const targetId of targetIds) {
            const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === targetId);
            if (permanent && permanent.counters && typeof permanent.counters === 'object') {
              const deltas: Record<string, number> = {};
              for (const [counterType, count] of Object.entries(permanent.counters as Record<string, number>)) {
                if (Number(count || 0) > 0) {
                  deltas[counterType] = 1;
                }
              }
              if (Object.keys(deltas).length > 0) {
                updateCounters(ctx as any, String(targetId), deltas);
              }
              continue;
            }

            const player = players.find((entry: any) => entry && String(entry.id || '') === targetId);
            if (player && player.counters && typeof player.counters === 'object') {
              for (const [counterType, count] of Object.entries(player.counters as Record<string, number>)) {
                if (Number(count || 0) > 0) {
                  (player.counters as any)[counterType] = Number(count || 0) + 1;
                }
              }
              const poisonTotal = Number((player.counters as any).poison || 0);
              if (poisonTotal > 0) {
                (ctx as any).poison = (ctx as any).poison || {};
                (ctx.state as any).poisonCounters = (ctx.state as any).poisonCounters || {};
                (ctx as any).poison[targetId] = poisonTotal;
                (ctx.state as any).poisonCounters[targetId] = poisonTotal;
                (player as any).poisonCounters = poisonTotal;
              }
            }
          }

          ctx.bumpSeq();
          try {
            runSBA(ctx as any);
          } catch {}
        } catch (err) {
          debugWarn(1, 'applyEvent(proliferateResolve): failed', err);
        }
        break;
      }

      case "fatesealResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const opponentId = String((e as any).opponentId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.FATESEAL) &&
                (!playerId || String(step?.playerId || '').trim() === playerId) &&
                (!opponentId || String(step?.opponentId || '').trim() === opponentId)
              );
            });
          }

          if (!opponentId) break;

          const keepTopOrder = Array.isArray((e as any).keepTopOrder) ? (e as any).keepTopOrder : [];
          const bottomOrder = Array.isArray((e as any).bottomOrder) ? (e as any).bottomOrder : [];
          const totalCards = keepTopOrder.length + bottomOrder.length;
          if (totalCards <= 0) break;

          const lib = (ctx as any).libraries?.get?.(opponentId);
          if (!Array.isArray(lib)) break;

          lib.splice(0, totalCards);
          for (let index = keepTopOrder.length - 1; index >= 0; index--) {
            lib.unshift({ ...keepTopOrder[index], zone: 'library' });
          }
          for (const card of bottomOrder) {
            lib.push({ ...card, zone: 'library' });
          }

          (ctx as any).libraries?.set?.(opponentId, lib);
          const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
          const playerZones = (zones[opponentId] = zones[opponentId] || {});
          playerZones.libraryCount = lib.length;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(fatesealResolve): failed', err);
        }
        break;
      }

      case "clashResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const revealedCard = (e as any).revealedCard;
          const putOnBottom = Boolean((e as any).putOnBottom);
          const opponentId = String((e as any).opponentId || '').trim();
          const revealedCardId = String((revealedCard as any)?.id || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              const stepRevealedId = String(step?.revealedCard?.id || '').trim();
              return (
                String(step?.type || '') === String(ResolutionStepType.CLASH) &&
                (!playerId || String(step?.playerId || '').trim() === playerId) &&
                (!opponentId || String(step?.opponentId || '').trim() === opponentId) &&
                (!revealedCardId || !stepRevealedId || stepRevealedId === revealedCardId)
              );
            });
          }

          if (!playerId || !revealedCard) break;

          const lib = (ctx as any).libraries?.get?.(playerId);
          if (!Array.isArray(lib)) break;

          if (putOnBottom) {
            const revealedId = String((revealedCard as any).id || '').trim();
            const revealedIndex = lib.findIndex((card: any) => card && String(card.id || '') === revealedId);
            if (revealedIndex >= 0) {
              const [card] = lib.splice(revealedIndex, 1);
              if (card) {
                lib.push({ ...card, zone: 'library' });
              }
            }
          }

          (ctx as any).libraries?.set?.(playerId, lib);
          const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
          const playerZones = (zones[playerId] = zones[playerId] || {});
          playerZones.libraryCount = lib.length;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(clashResolve): failed', err);
        }
        break;
      }

      case "exploreResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.EXPLORE_DECISION).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!permanentId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permanentId)
              );
            });
          }
        } catch {
          // best-effort only
        }

        applyExplore(
          ctx as any,
          (e as any).playerId,
          (e as any).permanentId,
          (e as any).revealedCardId,
          (e as any).isLand || false,
          (e as any).toGraveyard || false
        );
        break;
      }

      case "passPriority": {
        const by = (e as any).by;
        try {
          if (typeof passPriority === "function")
            passPriority(ctx as any, by);
        } catch {}
        break;
      }

      case "mulligan": {
        // Mulligan: move hand to library, shuffle, draw 7
        const pid = (e as any).playerId;
        if (!pid) break;
        try {
          moveHandToLibrary(ctx as any, pid);
          shuffleLibrary(ctx as any, pid);
          drawCards(ctx as any, pid, 7);
        } catch (err) {
          debugWarn(1, "applyEvent(mulligan): failed", err);
        }
        break;
      }

      case "keepHand": {
        // Mark player as having kept their hand
        // This is important for tracking mulligan state during replay
        const pid = (e as any).playerId;
        const mulligansTaken = Math.max(0, Number((e as any).mulligansTaken ?? 0) || 0);
        if (!pid) break;
        try {
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = {
            ...(state.mulliganState[pid] || {}),
            hasKeptHand: true,
            mulligansTaken,
            pendingBottomCount: 0,
            pendingBottomStepId: null,
          };
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(keepHand): failed", err);
        }
        break;
      }

      case "unkeepHand": {
        const pid = (e as any).playerId;
        const mulligansTaken = Math.max(0, Number((e as any).mulligansTaken ?? 0) || 0);
        if (!pid) break;
        try {
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = {
            ...(state.mulliganState[pid] || {}),
            hasKeptHand: false,
            mulligansTaken,
            pendingBottomCount: 0,
            pendingBottomStepId: null,
          };
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(unkeepHand): failed", err);
        }
        break;
      }

      case "mulliganPutToBottom": {
        // London mulligan: move selected cards from hand to bottom of library
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        const mulligansTaken = Math.max(0, Number((e as any).mulligansTaken ?? 0) || 0);
        if (!pid || cardIds.length === 0) break;
        try {
          clearReplayQueuedStepById(
            String((ctx as any).gameId || '').trim(),
            String((e as any).resolvedStepId || '').trim(),
          );

          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;
          
          const hand = z.hand as any[];
          const lib = ctx.libraries.get(pid) || [];
          
          // Move each selected card from hand to bottom of library
          for (const cardId of cardIds) {
            const idx = hand.findIndex((c: any) => c.id === cardId);
            if (idx !== -1) {
              const [card] = hand.splice(idx, 1);
              lib.push({ ...card, zone: "library" });
            }
          }
          
          // Update counts
          z.handCount = hand.length;
          z.libraryCount = lib.length;
          ctx.libraries.set(pid, lib);
          
          // Mark hand as kept after putting cards on bottom
          const state = ctx.state as any;
          state.mulliganState = state.mulliganState || {};
          state.mulliganState[pid] = {
            ...(state.mulliganState[pid] || {}),
            hasKeptHand: true,
            mulligansTaken,
            pendingBottomCount: 0,
            pendingBottomStepId: null,
          };
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(mulliganPutToBottom): failed", err);
        }
        break;
      }

      case "setLife":
      case "adjustLife": {
        // Set or adjust a player's life total
        const pid = (e as any).playerId;
        const life = (e as any).life ?? (e as any).newLife;
        const delta = (e as any).delta;
        if (!pid) break;
        try {
          const startingLife = (ctx.state as any)?.startingLife ?? 40;
          const current = ctx.life ? (ctx.life[pid] ?? startingLife) : startingLife;

          let next: number | null = null;
          if (typeof life === 'number') {
            // Absolute set
            next = life;
          } else if (typeof delta === 'number') {
            // Relative adjustment
            next = current + delta;
          }

          if (next !== null) {
            // Apply
            (ctx.state as any).life = (ctx.state as any).life || {};
            (ctx.state as any).life[pid] = next;
            if (ctx.life) ctx.life[pid] = next;

            // Track gained/lost for this turn.
            const diff = next - current;
            const stateAny = ctx.state as any;
            if (diff > 0) {
              stateAny.lifeGainedThisTurn = stateAny.lifeGainedThisTurn || {};
              stateAny.lifeGainedThisTurn[pid] = (stateAny.lifeGainedThisTurn[pid] || 0) + diff;
            } else if (diff < 0) {
              stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
              stateAny.lifeLostThisTurn[pid] = (stateAny.lifeLostThisTurn[pid] || 0) + Math.abs(diff);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, `applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case "cleanupDiscard": {
        // Discard cards during cleanup step
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        const exiledCardIds = (e as any).exiledCardIds as string[] || [];
        if (!pid || (cardIds.length === 0 && exiledCardIds.length === 0)) break;
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;
          
          const hand = z.hand as any[];
          z.graveyard = z.graveyard || [];
          const graveyard = z.graveyard as any[];
          z.exile = Array.isArray(z.exile) ? z.exile : [];
          const exile = z.exile as any[];
          
          // Move each selected card from hand to graveyard
          let discardedCount = 0;
          for (const cardId of cardIds) {
            const idx = hand.findIndex((c: any) => c.id === cardId);
            if (idx !== -1) {
              const [card] = hand.splice(idx, 1);
              pushCardToPlayerGraveyardWithReplacements(ctx as any, String(pid), card, graveyard, {
                asDiscard: true,
              });
              discardedCount++;
            }
          }

          for (const cardId of exiledCardIds) {
            const idx = hand.findIndex((c: any) => c.id === cardId);
            if (idx !== -1) {
              const [card] = hand.splice(idx, 1);
              exile.push({ ...card, zone: 'exile' });
              discardedCount++;
            }
          }
          
          // Update counts
          z.handCount = hand.length;
          z.graveyardCount = graveyard.length;
          z.exileCount = exile.length;

          // Turn-tracking for intervening-if: "if a player discarded a card this turn" / "if an opponent discarded a card this turn".
          if (discardedCount > 0) {
            const stateAny = ctx.state as any;
            stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
            stateAny.discardedCardThisTurn[String(pid)] = true;
            stateAny.anyPlayerDiscardedCardThisTurn = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(cleanupDiscard): failed", err);
        }
        break;
      }

      case "increasePlayerSpeed": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const to = Number((e as any).to);
          if (!playerId || !Number.isFinite(to) || to < 1) break;
          const stateAny = ctx.state as any;
          stateAny.speed = { ...(stateAny.speed || {}), [playerId]: to };
          stateAny.speedIncreasedThisTurn = { ...(stateAny.speedIncreasedThisTurn || {}), [playerId]: true };
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(increasePlayerSpeed): failed', err);
        }
        break;
      }

      case "discardEffect": {
        const pid = String((e as any).playerId || '').trim();
        const cardIds = Array.isArray((e as any).cardIds)
          ? ((e as any).cardIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        const destination = String((e as any).destination || 'graveyard').toLowerCase() === 'exile' ? 'exile' : 'graveyard';
        const replayGameId = String((ctx as any).gameId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const exileTag = (e as any).exileTag as
          | {
              exiledWithSourceId?: string;
              exiledWithOracleId?: string;
              exiledWithSourceName?: string;
            }
          | undefined;
        if (!pid || cardIds.length === 0) break;

        try {
          if (replayGameId && (resolvedStepId || (e as any).dungeonRoomPayment)) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomPaymentStep(step, e as any);
            });
          }

          const zones = ctx.state.zones || {};
          const z = zones[pid];
          if (!z || !Array.isArray(z.hand)) break;

          const hand = z.hand as any[];
          z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
          z.exile = Array.isArray(z.exile) ? z.exile : [];
          const graveyard = z.graveyard as any[];
          const exile = z.exile as any[];
          const currentTurn = Number((ctx.state as any)?.turnNumber ?? (ctx.state as any)?.turn ?? 0) || 0;
          let movedCount = 0;

          for (const cardId of cardIds) {
            const idx = hand.findIndex((c: any) => c && String(c.id || '') === cardId);
            if (idx === -1) continue;

            const [card] = hand.splice(idx, 1);
            if (destination === 'exile') {
              exile.push({
                ...card,
                ...(exileTag ? { ...exileTag } : null),
                zone: 'exile',
                discardedByPlayerId: pid,
                discardedOnTurn: currentTurn,
              });
              movedCount++;
              continue;
            }

            pushCardToPlayerGraveyardWithReplacements(ctx as any, pid, card, graveyard, {
              extraFields: {
                discardedByPlayerId: pid,
                discardedOnTurn: currentTurn,
              },
            });
            movedCount++;
          }

          z.handCount = hand.length;
          z.graveyardCount = graveyard.length;
          z.exileCount = exile.length;

          if (movedCount > 0) {
            const stateAny = ctx.state as any;
            stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
            stateAny.discardedCardThisTurn[pid] = true;
            stateAny.anyPlayerDiscardedCardThisTurn = true;
          }

          ctx.bumpSeq();
          ensureDeferredOracleIrStackItem(ctx, String((e as any).sourceId || '').trim() || undefined);
        } catch (err) {
          debugWarn(1, 'applyEvent(discardEffect): failed', err);
        }
        break;
      }

      case "mill": {
        // Mill cards from library to graveyard
        const pid = (e as any).playerId;
        const count = (e as any).count || 1;
        if (!pid) break;
        if (
          (ctx as any).isReplaying
          && ((e as any).oracleIrReplayMutation === true || (e as any).effectProgramMutation === true)
        ) {
          consumeReplayedActivatedAbilityStackItems(ctx, e as Record<string, unknown>);
        }
        try {
          const lib = ctx.libraries.get(pid) || [];
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          zones[pid] = z;
          z.graveyard = z.graveyard || [];
          const graveyard = z.graveyard as any[];
          
          // Mill top N cards
          const milled = lib.splice(0, Math.min(count, lib.length));
          for (const card of milled) {
            pushCardToPlayerGraveyardWithReplacements(ctx as any, String(pid), card, graveyard);
          }
          
          // Update counts
          z.libraryCount = lib.length;
          z.graveyardCount = graveyard.length;
          ctx.libraries.set(pid, lib);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(mill): failed", err);
        }
        break;
      }

      case "zursWeirdingDrawReplacementResolve": {
        const decidingOpponentId = String((e as any).playerId || '').trim();
        const drawingPlayerId = String((e as any).drawingPlayerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return step?.zursWeirdingOpponentChoice === true && (!decidingOpponentId || String(step?.playerId || '').trim() === decidingOpponentId);
            });
          }

          (ctx as any)._replayNextEventType = 'zursWeirdingDrawReplacementResolve';
          applyZursWeirdingOpponentChoice(ctx as any, {
            drawingPlayerId,
            decidingOpponentId,
            opponentIndex: Number((e as any).opponentIndex || 0),
            choiceId: String((e as any).choiceId || '').trim() || 'decline',
            remainingDrawCountAfterChoice: Number((e as any).remainingDrawCountAfterChoice || 0),
          });
        } catch (err) {
          debugWarn(1, 'applyEvent(zursWeirdingDrawReplacementResolve): failed', err);
        }
        break;
      }

      case "dredgeDrawReplacementResolve": {
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return step?.dredgeDrawReplacementChoice === true && (!playerId || String(step?.playerId || '').trim() === playerId);
            });
          }

          applyDredgeDrawReplacementChoice(ctx as any, {
            playerId,
            choiceId: String((e as any).choiceId || '').trim() || ((e as any).dredgeCardId ? 'dredge' : 'draw'),
            dredgeCardId: String((e as any).dredgeCardId || '').trim(),
            dredgeAmount: Number((e as any).dredgeAmount || 0),
            remainingDrawCountAfterChoice: Number((e as any).remainingDrawCountAfterChoice || 0),
          });
        } catch (err) {
          debugWarn(1, 'applyEvent(dredgeDrawReplacementResolve): failed', err);
        }
        break;
      }

      case "tapPermanent":
      case "untapPermanent": {
        // Tap or untap a permanent
        const permId = (e as any).permanentId;
        const tapped = e.type === "tapPermanent";
        const playerId = String((e as any).playerId || '').trim();
        if (!permId) break;
        try {
          const battlefield = ctx.state.battlefield || [];
          const perm = battlefield.find((p: any) => p.id === permId);
          if (tapped && playerId) {
            const stateAny = ctx.state as any;
            stateAny.manaPool = stateAny.manaPool || {};
            stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
              white: 0,
              blue: 0,
              black: 0,
              red: 0,
              green: 0,
              colorless: 0,
            };

            const manaCost = String((e as any).manaCost || '').trim();
            if (manaCost) {
              consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);
            }

            const recordedMana = normalizeRecordedManaMap((e as any).addedMana);
            applyRecordedManaToPool(ctx, playerId, recordedMana);

            const explicitLifeLost = Number((e as any).lifeLost || 0);
            const inferredLifeEffect = perm ? inferLegacyManaLifeEffect(perm, (e as any).manaColor) : { amount: 0, isDamage: false };
            const explicitLifeLossIsDamage = typeof (e as any).lifeLossIsDamage === 'boolean'
              ? Boolean((e as any).lifeLossIsDamage)
              : undefined;
            if (Number.isFinite(explicitLifeLost) && explicitLifeLost > 0) {
              applyManaAbilityLifeLoss(
                ctx,
                playerId,
                explicitLifeLost,
                explicitLifeLossIsDamage ?? inferredLifeEffect.isDamage,
              );
            }
          }
          if (perm) {
            (perm as any).tapped = tapped;

            // Intervening-if support: record that a player tapped a nonland permanent this turn.
            // Conservative: only set true on positive evidence when the event includes playerId.
            if (tapped) {
              try {
                const pid = playerId;
                const tl = String((perm as any)?.card?.type_line || '').toLowerCase();
                const isLand = tl.includes('land');
                if (pid && !isLand) {
                  const stateAny = ctx.state as any;
                  stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                  stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
                }
              } catch {
                /* ignore */
              }
            }
            ctx.bumpSeq();
          }
        } catch (err) {
          debugWarn(1, `applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case "permanent_tapped":
      case "permanent_untapped": {
        // Legacy/compat: bulk tap/untap emitted by some Resolution Queue steps.
        const tapped = e.type === 'permanent_tapped';
        const idsRaw = (e as any).permanentIds;
        const ids = Array.isArray(idsRaw) ? idsRaw.map((x: any) => String(x)) : [];
        if (ids.length === 0) break;
        try {
          clearReplayQueuedStepById(
            String((ctx as any).gameId || '').trim(),
            String((e as any).resolvedStepId || '').trim(),
          );

          const battlefield = ctx.state.battlefield || [];
          for (const permId of ids) {
            const perm = battlefield.find((p: any) => p && String(p.id) === String(permId));
            if (perm) {
              (perm as any).tapped = tapped;
            }
          }

          // Intervening-if support: record that a player tapped a nonland permanent this turn.
          if (tapped) {
            try {
              const pid = String((e as any).playerId || '').trim();
              if (pid) {
                const stateAny = ctx.state as any;
                stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                stateAny.tappedNonlandPermanentThisTurnByPlayer[pid] = true;
              }
            } catch {
              /* ignore */
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, `applyEvent(${e.type}): failed`, err);
        }
        break;
      }

      case 'exilePermanent': {
        const permanentId = String((e as any).permanentId || '').trim();
        if (!permanentId) break;
        try {
          const sourcePermanentId = (e as any).sourcePermanentId != null ? String((e as any).sourcePermanentId) : undefined;
          const sourceName = (e as any).sourceName != null ? String((e as any).sourceName) : undefined;
          movePermanentToExile(ctx as any, permanentId, {
            exiledWithSourceId: sourcePermanentId,
            exiledWithSourceName: sourceName,
          });
        } catch (err) {
          debugWarn(1, 'applyEvent(exilePermanent): failed', err);
        }
        break;
      }

      case "sacrificePermanent": {
        // Sacrifice a permanent (move to graveyard)
        const permId = (e as any).permanentId;
        if (!permId) break;
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId && (resolvedStepId || (e as any).dungeonRoomPayment)) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomPaymentStep(step, e as any);
            });
          }

          try {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p?.id === permId);
            if (perm) {
              // Tracking happens inside applyReplaySacrificedPermanent; only call here
              // when the permanent will be missing from the battlefield by the time
              // applyReplaySacrificedPermanent looks it up (e.g., already removed).
              const stillThere = battlefield.includes(perm);
              if (!stillThere) trackPermanentSacrificedThisTurn(ctx.state, perm);
            }
          } catch {
            // best-effort only
          }

          applyReplaySacrificedPermanent(ctx, String(permId || ''));
        } catch (err) {
          debugWarn(1, "applyEvent(sacrificePermanent): failed", err);
        }
        break;
      }

      case "sacrificeSelected": {
        // DEPRECATED legacy event name for multiple sacrifices.
        // Kept for event replay/backward compatibility.
        const permanentIds = ((e as any).permanentIds as string[]) || ((e as any).permanentId ? [String((e as any).permanentId)] : []);
        if (!Array.isArray(permanentIds) || permanentIds.length === 0) break;
        try {
          for (const permId of permanentIds) {
            // Same Clue-sacrifice tracking as sacrificePermanent.
            try {
              const battlefield = ctx.state.battlefield || [];
              const perm = battlefield.find((p: any) => p?.id === permId);
              const controllerId = perm?.controller != null ? String(perm.controller) : null;
              const tl = String(perm?.card?.type_line || '').toLowerCase();
              const nm = String(perm?.card?.name || '').toLowerCase();
              const isClue = tl.includes('clue') && (tl.includes('artifact') || tl.includes('token'));
              if (controllerId && isClue && (nm === 'clue' || tl.includes('— clue') || tl.includes('- clue') || tl.includes('clue'))) {
                const stateAny = ctx.state as any;
                stateAny.sacrificedCluesThisTurn = stateAny.sacrificedCluesThisTurn || {};
                stateAny.sacrificedCluesThisTurn[controllerId] = (stateAny.sacrificedCluesThisTurn[controllerId] || 0) + 1;

                // Aliases consumed by intervening-if.
                stateAny.cluesSacrificedThisTurn = stateAny.cluesSacrificedThisTurn || {};
                stateAny.cluesSacrificedThisTurn[controllerId] = (stateAny.cluesSacrificedThisTurn[controllerId] || 0) + 1;
                stateAny.cluesSacrificedThisTurnCount = stateAny.cluesSacrificedThisTurnCount || {};
                stateAny.cluesSacrificedThisTurnCount[controllerId] = (stateAny.cluesSacrificedThisTurnCount[controllerId] || 0) + 1;
              }

              // Same generic/permanent-type sacrifice tracking as sacrificePermanent.
              if (controllerId) {
                const stateAny = ctx.state as any;
                stateAny.permanentsSacrificedThisTurn = stateAny.permanentsSacrificedThisTurn || {};
                stateAny.permanentsSacrificedThisTurn[controllerId] = (stateAny.permanentsSacrificedThisTurn[controllerId] || 0) + 1;

                const isFood = tl.includes('food') && (tl.includes('artifact') || tl.includes('token'));
                if (isFood && (nm === 'food' || tl.includes('— food') || tl.includes('- food') || tl.includes('food'))) {
                  stateAny.foodsSacrificedThisTurn = stateAny.foodsSacrificedThisTurn || {};
                  stateAny.foodsSacrificedThisTurn[controllerId] = (stateAny.foodsSacrificedThisTurn[controllerId] || 0) + 1;
                }
              }
            } catch {
              // best-effort only
            }

            applyReplaySacrificedPermanent(ctx, String(permId || ''));
          }
        } catch (err) {
          debugWarn(1, "applyEvent(sacrificeSelected): failed", err);
        }
        break;
      }

      case "randomPileSacrificeResolved": {
        // Marker for sequential N-pile random sacrifice. Individual permanents are
        // already applied via sacrificePermanent events; this only clears the
        // prompt and advances the RNG cursor so later random effects stay aligned.
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId && resolvedStepId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              return String(step?.id || '').trim() === resolvedStepId;
            });
          }

          const playerOrder = Array.isArray((e as any).playerOrder)
            ? ((e as any).playerOrder as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          const recorded = (e as any).randomPileByPlayer && typeof (e as any).randomPileByPlayer === 'object'
            ? (e as any).randomPileByPlayer as Record<string, unknown>
            : {};
          const draws = playerOrder.length > 0
            ? playerOrder.length
            : Object.keys(recorded).length;
          for (let i = 0; i < draws; i += 1) {
            if (typeof ctx.rng === 'function') ctx.rng();
          }
        } catch (err) {
          debugWarn(1, "applyEvent(randomPileSacrificeResolved): failed", err);
        }
        break;
      }

      case "libraryChaosExchangeResolved": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId && resolvedStepId) {
            clearReplayQueuedSteps(replayGameId, (step: any) =>
              String(step?.id || '').trim() === resolvedStepId);
          }

          const removedIds = new Set(
            (Array.isArray((e as any).removedPermanents) ? (e as any).removedPermanents : [])
              .map((entry: any) => String(entry?.id || '').trim())
              .filter(Boolean),
          );
          ctx.state.battlefield = (ctx.state.battlefield || [])
            .filter((permanent: any) => !removedIds.has(String(permanent?.id || '')));

          const librarySnapshots = (e as any).librarySnapshots && typeof (e as any).librarySnapshots === 'object'
            ? (e as any).librarySnapshots as Record<string, any[]>
            : {};
          const stateAny = ctx.state as any;
          stateAny.zones = stateAny.zones || {};
          for (const [playerId, snapshot] of Object.entries(librarySnapshots)) {
            const library = (Array.isArray(snapshot) ? snapshot : []).map((card: any) => ({
              ...card,
              zone: 'library',
            }));
            if ((ctx as any).libraries instanceof Map) {
              (ctx as any).libraries.set(playerId, library);
            }
            stateAny.zones[playerId] = stateAny.zones[playerId] || {};
            stateAny.zones[playerId].library = library;
            stateAny.zones[playerId].libraryCount = library.length;
            const player = (stateAny.players || []).find((entry: any) => String(entry?.id || '') === playerId);
            if (player) player.library = library;
          }

          const exileAdded = (e as any).exileAddedByPlayer && typeof (e as any).exileAddedByPlayer === 'object'
            ? (e as any).exileAddedByPlayer as Record<string, any[]>
            : {};
          for (const [playerId, cards] of Object.entries(exileAdded)) {
            stateAny.zones[playerId] = stateAny.zones[playerId] || {};
            const exile = Array.isArray(stateAny.zones[playerId].exile)
              ? stateAny.zones[playerId].exile
              : [];
            for (const card of Array.isArray(cards) ? cards : []) {
              if (!exile.some((entry: any) => String(entry?.id || '') === String(card?.id || ''))) {
                exile.push({ ...card, zone: 'exile' });
              }
            }
            stateAny.zones[playerId].exile = exile;
            stateAny.zones[playerId].exileCount = exile.length;
            const player = (stateAny.players || []).find((entry: any) => String(entry?.id || '') === playerId);
            if (player) player.exile = exile;
          }

          for (const permanent of Array.isArray((e as any).battlefieldAdded) ? (e as any).battlefieldAdded : []) {
            const permanentId = String(permanent?.id || '').trim();
            if (permanentId && !(ctx.state.battlefield || []).some((entry: any) => String(entry?.id || '') === permanentId)) {
              (ctx.state.battlefield || []).push({ ...permanent, card: { ...(permanent.card || {}) } });
            }
          }

          const rngDrawCount = Math.max(0, Math.floor(Number((e as any).rngDrawCount || 0)));
          for (let i = 0; i < rngDrawCount; i += 1) {
            if (typeof (ctx as any).rng === 'function') (ctx as any).rng();
          }
        } catch (err) {
          debugWarn(1, "applyEvent(libraryChaosExchangeResolved): failed", err);
        }
        break;
      }

      case "repeatedZoneDraftPick": {
        // Zone movement is applied by the paired effectProgramZoneMove event.
        // This marker clears the completed draft prompt; the next chooser prompt
        // is restored separately via resolveTopOfStackPrompt when present.
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId && resolvedStepId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              return String(step?.id || '').trim() === resolvedStepId;
            });
          }
        } catch (err) {
          debugWarn(1, "applyEvent(repeatedZoneDraftPick): failed", err);
        }
        break;
      }

      case "declareAttackers":
      case "declareControlledAttackers": {
        // Set attackers for combat
        const attackers = ((e as any).attackers as any[]) || [];
        try {
          const battlefield = ctx.state.battlefield || [];
          const playerId = String((e as any).playerId || "").trim();

          if ((e as any).attackCostPaid === true) {
            const replayGameId = String((ctx as any).gameId || '').trim();
            if (replayGameId) {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step) return false;
                return (
                  String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                  (step as any)?.attackCostPayment === true &&
                  (!playerId || String((step as any)?.playerId || '').trim() === playerId)
                );
              });
            }
          }

          try {
            const tapped = Array.isArray((e as any).tappedPermanents)
              ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (tapped.length > 0) {
              const tappedSet = new Set(tapped);
              for (const permanent of battlefield as any[]) {
                if (permanent && tappedSet.has(String(permanent.id || ''))) {
                  (permanent as any).tapped = true;
                }
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const manaDelta = (e as any).paymentManaDelta;
            if (playerId && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
              const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
              for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
                const amount = Number(rawAmount || 0);
                if (!Number.isFinite(amount) || amount === 0) continue;
                pool[poolKey] = Number(pool[poolKey] || 0) + amount;
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const sacrificed = Array.isArray((e as any).sacrificedPermanents)
              ? ((e as any).sacrificedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (sacrificed.length > 0) {
              for (const permanentId of sacrificed) {
                const permanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === permanentId) as any;
                if (!permanent) continue;

                const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
                  ? { ...(permanent.card || {}), zone: 'graveyard' }
                  : null;
                const graveyardOwnerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
                movePermanentToGraveyard(ctx as any, permanentId, true);

                if (tokenGraveyardSnapshot && graveyardOwnerId) {
                  const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
                  const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                    hand: [],
                    handCount: 0,
                    libraryCount: 0,
                    graveyard: [],
                    graveyardCount: 0,
                    exile: [],
                    exileCount: 0,
                  });
                  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

                  const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                    if (!card) return false;
                    const cardId = String((card as any).id || '').trim();
                    const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                    if (cardId && snapshotId) return cardId === snapshotId;
                    return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
                  });

                  if (!alreadyPresent) {
                    (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
                  }
                }
              }
            }
          } catch {
            // best-effort only
          }

          // Best-effort combat trackers consumed by intervening-if.
          try {
            const stateAny = ctx.state as any;
            if (playerId) {
              stateAny.attackedPlayersThisTurnByPlayer = stateAny.attackedPlayersThisTurnByPlayer || {};
              stateAny.attackedPlayersThisTurnByPlayer[playerId] = Array.isArray(stateAny.attackedPlayersThisTurnByPlayer[playerId])
                ? stateAny.attackedPlayersThisTurnByPlayer[playerId]
                : [];

              stateAny.attackedDefendingPlayersThisCombatByPlayer = stateAny.attackedDefendingPlayersThisCombatByPlayer || {};
              // Reset per-combat (not per-turn) so extra combats are evaluated correctly.
              stateAny.attackedDefendingPlayersThisCombatByPlayer[playerId] = [];
            }
            stateAny.mustAttackThisCombatByPermanentId = {};

            // Per-combat tracker used by intervening-if templates like
            // "if this creature attacked or blocked this combat".
            stateAny.attackedOrBlockedThisCombatByPermanentId = {};

            // Per-combat snapshot used by intervening-if templates like
            // "if a Pirate and a Vehicle attacked this combat".
            {
              const players = Array.isArray((ctx.state as any)?.players) ? ((ctx.state as any).players as any[]) : [];
              const ids = players
                .map((p: any) => String(p?.id ?? p?.playerId ?? '').trim())
                .filter((id: string) => Boolean(id));

              // Reset per-combat snapshots so extra combats are evaluated correctly.
              stateAny.attackersDeclaredThisCombatByPlayer = {};
              stateAny.blockersDeclaredThisCombatByPlayer = {};
              for (const pid of ids) {
                stateAny.attackersDeclaredThisCombatByPlayer[pid] = [];
                stateAny.blockersDeclaredThisCombatByPlayer[pid] = [];
              }
              if (playerId && !stateAny.attackersDeclaredThisCombatByPlayer[playerId]) stateAny.attackersDeclaredThisCombatByPlayer[playerId] = [];
              if (playerId && !stateAny.blockersDeclaredThisCombatByPlayer[playerId]) stateAny.blockersDeclaredThisCombatByPlayer[playerId] = [];
            }

            // Per-turn tracker used by intervening-if templates like
            // "if no creatures attacked this turn".
            stateAny.creaturesAttackedThisTurn = stateAny.creaturesAttackedThisTurn || {};

            for (const atk of attackers) {
              const attackerId = String(atk?.attackerId || atk?.creatureId || "").trim();
              if (!attackerId) continue;

              // Track who was attacked (player-only, not planeswalkers).
              const targetPlayerId = String(atk?.defendingPlayer || atk?.defendingPlayerId || atk?.targetPlayerId || "").trim();
              if (playerId && targetPlayerId) {
                const list: string[] = stateAny.attackedPlayersThisTurnByPlayer[playerId];
                if (Array.isArray(list) && !list.includes(targetPlayerId)) list.push(targetPlayerId);
              }

              // Track who is being attacked as the defending player for this combat.
              // Includes planeswalker/battle targets by resolving their controller.
              if (playerId) {
                const list: string[] = stateAny.attackedDefendingPlayersThisCombatByPlayer?.[playerId];
                if (Array.isArray(list)) {
                  let defendingPid = targetPlayerId;
                  if (!defendingPid) {
                    const targetPermId = String(atk?.targetPermanentId || "").trim();
                    if (targetPermId) {
                      const targetPerm = battlefield.find((p: any) => p?.id === targetPermId);
                      const targetController = String((targetPerm as any)?.controller || '').trim();
                      if (targetController) defendingPid = targetController;
                    }
                  }
                  if (defendingPid && !list.includes(defendingPid)) list.push(defendingPid);
                }
              }

              const perm = battlefield.find((p: any) => p?.id === attackerId);
              if (!perm) continue;

              // Per-combat marker for this attacker.
              stateAny.attackedOrBlockedThisCombatByPermanentId[attackerId] = true;

              // Per-combat snapshot entry for this attacker.
              if (playerId && Array.isArray(stateAny.attackersDeclaredThisCombatByPlayer?.[playerId])) {
                stateAny.attackersDeclaredThisCombatByPlayer[playerId].push({
                  id: attackerId,
                  name: String((perm as any)?.card?.name ?? (perm as any)?.name ?? ''),
                  type_line: String((perm as any)?.card?.type_line ?? ''),
                });
              }

              // Track "they were attacked this turn by an Assassin you controlled".
              // Conservative: only set true on positive evidence.
              try {
                const tl = String((perm as any)?.card?.type_line || '').toLowerCase();
                if (tl && /\bassassin\b/i.test(tl) && playerId) {
                  let defendingPid = targetPlayerId;
                  if (!defendingPid) {
                    const targetPermId = String(atk?.targetPermanentId || "").trim();
                    if (targetPermId) {
                      const targetPerm = battlefield.find((p: any) => p?.id === targetPermId);
                      const targetController = String((targetPerm as any)?.controller || '').trim();
                      if (targetController) defendingPid = targetController;
                    }
                  }
                  if (defendingPid) {
                    stateAny.attackedByAssassinThisTurnByPlayer = stateAny.attackedByAssassinThisTurnByPlayer || {};
                    stateAny.attackedByAssassinThisTurnByPlayer[playerId] = stateAny.attackedByAssassinThisTurnByPlayer[playerId] || {};
                    stateAny.attackedByAssassinThisTurnByPlayer[playerId][defendingPid] = true;
                  }
                }
              } catch {
                // best-effort only
              }

              // Track whether this attacker was under a must-attack requirement this combat.
              // Conservative: only mark `true` on positive evidence.
              const isForced =
                Boolean((perm as any).mustAttackEachCombat) ||
                Boolean((perm as any).mustAttack) ||
                (Array.isArray((perm as any).goadedBy) && (perm as any).goadedBy.length > 0) ||
                (typeof (perm as any).goaded === 'object' && (perm as any).goaded !== null && Object.keys((perm as any).goaded).length > 0);
              if (isForced) {
                stateAny.mustAttackThisCombatByPermanentId[attackerId] = true;
              }
            }
          } catch {
            // best-effort only
          }

          // Clear previous attackers
          for (const perm of battlefield) {
            if (perm) (perm as any).attacking = undefined;
          }
          // Set new attackers
          for (const atk of attackers) {
            const attackerId = String((atk as any)?.attackerId || (atk as any)?.creatureId || "").trim();
            if (!attackerId) continue;
            const perm = battlefield.find((p: any) => p.id === attackerId);
            if (perm) {
              const defendingPlayer = (atk as any)?.defendingPlayer || (atk as any)?.defendingPlayerId || (atk as any)?.targetPlayerId;
              const targetPermanentId = (atk as any)?.targetPermanentId;
              (perm as any).attacking = defendingPlayer || targetPermanentId || true;

              // Match live combat: mark that this permanent attacked this turn.
              (perm as any).attackedThisTurn = true;

              // Track total creatures attacked this turn for the attacking player.
              try {
                const stateAny = ctx.state as any;
                const attackerPid = String((e as any).playerId || '').trim();
                if (attackerPid) {
                  stateAny.creaturesAttackedThisTurn = stateAny.creaturesAttackedThisTurn || {};
                  stateAny.creaturesAttackedThisTurn[attackerPid] = (stateAny.creaturesAttackedThisTurn[attackerPid] || 0) + 1;
                }
              } catch {
                /* ignore */
              }

              // Attacking creatures tap unless they have vigilance.
              // Keep replay deterministic and aligned with live combat logic.
              const hasVigilance = permanentHasKeyword(perm, 'vigilance');
              if (!hasVigilance) {
                (perm as any).tapped = true;
                try {
                  const attackerPid = String((e as any).playerId || '').trim();
                  if (attackerPid) {
                    const stateAny = ctx.state as any;
                    stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                    stateAny.tappedNonlandPermanentThisTurnByPlayer[attackerPid] = true;
                  }
                } catch {
                  /* ignore */
                }
              }
            }
          }
          if (playerId) {
            const stateAny = ctx.state as any;
            stateAny.attackersDeclaredBy = Array.isArray(stateAny.attackersDeclaredBy) ? stateAny.attackersDeclaredBy : [];
            if (!stateAny.attackersDeclaredBy.includes(playerId)) {
              stateAny.attackersDeclaredBy.push(playerId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(declareAttackers): failed", err);
        }
        break;
      }

      case "declareBlockers":
      case "declareControlledBlockers": {
        // Set blockers for combat
        const blockers = (e as any).blockers as Array<{ blockerId: string; attackerId: string }> || [];
        try {
          const battlefield = ctx.state.battlefield || [];
          const stateAny = ctx.state as any;
          const playerId = String((e as any).playerId || '').trim();

          stateAny.attackedOrBlockedThisCombatByPermanentId = stateAny.attackedOrBlockedThisCombatByPermanentId || {};

          // Clear only THIS player's prior blocker assignments so multiplayer
          // declareBlockers / replay cannot wipe other defenders' blocks.
          if (playerId) {
            for (const perm of battlefield) {
              if (!perm) continue;
              if (String(perm.controller || '') === playerId) {
                (perm as any).blocking = undefined;
              }
            }
            for (const attacker of battlefield) {
              if (!attacker || !Array.isArray((attacker as any).blockedBy)) continue;
              const remaining = ((attacker as any).blockedBy as string[]).filter((blockerId) => {
                const blocker = battlefield.find((p: any) => p && String(p.id || '') === String(blockerId || ''));
                return blocker && String(blocker.controller || '') !== playerId;
              });
              (attacker as any).blockedBy = remaining.length > 0 ? remaining : undefined;
            }
          } else {
            for (const perm of battlefield) {
              if (perm) {
                (perm as any).blocking = undefined;
                (perm as any).blockedBy = undefined;
              }
            }
          }
          // Set new blockers
          for (const blk of blockers) {
            const blocker = battlefield.find((p: any) => p.id === blk.blockerId);
            const attacker = battlefield.find((p: any) => p.id === blk.attackerId);
            if (blocker) {
              (blocker as any).blocking = blk.attackerId;

              // Intervening-if support: blocker "blocked this turn" and "attacked or blocked this combat".
              (blocker as any).blockedThisTurn = true;
              stateAny.attackedOrBlockedThisCombatByPermanentId[String(blk.blockerId)] = true;

              // Per-combat snapshot entry for this blocker.
              if (playerId) {
                stateAny.blockersDeclaredThisCombatByPlayer = stateAny.blockersDeclaredThisCombatByPlayer || {};
                stateAny.blockersDeclaredThisCombatByPlayer[playerId] = Array.isArray(stateAny.blockersDeclaredThisCombatByPlayer[playerId])
                  ? stateAny.blockersDeclaredThisCombatByPlayer[playerId]
                  : [];
                const list = stateAny.blockersDeclaredThisCombatByPlayer[playerId];
                const bid = String(blk.blockerId || '').trim();
                if (bid && !list.some((e: any) => String(e?.id ?? e?.creatureId ?? e).trim() === bid)) {
                  list.push({
                    id: bid,
                    name: String((blocker as any)?.card?.name ?? (blocker as any)?.name ?? ''),
                    type_line: String((blocker as any)?.card?.type_line ?? ''),
                  });
                }
              }
            }
            if (attacker) {
              (attacker as any).blockedBy = (attacker as any).blockedBy || [];
              (attacker as any).blockedBy.push(blk.blockerId);

              // Intervening-if support: attacker "was blocked this turn".
              (attacker as any).wasBlockedThisTurn = true;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(declareBlockers): failed", err);
        }
        break;
      }

      case "fight": {
        // Two creatures fight - each deals damage to the other equal to their power
        const sourceId = (e as any).sourceId;
        const targetId = (e as any).targetId;
        const sourcePower = (e as any).sourcePower;
        const targetPower = (e as any).targetPower;
        
        try {
          const battlefield = ctx.state.battlefield || [];
          const source = battlefield.find((p: any) => p.id === sourceId);
          const target = battlefield.find((p: any) => p.id === targetId);
          
          if (source && target) {
            // Best-effort per-turn damage tracking for intervening-if clauses.
            try {
              const stateAny = ctx.state as any;
              const srcId = String(sourceId || '').trim();
              const tgtId = String(targetId || '').trim();
              if (srcId && tgtId) {
                stateAny.creaturesDamagedByThisCreatureThisTurn = stateAny.creaturesDamagedByThisCreatureThisTurn || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] = stateAny.creaturesDamagedByThisCreatureThisTurn[srcId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[srcId][tgtId] = true;
                stateAny.creaturesDamagedByThisCreatureThisTurn[tgtId] = stateAny.creaturesDamagedByThisCreatureThisTurn[tgtId] || {};
                stateAny.creaturesDamagedByThisCreatureThisTurn[tgtId][srcId] = true;
              }
            } catch {
              // best-effort only
            }

            applyFightDamageBetweenCreatures(
              ctx as any,
              source,
              Math.max(0, Number(sourcePower || 0)),
              target,
              Math.max(0, Number(targetPower || 0)),
              'damageMarked',
            );

            const queueDamageTrigger = (perm: any, damageAmount: number) => {
              processDamageReceivedTriggers(ctx as any, perm, damageAmount, (triggerInfo) => {
                if (dispatchDamageReceivedTrigger(ctx as any, triggerInfo)) {
                  return;
                }

                const stateAny = ctx.state as any;
                stateAny.pendingDamageTriggers = stateAny.pendingDamageTriggers || {};
                stateAny.pendingDamageTriggers[triggerInfo.triggerId] = {
                  sourceId: triggerInfo.sourceId,
                  sourceName: triggerInfo.sourceName,
                  controller: triggerInfo.controller,
                  damageAmount: triggerInfo.damageAmount,
                  triggerType: 'dealt_damage',
                  targetType: triggerInfo.targetType,
                  effect: triggerInfo.effect,
                  ...(triggerInfo.effectMode ? { effectMode: triggerInfo.effectMode } : {}),
                  ...(triggerInfo.attackingPlayerId ? { attackingPlayerId: triggerInfo.attackingPlayerId } : {}),
                  ...(triggerInfo.targetRestriction ? { targetRestriction: triggerInfo.targetRestriction } : {}),
                };
              });
            };

            queueDamageTrigger(source, targetPower);
            queueDamageTrigger(target, sourcePower);
            
            // Run SBA to check for lethal damage
            try {
              runSBA(ctx as any);
            } catch (sbaErr) {
              // SBA may not be available during replay - this is expected
              debug(1, "applyEvent(fight): SBA skipped during replay:", sbaErr);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(fight): failed", err);
        }
        break;
      }

      case "counter_moved": {
        const sourcePermanentId = String((e as any).sourcePermanentId || '').trim();
        const targetPermanentId = String((e as any).targetPermanentId || '').trim();
        const counterType = String((e as any).counterType || '').trim();

        try {
          clearReplayQueuedStepById(
            String((ctx as any).gameId || '').trim(),
            String((e as any).resolvedStepId || '').trim(),
          );

          if (!sourcePermanentId || !targetPermanentId || !counterType) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const sourcePermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === sourcePermanentId);
          const targetPermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === targetPermanentId);
          if (!sourcePermanent || !targetPermanent) break;

          const sourceCounters = ((sourcePermanent as any).counters || {}) as Record<string, number>;
          const currentSourceCount = Number(sourceCounters[counterType] || 0);
          if (currentSourceCount <= 0) break;
          sourceCounters[counterType] = currentSourceCount - 1;
          if (sourceCounters[counterType] <= 0) {
            delete sourceCounters[counterType];
          }
          (sourcePermanent as any).counters = sourceCounters;

          const targetCounters = ((targetPermanent as any).counters || {}) as Record<string, number>;
          targetCounters[counterType] = Number(targetCounters[counterType] || 0) + 1;
          (targetPermanent as any).counters = targetCounters;

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(counter_moved): failed', err);
        }
        break;
      }

      case "activateFetchland": {
        // Fetchland activation: sacrifice land, search for land, put on battlefield
        // The actual search/put is handled when the activated ability resolves.
        // Replay must restore both the paid activation costs and the unresolved stack item.
        const playerId = String((e as any).playerId || '').trim();
        const permId = String((e as any).permanentId || '').trim();
        const abilityId = String((e as any).abilityId || '').trim();
        const persistedStackId = String((e as any).stackId || '').trim();
        if (permId) {
          try {
            const stateAny = ctx.state as any;
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permId);
            const card = (permanent as any)?.card || {};
            const cardName = String((e as any).cardName || card.name || '').trim();
            const oracleText = String(card.oracle_text || '').trim();
            const persistedAbilityText = String((e as any).activatedAbilityText || '').trim();
            const scopedActivatedAbility = getActivatedAbilityScopeText(oracleText.toLowerCase(), abilityId);
            const scopedAbilityText = String(scopedActivatedAbility.abilityText || '').trim();
            const scopedAbilityFullText = String(scopedActivatedAbility.fullAbilityText || scopedAbilityText || oracleText).trim();
            const replayAbilityText = persistedAbilityText || scopedAbilityFullText || oracleText;

            if (playerId && replayAbilityText) {
              const persistedManaCost = String((e as any).manaCost || '').trim();
              const { manaCost: derivedManaCost } = extractReplayActivationCost(replayAbilityText);
              const manaCost = persistedManaCost || derivedManaCost;
              stateAny.manaPool = stateAny.manaPool || {};
              stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
                white: 0,
                blue: 0,
                black: 0,
                red: 0,
                green: 0,
                colorless: 0,
              };
              consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);

              const persistedLifeCost = Number((e as any).lifePaidForCost || 0);
              const lifeCostMatch = replayAbilityText.match(/pay\s+(\d+)\s+life/i);
              const derivedLifeCost = lifeCostMatch ? Math.max(0, Number(lifeCostMatch[1] || 0)) : 0;
              const lifeCost = persistedLifeCost > 0 ? persistedLifeCost : derivedLifeCost;
              if (lifeCost > 0) {
                stateAny.life = stateAny.life || {};
                (ctx as any).life = (ctx as any).life || {};
                const startingLife = Number(stateAny.startingLife || (ctx as any).startingLife || 40);
                const currentLife = Number(stateAny.life?.[playerId] ?? (ctx as any).life?.[playerId] ?? startingLife);
                const nextLife = Math.max(0, currentLife - lifeCost);
                stateAny.life[playerId] = nextLife;
                (ctx as any).life[playerId] = nextLife;
                stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
                stateAny.lifeLostThisTurn[String(playerId)] = ((stateAny.lifeLostThisTurn[String(playerId)] || 0) + lifeCost);

                const player = Array.isArray(stateAny.players)
                  ? stateAny.players.find((entry: any) => entry && String(entry.id || '') === playerId)
                  : null;
                if (player) {
                  player.life = nextLife;
                }
              }
            }

            applyReplaySacrificedPermanent(ctx, permId);

            if (playerId && replayAbilityText) {
              const persistedSearchParams = ((e as any).searchParams || {}) as any;
              const filter = persistedSearchParams.filter || parseSearchCriteria(replayAbilityText);
              let maxSelections = Number(persistedSearchParams.maxSelections || 0);
              if (!Number.isFinite(maxSelections) || maxSelections <= 0) {
                maxSelections = 1;
                const upToMatch = replayAbilityText.match(/search your library for up to (\w+)/i);
                if (upToMatch) {
                  const num = String(upToMatch[1] || '').toLowerCase();
                  if (num === 'two') maxSelections = 2;
                  else if (num === 'three') maxSelections = 3;
                  else if (num === 'four') maxSelections = 4;
                  else {
                    const parsed = parseInt(num, 10);
                    if (!isNaN(parsed)) maxSelections = parsed;
                  }
                }
              }

              const entersTapped = persistedSearchParams.entersTapped === true || /(?:put (?:it|them) onto|enters) the battlefield tapped/i.test(replayAbilityText);

              let searchDescription = String(persistedSearchParams.searchDescription || '').trim();
              if (!searchDescription) {
                searchDescription = 'Search your library for a land card';
                if (maxSelections > 1) {
                  searchDescription = `Search your library for up to ${maxSelections} land cards`;
                }
                if (filter.subtypes && filter.subtypes.length > 0) {
                  const landTypes = filter.subtypes
                    .filter((subtype: string) => !subtype.includes('basic'))
                    .map((subtype: string) => subtype.charAt(0).toUpperCase() + subtype.slice(1));
                  if (landTypes.length > 0) {
                    const prefix = maxSelections > 1 ? `Search for up to ${maxSelections}` : 'Search for a';
                    searchDescription = `${prefix} ${landTypes.join(' or ')} card${maxSelections > 1 ? 's' : ''}`;
                  }
                  if (filter.subtypes.includes('basic')) {
                    const prefix = maxSelections > 1 ? `Search for up to ${maxSelections} basic` : 'Search for a basic';
                    searchDescription = `${prefix} ${landTypes.join(' or ')} card${maxSelections > 1 ? 's' : ''}`;
                  }
                }
              }

              const stackId = persistedStackId || generateDeterministicId(ctx, 'ability_fetch', `${permId}:${abilityId || cardName || 'fetchland'}`);
              stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
              const alreadyPresent = stateAny.stack.some((item: any) => item && String(item.id || '') === stackId);
              if (!alreadyPresent) {
                stateAny.stack.push({
                  id: stackId,
                  type: 'ability',
                  controller: playerId,
                  source: permId,
                  abilityId,
                  sourceName: cardName,
                  description: `${searchDescription}, put ${maxSelections > 1 ? 'them' : 'it'} onto the battlefield${entersTapped ? ' tapped' : ''}, then shuffle`,
                  abilityType: 'fetch-land',
                  searchParams: {
                    filter,
                    searchDescription,
                    isTrueFetch: persistedSearchParams.isTrueFetch === true || /pay\s+1\s+life/i.test(replayAbilityText),
                    maxSelections,
                    entersTapped,
                    cardImageUrl: persistedSearchParams.cardImageUrl || card?.image_uris?.small || card?.image_uris?.normal,
                  },
                });
              }
            }
          } catch (err) {
            debugWarn(1, "applyEvent(activateFetchland): failed", err);
          }
        }
        break;
      }

      case "addManaToPool": {
        const playerId = String((e as any).playerId || '').trim();
        const color = String((e as any).color || '').trim();
        const amount = Number((e as any).amount || 0);
        if (!playerId || !color || !Number.isFinite(amount) || amount <= 0) break;

        try {
          const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
          const restriction = (e as any).restriction;

          if (restriction) {
            pool.restricted = Array.isArray(pool.restricted) ? pool.restricted : [];
            pool.restricted.push({
              type: color,
              amount,
              restriction,
              restrictedTo: (e as any).restrictedTo,
              sourceId: (e as any).sourceId,
              sourceName: (e as any).sourceName,
            });
          } else {
            pool[color] = Number(pool[color] || 0) + amount;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(addManaToPool): failed', err);
        }
        break;
      }

      case "removeManaFromPool": {
        const playerId = String((e as any).playerId || '').trim();
        const color = String((e as any).color || '').trim();
        const amount = Number((e as any).amount || 0);
        if (!playerId || !color || !Number.isFinite(amount) || amount <= 0) break;

        try {
          const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
          const removedRestrictedMana = (e as any).removedRestrictedMana;

          if (removedRestrictedMana && typeof removedRestrictedMana === 'object') {
            const restricted = Array.isArray(pool.restricted) ? pool.restricted : [];
            const matchIndex = restricted.findIndex((entry: any) =>
              entry &&
              String(entry.type || '') === String((removedRestrictedMana as any).type || color) &&
              String(entry.restriction || '') === String((removedRestrictedMana as any).restriction || '') &&
              String(entry.restrictedTo || '') === String((removedRestrictedMana as any).restrictedTo || '') &&
              String(entry.sourceId || '') === String((removedRestrictedMana as any).sourceId || '') &&
              String(entry.sourceName || '') === String((removedRestrictedMana as any).sourceName || '') &&
              Number(entry.amount || 0) >= amount
            );

            if (matchIndex !== -1) {
              const entry = restricted[matchIndex];
              entry.amount = Number(entry.amount || 0) - amount;
              if (entry.amount <= 0) {
                restricted.splice(matchIndex, 1);
              }
              if (restricted.length > 0) pool.restricted = restricted;
              else delete pool.restricted;
            }
          } else {
            pool[color] = Math.max(0, Number(pool[color] || 0) - amount);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(removeManaFromPool): failed', err);
        }
        break;
      }

      case "setManaPoolDoesNotEmpty": {
        const playerId = String((e as any).playerId || '').trim();
        const sourceId = String((e as any).sourceId || '').trim();
        if (!playerId || !sourceId) break;

        try {
          const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
          pool.doesNotEmpty = true;

          const convertsTo = String((e as any).convertsTo || '').trim();
          if (convertsTo) {
            pool.convertsTo = convertsTo;
          } else if ((e as any).convertsToColorless === true) {
            pool.convertsTo = 'colorless';
            pool.convertsToColorless = true;
          }

          pool.noEmptySourceIds = Array.isArray(pool.noEmptySourceIds) ? pool.noEmptySourceIds : [];
          if (!pool.noEmptySourceIds.includes(sourceId)) {
            pool.noEmptySourceIds.push(sourceId);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(setManaPoolDoesNotEmpty): failed', err);
        }
        break;
      }

      case "removeManaPoolDoesNotEmpty": {
        const playerId = String((e as any).playerId || '').trim();
        const sourceId = String((e as any).sourceId || '').trim();
        if (!playerId || !sourceId) break;

        try {
          const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
          pool.noEmptySourceIds = Array.isArray(pool.noEmptySourceIds)
            ? pool.noEmptySourceIds.filter((id: any) => String(id || '') !== sourceId)
            : [];

          if (pool.noEmptySourceIds.length === 0) {
            delete pool.doesNotEmpty;
            delete pool.convertsTo;
            delete pool.convertsToColorless;
            delete pool.noEmptySourceIds;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(removeManaPoolDoesNotEmpty): failed', err);
        }
        break;
      }

      case "changePermanentControl": {
        const permanentId = String((e as any).permanentId || '').trim();
        const newController = String((e as any).newController || '').trim();
        const oldController = String((e as any).oldController || '').trim();
        const duration = String((e as any).duration || '').trim();
        const appliedAt = Number((e as any).appliedAt || 0);
        if (!permanentId || !newController) break;

        try {
          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId) as any;
          if (permanent) {
            permanent.controller = newController;
            syncPreparedPermanentAfterControlChange(ctx.state, permanent, oldController);
            try {
              const { reconcileSoulbondPairing } = require('./soulbond.js') as typeof import('./soulbond.js');
              reconcileSoulbondPairing(ctx.state, permanent);
            } catch {
              // best-effort
            }
          }

          if (duration === 'eot' || duration === 'turn' || duration === 'until_end_of_turn') {
            const stateAny = ctx.state as any;
            stateAny.controlChangeEffects = Array.isArray(stateAny.controlChangeEffects) ? stateAny.controlChangeEffects : [];
            const alreadyTracked = stateAny.controlChangeEffects.some((entry: any) =>
              entry &&
              String(entry.permanentId || '') === permanentId &&
              String(entry.originalController || '') === oldController &&
              String(entry.newController || '') === newController &&
              ['eot', 'turn', 'until_end_of_turn'].includes(String(entry.duration || '').trim().toLowerCase())
            );

            if (!alreadyTracked) {
              stateAny.controlChangeEffects.push({
                permanentId,
                originalController: oldController,
                newController,
                duration,
                appliedAt,
              });
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(changePermanentControl): failed', err);
        }
        break;
      }

      case "setPermanentSelectedMode": {
        const permanentId = String((e as any).permanentId || '').trim();
        const rawSelectedMode = (e as any).selectedMode;
        if (!permanentId || !rawSelectedMode) break;

        try {
          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId) as any;
          if (!permanent) break;

          const nextSelectedMode = typeof rawSelectedMode === 'object'
            ? {
                id: String((rawSelectedMode as any).id || '').trim(),
                label: String((rawSelectedMode as any).label || (rawSelectedMode as any).description || '').trim(),
                description: String((rawSelectedMode as any).description || (rawSelectedMode as any).label || '').trim(),
              }
            : {
                id: '',
                label: String(rawSelectedMode || '').trim(),
                description: String(rawSelectedMode || '').trim(),
              };

          permanent.selectedMode = nextSelectedMode;
          permanent.card = {
            ...(permanent.card || {}),
            selectedMode: { ...nextSelectedMode },
          };

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(setPermanentSelectedMode): failed', err);
        }
        break;
      }

      case "spellBottomRevealUntilNonlandResolve": {
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const choice = String((e as any).choice || 'no').trim().toLowerCase();
        const triggeringStackItemId = String((e as any).triggeringStackItemId || '').trim();
        const spellOwnerId = String((e as any).spellOwnerId || playerId || '').trim();
        const revealPlayerId = String((e as any).revealFromLibraryPlayerId || playerId || '').trim();
        const ownerLibraryAfter = Array.isArray((e as any).ownerLibraryAfter)
          ? cloneLibraryCards((e as any).ownerLibraryAfter as any[])
          : undefined;
        const revealLibraryAfter = Array.isArray((e as any).revealLibraryAfter)
          ? cloneLibraryCards((e as any).revealLibraryAfter as any[])
          : undefined;
        const revealExileAfter = Array.isArray((e as any).revealExileAfter)
          ? ((e as any).revealExileAfter as any[]).map((card: any) => ({ ...card, zone: 'exile' }))
          : undefined;
        const rawQueuedStep = (e as any).queuedResolutionStep;

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.spellBottomRevealUntilNonlandChoice === true &&
                triggeringStackItemId.length > 0 &&
                String((step as any)?.triggeringStackItemId || '').trim() === triggeringStackItemId
              );
            });
          }

          if (choice === 'yes') {
            if (triggeringStackItemId) {
              ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
              const stackIndex = (ctx.state.stack as any[]).findIndex((item: any) => String(item?.id || '') === triggeringStackItemId);
              if (stackIndex !== -1) {
                (ctx.state.stack as any[]).splice(stackIndex, 1);
              }
            }

            if (spellOwnerId && ownerLibraryAfter) {
              const ownerZones = ensureReplayPlayerZones(ctx.state as any, spellOwnerId);
              ownerZones.library = cloneLibraryCards(ownerLibraryAfter);
              ownerZones.libraryCount = ownerLibraryAfter.length;
              ctx.libraries.set(spellOwnerId as any, cloneLibraryCards(ownerLibraryAfter));
            }

            if (revealPlayerId && revealLibraryAfter) {
              const revealZones = ensureReplayPlayerZones(ctx.state as any, revealPlayerId);
              revealZones.library = cloneLibraryCards(revealLibraryAfter);
              revealZones.libraryCount = revealLibraryAfter.length;
              ctx.libraries.set(revealPlayerId as any, cloneLibraryCards(revealLibraryAfter));
            }

            if (revealPlayerId && revealExileAfter) {
              const revealZones = ensureReplayPlayerZones(ctx.state as any, revealPlayerId);
              revealZones.exile = revealExileAfter.map((card: any) => ({ ...card, zone: 'exile' }));
              revealZones.exileCount = revealExileAfter.length;
            }

            const replayGameId = String((ctx as any).gameId || '').trim();
            const queuedStepType = String((rawQueuedStep as any)?.type || '').trim();
            if (replayGameId && rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) && queuedStepType) {
              const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
              const queuedStepId = String((rawQueuedStep as any)?.id || '').trim();
              const alreadyPresent = Boolean(
                (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
                (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
              );

              if (!alreadyPresent) {
                ResolutionQueueManager.addStep(replayGameId, {
                  ...(rawQueuedStep as any),
                  ...(queuedStepId ? { id: queuedStepId } : {}),
                  type: queuedStepType as any,
                  playerId: String((rawQueuedStep as any).playerId || revealPlayerId || playerId || '') as any,
                  description: String((rawQueuedStep as any).description || ''),
                  mandatory: (rawQueuedStep as any).mandatory !== false,
                } as any);
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(spellBottomRevealUntilNonlandResolve): failed", err);
        }
        break;
      }

      case "castRevealedFromLibraryResolve": {
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const cardId = String((e as any).cardId || '').trim();
        const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
          ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const bottomCardIds = Array.isArray((e as any).bottomCardIds)
          ? ((e as any).bottomCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const bottomCards = Array.isArray((e as any).bottomCards) ? (e as any).bottomCards as any[] : [];
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : undefined;
        const libraryAfter = libraryAfterSnapshot ?? (
          remainingLibraryIds.length > 0 || bottomCardIds.length > 0
            ? buildLibraryAfterCascadeResolve(
                getPlayerLibraryFromContext(ctx, playerId),
                bottomCards,
                remainingLibraryIds,
                bottomCardIds,
              )
            : undefined
        );
        const stackItem = (e as any).stackItem && typeof (e as any).stackItem === 'object' && !Array.isArray((e as any).stackItem)
          ? { ...(e as any).stackItem }
          : undefined;

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.castRevealedFromLibraryChoice === true &&
                cardId.length > 0 &&
                String((step as any)?.castRevealedFromLibraryCard?.id || '').trim() === cardId
              );
            });
          }

          if (playerId && libraryAfter) {
            const playerZones = ensureReplayPlayerZones(ctx.state as any, playerId);
            playerZones.library = cloneLibraryCards(libraryAfter);
            playerZones.libraryCount = libraryAfter.length;
            ctx.libraries.set(playerId as any, cloneLibraryCards(libraryAfter));
          }

          if (stackItem) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const stackItemId = String((stackItem as any).id || '').trim();
            const alreadyPresent = stackItemId.length > 0 && (ctx.state.stack as any[]).some((item: any) => String(item?.id || '').trim() === stackItemId);
            if (!alreadyPresent) {
              (ctx.state.stack as any[]).push(stackItem as any);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(castRevealedFromLibraryResolve): failed", err);
        }
        break;
      }

      case "activateManaAbility": {
        // Mana ability activation: tap permanent, add mana
        const permId = (e as any).permanentId;
        const manaColor = (e as any).manaColor;
        const playerId = (e as any).playerId != null ? String((e as any).playerId) : '';
        try {
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const replayGameId = String((ctx as any).gameId || '').trim();
          clearReplayQueuedStepById(replayGameId, String((e as any).resolvedStepId || '').trim());

          const queuedStepType = String((rawQueuedStep as any)?.type || '').trim();
          if (replayGameId && rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) && queuedStepType) {
            try {
              const discardedForCost = Array.isArray((rawQueuedStep as any)?.discardedCardIdsForCost)
                ? ((rawQueuedStep as any).discardedCardIdsForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const exiledFromHandForCost = Array.isArray((rawQueuedStep as any)?.exiledCardIdsFromHandForCost)
                ? ((rawQueuedStep as any).exiledCardIdsFromHandForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const zones = ctx.state.zones || {};
              const z = zones[playerId];
              if (z && Array.isArray(z.hand)) {
                if (discardedForCost.length > 0) {
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
                  for (const discardId of discardedForCost) {
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === discardId);
                    if (handIndex === -1) continue;
                    const [discardedCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.graveyard as any[]).push({
                      ...discardedCard,
                      zone: 'graveyard',
                      ...buildDiscardProvenanceFields(ctx.state, String(playerId)),
                    });
                  }
                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                }
                if (exiledFromHandForCost.length > 0) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];
                  for (const exileId of exiledFromHandForCost) {
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === exileId);
                    if (handIndex === -1) continue;
                    const [exiledCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.exile as any[]).push({ ...exiledCard, zone: 'exile' });
                  }
                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;
                }
              }
            } catch {
              // best-effort only
            }

            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            const queuedStepId = String((rawQueuedStep as any)?.id || '').trim();
            const alreadyPresent = Boolean(
              (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
              (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
            );

            if (!alreadyPresent) {
              ResolutionQueueManager.addStep(replayGameId, {
                ...(rawQueuedStep as any),
                ...(queuedStepId ? { id: queuedStepId } : {}),
                type: queuedStepType as any,
                playerId: String((rawQueuedStep as any).playerId || playerId || '') as any,
                description: String((rawQueuedStep as any).description || ''),
                mandatory: (rawQueuedStep as any).mandatory !== false,
              } as any);
            }
          }

          // Replay-stable per-turn tracking for intervening-if templates like
          // "if you haven't added mana with this ability this turn".
          try {
            const stateAny = ctx.state as any;
            const abilityId = (e as any).abilityId;
            const playerKey = playerId;
            const permKey = permId != null ? String(permId) : '';
            const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
            if (playerKey && permKey) {
              stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
              stateAny.addedManaWithThisAbilityThisTurn[playerKey] = stateAny.addedManaWithThisAbilityThisTurn[playerKey] || {};

              // Prefer an ability-specific key when available; otherwise fall back to permanent id.
              const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
              (stateAny.addedManaWithThisAbilityThisTurn[playerKey] as any)[k] = true;
            }
          } catch {
            // best-effort only
          }

          if (permId) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (playerId) {
              const recordedMana = normalizeRecordedManaMap((e as any).addedMana);
              const manaToApply = Object.keys(recordedMana).length > 0
                ? recordedMana
                : (perm ? inferLegacyManaReplay(ctx.state, perm, playerId, manaColor, (e as any).abilityId) : {});
              applyRecordedManaToPool(ctx, playerId, manaToApply);
              if ((e as any).manaGrantsCreatureSpellHasteUntilEndOfTurn === true) {
                for (const [poolKey, rawAmount] of Object.entries(manaToApply || {})) {
                  const amount = Number(rawAmount || 0);
                  if (!Number.isFinite(amount) || amount <= 0) continue;
                  recordCreatureSpellHasteManaProduced(ctx.state, String(playerId), String(poolKey) as any, amount);
                }
              }

              const explicitLifeLost = Number((e as any).lifeLost || 0);
              const explicitLifeLossIsDamage = typeof (e as any).lifeLossIsDamage === 'boolean'
                ? Boolean((e as any).lifeLossIsDamage)
                : undefined;
              const replayActivationCostLifePaid = consumeReplayManaActivationLifeCost(ctx.state, playerId, permId, (e as any).abilityId);
              const inferredLifeEffect = perm ? inferLegacyManaLifeEffect(perm, manaColor) : { amount: 0, isDamage: false };
              const suppressLegacyLifeInference = replayActivationCostLifePaid > 0 && inferredLifeEffect.isDamage !== true;
              const replayLifeLost = explicitLifeLost > 0
                ? explicitLifeLost
                : (suppressLegacyLifeInference ? 0 : inferredLifeEffect.amount);
              applyManaAbilityLifeLoss(
                ctx,
                playerId,
                replayLifeLost,
                explicitLifeLossIsDamage ?? inferredLifeEffect.isDamage,
              );
            }

            if (perm) {
              (perm as any).tapped = true;
              
              // Yuna, Grand Summoner: "Grand Summon — {T}: Add one mana of any color. When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it."
              const cardName = ((perm as any).card?.name || '').toLowerCase();
              const oracleText = ((perm as any).card?.oracle_text || '').toLowerCase();
              if (cardName.includes('yuna') && cardName.includes('grand summoner') ||
                  (oracleText.includes('add one mana of any color') && 
                   oracleText.includes('next') && oracleText.includes('creature') && 
                   oracleText.includes('enters') && oracleText.includes('two additional +1/+1 counter'))) {
                // Set flag for next creature spell this turn
                const controllerId = (perm as any).controller;
                (ctx.state as any).yunaNextCreatureFlags = (ctx.state as any).yunaNextCreatureFlags || {};
                (ctx.state as any).yunaNextCreatureFlags[controllerId] = true;
                debug(2, `[activateManaAbility] Yuna, Grand Summoner's Grand Summon activated - next creature will enter with +2 counters`);
              }
            }
          }
          // Mana pool updates are typically ephemeral, but we bump seq for state sync
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activateManaAbility): failed", err);
        }
        break;
      }

      case "activateAbility": {
        try {
          applyAIActivateAbilityReplay(ctx as any, e as any);
        } catch (err) {
          debugWarn(1, 'applyEvent(activateAbility): failed', err);
        }
        break;
      }

      case "activateBattlefieldAbility": {
        // Critical undo/replay gap #3 contract (split, not a full effect re-executor):
        // - Replay cost/tap/stack evidence recorded on the event (discard/exile/sac/bounce/tap/
        //   mana delta/life/counters-as-cost/exert/hideaway/queued step).
        // - Rebuild stack items for usesStack / known abilityTypes so later resolve events apply effects.
        // - Apply rich non-stack effect payload fields when present (counterUpdates, specialAnimation,
        //   hideawayMovedCardToHand, known abilityType one-shots like humble-defector).
        // - Do NOT invent arbitrary activated effects. Live paths must emit discrete follow-up events
        //   (activateManaAbility, battlefieldPermanentPatch, updateCounters, resolve events, etc.)
        //   for mutations this stub cannot reconstruct. Fail closed with a warning when usesStack is
        //   false and no reconstructible effect evidence is present.
        try {
          const stateAny = ctx.state as any;
          const replayGameId = String((ctx as any).gameId || '').trim();
          clearReplayQueuedStepById(replayGameId, String((e as any).resolvedStepId || '').trim());

          const playerId = (e as any).playerId;
          const permId = (e as any).permanentId;
          const abilityId = (e as any).abilityId;
          const abilityText = String((e as any).abilityText || '');
          const activatedAbilityText = String((e as any).activatedAbilityText || '');
          const activatedAbilityIndex = Number((e as any).activatedAbilityIndex);
          const persistedStackItemId = String((e as any).stackItemId || '').trim();
          const persistedTargets = Array.isArray((e as any).targets)
            ? ((e as any).targets as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if ((e as any).exhaustAbility === true && permId != null && Number.isFinite(activatedAbilityIndex)) {
            markExhaustAbilityActivated(stateAny, permId, activatedAbilityIndex);
          }

          if (replayGameId && (persistedStackItemId || persistedTargets.length > 0)) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;

              const stepType = String((step as any)?.type || '');
              const isBattlefieldTargetStep =
                stepType === String(ResolutionStepType.TARGET_SELECTION) &&
                (step as any)?.battlefieldAbilityTargetSelection === true;
              const isBattlefieldPaymentStep =
                stepType === String(ResolutionStepType.MANA_PAYMENT_CHOICE) &&
                (step as any)?.activationPaymentChoice === true;
              if (!isBattlefieldTargetStep && !isBattlefieldPaymentStep) {
                return false;
              }

              const stepPermId = String((step as any)?.permanentId || (step as any)?.sourceId || '').trim();
              if (permId != null && stepPermId !== String(permId)) return false;
              if (playerId != null && String((step as any)?.playerId || '').trim() !== String(playerId)) return false;

              const stepAbilityId = String((step as any)?.abilityId || '').trim();
              const eventAbilityId = String(abilityId || '').trim();
              if (stepAbilityId && eventAbilityId && stepAbilityId !== eventAbilityId) return false;

              return true;
            });
          }

          // If the server persisted which cards were discarded from hand to pay activation costs,
          // apply those discards during replay so zones are deterministic.
          try {
            const discarded = (e as any).discardedCardIds;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Array.isArray(discarded) && discarded.length > 0) {
              (ctx.state as any).zones = (ctx.state as any).zones || {};
              const zones = (ctx.state as any).zones;
              const z = zones[pid];
              if (z && Array.isArray(z.hand)) {
                z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

                for (const cid of discarded) {
                  const id = String(cid || '').trim();
                  if (!id) continue;
                  const idx = (z.hand as any[]).findIndex((c: any) => c && String(c.id) === id);
                  if (idx === -1) continue;
                  const [card] = (z.hand as any[]).splice(idx, 1);
                  (z.graveyard as any[]).push({
                    ...card,
                    zone: 'graveyard',
                    ...buildDiscardProvenanceFields(ctx.state, pid),
                  });
                }

                z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;

                const stateAny = ctx.state as any;
                stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                stateAny.discardedCardThisTurn[pid] = true;
                stateAny.anyPlayerDiscardedCardThisTurn = true;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which cards were exiled from hand to pay activation costs,
          // apply those exiles during replay so zones are deterministic.
          try {
            const exiledFromHand = (e as any).exiledCardIdsFromHandForCost;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Array.isArray(exiledFromHand) && exiledFromHand.length > 0) {
              const zones = (ctx.state as any).zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.hand)) {
                z.exile = Array.isArray(z.exile) ? z.exile : [];

                for (const cid of exiledFromHand) {
                  const id = String(cid || '').trim();
                  if (!id) continue;
                  const idx = (z.hand as any[]).findIndex((c: any) => c && String(c.id) === id);
                  if (idx === -1) continue;
                  const [card] = (z.hand as any[]).splice(idx, 1);
                  (z.exile as any[]).push({ ...card, zone: 'exile' });
                }

                z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                if (z.exileCount !== undefined) z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;

                const stateAny = ctx.state as any;
                stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                stateAny.discardedCardThisTurn[pid] = true;
                stateAny.anyPlayerDiscardedCardThisTurn = true;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which permanents were sacrificed to pay activation costs,
          // apply those sacrifices during replay so battlefield state is deterministic.
          try {
            const sacrificed = (e as any).sacrificedPermanents;
            if (Array.isArray(sacrificed) && sacrificed.length > 0) {
              for (const sid of sacrificed) {
                const id = String(sid || '').trim();
                if (!id) continue;
                // Best-effort: only move if still on battlefield.
                const bf = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                const permanent = bf.find((p: any) => p && String(p.id) === id) as any;
                if (!permanent) continue;
                const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
                  ? { ...(permanent.card || {}), zone: 'graveyard' }
                  : null;
                const graveyardOwnerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
                movePermanentToGraveyard(ctx as any, id, true);

                if (tokenGraveyardSnapshot && graveyardOwnerId) {
                  const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
                  const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                    hand: [],
                    handCount: 0,
                    libraryCount: 0,
                    graveyard: [],
                    graveyardCount: 0,
                    exile: [],
                    exileCount: 0,
                  });
                  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

                  const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                    if (!card) return false;
                    const cardId = String((card as any).id || '').trim();
                    const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                    if (cardId && snapshotId) return cardId === snapshotId;
                    return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
                  });

                  if (!alreadyPresent) {
                    (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
                  }
                }
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which permanents were returned to hand to pay activation costs,
          // apply those bounces during replay so battlefield/zones are deterministic.
          try {
            const returned = (e as any).returnedPermanentsToHandForCost;
            if (Array.isArray(returned) && returned.length > 0) {
              for (const rid of returned) {
                const id = String(rid || '').trim();
                if (!id) continue;
                // Best-effort: only move if still on battlefield.
                const bf = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                if (!bf.some((p: any) => p && String(p.id) === id)) continue;
                movePermanentToHand(ctx as any, id);
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which permanents were tapped to pay activation costs,
          // apply those taps during replay so battlefield state is deterministic.
          try {
            const tapped = (e as any).tappedPermanents;
            if (Array.isArray(tapped) && tapped.length > 0) {
              const battlefield = ctx.state.battlefield || [];
              const tappedSet = new Set(tapped.map((x: any) => String(x)));
              const unresolvedTapped: string[] = [];

              for (const p of battlefield as any[]) {
                if (!p) continue;
                if (tappedSet.has(String(p.id))) {
                  (p as any).tapped = true;
                }
              }

              for (const targetId of tappedSet) {
                const found = (battlefield as any[]).some((permanent: any) => permanent && String(permanent.id || '') === targetId);
                if (!found) unresolvedTapped.push(targetId);
              }

              const tapCostTargetFilter = (e as any).tapCostTargetFilter;
              if (unresolvedTapped.length > 0 && tapCostTargetFilter && typeof tapCostTargetFilter === 'object') {
                const controllerFilter = String((tapCostTargetFilter as any).controller || 'any').toLowerCase();
                const tapStatus = String((tapCostTargetFilter as any).tapStatus || 'any').toLowerCase();
                const excludeSource = (tapCostTargetFilter as any).excludeSource === true;
                const requireAllTypes = (tapCostTargetFilter as any).requireAllTypes === true;
                const filterTypes = Array.isArray((tapCostTargetFilter as any).types)
                  ? (tapCostTargetFilter as any).types.map((value: any) => String(value || '').toLowerCase()).filter(Boolean)
                  : [];
                const sourcePermanentId = String(permId || '').trim();
                const preferTokens = (e as any).tapCostPreferTokens === true;
                const preferNonTokens = (e as any).tapCostPreferNonTokens === true;
                const neededCount = Math.max(
                  unresolvedTapped.length,
                  Number.isFinite(Number((e as any).tapCostTargetCount)) ? Number((e as any).tapCostTargetCount) : unresolvedTapped.length
                );

                const candidates = (battlefield as any[])
                  .filter((permanent: any) => {
                    if (!permanent) return false;
                    const permanentId = String(permanent.id || '').trim();
                    if (!permanentId) return false;
                    if (excludeSource && sourcePermanentId && permanentId === sourcePermanentId) return false;
                    if (tappedSet.has(permanentId)) return false;

                    if (controllerFilter === 'you' && String(permanent.controller || '') !== String(playerId || '')) return false;
                    if (controllerFilter === 'opponent' && String(permanent.controller || '') === String(playerId || '')) return false;
                    if (tapStatus === 'tapped' && !permanent.tapped) return false;
                    if (tapStatus === 'untapped' && permanent.tapped) return false;

                    if (filterTypes.length > 0) {
                      const typeLine = String(permanent.card?.type_line || permanent.type_line || permanent.cardType || '').toLowerCase();
                      const matches = requireAllTypes
                        ? filterTypes.every((type: string) => typeLine.includes(type))
                        : filterTypes.some((type: string) => typeLine.includes(type));
                      if (!matches) return false;
                    }

                    return true;
                  })
                  .map((permanent: any, index: number) => {
                    let score = 0;
                    if (preferTokens && permanent.isToken) score += 100;
                    if (preferNonTokens && !permanent.isToken) score += 100;
                    return { permanent, index, score };
                  })
                  .sort((left: any, right: any) => {
                    if (right.score !== left.score) return right.score - left.score;
                    return left.index - right.index;
                  })
                  .slice(0, neededCount);

                for (const candidate of candidates) {
                  if (candidate?.permanent) {
                    candidate.permanent.tapped = true;
                  }
                }
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted that activating this ability exerted the source as a cost,
          // restore the next-untap restriction and turn-scoped exert marker during replay.
          try {
            const exertedPermanentId = String((e as any).exertedPermanentIdForCost || '').trim();
            if (exertedPermanentId) {
              const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === exertedPermanentId) as any;
              if (permanent) {
                permanent.doesntUntapNextTurn = true;
                permanent.exertedThisTurn = true;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted the net mana-pool change caused by paying activation costs,
          // apply it during replay so exact floating-mana restoration survives undo/restart.
          try {
            const manaDelta = (e as any).paymentManaDelta;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
              const pool = getOrInitManaPool(ctx.state as any, pid as any) as any;
              for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
                const amount = Number(rawAmount || 0);
                if (!Number.isFinite(amount) || amount === 0) continue;
                pool[poolKey] = Number(pool[poolKey] || 0) + amount;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted counter updates performed by shortcut activations,
          // apply them during replay so counter state survives undo/restart.
          try {
            const counterUpdates = Array.isArray((e as any).counterUpdates) ? (e as any).counterUpdates : [];
            for (const entry of counterUpdates) {
              const permanentId = String(entry?.permanentId || '').trim();
              const deltas = entry?.deltas;
              if (!permanentId || !deltas || typeof deltas !== 'object' || Array.isArray(deltas)) continue;
              // Parent event already recorded the final deltas; do not re-emit updateCounters or
              // re-apply Vorinclex/Doubling Season modifiers during replay/apply.
              updateCounters(ctx as any, permanentId, deltas as Record<string, number>, {
                skipEventPersistence: true,
                skipCounterModifications: true,
              });
            }
          } catch (err) {
            debugWarn(1, 'applyEvent(activateBattlefieldAbility): counterUpdates failed', err);
          }

          // If the server persisted a hideaway card moving to hand, replay that zone change
          // and clear the source permanent's hidden card so reconnect/undo stay deterministic.
          try {
            const movedHideawayCard = (e as any).hideawayMovedCardToHand;
            const clearedHideawayPermanentId = String((e as any).clearedHideawayPermanentId || permId || '').trim();
            const pid = playerId != null ? String(playerId) : '';
            if (pid && movedHideawayCard && typeof movedHideawayCard === 'object' && !Array.isArray(movedHideawayCard)) {
              const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
              const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 };
              z.hand = Array.isArray(z.hand) ? z.hand : [];
              (z.hand as any[]).push(cardFromHideawayToHand(movedHideawayCard));
              z.handCount = (z.hand as any[]).length;
            }

            if (clearedHideawayPermanentId) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === clearedHideawayPermanentId) as any;
              if (permanent) {
                clearStoredHideawayCard(ctx.state, permanent, pid);
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted a queued battlefield prompt for an activation,
          // rebuild that prompt during replay so reconnect/undo preserves the pre-response state.
          try {
            const rawStep = (e as any).queuedResolutionStep;
            const gameId = String((ctx as any).gameId || '').trim();
            const stepId = String((rawStep as any)?.id || '').trim();
            const stepType = String((rawStep as any)?.type || '').trim();
            if (gameId && rawStep && typeof rawStep === 'object' && !Array.isArray(rawStep) && stepType) {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const alreadyPresent = Boolean(
                (queue?.activeStep && String((queue.activeStep as any)?.id || '') === stepId) ||
                (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === stepId))
              );

              if (!alreadyPresent) {
                ResolutionQueueManager.addStep(gameId, {
                  ...(rawStep as any),
                  ...(stepId ? { id: stepId } : {}),
                  type: stepType as any,
                  playerId: String((rawStep as any).playerId || playerId || '') as any,
                  description: String((rawStep as any).description || ''),
                  mandatory: (rawStep as any).mandatory !== false,
                } as any);
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted an immediate until-end-of-turn animation shortcut,
          // apply it during replay so the permanent's temporary state is deterministic.
          try {
            const animation = (e as any).specialAnimation;
            if (permId && animation && typeof animation === 'object' && !Array.isArray(animation)) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permId)) as any;
              if (permanent) {
                if ((animation as any).animatedUntilEOT === true) permanent.animatedUntilEOT = true;
                if (Number.isFinite(Number((animation as any).basePower))) permanent.basePower = Number((animation as any).basePower);
                if (Number.isFinite(Number((animation as any).baseToughness))) permanent.baseToughness = Number((animation as any).baseToughness);
                if (Number.isFinite(Number((animation as any).effectivePower))) permanent.effectivePower = Number((animation as any).effectivePower);
                if (Number.isFinite(Number((animation as any).effectiveToughness))) permanent.effectiveToughness = Number((animation as any).effectiveToughness);
                if (Array.isArray((animation as any).typeAdditions)) {
                  permanent.typeAdditions = Array.from(
                    new Set(
                      [
                        ...(Array.isArray(permanent.typeAdditions) ? permanent.typeAdditions : []),
                        ...((animation as any).typeAdditions as any[]),
                      ].map((value: any) => String(value || '').trim()).filter(Boolean)
                    )
                  );
                }
                if ((animation as any).hasAllCreatureTypes === true) permanent.hasAllCreatureTypes = true;
                if ((animation as any).untilEndOfTurn && typeof (animation as any).untilEndOfTurn === 'object') {
                  permanent.untilEndOfTurn = {
                    ...(permanent.untilEndOfTurn && typeof permanent.untilEndOfTurn === 'object' ? permanent.untilEndOfTurn : {}),
                    ...((animation as any).untilEndOfTurn || {}),
                  };
                }
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which counters were removed to pay activation costs,
          // apply those counter removals during replay so battlefield state is deterministic.
          try {
            const removed = (e as any).removedCountersForCost;
            if (Array.isArray(removed) && removed.length > 0) {
              for (const entry of removed) {
                const permanentId = String(entry?.permanentId || '').trim();
                const counterType = String(entry?.counterType || '').trim();
                const count = Number(entry?.count || 0);
                if (!permanentId || !counterType || !Number.isFinite(count) || count <= 0) continue;
                updateCounters(ctx as any, permanentId, { [counterType]: -count }, {
                  skipEventPersistence: true,
                  skipCounterModifications: true,
                });
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted life paid to activate this ability, apply it during replay.
          try {
            const paid = Number((e as any).lifePaidForCost || 0);
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Number.isFinite(paid) && paid > 0) {
              (ctx.state as any).life = (ctx.state as any).life || {};
              const cur = Number((ctx.state as any).life?.[pid] ?? 40);
              (ctx.state as any).life[pid] = Math.max(0, cur - paid);
              (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
              (ctx.state as any).lifeLostThisTurn[pid] = ((ctx.state as any).lifeLostThisTurn[pid] || 0) + paid;

              const player = Array.isArray((ctx.state as any).players)
                ? (ctx.state as any).players.find((entry: any) => entry && String(entry.id || '') === pid)
                : null;
              if (player) {
                player.life = (ctx.state as any).life[pid];
              }

              rememberReplayManaActivationLifeCost(ctx.state, pid, permId, (e as any).abilityId, paid);
            }
          } catch {
            // best-effort only
          }

          // If the server persisted which cards were exiled from the activator's graveyard to pay activation costs,
          // apply those exiles during replay so zones are deterministic.
          try {
            const exiled = (e as any).exiledCardIdsFromGraveyardForCost;
            const pid = playerId != null ? String(playerId) : '';
            if (pid && Array.isArray(exiled) && exiled.length > 0) {
              const zones = (ctx.state as any).zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.graveyard)) {
                z.exile = Array.isArray(z.exile) ? z.exile : [];

                for (const cid of exiled) {
                  const id = String(cid || '').trim();
                  if (!id) continue;
                  const idx = (z.graveyard as any[]).findIndex((c: any) => c && String(c.id) === id);
                  if (idx === -1) continue;
                  const [card] = (z.graveyard as any[]).splice(idx, 1);
                  (z.exile as any[]).push({ ...card, zone: 'exile' });
                }

                z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                if (z.exileCount !== undefined) z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;
              }
            }
          } catch {
            // best-effort only
          }

          // If the server persisted Blight N as an activation cost ("put N -1/-1 counters on a creature you control"),
          // apply the counters during replay so battlefield state is deterministic.
          try {
            const blightTargetId = String((e as any).blightTargetPermanentIdForCost || '').trim();
            const blightN = Number((e as any).blightNForCost || 0);
            if (blightTargetId && Number.isFinite(blightN) && blightN > 0) {
              updateCounters(ctx as any, blightTargetId, { '-1/-1': blightN }, {
                skipEventPersistence: true,
                skipCounterModifications: true,
              });
            }
          } catch {
            // best-effort only
          }

          try {
            const persistedAbilityType = String((e as any).abilityType || '').trim().toLowerCase();
            if (persistedAbilityType === 'humble-defector') {
              drawCards(ctx as any, String(playerId || ''), 2);

              const targetOpponentId = String((e as any).targetOpponentId || '').trim();
              if (targetOpponentId) {
                const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
                const humbleDefector = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permId || '')) as any;
                if (humbleDefector) {
                  const previousController = String(humbleDefector.controller || '');
                  humbleDefector.controller = targetOpponentId;
                  syncPreparedPermanentAfterControlChange(ctx.state, humbleDefector, previousController);
                  humbleDefector.summoningSickness = true;
                }
              }

              ctx.bumpSeq();
              break;
            }
          } catch {
            // best-effort only
          }

          // If the server persisted the full activated ability text (including cost),
          // attach it to the matching ability stack item to support intervening-if inference.
          try {
            if (activatedAbilityText) {
              const stack = Array.isArray((stateAny as any).stack) ? (stateAny as any).stack : (Array.isArray(ctx.state.stack) ? ctx.state.stack : []);
              if (Array.isArray(stack) && stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                  const item = stack[i];
                  if (!item || String(item.type || '') !== 'ability') continue;
                  if (playerId != null && String(item.controller) !== String(playerId)) continue;
                  if (permId != null && String(item.source) !== String(permId)) continue;
                  if (abilityText && String(item.description || '') !== abilityText) continue;
                  (item as any).activatedAbilityText = activatedAbilityText;
                  break;
                }
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const retargetValidTargets = Array.isArray((e as any).copyRetargetValidTargets) ? (e as any).copyRetargetValidTargets : null;
            const retargetTargetTypes = Array.isArray((e as any).copyRetargetTargetTypes) ? (e as any).copyRetargetTargetTypes : null;
            const retargetMinTargets = Number((e as any).copyRetargetMinTargets ?? NaN);
            const retargetMaxTargets = Number((e as any).copyRetargetMaxTargets ?? NaN);
            const retargetTargetDescription = String((e as any).copyRetargetTargetDescription || '');
            const persistedTargets = Array.isArray((e as any).targets) ? (e as any).targets : null;
            const persistedStackItemId = String((e as any).stackItemId || '').trim();
            const persistedTapUntapAction = String((e as any).tapUntapAction || '').trim().toLowerCase();
            const persistedAbilityType = String((e as any).abilityType || (e as any).abilityId || '').trim().toLowerCase();
            const isEquipActivation = persistedAbilityType === 'equip';
            const isFortifyActivation = persistedAbilityType === 'fortify';
            const isFightActivation = persistedAbilityType === 'fight';
            const isAddCounterActivation = persistedAbilityType === 'add_counter';
            const isLevelUpActivation = persistedAbilityType === 'level_up';
            const isOutlastActivation = persistedAbilityType === 'outlast';
            const isMonstrosityActivation = persistedAbilityType === 'monstrosity';
            const isAdaptActivation = persistedAbilityType === 'adapt';
            const isReconfigureAttachActivation = persistedAbilityType === 'reconfigure_attach';
            const isReconfigureUnattachActivation = persistedAbilityType === 'reconfigure_unattach';
            const persistedUsesStack = (e as any).usesStack === true;
            // Explicit usesStack:false means live already applied (or deferred via discrete events);
            // do not invent a stack item from cost evidence alone.
            const explicitNonStack = (e as any).usesStack === false;
            const replayAbilityDescription = String(abilityText || '').trim()
              || (persistedUsesStack && activatedAbilityText.includes(':')
                ? activatedAbilityText.split(':').slice(1).join(':').trim()
                : '');
            const tappedPermanentsForCost = Array.isArray((e as any).tappedPermanents)
              ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            const tappedOtherPermanentForCost = playerId != null && permId != null
              ? tappedPermanentsForCost.some((id: string) => id !== String(permId))
              : tappedPermanentsForCost.length > 0;
            const hasInteractiveCostEvidence =
              tappedOtherPermanentForCost ||
              Boolean(Array.isArray((e as any).discardedCardIds) && (e as any).discardedCardIds.length > 0) ||
              Boolean(Array.isArray((e as any).exiledCardIdsFromHandForCost) && (e as any).exiledCardIdsFromHandForCost.length > 0) ||
              Boolean(Array.isArray((e as any).returnedPermanentsToHandForCost) && (e as any).returnedPermanentsToHandForCost.length > 0) ||
              Boolean(Array.isArray((e as any).sacrificedPermanents) && (e as any).sacrificedPermanents.length > 0) ||
              Boolean(Array.isArray((e as any).removedCountersForCost) && (e as any).removedCountersForCost.length > 0) ||
              Boolean(Number((e as any).lifePaidForCost || 0) > 0);
            const shouldRebuildStack = !explicitNonStack && Boolean(replayAbilityDescription || activatedAbilityText) && playerId != null && permId != null && (
              isEquipActivation ||
              isFortifyActivation ||
              isFightActivation ||
              isAddCounterActivation ||
              isLevelUpActivation ||
              isOutlastActivation ||
              isMonstrosityActivation ||
              isAdaptActivation ||
              isReconfigureAttachActivation ||
              isReconfigureUnattachActivation ||
              persistedUsesStack ||
              Boolean(persistedTargets && persistedTargets.length > 0) ||
              (Boolean(activatedAbilityText) && hasInteractiveCostEvidence)
            );
            const stack = Array.isArray((stateAny as any).stack) ? (stateAny as any).stack : (Array.isArray(ctx.state.stack) ? ctx.state.stack : []);
            if (shouldRebuildStack) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(permId));
              const existingStackItem = Array.isArray(stack)
                ? stack.find((item: any) =>
                    item &&
                    String(item.type || '') === 'ability' &&
                    (
                      (persistedStackItemId && String(item.id || '') === persistedStackItemId) ||
                      (
                        String(item.controller || '') === String(playerId) &&
                        String(item.source || '') === String(permId) &&
                        (!replayAbilityDescription || String(item.description || '') === replayAbilityDescription)
                      )
                    )
                  )
                : null;

              if (existingStackItem && persistedStackItemId && String((existingStackItem as any).id || '') !== persistedStackItemId) {
                (existingStackItem as any).id = persistedStackItemId;
              }

              if (!existingStackItem && permanent) {
                const manaCost = (String(activatedAbilityText || '').match(/\{[^}]+\}/g) || [])
                  .filter((symbol: string) => !/^\{[tq]\}$/i.test(symbol))
                  .join('');
                const manaPool = stateAny.manaPool?.[String(playerId)];
                const hasPaymentManaDelta = Boolean(
                  (e as any).paymentManaDelta &&
                  typeof (e as any).paymentManaDelta === 'object' &&
                  !Array.isArray((e as any).paymentManaDelta) &&
                  Object.keys((e as any).paymentManaDelta).length > 0
                );
                if (manaPool && manaCost && !hasPaymentManaDelta) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }

                const rebuiltStackItem: any = {
                  id: persistedStackItemId || generateDeterministicId(ctx, 'ability_battlefield', `${String(permId)}:${persistedAbilityType || replayAbilityDescription || activatedAbilityText}`),
                  type: 'ability',
                  controller: String(playerId),
                  source: String(permId),
                  sourceName: String((e as any).cardName || (permanent as any)?.card?.name || 'Ability'),
                  description: replayAbilityDescription || activatedAbilityText,
                  activatedAbilityText: activatedAbilityText || undefined,
                  xValue: typeof (e as any).xValue === 'number' ? (e as any).xValue : undefined,
                };

                if (persistedTargets) {
                  rebuiltStackItem.targets = persistedTargets.map((id: any) => String(id));
                }
                if (persistedTapUntapAction === 'tap' || persistedTapUntapAction === 'untap') {
                  rebuiltStackItem.tapUntapAction = persistedTapUntapAction;
                }
                if (retargetValidTargets) {
                  rebuiltStackItem.copyRetargetValidTargets = retargetValidTargets.map((target: any) => ({ ...target }));
                  rebuiltStackItem.copyRetargetTargetTypes = retargetTargetTypes ? [...retargetTargetTypes] : [];
                  if (Number.isFinite(retargetMinTargets)) rebuiltStackItem.copyRetargetMinTargets = retargetMinTargets;
                  if (Number.isFinite(retargetMaxTargets)) rebuiltStackItem.copyRetargetMaxTargets = retargetMaxTargets;
                  if (retargetTargetDescription) rebuiltStackItem.copyRetargetTargetDescription = retargetTargetDescription;
                }

                if (isEquipActivation) {
                  const targetCreatureId = String(persistedTargets?.[0] || (e as any)?.equipParams?.targetCreatureId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetCreatureId);
                  rebuiltStackItem.abilityType = 'equip';
                  rebuiltStackItem.equipParams = {
                    equipmentId: String(permId || ''),
                    targetCreatureId,
                    equipmentName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Equipment'),
                    targetCreatureName: String((e as any)?.equipParams?.targetCreatureName || validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isFortifyActivation) {
                  const targetLandId = String(persistedTargets?.[0] || (e as any)?.fortifyParams?.targetLandId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetLandId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetLandId);
                  rebuiltStackItem.abilityType = 'fortify';
                  rebuiltStackItem.fortifyParams = {
                    fortificationId: String(permId || ''),
                    targetLandId,
                    fortificationName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Fortification'),
                    targetLandName: String((e as any)?.fortifyParams?.targetLandName || validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isFightActivation) {
                  const targetCreatureId = String(persistedTargets?.[0] || (e as any)?.fightParams?.targetCreatureId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetCreatureId);
                  rebuiltStackItem.abilityType = 'fight';
                  rebuiltStackItem.fightParams = {
                    sourceCreatureId: String(permId || ''),
                    targetCreatureId,
                    sourceCreatureName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Creature'),
                    targetCreatureName: String(validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isAddCounterActivation) {
                  const targetPermanentId = String(persistedTargets?.[0] || (e as any)?.counterParams?.targetId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetPermanentId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetPermanentId);
                  const counterParams = (e as any)?.counterParams || {};
                  rebuiltStackItem.abilityType = 'add_counter';
                  rebuiltStackItem.counterParams = {
                    targetId: targetPermanentId,
                    targetName: String(counterParams.targetName || validTarget?.name || validTarget?.card?.name || ''),
                    counterType: String(counterParams.counterType || ''),
                    targetControllerRule: counterParams.targetControllerRule || 'any',
                    oracleText: String(counterParams.oracleText || activatedAbilityText || replayAbilityDescription || ''),
                    scalingText: counterParams.scalingText ? String(counterParams.scalingText) : null,
                  };
                } else if (isLevelUpActivation) {
                  rebuiltStackItem.abilityType = 'level_up';
                  rebuiltStackItem.levelUpParams = {
                    amount: Number((e as any)?.levelUpParams?.amount || 1),
                  };
                } else if (isOutlastActivation) {
                  rebuiltStackItem.abilityType = 'outlast';
                  rebuiltStackItem.outlastParams = {
                    amount: Number((e as any)?.outlastParams?.amount || 1),
                    counterType: String((e as any)?.outlastParams?.counterType || '+1/+1'),
                  };
                } else if (isMonstrosityActivation) {
                  rebuiltStackItem.abilityType = 'monstrosity';
                  rebuiltStackItem.monstrosityParams = {
                    amount: Number((e as any)?.monstrosityParams?.amount || 0),
                  };
                } else if (isAdaptActivation) {
                  rebuiltStackItem.abilityType = 'adapt';
                  rebuiltStackItem.adaptParams = {
                    amount: Number((e as any)?.adaptParams?.amount || 0),
                  };
                } else if (isReconfigureAttachActivation) {
                  const targetCreatureId = String(persistedTargets?.[0] || (e as any)?.reconfigureParams?.targetCreatureId || '');
                  const validTarget = retargetValidTargets
                    ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                    : battlefield.find((target: any) => target && String(target.id || '') === targetCreatureId);
                  rebuiltStackItem.abilityType = 'reconfigure_attach';
                  rebuiltStackItem.reconfigureParams = {
                    reconfigureId: String(permId || ''),
                    targetCreatureId,
                    reconfigureName: String((e as any).cardName || rebuiltStackItem.sourceName || 'Equipment'),
                    targetCreatureName: String((e as any)?.reconfigureParams?.targetCreatureName || validTarget?.name || validTarget?.card?.name || ''),
                  };
                } else if (isReconfigureUnattachActivation) {
                  rebuiltStackItem.abilityType = 'reconfigure_unattach';
                }

                stack.push(rebuiltStackItem);
              }
            }

            if (retargetValidTargets || persistedTargets) {
              if (Array.isArray(stack) && stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                  const item = stack[i];
                  if (!item || String(item.type || '') !== 'ability') continue;
                  if (playerId != null && String(item.controller) !== String(playerId)) continue;
                  if (permId != null && String(item.source) !== String(permId)) continue;
                  if (abilityText && String(item.description || '') !== abilityText) continue;
                  if (persistedTargets) {
                    (item as any).targets = persistedTargets.map((id: any) => String(id));
                  }
                  if (persistedTapUntapAction === 'tap' || persistedTapUntapAction === 'untap') {
                    (item as any).tapUntapAction = persistedTapUntapAction;
                  }
                  if (typeof (e as any).xValue === 'number') {
                    (item as any).xValue = (e as any).xValue;
                  }
                  if (retargetValidTargets) {
                    (item as any).copyRetargetValidTargets = retargetValidTargets.map((target: any) => ({ ...target }));
                    (item as any).copyRetargetTargetTypes = retargetTargetTypes ? [...retargetTargetTypes] : [];
                    if (Number.isFinite(retargetMinTargets)) (item as any).copyRetargetMinTargets = retargetMinTargets;
                    if (Number.isFinite(retargetMaxTargets)) (item as any).copyRetargetMaxTargets = retargetMaxTargets;
                    if (retargetTargetDescription) (item as any).copyRetargetTargetDescription = retargetTargetDescription;
                  }
                  if (isEquipActivation) {
                    const targetCreatureId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                      : null;
                    (item as any).abilityType = 'equip';
                    (item as any).equipParams = {
                      equipmentId: String(permId || ''),
                      targetCreatureId,
                      equipmentName: String((e as any).cardName || item.sourceName || 'Equipment'),
                      targetCreatureName: String(validTarget?.name || ''),
                    };
                  } else if (isFortifyActivation) {
                    const targetLandId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetLandId)
                      : null;
                    (item as any).abilityType = 'fortify';
                    (item as any).fortifyParams = {
                      fortificationId: String(permId || ''),
                      targetLandId,
                      fortificationName: String((e as any).cardName || item.sourceName || 'Fortification'),
                      targetLandName: String(validTarget?.name || ''),
                    };
                  } else if (isFightActivation) {
                    const targetCreatureId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                      : null;
                    (item as any).abilityType = 'fight';
                    (item as any).fightParams = {
                      sourceCreatureId: String(permId || ''),
                      targetCreatureId,
                      sourceCreatureName: String((e as any).cardName || item.sourceName || 'Creature'),
                      targetCreatureName: String(validTarget?.name || ''),
                    };
                  } else if (isAddCounterActivation) {
                    const targetPermanentId = String(persistedTargets?.[0] || (e as any)?.counterParams?.targetId || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetPermanentId)
                      : null;
                    const counterParams = (e as any)?.counterParams || {};
                    (item as any).abilityType = 'add_counter';
                    (item as any).counterParams = {
                      targetId: targetPermanentId,
                      targetName: String(counterParams.targetName || validTarget?.name || ''),
                      counterType: String(counterParams.counterType || ''),
                      targetControllerRule: counterParams.targetControllerRule || 'any',
                      oracleText: String(counterParams.oracleText || activatedAbilityText || ''),
                      scalingText: counterParams.scalingText ? String(counterParams.scalingText) : null,
                    };
                  } else if (isLevelUpActivation) {
                    (item as any).abilityType = 'level_up';
                    (item as any).levelUpParams = {
                      amount: Number((e as any)?.levelUpParams?.amount || 1),
                    };
                  } else if (isOutlastActivation) {
                    (item as any).abilityType = 'outlast';
                    (item as any).outlastParams = {
                      amount: Number((e as any)?.outlastParams?.amount || 1),
                      counterType: String((e as any)?.outlastParams?.counterType || '+1/+1'),
                    };
                  } else if (isMonstrosityActivation) {
                    (item as any).abilityType = 'monstrosity';
                    (item as any).monstrosityParams = {
                      amount: Number((e as any)?.monstrosityParams?.amount || 0),
                    };
                  } else if (isAdaptActivation) {
                    (item as any).abilityType = 'adapt';
                    (item as any).adaptParams = {
                      amount: Number((e as any)?.adaptParams?.amount || 0),
                    };
                  } else if (isReconfigureAttachActivation) {
                    const targetCreatureId = String(persistedTargets?.[0] || '');
                    const validTarget = retargetValidTargets
                      ? retargetValidTargets.find((target: any) => String(target?.id || '') === targetCreatureId)
                      : null;
                    (item as any).abilityType = 'reconfigure_attach';
                    (item as any).reconfigureParams = {
                      reconfigureId: String(permId || ''),
                      targetCreatureId,
                      reconfigureName: String((e as any).cardName || item.sourceName || 'Equipment'),
                      targetCreatureName: String(validTarget?.name || ''),
                    };
                  }
                  break;
                }
              }
            }
          } catch {
            // best-effort only
          }

          // Intervening-if support: if we persisted deterministic Treasure spend metadata for this activation,
          // attach it to the matching ability stack item when present.
          try {
            const known = (e as any).manaFromTreasureSpentKnown === true && typeof (e as any).manaFromTreasureSpent === 'boolean';
            if (known) {
              const stack = Array.isArray((stateAny as any).stack) ? (stateAny as any).stack : (Array.isArray(ctx.state.stack) ? ctx.state.stack : []);
              if (Array.isArray(stack) && stack.length > 0) {
                for (let i = stack.length - 1; i >= 0; i--) {
                  const item = stack[i];
                  if (!item || String(item.type || '') !== 'ability') continue;
                  if (playerId != null && String(item.controller) !== String(playerId)) continue;
                  if (permId != null && String(item.source) !== String(permId)) continue;
                  if (abilityText && String(item.description || '') !== abilityText) continue;
                  (item as any).manaFromTreasureSpentKnown = true;
                  (item as any).manaFromTreasureSpent = Boolean((e as any).manaFromTreasureSpent);
                  break;
                }
              }
            }
          } catch {
            // best-effort only
          }

          // Fail closed for non-stack activations lacking reconstructible effect evidence:
          // costs/stack evidence above still apply; we do not invent the ability's effect body.
          try {
            const usesStackFlag = (e as any).usesStack === true;
            const abilityTypeFlag = String((e as any).abilityType || '').trim();
            const hasEffectPayload =
              Boolean(Array.isArray((e as any).counterUpdates) && (e as any).counterUpdates.length > 0) ||
              Boolean((e as any).specialAnimation && typeof (e as any).specialAnimation === 'object') ||
              Boolean((e as any).hideawayMovedCardToHand && typeof (e as any).hideawayMovedCardToHand === 'object') ||
              Boolean((e as any).queuedResolutionStep && typeof (e as any).queuedResolutionStep === 'object') ||
              Boolean(abilityTypeFlag) ||
              Boolean(String((e as any).stackItemId || '').trim()) ||
              usesStackFlag;
            const looksLikeManaAbilityText =
              /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(String((e as any).abilityText || '')) &&
              !/target/i.test(String((e as any).abilityText || ''));
            if ((e as any).usesStack === false && !hasEffectPayload && !looksLikeManaAbilityText) {
              debugWarn(
                1,
                'applyEvent(activateBattlefieldAbility): non-stack activation lacks reconstructible effect payload; applied costs/evidence only',
                {
                  permanentId: (e as any).permanentId,
                  abilityId: (e as any).abilityId,
                  cardName: (e as any).cardName,
                },
              );
            }
          } catch {
            // ignore diagnostics failures
          }

          // Detect mana ability (mirrors socket-side checks): produces mana and doesn't target.
          const isManaAbility =
            /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(abilityText) &&
            !/target/i.test(abilityText);

          if (!isManaAbility) break;

          const playerKey = playerId != null ? String(playerId) : '';
          const permKey = permId != null ? String(permId) : '';
          const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
          if (playerKey && permKey) {
            stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
            stateAny.addedManaWithThisAbilityThisTurn[playerKey] = stateAny.addedManaWithThisAbilityThisTurn[playerKey] || {};
            const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
            (stateAny.addedManaWithThisAbilityThisTurn[playerKey] as any)[k] = true;
          }

          try {
            if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
          } catch {}
        } catch (err) {
          debugWarn(1, 'applyEvent(activateBattlefieldAbility): failed', err);
        }
        break;
      }

      case "activateSacrificeDrawAbility": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const manaCost = String((e as any).manaCost || '').trim();
          if (!playerId || !permanentId) break;

          const stateAny = ctx.state as any;
          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permIndex = battlefield.findIndex((perm: any) => perm && String(perm.id || '') === permanentId);
          if (permIndex === -1) break;

          const zones = stateAny.zones = stateAny.zones || {};
          const zoneState = zones[playerId] = zones[playerId] || {
            hand: [],
            handCount: 0,
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
          };

          if (manaCost) {
            stateAny.manaPool = stateAny.manaPool || {};
            stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
              white: 0,
              blue: 0,
              black: 0,
              red: 0,
              green: 0,
              colorless: 0,
            };
            consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);
          }

          movePermanentToGraveyard(ctx as any, permanentId, true);

          const libraries = (ctx as any).libraries;
          const mapLibrary = libraries && typeof libraries.get === 'function' ? libraries.get(playerId) : undefined;
          const zoneLibrary = Array.isArray(zoneState.library) ? zoneState.library : undefined;
          const activeLibrary = Array.isArray(zoneLibrary) ? zoneLibrary : (Array.isArray(mapLibrary) ? mapLibrary : []);
          if (activeLibrary.length > 0) {
            const drawnCard = activeLibrary.shift();
            zoneState.hand = Array.isArray(zoneState.hand) ? zoneState.hand : [];
            (zoneState.hand as any[]).push({ ...drawnCard, zone: 'hand' });
            zoneState.handCount = (zoneState.hand as any[]).length;
          }
          zoneState.libraryCount = activeLibrary.length;
          if (Array.isArray(zoneLibrary)) {
            zoneState.library = activeLibrary;
          }
          if (libraries && typeof libraries.set === 'function') {
            libraries.set(playerId, activeLibrary);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateSacrificeDrawAbility): failed', err);
        }
        break;
      }

      case "activateDoublingCube": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          if (!playerId || !permanentId) break;

          const stateAny = ctx.state as any;
          stateAny.manaPool = stateAny.manaPool || {};
          const manaPool = stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
          };

          let remaining = 3;
          const poolCopy = {
            white: Number(manaPool.white || 0),
            blue: Number(manaPool.blue || 0),
            black: Number(manaPool.black || 0),
            red: Number(manaPool.red || 0),
            green: Number(manaPool.green || 0),
            colorless: Number(manaPool.colorless || 0),
          };

          const colorlessUsed = Math.min(remaining, poolCopy.colorless);
          poolCopy.colorless -= colorlessUsed;
          remaining -= colorlessUsed;

          if (remaining > 0) {
            const colors: Array<'white' | 'blue' | 'black' | 'red' | 'green'> = ['white', 'blue', 'black', 'red', 'green'];
            for (const color of colors) {
              if (remaining <= 0) break;
              const used = Math.min(remaining, poolCopy[color]);
              poolCopy[color] -= used;
              remaining -= used;
            }
          }

          stateAny.manaPool[playerId] = {
            white: poolCopy.white * 2,
            blue: poolCopy.blue * 2,
            black: poolCopy.black * 2,
            red: poolCopy.red * 2,
            green: poolCopy.green * 2,
            colorless: poolCopy.colorless * 2,
          };

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);
          if (permanent) {
            (permanent as any).tapped = true;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateDoublingCube): failed', err);
        }
        break;
      }

      case "activateUpgradeAbility": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const upgradeIndexRaw = Number((e as any).upgradeIndex ?? 0);
          const upgradeIndex = Number.isFinite(upgradeIndexRaw) && upgradeIndexRaw >= 0 ? Math.floor(upgradeIndexRaw) : 0;
          if (!playerId || !permanentId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);
          if (!permanent) break;

          const oracleText = String((permanent as any)?.card?.oracle_text || '');
          const cardName = String((permanent as any)?.card?.name || (e as any).cardName || '');
          const parsedUpgrades = parseCreatureUpgradeAbilities(oracleText, cardName);
          const upgrade = parsedUpgrades[upgradeIndex] || parsedUpgrades[0];
          if (!upgrade) break;

          const stateAny = ctx.state as any;
          stateAny.manaPool = stateAny.manaPool || {};
          stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
          };
          consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], String(upgrade.cost || '').trim());

          stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
          const stackId = generateDeterministicId(ctx, 'ability_upgrade', `${permanentId}:${upgradeIndex}`);
          const stackAlreadyPresent = stateAny.stack.some((item: any) => item && String(item.id || '') === stackId);
          if (!stackAlreadyPresent) {
            stateAny.stack.push({
              id: stackId,
              type: 'ability',
              controller: playerId,
              source: permanentId,
              sourceName: cardName,
              description: upgrade.fullText,
              abilityType: 'creature-upgrade',
              upgradeData: {
                newTypes: upgrade.newTypes,
                newPower: upgrade.newPower,
                newToughness: upgrade.newToughness,
                keywords: upgrade.keywords,
                counterCount: upgrade.counterCount,
                counterType: upgrade.counterType,
              },
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateUpgradeAbility): failed', err);
        }
        break;
      }

      case "activateTutorAbility": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const abilityId = String((e as any).abilityId || '').trim();
          if (!playerId || !permanentId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);
          if (!permanent) break;

          const card = (permanent as any)?.card || {};
          const oracleText = String(card.oracle_text || '');
          const cardName = String(card.name || (e as any).cardName || '');
          const scopedActivatedAbility = getActivatedAbilityScopeText(oracleText.toLowerCase(), abilityId);
          const scopedAbilityText = String(scopedActivatedAbility.abilityText || '').trim();
          const scopedAbilityFullText = String(scopedActivatedAbility.fullAbilityText || scopedAbilityText || oracleText || '').trim();
          const tutorInfo = detectTutorEffect(scopedAbilityText || scopedAbilityFullText || oracleText);
          if (!tutorInfo.isTutor) break;

          const { requiresTap, manaCost, sacrificesSource } = extractReplayActivationCost(scopedAbilityFullText);
          const stateAny = ctx.state as any;
          stateAny.manaPool = stateAny.manaPool || {};
          stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
          };
          consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);

          if (sacrificesSource) {
            const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
              ? { ...(permanent.card || {}), zone: 'graveyard' }
              : null;
            const graveyardOwnerId = String(permanent?.owner || permanent?.controller || playerId || '').trim();
            movePermanentToGraveyard(ctx as any, permanentId, true);

            if (tokenGraveyardSnapshot && graveyardOwnerId) {
              const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
              const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              });
              playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

              const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                if (!card) return false;
                const cardId = String((card as any).id || '').trim();
                const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                if (cardId && snapshotId) return cardId === snapshotId;
                return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
              });

              if (!alreadyPresent) {
                (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
              }
            }
          } else if (requiresTap) {
            (permanent as any).tapped = true;
          }

          const filter = parseSearchCriteria(String(tutorInfo.searchCriteria || ''));
          const isSplit = tutorInfo.splitDestination === true;
          const destination = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped')
            ? 'battlefield'
            : (tutorInfo.destination === 'exile')
              ? 'exile'
              : 'hand';

          stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
          const stackId = String((e as any).stackId || '').trim() || generateDeterministicId(ctx, 'ability_tutor', `${permanentId}:${abilityId}`);
          const stackAlreadyPresent = stateAny.stack.some((item: any) => item && String(item.id || '') === stackId);
          if (!stackAlreadyPresent) {
            stateAny.stack.push({
              id: stackId,
              type: 'ability',
              controller: playerId,
              source: permanentId,
              sourceName: cardName,
              description: scopedAbilityText || scopedAbilityFullText,
              activatedAbilityText: scopedAbilityFullText || scopedAbilityText,
              abilityType: 'tutor',
              searchParams: {
                filter,
                searchCriteria: tutorInfo.searchCriteria,
                maxSelections: tutorInfo.maxSelections || 1,
                destination: tutorInfo.destination || 'hand',
                entersTapped: tutorInfo.entersTapped,
                splitDestination: tutorInfo.splitDestination,
                toBattlefield: tutorInfo.toBattlefield,
                toHand: tutorInfo.toHand,
              },
            });
          }

          const queue = ResolutionQueueManager.getQueue(ctx.gameId);
          const queueAlreadyPresent = queue.steps.some((step: any) =>
            step &&
            String((step as any).type || '') === String(ResolutionStepType.LIBRARY_SEARCH) &&
            String((step as any).playerId || '') === playerId &&
            String((step as any).sourceName || '') === cardName &&
            String((step as any).searchCriteria || '') === String(tutorInfo.searchCriteria || 'any card')
          );
          if (!queueAlreadyPresent) {
            ResolutionQueueManager.addStep(ctx.gameId, {
              type: ResolutionStepType.LIBRARY_SEARCH,
              playerId: playerId as any,
              sourceName: cardName,
              description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
              searchCriteria: tutorInfo.searchCriteria || 'any card',
              minSelections: 0,
              maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
              mandatory: false,
              destination,
              reveal: false,
              shuffleAfter: true,
              availableCards: filterLibraryCardsForSearch(snapshotLibraryForReplay(ctx, playerId), filter, (ctx as any).state, playerId),
              filter,
              splitDestination: isSplit,
              toBattlefield: tutorInfo.toBattlefield || 1,
              toHand: tutorInfo.toHand || 1,
              entersTapped: tutorInfo.entersTapped || false,
            } as any);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateTutorAbility): failed', err);
        }
        break;
      }

      case "activatePlaneswalkerAbility": {
        // Planeswalker ability: adjust loyalty counters
        const permId = (e as any).permanentId;
        const loyaltyCost = (e as any).loyaltyCost || 0;
        const abilityIndex = (e as any).abilityIndex;
        const playerId = String((e as any).playerId || '').trim();
        try {
          if (permId) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              // Match live activation semantics (no Doubling Season on cost apply here);
              // skipEventPersistence because this parent event already records the change.
              if (loyaltyCost) {
                updateCounters(ctx as any, String(permId), { loyalty: Number(loyaltyCost) || 0 }, {
                  skipEventPersistence: true,
                  skipCounterModifications: true,
                });
              }

              const parsed = parsePlaneswalkerAbilities((perm as any).card, perm);
              const loyaltyAbility = Number.isFinite(Number(abilityIndex))
                ? parsed?.abilities?.[Number(abilityIndex)]
                : undefined;
              const persistedAbilityText = String((e as any).abilityText || '').trim();
              const persistedActivatedAbilityText = String((e as any).activatedAbilityText || '').trim();
              const persistedStackItemId = String((e as any).stackItemId || '').trim();

              const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : ((ctx.state as any).stack = []);
              const existing = stack.find((item: any) =>
                item &&
                String(item.type || '') === 'ability' &&
                (
                  (persistedStackItemId && String(item.id || '') === persistedStackItemId) ||
                  (
                    String((item as any).source || '') === String(permId) &&
                    String((item as any).controller || '') === playerId &&
                    Number((item as any)?.planeswalker?.abilityIndex ?? -1) === Number(abilityIndex)
                  )
                )
              );

              if (!existing && loyaltyAbility) {
                stack.push({
                  id: persistedStackItemId || generateDeterministicId(ctx, 'ability_planeswalker', `${String(permId)}:${String(abilityIndex)}`),
                  type: 'ability',
                  controller: playerId || String((perm as any).controller || ''),
                  source: String(permId),
                  sourceName: String((perm as any)?.card?.name || 'Planeswalker'),
                  description: persistedAbilityText || String((loyaltyAbility as any).effect || ''),
                  activatedAbilityText: persistedActivatedAbilityText || `${String((loyaltyAbility as any).costDisplay || loyaltyCost)}: ${String((loyaltyAbility as any).effect || '')}`,
                  planeswalker: {
                    oracleId: (perm as any)?.card?.oracle_id,
                    abilityIndex: Number(abilityIndex),
                    loyaltyCost: Number(loyaltyCost),
                  },
                });
              }
            }
          }

          try {
            const persistedTargets = Array.isArray((e as any).targets) ? (e as any).targets : null;
            const retargetValidTargets = Array.isArray((e as any).copyRetargetValidTargets) ? (e as any).copyRetargetValidTargets : null;
            const retargetTargetTypes = Array.isArray((e as any).copyRetargetTargetTypes) ? (e as any).copyRetargetTargetTypes : null;
            const retargetMinTargets = Number((e as any).copyRetargetMinTargets ?? NaN);
            const retargetMaxTargets = Number((e as any).copyRetargetMaxTargets ?? NaN);
            const retargetTargetDescription = String((e as any).copyRetargetTargetDescription || '');
            const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
            if (Array.isArray(stack) && stack.length > 0) {
              for (let i = stack.length - 1; i >= 0; i--) {
                const item = stack[i];
                if (!item || String(item.type || '') !== 'ability') continue;
                if (permId != null && String((item as any).source || '') !== String(permId)) continue;
                if (abilityIndex != null && Number((item as any)?.planeswalker?.abilityIndex ?? -1) !== Number(abilityIndex)) continue;
                if (persistedTargets) {
                  (item as any).targets = persistedTargets.map((id: any) => String(id));
                }
                if (retargetValidTargets) {
                  (item as any).copyRetargetValidTargets = retargetValidTargets.map((target: any) => ({ ...target }));
                  (item as any).copyRetargetTargetTypes = retargetTargetTypes ? [...retargetTargetTypes] : [];
                  if (Number.isFinite(retargetMinTargets)) (item as any).copyRetargetMinTargets = retargetMinTargets;
                  if (Number.isFinite(retargetMaxTargets)) (item as any).copyRetargetMaxTargets = retargetMaxTargets;
                  if (retargetTargetDescription) (item as any).copyRetargetTargetDescription = retargetTargetDescription;
                }
                break;
              }
            }
          } catch {
            // best-effort only
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activatePlaneswalkerAbility): failed", err);
        }
        break;
      }

      case "activateGraveyardAbility": {
        // Graveyard ability (flashback, unearth, etc.)
        // The specific effect depends on the ability, but typically moves the card
        const cardId = (e as any).cardId;
        const pid = (e as any).playerId;
        const abilityType = (e as any).abilityType ?? (e as any).abilityId;
        try {
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const replayGameId = String((ctx as any).gameId || '').trim();
          const queuedStepType = String((rawQueuedStep as any)?.type || '').trim();
          if (replayGameId && rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) && queuedStepType) {
            try {
              const discardedForCost = Array.isArray((rawQueuedStep as any)?.discardedCardIdsForCost)
                ? ((rawQueuedStep as any).discardedCardIdsForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const exiledFromHandForCost = Array.isArray((rawQueuedStep as any)?.exiledCardIdsFromHandForCost)
                ? ((rawQueuedStep as any).exiledCardIdsFromHandForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const zones = ctx.state.zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.hand)) {
                if (discardedForCost.length > 0) {
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
                  for (const discardId of discardedForCost) {
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === discardId);
                    if (handIndex === -1) continue;
                    const [discardedCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.graveyard as any[]).push({
                      ...discardedCard,
                      zone: 'graveyard',
                      ...buildDiscardProvenanceFields(ctx.state, String(pid)),
                    });
                  }
                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                }
                if (exiledFromHandForCost.length > 0) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];
                  for (const exileId of exiledFromHandForCost) {
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === exileId);
                    if (handIndex === -1) continue;
                    const [exiledCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.exile as any[]).push({ ...exiledCard, zone: 'exile' });
                  }
                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;

                  const stateAny = ctx.state as any;
                  stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                  stateAny.discardedCardThisTurn[String(pid)] = true;
                  stateAny.anyPlayerDiscardedCardThisTurn = true;
                }
              }
            } catch {
              // best-effort only
            }

            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            const queuedStepId = String((rawQueuedStep as any)?.id || '').trim();
            const alreadyPresent = Boolean(
              (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
              (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
            );

            if (!alreadyPresent) {
              ResolutionQueueManager.addStep(replayGameId, {
                ...(rawQueuedStep as any),
                ...(queuedStepId ? { id: queuedStepId } : {}),
                type: queuedStepType as any,
                playerId: String((rawQueuedStep as any).playerId || pid || '') as any,
                description: String((rawQueuedStep as any).description || ''),
                mandatory: (rawQueuedStep as any).mandatory !== false,
              } as any);
            }

            ctx.bumpSeq();
            break;
          }

          if (cardId && pid && ['flashback', 'jump-start', 'retrace', 'escape', 'graveyard-cast'].includes(String(abilityType))) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              try {
                const discarded = (e as any).discardedCardIds;
                if (Array.isArray(discarded) && discarded.length > 0 && Array.isArray(z.hand)) {
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];

                  for (const cid of discarded) {
                    const discardId = String(cid || '').trim();
                    if (!discardId) continue;
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === discardId);
                    if (handIndex === -1) continue;
                    const [discardedCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.graveyard as any[]).push({
                      ...discardedCard,
                      zone: 'graveyard',
                      ...buildDiscardProvenanceFields(ctx.state, String(pid)),
                    });
                  }

                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;

                  const stateAny = ctx.state as any;
                  stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                  stateAny.discardedCardThisTurn[String(pid)] = true;
                  stateAny.anyPlayerDiscardedCardThisTurn = true;
                }
              } catch {
                // best-effort only
              }

              try {
                const exiledFromHand = (e as any).exiledCardIdsFromHandForCost;
                if (Array.isArray(exiledFromHand) && exiledFromHand.length > 0 && Array.isArray(z.hand)) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];

                  for (const cid of exiledFromHand) {
                    const exileId = String(cid || '').trim();
                    if (!exileId) continue;
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === exileId);
                    if (handIndex === -1) continue;
                    const [exiledCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.exile as any[]).push({ ...exiledCard, zone: 'exile' });
                  }

                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;

                  const stateAny = ctx.state as any;
                  stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                  stateAny.discardedCardThisTurn[String(pid)] = true;
                  stateAny.anyPlayerDiscardedCardThisTurn = true;
                }
              } catch {
                // best-effort only
              }

              try {
                const exiledFromGraveyard = (e as any).exiledCardIdsFromGraveyardForCost;
                if (Array.isArray(exiledFromGraveyard) && exiledFromGraveyard.length > 0) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];

                  for (const cid of exiledFromGraveyard) {
                    const exileId = String(cid || '').trim();
                    if (!exileId) continue;
                    const graveyardIndex = (z.graveyard as any[]).findIndex((entry: any) => entry && String(entry.id) === exileId);
                    if (graveyardIndex === -1) continue;
                    const [exiledCard] = (z.graveyard as any[]).splice(graveyardIndex, 1);
                    (z.exile as any[]).push({ ...exiledCard, zone: 'exile' });
                  }

                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;
                }
              } catch {
                // best-effort only
              }

              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                // Turn-tracking for intervening-if: a card left your graveyard this turn.
                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }

                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                const stackId = String((e as any).stackId || '').trim() || generateDeterministicId(ctx, 'stack', String(cardId));
                const recordedTargets = Array.isArray((e as any).targets)
                  ? ((e as any).targets as any[]).map((targetId: any) => String(targetId || '').trim()).filter(Boolean)
                  : [];
                const alternateCostId = String((e as any).alternateCostId || '').trim() || undefined;
                const graveyardPermissionId = String((e as any).graveyardPermissionId || '').trim() || undefined;
                const graveyardPermissionSourceName = String((e as any).graveyardPermissionSourceName || '').trim() || undefined;
                const graveyardPermissionCostMode = String((e as any).graveyardPermissionCostMode || '').trim() || undefined;
                const xValue = Number.isFinite(Number((e as any).xValue))
                  ? Math.max(0, Math.floor(Number((e as any).xValue)))
                  : undefined;
                ctx.state.stack = ctx.state.stack || [];
                const graveyardCastCard = {
                  ...buildCastFromGraveyardCard(card, String(abilityType)),
                  castFromGraveyard: true,
                  castSourceZone: 'graveyard',
                  fromZone: 'graveyard',
                  ...(alternateCostId ? { alternateCostId } : {}),
                  ...((e as any).castWithoutPayingManaCost === true ? { castWithoutPayingManaCost: true } : {}),
                  ...(xValue !== undefined ? { xValue } : {}),
                  ...(graveyardPermissionId ? { graveyardPermissionId } : {}),
                  ...(graveyardPermissionSourceName ? { graveyardPermissionSourceName } : {}),
                  ...(graveyardPermissionCostMode ? { graveyardPermissionCostMode } : {}),
                };
                (ctx.state.stack as any[]).push({
                  id: stackId,
                  controller: pid,
                  card: graveyardCastCard,
                  ...(manaCost ? { manaCost } : {}),
                  castFromGraveyard: true,
                  castSourceZone: 'graveyard',
                  fromZone: 'graveyard',
                  ...(alternateCostId ? { alternateCostId } : {}),
                  ...((e as any).castWithoutPayingManaCost === true ? { castWithoutPayingManaCost: true } : {}),
                  ...(xValue !== undefined ? { xValue } : {}),
                  ...(graveyardPermissionId ? { graveyardPermissionId } : {}),
                  ...(graveyardPermissionSourceName ? { graveyardPermissionSourceName } : {}),
                  ...(graveyardPermissionCostMode ? { graveyardPermissionCostMode } : {}),
                  targets: recordedTargets,
                  ...(graveyardCastCard?.entersBattlefieldWithCounters && typeof graveyardCastCard.entersBattlefieldWithCounters === 'object'
                    ? { entersBattlefieldWithCounters: { ...(graveyardCastCard.entersBattlefieldWithCounters as Record<string, number>) } }
                    : {}),
                });

                const stateAny = ctx.state as any;
                stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
                stateAny.castFromGraveyardThisTurn[String(pid)] = true;
                recordGraveyardPermanentTypesCastThisTurn(stateAny, String(pid), card);
                stateAny.spellsCastThisTurn = Array.isArray(stateAny.spellsCastThisTurn) ? stateAny.spellsCastThisTurn : [];
                stateAny.spellsCastThisTurn.push({
                  id: card?.id || cardId,
                  name: card?.name,
                  casterId: pid,
                  castSourceZone: 'graveyard',
                  card: {
                    id: card?.id || cardId,
                    name: card?.name,
                    type_line: card?.type_line,
                    colors: card?.colors,
                    color_identity: card?.color_identity,
                    castSourceZone: 'graveyard',
                  },
                });
                if (!String(card?.type_line || '').toLowerCase().includes('creature')) {
                  stateAny.noncreatureSpellsCastThisTurn = stateAny.noncreatureSpellsCastThisTurn || {};
                  stateAny.noncreatureSpellsCastThisTurn[String(pid)] =
                    ((stateAny.noncreatureSpellsCastThisTurn[String(pid)] as number | undefined) || 0) + 1;
                }
              }
            }
          } else if (cardId && pid && abilityType === 'unearth') {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                  ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                  : [];
                const stateAny = ctx.state as any;
                const currentTurn = Number(stateAny?.turnNumber ?? stateAny?.turn ?? 0) || 0;
                const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
                const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
                const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
                const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

                ctx.state.battlefield = ctx.state.battlefield || [];
                const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(cardId));
                (ctx.state.battlefield as any[]).push({
                  id: createdPermanentId,
                  controller: pid,
                  owner: pid,
                  tapped: false,
                  wasUnearthed: true,
                  unearthed: true,
                  counters: {},
                  leaveBattlefieldReplacementDestination: 'exile',
                  leaveBattlefieldReplacementSourceName: String(card?.name || 'Unearth'),
                  card: {
                    ...card,
                    zone: 'battlefield',
                    unearth: true,
                    wasUnearthed: true,
                    leaveBattlefieldReplacementDestination: 'exile',
                    leaveBattlefieldReplacementSourceName: String(card?.name || 'Unearth'),
                  },
                });
                stateAny.pendingExileAtNextEndStep = Array.isArray(stateAny.pendingExileAtNextEndStep)
                  ? stateAny.pendingExileAtNextEndStep
                  : [];
                const pendingExileAtNextEndStep = stateAny.pendingExileAtNextEndStep as any[];
                if (!pendingExileAtNextEndStep.some((entry: any) => String(entry?.permanentId || '') === String(createdPermanentId))) {
                  pendingExileAtNextEndStep.push({
                    permanentId: createdPermanentId,
                    fireAtTurnNumber,
                    sourceName: String(card?.name || 'Unearth'),
                    createdBy: pid,
                  });
                }
              }
            }
          } else if (cardId && pid && (abilityType === 'embalm' || abilityType === 'eternalize')) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;

                const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                  ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                  : [];
                ctx.state.battlefield = ctx.state.battlefield || [];
                const createdPermanentId = createdPermanentIds.shift()
                  || generateDeterministicId(ctx, abilityType === 'eternalize' ? 'token_eternalize' : 'token_embalm', String(cardId));
                (ctx.state.battlefield as any[]).push(
                  buildEmbalmOrEternalizeTokenPermanent(card, abilityType as 'embalm' | 'eternalize', String(pid), createdPermanentId),
                );
              }
            }
          } else if (cardId && pid && abilityType === 'disturb') {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                const stateAny = ctx.state as any;
                stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
                stateAny.castFromGraveyardThisTurn[String(pid)] = true;
                const disturbSpellCard = buildDisturbCastCard(card);
                recordGraveyardPermanentTypesCastThisTurn(stateAny, String(pid), disturbSpellCard);
                stateAny.spellsCastThisTurn = Array.isArray(stateAny.spellsCastThisTurn) ? stateAny.spellsCastThisTurn : [];
                stateAny.spellsCastThisTurn.push({
                  id: disturbSpellCard?.id || cardId,
                  name: disturbSpellCard?.name,
                  casterId: pid,
                  castSourceZone: 'graveyard',
                  card: {
                    id: disturbSpellCard?.id || cardId,
                    name: disturbSpellCard?.name,
                    type_line: disturbSpellCard?.type_line,
                    colors: disturbSpellCard?.colors,
                    color_identity: card?.color_identity,
                    castSourceZone: 'graveyard',
                  },
                });
                if (!String(disturbSpellCard?.type_line || '').toLowerCase().includes('creature')) {
                  stateAny.noncreatureSpellsCastThisTurn = stateAny.noncreatureSpellsCastThisTurn || {};
                  stateAny.noncreatureSpellsCastThisTurn[String(pid)] =
                    ((stateAny.noncreatureSpellsCastThisTurn[String(pid)] as number | undefined) || 0) + 1;
                }

                const stackId = String((e as any).stackId || '').trim() || generateDeterministicId(ctx, 'stack', String(cardId));
                const recordedTargets = Array.isArray((e as any).targets)
                  ? ((e as any).targets as any[]).map((targetId: any) => String(targetId || '').trim()).filter(Boolean)
                  : [];
                ctx.state.stack = ctx.state.stack || [];
                (ctx.state.stack as any[]).push({
                  id: stackId,
                  controller: pid,
                  card: disturbSpellCard,
                  targets: recordedTargets,
                });
              }
            }
          } else if (cardId && pid && (abilityType === 'scavenge' || abilityType === 'encore')) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;

                if (abilityType === 'encore') {
                  const stateAny = ctx.state as any;
                  const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                    ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                    : [];
                  const players = Array.isArray(stateAny?.players) ? stateAny.players : [];
                  const encoreTargetPlayerIds = Array.isArray((e as any).encoreTargetPlayerIds)
                    ? (e as any).encoreTargetPlayerIds.map((value: any) => String(value))
                    : players
                        .filter((player: any) => player?.id && String(player.id) !== String(pid) && !player.hasLost)
                        .map((player: any) => String(player.id));
                  const currentTurn = Number(stateAny?.turnNumber ?? stateAny?.turn ?? 0) || 0;
                  const currentPhase = String(stateAny?.phase ?? '').toLowerCase();
                  const currentStepUpper = String(stateAny?.step ?? '').toUpperCase();
                  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
                  const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

                  ctx.state.battlefield = ctx.state.battlefield || [];
                  stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
                    ? stateAny.pendingSacrificeAtNextEndStep
                    : [];

                  const existingKeywords = Array.isArray(card?.keywords) ? [...card.keywords] : [];
                  if (!existingKeywords.some((ability: string) => String(ability).toLowerCase() === 'haste')) {
                    existingKeywords.push('Haste');
                  }
                  const power = Number.parseInt(String(card?.power ?? ''), 10);
                  const toughness = Number.parseInt(String(card?.toughness ?? ''), 10);
                  const oracleText = String(card?.oracle_text || '');
                  const oracleWithHaste = /(^|\n)haste(\n|$)/i.test(oracleText)
                    ? oracleText
                    : `${oracleText}${oracleText ? '\n' : ''}Haste`;

                  for (const targetPlayerId of encoreTargetPlayerIds) {
                    const tokenId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'token_encore', `${String(cardId)}:${String(targetPlayerId)}`);
                    (ctx.state.battlefield as any[]).push({
                      id: tokenId,
                      controller: pid,
                      owner: pid,
                      tapped: false,
                      counters: {},
                      summoningSickness: false,
                      isToken: true,
                      mustAttack: true,
                      encoreAttackPlayerId: String(targetPlayerId),
                      copiedFromCardId: String(card?.id || ''),
                      ...(Number.isFinite(power) ? { basePower: power } : {}),
                      ...(Number.isFinite(toughness) ? { baseToughness: toughness } : {}),
                      grantedAbilities: existingKeywords,
                      card: {
                        ...card,
                        id: tokenId,
                        zone: 'battlefield',
                        oracle_text: oracleWithHaste,
                        keywords: existingKeywords,
                      },
                    });
                    stateAny.pendingSacrificeAtNextEndStep.push({
                      permanentId: tokenId,
                      fireAtTurnNumber,
                      maxManaValue: 0,
                      sourceName: String(card?.name || 'Encore'),
                      createdBy: pid,
                    });
                  }
                }
              }
            }
          } else if (cardId && pid && abilityType === 'exile-to-add-counters') {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.graveyard)) {
              const graveyard = z.graveyard as any[];
              const idx = graveyard.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = graveyard.splice(idx, 1);
                z.graveyardCount = graveyard.length;

                recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                const manaCost = String((e as any).manaCost || '').trim();
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                z.exile = z.exile || [];
                (z.exile as any[]).push({ ...card, zone: 'exile' });
                z.exileCount = (z.exile as any[]).length;

                const creatureType = String((e as any).creatureType || '').trim().toLowerCase();
                if (creatureType) {
                  const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
                  const creatureTypePattern = new RegExp(`\\b${creatureType}s?\\b`, 'i');
                  for (const perm of battlefield as any[]) {
                    if (!perm || String(perm.controller) !== String(pid)) continue;
                    const typeLine = String(perm.card?.type_line || '').toLowerCase();
                    if (!typeLine.includes('creature') || !creatureTypePattern.test(typeLine)) continue;
                    const counters = ((perm as any).counters || {}) as Record<string, number>;
                    counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
                    (perm as any).counters = counters;
                  }
                }
              }
            }
          } else if (cardId && pid && (e as any).isTutor === true) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            const gameId = (ctx as any).gameId;
            if (z && Array.isArray(z.graveyard) && gameId) {
              const graveyard = z.graveyard as any[];
              const card = graveyard.find((c: any) => c && String(c.id) === String(cardId));
              if (card) {
                const manaCost = String((e as any).manaCost || '').trim();
                  const exileSourceOnActivate = (e as any).exileSourceOnActivate === true;
                const manaPool = (ctx.state as any).manaPool?.[pid];
                if (manaPool && manaCost) {
                  consumeRecordedManaCostFromPool(manaPool, manaCost);
                }
                applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                  if (exileSourceOnActivate) {
                    const cardIndex = graveyard.findIndex((entry: any) => entry && String(entry.id) === String(cardId));
                    if (cardIndex !== -1) {
                      const [movedCard] = graveyard.splice(cardIndex, 1);
                      z.graveyardCount = graveyard.length;
                      z.exile = Array.isArray((z as any).exile) ? (z as any).exile : [];
                      z.exile.push({ ...movedCard, zone: 'exile' });
                      z.exileCount = z.exile.length;
                      recordCardLeftGraveyardThisTurn(ctx as any, String(pid), movedCard);
                    }
                  }

                const destination = String((e as any).destination || 'hand');
                const searchCriteria = String((e as any).searchCriteria || 'any card');
                const maxSelectionsRaw = Number((e as any).maxSelections);
                const maxSelections = Number.isFinite(maxSelectionsRaw) ? maxSelectionsRaw : 1;
                const filter = ((e as any).filter && typeof (e as any).filter === 'object') ? { ...((e as any).filter as any) } : {};
                const availableCards = filterLibraryCardsForSearch(
                  ctx.libraries.get(pid) || [],
                  filter,
                  ctx.state as any,
                  pid,
                );

                ResolutionQueueManager.addStep(gameId, {
                  type: 'library_search' as any,
                  playerId: pid,
                  sourceId: String(cardId),
                  sourceName: String(card?.name || 'Card'),
                  description: searchCriteria ? `Search for: ${searchCriteria}` : 'Search your library',
                  searchCriteria,
                  minSelections: 0,
                  maxSelections,
                  mandatory: false,
                  destination,
                  reveal: false,
                  shuffleAfter: true,
                  availableCards,
                  filter,
                  splitDestination: (e as any).splitDestination === true,
                  toBattlefield: Number((e as any).toBattlefield || 1),
                  toHand: Number((e as any).toHand || 1),
                  entersTapped: (e as any).entersTapped === true,
                  persistLibrarySearchResolve: true,
                  persistLibrarySearchResolveReason: 'graveyard_ability',
                  persistLibrarySearchResolveAbilityId: String(abilityType || ''),
                } as any);
              }
            }
          } else if (
            cardId &&
            pid &&
            (abilityType === 'return-from-graveyard' || abilityType === 'graveyard-activated' || String(abilityType || '').includes('-return-')) &&
            (e as any).isTutor !== true
          ) {
            const destination = String((e as any).destination || '');
            const manaCost = String((e as any).manaCost || '').trim();
            const tappedCreatureIds = Array.isArray((e as any).tappedCreatureIds)
              ? ((e as any).tappedCreatureIds as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (destination === 'hand' || destination === 'battlefield') {
              const zones = ctx.state.zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.graveyard)) {
                const graveyard = z.graveyard as any[];
                const idx = graveyard.findIndex((c: any) => c.id === cardId);
                if (idx !== -1) {
                  const [card] = graveyard.splice(idx, 1);
                  z.graveyardCount = graveyard.length;

                  recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);

                  const manaPool = (ctx.state as any).manaPool?.[pid];
                  if (manaPool && manaCost) {
                    consumeRecordedManaCostFromPool(manaPool, manaCost);
                  }
                  applyRecordedLifePayment(ctx, String(pid), (e as any).lifePaidForCost);

                  if (tappedCreatureIds.length > 0) {
                    const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
                    for (const permanentId of tappedCreatureIds) {
                      const permanent = battlefield.find((entry: any) => entry && String(entry.id) === String(permanentId));
                      if (permanent) {
                        (permanent as any).tapped = true;
                      }
                    }

                    const stateAny = ctx.state as any;
                    stateAny.tappedNonlandPermanentThisTurnByPlayer = stateAny.tappedNonlandPermanentThisTurnByPlayer || {};
                    stateAny.tappedNonlandPermanentThisTurnByPlayer[String(pid)] = true;
                  }

                  const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
                    ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                    : [];
                  if (destination === 'battlefield') {
                    ctx.state.battlefield = ctx.state.battlefield || [];
                    const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(cardId));
                    (ctx.state.battlefield as any[]).push({
                      id: createdPermanentId,
                      controller: pid,
                      owner: pid,
                      tapped: false,
                      counters: {},
                      card: { ...card, zone: 'battlefield' },
                    });
                  } else {
                    z.hand = z.hand || [];
                    (z.hand as any[]).push({ ...card, zone: 'hand' });
                    z.handCount = (z.hand as any[]).length;
                  }
                }
              }
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activateGraveyardAbility): failed", err);
        }
        break;
      }

      case "activateCycling": {
        const cardId = (e as any).cardId;
        const pid = (e as any).playerId;
        const cardName = String((e as any).cardName || 'Unknown');
        const cyclingCost = String((e as any).cyclingCost || '');
        const stackId = String((e as any).stackId || generateDeterministicId(ctx, 'ability_cycling', String(cardId || cardName || 'card')));
        const abilityId = String((e as any).abilityId || 'cycling');
        const stackAbilityType = String((e as any).stackAbilityType || ((e as any).searchCriteria ? 'typecycling' : 'cycling'));
        const stackDescription = String((e as any).stackDescription || (stackAbilityType === 'typecycling' ? 'Search your library' : 'Draw a card'));
        const searchCriteria = typeof (e as any).searchCriteria === 'string' ? String((e as any).searchCriteria) : undefined;
        const searchFilter = ((e as any).searchFilter && typeof (e as any).searchFilter === 'object')
          ? { ...((e as any).searchFilter as any) }
          : undefined;
        try {
          const zones = (ctx.state as any)?.zones?.[pid];
          if (zones && Array.isArray(zones.hand) && cardId) {
            const hand = zones.hand as any[];
            const handIndex = hand.findIndex((card: any) => String(card?.id) === String(cardId));
            if (handIndex !== -1) {
              const [card] = hand.splice(handIndex, 1);
              zones.graveyard = zones.graveyard || [];
              (zones.graveyard as any[]).push({ ...card, zone: 'graveyard' });
              zones.handCount = hand.length;
              zones.graveyardCount = (zones.graveyard as any[]).length;
              recordCardPutIntoGraveyardThisTurn(ctx as any, String(pid), card, { fromBattlefield: false });
            }
          }

          const manaPool = (ctx.state as any)?.manaPool?.[pid];
          if (manaPool && cyclingCost) {
            consumeRecordedManaCostFromPool(manaPool as Record<string, number>, cyclingCost);
          }

          const stateAny = ctx.state as any;
          stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
          const stackAlreadyPresent = stateAny.stack.some((item: any) => item && String(item.id) === stackId);
          if (!stackAlreadyPresent) {
            stateAny.stack.push({
              id: stackId,
              type: 'ability',
              controller: pid,
              source: cardId,
              sourceName: cardName,
              description: stackDescription,
              abilityType: stackAbilityType,
              abilityId,
              cardId,
              cardName,
              searchCriteria,
              searchFilter,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(activateCycling): failed', err);
        }
        break;
      }

      case "sacrificeUnlessPayChoice": {
        const pid = String((e as any).playerId || '').trim();
        const permId = String((e as any).permanentId || '').trim();
        const payMana = (e as any).payMana === true;
        const manaCost = String((e as any).manaCost || '').trim();

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).sacrificeUnlessPayChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!permId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permId)
              );
            });
          }

          if (!pid || !permId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permIndex = battlefield.findIndex((perm: any) => perm && String(perm.id || '') === permId);

          if (payMana) {
            try {
              const tapped = Array.isArray((e as any).tappedPermanents)
                ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
                : [];
              if (tapped.length > 0) {
                const tappedSet = new Set(tapped);
                for (const permanent of battlefield as any[]) {
                  if (permanent && tappedSet.has(String(permanent.id || ''))) {
                    (permanent as any).tapped = true;
                  }
                }
              }
            } catch {
              // best-effort only
            }

            const manaPool = (ctx.state as any).manaPool?.[pid];
            const manaDelta = (e as any).paymentManaDelta;
            if (manaPool && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
              for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
                const amount = Number(rawAmount || 0);
                if (!Number.isFinite(amount) || amount === 0) continue;
                manaPool[poolKey] = Number(manaPool[poolKey] || 0) + amount;
              }
            } else if (manaPool && manaCost) {
              consumeRecordedManaCostFromPool(manaPool, manaCost);
            }

            const sacrificedPaymentPermanents = Array.isArray((e as any).sacrificedPaymentPermanents)
              ? ((e as any).sacrificedPaymentPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (sacrificedPaymentPermanents.length > 0) {
              for (const permanentId of sacrificedPaymentPermanents) {
                const permanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === permanentId) as any;
                if (!permanent) continue;

                const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
                  ? { ...(permanent.card || {}), zone: 'graveyard' }
                  : null;
                const graveyardOwnerId = String(permanent?.owner || permanent?.controller || pid || '').trim();
                movePermanentToGraveyard(ctx as any, permanentId, true);

                if (tokenGraveyardSnapshot && graveyardOwnerId) {
                  const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
                  const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                    hand: [],
                    handCount: 0,
                    libraryCount: 0,
                    graveyard: [],
                    graveyardCount: 0,
                    exile: [],
                    exileCount: 0,
                  });
                  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

                  const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                    if (!card) return false;
                    const cardId = String((card as any).id || '').trim();
                    const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                    if (cardId && snapshotId) return cardId === snapshotId;
                    return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
                  });

                  if (!alreadyPresent) {
                    (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                    playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
                  }
                }
              }
            }
          } else if (permIndex !== -1) {
            movePermanentToGraveyard(ctx as any, permId, true);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeUnlessPayChoice): failed', err);
        }
        break;
      }

      case "shockLandChoice": {
        // Shock land enters tapped or player pays 2 life
        const pid = (e as any).playerId;
        const permId = (e as any).permanentId;
        const payLife = (e as any).payLife;
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).shockLandChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === String(pid || '').trim()) &&
                (!permId || String((step as any)?.permanentId || '').trim() === String(permId || '').trim())
              );
            });
          }

          if (payLife && pid && ctx.life) {
            (ctx.state as any).life = (ctx.state as any).life || {};
            (ctx as any).life = (ctx as any).life || {};
            const players = (ctx.state as any).players || [];
            const player = players.find((p: any) => String(p?.id) === String(pid));
            const startingLife = (ctx.state as any).startingLife ?? 40;
            const current = (ctx.state as any).life?.[pid] ?? (ctx as any).life?.[pid] ?? player?.life ?? startingLife;
            const next = Number(current) - 2;
            (ctx.state as any).life[pid] = next;
            (ctx as any).life[pid] = next;
            if (player) player.life = next;

            if (permId) {
              const battlefield = ctx.state.battlefield || [];
              const perm = battlefield.find((p: any) => p.id === permId);
              if (perm) {
                (perm as any).tapped = false;
              }
            }

            // Track life lost this turn.
            try {
              (ctx.state as any).lifeLostThisTurn = (ctx.state as any).lifeLostThisTurn || {};
              (ctx.state as any).lifeLostThisTurn[String(pid)] = ((ctx.state as any).lifeLostThisTurn[String(pid)] || 0) + 2;
            } catch {}
          }
          if (!payLife && permId) {
            // Land enters tapped
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (perm) {
              (perm as any).tapped = true;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(shockLandChoice): failed", err);
        }
        break;
      }

      case "revealLandChoice": {
        const pid = String((e as any).playerId || '').trim();
        const permId = String((e as any).permanentId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const revealCardId = String((e as any).revealCardId || '').trim();

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).revealLandChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!permId || String((step as any)?.permanentId || '').trim() === permId)
              );
            });
          }

          if (!permId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const perm = battlefield.find((entry: any) => entry && String(entry.id || '') === permId);
          if (perm) {
            (perm as any).tapped = !revealCardId;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(revealLandChoice): failed', err);
        }
        break;
      }

      case "grantPlayableFromExileChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || 'Ability').trim() || 'Ability';
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenCardId = String((e as any).chosenCardId || (e as any).cardId || '').trim();
          const cardIds = Array.isArray((e as any).cardIds)
            ? (e as any).cardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          const allChoiceCardIds = cardIds.length > 0 ? cardIds : (chosenCardId ? [chosenCardId] : []);
          const stateAny = ctx.state as any;
          const turnAppliedRaw = Number((e as any).turnApplied);
          const turnApplied = Number.isFinite(turnAppliedRaw) ? turnAppliedRaw : Number(stateAny.turnNumber || 0) || 0;
          const playableUntilTurnRaw = Number((e as any).playableUntilTurn);
          const playableUntilTurn = Number.isFinite(playableUntilTurnRaw) ? playableUntilTurnRaw : turnApplied;

          if (!chosenCardId || !controllerId) {
            break;
          }

          const choiceCardIdSet = new Set(allChoiceCardIds);
          const zones = stateAny.zones && typeof stateAny.zones === 'object' ? stateAny.zones : {};
          for (const zoneOwnerId of Object.keys(zones)) {
            const exileZone = Array.isArray(zones[zoneOwnerId]?.exile) ? zones[zoneOwnerId].exile : [];
            for (const exiledCard of exileZone) {
              const exiledCardId = String(exiledCard?.id || '').trim();
              if (!exiledCardId || !choiceCardIdSet.has(exiledCardId)) continue;

              removePlayableFromExileForCard(stateAny, exiledCardId);
              stripPlayableFromExileTags(exiledCard);

              if (exiledCardId === chosenCardId) {
                exiledCard.canBePlayedBy = controllerId;
                exiledCard.playableUntilTurn = playableUntilTurn;
              }
            }
          }

          stateAny.playableFromExile = stateAny.playableFromExile || {};
          const pfe = (stateAny.playableFromExile[controllerId] = stateAny.playableFromExile[controllerId] || {});
          pfe[chosenCardId] = playableUntilTurn;
          upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
            playerId: controllerId as PlayerID,
            cardIds: [chosenCardId],
            action: 'play',
            duration: playableUntilTurn > turnApplied ? 'until_end_of_next_turn' : 'this_turn',
            turnApplied,
            expiresAtTurn: playableUntilTurn,
            sourceName,
          }));

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              const stepCardIds = Array.isArray((step as any)?.grantPlayableFromExileCardIds)
                ? (step as any).grantPlayableFromExileCardIds.map((id: any) => String(id || '').trim())
                : [];
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.grantPlayableFromExileChoice === true &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (stepCardIds.length === 0 || stepCardIds.includes(chosenCardId))
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(grantPlayableFromExileChoiceResolve): failed', err);
        }
        break;
      }

      case "choosePlayerForLookedAtCardsChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenPlayerId = String((e as any).chosenPlayerId || '').trim();
          const rawQueuedStep = (e as any).queuedResolutionStep;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.choosePlayerForLookedAtCardsChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, rawQueuedStep, {
              playerId: chosenPlayerId || playerId || controllerId,
              description: `${sourceName || 'Ability'}: Choose a card`,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(choosePlayerForLookedAtCardsChoiceResolve): failed', err);
        }
        break;
      }

      case "payManaToLookAndChooseCardChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const paymentManaDelta = (e as any).paymentManaDelta;

          if (controllerId && paymentManaDelta && typeof paymentManaDelta === 'object' && !Array.isArray(paymentManaDelta)) {
            const pool = getOrInitManaPool(ctx.state as any, controllerId as any) as any;
            for (const [poolKey, rawAmount] of Object.entries(paymentManaDelta as Record<string, unknown>)) {
              const amount = Number(rawAmount || 0);
              if (!Number.isFinite(amount) || amount === 0) continue;
              pool[poolKey] = Number(pool[poolKey] || 0) + amount;
            }
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.payManaToLookAndChooseCardChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, rawQueuedStep, {
              playerId: controllerId || playerId,
              description: `${sourceName || 'Ability'}: Choose a card`,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(payManaToLookAndChooseCardChoiceResolve): failed', err);
        }
        break;
      }

      case "chooseManaColorsChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const restriction = (e as any).restriction || 'unrestricted';
          const amountPerSelection = Math.max(1, Number((e as any).amountPerSelection || 1));
          const rawQueuedStep = (e as any).queuedResolutionStep;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.chooseManaColorsChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.chooseManaColorsSourceId || (step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.chooseManaColorsSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, rawQueuedStep, {
              playerId: controllerId || playerId,
              description: `${sourceName || 'Ability'}: Choose a color`,
            });
          }

          if (!rawQueuedStep && controllerId) {
            const isUnrestricted = restriction === 'unrestricted' || restriction === 'none' || restriction === null || restriction === undefined;
            const rawManaAdded = (e as any).manaAdded;
            const manaAdded = rawManaAdded && typeof rawManaAdded === 'object' && !Array.isArray(rawManaAdded)
              ? Object.entries(rawManaAdded as Record<string, unknown>)
                  .reduce((acc: Record<string, number>, [color, rawAmount]) => {
                    const amount = Number(rawAmount || 0);
                    if (Number.isFinite(amount) && amount > 0) acc[String(color).toLowerCase()] = amount;
                    return acc;
                  }, {})
              : (Array.isArray((e as any).chosenColors) ? ((e as any).chosenColors as any[]) : [])
                  .map((color: any) => String(color || '').toLowerCase())
                  .filter((color: string) => ['white', 'blue', 'black', 'red', 'green'].includes(color))
                  .reduce((acc: Record<string, number>, color: string) => {
                    acc[color] = Number(acc[color] || 0) + amountPerSelection;
                    return acc;
                  }, {});

            if (isUnrestricted) {
              const pool = getOrInitManaPool(ctx.state as any, controllerId as any) as any;
              for (const [color, amount] of Object.entries(manaAdded)) {
                pool[color] = Number(pool[color] || 0) + Number(amount || 0);
              }
            } else {
              for (const [color, amount] of Object.entries(manaAdded)) {
                addRestrictedManaToPool(ctx.state as any, controllerId, color as any, Number(amount || 0), restriction, undefined, sourceId || undefined, sourceName || undefined);
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(chooseManaColorsChoiceResolve): failed', err);
        }
        break;
      }

      case "moveChosenHandCardToLibraryChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenCardId = String((e as any).chosenCardId || '').trim();
          const position = String((e as any).position || 'top').toLowerCase() === 'bottom' ? 'bottom' : 'top';

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.moveChosenHandCardToLibraryChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.moveChosenHandCardToLibrarySourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });
          }

          if (controllerId && chosenCardId) {
            const stateAny = ctx.state as any;
            const zones = (stateAny.zones = stateAny.zones || {});
            const zone = (zones[controllerId] = zones[controllerId] || { hand: [], handCount: 0, library: [], libraryCount: 0 });
            zone.hand = Array.isArray(zone.hand) ? zone.hand : [];

            const library = Array.isArray((ctx as any).libraries?.get?.(controllerId))
              ? (ctx as any).libraries.get(controllerId)
              : (Array.isArray(zone.library) ? zone.library : []);
            const handIndex = (zone.hand as any[]).findIndex((card: any) => String(card?.id || '') === chosenCardId);
            let movedCard = handIndex >= 0
              ? (zone.hand as any[]).splice(handIndex, 1)[0]
              : undefined;

            if (!movedCard && (e as any).movedCardSnapshot && typeof (e as any).movedCardSnapshot === 'object') {
              const alreadyInLibrary = (library as any[]).some((card: any) => String(card?.id || '') === chosenCardId);
              if (!alreadyInLibrary) {
                movedCard = { ...((e as any).movedCardSnapshot as any) };
              }
            }

            if (movedCard) {
              const libraryCard = { ...movedCard, zone: 'library' };
              if (position === 'bottom') {
                (library as any[]).push(libraryCard);
              } else {
                (library as any[]).unshift(libraryCard);
              }
            }

            zone.library = library;
            zone.handCount = (zone.hand as any[]).length;
            zone.libraryCount = (library as any[]).length;
            if ((ctx as any).libraries?.set) {
              (ctx as any).libraries.set(controllerId, cloneLibraryCards(library as any[]));
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(moveChosenHandCardToLibraryChoiceResolve): failed', err);
        }
        break;
      }

      case "attachEquipmentToPermanentChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const targetPermanentId = String((e as any).targetPermanentId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.attachEquipmentToPermanentChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId || String((step as any)?.playerId || '').trim() === controllerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId || String((step as any)?.attachEquipmentToPermanentTargetPermanentId || '').trim() === sourceId) &&
                (!targetPermanentId || String((step as any)?.attachEquipmentToPermanentTargetPermanentId || '').trim() === targetPermanentId) &&
                (!sourceName || String((step as any)?.attachEquipmentToPermanentSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(attachEquipmentToPermanentChoiceResolve): failed', err);
        }
        break;
      }

      case "chooseDiscardPlanChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const preferredOptionId = String((e as any).preferredOptionId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.chooseDiscardPlanChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId || String((step as any)?.playerId || '').trim() === controllerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.chooseDiscardPlanSourceName || (step as any)?.sourceName || '').trim() === sourceName) &&
                (!preferredOptionId || String((step as any)?.chooseDiscardPlanPreferredOptionId || '').trim() === preferredOptionId)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, (e as any).queuedResolutionStep, {
              playerId: controllerId,
              description: `${sourceName || 'Ability'}: Discard cards`,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(chooseDiscardPlanChoiceResolve): failed', err);
        }
        break;
      }

      case "choosePlayerForTwoPileSplitChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenOpponentId = String((e as any).chosenOpponentId || '').trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.choosePlayerForTwoPileSplitChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId || String((step as any)?.playerId || '').trim() === controllerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.choosePlayerForTwoPileSplitSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, (e as any).queuedResolutionStep, {
              playerId: chosenOpponentId,
              description: `${sourceName || 'Ability'}: Separate the items into two piles`,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(choosePlayerForTwoPileSplitChoiceResolve): failed', err);
        }
        break;
      }

      case "sacrificeAnotherPermanentForBenefitChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const sourcePermanentId = String((e as any).sourcePermanentId || sourceId).trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.sacrificeAnotherPermanentForBenefitChoice === true &&
                String((step as any)?.sacrificeAnotherPermanentForBenefitStage || '') === 'ask' &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId || String((step as any)?.playerId || '').trim() === controllerId) &&
                (!sourcePermanentId || String((step as any)?.sacrificeAnotherPermanentForBenefitSourcePermanentId || (step as any)?.sourceId || '').trim() === sourcePermanentId) &&
                (!sourceName || String((step as any)?.sacrificeAnotherPermanentForBenefitSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });

            addReplayQueuedStepIfMissing(replayGameId, (e as any).queuedResolutionStep, {
              playerId: controllerId,
              description: 'Choose a permanent to sacrifice',
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeAnotherPermanentForBenefitChoiceResolve): failed', err);
        }
        break;
      }

      case "sacrificeAnotherPermanentForBenefitResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const sacrificedPermanentId = String((e as any).sacrificedPermanentId || '').trim();
          const lifeGain = Number((e as any).lifeGain || 0);
          const drawCount = Math.max(0, Math.floor(Number((e as any).drawCount || 0)));

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.TARGET_SELECTION) &&
                (step as any)?.sacrificeAnotherPermanentForBenefitChoice === true &&
                String((step as any)?.sacrificeAnotherPermanentForBenefitStage || '') === 'select_sacrifice' &&
                (!controllerId || String((step as any)?.playerId || '').trim() === controllerId || String((step as any)?.sacrificeAnotherPermanentForBenefitController || '').trim() === controllerId) &&
                (!sourceId || String((step as any)?.sacrificeAnotherPermanentForBenefitSourcePermanentId || (step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.sacrificeAnotherPermanentForBenefitSourceName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });
          }

          if (sacrificedPermanentId) {
            applyReplaySacrificedPermanent(ctx, sacrificedPermanentId);
          }

          if (lifeGain) {
            const stateAny = ctx.state as any;
            stateAny.life = stateAny.life || {};
            const startingLife = Number(stateAny.startingLife || 40) || 40;
            const currentLife = Number(stateAny.life?.[controllerId] ?? startingLife);
            stateAny.life[controllerId] = currentLife + lifeGain;
            const playerObj = Array.isArray(stateAny.players)
              ? stateAny.players.find((player: any) => String(player?.id || '') === controllerId)
              : undefined;
            if (playerObj) playerObj.life = stateAny.life[controllerId];
          }

          if (drawCount > 0) {
            drawCards(ctx as any, controllerId as any, drawCount);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeAnotherPermanentForBenefitResolve): failed', err);
        }
        break;
      }

      case "forceOfWillExileChoiceResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || (e as any).spellName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const spellCardId = String((e as any).spellCardId || sourceId).trim();

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.forceOfWillExileChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!spellCardId || String((step as any)?.forceSpellCardId || (step as any)?.sourceId || '').trim() === spellCardId) &&
                (!sourceName || String((step as any)?.forceSpellName || (step as any)?.sourceName || '').trim() === sourceName)
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(forceOfWillExileChoiceResolve): failed', err);
        }
        break;
      }

      case "chooseLookedAtCardsDestinationResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const controllerId = String((e as any).controllerId || playerId).trim() || playerId;
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const chosenCardId = String((e as any).chosenCardId || '').trim();
          const topCardIds = Array.isArray((e as any).topCardIds)
            ? (e as any).topCardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];
          const chosenZone = String((e as any).chosenZone || '').trim().toLowerCase();
          const otherZone = String((e as any).otherZone || '').trim().toLowerCase();
          const chosenCardSnapshot = (e as any).chosenCard && typeof (e as any).chosenCard === 'object' && !Array.isArray((e as any).chosenCard)
            ? { ...((e as any).chosenCard as Record<string, any>) }
            : undefined;
          const otherCardSnapshots = Array.isArray((e as any).otherCards)
            ? (e as any).otherCards.filter((card: any) => card && typeof card === 'object' && !Array.isArray(card)).map((card: any) => ({ ...card }))
            : [];
          const otherCardPatch = (e as any).otherCardPatch && typeof (e as any).otherCardPatch === 'object' && !Array.isArray((e as any).otherCardPatch)
            ? { ...((e as any).otherCardPatch as Record<string, any>) }
            : undefined;

          if (!controllerId || !chosenCardId || !chosenZone || !otherZone) {
            break;
          }

          const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
          const z = (zones[controllerId] = zones[controllerId] || {
            library: [],
            libraryCount: 0,
            hand: [],
            handCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          });

          const lib: any[] = Array.isArray(z.library) ? z.library : (z.library = []);
          const hand: any[] = Array.isArray(z.hand) ? z.hand : (z.hand = []);
          const graveyard: any[] = Array.isArray(z.graveyard) ? z.graveyard : (z.graveyard = []);
          const exile: any[] = Array.isArray(z.exile) ? z.exile : (z.exile = []);
          const idsToRemove = topCardIds.length > 0
            ? topCardIds
            : [chosenCardId, ...otherCardSnapshots.map((card: any) => String(card?.id || '').trim()).filter(Boolean)];
          const removedCards: any[] = [];

          for (const cardId of idsToRemove) {
            const cardIndex = lib.findIndex((card: any) => String(card?.id || '') === cardId);
            if (cardIndex >= 0) {
              removedCards.push(lib.splice(cardIndex, 1)[0]);
            }
          }

          const removedById = new Map(removedCards.map((card: any) => [String(card?.id || ''), card]));
          const chosenCard = removedById.get(chosenCardId) || chosenCardSnapshot || { id: chosenCardId };
          const otherCards = otherCardSnapshots.length > 0
            ? otherCardSnapshots.map((card: any) => removedById.get(String(card?.id || '')) || card)
            : removedCards.filter((card: any) => String(card?.id || '') !== chosenCardId);
          const normalizeDestinationZone = (destination: string): string => (
            destination === 'top_library' || destination === 'bottom_library' ? 'library' : destination
          );
          const cloneForDestination = (card: any, destination: string): any => {
            const destinationZone = normalizeDestinationZone(destination);
            return {
              ...(card || {}),
              zone: destinationZone,
              ...(destinationZone === 'exile' && otherCardPatch ? otherCardPatch : {}),
            };
          };
          const moveCard = (card: any, destination: string) => {
            const destinationZone = normalizeDestinationZone(destination);
            const movedCard = cloneForDestination(card, destination);
            if (destinationZone === 'hand') {
              hand.push(movedCard);
            } else if (destinationZone === 'graveyard') {
              graveyard.unshift(movedCard);
            } else if (destination === 'top_library') {
              lib.unshift(movedCard);
            } else if (destination === 'bottom_library') {
              lib.push(movedCard);
            } else if (destinationZone === 'exile') {
              exile.push(movedCard);
            }
          };

          moveCard(chosenCard, chosenZone);
          for (const otherCard of otherCards) {
            moveCard(otherCard, otherZone);
          }

          z.library = lib;
          z.hand = hand;
          z.graveyard = graveyard;
          z.exile = exile;
          z.libraryCount = lib.length;
          z.handCount = hand.length;
          z.graveyardCount = graveyard.length;
          z.exileCount = exile.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(controllerId as any, cloneLibraryCards(lib));
          }

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) {
                return true;
              }

              const stepCardIds = Array.isArray((step as any)?.chooseLookedAtCardsDestinationTopCardIds)
                ? (step as any).chooseLookedAtCardsDestinationTopCardIds.map((id: any) => String(id || '').trim())
                : [];
              return (
                String((step as any)?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.chooseLookedAtCardsDestinationChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!sourceId || String((step as any)?.sourceId || '').trim() === sourceId) &&
                (!sourceName || String((step as any)?.sourceName || '').trim() === sourceName) &&
                (stepCardIds.length === 0 || stepCardIds.includes(chosenCardId))
              );
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(chooseLookedAtCardsDestinationResolve): failed', err);
        }
        break;
      }

      case "counterTargetChosen": {
        const targetId = String((e as any).targetId || '').trim();
        const counterType = String((e as any).counterType || '').trim();
        const sourceId = String((e as any).sourceId || '').trim();
        const clearQueuedScavengePrompt = (e as any).clearQueuedScavengePrompt === true;
        const replayGameId = String((ctx as any).gameId || '').trim();

        try {
          if (!targetId || !counterType) break;

          if (clearQueuedScavengePrompt && sourceId && replayGameId) {
            const queue = ResolutionQueueManager.getQueue(replayGameId);
            const matchingStepIds: string[] = [];

            if ((queue as any)?.activeStep && (queue as any).activeStep.scavengeTargetSelection === true) {
              const activeStep = (queue as any).activeStep as any;
              if (String(activeStep.cardId || activeStep.sourceId || '').trim() === sourceId) {
                matchingStepIds.push(String(activeStep.id || '').trim());
              }
            }

            if (Array.isArray((queue as any)?.steps)) {
              for (const pendingStep of (queue as any).steps) {
                const stepAny = pendingStep as any;
                if (stepAny?.scavengeTargetSelection !== true) continue;
                if (String(stepAny.cardId || stepAny.sourceId || '').trim() !== sourceId) continue;
                matchingStepIds.push(String(stepAny.id || '').trim());
              }
            }

            for (const stepId of Array.from(new Set(matchingStepIds)).filter(Boolean)) {
              ResolutionQueueManager.cancelStep(replayGameId, stepId);
            }
          }

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const targetPermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === targetId);
          if (!targetPermanent) break;

          const targetCounters = ((targetPermanent as any).counters || {}) as Record<string, number>;
          targetCounters[counterType] = Number(targetCounters[counterType] || 0) + 1;
          (targetPermanent as any).counters = targetCounters;

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(counterTargetChosen): failed', err);
        }
        break;
      }

      case "counterPlacementResolve": {
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const sourceController = String((e as any).sourceController || '').trim();
        const goadedByPlayerId = String((e as any).goadedByPlayerId || sourceController || '').trim();
        const effectType = String((e as any).effectType || '').trim().toLowerCase();
        const conditionalEffectOnAccept = String((e as any).conditionalEffectOnAccept || '').trim().toLowerCase();
        const playersWhoAccepted = Array.isArray((e as any).playersWhoAccepted)
          ? ((e as any).playersWhoAccepted as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
          : [];
        const creaturesWithCounters = Array.isArray((e as any).creaturesWithCounters)
          ? ((e as any).creaturesWithCounters as any[])
              .map((entry: any) => ({
                permanentId: String(entry?.permanentId || '').trim(),
                playerId: String(entry?.playerId || '').trim(),
              }))
              .filter((entry: any) => entry.permanentId)
          : [];

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                ((step as any).counterPlacementTrigger === true || (step as any).agitatorAntTrigger === true) &&
                (!sourceController || String((step as any)?.sourceController || '').trim() === sourceController)
              );
            });
          }

          for (const entry of creaturesWithCounters) {
            updateCounters(ctx as any, entry.permanentId, { '+1/+1': 2 });
          }

          if (effectType === 'goad' || conditionalEffectOnAccept === 'goad') {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            for (const entry of creaturesWithCounters) {
              const creature = battlefield.find((perm: any) => perm && String(perm.id || '') === entry.permanentId) as any;
              if (!creature || !goadedByPlayerId) continue;
              creature.goaded = creature.goaded || {};
              creature.goaded[goadedByPlayerId] = true;
            }
          } else if (effectType === 'cant_attack' || conditionalEffectOnAccept === 'cant_attack_controller') {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            for (const playerId of playersWhoAccepted) {
              for (const creature of battlefield) {
                const battlefieldCreature = creature as any;
                if (!battlefieldCreature || String(battlefieldCreature.controller || '') !== playerId) continue;
                battlefieldCreature.cantAttackPlayers = battlefieldCreature.cantAttackPlayers || {};
                battlefieldCreature.cantAttackPlayers[sourceController] = {
                  until: 'next_turn',
                  sourcePlayer: sourceController,
                };
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(counterPlacementResolve): failed', err);
        }
        break;
      }

      case "landWouldEnterSacrificeChoice": {
        const pid = (e as any).playerId;
        const sacrificePermanentIds = (e as any).sacrificePermanentIds;
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).landWouldEnterSacrificeChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === String(pid || '').trim())
              );
            });
          }

          const selectionIds = Array.isArray(sacrificePermanentIds)
            ? sacrificePermanentIds.map((id: any) => String(id)).filter(Boolean)
            : [];
          const declined = selectionIds.length === 0;

          resolveLandWouldEnterSacrificeChoice(
            ctx,
            pid as PlayerID,
            declined ? ['decline_land_would_enter'] : selectionIds,
            false,
          );
        } catch (err) {
          debugWarn(1, "applyEvent(landWouldEnterSacrificeChoice): failed", err);
        }
        break;
      }

      case "moxDiamondChoice": {
        const pid = (e as any).playerId;
        const discardLandId = (e as any).discardLandId;
        const stackItemId = String((e as any).stackItemId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).moxDiamondChoice === true &&
                (!pid || String((step as any)?.playerId || '').trim() === String(pid || '').trim()) &&
                (!stackItemId || String((step as any)?.stackItemId || (step as any)?.sourceId || '').trim() === stackItemId)
              );
            });
          }

          const choiceId = discardLandId ? String(discardLandId) : null;
          const resolved = resolveWouldEnterDiscardLandChoice(ctx, pid as PlayerID, stackItemId, choiceId, !choiceId);
          if (resolved.ok) {
            ctx.bumpSeq();
          }
        } catch (err) {
          debugWarn(1, "applyEvent(moxDiamondChoice): failed", err);
        }
        break;
      }

      case "bounceLandChoice": {
        // Bounce land: return a land to hand
        const pid = (e as any).playerId;
        const returnedLandId = (e as any).returnedLandId || (e as any).returnPermanentId;
        const destination = String((e as any).destination || 'hand').toLowerCase();
        const stackItemId = String((e as any).stackItemId || '').trim();
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE) &&
                (!pid || String((step as any)?.playerId || '').trim() === String(pid || '').trim()) &&
                (!stackItemId || String((step as any)?.stackItemId || '').trim() === stackItemId)
              );
            });
          }

          if (returnedLandId && pid) {
            const battlefield = ctx.state.battlefield || [];
            const idx = battlefield.findIndex((p: any) => p.id === returnedLandId);
            if (idx !== -1) {
              if (destination === 'hand') {
                movePermanentToHand(ctx as any, String(returnedLandId));
              }
            }
          }

          if (stackItemId) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const stackIndex = (ctx.state.stack as any[]).findIndex((item: any) => String(item?.id || '') === stackItemId);
            if (stackIndex !== -1) {
              (ctx.state.stack as any[]).splice(stackIndex, 1);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(bounceLandChoice): failed", err);
        }
        break;
      }

      case "hideawayChoice": {
        const pid = String((e as any).playerId || '').trim();
        const permanentId = String((e as any).permanentId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const selectedCardId = String((e as any).selectedCardId || '').trim();
        const bottomOrderIds = Array.isArray((e as any).bottomOrderIds)
          ? (e as any).bottomOrderIds.map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        const lookedAtCardIds = Array.isArray((e as any).lookedAtCardIds)
          ? (e as any).lookedAtCardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        const stackItemId = String((e as any).stackItemId || '').trim();

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.HIDEAWAY_CHOICE) &&
                (!pid || String((step as any)?.playerId || '').trim() === pid) &&
                (!permanentId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permanentId)
              );
            });
          }

          if (pid && permanentId && selectedCardId) {
            const library = ctx.libraries.get(pid) || [];
            const lookedAtCount = Math.min(lookedAtCardIds.length || 0, library.length);
            const topCards = library.splice(0, lookedAtCount);
            const selectedCard = topCards.find((card: any) => String(card?.id || '') === selectedCardId);
            const orderedBottomCards = bottomOrderIds
              .map((cardId: string) => topCards.find((card: any) => String(card?.id || '') === cardId))
              .filter(Boolean);
            const leftoverBottomCards = topCards.filter((card: any) => {
              const cardId = String(card?.id || '');
              return cardId && cardId !== selectedCardId && !bottomOrderIds.includes(cardId);
            });

            for (const card of [...orderedBottomCards, ...leftoverBottomCards]) {
              library.push({ ...(card as any), zone: 'library' });
            }

            ctx.libraries.set(pid, library);

            ctx.state.zones = ctx.state.zones || {};
            const z: any = ctx.state.zones[pid] || { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
            ctx.state.zones[pid] = z;
            z.library = library.map((card: any) => ({ ...(card as any), zone: 'library' }));
            z.libraryCount = library.length;

            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId) as any;
            if (permanent && selectedCard) {
              storeHideawayExiledCard({
                state: ctx.state,
                playerId: pid,
                permanent,
                selectedCard,
                sourceName: String((e as any).sourceName || permanent.card?.name || 'Hideaway'),
              });
            }
          }

          if (stackItemId) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const stackIndex = (ctx.state.stack as any[]).findIndex((item: any) => String(item?.id || '') === stackItemId);
            if (stackIndex !== -1) {
              (ctx.state.stack as any[]).splice(stackIndex, 1);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(hideawayChoice): failed', err);
        }
        break;
      }

      case "librarySearchSelect": {
        // Select cards from library search (tutor effects)
        const pid = (e as any).playerId;
        // Support both field names for backward compatibility
        const cardIds = (e as any).selectedCardIds as string[] || (e as any).cardIds as string[] || [];
        const destination = (e as any).moveTo || (e as any).destination || "hand";
        try {
          if (pid && cardIds.length > 0) {
            const lib = ctx.libraries.get(pid) || [];
            const zones = ctx.state.zones || {};
            const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
            zones[pid] = z;
            
            for (const cardId of cardIds) {
              const idx = lib.findIndex((c: any) => c.id === cardId);
              if (idx !== -1) {
                const [card] = lib.splice(idx, 1);
                if (destination === "hand") {
                  (z.hand as any[]).push({ ...card, zone: "hand" });
                } else if (destination === "battlefield") {
                  ctx.state.battlefield = ctx.state.battlefield || [];
                  ctx.state.battlefield.push({
                    id: card.id,
                    controller: pid,
                    owner: pid,
                    tapped: false,
                    counters: {},
                    card: { ...card, zone: "battlefield" },
                  } as any);
                } else if (destination === "top") {
                  lib.unshift({ ...card, zone: "library" });
                }
              }
            }
            
            z.handCount = (z.hand as any[]).length;
            z.libraryCount = lib.length;
            ctx.libraries.set(pid, lib);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(librarySearchSelect): failed", err);
        }
        break;
      }

      case "librarySearchResolve": {
        const pid = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const searchOwnerId = String((e as any).searchOwnerId || pid).trim() || pid;
        const destination = String((e as any).destination || 'hand');
        const sourceId = String((e as any).sourceId || '').trim();
        const sourceName = String((e as any).sourceName || '').trim();
        const abilityId = String((e as any).abilityId || '').trim();
        const entersTapped = (e as any).entersTapped === true;
        const splitAssignments = (e as any).splitAssignments as { toBattlefield?: string[]; toHand?: string[] } | undefined;
        const destinationFaceDown = (e as any).destinationFaceDown === true;
        const grantPlayableFromExileToController = (e as any).grantPlayableFromExileToController === true;
        const grantPlayableFromExileControllerId = String((e as any).grantPlayableFromExileControllerId || searchOwnerId).trim() || searchOwnerId;
        const grantPlayableFromExileSpendManaAsThoughAnyType = (e as any).grantPlayableFromExileSpendManaAsThoughAnyType === true;
        const playableFromExileTypeKey = String((e as any).playableFromExileTypeKey || '').toLowerCase();
        const pendingBottomOrder = (e as any).pendingBottomOrder && typeof (e as any).pendingBottomOrder === 'object'
          ? (e as any).pendingBottomOrder as Record<string, any>
          : undefined;
        const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
          ? ((e as any).createdPermanentIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        const selectedCards = Array.isArray((e as any).selectedCards) ? (e as any).selectedCards as any[] : [];
        const selectedCardMap = new Map(selectedCards.map((card: any) => [String(card?.id || ''), card]));
        const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
        const libraryAfterSnapshot = hasLibraryAfterField
          ? cloneLibraryCards((e as any).libraryAfter as any[])
          : [];
        const selectedIds = Array.isArray((e as any).selectedCardIds)
          ? ((e as any).selectedCardIds as any[]).map((id: any) => String(id)).filter(Boolean)
          : selectedCards.map((card: any) => String(card?.id || '')).filter(Boolean);
        const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
          ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
          : [];
        const libraryAfter = hasLibraryAfterField
          ? libraryAfterSnapshot
          : buildLibraryAfterSearchResolve(
              getPlayerLibraryFromContext(ctx, searchOwnerId),
              selectedIds,
              eventHasOwnField(e, 'remainingLibraryIds') ? remainingLibraryIds : undefined,
            );

        try {
          if (!pid) break;

          const gameId = String((ctx as any).gameId || '').trim();

          if (gameId) {
            try {
              const queue = ResolutionQueueManager.getQueue(gameId) as any;
              const matchesResolvedSearchStep = (step: any): boolean => {
                if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) {
                  return true;
                }
                if (!step || String(step?.type || '') !== String(ResolutionStepType.LIBRARY_SEARCH)) {
                  return false;
                }

                if (String(step?.playerId || '') !== pid) {
                  return false;
                }

                const queuedSourceId = String(step?.sourceId || '').trim();
                const queuedSourceName = String(step?.sourceName || '').trim();
                const queuedAbilityId = String(step?.persistLibrarySearchResolveAbilityId || step?.abilityId || '').trim();

                if (sourceId && queuedSourceId === sourceId) {
                  return true;
                }

                if (abilityId && queuedAbilityId === abilityId) {
                  return true;
                }

                return Boolean(sourceName) && queuedSourceName === sourceName;
              };

              const activeStepMatched = matchesResolvedSearchStep(queue?.activeStep);
              const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

              if (activeStepMatched) {
                queue.activeStep = undefined;
              }

              if (Array.isArray(queue?.steps) && beforeCount > 0) {
                queue.steps = queue.steps.filter((step: any) => !matchesResolvedSearchStep(step));
              }

              if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                queue.seq = Number(queue?.seq || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          const zones = ctx.state.zones || {};
          const z = zones[searchOwnerId] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };
          zones[searchOwnerId] = z;

          if (Array.isArray(ctx.state.stack) && ctx.state.stack.length > 0) {
            ctx.state.stack = ctx.state.stack.filter((item: any) => {
              if (!item || String(item.abilityType || '') !== 'fetch-land') {
                return true;
              }

              const sameController = String(item.controller || '') === pid;
              const sameSource = sourceId.length > 0 && String(item.source || '') === sourceId;
              const sameName = sourceName.length > 0 && String(item.sourceName || '') === sourceName;
              const sameAbilityId = abilityId.length > 0 && String(item.abilityId || '') === abilityId;

              if (!sameController) {
                return true;
              }

              if (sameSource || sameAbilityId) {
                return false;
              }

              if (sameName && sourceId.length === 0 && abilityId.length === 0) {
                return false;
              }

              return true;
            });
          }

          (z as any).library = libraryAfter;
          z.libraryCount = libraryAfter.length;
          if (ctx.libraries?.set) {
            ctx.libraries.set(searchOwnerId, cloneLibraryCards(libraryAfter));
          }

          const moveToBattlefield = (card: any) => {
            if (!card) return;
            const typeLine = String(card?.type_line || '').toLowerCase();
            const isCreature = typeLine.includes('creature');
            ctx.state.battlefield = ctx.state.battlefield || [];
            const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', String(card?.id || 'library_search'));
            (ctx.state.battlefield as any[]).push({
              id: createdPermanentId,
              controller: pid,
              owner: pid,
              tapped: entersTapped,
              counters: {},
              basePower: isCreature ? parseInt(card?.power || '0', 10) : undefined,
              baseToughness: isCreature ? parseInt(card?.toughness || '0', 10) : undefined,
              summoningSickness: isCreature,
              card: { ...card, zone: 'battlefield' },
            } as any);
          };

          const moveToHand = (card: any) => {
            if (!card) return;
            z.hand = Array.isArray(z.hand) ? z.hand : [];
            (z.hand as any[]).push({ ...card, zone: 'hand' });
            z.handCount = (z.hand as any[]).length;
          };

          const moveToGraveyardZone = (card: any) => {
            if (!card) return;
            z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
            (z.graveyard as any[]).push({ ...card, zone: 'graveyard' });
            z.graveyardCount = (z.graveyard as any[]).length;
          };

          const moveToExileZone = (card: any) => {
            if (!card) return;
            z.exile = Array.isArray(z.exile) ? z.exile : [];
            const exiledCard = {
              ...card,
              zone: 'exile',
              ...(destinationFaceDown ? { faceDown: true } : {}),
              ...(grantPlayableFromExileToController ? {
                canBePlayedBy: grantPlayableFromExileControllerId,
                playableUntilTurn: true,
                ...(grantPlayableFromExileSpendManaAsThoughAnyType ? { spendManaAsThoughAnyType: true } : {}),
              } : null),
            };
            (z.exile as any[]).push(exiledCard);
            z.exileCount = (z.exile as any[]).length;

            if (grantPlayableFromExileToController) {
              const typeLine = String(exiledCard?.type_line || '').toLowerCase();
              const passesTypeGate = !playableFromExileTypeKey || typeLine.includes(playableFromExileTypeKey);
              if (passesTypeGate) {
                const stateAny = ctx.state as any;
                stateAny.playableFromExile = stateAny.playableFromExile || {};
                const entry = (stateAny.playableFromExile[grantPlayableFromExileControllerId] = stateAny.playableFromExile[grantPlayableFromExileControllerId] || {});
                entry[String(exiledCard.id)] = true;
                upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
                  playerId: grantPlayableFromExileControllerId as PlayerID,
                  cardIds: [String(exiledCard.id)],
                  action: 'play',
                  duration: 'static',
                  turnApplied: Number(stateAny.turnNumber || 0),
                  sourceId,
                  sourceName,
                  spendManaAsThoughAnyType: grantPlayableFromExileSpendManaAsThoughAnyType,
                }));
              }
            }
          };

          if (splitAssignments) {
            for (const cardId of splitAssignments.toBattlefield || []) {
              moveToBattlefield(selectedCardMap.get(String(cardId)));
            }
            for (const cardId of splitAssignments.toHand || []) {
              moveToHand(selectedCardMap.get(String(cardId)));
            }
          } else {
            for (const cardId of selectedIds) {
              const card = selectedCardMap.get(cardId);
              if (!card) continue;
              if (destination === 'battlefield') {
                moveToBattlefield(card);
              } else if (destination === 'hand') {
                moveToHand(card);
              } else if (destination === 'graveyard') {
                moveToGraveyardZone(card);
              } else if (destination === 'exile') {
                moveToExileZone(card);
              }
            }
          }

          const lifeLoss = Number((e as any).lifeLoss || 0);
          if (Number.isFinite(lifeLoss) && lifeLoss > 0) {
            (ctx.state as any).life = (ctx.state as any).life || {};
            const currentLife = Number((ctx.state as any).life?.[pid] ?? 40);
            (ctx.state as any).life[pid] = currentLife - lifeLoss;
          }

          if (pendingBottomOrder) {
            const stateAny = ctx.state as any;
            stateAny.pendingBottomOrder = stateAny.pendingBottomOrder || {};
            const pendingList = Array.isArray(stateAny.pendingBottomOrder[pid]) ? stateAny.pendingBottomOrder[pid] : [];
            pendingList.push({
              effectId: String(pendingBottomOrder.effectId || ''),
              sourceId: String(pendingBottomOrder.sourceId || sourceId || ''),
              sourceName: String(pendingBottomOrder.sourceName || sourceName || ''),
              sourceImage: pendingBottomOrder.sourceImage,
              description: String(pendingBottomOrder.description || `${sourceName || 'Effect'}: Put cards on the bottom in any order.`),
              cards: cloneLibraryCards(Array.isArray(pendingBottomOrder.cards) ? pendingBottomOrder.cards as any[] : []),
              shuffleAfter: pendingBottomOrder.shuffleAfter === true,
              queued: false,
            });
            stateAny.pendingBottomOrder[pid] = pendingList;
          }

          restoreOracleIrLedgerOnState(
            ctx.state,
            (e as any).oracleIrStepLedger,
            (e as any).oracleIrAppliedStepKinds,
          );
          if (hasLibraryAfterField && libraryAfterSnapshot.length > 0) {
            // Shuffle-only compound resume is already captured in libraryAfter; do not
            // restore pending resume or finalizeGameStateAfterReplay will re-shuffle.
            clearOracleIrPendingCompoundResumeOnState(ctx.state);
          } else {
            restoreOracleIrPendingCompoundResumeOnState(ctx.state, e);
          }

          ctx.bumpSeq();
          ensureDeferredOracleIrStackItem(ctx, String((e as any).oracleIrSourceId || (e as any).sourceId || '').trim() || undefined);
        } catch (err) {
          debugWarn(1, 'applyEvent(librarySearchResolve): failed', err);
        }
        break;
      }

        case "cascadeResolve": {
          const pid = String((e as any).playerId || '').trim();
          const effectId = String((e as any).effectId || '').trim();
          const sourceCardId = String((e as any).sourceCardId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const cascadeNumber = Number((e as any).cascadeNumber || 0);
          const cast = (e as any).cast === true;
          const hitCard = (e as any).hitCard && typeof (e as any).hitCard === 'object'
            ? { ...(e as any).hitCard }
            : null;
          const exiledCards = Array.isArray((e as any).exiledCards) ? (e as any).exiledCards as any[] : [];
          const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
            ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
            : [];
          const bottomCardIds = Array.isArray((e as any).bottomCardIds)
            ? ((e as any).bottomCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
            : [];
          const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
          const libraryAfterSnapshot = hasLibraryAfterField
            ? cloneLibraryCards((e as any).libraryAfter as any[])
            : [];
          const libraryAfter = hasLibraryAfterField
            ? libraryAfterSnapshot
            : buildLibraryAfterCascadeResolve(
                getPlayerLibraryFromContext(ctx, pid),
                exiledCards,
                remainingLibraryIds,
                bottomCardIds,
              );

          try {
            if (!pid) break;

            const gameId = String((ctx as any).gameId || '').trim();
            if (gameId) {
              try {
                const queue = ResolutionQueueManager.getQueue(gameId) as any;
                const matchesCascadeStep = (step: any): boolean => {
                  if (!step || String(step?.type || '') !== String(ResolutionStepType.CASCADE)) {
                    return false;
                  }
                  if (String(step?.playerId || '') !== pid) {
                    return false;
                  }
                  if (effectId && String(step?.effectId || '') === effectId) {
                    return true;
                  }
                  if (sourceCardId && String(step?.sourceId || '') === sourceCardId) {
                    return cascadeNumber <= 0 || Number(step?.cascadeNumber || 0) === cascadeNumber;
                  }
                  return Boolean(sourceName) && String(step?.sourceName || '') === sourceName;
                };

                const activeStepMatched = matchesCascadeStep(queue?.activeStep);
                const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

                if (activeStepMatched) {
                  queue.activeStep = undefined;
                }
                if (Array.isArray(queue?.steps) && beforeCount > 0) {
                  queue.steps = queue.steps.filter((step: any) => !matchesCascadeStep(step));
                }
                if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                  queue.seq = Number(queue?.seq || 0) + 1;
                }
              } catch {
                // best-effort only
              }
            }

            const pendingCascade = (((ctx.state as any) || {}).pendingCascade || {}) as Record<string, any[]>;
            const playerQueue = Array.isArray(pendingCascade[pid]) ? pendingCascade[pid] : [];
            const matchingIndex = playerQueue.findIndex((entry: any) => {
              if (effectId && String(entry?.effectId || '') === effectId) return true;
              if (sourceCardId && String(entry?.sourceCardId || '') === sourceCardId) {
                return cascadeNumber <= 0 || Number(entry?.instance || 0) === cascadeNumber;
              }
              return Boolean(sourceName) && String(entry?.sourceName || '') === sourceName;
            });
            if (matchingIndex >= 0) {
              playerQueue.splice(matchingIndex, 1);
            }
            if (playerQueue.length > 0) {
              pendingCascade[pid] = playerQueue;
            } else if (pid in pendingCascade) {
              delete pendingCascade[pid];
            }
            if (Object.keys(pendingCascade).length > 0) {
              (ctx.state as any).pendingCascade = pendingCascade;
            } else {
              delete (ctx.state as any).pendingCascade;
            }

            const zones = (ctx.state as any).zones || {};
            const z = zones[pid] || {
              hand: [],
              handCount: 0,
              library: [],
              libraryCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            };
            zones[pid] = z;

            (z as any).library = libraryAfter;
            z.libraryCount = libraryAfter.length;
            if (ctx.libraries?.set) {
              ctx.libraries.set(pid as any, cloneLibraryCards(libraryAfter));
            }

            if (cast && hitCard) {
              const exile = Array.isArray((z as any).exile) ? (z as any).exile : [];
              if (!exile.some((card: any) => String(card?.id || '') === String(hitCard.id || ''))) {
                exile.push({ ...hitCard, zone: 'exile' });
              }
              (z as any).exile = exile;
              (z as any).exileCount = exile.length;
            }

            ctx.bumpSeq();
          } catch (err) {
            debugWarn(1, 'applyEvent(cascadeResolve): failed', err);
          }
          break;
        }

      case "creatureTypeSelected": {
        // Creature type selection (e.g., Cavern of Souls, Metallic Mimic)
        const permId = (e as any).permanentId;
        const playerId = (e as any).playerId;
        const creatureType = (e as any).creatureType;
        const cardName = (e as any).cardName;
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.CREATURE_TYPE_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              if (String((step as any)?.type || '').trim() !== resolvedStepType) return false;
              if (playerId && String((step as any)?.playerId || '').trim() !== String(playerId || '').trim()) return false;
              const stepPermanentId = String((step as any)?.permanentId || (step as any)?.sourceId || '').trim();
              if (permId && stepPermanentId && stepPermanentId === String(permId || '').trim()) return true;
              if (!cardName) return !permId;
              const stepCardName = String((step as any)?.cardName || (step as any)?.sourceName || '').trim().toLowerCase();
              return stepCardName !== '' && stepCardName === String(cardName || '').trim().toLowerCase();
            });
          }

          const spellId = String((e as any).spellId || '').trim();
          if (spellId && creatureType) {
            const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
            const spellOnStack = stack.find((item: any) => item && (String(item.id || '') === spellId || String(item.cardId || '') === spellId));
            if (spellOnStack) {
              (spellOnStack as any).chosenCreatureType = creatureType;
              if (spellOnStack.card && typeof spellOnStack.card === 'object') {
                (spellOnStack.card as any).chosenCreatureType = creatureType;
              }
            }
          } else if (permId && creatureType) {
            const perm = resolveReplayPermanentByEvent(ctx, {
              permanentId: permId,
              playerId,
              cardName,
            });
            if (perm) {
              (perm as any).chosenCreatureType = creatureType;
              if (perm.card && typeof perm.card === 'object') {
                (perm.card as any).chosenCreatureType = creatureType;
              }

              const permCardName = String((perm as any)?.card?.name || '').toLowerCase();
              if (permCardName.includes('arcane adaptation')) {
                const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
                applyArcaneAdaptationToControllerCreatures(
                  battlefield,
                  String((perm as any)?.controller || playerId || ''),
                  String(creatureType),
                );
              }
              if (permCardName.includes('morophon')) {
                const stateAny = ctx.state as any;
                const morophonChosenType = (stateAny.morophonChosenType || {}) as Record<string, string>;
                morophonChosenType[String((perm as any)?.id || permId)] = String(creatureType);
                if (permId && String((perm as any)?.id || '') !== String(permId)) {
                  morophonChosenType[String(permId)] = String(creatureType);
                }
                stateAny.morophonChosenType = morophonChosenType;
              }
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(creatureTypeSelected): failed", err);
        }
        break;
      }

      case "permanentBecomeCopyResolve": {
        const copyOntoPermanentId = String((e as any).copyOntoPermanentId || '').trim();
        const copyFromPermanentId = String((e as any).copyFromPermanentId || '').trim();
        const retainedAbilityText = String((e as any).retainedAbilityText || '').trim() || undefined;
        const playerId = (e as any).playerId;
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              const stepAction = String((step as any)?.action || '').trim();
              if (
                stepAction !== 'self_become_copy_of_creature' &&
                stepAction !== 'other_become_copy_of_creature'
              ) {
                return false;
              }
              return (
                String((step as any)?.type || '').trim() === ResolutionStepType.TARGET_SELECTION &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!copyOntoPermanentId || String((step as any)?.selfBecomeCopySourcePermanentId || (step as any)?.sourceId || '').trim() === copyOntoPermanentId)
              );
            });
          }

          if (copyOntoPermanentId && copyFromPermanentId) {
            applyPermanentBecomeCopyOfTargetPermanent(
              ctx.state,
              copyOntoPermanentId,
              copyFromPermanentId,
              retainedAbilityText,
            );
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(permanentBecomeCopyResolve): failed", err);
        }
        break;
      }

      case "playOpeningHandCards": {
        // Play cards from opening hand (Leylines, Chancellor triggers)
        const pid = (e as any).playerId;
        const cardIds = (e as any).cardIds as string[] || [];
        try {
          if (pid && cardIds.length > 0) {
            const zones = ctx.state.zones || {};
            const z = zones[pid];
            if (z && Array.isArray(z.hand)) {
              const hand = z.hand as any[];
              ctx.state.battlefield = ctx.state.battlefield || [];
              
              for (const cardId of cardIds) {
                const idx = hand.findIndex((c: any) => c.id === cardId);
                if (idx !== -1) {
                  const [card] = hand.splice(idx, 1);
                  ctx.state.battlefield.push({
                    id: card.id,
                    controller: pid,
                    owner: pid,
                    tapped: false,
                    counters: getReplayOpeningHandBattlefieldCounters(ctx.state, card, pid),
                    card: { ...card, zone: "battlefield" },
                  } as any);
                }
              }
              z.handCount = hand.length;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(playOpeningHandCards): failed", err);
        }
        break;
      }

      case "skipOpeningHandActions": {
        // Player chose to skip opening hand actions
        // Just a marker event, no state change needed
        ctx.bumpSeq();
        break;
      }

      case "kynaiosChoiceInitiated":
      case "kynaiosChoiceResponse":
      case "kynaiosChoiceComplete": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const batchId = String((e as any).batchId || '').trim();

          if ((e as any).type === 'kynaiosChoiceInitiated') {
            const sourceController = String((e as any).sourceController || '').trim();
            const controllerDrawCount = Math.max(0, Number((e as any).controllerDrawCount ?? 1) || 0);
            const rawSteps = Array.isArray((e as any).steps) ? ((e as any).steps as any[]) : [];
            const queue = gameId ? ResolutionQueueManager.getQueue(gameId) : undefined;

            if (sourceController && controllerDrawCount > 0) {
              drawCards(ctx, sourceController as any, controllerDrawCount);
            }

            for (const rawStep of rawSteps) {
              if (!rawStep || typeof rawStep !== 'object') continue;
              const stepId = String((rawStep as any).id || '').trim();
              if (!stepId || !queue) continue;
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) continue;

              ResolutionQueueManager.addStep(gameId, {
                id: stepId,
                type: ResolutionStepType.KYNAIOS_CHOICE,
                playerId: String((rawStep as any).playerId || '') as any,
                description: String((rawStep as any).description || ''),
                mandatory: (rawStep as any).mandatory !== false,
                sourceId: (rawStep as any).sourceId ? String((rawStep as any).sourceId) : undefined,
                sourceName: (rawStep as any).sourceName ? String((rawStep as any).sourceName) : undefined,
                sourceImage: (rawStep as any).sourceImage,
                kynaiosBatchId: String((rawStep as any).kynaiosBatchId || batchId || stepId),
                isController: (rawStep as any).isController === true,
                sourceController: (rawStep as any).sourceController ? String((rawStep as any).sourceController) : undefined,
                canPlayLand: (rawStep as any).canPlayLand !== false,
                landsInHand: Array.isArray((rawStep as any).landsInHand) ? (rawStep as any).landsInHand.map((card: any) => ({
                  id: String(card?.id || ''),
                  name: String(card?.name || ''),
                  imageUrl: card?.imageUrl,
                })) : [],
                options: Array.isArray((rawStep as any).options) ? (rawStep as any).options.map((option: any) => String(option)) : [],
                landPlayOrFallbackIsController: (rawStep as any).landPlayOrFallbackIsController === true,
                landPlayOrFallbackSourceController: (rawStep as any).landPlayOrFallbackSourceController ? String((rawStep as any).landPlayOrFallbackSourceController) : undefined,
                landPlayOrFallbackCanPlayLand: (rawStep as any).landPlayOrFallbackCanPlayLand !== false,
                landPlayOrFallbackLandsInHand: Array.isArray((rawStep as any).landPlayOrFallbackLandsInHand) ? (rawStep as any).landPlayOrFallbackLandsInHand.map((card: any) => ({
                  id: String(card?.id || ''),
                  name: String(card?.name || ''),
                  imageUrl: card?.imageUrl,
                })) : [],
                landPlayOrFallbackOptions: Array.isArray((rawStep as any).landPlayOrFallbackOptions) ? (rawStep as any).landPlayOrFallbackOptions.map((option: any) => String(option)) : [],
              } as any);
            }
          } else if ((e as any).type === 'kynaiosChoiceResponse') {
            const playerId = String((e as any).playerId || '').trim();
            const stepId = String((e as any).stepId || '').trim();
            const resolvedStepId = String((e as any).resolvedStepId || stepId).trim();
            const choice = String((e as any).choice || 'decline').trim();
            const landCardId = String((e as any).landCardId || '').trim();
            const createdPermanentId = String((e as any).createdPermanentId || '').trim();

            if (choice === 'play_land' && playerId && landCardId) {
              moveKynaiosLandFromHandToBattlefield(ctx as any, playerId as any, landCardId, createdPermanentId || undefined);
            }

            if (gameId && resolvedStepId) {
              clearReplayQueuedStepById(gameId, resolvedStepId);
            }
          } else {
            const sourceController = String((e as any).sourceController || '').trim();
            const drawnPlayerIds = Array.isArray((e as any).drawnPlayerIds)
              ? ((e as any).drawnPlayerIds as any[]).map((playerId: any) => String(playerId || '').trim()).filter(Boolean)
              : [];
            const stateAny = ctx.state as any;
            stateAny.kynaiosFinalizedBatches = stateAny.kynaiosFinalizedBatches || {};
            stateAny.kynaiosFinalizedBatches[batchId] = true;

            for (const playerId of drawnPlayerIds) {
              if (playerId && playerId !== sourceController) {
                drawCards(ctx, playerId as any, 1);
              }
            }

            if (gameId && batchId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              const pendingSteps = queue.steps.filter((step: any) =>
                String(step?.type || '') === String(ResolutionStepType.KYNAIOS_CHOICE) &&
                String((step as any).kynaiosBatchId || '') === batchId
              );
              for (const pendingStep of pendingSteps) {
                ResolutionQueueManager.cancelStep(gameId, String((pendingStep as any).id || ''));
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(kynaiosChoice*): failed', err);
        }
        break;
      }

      case "joinForcesInitiated":
      case "joinForcesContribution":
      case "joinForcesComplete": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const cardName = String((e as any).cardName || '').trim();

          if ((e as any).type === 'joinForcesInitiated') {
            const rawSteps = Array.isArray((e as any).steps) ? ((e as any).steps as any[]) : [];
            const queue = gameId ? ResolutionQueueManager.getQueue(gameId) : undefined;

            for (const rawStep of rawSteps) {
              if (!rawStep || typeof rawStep !== 'object') continue;
              const stepId = String((rawStep as any).id || '').trim();
              if (!stepId || !queue) continue;
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) continue;

              ResolutionQueueManager.addStep(gameId, {
                id: stepId,
                type: ResolutionStepType.JOIN_FORCES,
                playerId: String((rawStep as any).playerId || '') as any,
                description: String((rawStep as any).description || ''),
                mandatory: (rawStep as any).mandatory !== false,
                sourceId: (rawStep as any).sourceId ? String((rawStep as any).sourceId) : undefined,
                sourceName: (rawStep as any).sourceName ? String((rawStep as any).sourceName) : undefined,
                sourceImage: (rawStep as any).sourceImage,
                cardName: (rawStep as any).cardName ? String((rawStep as any).cardName) : undefined,
                effectDescription: (rawStep as any).effectDescription ? String((rawStep as any).effectDescription) : undefined,
                cardImageUrl: (rawStep as any).cardImageUrl,
                initiator: (rawStep as any).initiator ? String((rawStep as any).initiator) : undefined,
                availableMana: Number((rawStep as any).availableMana || 0),
                isInitiator: (rawStep as any).isInitiator === true,
                priority: Number((rawStep as any).priority || 0),
                oracleIrResumeStepsJson: (rawStep as any).oracleIrResumeStepsJson
                  ? String((rawStep as any).oracleIrResumeStepsJson)
                  : undefined,
                oracleIrControllerId: (rawStep as any).oracleIrControllerId
                  ? String((rawStep as any).oracleIrControllerId)
                  : undefined,
                oracleIrSourceId: (rawStep as any).oracleIrSourceId
                  ? String((rawStep as any).oracleIrSourceId)
                  : undefined,
                oracleIrSourceName: (rawStep as any).oracleIrSourceName
                  ? String((rawStep as any).oracleIrSourceName)
                  : undefined,
              } as any);
            }
          } else if ((e as any).type === 'joinForcesContribution') {
            const playerId = String((e as any).playerId || '').trim();
            const contribution = Math.max(0, Math.floor(Number((e as any).contribution || 0)));
            const stepId = String((e as any).stepId || '').trim();
            const tappedPermanentIds = Array.isArray((e as any).tappedPermanentIds)
              ? ((e as any).tappedPermanentIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
              : [];

            for (const permanentId of tappedPermanentIds) {
              const permanent = (ctx.state.battlefield || []).find((perm: any) => String(perm?.id || '') === permanentId);
              if (permanent) permanent.tapped = true;
            }

            const stateAny = ctx.state as any;
            stateAny.joinForcesContributions = stateAny.joinForcesContributions || {};
            stateAny.joinForcesContributions[cardName] = stateAny.joinForcesContributions[cardName] || {
              total: 0,
              byPlayer: {},
              initiator: String((e as any).initiator || '').trim() || undefined,
              cardName,
            };
            stateAny.joinForcesContributions[cardName].total += contribution;
            stateAny.joinForcesContributions[cardName].byPlayer[playerId] = contribution;

            if (gameId && stepId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) {
                ResolutionQueueManager.completeStep(gameId, stepId, {
                  stepId,
                  playerId: playerId as any,
                  selections: contribution,
                  cancelled: false,
                  timestamp: Date.now(),
                } as any);
              }
            }
          } else {
            const initiator = String((e as any).initiator || '').trim();
            const totalContributions = Math.max(0, Math.floor(Number((e as any).totalContributions || 0)));
            const byPlayer = ((e as any).byPlayer && typeof (e as any).byPlayer === 'object')
              ? { ...((e as any).byPlayer as any) }
              : {};
            const players = (ctx.state.players || []) as any[];
            const battlefield = ctx.state.battlefield = ctx.state.battlefield || [];
            const cardNameLower = cardName.toLowerCase();

            if (gameId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              const pendingJoinForcesSteps = queue.steps.filter((step: any) =>
                String(step?.type || '') === String(ResolutionStepType.JOIN_FORCES) &&
                String((step as any).cardName || '') === cardName
              );
              for (const pendingStep of pendingJoinForcesSteps) {
                ResolutionQueueManager.cancelStep(gameId, String((pendingStep as any).id || ''));
              }
            }

            if ((e as any).oracleIrResumed !== true) {
              if (cardNameLower.includes('minds aglow')) {
              for (const player of players) {
                if (player?.hasLost) continue;
                drawCards(ctx as any, player.id, totalContributions);
              }
            } else if (cardNameLower.includes('collective voyage')) {
              for (const player of players) {
                if (player?.hasLost) continue;
                const playerId = String(player.id || '').trim();
                if (!playerId) continue;

                const existingSearch = gameId
                  ? ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
                      String(step?.type || '') === String(ResolutionStepType.LIBRARY_SEARCH) &&
                      String(step?.playerId || '') === playerId &&
                      String(step?.sourceName || '') === 'Collective Voyage')
                  : undefined;
                if (existingSearch) continue;

                const availableCards = (ctx.libraries.get(playerId) || []).map((libraryCard: any) => ({
                  id: libraryCard.id,
                  name: libraryCard.name,
                  type_line: libraryCard.type_line,
                  oracle_text: libraryCard.oracle_text,
                  image_uris: libraryCard.image_uris,
                  card_faces: libraryCard.card_faces,
                  layout: libraryCard.layout,
                  mana_cost: libraryCard.mana_cost,
                  cmc: libraryCard.cmc,
                  colors: libraryCard.colors,
                  power: libraryCard.power,
                  toughness: libraryCard.toughness,
                  loyalty: libraryCard.loyalty,
                  color_identity: libraryCard.color_identity,
                }));

                ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.LIBRARY_SEARCH,
                  playerId: playerId as any,
                  description: `up to ${totalContributions} basic land card(s) (enters tapped)`,
                  mandatory: false,
                  sourceName: 'Collective Voyage',
                  searchCriteria: `up to ${totalContributions} basic land card(s)`,
                  minSelections: 0,
                  maxSelections: totalContributions,
                  destination: 'battlefield',
                  reveal: true,
                  shuffleAfter: true,
                  availableCards,
                  entersTapped: true,
                  filter: { types: ['land'], supertypes: ['basic'] },
                  remainderDestination: 'shuffle',
                  remainderRandomOrder: true,
                } as any);
              }
            } else if (cardNameLower.includes('alliance of arms')) {
              const createdPermanentIdsByPlayer = ((e as any).createdPermanentIdsByPlayer && typeof (e as any).createdPermanentIdsByPlayer === 'object')
                ? ((e as any).createdPermanentIdsByPlayer as Record<string, string[]>)
                : {};
              for (const player of players) {
                if (player?.hasLost) continue;
                const playerId = String(player.id || '').trim();
                const persistedIds = Array.isArray(createdPermanentIdsByPlayer[playerId]) ? createdPermanentIdsByPlayer[playerId] : [];
                for (let index = 0; index < totalContributions; index++) {
                  const tokenId = String(persistedIds[index] || '').trim() || generateDeterministicId(ctx, 'tok', `alliance_of_arms_${playerId}_${index}`);
                  battlefield.push({
                    id: tokenId,
                    controller: playerId,
                    owner: playerId,
                    tapped: false,
                    counters: {},
                    isToken: true,
                    summoningSickness: true,
                    card: {
                      id: tokenId,
                      name: 'Soldier Token',
                      type_line: 'Token Creature — Soldier',
                      power: '1',
                      toughness: '1',
                      colors: ['W'],
                    },
                  });
                }
              }
            } else if (cardNameLower.includes('shared trauma')) {
              const stateAny = ctx.state as any;
              stateAny.pendingMill = stateAny.pendingMill || {};
              for (const player of players) {
                if (player?.hasLost) continue;
                const playerId = String(player.id || '').trim();
                if (!playerId) continue;
                stateAny.pendingMill[playerId] = (stateAny.pendingMill[playerId] || 0) + totalContributions;
              }
            } else {
              applyJoinForcesPaidManaPowerPump(battlefield, {
                cardName,
                totalContributions,
                effectDescription: String((e as any).effectDescription || ''),
                sourcePermanentId: String((e as any).sourcePermanentId || '').trim() || undefined,
              });
            }

            }

            const stateAny = ctx.state as any;
            if (stateAny.joinForcesContributions && cardName) {
              delete stateAny.joinForcesContributions[cardName];
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(joinForces*): failed', err);
        }
        break;
      }

      case "temptingOfferInitiated":
      case "temptingOfferResponse":
      case "temptingOfferComplete": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const cardName = String((e as any).cardName || '').trim();

          if ((e as any).type === 'temptingOfferInitiated') {
            const rawSteps = Array.isArray((e as any).steps) ? ((e as any).steps as any[]) : [];
            const queue = gameId ? ResolutionQueueManager.getQueue(gameId) : undefined;

            for (const rawStep of rawSteps) {
              if (!rawStep || typeof rawStep !== 'object') continue;
              const stepId = String((rawStep as any).id || '').trim();
              if (!stepId || !queue) continue;
              if (queue.steps.some((step: any) => String(step?.id || '') === stepId)) continue;

              ResolutionQueueManager.addStep(gameId, {
                id: stepId,
                type: ResolutionStepType.TEMPTING_OFFER,
                playerId: String((rawStep as any).playerId || '') as any,
                description: String((rawStep as any).description || ''),
                mandatory: (rawStep as any).mandatory !== false,
                sourceId: (rawStep as any).sourceId ? String((rawStep as any).sourceId) : undefined,
                sourceName: (rawStep as any).sourceName ? String((rawStep as any).sourceName) : undefined,
                sourceImage: (rawStep as any).sourceImage,
                cardName: (rawStep as any).cardName ? String((rawStep as any).cardName) : undefined,
                effectDescription: (rawStep as any).effectDescription ? String((rawStep as any).effectDescription) : undefined,
                cardImageUrl: (rawStep as any).cardImageUrl,
                initiator: (rawStep as any).initiator ? String((rawStep as any).initiator) : undefined,
                isOpponent: (rawStep as any).isOpponent === true,
                priority: Number((rawStep as any).priority || 0),
              } as any);
            }
          } else if ((e as any).type === 'temptingOfferResponse') {
            const playerId = String((e as any).playerId || '').trim();
            const accepted = (e as any).accepted === true;
            const stepId = String((e as any).stepId || '').trim();
            const resolvedStepId = String((e as any).resolvedStepId || stepId).trim();

            const stateAny = ctx.state as any;
            stateAny.temptingOfferResponses = stateAny.temptingOfferResponses || {};
            stateAny.temptingOfferResponses[cardName] = stateAny.temptingOfferResponses[cardName] || {
              acceptedBy: [],
              initiator: String((e as any).initiator || '').trim() || undefined,
              cardName,
            };
            if (accepted) {
              const acceptedBy = stateAny.temptingOfferResponses[cardName].acceptedBy;
              if (!acceptedBy.includes(playerId)) {
                acceptedBy.push(playerId);
              }
            }

            if (gameId && resolvedStepId) {
              clearReplayQueuedStepById(gameId, resolvedStepId);
            }
          } else {
            const initiator = String((e as any).initiator || '').trim();
            const acceptedBy = Array.isArray((e as any).acceptedBy)
              ? ((e as any).acceptedBy as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
              : [];
            const initiatorBonusCount = Math.max(1, Math.floor(Number((e as any).initiatorBonusCount || (1 + acceptedBy.length))));
            const battlefield = ctx.state.battlefield = ctx.state.battlefield || [];
            const players = (ctx.state.players || []) as any[];
            const cardNameLower = cardName.toLowerCase();

            if (gameId) {
              const queue = ResolutionQueueManager.getQueue(gameId);
              const pendingTemptingOfferSteps = queue.steps.filter((step: any) =>
                String(step?.type || '') === String(ResolutionStepType.TEMPTING_OFFER) &&
                String((step as any).cardName || '') === cardName
              );
              for (const pendingStep of pendingTemptingOfferSteps) {
                ResolutionQueueManager.cancelStep(gameId, String((pendingStep as any).id || ''));
              }
            }

            if (cardNameLower.includes('discovery')) {
              const targets = [initiator, ...acceptedBy].filter(Boolean);
              for (const playerId of targets) {
                if (!gameId) continue;
                const maxSelections = playerId === initiator ? initiatorBonusCount : 1;
                const existingSearch = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
                  String(step?.type || '') === String(ResolutionStepType.LIBRARY_SEARCH) &&
                  String(step?.playerId || '') === playerId &&
                  String(step?.sourceName || '') === 'Tempt with Discovery'
                );
                if (existingSearch) continue;

                const availableCards = (ctx.libraries.get(playerId) || []).map((libraryCard: any) => ({
                  id: libraryCard.id,
                  name: libraryCard.name,
                  type_line: libraryCard.type_line,
                  oracle_text: libraryCard.oracle_text,
                  image_uris: libraryCard.image_uris,
                  card_faces: libraryCard.card_faces,
                  layout: libraryCard.layout,
                  mana_cost: libraryCard.mana_cost,
                  cmc: libraryCard.cmc,
                  colors: libraryCard.colors,
                  power: libraryCard.power,
                  toughness: libraryCard.toughness,
                  loyalty: libraryCard.loyalty,
                  color_identity: libraryCard.color_identity,
                }));

                ResolutionQueueManager.addStep(gameId, {
                  type: ResolutionStepType.LIBRARY_SEARCH,
                  playerId: playerId as any,
                  description: playerId === initiator ? `up to ${maxSelections} land card(s) (enters untapped)` : 'a land card (enters untapped)',
                  mandatory: false,
                  sourceName: 'Tempt with Discovery',
                  searchCriteria: playerId === initiator ? `up to ${maxSelections} land card(s)` : 'a land card',
                  minSelections: 0,
                  maxSelections,
                  destination: 'battlefield',
                  reveal: true,
                  shuffleAfter: true,
                  availableCards,
                  entersTapped: false,
                  filter: { types: ['land'] },
                  remainderDestination: 'shuffle',
                  remainderRandomOrder: true,
                } as any);
              }
            } else if (cardNameLower.includes('glory')) {
              const initiatorCreatures = battlefield.filter((perm: any) =>
                String(perm?.controller || '') === initiator && String(perm?.card?.type_line || '').toLowerCase().includes('creature')
              );
              for (const creature of initiatorCreatures) {
                const counters = { ...(creature.counters || {}) } as Record<string, number>;
                counters['+1/+1'] = (counters['+1/+1'] || 0) + initiatorBonusCount;
                creature.counters = counters;
              }

              for (const opponentId of acceptedBy) {
                const opponentCreatures = battlefield.filter((perm: any) =>
                  String(perm?.controller || '') === opponentId && String(perm?.card?.type_line || '').toLowerCase().includes('creature')
                );
                for (const creature of opponentCreatures) {
                  const counters = { ...(creature.counters || {}) } as Record<string, number>;
                  counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
                  creature.counters = counters;
                }
              }
            } else if (cardNameLower.includes('vengeance') || cardNameLower.includes('bunnies')) {
              const createdPermanentIdsByPlayer = ((e as any).createdPermanentIdsByPlayer && typeof (e as any).createdPermanentIdsByPlayer === 'object')
                ? ((e as any).createdPermanentIdsByPlayer as Record<string, string[]>)
                : {};
              const xValue = Math.max(1, Math.floor(Number((e as any).xValue || 3)));
              const isVengeance = cardNameLower.includes('vengeance');
              const tokenName = isVengeance ? 'Elemental' : 'Rabbit';
              const colors = isVengeance ? ['R'] : ['W'];
              const oracleText = isVengeance ? 'Haste' : '';
              const keywords = isVengeance ? ['Haste'] : undefined;
              const typeLine = isVengeance ? 'Token Creature — Elemental' : 'Token Creature — Rabbit';
              const initiatorCount = isVengeance ? xValue * initiatorBonusCount : initiatorBonusCount;

              const tokenCountsByPlayer: Record<string, number> = { [initiator]: initiatorCount };
              for (const opponentId of acceptedBy) {
                tokenCountsByPlayer[opponentId] = isVengeance ? xValue : 1;
              }

              for (const [playerId, count] of Object.entries(tokenCountsByPlayer)) {
                const persistedIds = Array.isArray(createdPermanentIdsByPlayer[playerId]) ? createdPermanentIdsByPlayer[playerId] : [];
                for (let index = 0; index < count; index++) {
                  const tokenId = String(persistedIds[index] || '').trim() || generateDeterministicId(ctx, 'tok', `${tokenName.toLowerCase()}_${playerId}_${index}`);
                  const token = {
                    id: tokenId,
                    controller: playerId,
                    owner: playerId,
                    tapped: false,
                    counters: {},
                    isToken: true,
                    summoningSickness: !isVengeance,
                    card: {
                      id: tokenId,
                      name: tokenName,
                      type_line: typeLine,
                      power: '1',
                      toughness: '1',
                      colors,
                      oracle_text: oracleText,
                      ...(keywords ? { keywords } : {}),
                    },
                  } as any;
                  battlefield.push(token);
                  triggerETBEffectsForToken(ctx as any, token, playerId as PlayerID);
                }
              }
            }

            const stateAny = ctx.state as any;
            if (stateAny.temptingOfferResponses && cardName) {
              delete stateAny.temptingOfferResponses[cardName];
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(temptingOffer*): failed', err);
        }
        break;
      }

      case "setHouseRules": {
        // Set house rules for the game
        const rules = (e as any).rules ?? (e as any).houseRules;
        try {
          if (rules && typeof rules === 'object') {
            (ctx.state as any).houseRules = { ...(ctx.state as any).houseRules, ...rules };
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(setHouseRules): failed", err);
        }
        break;
      }

      case "targetSelectionConfirm": {
        // Target selection confirmed for a spell/ability
        // The actual targeting logic is handled by the spell resolution
        ctx.bumpSeq();
        break;
      }

      case "pushTriggeredAbility": {
        // Push a triggered ability onto the stack
        // This allows triggers to be replayed correctly
        const triggerId = (e as any).triggerId;
        const sourceId = (e as any).sourceId;
        const sourceName = (e as any).sourceName;
        const controllerId = (e as any).controllerId;
        const description = (e as any).description;
        const triggerType = (e as any).triggerType;
        const effect = (e as any).effect;
        const mandatory = (e as any).mandatory;
        const value = (e as any).value;
        const permanentId = (e as any).permanentId;
        const requiresChoice = (e as any).requiresChoice;
        const requiresTarget = (e as any).requiresTarget;
        const targetType = (e as any).targetType;
        const targetConstraint = (e as any).targetConstraint;
        const needsTargetSelection = (e as any).needsTargetSelection;
        const targetZone = (e as any).targetZone;
        const targetDestination = (e as any).targetDestination;
        const targetGraveyardScope = (e as any).targetGraveyardScope;
        const destinationUsesSelectedCardOwner = (e as any).destinationUsesSelectedCardOwner;
        const battlefieldControllerMode = (e as any).battlefieldControllerMode;
        const targetAction = (e as any).targetAction;
        const targetFilterTypes = (e as any).targetFilterTypes;
        const targetFilterRequiredTypeWords = (e as any).targetFilterRequiredTypeWords;
        const targetFilterExcludeTypes = (e as any).targetFilterExcludeTypes;
        const targetFilterPermanentOnly = (e as any).targetFilterPermanentOnly;
        const targetFilterExactManaValue = (e as any).targetFilterExactManaValue;
        const targetFilterMinManaValue = (e as any).targetFilterMinManaValue;
        const targetFilterMaxManaValue = (e as any).targetFilterMaxManaValue;
        const targetTotalPowerLimit = (e as any).targetTotalPowerLimit;
        const targetCastWithoutPayingManaCost = (e as any).targetCastWithoutPayingManaCost;
        const targetCastIsOptional = (e as any).targetCastIsOptional;
        const minTargets = (e as any).minTargets;
        const maxTargets = (e as any).maxTargets;
        const preselectedTargetsPersisted = (e as any).preselectedTargetsPersisted;
        const boundGraveyardCardId = (e as any).boundGraveyardCardId;
        const boundGraveyardOwnerId = (e as any).boundGraveyardOwnerId;
        const delayedReturnAt = (e as any).delayedReturnAt;
        const battlefieldTapped = (e as any).battlefieldTapped;
        const battlefieldCounters = (e as any).battlefieldCounters;
        const battlefieldFaceDown = (e as any).battlefieldFaceDown;
        const battlefieldTurnFaceUp = (e as any).battlefieldTurnFaceUp;
        const battlefieldSuspected = (e as any).battlefieldSuspected;
        const battlefieldSetTypeLine = (e as any).battlefieldSetTypeLine;
        const battlefieldSetOracleText = (e as any).battlefieldSetOracleText;
        const battlefieldLoseAllOtherTypes = (e as any).battlefieldLoseAllOtherTypes;
        const battlefieldGrantedTypes = (e as any).battlefieldGrantedTypes;
        const isModal = (e as any).isModal;
        const modalOptions = (e as any).modalOptions;
        const targetPlayer = (e as any).targetPlayer;
        const defendingPlayer = (e as any).defendingPlayer;
        const triggeringPlayer = (e as any).triggeringPlayer;
        const damagedPlayerId = (e as any).damagedPlayerId;
        const attackingPlayerId = (e as any).attackingPlayerId;
        const damageAmount = (e as any).damageAmount;
        const damageSourcePermanentIds = (e as any).damageSourcePermanentIds;
        const damageIncludedWarriorSource = (e as any).damageIncludedWarriorSource;
        const activatedAbilityIsManaAbility = (e as any).activatedAbilityIsManaAbility;
        const triggeringStackItemId = (e as any).triggeringStackItemId;
        const triggeringSpellCastSourceZone = (e as any).triggeringSpellCastSourceZone;
        const triggeringSpell = (e as any).triggeringSpell;
        const triggeringPermanentId = (e as any).triggeringPermanentId;
        const interveningIfSubjectPermanentId = (e as any).interveningIfSubjectPermanentId;
        const interveningIfSubjectSnapshot = (e as any).interveningIfSubjectSnapshot;
        const effectData = (e as any).effectData;
        const initiativeVentureTrigger = (e as any).initiativeVentureTrigger;
        const reboundCardId = (e as any).reboundCardId;
        const paradigmCardId = (e as any).paradigmCardId;
        const targets = Array.isArray((e as any).targets)
          ? (e as any).targets.map((entry: any) => String(entry || '')).filter(Boolean)
          : undefined;
        const card = (e as any).card;
        const sourcePermanentSnapshot = (e as any).sourcePermanentSnapshot;
        const dyingCreature = (e as any).dyingCreature;
        const sacrificedPermanent = (e as any).sacrificedPermanent;
        const discardedCard = (e as any).discardedCard;
        const milledCard = (e as any).milledCard;
        
        try {
          // Check if this trigger is already on the stack (idempotency for replay)
          const existingTrigger = (ctx.state.stack || []).find((s: any) => s.id === triggerId);
          if (existingTrigger) {
            debug(1, `applyEvent(pushTriggeredAbility): trigger ${triggerId} already on stack, skipping (replay idempotency)`);
            break;
          }

          // Legacy inverted logs pushed ETBs before resolveTopOfStack; ensure the
          // subject permanent is on the battlefield before restoring the trigger.
          if ((ctx as any).isReplaying) {
            replayEnsureInterveningIfSubjectOnBattlefield(ctx as any, e as any);
          }
          
          ctx.state.stack = ctx.state.stack || [];
          ctx.state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: controllerId,
            source: sourceId,
            sourceName: sourceName,
            description: description,
            triggerType: triggerType,
            effect: effect,
            mandatory: typeof mandatory === 'boolean' ? mandatory : true,
            ...(typeof value !== 'undefined' ? { value } : null),
            ...(permanentId ? { permanentId } : null),
            ...(typeof requiresChoice === 'boolean' ? { requiresChoice } : null),
            ...(typeof requiresTarget === 'boolean' ? { requiresTarget } : null),
            ...(targetType ? { targetType } : null),
            ...(targetConstraint ? { targetConstraint } : null),
            ...(typeof needsTargetSelection === 'boolean' ? { needsTargetSelection } : null),
            ...(targetZone ? { targetZone } : null),
            ...(targetDestination ? { targetDestination } : null),
            ...(targetGraveyardScope ? { targetGraveyardScope } : null),
            ...(destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
            ...(battlefieldControllerMode ? { battlefieldControllerMode } : null),
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
            ...(preselectedTargetsPersisted === true ? { preselectedTargetsPersisted: true } : null),
            ...(boundGraveyardCardId ? { boundGraveyardCardId } : null),
            ...(boundGraveyardOwnerId ? { boundGraveyardOwnerId } : null),
            ...(delayedReturnAt ? { delayedReturnAt } : null),
            ...(battlefieldTapped === true ? { battlefieldTapped: true } : null),
            ...(battlefieldCounters && typeof battlefieldCounters === 'object' ? { battlefieldCounters } : null),
            ...(battlefieldFaceDown === true ? { battlefieldFaceDown: true } : null),
            ...(battlefieldTurnFaceUp === true ? { battlefieldTurnFaceUp: true } : null),
            ...(battlefieldSuspected === true ? { battlefieldSuspected: true } : null),
            ...(battlefieldSetTypeLine ? { battlefieldSetTypeLine } : null),
            ...(typeof battlefieldSetOracleText === 'string' ? { battlefieldSetOracleText } : null),
            ...(battlefieldLoseAllOtherTypes === true ? { battlefieldLoseAllOtherTypes: true } : null),
            ...(Array.isArray(battlefieldGrantedTypes) ? { battlefieldGrantedTypes } : null),
            ...(typeof isModal === 'boolean' ? { isModal } : null),
            ...(Array.isArray(modalOptions) ? { modalOptions } : null),
            ...(targetPlayer ? { targetPlayer } : null),
            ...(defendingPlayer ? { defendingPlayer } : null),
            ...(triggeringPlayer != null ? { triggeringPlayer } : null),
            ...(damagedPlayerId ? { damagedPlayerId } : null),
            ...(attackingPlayerId ? { attackingPlayerId } : null),
            ...(typeof damageAmount === 'number' ? { damageAmount } : null),
            ...(Array.isArray(damageSourcePermanentIds) ? { damageSourcePermanentIds } : null),
            ...(typeof damageIncludedWarriorSource === 'boolean' ? { damageIncludedWarriorSource } : null),
            ...(typeof activatedAbilityIsManaAbility === 'boolean' ? { activatedAbilityIsManaAbility } : null),
            ...(triggeringStackItemId ? { triggeringStackItemId } : null),
            ...(triggeringSpellCastSourceZone ? { triggeringSpellCastSourceZone } : null),
            ...(triggeringSpell && typeof triggeringSpell === 'object' ? { triggeringSpell } : null),
            ...(triggeringPermanentId ? { triggeringPermanentId } : null),
            ...(interveningIfSubjectPermanentId ? { interveningIfSubjectPermanentId } : null),
            ...(interveningIfSubjectSnapshot && typeof interveningIfSubjectSnapshot === 'object' ? { interveningIfSubjectSnapshot } : null),
            ...(effectData && typeof effectData === 'object' ? { effectData } : null),
            ...(initiativeVentureTrigger === true ? { initiativeVentureTrigger: true } : null),
            ...(reboundCardId ? { reboundCardId } : null),
            ...(paradigmCardId ? { paradigmCardId } : null),
            ...(Array.isArray(targets) ? { targets } : null),
            ...(card && typeof card === 'object' ? { card } : null),
            ...(sourcePermanentSnapshot && typeof sourcePermanentSnapshot === 'object' ? { sourcePermanentSnapshot } : null),
            ...(dyingCreature && typeof dyingCreature === 'object' ? { dyingCreature } : null),
            ...(sacrificedPermanent && typeof sacrificedPermanent === 'object' ? { sacrificedPermanent } : null),
            ...(discardedCard && typeof discardedCard === 'object' ? { discardedCard } : null),
            ...(milledCard && typeof milledCard === 'object' ? { milledCard } : null),
          } as any);
          pushTriggerDoublerCopies(ctx.state, (ctx.state.stack || [])[(ctx.state.stack || []).length - 1]);
          
          debug(2, `[applyEvent] Pushed triggered ability: ${sourceName} - ${description}`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(pushTriggeredAbility): failed", err);
        }
        break;
      }

      case "queueTriggerOrderStep": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const stepId = String((e as any).stepId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const description = String((e as any).description || '').trim();
          const mandatory = (e as any).mandatory !== false;
          const requireAll = (e as any).requireAll === true;
          const triggers = Array.isArray((e as any).triggers)
            ? ((e as any).triggers as any[])
                .map((trigger: any) => ({
                  id: String(trigger?.id || '').trim(),
                  sourceName: String(trigger?.sourceName || '').trim(),
                  effect: String(trigger?.effect || '').trim(),
                  ...(trigger?.imageUrl ? { imageUrl: String(trigger.imageUrl) } : null),
                }))
                .filter((trigger: any) => Boolean(trigger.id))
            : [];

          if (gameId && playerId && triggers.length > 1) {
            const existingStep = ResolutionQueueManager
              .getQueue(gameId)
              .steps
              .find((step: any) => step && String(step.id || '').trim() === stepId);

            if (!existingStep) {
              ResolutionQueueManager.addStep(gameId, {
                ...(stepId ? { id: stepId } : null),
                type: ResolutionStepType.TRIGGER_ORDER,
                playerId: playerId as PlayerID,
                description: description || `Choose the order to put ${triggers.length} triggered abilities on the stack`,
                mandatory,
                triggers,
                requireAll,
              } as any, { allowDuringReplay: true });
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(queueTriggerOrderStep): failed', err);
        }
        break;
      }

      case "scheduleDelayedGraveyardReturn": {
        try {
          const stateAny = ctx.state as any;
          const entries = Array.isArray((e as any).entries) ? (e as any).entries : [];
          stateAny.pendingDelayedGraveyardReturns = Array.isArray(stateAny.pendingDelayedGraveyardReturns)
            ? stateAny.pendingDelayedGraveyardReturns
            : [];

          for (const rawEntry of entries) {
            const scheduleId = String(rawEntry?.scheduleId || '').trim();
            const cardId = String(rawEntry?.cardId || '').trim();
            const zoneOwnerId = String(rawEntry?.zoneOwnerId || '').trim();
            if (!cardId || !zoneOwnerId) continue;
            if (scheduleId && stateAny.pendingDelayedGraveyardReturns.some((entry: any) => String(entry?.scheduleId || '') === scheduleId)) {
              continue;
            }
            stateAny.pendingDelayedGraveyardReturns.push({
              ...(scheduleId ? { scheduleId } : null),
              cardId,
              zoneOwnerId,
              fireAtTurnNumber: Number(rawEntry?.fireAtTurnNumber ?? 0) || 0,
              fireAtStep: String(rawEntry?.fireAtStep || '').toLowerCase() === 'upkeep' ? 'upkeep' : 'end_step',
              fireAtPlayerId: String(rawEntry?.fireAtPlayerId || '').trim() || undefined,
              sourceName: String(rawEntry?.sourceName || (e as any).sourceName || 'Delayed trigger'),
              createdBy: String(rawEntry?.createdBy || (e as any).playerId || '').trim() || undefined,
              destination: String(rawEntry?.destination || '').toLowerCase() === 'battlefield' ? 'battlefield' : 'hand',
              destinationUsesSelectedCardOwner: rawEntry?.destinationUsesSelectedCardOwner === true,
              battlefieldControllerMode: String(rawEntry?.battlefieldControllerMode || '').toLowerCase() === 'owner' ? 'owner' : undefined,
              battlefieldControllerId: String(rawEntry?.battlefieldControllerId || '').trim() || undefined,
              battlefieldTapped: rawEntry?.battlefieldTapped === true,
              battlefieldCounters: rawEntry?.battlefieldCounters && typeof rawEntry.battlefieldCounters === 'object'
                ? { ...(rawEntry.battlefieldCounters as Record<string, number>) }
                : undefined,
              ...(rawEntry?.battlefieldFaceDown === true ? { battlefieldFaceDown: true } : null),
              ...(rawEntry?.battlefieldTurnFaceUp === true ? { battlefieldTurnFaceUp: true } : null),
              ...(rawEntry?.battlefieldSuspected === true ? { battlefieldSuspected: true } : null),
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(scheduleDelayedGraveyardReturn): failed', err);
        }
        break;
      }

      case "scheduleDelayedDrawAtNextUpkeep": {
        try {
          const stateAny = ctx.state as any;
          const entries = Array.isArray((e as any).entries) ? (e as any).entries : [];
          stateAny.pendingDelayedDrawsAtNextUpkeep = Array.isArray(stateAny.pendingDelayedDrawsAtNextUpkeep)
            ? stateAny.pendingDelayedDrawsAtNextUpkeep
            : [];

          for (const rawEntry of entries) {
            const scheduleId = String(rawEntry?.scheduleId || '').trim();
            const playerId = String(rawEntry?.playerId || rawEntry?.createdBy || (e as any).playerId || '').trim();
            if (!playerId) continue;
            if (scheduleId && stateAny.pendingDelayedDrawsAtNextUpkeep.some((entry: any) => String(entry?.scheduleId || '') === scheduleId)) {
              continue;
            }

            const count = Math.max(1, Math.floor(Number(rawEntry?.count || 1)));
            stateAny.pendingDelayedDrawsAtNextUpkeep.push({
              ...(scheduleId ? { scheduleId } : null),
              playerId,
              createdBy: String(rawEntry?.createdBy || playerId).trim(),
              sourceId: String(rawEntry?.sourceId || '').trim() || undefined,
              sourceName: String(rawEntry?.sourceName || (e as any).sourceName || 'Delayed trigger').trim() || 'Delayed trigger',
              count,
              fireAtTurnNumber: Number(rawEntry?.fireAtTurnNumber ?? 0) || 0,
              fireAtStep: 'upkeep',
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(scheduleDelayedDrawAtNextUpkeep): failed', err);
        }
        break;
      }

      case "sacrificeWhenYouDoResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const sourceName = String((e as any).sourceName || 'Ability');
          const sourcePermanentId = (e as any).sourcePermanentId;
          const sourcePermanentSnapshot = (e as any).sourcePermanentSnapshot;
          const sacrificedPermanentId = String((e as any).sacrificedPermanentId || '').trim();
          const damage = Number((e as any).damage || 0);
          const lifeGain = Number((e as any).lifeGain || 0);
          const triggerId = String((e as any).triggerId || '').trim();
          const description = String((e as any).description || `${sourceName} deals ${damage} damage to any target and you gain ${lifeGain} life.`).trim();
          const effect = String((e as any).effect || description).trim();
          const card = (e as any).card || sourcePermanentSnapshot?.card;
          const requiresTarget = (e as any).requiresTarget === true;
          const targetType = String((e as any).targetType || (requiresTarget ? 'any_target' : '')).trim();
          const targetConstraint = String((e as any).targetConstraint || '').trim().toLowerCase();
          const targetDescription = String((e as any).targetDescription || (targetType ? (['any', 'any target', 'any_target'].includes(targetType.toLowerCase()) ? 'any target' : `target ${targetType}`) : 'target')).trim();
          const minTargets = typeof (e as any).minTargets === 'number' ? Number((e as any).minTargets) : 1;
          const maxTargets = typeof (e as any).maxTargets === 'number' ? Number((e as any).maxTargets) : 1;

          if (sacrificedPermanentId) {
            const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
            const stillOnBattlefield = battlefield.some((perm: any) => perm && String(perm.id || '') === sacrificedPermanentId);
            if (stillOnBattlefield) {
              sacrificePermanent({ ...(ctx as any), zones: ctx.state?.zones } as any, sacrificedPermanentId, playerId);
            }
          }

          if (triggerId) {
            ctx.state.stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
            const existingTrigger = (ctx.state.stack as any[]).find((item: any) => item && String(item.id || '') === triggerId);
            if (!existingTrigger) {
              (ctx.state.stack as any[]).push({
                id: triggerId,
                type: 'triggered_ability',
                controller: playerId,
                source: sourcePermanentId || null,
                ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
                sourceName,
                description,
                effect,
                mandatory: true,
                ...(card && typeof card === 'object' ? { card } : null),
                ...(sourcePermanentSnapshot && typeof sourcePermanentSnapshot === 'object' ? { sourcePermanentSnapshot } : null),
                ...(requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
                ...(targetType ? { targetType } : null),
                ...(targetConstraint ? { targetConstraint } : null),
                ...((e as any).targetZone ? { targetZone: (e as any).targetZone } : null),
                ...((e as any).targetDestination ? { targetDestination: (e as any).targetDestination } : null),
                ...((e as any).targetGraveyardScope ? { targetGraveyardScope: (e as any).targetGraveyardScope } : null),
                ...((e as any).destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
                ...((e as any).battlefieldControllerMode ? { battlefieldControllerMode: (e as any).battlefieldControllerMode } : null),
                ...((e as any).battlefieldCounters && typeof (e as any).battlefieldCounters === 'object' ? { battlefieldCounters: (e as any).battlefieldCounters } : null),
                ...((e as any).targetAction ? { targetAction: (e as any).targetAction } : null),
                ...(Array.isArray((e as any).targetFilterTypes) ? { targetFilterTypes: (e as any).targetFilterTypes } : null),
                ...(Array.isArray((e as any).targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: (e as any).targetFilterRequiredTypeWords } : null),
                ...(Array.isArray((e as any).targetFilterExcludeTypes) ? { targetFilterExcludeTypes: (e as any).targetFilterExcludeTypes } : null),
                ...((e as any).targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
                ...(typeof (e as any).targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: (e as any).targetFilterExactManaValue } : null),
                ...(typeof (e as any).targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: (e as any).targetFilterMinManaValue } : null),
                ...(typeof (e as any).targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: (e as any).targetFilterMaxManaValue } : null),
                ...(typeof (e as any).targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: (e as any).targetTotalPowerLimit } : null),
                ...(typeof minTargets === 'number' ? { minTargets } : null),
                ...(typeof maxTargets === 'number' ? { maxTargets } : null),
              } as any);
            }

            if ((ctx as any).gameId && requiresTarget) {
              const queue = ResolutionQueueManager.getQueue((ctx as any).gameId);
              const normalizedTargetType = targetType.toLowerCase();
              const existingTargetStep = queue.steps.find((step: any) =>
                step &&
                String((step as any).type || '') === String(ResolutionStepType.TARGET_SELECTION) &&
                String((step as any).sourceId || '') === triggerId &&
                Array.isArray((step as any).targetTypes) &&
                (step as any).targetTypes.map((entry: any) => String(entry).toLowerCase()).includes(normalizedTargetType)
              );

              if (!existingTargetStep) {
                const permanentMatches = (perm: any): boolean => {
                  if (!perm) return false;
                  const typeLine = String(perm?.card?.type_line || '').toLowerCase();
                  if (targetConstraint === 'opponent' && String(perm.controller || '') === playerId) return false;
                  if (targetConstraint === 'you' && String(perm.controller || '') !== playerId) return false;
                  if (['any', 'any target', 'any_target', 'permanent'].includes(normalizedTargetType)) return true;
                  if (normalizedTargetType === 'creature or planeswalker') return typeLine.includes('creature') || typeLine.includes('planeswalker');
                  if (normalizedTargetType === 'artifact or enchantment') return typeLine.includes('artifact') || typeLine.includes('enchantment');
                  if (normalizedTargetType === 'nonland permanent') return !typeLine.includes('land');
                  if (normalizedTargetType === 'noncreature permanent') return !typeLine.includes('creature');
                  return normalizedTargetType.length > 0 && typeLine.includes(normalizedTargetType);
                };
                const targetsPlayers = ['any', 'any target', 'any_target', 'player', 'opponent'].includes(normalizedTargetType);
                const validPlayerTargets = targetsPlayers
                  ? ((ctx.state.players || []) as any[])
                      .filter((player: any) => player && player.id && (player as any).hasLost !== true)
                      .filter((player: any) => normalizedTargetType === 'opponent' || targetConstraint === 'opponent' ? String(player.id) !== playerId : true)
                      .map((player: any) => ({
                        id: player.id,
                        label: player.name || player.id,
                        description: 'player',
                      }))
                  : [];
                const validPermanentTargets = ((ctx.state.battlefield || []) as any[])
                  .filter(permanentMatches)
                  .map((perm: any) => ({
                    id: perm.id,
                    label: perm.card?.name || 'Permanent',
                    description: perm.card?.type_line || 'permanent',
                    imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
                  }));
                const validTargets = [...validPlayerTargets, ...validPermanentTargets];

                if (validTargets.length >= Math.max(0, minTargets)) {
                  const triggerItem = (ctx.state.stack as any[]).find((item: any) => item && String(item.id || '') === triggerId) || {
                    id: triggerId,
                    type: 'triggered_ability',
                    controller: playerId,
                    source: sourcePermanentId || null,
                    ...(sourcePermanentId ? { permanentId: sourcePermanentId } : null),
                    sourceName,
                    description,
                    effect,
                    mandatory: true,
                    ...(card && typeof card === 'object' ? { card } : null),
                    ...(sourcePermanentSnapshot && typeof sourcePermanentSnapshot === 'object' ? { sourcePermanentSnapshot } : null),
                    ...(requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
                    ...(targetType ? { targetType } : null),
                  };

                  ResolutionQueueManager.addStep((ctx as any).gameId, {
                    type: ResolutionStepType.TARGET_SELECTION,
                    playerId: playerId as any,
                    description: `${sourceName}: Choose ${targetDescription}`,
                    mandatory: true,
                    sourceId: triggerId,
                    sourceName,
                    validTargets,
                    targetTypes: [targetType],
                    minTargets,
                    maxTargets: Math.min(validTargets.length, Math.max(minTargets, maxTargets)),
                    targetDescription,
                    targetedTriggeredAbility: true,
                    triggerItem,
                    targetedTriggeredAbilitySourceName: sourceName,
                    targetedTriggeredAbilityDescription: description,
                    targetedTriggeredAbilityController: playerId,
                  } as any);
                }
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeWhenYouDoResolve): failed', err);
        }
        break;
      }

      case "choosePileFromSplitResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return false;
            });
          }

          const action = String((e as any).action || '').trim();
          if (action === 'move_cards') {
            const movePlayerId = String((e as any).movePlayerId || '').trim();
            const chosenDestination = String((e as any).chosenDestination || '').trim();
            const otherDestination = String((e as any).otherDestination || '').trim();
            const chosenCards = Array.isArray((e as any).chosenCards)
              ? ((e as any).chosenCards as any[]).map((card: any) => ({ ...card }))
              : [];
            const otherCards = Array.isArray((e as any).otherCards)
              ? ((e as any).otherCards as any[]).map((card: any) => ({ ...card }))
              : [];
            if (!movePlayerId || !chosenDestination || !otherDestination) break;

            const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
            const z = (zones[movePlayerId] = zones[movePlayerId] || {
              library: [],
              libraryCount: 0,
              hand: [],
              handCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            });

            const chosenZone: any[] = Array.isArray((z as any)[chosenDestination]) ? (z as any)[chosenDestination] : [];
            const otherZone: any[] = Array.isArray((z as any)[otherDestination]) ? (z as any)[otherDestination] : [];

            for (const card of chosenCards) chosenZone.push({ ...card, zone: chosenDestination });
            for (const card of otherCards) otherZone.push({ ...card, zone: otherDestination });

            (z as any)[chosenDestination] = chosenZone;
            (z as any)[otherDestination] = otherZone;
            if (chosenDestination === 'hand') z.handCount = chosenZone.length;
            if (chosenDestination === 'library') z.libraryCount = chosenZone.length;
            if (otherDestination === 'hand') z.handCount = otherZone.length;
            if (otherDestination === 'library') z.libraryCount = otherZone.length;
          } else if (action === 'sacrifice_permanents') {
            const permanentIds = Array.isArray((e as any).permanentIds)
              ? ((e as any).permanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
              : [];
            for (const permanentId of permanentIds) {
              const battlefield = Array.isArray(ctx.state?.battlefield) ? (ctx.state.battlefield as any[]) : [];
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId) as any;
              if (!permanent) continue;
              const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
                ? { ...(permanent.card || {}), zone: 'graveyard' }
                : null;
              const graveyardOwnerId = String(permanent?.owner || permanent?.controller || (e as any).targetPlayerId || '').trim();
              movePermanentToGraveyard(ctx as any, permanentId, true);

              if (tokenGraveyardSnapshot && graveyardOwnerId) {
                const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
                const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                  hand: [],
                  handCount: 0,
                  libraryCount: 0,
                  graveyard: [],
                  graveyardCount: 0,
                  exile: [],
                  exileCount: 0,
                });
                playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

                const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                  if (!card) return false;
                  const cardId = String((card as any).id || '').trim();
                  const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                  if (cardId && snapshotId) return cardId === snapshotId;
                  return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
                });

                if (!alreadyPresent) {
                  (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                  playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
                }
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(choosePileFromSplitResolve): failed', err);
        }
        break;
      }

      case "sacrificeSelectionResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const permanentIds = Array.isArray((e as any).permanentIds)
            ? ((e as any).permanentIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesSacrificeSelectionResolveStep(step, e as any);
            });
          }

          for (const permanentId of permanentIds) {
            const stillOnBattlefield = Array.isArray(ctx.state?.battlefield)
              ? (ctx.state.battlefield as any[]).some((entry: any) => entry && String(entry.id || '') === permanentId)
              : false;
            if (!stillOnBattlefield) continue;
            const battlefield = Array.isArray(ctx.state?.battlefield) ? (ctx.state.battlefield as any[]) : [];
            const permanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === permanentId) as any;
            const tokenGraveyardSnapshot = permanent?.isToken && permanent?.card
              ? { ...(permanent.card || {}), zone: 'graveyard' }
              : null;
            const graveyardOwnerId = String(permanent?.owner || permanent?.controller || (e as any).playerId || '').trim();
            movePermanentToGraveyard(ctx as any, permanentId, true);

            if (tokenGraveyardSnapshot && graveyardOwnerId) {
              const zones = ((ctx.state as any).zones = (ctx.state as any).zones || {});
              const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              });
              playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

              const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
                if (!card) return false;
                const cardId = String((card as any).id || '').trim();
                const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
                if (cardId && snapshotId) return cardId === snapshotId;
                return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
              });

              if (!alreadyPresent) {
                (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
                playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
              }
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(sacrificeSelectionResolve): failed', err);
        }
        break;
      }

      case "divineReckoningChoiceResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const batchId = String((e as any).batchId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const selectedPermanentId = String((e as any).selectedPermanentId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim() || undefined;
          const sourceName = String((e as any).sourceName || 'Divine Reckoning').trim() || 'Divine Reckoning';
          const expectedPlayerIds = Array.isArray((e as any).expectedPlayerIds)
            ? ((e as any).expectedPlayerIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (gameId && resolvedStepId) {
            clearReplayQueuedSteps(gameId, (step: any) => String(step?.id || '').trim() === resolvedStepId);
          }

          if (batchId) {
            createDivineReckoningChoiceBatch(ctx.state, {
              id: batchId,
              sourceId,
              sourceName,
              expectedPlayerIds,
            });
          }

          if (batchId && playerId && selectedPermanentId) {
            recordDivineReckoningChoice(ctx.state, batchId, {
              playerId,
              permanentId: selectedPermanentId,
              sourceId,
              sourceName,
              expectedPlayerIds,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(divineReckoningChoiceResolve): failed', err);
        }
        break;
      }

      case "divineReckoningBatchResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const batchId = String((e as any).batchId || '').trim();
          const survivorIds = Array.isArray((e as any).survivorIds)
            ? ((e as any).survivorIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (gameId && batchId) {
            clearReplayQueuedSteps(gameId, (step: any) => String((step as any)?.divineReckoningBatchId || '').trim() === batchId);
          }

          applyDivineReckoningBatchResult(ctx as any, survivorIds);
          clearDivineReckoningChoiceBatch(ctx.state, batchId);

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(divineReckoningBatchResolve): failed', err);
        }
        break;
      }

      case "prisonersDilemmaChoiceResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const batchId = String((e as any).batchId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const choice = String((e as any).choice || '').trim().toLowerCase();
          const sourceId = String((e as any).sourceId || '').trim() || undefined;
          const sourceName = String((e as any).sourceName || "Prisoner's Dilemma").trim() || "Prisoner's Dilemma";
          const expectedPlayerIds = Array.isArray((e as any).expectedPlayerIds)
            ? ((e as any).expectedPlayerIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if (gameId && resolvedStepId) {
            clearReplayQueuedSteps(gameId, (step: any) => String(step?.id || '').trim() === resolvedStepId);
          }

          if (batchId) {
            createPrisonersDilemmaChoiceBatch(ctx.state, {
              id: batchId,
              sourceId,
              sourceName,
              expectedPlayerIds,
            });
          }

          if (batchId && playerId && (choice === 'silence' || choice === 'snitch')) {
            recordPrisonersDilemmaChoice(ctx.state, batchId, {
              playerId,
              choice,
              sourceId,
              sourceName,
              expectedPlayerIds,
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(prisonersDilemmaChoiceResolve): failed', err);
        }
        break;
      }

      case "prisonersDilemmaBatchResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const batchId = String((e as any).batchId || '').trim();
          const expectedPlayerIds = Array.isArray((e as any).expectedPlayerIds)
            ? ((e as any).expectedPlayerIds as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];
          const choices = (e as any).choices && typeof (e as any).choices === 'object' && !Array.isArray((e as any).choices)
            ? Object.fromEntries(
                Object.entries((e as any).choices)
                  .map(([playerId, choice]) => [String(playerId || '').trim(), String(choice || '').trim().toLowerCase()])
                  .filter(([playerId, choice]) => Boolean(playerId) && (choice === 'silence' || choice === 'snitch')),
              ) as Record<string, string>
            : {};
          const damageByPlayerId = (e as any).damageByPlayerId && typeof (e as any).damageByPlayerId === 'object' && !Array.isArray((e as any).damageByPlayerId)
            ? Object.fromEntries(
                Object.entries((e as any).damageByPlayerId)
                  .map(([playerId, amount]) => [String(playerId || '').trim(), Number(amount || 0)])
                  .filter(([playerId, amount]) => Boolean(playerId) && Number(amount) > 0),
              ) as Record<string, number>
            : undefined;

          if (gameId && batchId) {
            clearReplayQueuedSteps(gameId, (step: any) => String((step as any)?.prisonersDilemmaBatchId || '').trim() === batchId);
          }

          applyPrisonersDilemmaBatchResult(ctx as any, {
            expectedPlayerIds,
            choices,
            damageByPlayerId,
          });
          clearPrisonersDilemmaChoiceBatch(ctx.state, batchId);

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(prisonersDilemmaBatchResolve): failed', err);
        }
        break;
      }

      case "dungeonRoomPenaltyChoiceResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const choice = String((e as any).choice || '').trim().toLowerCase();

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomPenaltyChoiceStep(step, e as any);
            });
          }

          if (choice === 'lose_life') {
            applyDungeonTargetPlayerEffect(ctx as any, String((e as any).playerId || '').trim() as any, {
              dungeonId: String((e as any).dungeonId || '').trim(),
              roomId: String((e as any).currentRoomId || '').trim(),
              amount: Number((e as any).amount || 0),
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonRoomPenaltyChoiceResolve): failed', err);
        }
        break;
      }

      case "dungeonRoomFreeCastChoiceResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomFreeCastChoiceStep(step, e as any);
            });
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonRoomFreeCastChoiceResolve): failed', err);
        }
        break;
      }

      case "dungeonRoomThroneResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const selectedCard = (e as any).selectedCard;
          const createdPermanentId = String((e as any).createdPermanentId || '').trim();
          const selectedCardId = String((e as any).selectedCardId || selectedCard?.id || '').trim();
          const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
            ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
            : [];
          const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
          const libraryAfterSnapshot = hasLibraryAfterField
            ? cloneLibraryCards((e as any).libraryAfter as any[])
            : [];
          const libraryAfter = hasLibraryAfterField
            ? libraryAfterSnapshot
            : buildLibraryAfterSearchResolve(
                getPlayerLibraryFromContext(ctx, playerId),
                selectedCardId ? [selectedCardId] : [],
                remainingLibraryIds.length > 0 ? remainingLibraryIds : undefined,
              );
          const turnApplied = Number((e as any).turnApplied || 0);
          const sourceName = String((e as any).sourceName || 'Throne of the Dead Three').trim() || 'Throne of the Dead Three';

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return matchesDungeonRoomThroneChoiceStep(step, e as any);
            });
          }

          if (playerId) {
            const zones = ctx.state.zones = ctx.state.zones || {};
            const z = zones[playerId] = zones[playerId] || {
              hand: [],
              handCount: 0,
              libraryCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            };
            z.libraryCount = libraryAfter.length;
            if (ctx.libraries?.set) {
              ctx.libraries.set(playerId, cloneLibraryCards(libraryAfter));
            }
          }

          if (playerId && selectedCard && createdPermanentId) {
            ctx.state.battlefield = ctx.state.battlefield || [];
            const existingPermanent = (ctx.state.battlefield as any[]).find((permanent: any) => String(permanent?.id || '') === createdPermanentId);
            if (!existingPermanent) {
              const typeLine = String(selectedCard?.type_line || '');
              const isCreature = typeLine.toLowerCase().includes('creature');
              const rawPower = selectedCard?.power;
              const rawToughness = selectedCard?.toughness;
              const power = Number.isFinite(Number(rawPower)) ? Number(rawPower) : undefined;
              const toughness = Number.isFinite(Number(rawToughness)) ? Number(rawToughness) : undefined;

              (ctx.state.battlefield as any[]).push({
                id: createdPermanentId,
                controller: playerId,
                owner: playerId,
                tapped: false,
                counters: { '+1/+1': 3 },
                ...(power != null ? { basePower: power } : {}),
                ...(toughness != null ? { baseToughness: toughness } : {}),
                summoningSickness: isCreature,
                grantedAbilities: ['Hexproof'],
                untilNextTurnGrants: [{
                  controllerId: playerId,
                  turnApplied,
                  grantedAbilities: ['Hexproof'],
                  sourceName,
                  kind: 'hexproof',
                }],
                card: { ...selectedCard, zone: 'battlefield' },
              } as any);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonRoomThroneResolve): failed', err);
        }
        break;
      }

      case "ventureChooseDungeonResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          if (!playerId) break;

          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.ventureChooseDungeon === true &&
                String(step?.playerId || '').trim() === playerId
              );
            });
          }

          const stateAny = ctx.state as any;
          stateAny.dungeonProgress = stateAny.dungeonProgress || {};
          const normalizedProgress = normalizeDungeonProgress(e);
          if (!normalizedProgress) break;
          stateAny.dungeonProgress[playerId] = normalizedProgress;
          applyAutomaticDungeonRoomEffect(ctx as any, playerId as any, normalizedProgress);

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(ventureChooseDungeonResolve): failed', err);
        }
        break;
      }

      case "ventureChooseRoomResolve": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          if (!playerId) break;

          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const dungeonId = String((e as any).dungeonId || '').trim();
          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any)?.ventureChooseRoom === true &&
                String(step?.playerId || '').trim() === playerId &&
                (!dungeonId || String((step as any)?.ventureDungeonId || '').trim() === dungeonId)
              );
            });
          }

          const stateAny = ctx.state as any;
          stateAny.dungeonProgress = stateAny.dungeonProgress || {};
          const normalizedProgress = normalizeDungeonProgress(e);
          if (!normalizedProgress) break;
          applyAutomaticDungeonRoomEffect(ctx as any, playerId as any, normalizedProgress);

          if ((e as any).completed === true) {
            markDungeonCompleted(stateAny, playerId, String(normalizedProgress.dungeonName || '').trim());
            delete stateAny.dungeonProgress[playerId];
          } else {
            stateAny.dungeonProgress[playerId] = normalizedProgress;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(ventureChooseRoomResolve): failed', err);
        }
        break;
      }

      case "dungeonTargetPlayerResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const selectedPlayerId = String((e as any).selectedPlayerId || '').trim();

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return (
                (step as any)?.dungeonTargetPlayerEffect != null &&
                String(step?.playerId || '').trim() === String((e as any).playerId || '').trim() &&
                String((step as any)?.dungeonTargetPlayerEffect?.dungeonId || '').trim() === String((e as any).dungeonId || '').trim() &&
                String((step as any)?.dungeonTargetPlayerEffect?.roomId || '').trim() === String((e as any).currentRoomId || '').trim()
              );
            });
          }

          applyDungeonTargetPlayerEffect(ctx as any, selectedPlayerId as any, {
            dungeonId: String((e as any).dungeonId || '').trim(),
            roomId: String((e as any).currentRoomId || '').trim(),
            amount: Number((e as any).amount || 0),
          });

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonTargetPlayerResolve): failed', err);
        }
        break;
      }

      case "dungeonTargetCreatureResolve": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const selectedPermanentId = String((e as any).selectedPermanentId || '').trim();

          if (gameId) {
            clearReplayQueuedSteps(gameId, (step: any) => {
              if (!step) return false;
              if (resolvedStepId && String(step?.id || '').trim() === resolvedStepId) return true;
              return (
                (step as any)?.dungeonTargetCreatureEffect != null &&
                String(step?.playerId || '').trim() === String((e as any).playerId || '').trim() &&
                String((step as any)?.dungeonTargetCreatureEffect?.dungeonId || '').trim() === String((e as any).dungeonId || '').trim() &&
                String((step as any)?.dungeonTargetCreatureEffect?.roomId || '').trim() === String((e as any).currentRoomId || '').trim()
              );
            });
          }

          applyDungeonTargetCreatureEffect(
            ctx as any,
            selectedPermanentId,
            String((e as any).goadedByPlayerId || (e as any).playerId || '').trim() as any,
            {
              dungeonId: String((e as any).dungeonId || '').trim(),
              roomId: String((e as any).currentRoomId || '').trim(),
              amount: Number((e as any).amount || 0),
              counterType: String((e as any).counterType || '').trim() || undefined,
              powerDelta: Number((e as any).powerDelta || 0),
              toughnessDelta: Number((e as any).toughnessDelta || 0),
              grantText: String((e as any).grantText || '').trim() || undefined,
              sourceName: String((e as any).sourceName || '').trim() || undefined,
            },
          );

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(dungeonTargetCreatureResolve): failed', err);
        }
        break;
      }

      case "resolutionStepTimeoutRecovery": {
        try {
          const gameId = String((ctx as any).gameId || '').trim();
          const cancelledStepIds = Array.isArray((e as any).cancelledStepIds)
            ? ((e as any).cancelledStepIds as any[]).map((stepId: any) => String(stepId || '').trim()).filter(Boolean)
            : [];
          const fallbackStepId = String((e as any).stepId || '').trim();
          const stepIds = cancelledStepIds.length > 0
            ? cancelledStepIds
            : (fallbackStepId ? [fallbackStepId] : []);

          if (gameId) {
            for (const stepId of stepIds) {
              ResolutionQueueManager.cancelStep(gameId, stepId);
            }

            const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);
            if (!pendingSummary.hasPending && (ctx.state as any)?.priority === null && (ctx.state as any)?.turnPlayer) {
              (ctx.state as any).priority = (ctx.state as any).turnPlayer;
              (ctx.state as any).priorityPassedBy = new Set<string>();
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(resolutionStepTimeoutRecovery): failed', err);
        }
        break;
      }

      case "resolveTriggeredAbility": {
        // Resolve a triggered ability - execute its effect
        const triggerId = (e as any).triggerId;
        const effect = (e as any).effect;
        const controllerId = (e as any).controllerId;
        const sourceName = (e as any).sourceName;
        
        try {
          // The actual effect execution is handled by resolveTopOfStack
          // This event just records that the trigger was resolved
          debug(2, `[applyEvent] Resolved triggered ability: ${sourceName} - ${effect}`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(resolveTriggeredAbility): failed", err);
        }
        break;
      }

      case "executeEffect": {
        // Execute a game effect (token creation, life change, draw, mill, etc.)
        const effectType = (e as any).effectType;
        const controllerId = (e as any).controllerId;
        const targetId = (e as any).targetId;
        const amount = (e as any).amount;
        const tokenData = (e as any).tokenData;

        if (
          (ctx as any).isReplaying
          && ((e as any).oracleIrReplayMutation === true || (e as any).effectProgramMutation === true)
        ) {
          consumeReplayedTriggeredAbilityStackItems(ctx, e as Record<string, unknown>);
        }
        
        try {
          switch (effectType) {
            case 'createToken': {
              if (tokenData) {
                ctx.state.battlefield = ctx.state.battlefield || [];
                const tokenId = tokenData.id || `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const typeLine = String(tokenData.typeLine || '');
                const isCreature = typeLine.toLowerCase().includes('creature');
                const rawPower = tokenData.power;
                const rawToughness = tokenData.toughness;
                const power = Number.isFinite(Number(rawPower)) ? Number(rawPower) : undefined;
                const toughness = Number.isFinite(Number(rawToughness)) ? Number(rawToughness) : undefined;
                
                // Check if token already exists (replay idempotency)
                const existingToken = ctx.state.battlefield.find((p: any) => p.id === tokenId);
                if (existingToken) {
                  debug(1, `applyEvent(executeEffect/createToken): token ${tokenId} already exists, skipping`);
                  break;
                }
                
                ctx.state.battlefield.push({
                  id: tokenId,
                  controller: controllerId,
                  owner: controllerId,
                  tapped: false,
                  counters: {},
                  ...(power != null ? { basePower: power } : {}),
                  ...(toughness != null ? { baseToughness: toughness } : {}),
                  summoningSickness: isCreature && !tokenData.hasHaste,
                  isToken: true,
                  ...(tokenData.isCopyToken || tokenData.copiedFromPermanentId
                    ? { isCopyToken: true, isCopyOfPrintedCard: true }
                    : {}),
                  ...(tokenData.copiedFromPermanentId
                    ? { copiedFromPermanentId: String(tokenData.copiedFromPermanentId) }
                    : {}),
                  ...(tokenData.chosenCreatureType
                    ? { chosenCreatureType: String(tokenData.chosenCreatureType) }
                    : {}),
                  ...(tokenData.chosenColor ? { chosenColor: String(tokenData.chosenColor) } : {}),
                  ...(tokenData.chosenCardName ? { chosenCardName: String(tokenData.chosenCardName) } : {}),
                  ...(tokenData.chosenPlayer ? { chosenPlayer: String(tokenData.chosenPlayer) } : {}),
                  card: {
                    id: tokenId,
                    name: tokenData.name,
                    type_line: typeLine,
                    ...(power != null ? { power: String(power) } : {}),
                    ...(toughness != null ? { toughness: String(toughness) } : {}),
                    colors: tokenData.colors || [],
                    oracle_text: String(tokenData.oracleText || tokenData.abilities?.join(', ') || ''),
                    keywords: tokenData.abilities || [],
                    zone: 'battlefield',
                    ...(tokenData.chosenCreatureType
                      ? { chosenCreatureType: String(tokenData.chosenCreatureType) }
                      : {}),
                    ...(tokenData.chosenColor ? { chosenColor: String(tokenData.chosenColor) } : {}),
                    ...(tokenData.chosenCardName ? { chosenCardName: String(tokenData.chosenCardName) } : {}),
                    ...(tokenData.chosenPlayer ? { chosenPlayer: String(tokenData.chosenPlayer) } : {}),
                  },
                } as any);
                const createdToken = ctx.state.battlefield[ctx.state.battlefield.length - 1];
                try {
                  hydratePermanentCardOracleInPlace(createdToken);
                } catch {
                  // best-effort — printed oracle helps Morophon/Helm copies keep lords
                }
                // Restore Morophon / as-enters type map so lord effects survive restart.
                const restoredType = String(
                  tokenData.chosenCreatureType
                  || (createdToken as any)?.chosenCreatureType
                  || '',
                ).trim();
                if (
                  restoredType
                  && String(tokenData.name || (createdToken as any)?.card?.name || '').toLowerCase().includes('morophon')
                ) {
                  const morophonChosenType = ((ctx.state as any).morophonChosenType || {}) as Record<string, string>;
                  morophonChosenType[tokenId] = restoredType;
                  (ctx.state as any).morophonChosenType = morophonChosenType;
                }
                debug(2, `[applyEvent] Created token: ${tokenData.name} for ${controllerId}`);
              }
              break;
            }
            case 'dungeonExileCards': {
              const zones = ctx.state.zones = ctx.state.zones || {};
              const z = zones[controllerId] = zones[controllerId] || {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              };
              const exiledCards = Array.isArray((e as any).exiledCards) ? (e as any).exiledCards as any[] : [];
              const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
              const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
                ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
                : [];
              const libraryAfter = hasLibraryAfterField
                ? cloneLibraryCards((e as any).libraryAfter as any[])
                : buildLibraryFromRemainingIds(
                    getPlayerLibraryFromContext(ctx, controllerId),
                    exiledCards,
                    remainingLibraryIds,
                  );
              z.exile = Array.isArray(z.exile) ? z.exile : [];
              for (const card of exiledCards) {
                if (!card || !String(card.id || '').trim()) continue;
                if ((z.exile as any[]).some((existing: any) => String(existing?.id || '') === String(card.id))) {
                  continue;
                }
                (z.exile as any[]).push({ ...card, zone: 'exile' });
              }
              z.exileCount = (z.exile as any[]).length;
              z.libraryCount = libraryAfter.length;
              if (ctx.libraries?.set) {
                ctx.libraries.set(controllerId, cloneLibraryCards(libraryAfter));
              }
              if ((e as any).grantPlayableFromExile === true) {
                const stateAny = ctx.state as any;
                stateAny.playableFromExile = stateAny.playableFromExile || {};
                const entry = (stateAny.playableFromExile[controllerId] = stateAny.playableFromExile[controllerId] || {});
                const grantedCardIds: string[] = [];
                for (const card of exiledCards) {
                  const grantedCardId = String(card?.id || '').trim();
                  if (!grantedCardId) continue;
                  entry[grantedCardId] = true;
                  grantedCardIds.push(grantedCardId);
                }
                if (grantedCardIds.length > 0) {
                  upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
                    playerId: controllerId as PlayerID,
                    cardIds: grantedCardIds,
                    action: 'play',
                    duration: 'static',
                    turnApplied: Number(stateAny.turnNumber || 0),
                    sourceName: String((e as any).sourceName || 'Dungeon').trim() || 'Dungeon',
                  }));
                }
              }
              break;
            }
            case 'dungeonDrawCards': {
              const zones = ctx.state.zones = ctx.state.zones || {};
              const z = zones[controllerId] = zones[controllerId] || {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              };
              const drawnCards = Array.isArray((e as any).drawnCards) ? (e as any).drawnCards as any[] : [];
              const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
              const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
                ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
                : [];
              const libraryAfter = hasLibraryAfterField
                ? cloneLibraryCards((e as any).libraryAfter as any[])
                : buildLibraryFromRemainingIds(
                    getPlayerLibraryFromContext(ctx, controllerId),
                    drawnCards,
                    remainingLibraryIds,
                  );
              z.hand = Array.isArray(z.hand) ? z.hand : [];
              for (const card of drawnCards) {
                if (!card || !String(card.id || '').trim()) continue;
                if ((z.hand as any[]).some((existing: any) => String(existing?.id || '') === String(card.id))) {
                  continue;
                }
                (z.hand as any[]).push({ ...card, zone: 'hand' });
              }
              z.handCount = (z.hand as any[]).length;
              z.libraryCount = libraryAfter.length;
              if (ctx.libraries?.set) {
                ctx.libraries.set(controllerId, cloneLibraryCards(libraryAfter));
              }
              break;
            }
            case 'dungeonSetLibrary': {
              const zones = ctx.state.zones = ctx.state.zones || {};
              const z = zones[controllerId] = zones[controllerId] || {
                hand: [],
                handCount: 0,
                libraryCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              };
              const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
              const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
                ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
                : [];
              const libraryAfter = hasLibraryAfterField
                ? cloneLibraryCards((e as any).libraryAfter as any[])
                : reorderLibraryByIdList(
                    getPlayerLibraryFromContext(ctx, controllerId),
                    remainingLibraryIds,
                  );
              z.libraryCount = libraryAfter.length;
              if (ctx.libraries?.set) {
                ctx.libraries.set(controllerId, cloneLibraryCards(libraryAfter));
              }
              break;
            }
            case 'gainLife':
            case 'loseLife': {
              const player = (ctx.state.players || []).find((p: any) => p.id === targetId);
              if (player) {
                const delta = effectType === 'gainLife' ? amount : -amount;
                ctx.state.life = ctx.state.life || {};
                ctx.state.life[targetId] = (ctx.state.life[targetId] ?? 40) + delta;
                player.life = ctx.state.life[targetId];
                debug(1, `[applyEvent] ${targetId} ${effectType === 'gainLife' ? 'gained' : 'lost'} ${amount} life`);
              }
              break;
            }
            case 'drawCard': {
              // Draw is handled by drawCards, just bump seq
              break;
            }
            case 'mill': {
              const zones = ctx.state.zones?.[targetId] as any;
              if (zones?.library && Array.isArray(zones.library)) {
                for (let i = 0; i < amount && zones.library.length > 0; i++) {
                  const milledCard = zones.library.shift();
                  if (milledCard) {
                    zones.graveyard = zones.graveyard || [];
                    pushCardToPlayerGraveyardWithReplacements(ctx as any, String(targetId), milledCard, zones.graveyard);
                  }
                }
                zones.libraryCount = zones.library.length;
                zones.graveyardCount = (zones.graveyard || []).length;
                debug(2, `[applyEvent] ${targetId} milled ${amount} card(s)`);
              }
              break;
            }

          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(executeEffect): failed", err);
        }
        break;
      }

      case "foretellCard": {
        // Foretell: exile a card from hand face-down
        const pid = (e as any).playerId;
        const cardId = (e as any).cardId;
        const foretoldCardData = (e as any).card;
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;
          
          // Remove card from hand
          const hand = Array.isArray(z.hand) ? z.hand : [];
          const cardIndex = hand.findIndex((c: any) => c?.id === cardId);
          if (cardIndex !== -1) {
            hand.splice(cardIndex, 1);
          }
          z.handCount = hand.length;
          
          // Add to exile with foretell data
          z.exile = z.exile || [];
          if (foretoldCardData) {
            (z.exile as any[]).push(foretoldCardData);
          }
          (z as any).exileCount = (z.exile as any[]).length;
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(foretellCard): failed", err);
        }
        break;
      }

      case "suspendCard": {
        const pid = (e as any).playerId;
        const cardId = (e as any).cardId;
        const suspendedCardData = (e as any).card;

        try {
          const playerId = String(pid || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.SUSPEND_CAST)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                const queuedCardId = String((step as any).card?.id || (step as any).cardId || '').trim();
                return !cardId || queuedCardId === String(cardId || '').trim();
              });
            }
          }

          if ((e as any).cancelled === true) break;

          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;

          const hand = Array.isArray(z.hand) ? z.hand : [];
          const cardIndex = hand.findIndex((c: any) => String(c?.id || '') === String(cardId || ''));
          if (cardIndex !== -1) {
            hand.splice(cardIndex, 1);
          }
          z.handCount = hand.length;

          try {
            const tappedPermanents = Array.isArray((e as any).tappedPermanents)
              ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            if (tappedPermanents.length > 0) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              for (const permanentId of tappedPermanents) {
                const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId);
                if (permanent) {
                  (permanent as any).tapped = true;
                }
              }
            }
          } catch {
            // best-effort only
          }

          try {
            const sacrificedPermanents = Array.isArray((e as any).sacrificedPermanents)
              ? ((e as any).sacrificedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
              : [];
            for (const permanentId of sacrificedPermanents) {
              applyReplaySacrificedPermanent(ctx, permanentId);
            }
          } catch {
            // best-effort only
          }

          try {
            const manaDelta = (e as any).paymentManaDelta;
            if (pid && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
              const pool = getOrInitManaPool(ctx.state as any, pid as any) as any;
              for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
                const amount = Number(rawAmount || 0);
                if (!Number.isFinite(amount) || amount === 0) continue;
                pool[poolKey] = Number(pool[poolKey] || 0) + amount;
              }
            }
          } catch {
            // best-effort only
          }

          z.exile = z.exile || [];
          if (suspendedCardData) {
            (z.exile as any[]).push(suspendedCardData);
          }
          (z as any).exileCount = (z.exile as any[]).length;

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(suspendCard): failed", err);
        }
        break;
      }

      case "morphTurnFaceUp": {
        const permanentId = String((e as any).permanentId || '').trim();
        const playerId = String((e as any).playerId || '').trim();
        const resolvedStepId = String((e as any).resolvedStepId || '').trim();
        const actualCardData = (e as any).actualCard;

        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.MORPH_TURN_FACE_UP)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                const queuedPermanentId = String((step as any).permanentId || '').trim();
                return !permanentId || queuedPermanentId === permanentId;
              });
            }
          }

          if ((e as any).cancelled === true) break;
          if (!permanentId) break;

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId) as any;
          if (!permanent) break;

          const actualCard = actualCardData && typeof actualCardData === 'object'
            ? { ...(actualCardData as any), zone: 'battlefield' }
            : (permanent.faceUpCard && typeof permanent.faceUpCard === 'object'
              ? { ...(permanent.faceUpCard as any), zone: 'battlefield' }
              : null);
          if (!actualCard) break;

          permanent.isFaceDown = false;
          permanent.card = actualCard;

          const typeLine = String(actualCard?.type_line || '').toLowerCase();
          if (typeLine.includes('creature')) {
            permanent.basePower = parsePT((actualCard as any).power);
            permanent.baseToughness = parsePT((actualCard as any).toughness);
          }

          delete permanent.faceDownType;
          delete permanent.morphCost;
          delete permanent.faceUpCard;
          delete permanent.canTurnFaceUp;

          const faceUpOracle = String(actualCard?.oracle_text || '').toLowerCase();
          if (/\bmegamorph\b/.test(faceUpOracle)) {
            const counters = permanent.counters = permanent.counters || {};
            counters['+1/+1'] = (Number(counters['+1/+1']) || 0) + 1;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(morphTurnFaceUp): failed', err);
        }
        break;
      }

      case "phaseOutPermanents": {
        // Phase out multiple permanents
        const pid = (e as any).playerId;
        const permanentIds = (e as any).permanentIds as string[] || [];
        
        try {
          const battlefield = ctx.state.battlefield || [];
          for (const permId of permanentIds) {
            const permanent = battlefield.find((p: any) => p?.id === permId);
            if (permanent && permanent.controller === pid && !permanent.phasedOut) {
              (permanent as any).phasedOut = true;
              (permanent as any).phaseOutController = pid;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(phaseOutPermanents): failed", err);
        }
        break;
      }

      case "mayAutoPreferenceSet": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const effectKey = String((e as any).effectKey || '').trim();
          const value = (e as any).value;
          if (!playerId || !effectKey) break;

          const stateAny = ctx.state as any;
          stateAny.mayAutoPreferences = stateAny.mayAutoPreferences || {};
          stateAny.mayAutoPreferences[playerId] = stateAny.mayAutoPreferences[playerId] || {};

          if (value === null || value === undefined) {
            delete stateAny.mayAutoPreferences[playerId][effectKey];
          } else {
            stateAny.mayAutoPreferences[playerId][effectKey] = value;
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mayAutoPreferenceSet): failed', err);
        }
        break;
      }

      case "setAutoYesOptional": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const enabled = (e as any).enabled === true;
          if (!playerId) break;

          const stateAny = ctx.state as any;
          stateAny.autoYesOptional = stateAny.autoYesOptional || {};
          if (enabled) {
            stateAny.autoYesOptional[playerId] = true;
          } else {
            delete stateAny.autoYesOptional[playerId];
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(setAutoYesOptional): failed', err);
        }
        break;
      }

      case "setTriggerShortcut": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const cardName = String((e as any).cardName || '').trim().toLowerCase();
          const preference = String((e as any).preference || '').trim();
          const triggerDescriptionRaw = (e as any).triggerDescription;
          const triggerDescription = typeof triggerDescriptionRaw === 'string' ? triggerDescriptionRaw : undefined;

          if (!playerId || !cardName || !preference) break;

          const stateAny = ctx.state as any;
          stateAny.triggerShortcuts = stateAny.triggerShortcuts || {};
          stateAny.triggerShortcuts[playerId] = Array.isArray(stateAny.triggerShortcuts[playerId])
            ? stateAny.triggerShortcuts[playerId]
            : [];

          const shortcuts = stateAny.triggerShortcuts[playerId] as any[];
          const existingIndex = shortcuts.findIndex((entry: any) =>
            String(entry?.cardName || '').trim().toLowerCase() === cardName &&
            (!triggerDescription || entry?.triggerDescription === triggerDescription)
          );

          if (preference === 'ask_each_time') {
            if (existingIndex >= 0) {
              shortcuts.splice(existingIndex, 1);
            }
          } else {
            const shortcut = {
              cardName,
              playerId,
              preference,
              triggerDescription,
            };

            if (existingIndex >= 0) {
              shortcuts[existingIndex] = shortcut;
            } else {
              shortcuts.push(shortcut);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(setTriggerShortcut): failed', err);
        }
        break;
      }

      case "triggerOrderResponse": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const stepId = String((e as any).stepId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || stepId).trim();
          const orderedTriggerIds = Array.isArray((e as any).orderedTriggerIds)
            ? ((e as any).orderedTriggerIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
            : [];

          if (resolvedStepId && ctx.gameId) {
            clearReplayQueuedStepById(ctx.gameId, resolvedStepId);
          }

          applyTriggerOrderToStack(ctx.state, orderedTriggerIds);

          if (playerId && (ctx.state as any).pendingTriggerOrdering?.[playerId]) {
            delete (ctx.state as any).pendingTriggerOrdering[playerId];
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(triggerOrderResponse): failed', err);
        }
        break;
      }

      case "equipPermanent": {
        // Attach equipment to a creature
        const pid = (e as any).playerId;
        const equipmentId = (e as any).equipmentId;
        const targetCreatureId = (e as any).targetCreatureId;
        
        try {
          const battlefield = ctx.state.battlefield || [];
          const equipment = battlefield.find((p: any) => p?.id === equipmentId);
          const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId);
          
          if (equipment && targetCreature) {
            // Detach from previous creature if attached
            if (equipment.attachedTo) {
              const prevCreature = battlefield.find((p: any) => p.id === equipment.attachedTo);
              if (prevCreature) {
                (prevCreature as any).attachedEquipment = ((prevCreature as any).attachedEquipment || []).filter((id: string) => id !== equipmentId);
                if (((prevCreature as any).attachedEquipment || []).length === 0) {
                  (prevCreature as any).isEquipped = false;
                }
              }
            }
            
            // Attach to new creature
            equipment.attachedTo = targetCreatureId;
            (targetCreature as any).attachedEquipment = (targetCreature as any).attachedEquipment || [];
            if (!(targetCreature as any).attachedEquipment.includes(equipmentId)) {
              (targetCreature as any).attachedEquipment.push(equipmentId);
            }
            (targetCreature as any).isEquipped = true;
            try {
              processEquippedTriggers(ctx as any, equipment, targetCreature);
            } catch (equipTriggerErr) {
              debugWarn(1, 'applyEvent(equipPermanent): processEquippedTriggers failed', equipTriggerErr);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(equipPermanent): failed", err);
        }
        break;
      }

      case "attachEnchantmentPermanent": {
        const enchantmentId = (e as any).enchantmentId;
        const targetPermanentId = (e as any).targetPermanentId;

        try {
          const battlefield = ctx.state.battlefield || [];
          const enchantment = battlefield.find((p: any) => p?.id === enchantmentId);
          const targetPermanent = battlefield.find((p: any) => p?.id === targetPermanentId);

          if (enchantment && targetPermanent) {
            if (enchantment.attachedTo) {
              const prevTarget = battlefield.find((p: any) => p?.id === enchantment.attachedTo);
              if (prevTarget) {
                (prevTarget as any).attachments = ((prevTarget as any).attachments || []).filter((id: string) => id !== enchantmentId);
              }
            }

            enchantment.attachedTo = targetPermanentId;
            (targetPermanent as any).attachments = (targetPermanent as any).attachments || [];
            if (!(targetPermanent as any).attachments.includes(enchantmentId)) {
              (targetPermanent as any).attachments.push(enchantmentId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(attachEnchantmentPermanent): failed', err);
        }
        break;
      }

      case "mutatePermanent": {
        const targetPermanentId = String((e as any).targetPermanentId || '').trim();
        const onTop = (e as any).onTop === true;
        const mutatingCard = (e as any).mutatingCard;

        try {
          const battlefield = ctx.state.battlefield || [];
          const targetPermanent = battlefield.find((p: any) => p?.id === targetPermanentId);
          const mutatingCardId = String(mutatingCard?.id || '').trim();

          if (targetPermanent && mutatingCard && mutatingCardId) {
            const existingMutatedStack = Array.isArray((targetPermanent as any).mutatedStack)
              ? ((targetPermanent as any).mutatedStack as any[])
              : [];
            const alreadyMerged = existingMutatedStack.some((entry: any) => String(entry?.id || '') === mutatingCardId);

            if (!alreadyMerged) {
              const targetOwner = String((targetPermanent as any).owner || (targetPermanent as any).controller || '');
              const existingMutation = existingMutatedStack.length > 0
                ? {
                    permanentId: String((targetPermanent as any).id || targetPermanentId),
                    controller: String((targetPermanent as any).controller || ''),
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
                    mutationCount: Number((targetPermanent as any).mutationCount || Math.max(1, existingMutatedStack.length - 1)),
                    summoningSicknessInherited: !(targetPermanent as any).summoningSickness,
                  }
                : undefined;

              const mutatedPermanent = createMutatedPermanent(targetPermanent, mutatingCard, onTop, existingMutation as any);
              const topCharacteristics = getMutatedPermanentCharacteristics(mutatedPermanent);
              const combinedAbilities = getMutatedPermanentAbilities(mutatedPermanent);
              const topCardEntry = mutatedPermanent.cardStack[0];

              (targetPermanent as any).mutatedStack = mutatedPermanent.cardStack.map((entry: any) => ({
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
                  ? (mutatingCard?.image_uris?.small || mutatingCard?.image_uris?.normal)
                  : undefined,
              }));
              (targetPermanent as any).mutationCount = mutatedPermanent.mutationCount;
              (targetPermanent as any).timesMutated = mutatedPermanent.mutationCount;
              (targetPermanent as any).card = {
                ...((targetPermanent as any).card || {}),
                ...(onTop ? { ...(mutatingCard as any) } : {}),
                id: topCardEntry?.id || (targetPermanent as any).card?.id,
                name: topCharacteristics.name || (targetPermanent as any).card?.name,
                type_line: topCharacteristics.typeLine || (targetPermanent as any).card?.type_line,
                power: topCharacteristics.power ?? (targetPermanent as any).card?.power,
                toughness: topCharacteristics.toughness ?? (targetPermanent as any).card?.toughness,
                mana_cost: topCharacteristics.manaCost ?? (targetPermanent as any).card?.mana_cost,
                oracle_text: combinedAbilities.join('\n') || (targetPermanent as any).card?.oracle_text || '',
                zone: 'battlefield',
              };

              const parsedTopPower = parsePT(topCharacteristics.power);
              const parsedTopToughness = parsePT(topCharacteristics.toughness);
              if (parsedTopPower !== undefined) {
                (targetPermanent as any).basePower = parsedTopPower;
              }
              if (parsedTopToughness !== undefined) {
                (targetPermanent as any).baseToughness = parsedTopToughness;
              }
              (targetPermanent as any).isCommander = mutatedPermanent.cardStack.some((entry: any) => entry?.isCommander === true);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(mutatePermanent): failed', err);
        }
        break;
      }

      case "fortifyPermanent": {
        const fortificationId = (e as any).fortificationId;
        const targetLandId = (e as any).targetLandId;

        try {
          const battlefield = ctx.state.battlefield || [];
          const fortification = battlefield.find((p: any) => p?.id === fortificationId);
          const targetLand = battlefield.find((p: any) => p?.id === targetLandId);

          if (fortification && targetLand) {
            if (fortification.attachedTo) {
              const prevTarget = battlefield.find((p: any) => p.id === fortification.attachedTo);
              if (prevTarget) {
                (prevTarget as any).attachedEquipment = ((prevTarget as any).attachedEquipment || []).filter((id: string) => id !== fortificationId);
                if (((prevTarget as any).attachedEquipment || []).length === 0) {
                  (prevTarget as any).isEquipped = false;
                }
              }
            }

            fortification.attachedTo = targetLandId;
            (targetLand as any).attachedEquipment = (targetLand as any).attachedEquipment || [];
            if (!(targetLand as any).attachedEquipment.includes(fortificationId)) {
              (targetLand as any).attachedEquipment.push(fortificationId);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(fortifyPermanent): failed', err);
        }
        break;
      }

      case "reconfigurePermanent": {
        const reconfigureId = (e as any).reconfigureId;
        const targetCreatureId = (e as any).targetCreatureId;

        try {
          const battlefield = ctx.state.battlefield || [];
          const equipment = battlefield.find((p: any) => p?.id === reconfigureId);
          const targetCreature = battlefield.find((p: any) => p?.id === targetCreatureId);

          if (equipment && targetCreature) {
            if (equipment.attachedTo) {
              const prevTarget = battlefield.find((p: any) => p.id === equipment.attachedTo);
              if (prevTarget) {
                (prevTarget as any).attachedEquipment = ((prevTarget as any).attachedEquipment || []).filter((id: string) => id !== reconfigureId);
                if (((prevTarget as any).attachedEquipment || []).length === 0) {
                  (prevTarget as any).isEquipped = false;
                }
              }
            }

            equipment.attachedTo = targetCreatureId;
            (targetCreature as any).attachedEquipment = (targetCreature as any).attachedEquipment || [];
            if (!(targetCreature as any).attachedEquipment.includes(reconfigureId)) {
              (targetCreature as any).attachedEquipment.push(reconfigureId);
            }
            (targetCreature as any).isEquipped = true;
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reconfigurePermanent): failed', err);
        }
        break;
      }

      case "reconfigureUnattachPermanent": {
        const reconfigureId = (e as any).reconfigureId;
        const targetCreatureId = (e as any).targetCreatureId;
        const restoredBasePower = (e as any).restoredBasePower;
        const restoredBaseToughness = (e as any).restoredBaseToughness;

        try {
          const battlefield = ctx.state.battlefield || [];
          const equipment = battlefield.find((p: any) => p?.id === reconfigureId);
          if (equipment) {
            const attachedTargetId = String((equipment as any).attachedTo || targetCreatureId || '').trim();
            if (attachedTargetId) {
              const prevTarget = battlefield.find((p: any) => p?.id === attachedTargetId);
              if (prevTarget) {
                (prevTarget as any).attachedEquipment = ((prevTarget as any).attachedEquipment || []).filter((id: string) => id !== reconfigureId);
                if (((prevTarget as any).attachedEquipment || []).length === 0) {
                  (prevTarget as any).isEquipped = false;
                }
                // Bestow / aura hosts track attachments separately from equipment.
                (prevTarget as any).attachments = ((prevTarget as any).attachments || []).filter((id: string) => id !== reconfigureId);
              }
            }

            delete (equipment as any).attachedTo;

            // SBA bestow/reconfigure unattach may restore printed P/T when missing.
            if (typeof restoredBasePower === 'number' && Number.isFinite(restoredBasePower)) {
              (equipment as any).basePower = restoredBasePower;
            }
            if (typeof restoredBaseToughness === 'number' && Number.isFinite(restoredBaseToughness)) {
              (equipment as any).baseToughness = restoredBaseToughness;
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(reconfigureUnattachPermanent): failed', err);
        }
        break;
      }

      case "concede": {
        // Mark player as having conceded
        const pid = (e as any).playerId;
        
        try {
          const players = ctx.state.players || [];
          const player = players.find((p: any) => p.id === pid);
          
          if (player) {
            (player as any).conceded = true;
            (player as any).concededAt = Date.now();
            (player as any).departureMode = 'concede';
          }

          const stateAny = ctx.state as any;
          if (!stateAny.autoPassForTurn || typeof stateAny.autoPassForTurn !== 'object') {
            stateAny.autoPassForTurn = {};
          }
          if (pid) {
            stateAny.autoPassForTurn[pid] = true;
          }
          if (stateAny.priorityClaimed instanceof Set) {
            stateAny.priorityClaimed.delete(pid);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(concede): failed", err);
        }
        break;
      }

      case "additionalCostConfirm": {
        // Handle additional costs (discard, sacrifice) for spell casting
        const pid = (e as any).playerId;
        const costType = (e as any).costType;
        const selectedCards = (e as any).selectedCards as string[] || [];
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;
          
          if (costType === 'discard') {
            // Move cards from hand to graveyard
            let discardedCount = 0;
            for (const cardId of selectedCards) {
              const hand = Array.isArray(z.hand) ? z.hand : [];
              const cardIndex = hand.findIndex((c: any) => c?.id === cardId);
              if (cardIndex !== -1) {
                const [card] = hand.splice(cardIndex, 1);
                z.graveyard = z.graveyard || [];
                if (card && typeof card === 'object') {
                  (z.graveyard as any[]).push({
                    ...card,
                    zone: 'graveyard',
                    ...buildDiscardProvenanceFields(ctx.state, String(pid)),
                  });
                  discardedCount++;
                }
              }
            }
            z.handCount = Array.isArray(z.hand) ? z.hand.length : 0;
            z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : 0;

            // Turn-tracking for intervening-if: a player discarded a card this turn.
            if (discardedCount > 0) {
              const stateAny = ctx.state as any;
              stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
              stateAny.discardedCardThisTurn[String(pid)] = true;
              stateAny.anyPlayerDiscardedCardThisTurn = true;
            }
          } else if (costType === 'sacrifice') {
            // Move permanents from battlefield to graveyard
            const battlefield = ctx.state.battlefield || [];
            for (const permId of selectedCards) {
              const permIndex = battlefield.findIndex((p: any) => p?.id === permId);
              if (permIndex !== -1) {
                movePermanentToGraveyard(ctx as any, String(permId), true);
              }
            }
            z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : 0;
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(additionalCostConfirm): failed", err);
        }
        break;
      }

      case "confirmGraveyardTargets": {
        // Move cards from graveyard to another zone
        const pid = (e as any).playerId;
        const selectedCardIds = (e as any).selectedCardIds as string[] || [];
        const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
          ? ((e as any).createdPermanentIds as any[]).map((value: any) => String(value || '').trim())
          : [];
        const destination = (e as any).destination;
        const targetPlayerId = String((e as any).targetPlayerId || '').trim();
        const destinationUsesSelectedCardOwner = (e as any).destinationUsesSelectedCardOwner === true;
        const battlefieldControllerMode = String((e as any).battlefieldControllerMode || '').trim().toLowerCase();
        const battlefieldControllerId = String((e as any).battlefieldControllerId || '').trim();
        const battlefieldTapped = (e as any).battlefieldTapped === true;
        const battlefieldCounters = (e as any).battlefieldCounters && typeof (e as any).battlefieldCounters === 'object'
          ? { ...((e as any).battlefieldCounters as Record<string, number>) }
          : {};
        const battlefieldFaceDown = (e as any).battlefieldFaceDown === true;
        const battlefieldTurnFaceUp = (e as any).battlefieldTurnFaceUp === true;
        const battlefieldSuspected = (e as any).battlefieldSuspected === true;
        const battlefieldSetTypeLine = String((e as any).battlefieldSetTypeLine || '').trim();
        const battlefieldSetOracleText = typeof (e as any).battlefieldSetOracleText === 'string'
          ? String((e as any).battlefieldSetOracleText)
          : undefined;
        const battlefieldLoseAllOtherTypes = (e as any).battlefieldLoseAllOtherTypes === true;
        const battlefieldGrantedTypes = Array.isArray((e as any).battlefieldGrantedTypes)
          ? ((e as any).battlefieldGrantedTypes as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
          : [];
        
        try {
          const zones = ctx.state.zones || {};
          const z = zones[pid] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          zones[pid] = z;
          ctx.state.zones = zones;

          let movedAny = false;
          let movedCreatureCard: any | undefined;
          const touchedZoneOwners = new Set<string>();

          const findCardSourceOwner = (cardId: string): string | null => {
            const ownersToCheck = targetPlayerId
              ? [targetPlayerId, ...Object.keys(zones).filter((playerId) => playerId !== targetPlayerId)]
              : Object.keys(zones);
            for (const ownerId of ownersToCheck) {
              const graveyard = Array.isArray(zones[ownerId]?.graveyard) ? zones[ownerId].graveyard : [];
              if (graveyard.some((card: any) => String(card?.id || '') === String(cardId))) {
                return ownerId;
              }
            }
            return null;
          };
          
          for (const cardId of selectedCardIds) {
            const sourceOwnerId = findCardSourceOwner(cardId);
            if (!sourceOwnerId) continue;

            const sourceZones = zones[sourceOwnerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
            zones[sourceOwnerId] = sourceZones;
            sourceZones.graveyard = Array.isArray(sourceZones.graveyard) ? sourceZones.graveyard : [];
            sourceZones.exile = Array.isArray(sourceZones.exile) ? sourceZones.exile : [];

            const graveyard = sourceZones.graveyard as any[];
            const cardIndex = graveyard.findIndex((c: any) => c?.id === cardId);
            if (cardIndex === -1) continue;
            
            const [card] = graveyard.splice(cardIndex, 1);
            movedAny = true;
            const tl = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
            if (!movedCreatureCard && tl.includes('creature')) movedCreatureCard = card;
            touchedZoneOwners.add(sourceOwnerId);
            
            switch (destination) {
              case 'hand':
                {
                  const destinationPlayerId = destinationUsesSelectedCardOwner ? sourceOwnerId : pid;
                  const destinationZones = (zones[destinationPlayerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 }) as any;
                  zones[destinationPlayerId] = destinationZones;
                  destinationZones.hand = Array.isArray(destinationZones.hand) ? destinationZones.hand : [];
                  (destinationZones.hand as any[]).push({ ...card, zone: 'hand' });
                  destinationZones.handCount = (destinationZones.hand as any[]).length;
                  touchedZoneOwners.add(destinationPlayerId);
                }
                break;
              case 'battlefield':
                {
                  ctx.state.battlefield = ctx.state.battlefield || [];
                  const typeLine = (card.type_line || '').toLowerCase();
                  const isCreature = typeLine.includes('creature');
                  const createdPermanentId = createdPermanentIds.shift() || generateDeterministicId(ctx, 'perm', cardId);
                  const controllerId = battlefieldControllerId || (battlefieldControllerMode === 'owner' ? sourceOwnerId : pid);
                  const permanent: any = battlefieldFaceDown
                    ? {
                        id: createdPermanentId,
                        controller: controllerId,
                        owner: sourceOwnerId,
                        tapped: battlefieldTapped,
                        counters: { ...battlefieldCounters },
                        basePower: 2,
                        baseToughness: 2,
                        summoningSickness: true,
                        card: {
                          name: 'Face-down Creature',
                          type_line: 'Creature',
                          zone: 'battlefield',
                          power: '2',
                          toughness: '2',
                        },
                        isFaceDown: true,
                        faceDownType: 'effect',
                        faceUpCard: { ...card, zone: 'battlefield' },
                        canTurnFaceUp: isCreature,
                      }
                    : {
                        id: createdPermanentId,
                        controller: controllerId,
                        owner: sourceOwnerId,
                        tapped: battlefieldTapped,
                        counters: { ...battlefieldCounters },
                        basePower: isCreature ? parseInt(card.power || '0', 10) : undefined,
                        baseToughness: isCreature ? parseInt(card.toughness || '0', 10) : undefined,
                        summoningSickness: isCreature,
                        card: { ...card, zone: 'battlefield' },
                      };
                  if (battlefieldSuspected) {
                    permanent.suspected = true;
                    permanent.isSuspected = true;
                    permanent.card = { ...(permanent.card || {}), suspected: true, isSuspected: true };
                  }
                  if (battlefieldTurnFaceUp && permanent.isFaceDown === true && permanent.faceUpCard) {
                    const actualCard = { ...(permanent.faceUpCard as any), zone: 'battlefield' };
                    const actualTypeLine = String(actualCard?.type_line || '').toLowerCase();
                    const actualIsCreature = actualTypeLine.includes('creature');
                    permanent.isFaceDown = false;
                    permanent.card = actualCard;
                    if (actualIsCreature) {
                      permanent.basePower = parseInt(actualCard.power || '0', 10);
                      permanent.baseToughness = parseInt(actualCard.toughness || '0', 10);
                      permanent.summoningSickness = true;
                    } else {
                      delete permanent.basePower;
                      delete permanent.baseToughness;
                      delete permanent.summoningSickness;
                    }
                    delete permanent.faceDownType;
                    delete permanent.faceUpCard;
                    delete permanent.canTurnFaceUp;
                  }
                  applyReplayBattlefieldReturnCharacteristics(permanent, {
                    battlefieldSetTypeLine,
                    battlefieldSetOracleText,
                    battlefieldLoseAllOtherTypes,
                    battlefieldGrantedTypes,
                  });
                  markReplayPermanentEnteredFromZone(permanent, 'graveyard');
                  ctx.state.battlefield.push(permanent as any);
                }
                break;
              case 'library_top':
                {
                  const destinationPlayerId = destinationUsesSelectedCardOwner ? sourceOwnerId : pid;
                  const lib = ctx.libraries.get(destinationPlayerId) || [];
                  lib.unshift({ ...card, zone: 'library' });
                  ctx.libraries.set(destinationPlayerId, lib);
                  const destinationZones = (zones[destinationPlayerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 }) as any;
                  zones[destinationPlayerId] = destinationZones;
                  destinationZones.library = lib;
                  destinationZones.libraryCount = lib.length;
                  touchedZoneOwners.add(destinationPlayerId);
                }
                break;
              case 'library_bottom':
                {
                  const destinationPlayerId = destinationUsesSelectedCardOwner ? sourceOwnerId : pid;
                  const libBottom = ctx.libraries.get(destinationPlayerId) || [];
                  libBottom.push({ ...card, zone: 'library' });
                  ctx.libraries.set(destinationPlayerId, libBottom);
                  const destinationZones = (zones[destinationPlayerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 }) as any;
                  zones[destinationPlayerId] = destinationZones;
                  destinationZones.library = libBottom;
                  destinationZones.libraryCount = libBottom.length;
                  touchedZoneOwners.add(destinationPlayerId);
                }
                break;
              case 'exile':
                (sourceZones.exile as any[]).push({ ...card, zone: 'exile' });
                sourceZones.exileCount = (sourceZones.exile as any[]).length;
                break;
            }
          }

          for (const ownerId of touchedZoneOwners) {
            const ownerZones = (zones[ownerId] || {}) as any;
            ownerZones.graveyard = Array.isArray(ownerZones.graveyard) ? ownerZones.graveyard : [];
            ownerZones.hand = Array.isArray(ownerZones.hand) ? ownerZones.hand : [];
            ownerZones.exile = Array.isArray(ownerZones.exile) ? ownerZones.exile : [];
            ownerZones.library = Array.isArray(ownerZones.library) ? ownerZones.library : (ctx.libraries.get(ownerId) || []);
            ownerZones.graveyardCount = ownerZones.graveyard.length;
            ownerZones.handCount = ownerZones.hand.length;
            ownerZones.exileCount = ownerZones.exile.length;
            ownerZones.libraryCount = ownerZones.library.length;
          }

          // Turn-tracking for intervening-if: a card left your graveyard this turn.
          if (movedAny) {
            try {
              recordCardLeftGraveyardThisTurn(ctx as any, String(targetPlayerId || pid), movedCreatureCard);

              const stateAny = ctx.state as any;

              // Turn-tracking for intervening-if: evidence was collected this turn.
              // Only set true on explicit positive evidence from persisted events.
              const evidenceCollected = (e as any)?.evidenceCollected === true;
              const purpose = String((e as any)?.purpose || '').toLowerCase();
              if (evidenceCollected || (purpose === 'collectevidence' && String(destination).toLowerCase() === 'exile')) {
                stateAny.evidenceCollectedThisTurn = stateAny.evidenceCollectedThisTurn || {};
                stateAny.evidenceCollectedThisTurnByPlayer = stateAny.evidenceCollectedThisTurnByPlayer || {};
                stateAny.evidenceCollectedThisTurnByPlayerCounts = stateAny.evidenceCollectedThisTurnByPlayerCounts || {};
                stateAny.evidenceCollectedThisTurn[String(pid)] = true;
                stateAny.evidenceCollectedThisTurnByPlayer[String(pid)] = true;
                stateAny.evidenceCollectedThisTurnByPlayerCounts[String(pid)] = (stateAny.evidenceCollectedThisTurnByPlayerCounts[String(pid)] || 0) + 1;
              }
            } catch {
              // best-effort only
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(confirmGraveyardTargets): failed", err);
        }
        break;
      }

      case "confirmForbiddenOrchardTarget": {
        try {
          const targetOpponentId = String((e as any).targetOpponentId || '').trim();
          const permanentId = String((e as any).permanentId || 'forbidden_orchard').trim() || 'forbidden_orchard';
          if (!targetOpponentId) break;

          ctx.state.battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
          const tokenId = generateDeterministicId(ctx, 'token_forbidden_orchard', `${permanentId}:${targetOpponentId}`);
          const spiritToken = {
            id: tokenId,
            controller: targetOpponentId,
            owner: targetOpponentId,
            tapped: false,
            summoningSickness: true,
            counters: {},
            card: {
              id: tokenId,
              name: 'Spirit',
              type_line: 'Token Creature — Spirit',
              oracle_text: '',
              mana_cost: '',
              cmc: 0,
              colors: [],
            },
            basePower: 1,
            baseToughness: 1,
            isToken: true,
          };
          (ctx.state.battlefield as any[]).push(spiritToken);
          triggerETBEffectsForToken(ctx as any, spiritToken as any, targetOpponentId as PlayerID);

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(confirmForbiddenOrchardTarget): failed", err);
        }
        break;
      }

      case "opponentMayPayResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const playerId = String((e as any).playerId || (e as any).decidingPlayer || '').trim();
          const promptId = String((e as any).promptId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === String(ResolutionStepType.OPTION_CHOICE) &&
                (step as any).opponentMayPayChoice === true &&
                (!playerId || String((step as any)?.playerId || '').trim() === playerId) &&
                (!promptId || String((step as any)?.promptId || '').trim() === promptId)
              );
            });
          }

          applyOpponentMayPayResolve(ctx as any, e as any);
        } catch (err) {
          debugWarn(1, 'applyEvent(opponentMayPayResolve): failed', err);
        }
        break;
      }

      case "rulesChoiceResolved": {
        try {
          const controllerId = String((e as any).controllerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || 'Ability').trim() || 'Ability';
          const effectText = String((e as any).effectText || '').trim();
          const rulesChoiceGroupId = String((e as any).rulesChoiceGroupId || '').trim();
          const eventData = ((e as any).eventData || {}) as any;
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            const resolvedStepIds = Array.isArray((e as any).resolvedStepIds)
              ? ((e as any).resolvedStepIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
              : [];
            if (resolvedStepIds.length > 0) {
              for (const resolvedStepId of resolvedStepIds) {
                clearReplayQueuedStepById(replayGameId, resolvedStepId);
              }
            } else if (rulesChoiceGroupId) {
              clearReplayQueuedSteps(replayGameId, (step: any) => String((step as any)?.rulesChoiceGroupId || '').trim() === rulesChoiceGroupId);
            }
          }

          if (!controllerId || !sourceId || !effectText) break;

          const executeResult = executeTriggeredAbilityEffectWithOracleIR(
            ctx.state as any,
            {
              controllerId: controllerId as any,
              sourceId,
              sourceName,
              effect: effectText,
            },
            eventData,
            { allowOptional: true }
          );

          ctx.state = executeResult.state as any;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(rulesChoiceResolved): failed', err);
        }
        break;
      }
      
      case "colorChoice": {
        // Player chose a color for a permanent or spell (e.g., Brave the Elements)
        try {
          const { permanentId, spellId, color, playerId } = e as any;
          const permanentIdStr = String(permanentId || '').trim();
          const spellIdStr = String(spellId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.COLOR_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!permanentIdStr || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permanentIdStr) &&
                (!spellIdStr || String((step as any)?.spellId || '').trim() === spellIdStr)
              );
            });
          }

          // Permanent ETB color choices (Thriving lands, Caged Sun, etc.) must win over any
          // stale stack item. Matching `spellId || ''` against empty card ids previously
          // applied Thriving Grove's color onto orphaned commander spells during undo replay.
          if (permanentIdStr) {
            const permanent = resolveReplayPermanentByEvent(ctx, {
              permanentId: permanentIdStr,
              playerId,
              cardName: (e as any).cardName,
            });

            if (permanent && color) {
              (permanent as any).chosenColor = color;
              if (permanent.card && typeof permanent.card === 'object') {
                (permanent.card as any).chosenColor = color;
              }
              const colorWord = String((e as any).colorWord || '').trim().toLowerCase();
              if (colorWord) {
                (permanent as any).chosenColorWord = colorWord;
                if (permanent.card && typeof permanent.card === 'object') {
                  (permanent.card as any).chosenColorWord = colorWord;
                }
              }
              debug(2, `[applyEvent] Applied color choice: ${permanent.card?.name} -> ${color}`);
              ctx.bumpSeq();
              break;
            }
          }

          if (spellIdStr) {
            const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
            const stackItem = stack.find((item: any) =>
              item && (
                String(item.id || '') === spellIdStr
                || String(item.cardId || '') === spellIdStr
                || String(item.card?.id || '') === spellIdStr
              )
            );

            if (stackItem && color) {
              (stackItem as any).chosenColor = color;
              debug(2, `[applyEvent] Applied spell color choice: ${stackItem.card?.name || stackItem.sourceName || spellIdStr} -> ${color}`);
              ctx.bumpSeq();
              break;
            }
          }

          debugWarn(2, `[applyEvent] colorChoice: target not found (permanent=${permanentIdStr}, spell=${spellIdStr})`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(colorChoice): failed", err);
        }
        break;
      }
      
      case "basicLandTypeChoice": {
        try {
          const { permanentId, playerId, basicLandType, cardName } = e as any;
          const permanentIdStr = String(permanentId || '').trim();
          const landType = String(basicLandType || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.BASIC_LAND_TYPE_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!permanentIdStr || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permanentIdStr)
              );
            });
          }

          if (permanentIdStr && landType) {
            const permanent = resolveReplayPermanentByEvent(ctx, {
              permanentId: permanentIdStr,
              playerId,
              cardName,
            });
            if (permanent) {
              (permanent as any).chosenBasicLandType = landType;
              if (permanent.card && typeof permanent.card === 'object') {
                (permanent.card as any).chosenBasicLandType = landType;
              }
              debug(2, `[applyEvent] Applied basic land type choice: ${permanent.card?.name} -> ${landType}`);
            } else {
              debugWarn(2, `[applyEvent] basicLandTypeChoice: permanent ${permanentIdStr} not found`);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(basicLandTypeChoice): failed", err);
        }
        break;
      }

      case "cardNameChoice": {
        // Player chose a card name for a permanent or spell.
        try {
          const { playerId, permanentId, spellId, chosenName, cardName } = e as any;
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.CARD_NAME_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!permanentId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === String(permanentId || '').trim()) &&
                (!spellId || String((step as any)?.spellId || '').trim() === String(spellId || '').trim())
              );
            });
          }

          const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
          const stackItem = stack.find((item: any) =>
            item && (String(item.id || '') === String(spellId || '') || String(item.cardId || '') === String(spellId || ''))
          );

          if (stackItem && chosenName) {
            (stackItem as any).chosenCardName = chosenName;
            debug(2, `[applyEvent] Applied spell card name choice: ${stackItem.card?.name || stackItem.sourceName || spellId} -> ${chosenName}`);
            ctx.bumpSeq();
            break;
          }

          const permanent = resolveReplayPermanentByEvent(ctx, {
            permanentId,
            playerId,
            cardName,
          });
          
          if (permanent && chosenName) {
            (permanent as any).chosenCardName = chosenName;
            if (permanent.card && typeof permanent.card === 'object') {
              (permanent.card as any).chosenCardName = chosenName;
            }
            debug(2, `[applyEvent] Applied card name choice: ${permanent.card?.name} -> ${chosenName}`);
          } else {
            debugWarn(2, `[applyEvent] cardNameChoice: permanent ${permanentId} not found`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(cardNameChoice): failed", err);
        }
        break;
      }
      
      case "playerChoice": {
        // Player chose a player for a permanent (e.g., Xantcha, Curses)
        try {
          const { playerId, permanentId, chosenPlayer } = e as any;
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.PLAYER_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!permanentId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === String(permanentId || '').trim())
              );
            });
          }

          const permanent = resolveReplayPermanentByEvent(ctx, {
            permanentId,
            playerId,
            cardName: (e as any).cardName,
          });
          
          if (permanent && chosenPlayer) {
            (permanent as any).chosenPlayer = chosenPlayer;
            if (permanent.card && typeof permanent.card === 'object') {
              (permanent.card as any).chosenPlayer = chosenPlayer;
            }
            debug(2, `[applyEvent] Applied player choice: ${permanent.card?.name} -> ${chosenPlayer}`);
          } else {
            debugWarn(2, `[applyEvent] playerChoice: permanent ${permanentId} not found`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(playerChoice): failed", err);
        }
        break;
      }

      case "playerSelection": {
        try {
          const choosingPlayerId = String((e as any).choosingPlayerId || '');
          const selectedPlayerId = String((e as any).selectedPlayerId || '');
          const effectType = String((e as any).effectType || (e as any).effectData?.type || '');
          const permanentId = String((e as any).permanentId || (e as any).effectData?.permanentId || '');
          const effectData = ((e as any).effectData || {}) as any;
          const battlefield = ctx.state.battlefield || [];
          const permanent = battlefield.find((p: any) => p.id === permanentId);
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          // Clear the matching resolution prompt(s). Without this, reconnect/replay leaves
          // orphaned PLAYER_CHOICE steps (Humble Defector / control-change activations) that
          // stall AI priority and can pile up into pathological queues.
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            }
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (String(step.type || '') !== String(ResolutionStepType.PLAYER_CHOICE)) return false;
              const stepPermanentId = String(step.permanentId || step.sourceId || step.effectData?.permanentId || '').trim();
              if (permanentId && stepPermanentId && stepPermanentId !== permanentId) return false;
              const stepEffectType = String(step.effectData?.type || step.effectType || '').trim();
              if (effectType && stepEffectType && stepEffectType !== effectType) return false;
              if (choosingPlayerId && String(step.playerId || '').trim() && String(step.playerId || '').trim() !== choosingPlayerId) {
                return false;
              }
              return true;
            });
          }

          if (effectType === 'set_chosen_player') {
            if (permanent) {
              (permanent as any).chosenPlayer = selectedPlayerId;
            } else {
              debugWarn(2, `[applyEvent] playerSelection(set_chosen_player): permanent ${permanentId} not found`);
            }
            ctx.bumpSeq();
            break;
          }

          if (effectType === 'control_change') {
            if (permanent) {
              const previousController = String(permanent.controller || '');
              permanent.controller = selectedPlayerId;
              syncPreparedPermanentAfterControlChange(ctx.state, permanent, previousController);
              delete (permanent as any).pendingPlayerSelection;
              delete (permanent as any).pendingControlChange;

              const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
              if (typeLine.includes('creature')) {
                (permanent as any).summoningSickness = true;
              }

              if (effectData.goadsOnChange === true && choosingPlayerId) {
                const goadedBy = (permanent as any).goadedBy || [];
                const goadedUntil = (permanent as any).goadedUntil || {};
                if (!goadedBy.includes(choosingPlayerId)) {
                  (permanent as any).goadedBy = [...goadedBy, choosingPlayerId];
                }
                const persistedGoadExpiryTurn = Number((e as any).goadExpiryTurn ?? 0);
                if (persistedGoadExpiryTurn > 0) {
                  (permanent as any).goadedUntil = {
                    ...goadedUntil,
                    [choosingPlayerId]: persistedGoadExpiryTurn,
                  };
                }
              }

              if (effectData.mustAttackEachCombat === true) {
                (permanent as any).mustAttackEachCombat = true;
              }
              if (effectData.cantAttackOwner === true) {
                (permanent as any).cantAttackOwner = true;
                (permanent as any).ownerId = choosingPlayerId;
              }
            } else {
              debugWarn(2, `[applyEvent] playerSelection(control_change): permanent ${permanentId} not found`);
            }

            const drawCount = Number(effectData.drawCards || 0);
            if (choosingPlayerId && drawCount > 0) {
              drawCards(ctx as any, choosingPlayerId as any, drawCount);
            }

            ctx.bumpSeq();
            break;
          }

          debugWarn(2, `[applyEvent] playerSelection: unsupported effectType ${effectType}`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(playerSelection): failed', err);
        }
        break;
      }

      case "exchangeTextBoxes": {
        try {
          const battlefield = ctx.state.battlefield || [];
          const sourcePermanentId = String((e as any).sourcePermanentId || '').trim();
          const targetPermanentId = String((e as any).targetPermanentId || '').trim();
          const exchanged = exchangePermanentOracleText(battlefield as any, sourcePermanentId, targetPermanentId);
          if (!exchanged) {
            debugWarn(2, `[applyEvent] exchangeTextBoxes: permanent(s) not found (${sourcePermanentId}, ${targetPermanentId})`);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(exchangeTextBoxes): failed', err);
        }
        break;
      }

      case "voteSubmit": {
        try {
          const voteId = String((e as any).voteId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const choice = String((e as any).choice || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const voteCountRaw = Number((e as any).voteCount ?? 1);
          const voteCount = Number.isFinite(voteCountRaw) && voteCountRaw > 0 ? Math.floor(voteCountRaw) : 1;
          const persistedChoices = Array.isArray((e as any).choices)
            ? ((e as any).choices as any[])
                .map((value: any) => String(value || '').trim())
                .filter((value: string) => value.length > 0)
            : [];

          if (!voteId || !playerId || !choice) {
            debugWarn(2, `[applyEvent] voteSubmit: invalid payload voteId=${voteId} playerId=${playerId} choice=${choice}`);
            break;
          }

          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.VOTE) &&
                String(step?.playerId || '').trim() === playerId &&
                String(step?.voteId || '').trim() === voteId
              );
            });
          }

          const stateAny = ctx.state as any;
          stateAny.activeVotes = stateAny.activeVotes || {};

          if (!stateAny.activeVotes[voteId]) {
            stateAny.activeVotes[voteId] = {
              choices: persistedChoices.length > 0 ? [...persistedChoices] : [],
              votes: [],
            };
          }

          const activeVote = stateAny.activeVotes[voteId];
          if (!Array.isArray(activeVote.choices)) {
            activeVote.choices = [];
          }
          if (persistedChoices.length > 0) {
            activeVote.choices = [...persistedChoices];
          }
          if (!activeVote.choices.includes(choice)) {
            activeVote.choices.push(choice);
          }
          if (!Array.isArray(activeVote.votes)) {
            activeVote.votes = [];
          }

          activeVote.votes.push({
            playerId,
            choice,
            voteCount,
          });

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(voteSubmit): failed', err);
        }
        break;
      }
      
      case "optionChoice": {
        // Player chose an option for a permanent (e.g., "flying or first strike")
        try {
          const { permanentId, chosenOption } = e as any;
          const playerId = String((e as any).playerId || '').trim();
          const permanentIdStr = String(permanentId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          const chosenOptions = Array.isArray((e as any).chosenOptions)
            ? ((e as any).chosenOptions as any[])
                .map((value: any) => String(value || '').trim())
                .filter((value: string) => value.length > 0)
            : [];

          // Clear the matching OPTION_CHOICE prompt on replay so undo/reload does not
          // leave an orphan choice UI. Live play already completed the step before emit.
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.OPTION_CHOICE)) return false;
                // Specialized option-choice events clear themselves; do not steal those prompts.
                if (
                  (step as any).myriadChoice === true
                  || (step as any).giftCastChoice === true
                  || (step as any).mdfcFaceChoice === true
                  || (step as any).forceOfWillExileChoice === true
                  || (step as any).legendRuleChoice === true
                  || (step as any).prisonersDilemmaChoice === true
                  || (step as any).optionalPaymentPrompt === true
                ) {
                  return false;
                }
                if (playerId && String(step?.playerId || '') !== playerId) return false;
                const queuedPermanentId = String((step as any).permanentId || (step as any).sourceId || '').trim();
                return !permanentIdStr || queuedPermanentId === permanentIdStr;
              });
            }
          }

          const battlefield = ctx.state.battlefield || [];
          const permanent = battlefield.find((p: any) => p.id === permanentId);
          
          if (permanent) {
            if (chosenOptions.length > 1) {
              delete (permanent as any).chosenOption;
              (permanent as any).chosenOptions = chosenOptions;
              debug(2, `[applyEvent] Applied option choice: ${permanent.card?.name} -> ${chosenOptions.join(', ')}`);
            } else {
              const resolvedChoice = chosenOptions[0] || String(chosenOption || '').trim();
              if (resolvedChoice) {
                delete (permanent as any).chosenOptions;
                (permanent as any).chosenOption = resolvedChoice;
                debug(2, `[applyEvent] Applied option choice: ${permanent.card?.name} -> ${resolvedChoice}`);
              }
            }
          } else {
            debugWarn(2, `[applyEvent] optionChoice: permanent ${permanentId} not found`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(optionChoice): failed", err);
        }
        break;
      }

      case "myriadChoice": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.OPTION_CHOICE)) return false;
                if (String(step?.playerId || '') !== playerId) return false;
                if ((step as any).myriadChoice !== true) return false;
                const queuedPermanentId = String((step as any).permanentId || (step as any).sourceId || '').trim();
                return !permanentId || queuedPermanentId === permanentId;
              });
            }
          }

          const selectedOpponentIds = Array.isArray((e as any).selectedOpponentIds)
            ? ((e as any).selectedOpponentIds as any[])
                .map((value: any) => String(value || '').trim())
                .filter(Boolean)
            : [];
          const createdPermanentIds = Array.isArray((e as any).createdPermanentIds)
            ? ((e as any).createdPermanentIds as any[])
                .map((value: any) => String(value || '').trim())
                .filter(Boolean)
            : [];
          const sourcePermanentSnapshot = (e as any).sourcePermanentSnapshot && typeof (e as any).sourcePermanentSnapshot === 'object'
            ? JSON.parse(JSON.stringify((e as any).sourcePermanentSnapshot))
            : null;
          const sourceName = String((e as any).sourceName || sourcePermanentSnapshot?.card?.name || 'Myriad').trim() || 'Myriad';
          const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
          const sourcePermanent = sourcePermanentSnapshot
            || battlefield.find((permanent: any) => String(permanent?.id || '') === permanentId)
            || null;

          if (!playerId || !sourcePermanent) {
            debugWarn(2, `[applyEvent] myriadChoice: missing source snapshot for ${permanentId || 'unknown permanent'}`);
            ctx.bumpSeq();
            break;
          }

          applyMyriadTokenCopies(
            ctx as any,
            sourcePermanent,
            playerId as any,
            selectedOpponentIds,
            createdPermanentIds,
            sourceName,
          );
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(myriadChoice): failed', err);
        }
        break;
      }

      case "retargetAbilityCopyResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const stackItemId = String((e as any).stackItemId || '').trim();
          const targets = Array.isArray((e as any).targets)
            ? ((e as any).targets as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];
          if (!stackItemId || targets.length === 0) break;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (String((step as any)?.type || '') !== String(ResolutionStepType.TARGET_SELECTION)) return false;
              if ((step as any)?.retargetAbilityCopyTargetSelection !== true) return false;
              return String((step as any)?.sourceId || '').trim() === stackItemId;
            });
          }

          const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
          const copiedItem = stack.find((item: any) => item && String(item.id || '') === stackItemId);
          if (!copiedItem) break;

          copiedItem.targets = [...targets];

          const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
          if (String((copiedItem as any).abilityType || '') === 'equip' && (copiedItem as any).equipParams) {
            const nextTargetId = String(copiedItem.targets[0] || '').trim();
            const validTarget = Array.isArray((copiedItem as any).copyRetargetValidTargets)
              ? (copiedItem as any).copyRetargetValidTargets.find((target: any) => String(target?.id || '') === nextTargetId)
              : battlefield.find((target: any) => target && String(target.id || '') === nextTargetId);
            (copiedItem as any).equipParams = {
              ...((copiedItem as any).equipParams || {}),
              targetCreatureId: nextTargetId,
              targetCreatureName: String(validTarget?.name || validTarget?.card?.name || (copiedItem as any).equipParams?.targetCreatureName || 'Creature'),
            };
          } else if (String((copiedItem as any).abilityType || '') === 'reconfigure_attach' && (copiedItem as any).reconfigureParams) {
            const nextTargetId = String(copiedItem.targets[0] || '').trim();
            const validTarget = Array.isArray((copiedItem as any).copyRetargetValidTargets)
              ? (copiedItem as any).copyRetargetValidTargets.find((target: any) => String(target?.id || '') === nextTargetId)
              : battlefield.find((target: any) => target && String(target.id || '') === nextTargetId);
            (copiedItem as any).reconfigureParams = {
              ...((copiedItem as any).reconfigureParams || {}),
              targetCreatureId: nextTargetId,
              targetCreatureName: String(validTarget?.name || validTarget?.card?.name || (copiedItem as any).reconfigureParams?.targetCreatureName || 'Creature'),
            };
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(retargetAbilityCopyResolve): failed', err);
        }
        break;
      }

      case "retargetSpellCopyResolve": {
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const stackItemId = String((e as any).stackItemId || '').trim();
          const targets = Array.isArray((e as any).targets)
            ? ((e as any).targets as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];
          if (!stackItemId || targets.length === 0) break;

          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (String((step as any)?.type || '') !== String(ResolutionStepType.TARGET_SELECTION)) return false;
              if ((step as any)?.retargetSpellCopyTargetSelection !== true) return false;
              return String((step as any)?.sourceId || '').trim() === stackItemId;
            });
          }

          const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
          const copiedItem = stack.find((item: any) => item && String(item.id || '') === stackItemId);
          if (!copiedItem) break;

          copiedItem.targets = [...targets];

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(retargetSpellCopyResolve): failed', err);
        }
        break;
      }

      case "moveResolvedInstantOrSorcery": {
        try {
          const controller = String((e as any).controller || (e as any).playerId || '').trim();
          const cardId = String((e as any).cardId || '').trim();
          const destination = String((e as any).destination || 'graveyard').trim().toLowerCase();
          const cardSnapshot = (e as any).card && typeof (e as any).card === 'object' && !Array.isArray((e as any).card)
            ? { ...((e as any).card as any) }
            : null;

          if (!controller || !cardId) break;

          const stack = Array.isArray(ctx.state.stack) ? ctx.state.stack : [];
          const stackIndex = stack.findIndex(
            (entry: any) => entry && String(entry?.card?.id || '') === cardId,
          );
          if (stackIndex !== -1) {
            stack.splice(stackIndex, 1);
          }

          if (destination === 'ceased') {
            ctx.bumpSeq();
            break;
          }

          const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
          const playerZones = zones[controller] = zones[controller] || {};
          const card = cardSnapshot || { id: cardId };

          if (destination === 'graveyard') {
            playerZones.graveyard = playerZones.graveyard || [];
            if (!playerZones.graveyard.some((entry: any) => entry && String(entry.id || '') === cardId)) {
              if (pushCardToPlayerGraveyardWithReplacements(ctx, controller as any, card, playerZones.graveyard)) {
                playerZones.graveyardCount = playerZones.graveyard.length;
              }
            }
          } else if (destination === 'exile') {
            playerZones.exile = playerZones.exile || [];
            if (!playerZones.exile.some((entry: any) => entry && String(entry.id || '') === cardId)) {
              playerZones.exile.push({ ...card, zone: 'exile' });
              playerZones.exileCount = playerZones.exile.length;
            }
          } else if (destination === 'library') {
            const lib = ctx.libraries?.get(controller) || [];
            if (!lib.some((entry: any) => entry && String(entry.id || '') === cardId)) {
              lib.push({ ...card, zone: 'library' });
              ctx.libraries?.set(controller, lib);
              playerZones.libraryCount = lib.length;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(moveResolvedInstantOrSorcery): failed', err);
        }
        break;
      }

      case "effectProgramZoneMove": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const fromPlayerId = String((e as any).fromPlayerId || playerId || '').trim();
          const cardId = String((e as any).cardId || '').trim();
          const fromZone = String((e as any).fromZone || '').trim().toLowerCase();
          const toZone = String((e as any).toZone || '').trim().toLowerCase();
          const permanentId = String((e as any).permanentId || '').trim();
          const fromPermanentId = String((e as any).fromPermanentId || '').trim();
          const cardSnapshot = (e as any).card && typeof (e as any).card === 'object' && !Array.isArray((e as any).card)
            ? { ...((e as any).card as any) }
            : null;

          if (!playerId || !fromZone || !toZone) break;

          if (toZone === 'battlefield' && permanentId) {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            if (battlefield.some((perm: any) => perm && String(perm.id || '') === permanentId)) {
              break;
            }
          } else if (cardId && toZone !== 'library' && toZone !== 'battlefield') {
            const zones = (ctx.state as any).zones || {};
            const dest = zones[playerId] || {};
            const destList = Array.isArray(dest[toZone]) ? dest[toZone] as any[] : [];
            if (destList.some((entry: any) => entry && String(entry.id || '') === cardId)) {
              break;
            }
          }

          let card: any = cardSnapshot ? { ...cardSnapshot } : null;

          if (fromZone === 'battlefield' && fromPermanentId) {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            const permIndex = battlefield.findIndex((perm: any) => perm && String(perm.id || '') === fromPermanentId);
            if (permIndex !== -1) {
              const [permanent] = battlefield.splice(permIndex, 1);
              if (!card && permanent?.card) {
                card = { ...permanent.card };
              }
            }
          } else if (fromZone === 'library') {
            const lib = ctx.libraries.get(fromPlayerId) || [];
            const libIndex = cardId
              ? lib.findIndex((entry: any) => entry && String(entry.id || '') === cardId)
              : -1;
            if (libIndex !== -1) {
              [card] = lib.splice(libIndex, 1);
              ctx.libraries.set(fromPlayerId, lib);
              const zones = (ctx.state as any).zones || {};
              const z = zones[fromPlayerId] || {};
              z.libraryCount = lib.length;
            }
          } else if (fromZone === 'hand' || fromZone === 'graveyard' || fromZone === 'exile') {
            const zones = (ctx.state as any).zones || {};
            const z = zones[fromPlayerId] || {};
            const sourceList = Array.isArray(z[fromZone]) ? z[fromZone] as any[] : [];
            const sourceIndex = cardId
              ? sourceList.findIndex((entry: any) => entry && String(entry.id || '') === cardId)
              : -1;
            if (sourceIndex !== -1) {
              [card] = sourceList.splice(sourceIndex, 1);
              z[`${fromZone}Count`] = sourceList.length;
            }
          }

          if (!card && cardSnapshot) {
            card = { ...cardSnapshot };
          }

          // Undo/replay can miss the source splice (id drift) and still enter from
          // cardSnapshot — strip any remaining ghost with the same card.id first.
          if (card) {
            const resolvedCardId = String(card.id || cardId || '').trim();
            if (resolvedCardId) {
              if (toZone === 'battlefield') {
                repairReplayCardSourceZones(ctx, fromPlayerId, resolvedCardId);
              } else if (toZone === 'graveyard') {
                repairCardIdAwayFromZones(ctx, fromPlayerId, resolvedCardId, [
                  'hand',
                  'exile',
                  'library',
                ]);
              } else if (toZone === 'exile') {
                repairCardIdAwayFromZones(ctx, fromPlayerId, resolvedCardId, [
                  'hand',
                  'library',
                ]);
              } else if (toZone === 'hand') {
                repairCardIdAwayFromZones(ctx, fromPlayerId, resolvedCardId, [
                  'exile',
                  'library',
                  'graveyard',
                ]);
              }
            }
          }

          if (toZone === 'battlefield' && permanentId && card) {
            if (isImpossibleFaceUpNonPermanentBattlefieldCard(card, e)) {
              // Face-up instants/sorceries cannot enter the battlefield via replay.
              // Divert to graveyard so the physical card is not lost after the source splice.
              const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
              const z = zones[playerId] = zones[playerId] || {
                hand: [],
                handCount: 0,
                graveyard: [],
                graveyardCount: 0,
                exile: [],
                exileCount: 0,
              };
              z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
              const gy = z.graveyard as any[];
              if (!gy.some((entry: any) => entry && String(entry.id || '') === String(card.id || ''))) {
                pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, card, gy);
                z.graveyardCount = gy.length;
              }
            } else {
              const battlefield = Array.isArray(ctx.state.battlefield)
                ? ctx.state.battlefield
                : ((ctx.state as any).battlefield = []);
              const typeLine = String(card.type_line || '').toLowerCase();
              const isCreature = typeLine.includes('creature');
              const faceDown = isFaceDownBattlefieldPermanentFlags(e, card);
              battlefield.push({
                id: permanentId,
                controller: String((e as any).controllerId || playerId).trim() || playerId,
                owner: String((e as any).ownerId || (e as any).fromPlayerId || playerId).trim() || playerId,
                tapped: (e as any).tapped === true || (e as any).entersTapped === true,
                counters: {},
                faceDown: faceDown || undefined,
                basePower: isCreature ? parsePT(card.power) : undefined,
                baseToughness: isCreature ? parsePT(card.toughness) : undefined,
                summoningSickness: isCreature,
                card: { ...card, zone: 'battlefield' },
              } as any);
            }
          } else if (toZone === 'library' && card) {
            const lib = ctx.libraries.get(playerId) || [];
            if (!lib.some((entry: any) => entry && String(entry.id || '') === String(card.id || ''))) {
              const placement = String((e as any).libraryPlacement || '').trim().toLowerCase() === 'bottom'
                ? 'bottom'
                : 'top';
              if (placement === 'bottom') {
                lib.push({ ...card, zone: 'library' });
              } else {
                lib.unshift({ ...card, zone: 'library' });
              }
              ctx.libraries.set(playerId, lib);
              const zones = (ctx.state as any).zones || {};
              const z = zones[playerId] = zones[playerId] || {};
              z.libraryCount = lib.length;
            }
          } else if ((toZone === 'hand' || toZone === 'graveyard' || toZone === 'exile') && card) {
            const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
            const z = zones[playerId] = zones[playerId] || {
              hand: [],
              handCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            };
            z[toZone] = Array.isArray(z[toZone]) ? z[toZone] : [];
            const destList = z[toZone] as any[];
            if (!destList.some((entry: any) => entry && String(entry.id || '') === String(card.id || ''))) {
              if (toZone === 'graveyard') {
                pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, card, destList);
              } else {
                destList.push({ ...card, zone: toZone });
              }
              z[`${toZone}Count`] = destList.length;
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(effectProgramZoneMove): failed', err);
        }
        break;
      }

      case "putCardFromHandOntoBattlefield": {
        try {
          const playerId = String((e as any).playerId || '').trim();
          const cardId = String((e as any).cardId || '').trim();
          const permanentId = String((e as any).permanentId || '').trim();
          const tappedAndAttacking = (e as any).tappedAndAttacking === true;
          const cardSnapshot = (e as any).card && typeof (e as any).card === 'object' && !Array.isArray((e as any).card)
            ? { ...((e as any).card as any) }
            : null;

          if (!playerId || !permanentId) break;

          const zones = (ctx.state as any).zones = (ctx.state as any).zones || {};
          const z = zones[playerId] = zones[playerId] || {
            hand: [],
            handCount: 0,
            library: [],
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          };

          let card: any = null;
          if (Array.isArray(z.hand)) {
            const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id || '') === cardId);
            if (handIndex !== -1) {
              [card] = (z.hand as any[]).splice(handIndex, 1);
              z.handCount = (z.hand as any[]).length;
            }
          }

          if (!card && cardSnapshot) {
            card = { ...cardSnapshot };
          }

          // Same undo/replay dual-zone guard as effectProgramZoneMove.
          if (card) {
            const resolvedCardId = String(card.id || cardId || '').trim();
            if (resolvedCardId) {
              repairReplayCardSourceZones(ctx, playerId, resolvedCardId);
            }
          }

          const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : ((ctx.state as any).battlefield = []);
          const existingPermanent = battlefield.find((perm: any) => perm && String(perm.id || '') === permanentId);

          if (!existingPermanent && card) {
            if (isImpossibleFaceUpNonPermanentBattlefieldCard(card, e)) {
              z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
              const gy = z.graveyard as any[];
              if (!gy.some((entry: any) => entry && String(entry.id || '') === String(card.id || ''))) {
                pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, card, gy);
                z.graveyardCount = gy.length;
              }
            } else {
              const typeLine = String(card.type_line || '').toLowerCase();
              const isCreature = typeLine.includes('creature');
              const faceDown = isFaceDownBattlefieldPermanentFlags(e, card);
              battlefield.push({
                id: permanentId,
                controller: playerId,
                owner: playerId,
                tapped: tappedAndAttacking,
                counters: {},
                faceDown: faceDown || undefined,
                basePower: isCreature ? parsePT(card.power) : undefined,
                baseToughness: isCreature ? parsePT(card.toughness) : undefined,
                summoningSickness: isCreature && !tappedAndAttacking,
                isAttacking: tappedAndAttacking,
                card: { ...card, zone: 'battlefield' },
              } as any);
            }
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(putCardFromHandOntoBattlefield): failed', err);
        }
        break;
      }

      default: {
        // Log unknown events but don't fail - they may be newer events not yet supported
        // or events that don't affect core game state
        break;
      }
    }
  } catch (err) {
    debugWarn(1, "applyEvent: failed to apply event", (e as any).type, err);
  }
}

/**
 * Replay a sequence of persisted events into ctx.
 * Special-case passPriority events to call passPriority directly for safety.
 *
 * Also handles backward compatibility for old games that don't have explicit
 * shuffleLibrary/drawCards events after setCommander.
 */

export type ReplayProgressHooks = {
  afterEachEvent?: (ctx: GameContext, event: GameEvent, index: number) => void;
  onProgress?: (current: number, total: number) => void;
  /** Yield to the event loop every N applied events (async replay only). Default 50. */
  yieldEvery?: number;
};

type ReplayCompatSets = {
  playersWithShuffleEvent: Set<string>;
  playersWithDrawEvent: Set<string>;
};

function beginReplayPass(
  ctx: GameContext,
  events: GameEvent[],
): ReplayCompatSets {
  // Ensure any stale per-game resolution steps are cleared before rebuilding state.
  // The queue is not persisted in the event log, so it must not leak across reset/replay.
  try {
    if (ctx?.gameId) {
      ResolutionQueueManager.clearAllSteps(ctx.gameId);
      ResolutionQueueManager.beginReplay(ctx.gameId);
    }
  } catch {
    // best-effort only
  }

  // Track which players have shuffle/draw events anywhere in the event list
  // This is used to detect old-style games that don't have explicit shuffle/draw events
  // and need backward compatibility handling
  const playersWithShuffleEvent = new Set<string>();
  const playersWithDrawEvent = new Set<string>();

  for (const e of events) {
    if (!e || typeof e.type !== "string") continue;

    const pid = (e as any).playerId as string | undefined;
    if (!pid) continue;

    if (e.type === "shuffleLibrary") {
      playersWithShuffleEvent.add(pid);
    } else if (e.type === "drawCards") {
      playersWithDrawEvent.add(pid);
    }
  }

  try {
    (ctx as any)._replayEvents = events;
  } catch {
    // ignore
  }

  return { playersWithShuffleEvent, playersWithDrawEvent };
}

function applyOneReplayEvent(
  ctx: GameContext,
  events: GameEvent[],
  i: number,
  compat: ReplayCompatSets,
  afterEachEvent?: (ctx: GameContext, event: GameEvent, index: number) => void,
): void {
  const e = events[i];
  if (!e || typeof e.type !== "string") return;

  // Provide lookahead/lookbehind for replay-only behaviors.
  // Lookahead: avoid double-applying when an explicit event follows
  // (e.g., nextStep calling nextTurn vs a nextTurn event; nextStep then pushTriggeredAbility).
  // Lookbehind: live sockets historically appended nextStep *after* nextStep() ran,
  // so persisted pushTriggeredAbility events land immediately before the nextStep event.
  try {
    (ctx as any)._replayEventIndex = i;
    (ctx as any)._replayCurrentEventType = e.type;
    (ctx as any)._replayNextEventType = (events[i + 1] as any)?.type;
    (ctx as any)._replayPreviousEvent = i > 0 ? events[i - 1] : null;
    (ctx as any)._replayPreviousEventType = (events[i - 1] as any)?.type;
  } catch {
    // ignore
  }

  if (e.type === "passPriority") {
    try {
      if (typeof passPriority === "function")
        passPriority(ctx as any, (e as any).by);
    } catch (err) {
      debugWarn(1, "replay: passPriority failed", err);
    }
    return;
  }

  applyEvent(ctx, e);

  // Backward compatibility: if setCommander was called and there are no
  // shuffleLibrary/drawCards events FOR THIS PLAYER in the event list, do them now
  // This handles old games that don't have explicit shuffle/draw events after setCommander
  if (e.type === "setCommander") {
    const pid = (e as any).playerId;
    const needsShuffle = !compat.playersWithShuffleEvent.has(pid);
    const needsDraw = !compat.playersWithDrawEvent.has(pid);

    if (needsShuffle || needsDraw) {
      // Check if hand is empty (meaning opening draw hasn't happened)
      const zones = ctx.state.zones || {};
      const z = zones[pid];
      const handCount = z
        ? (typeof z.handCount === "number" ? z.handCount : (Array.isArray(z.hand) ? z.hand.length : 0))
        : 0;

      if (handCount === 0) {
        debug(1, "[replay] Backward compat: performing opening draw after setCommander for", pid);
        try {
          if (needsShuffle) {
            shuffleLibrary(ctx as any, pid);
          }
          if (needsDraw) {
            drawCards(ctx as any, pid, 7);
          }
        } catch (err) {
          debugWarn(1, "[replay] Backward compat: opening draw failed for", pid, err);
        }
      }
    }
  }

  if (typeof afterEachEvent === "function") {
    try {
      afterEachEvent(ctx, e, i);
    } catch {
      // ignore probe callback failures
    }
  }
}

function endReplayPass(ctx: GameContext, events: GameEvent[]): void {
  (ctx as any).isReplaying = false;
  try {
    delete (ctx as any)._replayCurrentEventType;
    delete (ctx as any)._replayNextEventType;
    delete (ctx as any)._replayPreviousEvent;
    delete (ctx as any)._replayPreviousEventType;
    delete (ctx as any)._replayEvents;
    delete (ctx as any)._replayEventIndex;
    (ctx as any)._replayLastEvent = events.length > 0 ? events[events.length - 1] : undefined;
    (ctx as any)._replayLastEventType = events.length > 0
      ? String((events[events.length - 1] as any)?.type || "").trim()
      : "";
    (ctx as any)._replayPenultimateEvent = events.length > 1 ? events[events.length - 2] : undefined;
  } catch {
    // ignore
  }
  try {
    finalizeGameStateAfterReplay(ctx);
  } catch {
    // best-effort only
  }
}

export function replay(
  ctx: GameContext,
  events: GameEvent[],
  afterEachEvent?: (ctx: GameContext, event: GameEvent, index: number) => void,
) {
  if (!Array.isArray(events)) return;

  // Set replay mode flag to prevent side effects in functions like nextStep
  // This ensures that actions like drawing cards during draw step aren't duplicated
  // when explicit drawCards events are also in the event log
  (ctx as any).isReplaying = true;

  try {
    const compat = beginReplayPass(ctx, events);
    for (let i = 0; i < events.length; i++) {
      applyOneReplayEvent(ctx, events, i, compat, afterEachEvent);
    }
    try {
      reconcileZonesConsistency(ctx as any);
    } catch {
      /* swallow */
    }
  } finally {
    endReplayPass(ctx, events);
  }
}

/**
 * Same as {@link replay}, but yields to the event loop periodically so HTTP/socket
 * progress updates can flush during long post-restart restores.
 */
export async function replayAsync(
  ctx: GameContext,
  events: GameEvent[],
  options?: ReplayProgressHooks,
): Promise<void> {
  if (!Array.isArray(events)) return;

  const afterEachEvent = options?.afterEachEvent;
  const onProgress = options?.onProgress;
  const yieldEvery = Math.max(1, options?.yieldEvery ?? 50);
  const total = events.length;

  (ctx as any).isReplaying = true;

  try {
    const compat = beginReplayPass(ctx, events);
    onProgress?.(0, total);

    for (let i = 0; i < total; i++) {
      applyOneReplayEvent(ctx, events, i, compat, afterEachEvent);
      const current = i + 1;
      if (current === total || current % yieldEvery === 0) {
        onProgress?.(current, total);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    try {
      reconcileZonesConsistency(ctx as any);
    } catch {
      /* swallow */
    }
  } finally {
    endReplayPass(ctx, events);
  }
}


