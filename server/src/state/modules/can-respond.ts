/**
 * can-respond.ts
 * 
 * Determines if a player can respond to something during priority.
 * This enables auto-passing priority when a player has no legal responses available.
 * 
 * A player can respond if they can:
 * 1. Cast instant spells or spells with flash
 * 2. Activate abilities (tap abilities, activated abilities with costs)
 * 3. Pay the costs required (mana, tap, life, alternate costs like Force of Will)
 * 4. Have valid targets if targeting is required
 * 
 * This is used to improve gameplay flow by automatically passing priority
 * when a player has no available responses.
 */

import type { GameContext } from "../context";
import type { PlayerID } from "../../../../shared/src";
import { parseManaCost, canPayManaCostWithAvailableSources, getManaPoolFromState, getAvailableMana } from "./mana-check";
import { hasPayableAlternateCost } from "./alternate-costs";
import { hasValidTargetsForSpell } from "../../rules-engine/target-availability.js";
import { calculateMaxLandsPerTurn, canCastFromTop, canPlayLandsFromTop, getActiveAbilityConditions } from "./game-state-effects";
import { buildGraveyardCastingPermissionId, getActiveGraveyardCastingPermissions, getGrantedCastFromGraveyardKeywordInfo, getGrantedEmbalmInfo, getGrantedUnearthInfo, getPrintedSelfCastPermissionInfo, getPrintedUnearthInfo, type GraveyardCastingPermission, type GraveyardCastingPermissionCostMode } from "./graveyard-permissions";
import { detectActivatedAbilityConditionRequirement } from "./activated-ability-conditions";
import { applyCostAdjustmentToParsedCost, buildCostAdjustmentPlan, getCostAdjustmentForCard as getSharedCostAdjustmentForCard, type CostAdjustmentPlan } from "./cost-adjustments";
import { collectStaticEffectSources } from "./static-effect-sources";
import { creatureHasHaste } from "../../socket/game-actions.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { cardManaValue } from "../utils";
import { getCurrentGoaders } from "./goad-effects.js";
import { isAbilityActivationProhibitedByChosenName, isSpellCastingProhibitedByChosenName } from "./chosen-name-restrictions.js";
import { canActivateLoyaltyAtInstantSpeed } from "./triggered-abilities.js";
import { canPayCounterRemovalCost } from "./counter-removal-costs.js";
import { cardAllowsPlayerToPlayFromExile, getPlayableExileCardsForPlayer, getPlayableFromExileDurablePermissionForCard } from "./playable-from-exile.js";
import { getDurableCommandZonePermissionForCard, playerHasDurableLandPlayPermission } from "./durable-permissions";

function cardHasSplitSecond(card: any): boolean {
  if (!card) return false;
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const oracleText = String(card.oracle_text || '').toLowerCase();
  return keywords.some((k: any) => String(k).toLowerCase() === 'split second') || oracleText.includes('split second');
}

function isSplitSecondLockActive(state: any): boolean {
  const stack = state?.stack;
  if (!Array.isArray(stack) || stack.length === 0) return false;

  // Rules-wise, Split Second should be the top-most spell (players can't add to the stack),
  // but be robust and scan the whole stack.
  for (const item of stack) {
    const card = item?.card ?? item?.spell?.card ?? item?.sourceCard ?? item?.source?.card;
    if (cardHasSplitSecond(card)) return true;
  }
  return false;
}

function isLandTypeLine(typeLine: unknown): boolean {
  return /\bland\b/i.test(String(typeLine || ''));
}

function isActivatedAbilityConditionMet(ctx: GameContext, playerId: PlayerID, fullAbilityText: string, oracleText?: string, matchIndex?: number): boolean {
  const requirement = detectActivatedAbilityConditionRequirement(fullAbilityText, oracleText, matchIndex);
  if (!requirement) {
    return true;
  }

  const activeConditions = getActiveAbilityConditions(ctx, playerId);
  return activeConditions[requirement.key] === true;
}

function buildCastEvaluationFace(card: any, face: any, faceIndex: number, extras?: Record<string, unknown>): any {
  const manaCost = face?.mana_cost ?? face?.manaCost ?? card?.mana_cost ?? card?.manaCost;
  return {
    ...card,
    ...(face || {}),
    name: face?.name || card?.name,
    type_line: face?.type_line || face?.typeLine || card?.type_line,
    oracle_text: face?.oracle_text || face?.oracleText || card?.oracle_text,
    mana_cost: manaCost,
    manaCost,
    colors: Array.isArray(face?.colors) ? face.colors : card?.colors,
    image_uris: face?.image_uris || card?.image_uris,
    faceIndex,
    ...(extras || {}),
  };
}

function normalizeParsedCostForAnyTypeManaSpending(parsedCost: ReturnType<typeof parseManaCost>): ReturnType<typeof parseManaCost> {
  const colorCostTotal = Object.values(parsedCost.colors || {}).reduce(
    (sum, value) => sum + Math.max(0, Number(value || 0)),
    0,
  );
  const hybrid = Array.isArray(parsedCost.hybrid)
    ? parsedCost.hybrid.map((options) => {
        const normalizedOptions = Array.isArray(options)
          ? options.map((option) => String(option || '').trim().toUpperCase()).filter(Boolean)
          : [];
        const lifeOptions = normalizedOptions.filter((option) => /^LIFE:\d+$/.test(option));
        const genericOptions = normalizedOptions
          .filter((option) => /^GENERIC:\d+$/.test(option))
          .map((option) => Number(option.slice('GENERIC:'.length)))
          .filter((value) => Number.isFinite(value) && value > 0);
        const hasManaTypeOption = normalizedOptions.some((option) => /^[WUBRGC]$/.test(option));

        if (hasManaTypeOption) {
          return ['GENERIC:1', ...lifeOptions];
        }

        if (genericOptions.length > 0) {
          return [`GENERIC:${Math.min(...genericOptions)}`, ...lifeOptions];
        }

        return lifeOptions;
      })
    : [];

  return {
    ...parsedCost,
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: Math.max(0, Number(parsedCost.generic || 0)) + colorCostTotal,
    hybrid,
  };
}

export function getHandCastEvaluationCards(card: any): any[] {
  if (!card || typeof card === 'string') return [];
  if (isTransformBackFace(card)) return [];

  const layout = String(card?.layout || '').toLowerCase();
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];

  if ((layout === 'transform' || layout === 'double_faced_token') && cardFaces.length >= 1) {
    return [buildCastEvaluationFace(card, cardFaces[0], 0)];
  }

  if (layout === 'adventure' && cardFaces.length >= 2) {
    return [
      buildCastEvaluationFace(card, cardFaces[0], 0, { castAsAdventure: false }),
      buildCastEvaluationFace(card, cardFaces[1], 1, { castAsAdventure: true }),
    ];
  }

  if (layout === 'modal_dfc' && cardFaces.length >= 1) {
    return cardFaces
      .map((face: any, index: number) => ({ face, index }))
      .filter(({ face }) => !isLandTypeLine(face?.type_line || face?.typeLine))
      .map(({ face, index }) => buildCastEvaluationFace(card, face, index));
  }

  if (layout === 'split' && cardFaces.length >= 2) {
    return cardFaces.map((face: any, index: number) => buildCastEvaluationFace(card, face, index));
  }

  return [card];
}

export type SharedSpellSourceZone = 'hand' | 'graveyard' | 'exile' | 'library';
export type SharedSpellCandidateMode = 'main' | 'response' | 'sorcery';
export type SharedSpellCandidatePayability = 'normal' | 'alternate' | 'assumed';
export type SharedSpellCastMethod = 'normal' | 'flashback' | 'jump-start' | 'retrace' | 'escape' | 'harmonize' | 'foretell' | 'playable_from_exile' | 'graveyard_permanent';
export type SharedLandSourceZone = SharedSpellSourceZone;

export interface SharedSourceGrantedAdditionalCost {
  type: 'discard' | 'sacrifice' | 'remove_counters';
  amount: number;
  filter?: string;
  counterType?: string;
  distributed?: boolean;
}

export interface SharedSpellCastCandidate {
  card: any;
  castCard: any;
  sourceZone: SharedSpellSourceZone;
  castMethod: SharedSpellCastMethod;
  payability: SharedSpellCandidatePayability;
  manaCost?: string;
  cost?: ReturnType<typeof parseManaCost>;
  grantsFlash?: boolean;
  exileAfterResolution?: boolean;
  leaveBattlefieldReplacementDestination?: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
  sourceGrantedAdditionalCost?: SharedSourceGrantedAdditionalCost;
  graveyardPermissionId?: string;
  graveyardPermissionSourceName?: string;
  graveyardPermissionCostMode?: GraveyardCastingPermissionCostMode;
  libraryPermissionCostMode?: string;
}

export interface SharedPlayableLandCandidate {
  card: any;
  sourceZone: SharedLandSourceZone;
  selectedFaceIndex?: number;
  graveyardPermissionId?: string;
  graveyardPermissionSourceName?: string;
  leaveBattlefieldReplacementDestination?: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
}

export type SharedCommanderParsedCost = ReturnType<typeof parseManaCost> & {
  cmc: number;
};

export interface SharedCommanderBaseCandidate {
  card: any;
  commanderId: string;
  manaCost: string;
  cost: SharedCommanderParsedCost;
  grantsFlash: boolean;
  isBackground: boolean;
  commanderTax: number;
  costAdjustment: number;
  commandZonePermissionCostMode?: string;
  spendManaAsThoughAnyType?: boolean;
}

export interface SharedCommanderAvailabilityCandidate extends SharedCommanderBaseCandidate {
  canPayCost: boolean;
}

export type SharedCommanderCastCandidate = SharedCommanderBaseCandidate;

function getCommandZoneCommanderCards(commandZone: any): any[] {
  if (Array.isArray(commandZone?.commanderCards)) {
    return commandZone.commanderCards;
  }

  if (Array.isArray(commandZone?.commanders)) {
    return commandZone.commanders;
  }

  return [];
}

function getCommandZoneCommanderIds(commandZone: any): string[] {
  if (Array.isArray(commandZone?.inCommandZone) && commandZone.inCommandZone.length > 0) {
    return commandZone.inCommandZone.map((entry: unknown) => String(entry || '').trim()).filter(Boolean);
  }

  if (Array.isArray(commandZone?.commanderIds)) {
    return commandZone.commanderIds.map((entry: unknown) => String(entry || '').trim()).filter(Boolean);
  }

  return [];
}

function isCommanderAlreadyOnBattlefieldOrStack(
  state: any,
  playerId: PlayerID,
  commanderId: string,
  commander: any,
): boolean {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const commanderName = String(commander?.name || '').trim();

  const matchesCommander = (entry: any) => {
    const entryCard = entry?.card || entry?.spell?.card || entry?.sourceCard || entry?.source?.card;
    const entryCardId = String(entryCard?.id || '').trim();
    const entryCardName = String(entryCard?.name || '').trim();
    return (
      entryCardId === commanderId ||
      (commanderName.length > 0 && entryCardName === commanderName) ||
      (entry?.isCommander === true && String(entry?.controller || '') === String(playerId || '') && entryCardName === commanderName)
    );
  };

  return battlefield.some(matchesCommander) || stack.some(matchesCommander);
}

export function getCommandZoneCommanderCandidates(
  ctx: GameContext,
  playerId: PlayerID,
): SharedCommanderAvailabilityCandidate[] {
  try {
    const state = ctx?.state as any;
    if (!state) return [];

    const commandZone = state.commandZone?.[playerId];
    if (!commandZone) return [];

    const commanderCards = getCommandZoneCommanderCards(commandZone);
    const inCommandZone = getCommandZoneCommanderIds(commandZone);
    if (commanderCards.length === 0 || inCommandZone.length === 0) {
      return [];
    }

    const candidates: SharedCommanderAvailabilityCandidate[] = [];

    for (const commanderKey of inCommandZone) {
      const commander = commanderCards.find((card: any) => {
        const cardId = String(card?.id || '').trim();
        const cardName = String(card?.name || '').trim();
        return cardId === commanderKey || cardName === commanderKey;
      });
      if (!commander) continue;

      const commanderId = String(commander?.id || commanderKey).trim();
      if (!commanderId) continue;

      if (isCommanderAlreadyOnBattlefieldOrStack(state, playerId, commanderId, commander)) {
        continue;
      }

      const manaCost = String(commander?.mana_cost || commander?.manaCost || '').trim();
      if (!manaCost) continue;

      const durableCommandPermission = getDurableCommandZonePermissionForCard(state, playerId, commander, 'cast');
      const commandZonePermissionCostMode = String(durableCommandPermission?.costMode || '').trim() || undefined;
      const spendManaAsThoughAnyType = (durableCommandPermission?.metadata as any)?.spendManaAsThoughAnyType === true;
      const parsedCost = parseManaCost(commandZonePermissionCostMode === 'without_paying_mana_cost' ? '' : manaCost);
      const commanderTax = Number((commandZone as any).taxById?.[commanderId] ?? (commandZone as any).taxById?.[commanderKey] ?? 0) || 0;
      const costAdjustmentPlan = buildCostAdjustmentPlan(state, playerId, commander);
      const costAdjustment = costAdjustmentPlan.totalAdjustment;
      const adjustedCost = applyCostAdjustmentToParsedCost(parsedCost, costAdjustmentPlan, commanderTax);
      const payableCost = spendManaAsThoughAnyType
        ? normalizeParsedCostForAnyTypeManaSpending(adjustedCost)
        : adjustedCost;
      const canPayCost = canPayManaCostWithAvailableSources(state, playerId, payableCost);

      const typeLine = String(commander?.type_line || commander?.typeLine || '').toLowerCase();
      const cmc = adjustedCost.generic + Object.values(adjustedCost.colors).reduce((sum, value) => sum + value, 0);

      candidates.push({
        card: commander,
        commanderId,
        manaCost,
        cost: {
          ...adjustedCost,
          cmc,
        },
        grantsFlash: hasFlashOrInstant(commander) || durableCommandPermission?.timingOverride?.asThoughFlash === true,
        isBackground: typeLine.includes('background'),
        commanderTax,
        costAdjustment,
        canPayCost,
        ...(commandZonePermissionCostMode ? { commandZonePermissionCostMode } : {}),
        ...(spendManaAsThoughAnyType ? { spendManaAsThoughAnyType: true } : {}),
      });
    }

    return candidates;
  } catch (err) {
    debugWarn(1, '[getCommandZoneCommanderCandidates] Error:', err);
    return [];
  }
}

export function getCastableCommanderCandidates(
  ctx: GameContext,
  playerId: PlayerID,
): SharedCommanderCastCandidate[] {
  try {
    const state = ctx?.state as any;
    if (!state) return [];

    if (isSplitSecondLockActive(state)) {
      return [];
    }

    return getCommandZoneCommanderCandidates(ctx, playerId)
      .filter((candidate) => candidate.canPayCost)
      .map(({ canPayCost: _canPayCost, ...candidate }) => candidate);
  } catch (err) {
    debugWarn(1, '[getCastableCommanderCandidates] Error:', err);
    return [];
  }
}

function isPermanentSpellType(typeLine: string): boolean {
  return (
    typeLine.includes('creature') ||
    typeLine.includes('artifact') ||
    typeLine.includes('enchantment') ||
    typeLine.includes('planeswalker') ||
    typeLine.includes('battle')
  );
}

function isSorcerySpeedSpellCard(card: any): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (isLandTypeLine(typeLine)) return false;

  return (
    typeLine.includes('creature') ||
    typeLine.includes('sorcery') ||
    typeLine.includes('artifact') ||
    typeLine.includes('enchantment') ||
    typeLine.includes('planeswalker') ||
    typeLine.includes('battle')
  );
}

function normalizeRuleText(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function singularizeQualifierWord(value: string): string {
  const normalized = normalizeRuleText(value).trim();
  if (normalized.endsWith('ies') && normalized.length > 3) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (normalized.endsWith('s') && !normalized.endsWith('ss') && normalized.length > 3) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function getNormalizedTypeLine(card: any): string {
  return normalizeRuleText(card?.type_line || card?.typeLine);
}

function graveyardPermissionCardIds(permission: GraveyardCastingPermission): Set<string> {
  const ids = Array.isArray(permission?.cardFilter?.cardIds)
    ? permission.cardFilter.cardIds
    : [];
  return new Set(ids.map((cardId) => String(cardId || '').trim()).filter(Boolean));
}

function firstClassGraveyardPermissionUseAvailable(
  state: any,
  playerId: PlayerID,
  permission: GraveyardCastingPermission,
  card: any,
): boolean {
  const limitType = String(permission?.usageLimit?.type || '').trim().toLowerCase();
  if (!limitType) return true;

  if (limitType === 'once' || limitType === 'once_per_turn') {
    if (permission.permission === 'play') {
      return !Boolean((state as any)?.playedLandFromGraveyardThisTurn?.[playerId]);
    }
    return !Boolean((state as any)?.castFromGraveyardThisTurn?.[playerId]);
  }

  if (limitType === 'one_per_permanent_type') {
    const usedPermanentTypes = getGraveyardPermanentTypesUsedThisTurn(state, playerId);
    if (permission.permission === 'play') {
      return !usedPermanentTypes.has('land');
    }

    const cardTypes = getPermanentSpellTypes(card);
    if (cardTypes.length === 0) return false;
    return cardTypes.every((typeWord) => !usedPermanentTypes.has(typeWord));
  }

  return true;
}

function findMatchingFirstClassGraveyardPermission(
  state: any,
  playerId: PlayerID,
  card: any,
  permissionKind: 'play' | 'cast',
  usedPermanentTypes: Set<string> = new Set<string>(),
): GraveyardCastingPermission | undefined {
  if (!state || !card || typeof card === 'string') return undefined;

  const cardId = String(card?.id || '').trim();
  for (const permission of getActiveGraveyardCastingPermissions(state, playerId, { permission: permissionKind })) {
    if (!firstClassGraveyardPermissionUseAvailable(state, playerId, permission, card)) continue;

    const cardIds = graveyardPermissionCardIds(permission);
    if (cardId && cardIds.has(cardId)) {
      return permission;
    }
    if (cardIds.size > 0) {
      continue;
    }

    const qualifier = String(permission?.cardFilter?.qualifier || '').trim();
    if (!qualifier) continue;

    if (permissionKind === 'play') {
      if (landQualifierMatchesCard(card, qualifier)) {
        return permission;
      }
      continue;
    }

    if (spellQualifierMatchesCard(card, qualifier, usedPermanentTypes)) {
      return permission;
    }
  }

  return undefined;
}

function firstClassPermissionExilesSpell(permission: GraveyardCastingPermission | undefined): boolean {
  return permission?.replacement?.exileAfterResolution === true;
}

function firstClassPermissionLeaveBattlefieldDestination(permission: GraveyardCastingPermission | undefined): 'exile' | undefined {
  return permission?.replacement?.leaveBattlefieldDestination === 'exile' ? 'exile' : undefined;
}

function firstClassPermissionLeaveBattlefieldLifeGain(permission: GraveyardCastingPermission | undefined): number | undefined {
  const amount = Number(permission?.replacement?.leaveBattlefieldLifeGain || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function getGraveyardPermissionCostModeFromText(text: unknown): GraveyardCastingPermissionCostMode {
  const normalized = normalizeRuleText(text).replace(/\s+/g, ' ').trim();
  return /\bwithout paying (?:its|their|that spell's) mana cost\b/.test(normalized)
    ? 'without_paying_mana_cost'
    : 'normal';
}

function buildSyntheticGraveyardPermissionMetadata(
  playerId: PlayerID,
  permission: 'play' | 'cast',
  options: {
    sourceId?: string;
    sourceName?: string;
    qualifier?: string;
    cardId?: string;
    costMode?: GraveyardCastingPermissionCostMode;
    replacement?: { exileAfterResolution?: boolean; leaveBattlefieldDestination?: 'exile'; leaveBattlefieldLifeGain?: number; sourceName?: string };
  },
): {
  graveyardPermissionId: string;
  graveyardPermissionSourceName?: string;
  graveyardPermissionCostMode: GraveyardCastingPermissionCostMode;
} {
  const sourceId = String(options.sourceId || options.cardId || options.sourceName || 'graveyard_source').trim();
  const sourceName = String(options.sourceName || '').trim();
  const cardId = String(options.cardId || '').trim();
  const qualifier = String(options.qualifier || '').trim();
  const costMode = options.costMode || 'normal';
  const graveyardPermissionId = buildGraveyardCastingPermissionId({
    playerId: String(playerId || ''),
    permission,
    sourceZone: 'graveyard',
    cardFilter: {
      ...(cardId ? { cardIds: [cardId] } : {}),
      ...(qualifier ? { qualifier } : {}),
    },
    costMode,
    duration: 'static',
    sourceId,
    ...(sourceName ? { sourceName } : {}),
    ...(options.replacement ? { replacement: { ...options.replacement } } : {}),
  });

  return {
    graveyardPermissionId,
    ...(sourceName ? { graveyardPermissionSourceName: sourceName } : {}),
    graveyardPermissionCostMode: costMode,
  };
}

function hasMarkedGraveyardPermission(state: any, playerId: PlayerID, card: any): boolean {
  const cardId = String(card?.id || '').trim();
  if (!cardId) return false;

  const currentTurn = Number((state as any)?.turnNumber ?? (state as any)?.turn ?? 0) || 0;
  const playableFromGraveyard = (state as any)?.playableFromGraveyard?.[playerId];
  const marker = playableFromGraveyard && typeof playableFromGraveyard === 'object'
    ? playableFromGraveyard[cardId]
    : undefined;
  const stateAllows = typeof marker === 'number'
    ? marker >= currentTurn
    : Boolean(marker);

  const cardAllows = String(card?.canBePlayedBy || '').trim() === String(playerId || '')
    && (
      typeof card?.playableUntilTurn === 'number'
        ? card.playableUntilTurn >= currentTurn
        : Boolean(card?.playableUntilTurn)
    );

  const firstClassSpecificAllows = getActiveGraveyardCastingPermissions(state, playerId).some((permission) =>
    graveyardPermissionCardIds(permission).has(cardId)
    && firstClassGraveyardPermissionUseAvailable(state, playerId, permission, card)
  );

  const temporaryAllows = Array.isArray((state as any)?.temporaryPlayableFromGraveyardPermissions)
    && (state as any).temporaryPlayableFromGraveyardPermissions.some((entry: any) => {
      if (String(entry?.playerId || '') !== String(playerId || '')) return false;

      const expiresAt = String(entry?.expiresAt || '').trim().toLowerCase();
      const turnApplied = Number(entry?.turnApplied ?? currentTurn) || 0;
      if ((expiresAt === 'end_of_turn' || expiresAt === 'this_turn') && turnApplied < currentTurn) {
        return false;
      }

      const qualifier = String(entry?.qualifier || '').trim();
      if (!qualifier) return false;

      const typeLine = getNormalizedTypeLine(card);
      const permission = String(entry?.permission || '').trim().toLowerCase();
      if (permission === 'play' && /\bland\b/.test(typeLine)) {
        return landQualifierMatchesCard(card, qualifier);
      }

      if ((permission === 'cast' || permission === 'play') && !/\bland\b/.test(typeLine)) {
        return spellQualifierMatchesCard(card, qualifier, new Set<string>());
      }

      return false;
    });

  return stateAllows || cardAllows || firstClassSpecificAllows || temporaryAllows;
}

function isPlayersTurnForPermission(state: any, playerId: PlayerID): boolean {
  return String(state?.turnPlayer || state?.activePlayer || '') === String(playerId || '');
}

function getGraveyardPermissionTextSources(state: any, playerId: PlayerID): Array<{ sourceId: string; oracleText: string; typeLine: string; sourceName: string; counters?: any }> {
  return collectStaticEffectSources(state)
    .filter((source) => !source.phasedOut && (source.affectsAllPlayers || source.controller === String(playerId || '')))
    .map((source) => ({
      sourceId: String(source.sourceId || '').trim(),
      oracleText: String(source.oracleText || ''),
      typeLine: normalizeRuleText(source.typeLine || ''),
      sourceName: String(source.sourceName || '').trim(),
      ...(source.counters ? { counters: source.counters } : {}),
    }));
}

function isHistoricCard(card: any): boolean {
  const typeLine = getNormalizedTypeLine(card);
  return /\blegendary\b/.test(typeLine) || /\bartifact\b/.test(typeLine) || /\bsaga\b/.test(typeLine);
}

function typeLineHasWord(card: any, word: string): boolean {
  const normalizedWord = singularizeQualifierWord(word);
  if (!normalizedWord) return false;
  return new RegExp(`\\b${escapeRegExp(normalizedWord)}\\b`, 'i').test(getNormalizedTypeLine(card));
}

function getPermanentSpellTypes(card: any): string[] {
  const typeLine = getNormalizedTypeLine(card);
  return ['artifact', 'creature', 'enchantment', 'planeswalker', 'battle']
    .filter((typeWord) => new RegExp(`\\b${typeWord}\\b`, 'i').test(typeLine));
}

function getGraveyardPermanentTypesCastThisTurn(state: any, playerId: PlayerID): Set<string> {
  const entry = (state as any)?.graveyardPermanentTypesCastThisTurn?.[playerId];
  if (Array.isArray(entry)) {
    return new Set(entry.map((typeWord: unknown) => String(typeWord || '').toLowerCase()).filter(Boolean));
  }

  if (entry && typeof entry === 'object') {
    return new Set(
      Object.entries(entry)
        .filter(([, used]) => Boolean(used))
        .map(([typeWord]) => String(typeWord || '').toLowerCase())
        .filter(Boolean),
    );
  }

  return new Set<string>();
}

function getGraveyardPermanentTypesUsedThisTurn(state: any, playerId: PlayerID): Set<string> {
  const usedTypes = getGraveyardPermanentTypesCastThisTurn(state, playerId);
  if (Boolean((state as any)?.playedLandFromGraveyardThisTurn?.[playerId])) {
    usedTypes.add('land');
  }
  return usedTypes;
}

function isStaticGraveyardPermissionLine(line: string): boolean {
  const normalized = normalizeRuleText(line);
  if (!normalized.includes('graveyard')) return false;
  if (!normalized.includes('you may play') && !normalized.includes('you may cast') && !normalized.includes(' cast ')) return false;
  if (normalized.includes(':')) return false;
  if (/^\s*(when|whenever|at the beginning)\b/.test(normalized)) return false;
  return true;
}

function landQualifierMatchesCard(card: any, qualifier: string): boolean {
  if (!isLandTypeLine(getNormalizedTypeLine(card))) return false;

  const normalized = normalizeRuleText(qualifier)
    .split(/\s+(?:and|or)\s+cast\b/i)[0]
    .trim();

  if (/\bpermanent cards? of each permanent type\b/.test(normalized)) {
    return true;
  }

  if (/\bhistoric\b/.test(normalized) && !isHistoricCard(card)) {
    return false;
  }

  const remainder = normalized
    .replace(/\bhistoric\b/g, ' ')
    .replace(/\bland cards?\b/g, ' ')
    .replace(/\blands?\b/g, ' ')
    .replace(/\b(?:a|an|the|this|that)\b/g, ' ')
    .replace(/[^a-z0-9' -]+/g, ' ')
    .trim();

  if (!remainder) {
    return true;
  }

  return remainder
    .split(/\s+/)
    .map((word) => singularizeQualifierWord(word))
    .filter(Boolean)
    .every((word) => typeLineHasWord(card, word));
}

function spellQualifierMatchesCard(card: any, qualifier: string, usedPermanentTypes: Set<string>): boolean {
  const typeLine = getNormalizedTypeLine(card);
  if (isLandTypeLine(typeLine)) return false;

  let normalized = normalizeRuleText(qualifier).trim();

  if (/\bhistoric\b/.test(normalized) && !isHistoricCard(card)) {
    return false;
  }

  const manaValueLimitMatch = normalized.match(/\bmana value\s+(\d+)\s+or less\b/);
  if (manaValueLimitMatch && cardManaValue(card) > Number(manaValueLimitMatch[1])) {
    return false;
  }

  if (/\bpermanent (?:spell|card) of each permanent type\b/.test(normalized)
    || /\bpermanent (?:spells|cards) of each permanent type\b/.test(normalized)) {
    if (!isPermanentSpellType(typeLine)) return false;
    const cardTypes = getPermanentSpellTypes(card);
    return cardTypes.length > 0 && cardTypes.every((typeWord) => !usedPermanentTypes.has(typeWord));
  }

  if (/\binstant\s+or\s+sorcery\s+spell\b/.test(normalized) || /\binstant\s+or\s+sorcery\s+spells\b/.test(normalized)) {
    if (!(typeLine.includes('instant') || typeLine.includes('sorcery'))) {
      return false;
    }
    normalized = normalized.replace(/\binstant\b/g, ' ').replace(/\bsorcery\b/g, ' ');
  } else {
    const typeRestrictions: Array<{ marker: RegExp; allowed: boolean; strip: RegExp }> = [
      { marker: /\bpermanent\s+spell\b|\bpermanent\s+spells\b/, allowed: isPermanentSpellType(typeLine), strip: /\bpermanent\b/g },
      { marker: /\bcreature\s+spell\b|\bcreature\s+spells\b/, allowed: typeLine.includes('creature'), strip: /\bcreature\b/g },
      { marker: /\bartifact\s+spell\b|\bartifact\s+spells\b/, allowed: typeLine.includes('artifact'), strip: /\bartifact\b/g },
      { marker: /\benchantment\s+spell\b|\benchantment\s+spells\b/, allowed: typeLine.includes('enchantment'), strip: /\benchantment\b/g },
      { marker: /\bplaneswalker\s+spell\b|\bplaneswalker\s+spells\b/, allowed: typeLine.includes('planeswalker'), strip: /\bplaneswalker\b/g },
      { marker: /\bbattle\s+spell\b|\bbattle\s+spells\b/, allowed: typeLine.includes('battle'), strip: /\bbattle\b/g },
      { marker: /\binstant\s+spell\b|\binstant\s+spells\b/, allowed: typeLine.includes('instant'), strip: /\binstant\b/g },
      { marker: /\bsorcery\s+spell\b|\bsorcery\s+spells\b/, allowed: typeLine.includes('sorcery'), strip: /\bsorcery\b/g },
    ];

    for (const restriction of typeRestrictions) {
      if (!restriction.marker.test(normalized)) continue;
      if (!restriction.allowed) return false;
      normalized = normalized.replace(restriction.strip, ' ');
    }
  }

  const remainder = normalized
    .replace(/\bhistoric\b/g, ' ')
    .replace(/\bmana value\s+\d+\s+or less\b/g, ' ')
    .replace(/\b(?:a|an|the|this|that|spell|spells|card|cards|permanent|permanents|once|during|each|of|your|turn|turns|with|mana|value|or|less)\b/g, ' ')
    .replace(/[^a-z0-9' -]+/g, ' ')
    .trim();

  if (!remainder) {
    return true;
  }

  return remainder
    .split(/\s+/)
    .map((word) => singularizeQualifierWord(word))
    .filter(Boolean)
    .every((word) => typeLineHasWord(card, word));
}

function getSpecificLandFromGraveyardPermission(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
): {
  allowed: boolean;
  leaveBattlefieldReplacementDestination?: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
  graveyardPermissionId?: string;
  graveyardPermissionSourceName?: string;
} {
  try {
    const state = ctx?.state as any;
    if (!state || !card || typeof card === 'string') return { allowed: false };

    const firstClassPermission = findMatchingFirstClassGraveyardPermission(state, playerId, card, 'play');
    const firstClassLeaveBattlefieldDestination = firstClassPermissionLeaveBattlefieldDestination(firstClassPermission);
    const firstClassLeaveBattlefieldLifeGain = firstClassPermissionLeaveBattlefieldLifeGain(firstClassPermission);
    if (firstClassPermission) {
      return {
        allowed: true,
        ...(firstClassLeaveBattlefieldDestination ? { leaveBattlefieldReplacementDestination: firstClassLeaveBattlefieldDestination } : {}),
        ...(firstClassPermission.replacement?.sourceName || firstClassPermission.sourceName
          ? { leaveBattlefieldReplacementSourceName: firstClassPermission.replacement?.sourceName || firstClassPermission.sourceName }
          : {}),
        ...(firstClassLeaveBattlefieldLifeGain ? { leaveBattlefieldReplacementLifeGain: firstClassLeaveBattlefieldLifeGain } : {}),
        graveyardPermissionId: firstClassPermission.id,
        ...(firstClassPermission.sourceName ? { graveyardPermissionSourceName: firstClassPermission.sourceName } : {}),
      };
    }

    const printedSelfPermissionInfo = getPrintedSelfCastPermissionInfo(state, playerId, card, 'graveyard');
    if (printedSelfPermissionInfo.hasIt) {
      return { allowed: true };
    }

    if (hasMarkedGraveyardPermission(state, playerId, card)) {
      return { allowed: true };
    }

    const alreadyPlayedLandFromGraveyard = Boolean((state as any)?.playedLandFromGraveyardThisTurn?.[playerId]);

    for (const source of getGraveyardPermissionTextSources(state, playerId)) {
      const oracleText = source.oracleText;
      const leaveBattlefieldReplacementDestination = sourceLeaveBattlefieldReplacementDestination(oracleText);
      const leaveBattlefieldReplacementLifeGain = sourceLeaveBattlefieldLifeGain(oracleText);
      const lines = oracleText.split(/\r?\n/);
      for (const rawLine of lines) {
        const line = normalizeRuleText(rawLine);
        if (!isStaticGraveyardPermissionLine(line)) continue;
        if (/\bduring your turn\b/.test(line) && !isPlayersTurnForPermission(state, playerId)) continue;

        for (const match of line.matchAll(/you may play ([^.]+?) from your graveyard/gi)) {
          const qualifier = String(match[1] || '').trim();
          if (!qualifier) continue;

          const oncePerTurn = /\bonce during each of your turns\b/.test(line) || /^\s*(?:a|an)\b/i.test(qualifier);
          const eachPermanentTypePermission = /\bpermanent cards? of each permanent type\b/.test(qualifier);
          if (oncePerTurn && alreadyPlayedLandFromGraveyard) continue;
          if (eachPermanentTypePermission && alreadyPlayedLandFromGraveyard) continue;
          if (landQualifierMatchesCard(card, qualifier)) {
            const syntheticPermission = buildSyntheticGraveyardPermissionMetadata(playerId, 'play', {
              sourceId: source.sourceId,
              sourceName: source.sourceName,
              cardId: String(card?.id || '').trim(),
              qualifier,
              ...(leaveBattlefieldReplacementDestination
                ? {
                    replacement: {
                      leaveBattlefieldDestination: leaveBattlefieldReplacementDestination,
                      ...(source.sourceName ? { sourceName: source.sourceName } : {}),
                      ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
                    },
                  }
                : {}),
            });
            return {
              allowed: true,
              ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination } : {}),
              ...(leaveBattlefieldReplacementDestination && source.sourceName
                ? { leaveBattlefieldReplacementSourceName: source.sourceName }
                : {}),
              ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
              graveyardPermissionId: syntheticPermission.graveyardPermissionId,
              ...(syntheticPermission.graveyardPermissionSourceName
                ? { graveyardPermissionSourceName: syntheticPermission.graveyardPermissionSourceName }
                : {}),
            };
          }
        }
      }
    }

    if (
      (Array.isArray(state?.landPlayPermissions?.[playerId]) && state.landPlayPermissions[playerId].includes('graveyard'))
      || playerHasDurableLandPlayPermission(state, playerId, 'graveyard')
    ) {
      return { allowed: true };
    }

    return { allowed: false };
  } catch (err) {
    debugWarn(1, '[getSpecificLandFromGraveyardPermission] Error:', err);
    return { allowed: false };
  }
}

function canPlaySpecificLandFromGraveyard(ctx: GameContext, playerId: PlayerID, card: any): boolean {
  return getSpecificLandFromGraveyardPermission(ctx, playerId, card).allowed;
}

function sourceExilesSpellCastThisWay(oracleText: string): boolean {
  const normalized = normalizeRuleText(oracleText).replace(/\s+/g, ' ').trim();
  return /\bif\s+(?:a|that|this)\s+(?:card|spell)\s+cast\s+this\s+way\s+would\s+be\s+put\s+into\s+your\s+graveyard\s*,?\s*exile\s+it\s+instead\b/.test(normalized);
}

function sourceLeaveBattlefieldReplacementDestination(oracleText: string): 'exile' | undefined {
  const normalized = normalizeRuleText(oracleText)
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\bit\s+gains\b.*\bif\s+this\s+permanent\s+would\s+leave\s+the\s+battlefield,\s*exile\s+it\s+instead\s+of\s+putting\s+it\s+anywhere\s+else\b/.test(normalized)) {
    return 'exile';
  }

  if (/\bit\s+gains\b.*\bwhen\s+this\s+(?:creature\s+dies|permanent\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield),\s*exile\s+it\b/.test(normalized)) {
    return 'exile';
  }

  return undefined;
}

function sourceLeaveBattlefieldLifeGain(oracleText: string): number | undefined {
  const normalized = normalizeRuleText(oracleText)
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = normalized.match(/\bit\s+gains\b.*\bwhen\s+this\s+permanent\s+is\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield,\s*exile\s+it\s+and\s+you\s+gain\s+(\d+)\s+life\b/);
  if (!match) {
    return undefined;
  }

  const amount = Number.parseInt(match[1], 10);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function getSourceGrantedAdditionalCost(oracleText: string): SharedSourceGrantedAdditionalCost | undefined {
  const normalized = normalizeRuleText(oracleText).replace(/\s+/g, ' ').trim();
  const removeCountersMatch = normalized.match(/\bby\s+removing\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(.+?)\s+from\s+among\s+(.+?)\s+you\s+control\s+in\s+addition\s+to\s+paying\s+(?:its|their|that spell's)\s+other\s+costs\b/i);
  if (removeCountersMatch) {
    const amount = parseWordNumberForGraveyardCost(String(removeCountersMatch[1] || ''));
    if (amount <= 0) return undefined;

    const rawCounterPhrase = String(removeCountersMatch[2] || '')
      .replace(/\bcounters?\b/gi, ' ')
      .replace(/\b(?:a|an)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const rawFilter = String(removeCountersMatch[3] || '')
      .replace(/\bpermanents?\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const filter = rawFilter ? rawFilter.replace(/\b([a-z]+)s\b/g, '$1').trim() : 'creature';

    return {
      type: 'remove_counters',
      amount,
      filter: filter || 'creature',
      distributed: true,
      ...(rawCounterPhrase ? { counterType: rawCounterPhrase } : {}),
    };
  }

  const match = normalized.match(/\bby\s+(discarding|sacrificing)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(.+?)\s+in\s+addition\s+to\s+paying\s+(?:its|their|that spell's)\s+other\s+costs\b/i);
  if (!match) return undefined;

  const action = String(match[1] || '').trim().toLowerCase();
  const amount = parseWordNumberForGraveyardCost(String(match[2] || ''));
  if (amount <= 0) return undefined;

  const rawFilter = String(match[3] || '')
    .replace(/\bcards?\b/gi, ' ')
    .replace(/\bpermanents?\b/gi, ' ')
    .replace(/\bspells?\b/gi, ' ')
    .replace(/\b(?:a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const filter = rawFilter ? rawFilter.replace(/\b([a-z]+)s\b/g, '$1').trim() : undefined;

  if (action === 'discarding') {
    return {
      type: 'discard',
      amount,
      ...(filter ? { filter } : {}),
    };
  }

  if (action === 'sacrificing') {
    return {
      type: 'sacrifice',
      amount,
      ...(filter ? { filter } : {}),
    };
  }

  return undefined;
}

function canPaySourceGrantedAdditionalCost(state: any, playerId: PlayerID, card: any, cost: SharedSourceGrantedAdditionalCost): boolean {
  const amount = Math.max(0, Number(cost?.amount || 0));
  if (amount <= 0) return true;

  const alreadyPaid = (card as any)?.additionalCostPaid === true;
  const paidMethod = String((card as any)?.additionalCostMethod || '').trim().toLowerCase();
  if (alreadyPaid && (!paidMethod || paidMethod === String(cost.type || '').toLowerCase())) {
    return true;
  }

  if (cost.type === 'discard') {
    const hand = Array.isArray(state?.zones?.[playerId]?.hand) ? state.zones[playerId].hand : [];
    const eligible = cost.filter
      ? hand.filter((entry: any) => String(entry?.type_line || entry?.typeLine || '').toLowerCase().includes(String(cost.filter).toLowerCase()))
      : hand;
    return eligible.length >= amount;
  }

  if (cost.type === 'sacrifice') {
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const eligible = battlefield.filter((permanent: any) => {
      if (!permanent || String(permanent.controller || '') !== String(playerId || '')) return false;
      if (!cost.filter) return true;
      return String(permanent?.card?.type_line || '').toLowerCase().includes(String(cost.filter).toLowerCase());
    });
    return eligible.length >= amount;
  }

  if (cost.type === 'remove_counters') {
    return canPayCounterRemovalCost(state, String(playerId), {
      amount,
      filter: cost.filter || 'creature',
      counterType: cost.counterType,
      distributed: cost.distributed,
    });
  }

  return true;
}

function getSpecificSpellFromGraveyardPermission(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
): {
  allowed: boolean;
  exileAfterResolution?: boolean;
  leaveBattlefieldReplacementDestination?: 'exile';
  leaveBattlefieldReplacementSourceName?: string;
  leaveBattlefieldReplacementLifeGain?: number;
  sourceGrantedAdditionalCost?: SharedSourceGrantedAdditionalCost;
  graveyardPermissionId?: string;
  graveyardPermissionSourceName?: string;
  graveyardPermissionCostMode?: GraveyardCastingPermissionCostMode;
} {
  try {
    const state = ctx?.state as any;
    if (!state || !card || typeof card === 'string') return { allowed: false };

    const alreadyCastFromGraveyard = Boolean((state as any)?.castFromGraveyardThisTurn?.[playerId]);
    const usedPermanentTypes = getGraveyardPermanentTypesCastThisTurn(state, playerId);
    const firstClassPermission = findMatchingFirstClassGraveyardPermission(state, playerId, card, 'cast', usedPermanentTypes);
    const firstClassLeaveBattlefieldDestination = firstClassPermissionLeaveBattlefieldDestination(firstClassPermission);
    const firstClassLeaveBattlefieldLifeGain = firstClassPermissionLeaveBattlefieldLifeGain(firstClassPermission);
    if (firstClassPermission) {
      return {
        allowed: true,
        ...(firstClassPermissionExilesSpell(firstClassPermission) ? { exileAfterResolution: true } : {}),
        ...(firstClassLeaveBattlefieldDestination ? { leaveBattlefieldReplacementDestination: firstClassLeaveBattlefieldDestination } : {}),
        ...(firstClassPermission.replacement?.sourceName || firstClassPermission.sourceName
          ? { leaveBattlefieldReplacementSourceName: firstClassPermission.replacement?.sourceName || firstClassPermission.sourceName }
          : {}),
        ...(firstClassLeaveBattlefieldLifeGain ? { leaveBattlefieldReplacementLifeGain: firstClassLeaveBattlefieldLifeGain } : {}),
        graveyardPermissionId: firstClassPermission.id,
        ...(firstClassPermission.sourceName ? { graveyardPermissionSourceName: firstClassPermission.sourceName } : {}),
        graveyardPermissionCostMode: firstClassPermission.costMode || 'normal',
      };
    }

    if (hasMarkedGraveyardPermission(state, playerId, card)) {
      return { allowed: true };
    }

    const printedSelfCastInfo = getPrintedSelfCastPermissionInfo(state, playerId, card, 'graveyard');
    if (printedSelfCastInfo.hasIt) {
      const sourceGrantedAdditionalCost = getSourceGrantedAdditionalCost(String(card?.oracle_text || card?.oracleText || ''));
      if (sourceGrantedAdditionalCost && !canPaySourceGrantedAdditionalCost(state, playerId, card, sourceGrantedAdditionalCost)) {
        return { allowed: false };
      }
      const printedCostMode = getGraveyardPermissionCostModeFromText(String(card?.oracle_text || card?.oracleText || ''));
      return {
        allowed: true,
        ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
        ...buildSyntheticGraveyardPermissionMetadata(playerId, 'cast', {
          sourceId: String(card?.id || '').trim(),
          sourceName: String(card?.name || '').trim(),
          cardId: String(card?.id || '').trim(),
          qualifier: 'this card',
          costMode: printedCostMode,
        }),
      };
    }

    for (const source of getGraveyardPermissionTextSources(state, playerId)) {
      const permanentTypeLine = source.typeLine;
      const oracleText = source.oracleText;
      const exileAfterResolution = sourceExilesSpellCastThisWay(oracleText);
      const leaveBattlefieldReplacementDestination = sourceLeaveBattlefieldReplacementDestination(oracleText);
      const leaveBattlefieldReplacementLifeGain = sourceLeaveBattlefieldLifeGain(oracleText);
      const lines = oracleText.split(/\r?\n/);

      for (const rawLine of lines) {
        const line = normalizeRuleText(rawLine);
        const sourceGrantedAdditionalCost = getSourceGrantedAdditionalCost(line) || getSourceGrantedAdditionalCost(oracleText);
        const sourceCostMode = getGraveyardPermissionCostModeFromText(line || oracleText);
        if (!isStaticGraveyardPermissionLine(line)) continue;
        if (/\bduring your turn\b/.test(line) && !isPlayersTurnForPermission(state, playerId)) continue;

        const combinedPlayCastMatch = line.match(/you may play ([^.]+?) and cast ([^.]+?) from your graveyard/i);
        if (combinedPlayCastMatch) {
          const qualifier = String(combinedPlayCastMatch[2] || '').trim();
          const oncePerTurn = /\bonce during each of your turns\b/.test(line);
          if (!(oncePerTurn && alreadyCastFromGraveyard) && qualifier && spellQualifierMatchesCard(card, qualifier, usedPermanentTypes)) {
            if (sourceGrantedAdditionalCost && !canPaySourceGrantedAdditionalCost(state, playerId, card, sourceGrantedAdditionalCost)) {
              continue;
            }
            return {
              allowed: true,
              ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
              ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination } : {}),
              ...(leaveBattlefieldReplacementDestination && source.sourceName ? { leaveBattlefieldReplacementSourceName: source.sourceName } : {}),
              ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
              ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
              ...buildSyntheticGraveyardPermissionMetadata(playerId, 'cast', {
                sourceId: source.sourceId,
                sourceName: source.sourceName,
                qualifier,
                costMode: sourceCostMode,
                replacement: {
                  ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
                  ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldDestination: leaveBattlefieldReplacementDestination } : {}),
                  ...((leaveBattlefieldReplacementDestination && source.sourceName) ? { sourceName: source.sourceName } : {}),
                  ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
                },
              }),
            };
          }
        }

        if (permanentTypeLine.includes('spacecraft') && line.includes('permanent spell') && line.includes('from your graveyard')) {
          const creatureMatch = line.match(/it's an? (?:artifact )?creature at (\d+)\+/i);
          if (creatureMatch) {
            const threshold = Number.parseInt(creatureMatch[1], 10);
            const chargeCounters = Number(source.counters?.charge || 0);
            if (!Number.isFinite(threshold) || chargeCounters < threshold) {
              continue;
            }
          }
        }

        for (const match of line.matchAll(/\b(?:cast|play) ([^.]+?) from your graveyard/gi)) {
          const qualifier = String(match[1] || '').trim();
          if (!qualifier) continue;

          const oncePerTurn = /\bonce during each of your turns\b/.test(line);
          if (oncePerTurn && alreadyCastFromGraveyard) continue;
          if (spellQualifierMatchesCard(card, qualifier, usedPermanentTypes)) {
            if (sourceGrantedAdditionalCost && !canPaySourceGrantedAdditionalCost(state, playerId, card, sourceGrantedAdditionalCost)) {
              continue;
            }
            return {
              allowed: true,
              ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
              ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination } : {}),
              ...(leaveBattlefieldReplacementDestination && source.sourceName ? { leaveBattlefieldReplacementSourceName: source.sourceName } : {}),
              ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
              ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
              ...buildSyntheticGraveyardPermissionMetadata(playerId, 'cast', {
                sourceId: source.sourceId,
                sourceName: source.sourceName,
                qualifier,
                costMode: sourceCostMode,
                replacement: {
                  ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
                  ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldDestination: leaveBattlefieldReplacementDestination } : {}),
                  ...((leaveBattlefieldReplacementDestination && source.sourceName) ? { sourceName: source.sourceName } : {}),
                  ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldLifeGain: leaveBattlefieldReplacementLifeGain } : {}),
                },
              }),
            };
          }
        }
      }
    }

    return { allowed: false };
  } catch (err) {
    debugWarn(1, '[canCastSpecificSpellFromGraveyard] Error:', err);
    return { allowed: false };
  }
}

function canCastSpecificSpellFromGraveyard(ctx: GameContext, playerId: PlayerID, card: any): boolean {
  return getSpecificSpellFromGraveyardPermission(ctx, playerId, card).allowed;
}

function spellMatchesCandidateMode(card: any, mode: SharedSpellCandidateMode, grantsFlash: boolean): boolean {
  if (mode === 'main') {
    return true;
  }

  const isResponseSpeed = hasFlashOrInstant(card) || grantsFlash;
  if (mode === 'response') {
    return isResponseSpeed;
  }

  return !isResponseSpeed && isSorcerySpeedSpellCard(card);
}

function canUseAlternateCostForSpellCandidate(sourceZone: SharedSpellSourceZone, castMethod: SharedSpellCastMethod): boolean {
  if (sourceZone === 'hand' || sourceZone === 'library') {
    return true;
  }

  if (sourceZone === 'exile') {
    return castMethod !== 'foretell';
  }

  return false;
}

type GraveyardCastKeyword = 'flashback' | 'jump-start' | 'retrace' | 'escape' | 'harmonize';

function getPrintedGraveyardCastKeywordInfo(card: any, keyword: GraveyardCastKeyword): { hasIt: boolean; cost?: string; additionalExileCount?: number } {
  const oracleText = String(card?.oracle_text || card?.oracleText || '');
  const manaCost = String(card?.mana_cost || card?.manaCost || '').trim();

  if (keyword === 'flashback') {
    if (!/\bflashback\b/i.test(oracleText)) return { hasIt: false };
    const flashbackCost = oracleText.match(/flashback\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i)?.[1]?.trim();
    return { hasIt: true, ...(flashbackCost ? { cost: flashbackCost } : {}) };
  }

  if (keyword === 'jump-start') {
    if (!/\bjump-start\b/i.test(oracleText)) return { hasIt: false };
    const explicitJumpStartCost = oracleText.match(/jump-start\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i)?.[1]?.trim();
    return { hasIt: true, cost: explicitJumpStartCost || manaCost || undefined };
  }

  if (keyword === 'retrace') {
    return /\bretrace\b/i.test(oracleText) ? { hasIt: true, cost: manaCost || undefined } : { hasIt: false };
  }

  if (keyword === 'harmonize') {
    const harmonizeMatch = oracleText.match(/harmonize\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (!harmonizeMatch && !/\bharmonize\b/i.test(oracleText)) return { hasIt: false };
    return {
      hasIt: true,
      ...(harmonizeMatch?.[1] ? { cost: harmonizeMatch[1].trim() } : {}),
    };
  }

  const escapeMatch = oracleText.match(/escape\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (!escapeMatch && !/\bescape\b/i.test(oracleText)) return { hasIt: false };

  const exileMatch = oracleText.match(/exile\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+other\s+cards?\s+from\s+your\s+graveyard/i);
  const additionalExileCount = exileMatch?.[1] ? parseWordNumberForGraveyardCost(exileMatch[1]) : undefined;
  return {
    hasIt: true,
    ...(escapeMatch?.[1] ? { cost: escapeMatch[1].trim() } : {}),
    ...(additionalExileCount && additionalExileCount > 0 ? { additionalExileCount } : {}),
  };
}

function parseWordNumberForGraveyardCost(value: string): number {
  const normalized = String(value || '').trim().toLowerCase();
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  if (words[normalized]) return words[normalized];
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAvailableGraveyardCastKeywordInfo(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
): { keyword: GraveyardCastKeyword; cost?: string; additionalExileCount?: number } | undefined {
  for (const keyword of ['flashback', 'jump-start', 'retrace', 'escape', 'harmonize'] as GraveyardCastKeyword[]) {
    const printedInfo = getPrintedGraveyardCastKeywordInfo(card, keyword);
    if (printedInfo.hasIt) {
      return { keyword, cost: printedInfo.cost, additionalExileCount: printedInfo.additionalExileCount };
    }

    const grantedInfo = getGrantedCastFromGraveyardKeywordInfo(ctx, playerId, card, keyword);
    if (grantedInfo.hasIt) {
      return { keyword, cost: grantedInfo.cost, additionalExileCount: grantedInfo.additionalExileCount };
    }
  }

  return undefined;
}

function canPayGraveyardCastKeywordAdditionalCost(state: any, playerId: PlayerID, card: any, keywordInfo: { keyword: GraveyardCastKeyword; additionalExileCount?: number }): boolean {
  const zones = state?.zones?.[playerId];
  if (!zones) return false;

  if (keywordInfo.keyword === 'jump-start') {
    return Array.isArray(zones.hand) && zones.hand.length > 0;
  }

  if (keywordInfo.keyword === 'retrace') {
    return Array.isArray(zones.hand) && zones.hand.some((entry: any) => /\bland\b/i.test(String(entry?.type_line || entry?.typeLine || '')));
  }

  if (keywordInfo.keyword === 'escape') {
    const requiredExileCount = Number(keywordInfo.additionalExileCount || 0);
    if (requiredExileCount <= 0) return true;
    return Array.isArray(zones.graveyard)
      && zones.graveyard.filter((entry: any) => entry && String(entry.id || '') !== String(card?.id || '')).length >= requiredExileCount;
  }

  if (keywordInfo.keyword === 'harmonize') {
    return true;
  }

  return true;
}

export function getCastableSpellCandidates(
  ctx: GameContext,
  playerId: PlayerID,
  options?: {
    mode?: SharedSpellCandidateMode;
    skipIgnoredCards?: boolean;
    allowAlternateCosts?: boolean;
    allowUnknownCostFallback?: boolean;
  },
): SharedSpellCastCandidate[] {
  try {
    const { state } = ctx;
    if (!state) return [];

    if (isSplitSecondLockActive(state)) {
      return [];
    }

    const zones = state.zones?.[playerId];
    if (!zones) return [];

    const mode = options?.mode || 'main';
    const skipIgnoredCards = options?.skipIgnoredCards === true;
    const allowAlternateCosts = options?.allowAlternateCosts !== false;
    const allowUnknownCostFallback = options?.allowUnknownCostFallback !== false;
    const ignoredCards = (state as any).ignoredCardsForAutoPass?.[playerId] || {};
    const stateAny = state as any;
    const currentTurn = Number(stateAny?.turnNumber ?? 0);
    const exilePermissions = stateAny?.playableFromExile?.[playerId];
    const candidates: SharedSpellCastCandidate[] = [];

    const considerSourceCard = (card: any, sourceZone: SharedSpellSourceZone) => {
      if (!card || typeof card === 'string') return;

      const sourceCardId = String(card?.id || card?.name || '');
      const manaPaymentOptions = sourceZone === 'hand' && sourceCardId
        ? { excludedHandCardIds: [sourceCardId] }
        : undefined;
      if (skipIgnoredCards && sourceCardId && ignoredCards[sourceCardId]) {
        debug(2, `[getCastableSpellCandidates] Skipping ignored ${sourceZone} card: ${card.name || sourceCardId}`);
        return;
      }

      for (const castCard of getHandCastEvaluationCards(card)) {
        if (isSpellCastingProhibitedByChosenName(state, playerId, castCard.name || '').prohibited) {
          continue;
        }

        const typeLine = String(castCard?.type_line || '').toLowerCase();
        if (isLandTypeLine(typeLine)) {
          continue;
        }

        let castMethod: SharedSpellCastMethod = 'normal';
        let manaCost = String(castCard?.mana_cost || castCard?.manaCost || '');
        let grantsFlash = false;
        let unknownCostFallback = false;
        let exileAfterResolution = false;
        let leaveBattlefieldReplacementDestination: 'exile' | undefined;
        let leaveBattlefieldReplacementSourceName: string | undefined;
        let leaveBattlefieldReplacementLifeGain: number | undefined;
        let sourceGrantedAdditionalCost: SharedSourceGrantedAdditionalCost | undefined;
        let graveyardPermissionId: string | undefined;
        let graveyardPermissionSourceName: string | undefined;
        let graveyardPermissionCostMode: GraveyardCastingPermissionCostMode | undefined;
        let libraryPermissionCostMode: string | undefined;
        let spendManaAsThoughAnyType = false;

        if (sourceZone === 'library') {
          const topSpellPermission = getTopLibrarySpellPermission(ctx, playerId, castCard);
          if (!topSpellPermission.canCast) {
            continue;
          }
          grantsFlash = topSpellPermission.grantsFlash === true;
          libraryPermissionCostMode = String((topSpellPermission as any).costMode || '').trim() || undefined;
          spendManaAsThoughAnyType = (topSpellPermission as any).spendManaAsThoughAnyType === true;
          if (libraryPermissionCostMode === 'without_paying_mana_cost') {
            manaCost = '';
          }
        } else if (sourceZone === 'graveyard') {
          const graveyardKeywordInfo = getAvailableGraveyardCastKeywordInfo(ctx, playerId, castCard);
          if (graveyardKeywordInfo) {
            if (!canPayGraveyardCastKeywordAdditionalCost(state, playerId, card, graveyardKeywordInfo)) {
              continue;
            }
            castMethod = graveyardKeywordInfo.keyword;
            exileAfterResolution = ['flashback', 'jump-start', 'escape', 'harmonize'].includes(graveyardKeywordInfo.keyword);
            if (graveyardKeywordInfo.cost) {
              manaCost = graveyardKeywordInfo.cost;
            } else {
              unknownCostFallback = true;
            }
          } else {
            const specificPermission = getSpecificSpellFromGraveyardPermission(ctx, playerId, castCard);
            if (!specificPermission.allowed) {
              continue;
            }
            castMethod = 'graveyard_permanent';
            exileAfterResolution = specificPermission.exileAfterResolution === true;
            leaveBattlefieldReplacementDestination = specificPermission.leaveBattlefieldReplacementDestination;
            leaveBattlefieldReplacementSourceName = specificPermission.leaveBattlefieldReplacementSourceName;
            leaveBattlefieldReplacementLifeGain = specificPermission.leaveBattlefieldReplacementLifeGain;
            sourceGrantedAdditionalCost = specificPermission.sourceGrantedAdditionalCost;
            graveyardPermissionId = specificPermission.graveyardPermissionId;
            graveyardPermissionSourceName = specificPermission.graveyardPermissionSourceName;
            graveyardPermissionCostMode = specificPermission.graveyardPermissionCostMode;
            if (graveyardPermissionCostMode === 'without_paying_mana_cost') {
              manaCost = '';
            }
          }
        } else if (sourceZone === 'exile') {
          const exileInfo = hasForetellOrCanCastFromExile(card);
          const exileCardId = String(card?.id || castCard?.id || castCard?.name || '');
          const playableFromExile = isCardPlayableFromExile(exilePermissions, exileCardId, currentTurn);
          const cardAllows = cardAllowsPlayerToPlayFromExile(card, playerId, currentTurn);
          const durablePermission = getPlayableFromExileDurablePermissionForCard(state, playerId, card, 'cast');
          const durablePermissionAllows = Boolean(durablePermission);
          const durableCostMode = String(durablePermission?.costMode || '').trim();
          const castWithoutPayingManaCost = (card as any)?.castWithoutPayingManaCost === true
            || durableCostMode === 'without_paying_mana_cost';
          spendManaAsThoughAnyType = (card as any)?.spendManaAsThoughAnyType === true
            || (durablePermission?.metadata as any)?.spendManaAsThoughAnyType === true;

          if (exileInfo.hasIt) {
            if (exileInfo.cost && !castWithoutPayingManaCost) {
              castMethod = 'foretell';
              manaCost = exileInfo.cost;
            } else {
              castMethod = playableFromExile || durablePermissionAllows ? 'playable_from_exile' : 'normal';
              manaCost = castWithoutPayingManaCost ? '' : String(castCard?.mana_cost || castCard?.manaCost || '');
            }
          } else if (playableFromExile || cardAllows || durablePermissionAllows) {
            castMethod = 'playable_from_exile';
            if (castWithoutPayingManaCost) {
              manaCost = '';
            }
          } else {
            continue;
          }
        }

        if (!spellMatchesCandidateMode(castCard, mode, grantsFlash)) {
          continue;
        }

        if (!hasValidTargetsForSpell(state, playerId, castCard)) {
          continue;
        }

        if (unknownCostFallback) {
          if (!allowUnknownCostFallback) {
            continue;
          }

          candidates.push({
            card,
            castCard,
            sourceZone,
            castMethod,
            payability: 'assumed',
            grantsFlash,
            ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
            ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination } : {}),
            ...(leaveBattlefieldReplacementSourceName ? { leaveBattlefieldReplacementSourceName } : {}),
            ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain } : {}),
            ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
            ...(graveyardPermissionId ? { graveyardPermissionId } : {}),
            ...(graveyardPermissionSourceName ? { graveyardPermissionSourceName } : {}),
            ...(graveyardPermissionCostMode ? { graveyardPermissionCostMode } : {}),
            ...(libraryPermissionCostMode ? { libraryPermissionCostMode } : {}),
          });
          continue;
        }

        const parsedCost = parseManaCost(manaCost);
        const costAdjustmentPlan = buildCostAdjustmentPlan(state, playerId, castCard);
        const adjustedCost = applyCostAdjustmentToParsedCost(parsedCost, costAdjustmentPlan);
        const payableCost = spendManaAsThoughAnyType
          ? normalizeParsedCostForAnyTypeManaSpending(adjustedCost)
          : adjustedCost;

        if (canPayManaCostWithAvailableSources(state, playerId, payableCost, Infinity, manaPaymentOptions)) {
          candidates.push({
            card,
            castCard,
            sourceZone,
            castMethod,
            payability: 'normal',
            manaCost,
            cost: adjustedCost,
            grantsFlash,
            ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
            ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination } : {}),
            ...(leaveBattlefieldReplacementSourceName ? { leaveBattlefieldReplacementSourceName } : {}),
            ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain } : {}),
            ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
            ...(graveyardPermissionId ? { graveyardPermissionId } : {}),
            ...(graveyardPermissionSourceName ? { graveyardPermissionSourceName } : {}),
            ...(graveyardPermissionCostMode ? { graveyardPermissionCostMode } : {}),
            ...(libraryPermissionCostMode ? { libraryPermissionCostMode } : {}),
          });
          continue;
        }

        if (
          allowAlternateCosts &&
          canUseAlternateCostForSpellCandidate(sourceZone, castMethod) &&
          hasPayableAlternateCost(ctx, playerId, castCard, manaPaymentOptions?.excludedHandCardIds)
        ) {
          candidates.push({
            card,
            castCard,
            sourceZone,
            castMethod,
            payability: 'alternate',
            manaCost,
            grantsFlash,
            ...(libraryPermissionCostMode ? { libraryPermissionCostMode } : {}),
          });
        }
      }
    };

    if (Array.isArray(zones.hand)) {
      for (const card of zones.hand as any[]) {
        considerSourceCard(card, 'hand');
      }
    }

    if (Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        considerSourceCard(card, 'graveyard');
      }
    }

    for (const card of getPlayableExileCardsForPlayer(state, playerId)) {
      considerSourceCard(card, 'exile');
    }

    const topCard = getTopLibraryCard(ctx, playerId);
    if (topCard && typeof topCard !== 'string') {
      considerSourceCard(topCard, 'library');
    }

    return candidates;
  } catch (err) {
    debugWarn(1, '[getCastableSpellCandidates] Error:', err);
    return [];
  }
}

function getTopLibraryCard(ctx: GameContext, playerId: PlayerID): any | null {
  const libraries = (ctx as any).libraries;
  if (!libraries || typeof libraries.get !== 'function') {
    return null;
  }

  const library = libraries.get(playerId);
  if (!Array.isArray(library) || library.length === 0) {
    return null;
  }

  return library[0] ?? null;
}

function hasGenericTopLibraryLandPermission(ctx: GameContext, playerId: PlayerID, card?: any): boolean {
  return canPlayLandsFromTop(ctx, playerId, card).canPlay;
}

function getTopLibrarySpellPermission(ctx: GameContext, playerId: PlayerID, card: any) {
  return canCastFromTop(ctx, playerId, card);
}

function canPlayTopLibraryLand(ctx: GameContext, playerId: PlayerID, card: any): boolean {
  if (!card || typeof card === 'string') return false;
  if (!isLandTypeLine(card?.type_line || card?.typeLine)) return false;

  const topLandPermission = canPlayLandsFromTop(ctx, playerId, card);
  return topLandPermission.canPlay || hasGenericTopLibraryLandPermission(ctx, playerId, card);
}

function canCastTopLibrarySpell(ctx: GameContext, playerId: PlayerID, card: any): boolean {
  if (!card || typeof card === 'string') return false;

  return getTopLibrarySpellPermission(ctx, playerId, card).canCast;
}

/**
 * Check if a card has flash or is an instant
 */
export function hasFlashOrInstant(card: any): boolean {
  if (!card) return false;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check if it's an instant
  if (typeLine.includes("instant")) {
    return true;
  }
  
  // Check if it has flash keyword
  if (oracleText.includes("flash")) {
    return true;
  }
  
  return false;
}

/**
 * Check if a card has flashback ability
 * Flashback allows casting from graveyard for an alternate cost
 */
export function hasFlashback(card: any): { hasIt: boolean; cost?: string } {
  if (!card) return { hasIt: false };
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for flashback keyword
  if (!oracleText.includes("flashback")) {
    return { hasIt: false };
  }
  
  // Try to extract the flashback cost
  // Pattern: "Flashback {cost}" or "Flashback—{cost}"
  const flashbackMatch = oracleText.match(/flashback[—\s]+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (flashbackMatch) {
    return { hasIt: true, cost: flashbackMatch[1] };
  }
  
  // If we find "flashback" but can't parse cost, log warning and assume it exists
  debugWarn(2, `[hasFlashback] Found flashback on ${card.name} but could not parse cost from: "${oracleText}"`);
  return { hasIt: true };
}

/**
 * Check if a card has foretell ability or can be cast from exile
 * Foretell allows casting from exile for an alternate cost after being foretold
 */
export function hasForetellOrCanCastFromExile(card: any): { hasIt: boolean; cost?: string } {
  if (!card) return { hasIt: false };
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for foretell keyword
  if (oracleText.includes("foretell")) {
    // Try to extract foretell cost
    // Pattern: "Foretell {cost}"
    const foretellMatch = oracleText.match(/foretell\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (foretellMatch) {
      return { hasIt: true, cost: foretellMatch[1] };
    }
    debugWarn(2, `[hasForetellOrCanCastFromExile] Found foretell on ${card.name} but could not parse cost from: "${oracleText}"`);
    return { hasIt: true };
  }
  
  // Check for "you may cast this card from exile" or similar patterns
  if (oracleText.includes("you may cast") && oracleText.includes("from exile")) {
    return { hasIt: true };
  }
  
  // Check for "you may play" from exile
  if (oracleText.includes("you may play") && oracleText.includes("from exile")) {
    return { hasIt: true };
  }
  
  return { hasIt: false };
}

/**
 * Conservative check for unparseable alternative cost.
 * When we can't parse the cost, we assume the player might be able to pay it.
 * This prevents auto-passing when we're unsure, which is safer than auto-passing incorrectly.
 * 
 * @returns Always returns true (assumes player can pay)
 */
function assumeCanPayUnknownCost(cardName: string, mechanicName: string): boolean {
  debugWarn(2, `[assumeCanPayUnknownCost] Could not parse ${mechanicName} cost for ${cardName} - being conservative, assuming player can pay`);
  return true;
}

/**
 * Check if a card is marked as playable from exile.
 * Handles both legacy array format and object entries that may store
 * boolean flags or numeric "playable until turn" expirations.
 */
export function isCardPlayableFromExile(playableCards: any, cardId: string, currentTurn: number): boolean {
  if (!playableCards) return false;
  
  // Handle array format: ['card1', 'card2']
  if (Array.isArray(playableCards)) {
    return playableCards.includes(cardId);
  }
  
  const entry = playableCards[cardId];
  return typeof entry === 'number' ? entry >= currentTurn : Boolean(entry);
}

/**
 * Check if a spell has valid targets available on the battlefield.
 * This prevents spells requiring targets from being considered "playable" when no valid targets exist.
 * 
 * MTG Rule 601.2c: A spell or ability cannot be cast/activated unless valid targets are available
 * for all required targets.
 * 
 * @param state - Game state
 * @param playerId - The player casting the spell
 * @param card - The card being checked
 * @returns true if spell has valid targets (or doesn't require targets), false otherwise
 */
// Target checks are centralized in server/rules-engine/target-availability.ts

/**
export function getCostAdjustmentForCard(state: any, playerId: PlayerID, card: any): number {
  return getSharedCostAdjustmentForCard(state, playerId, card);
}

/**
 * Detailed cost adjustment info for UI display
 */
export interface CostAdjustmentInfo {
  originalCost: string;
  adjustedCost: string;
  adjustment: number;       // positive = increase, negative = reduction
  genericAdjustment: number;
  sources: Array<{ name: string; amount: number }>;
}

/**
 * Get detailed cost adjustment info for a card including source names
 * This is used for UI display to show what's affecting the cost
 */
export function getCostAdjustmentInfo(state: any, playerId: string, card: any): CostAdjustmentInfo | null {
  if (!card) return null;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const manaCostRaw = card.mana_cost || "";
  
  // Skip lands - they don't have mana costs
  if (typeLine.includes("land")) return null;
  const adjustmentPlan = buildCostAdjustmentPlan(state, playerId, card);
  
  // Only return info if there's an adjustment
  if (adjustmentPlan.sources.length === 0) return null;
  
  // Calculate adjusted mana cost string
  const parsed = parseManaCost(manaCostRaw);
  const adjusted = applyCostAdjustmentToParsedCost(parsed, adjustmentPlan);
  
  // Reconstruct adjusted cost string
  let adjustedCostParts: string[] = [];
  // Only add generic mana component if:
  // 1. The original cost had generic mana (parsed.generic > 0), OR
  // 2. There's an adjustment that would add generic mana (adjusted > 0)
  if (adjusted.generic > 0 || parsed.generic > 0) {
    adjustedCostParts.push(`{${adjusted.generic}}`);
  }
  // Add color requirements
  for (const [color, count] of Object.entries(adjusted.colors)) {
    for (let i = 0; i < (count as number); i++) {
      adjustedCostParts.push(`{${color}}`);
    }
  }
  if (parsed.hasX) {
    adjustedCostParts.unshift('{X}');
  }
  const adjustedCost = adjustedCostParts.join('');
  
  return {
    originalCost: manaCostRaw,
    adjustedCost: adjustedCost || manaCostRaw,
    adjustment: adjustmentPlan.totalAdjustment,
    genericAdjustment: adjustmentPlan.genericAdjustment,
    sources: adjustmentPlan.sources,
  };
}

/**
 * Check if player can cast any instant or flash spell from hand, graveyard (flashback), 
 * or exile (foretell/impulse draw)
 */
export function canCastAnySpell(ctx: GameContext, playerId: PlayerID): boolean {
  return getCastableSpellCandidates(ctx, playerId, {
    mode: 'response',
    skipIgnoredCards: true,
    allowAlternateCosts: true,
    allowUnknownCostFallback: true,
  }).length > 0;
}

/**
 * Check if an ability is a mana ability (doesn't use the stack, doesn't require priority)
 * Per MTG Rule 605.1a: A mana ability is an activated ability that:
 * - Could add mana to a player's mana pool when it resolves
 * - Isn't a loyalty ability
 * - Doesn't target
 * 
 * Mana abilities can be activated at any time without priority, so they should NOT
 * prevent auto-passing priority.
 */
function isManaAbility(oracleText: string, effectPart: string): boolean {
  if (!effectPart) return false;
  
  const effectLower = effectPart.toLowerCase();
  
  // Check if it adds mana to a player's mana pool
  // Patterns: "Add {G}", "Add {C}{C}", "Add one mana of any color", etc.
  const addsMana = /add\s+(?:\{[wubrgc]\}|\{[^}]+\}\{[^}]+\}|one mana|mana|[x\d]+\s+mana)/i.test(effectLower);
  
  if (!addsMana) return false;
  
  // Check if it targets (mana abilities can't target per Rule 605.1a)
  const hasTarget = /target/i.test(effectPart);
  if (hasTarget) return false;
  
  // Check if it's a loyalty ability (planeswalker abilities use +/- counters)
  // Loyalty abilities are not mana abilities even if they add mana
  const isLoyaltyAbility = /[+-]\d+:/i.test(oracleText);
  if (isLoyaltyAbility) return false;
  
  return true;
}

/**
 * Check if an ability has "Activate only during your turn" restriction
 * Examples: Humble Defector, Sundial of the Infinite
 * @returns true if the ability has this restriction
 */
function hasActivateOnlyDuringYourTurnRestriction(oracleText: string): boolean {
  return /activate (?:this ability )?only during your turn/i.test(oracleText);
}

function hasStationActivationWindow(ctx: GameContext, playerId: PlayerID, permanent: any): boolean {
  if (!permanent?.card) return false;

  const state = ctx.state as any;
  const oracleText = String(permanent.card.oracle_text || '');
  const typeLine = String(permanent.card.type_line || '').toLowerCase();
  const keywords = Array.isArray(permanent.card.keywords) ? permanent.card.keywords : [];
  const hasStationKeyword = keywords.some((keyword: any) => String(keyword || '').toLowerCase() === 'station');
  const hasStationText = /station\s*\(/i.test(oracleText) || oracleText.toLowerCase().includes('station (');

  if (!hasStationKeyword && !hasStationText && !typeLine.includes('spacecraft') && !typeLine.includes('planet')) {
    return false;
  }

  const isTurnPlayer = String(state?.turnPlayer || state?.activePlayer || '') === String(playerId);
  const stackEmpty = !Array.isArray(state?.stack) || state.stack.length === 0;
  const phase = String(state?.phase || '').toUpperCase();
  const inMainPhase = isInMainPhase(ctx) || phase.includes('MAIN');

  if (!isTurnPlayer || !stackEmpty || !inMainPhase) {
    return false;
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((candidate: any) => {
    if (!candidate || String(candidate.id || '') === String(permanent.id || '')) return false;
    if (String(candidate.controller || '') !== String(playerId)) return false;
    return candidate.tapped !== true;
  });
}

function hasActivatableLoyaltyAbility(
  state: any,
  battlefield: any[],
  playerId: PlayerID,
  permanent: any,
): boolean {
  if (!permanent?.card) return false;
  if (String(permanent.controller || '') !== String(playerId)) return false;

  const typeLine = String(permanent.card.type_line || '').toLowerCase();
  if (!typeLine.includes('planeswalker')) return false;

  const activationsThisTurn = (permanent as any).loyaltyActivationsThisTurn || 0;
  let maxActivations = 1;

  for (const otherPerm of battlefield) {
    if (String(otherPerm?.controller || '') !== String(playerId)) continue;

    const otherName = String(otherPerm?.card?.name || '').toLowerCase();
    const otherOracle = String(otherPerm?.card?.oracle_text || '').toLowerCase();

    if (
      otherName.includes('chain veil') ||
      (otherOracle.includes('activate') &&
        otherOracle.includes('loyalty abilities') &&
        otherOracle.includes('additional'))
    ) {
      maxActivations = 2;
      break;
    }
  }

  if (activationsThisTurn >= maxActivations) return false;

  const loyaltyString = (permanent.card as any)?.loyalty;
  const currentLoyalty =
    (permanent as any).loyaltyCounters ??
    (permanent as any).loyalty ??
    (loyaltyString ? parseInt(String(loyaltyString), 10) : 0);
  const oracleText = String(permanent.card.oracle_text || '');

  // Scryfall loyalty abilities use +N:, -N:, or 0: prefixes without brackets.
  const loyaltyPattern = /^([+−–—-]?)(\d+|X):\s*/gim;
  let match;

  while ((match = loyaltyPattern.exec(oracleText)) !== null) {
    const rawSign = match[1];
    const sign = rawSign.replace(/[−–—]/g, '-');
    const cost = match[2];

    if (sign === '+' || sign === '' || cost === '0') {
      return true;
    }

    if (sign === '-') {
      const numericCost = cost === 'X' ? 0 : parseInt(cost, 10);
      if (currentLoyalty >= numericCost) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a permanent has an activated ability that can be activated
 * and requires priority (excludes mana abilities per Rule 605)
 */
function hasActivatableAbility(
  ctx: GameContext,
  playerId: PlayerID,
  permanent: any,
): boolean {
  if (!permanent || !permanent.card) return false;
  
  const { state } = ctx;
  const controller = permanent.controller;
  if (controller !== playerId) return false;
  
  const oracleText = permanent.card.oracle_text || "";
  const typeLine = (permanent.card.type_line || "").toLowerCase();

  // Chosen-name activation restrictions (e.g., Pithing Needle / Phyrexian Revoker)
  // This function only considers abilities that require priority, so treating the activation as non-mana is fine.
  if (isAbilityActivationProhibitedByChosenName(state, playerId, permanent.card?.name || '', false).prohibited) {
    return false;
  }

  if (hasStationActivationWindow(ctx, playerId, permanent)) {
    return true;
  }
  
  // Check for tap abilities: "{T}: Effect" or "{Cost}, {T}: Effect" or "{T}, Cost: Effect"
  // Common patterns: 
  // - "{T}: Add {G}" (simple tap)
  // - "{T}, Sacrifice ~: Effect" (tap + additional cost after, like fetchlands)
  // - "{2}{R}, {T}: This creature fights..." (mana + tap, like Brash Taunter)
  // Pattern allows for optional comma and text between {T} and colon
  // Using [^:]* to match any costs between {T} and : (e.g., ", Pay 1 life, Sacrifice ~")
  // This is safe because ability patterns always end with a colon before the effect
  const hasTapAbility = /\{T\}(?:\s*,?\s*[^:]*)?:/i.test(oracleText);
  
  if (hasTapAbility) {
    // Can only activate if not tapped
    if (permanent.tapped) return false;
    
    // Rule 302.6 / 702.10: Check summoning sickness for creatures with tap abilities
    // A creature can't use tap/untap abilities unless it has been continuously controlled
    // since the turn began OR it has haste (from any source).
    // Lands and non-creature permanents are NOT affected by summoning sickness.
    const isCreature = /\bcreature\b/.test(typeLine);
    const isLand = typeLine.includes("land");
    
    if (isCreature && !isLand) {
      // Check if creature has summoning sickness
      if ((permanent as any).summoningSickness) {
        // Check if creature has haste from any source
        const battlefield = state.battlefield || [];
        const hasHaste = creatureHasHaste(permanent, battlefield, playerId);
        
        if (!hasHaste) {
          return false; // Has summoning sickness and no haste - can't activate
        }
      }
    }
    
    // Match tap abilities with various cost patterns:
    // Pattern 1: "{T}, <additional>: <effect>" - tap first, then additional costs
    // Pattern 2: "<costs>, {T}: <effect>" - costs before tap (e.g., {2}{R}, {T})
    // Pattern 3: "{T}: <effect>" - simple tap only
    const abilityMatch = oracleText.match(/(?:(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*,\s*)?\{T\}(?:\s*,\s*([^:]+))?:\s*(.+)/i);
    if (!abilityMatch) {
      // Couldn't parse the tap ability pattern - be conservative and return false
      // This prevents false positives in auto-pass system
      return false;
    }
    
    const costsBeforeTap = abilityMatch[1] || ""; // Mana costs before {T}
    const additionalCostAfterTap = abilityMatch[2] || ""; // Other costs after {T}
    const effect = abilityMatch[3] || "";
    const fullAbilityText = `${[String(costsBeforeTap || '').trim(), '{T}', String(additionalCostAfterTap || '').trim()].filter(Boolean).join(', ')}: ${String(effect || '').trim()}`;

    if (!isActivatedAbilityConditionMet(ctx, playerId, fullAbilityText, oracleText, abilityMatch.index)) {
      return false;
    }
    
    // CRITICAL: Skip mana abilities - they don't use the stack and don't require priority
    // Per MTG Rule 605.3a, mana abilities can be activated whenever needed for payment
    if (isManaAbility(oracleText, effect)) {
      return false; // Mana abilities don't prevent auto-pass
    }
    
    // Check for "Activate only during your turn" restriction (e.g., Humble Defector)
    const isTurnPlayer = (state as any).turnPlayer === playerId;
    if (hasActivateOnlyDuringYourTurnRestriction(oracleText) && !isTurnPlayer) {
      return false; // Can only be activated during player's turn
    }
    
    // Check for mana costs BEFORE tap symbol (e.g., "{2}{R}, {T}:")
    if (costsBeforeTap) {
      const manaCostMatch = costsBeforeTap.match(/\{[^}]+\}/g);
      if (manaCostMatch) {
        const costString = manaCostMatch.join("");
        const parsedCost = parseManaCost(costString);
        if (!canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          return false; // Can't pay mana cost
        }
      }
    }
    
    // Check for mana costs AFTER tap symbol (e.g., "{T}, {2}:")
    if (additionalCostAfterTap) {
      const manaCostMatch = additionalCostAfterTap.match(/\{[^}]+\}/g);
      if (manaCostMatch) {
        const costString = manaCostMatch.join("");
        const parsedCost = parseManaCost(costString);
        if (!canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
          return false; // Can't pay mana cost
        }
      }
      
      // Check for sacrifice costs - only return true if we can verify player has something to sacrifice
      if (additionalCostAfterTap.toLowerCase().includes("sacrifice")) {
        // Parse what needs to be sacrificed
        const sacrificeMatch = additionalCostAfterTap.match(/sacrifice\s+(?:a|an|this)\s*(\w+)?/i);
        if (sacrificeMatch) {
          const sacrificeType = sacrificeMatch[1] ? sacrificeMatch[1].toLowerCase() : "";
          // Check if player has appropriate permanents to sacrifice
          const battlefield = state.battlefield || [];
          const hasSacrificeable = battlefield.some((perm: any) => {
            if (perm.controller !== playerId) return false;
            if (perm.id === permanent.id && additionalCostAfterTap.toLowerCase().includes("sacrifice this")) {
              return true; // Can sacrifice itself
            }
            if (!sacrificeType) return true; // Generic sacrifice
            const permTypeLine = (perm.card?.type_line || '').toLowerCase();
            return permTypeLine.includes(sacrificeType);
          });
          if (!hasSacrificeable) {
            return false; // Can't pay sacrifice cost
          }
        }
      }
      
      // Check for life payment costs
      if (additionalCostAfterTap.toLowerCase().includes("pay") && additionalCostAfterTap.toLowerCase().includes("life")) {
        const lifeMatch = additionalCostAfterTap.match(/pay (\d+) life/i);
        if (lifeMatch) {
          const lifeCost = parseInt(lifeMatch[1], 10);
          const currentLife = state.life?.[playerId] ?? 40;
          if (currentLife < lifeCost) {
            return false; // Can't pay life cost
          }
        }
      }
    }
    
    return true;
  }
  
  // Check for other activated abilities: "{Cost}: Effect"
  // Pattern: Mana symbols or other costs followed by colon
  const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*:\s*(.+)/gi;
  const matches = [...oracleText.matchAll(activatedAbilityPattern)];
  
  for (const match of matches) {
    const costPart = match[1];
    const effectPart = match[2];
    const fullAbilityText = `${String(costPart || '').trim()}: ${String(effectPart || '').trim()}`;
    
    // Skip if this is just a mana ability we already checked
    if (costPart.includes("{T}") && hasTapAbility) continue;

    if (!isActivatedAbilityConditionMet(ctx, playerId, fullAbilityText, oracleText, match.index)) {
      continue;
    }
    
    // Skip mana abilities - they don't require priority
    if (isManaAbility(oracleText, effectPart)) {
      continue;
    }
    
    // Skip sorcery-speed abilities (Equip, Reconfigure, etc.)
    // These can only be activated during main phase when stack is empty
    const effectLower = effectPart.toLowerCase();
    
    // Equip is sorcery-speed by default (Rule 702.6a)
    // Only a few exceptions exist (Cranial Plating, Lightning Greaves in some contexts)
    // For safety, we'll consider ALL equip abilities as sorcery-speed unless explicitly stated otherwise
    if (effectLower.includes("equip") || effectLower.includes("reconfigure")) {
      continue; // Skip all equip/reconfigure abilities
    }
    
    // Skip other sorcery-speed only abilities
    // Pattern: "Activate only as a sorcery" or "Activate only any time you could cast a sorcery"
    if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText)) {
      continue; // Skip sorcery-speed ability
    }
    
    // Skip "Activate only during your turn" abilities if it's not our turn
    // Pattern: "Activate only during your turn" (e.g., Humble Defector)
    if (hasActivateOnlyDuringYourTurnRestriction(oracleText) && !((state as any).turnPlayer === playerId)) {
      continue; // Skip - can only be activated during player's turn
    }
    
    // Parse the cost
    const parsedCost = parseManaCost(costPart);
    
    // Check if we can pay it
    if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a card in graveyard has an activated ability that can be activated
 * Examples: Magma Phoenix, Squee, Goblin Nabob, etc.
 * 
 * IMPORTANT: This should ONLY be called for cards actually in the graveyard.
 * When a card is on the battlefield, its graveyard-only abilities should not be activatable.
 */
function hasGraveyardActivatedAbility(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
): boolean {
  if (!card || typeof card === "string") return false;

  const { state } = ctx;
  const printedUnearthInfo = getPrintedUnearthInfo(card);
  const grantedUnearthInfo = printedUnearthInfo.hasIt ? { hasIt: false } : getGrantedUnearthInfo(ctx, playerId, card);
  if (printedUnearthInfo.hasIt || grantedUnearthInfo.hasIt) {
    const currentStep = String((state as any)?.step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !state.stack || state.stack.length === 0;
    const isTurnPlayer = String((state as any)?.turnPlayer || '') === String(playerId || '');
    if (!isMainPhase || !stackIsEmpty || !isTurnPlayer) {
      return false;
    }

    const unearthCost = String(printedUnearthInfo.cost || grantedUnearthInfo.cost || '').trim();
    if (!unearthCost) {
      return true;
    }

    const parsedCost = parseManaCost(unearthCost);
    return canPayManaCostWithAvailableSources(state, playerId, parsedCost);
  }

  const grantedEmbalmInfo = getGrantedEmbalmInfo(ctx, playerId, card);
  if (grantedEmbalmInfo.hasIt) {
    const currentStep = String((state as any)?.step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !state.stack || state.stack.length === 0;
    const isTurnPlayer = String((state as any)?.turnPlayer || '') === String(playerId || '');
    if (!isMainPhase || !stackIsEmpty || !isTurnPlayer) {
      return false;
    }

    const embalmCost = String(grantedEmbalmInfo.cost || '').trim();
    if (!embalmCost) {
      return true;
    }

    const parsedCost = parseManaCost(embalmCost);
    return canPayManaCostWithAvailableSources(state, playerId, parsedCost);
  }
  
  const oracleText = card.oracle_text || "";
  const cardName = card.name || "this card";
  
  // Check for activated abilities that can be used from graveyard
  // Pattern: "{Cost}: [Effect]. Activate only from your graveyard"
  // OR: "{Cost}: [Effect] from your graveyard"
  // Examples:
  // - "{3}{R}{R}: Return Magma Phoenix from your graveyard to your hand."
  // - "{1}{R}: Return Squee, Goblin Nabob from your graveyard to your hand."
  
  // Look for cost patterns followed by effects that mention graveyard
  const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:\s*(.+?)(?:\.|$)/gi;
  const matches = [...oracleText.matchAll(activatedAbilityPattern)];
  
  for (const match of matches) {
    const costPart = match[1];
    const effectPart = match[2];
    
    // Check if the effect mentions "from your graveyard" or "from a graveyard"
    if (!effectPart.toLowerCase().includes("graveyard")) {
      continue;
    }
    
    // Check if it's explicitly restricted to "only from your graveyard" or similar
    // or if the effect naturally works from graveyard (returns card from graveyard, etc.)
    const isGraveyardAbility = 
      /from (?:your |a )?graveyard/i.test(effectPart) ||
      /activate (?:this ability |only )?(?:only )?from (?:your |a )?graveyard/i.test(oracleText);
    
    if (!isGraveyardAbility) {
      continue;
    }
    
    // Parse the cost
    const parsedCost = parseManaCost(costPart);
    
    // Check if we can pay it
    if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if player can activate any abilities
 */
export function canActivateAnyAbility(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;

    // Split Second: players can't activate non-mana abilities while a split-second spell is on the stack.
    // (Mana abilities are excluded from this function already.)
    if (isSplitSecondLockActive(state)) return false;
    
    const battlefield = state.battlefield || [];
    const loyaltyAtInstantSpeed = canActivateLoyaltyAtInstantSpeed(state, playerId);
    
    // Get mana pool (floating + potential from untapped sources)
    const pool = getAvailableMana(state, playerId);
    
    // Get ignored cards for this player (for auto-pass)
    const ignoredCards = (state as any).ignoredCardsForAutoPass?.[playerId] || {};
    
    // Check each permanent on battlefield
    for (const permanent of battlefield) {
      // Skip ignored permanents - they shouldn't trigger auto-pass prompts
      if (ignoredCards[permanent.id]) {
        debug(2, `[canActivateAnyAbility] Skipping ignored card: ${permanent.card?.name || permanent.id}`);
        continue;
      }

      if (loyaltyAtInstantSpeed && hasActivatableLoyaltyAbility(state, battlefield, playerId, permanent)) {
        return true;
      }
      
      if (hasActivatableAbility(ctx, playerId, permanent)) {
        return true;
      }
    }
    
    // Check graveyard for cards with activated abilities that can be used from there
    // IMPORTANT: Only check cards that are ACTUALLY in the graveyard, not on battlefield
    const zones = state.zones?.[playerId];
    if (zones && Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        // Skip ignored cards in graveyard
        if (ignoredCards[card.id]) {
          debug(2, `[canActivateAnyAbility] Skipping ignored graveyard card: ${card.name || card.id}`);
          continue;
        }
        
        // Skip this card if it's also on the battlefield (shouldn't happen, but defensive check)
        // This ensures abilities like Magma Phoenix's graveyard ability are ONLY activatable from graveyard
        const isOnBattlefield = battlefield.some((perm: any) => 
          perm.card?.id === card.id || perm.card?.name === card.name
        );
        
        if (isOnBattlefield) {
          continue; // Card is on battlefield, don't allow graveyard abilities
        }
        
        if (hasGraveyardActivatedAbility(ctx, playerId, card)) {
          return true;
        }
      }
    }
    
    // Check exile zone for playable cards (foretold, suspended, plotted, etc.)
    if (zones && Array.isArray(zones.exile)) {
      for (const card of zones.exile as any[]) {
        // Skip ignored cards in exile
        if (ignoredCards[card.id]) {
          debug(2, `[canActivateAnyAbility] Skipping ignored exile card: ${card.name || card.id}`);
          continue;
        }
        
        if (hasExileActivatedAbility(ctx, playerId, card, pool)) {
          return true;
        }
      }
    }
    
    // Check hand for special abilities (foretell cost from hand, etc.)
    if (zones && Array.isArray(zones.hand)) {
      for (const card of zones.hand as any[]) {
        // Skip ignored cards in hand
        if (ignoredCards[card.id]) {
          debug(2, `[canActivateAnyAbility] Skipping ignored hand card: ${card.name || card.id}`);
          continue;
        }
        
        // Note: Regular casting from hand is handled in canCastAnySpell
        // This is for special hand abilities like foretelling
        if (hasHandActivatedAbility(ctx, playerId, card, pool)) {
          return true;
        }
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canActivateAnyAbility] Error:", err);
    return false;
  }
}

/**
 * Check if a card in exile has an activated ability that can be used
 */
function hasExileActivatedAbility(ctx: GameContext, playerId: PlayerID, card: any, pool: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Foretell - can be cast from exile for the foretell cost
  if (oracleText.includes('foretell') && card.isForetold) {
    return true;
  }
  
  // Plot - can be cast from exile without paying mana cost
  if (oracleText.includes('plot') && card.isPlotted) {
    return true;
  }
  
  // Suspend - will cast when last time counter is removed
  if (oracleText.includes('suspend') && card.isSuspended) {
    // Check if it's ready to cast (no time counters)
    if (card.timeCounters === 0) {
      return true;
    }
  }
  
  // Adventure - can cast creature from exile after adventure
  if ((card.layout === 'adventure' || oracleText.includes('adventure')) && card.adventureUsed) {
    return true;
  }
  
  // Generic "play from exile" effects
  if (card.canPlayFromExile) {
    return true;
  }
  
  return false;
}

/**
 * Check if a card in hand has a special activated ability (not regular casting)
 */
function hasHandActivatedAbility(ctx: GameContext, playerId: PlayerID, card: any, pool: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Foretell - pay {2} to exile face-down
  if (oracleText.includes('foretell')) {
    // Check if player can pay {2}
    const hasTwoMana = (pool.colorless || 0) + (pool.white || 0) + (pool.blue || 0) + 
                       (pool.black || 0) + (pool.red || 0) + (pool.green || 0) >= 2;
    if (hasTwoMana) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if game is currently in a main phase
 */
function isInMainPhase(ctx: GameContext): boolean {
  try {
    const step = (ctx.state as any).step;
    if (!step) return false;
    
    // Main phases are MAIN_1 (pre-combat) and MAIN_2 (post-combat)
    const stepStr = String(step).toUpperCase();
    return stepStr === 'MAIN_1' || stepStr === 'MAIN_2' || stepStr === 'MAIN' || stepStr.includes('MAIN');
  } catch (err) {
    debugWarn(1, "[isInMainPhase] Error:", err);
    // Default to true to be conservative (don't auto-pass if uncertain)
    return true;
  }
}

function isLandPlayTimingWindowOpen(ctx: GameContext, playerId: PlayerID): boolean {
  const state = ctx?.state as any;
  const turnPlayer = String(state?.turnPlayer || state?.activePlayer || '').trim();
  const hasTurnPlayer = turnPlayer.length > 0;
  const isTurnPlayer = !hasTurnPlayer || turnPlayer === String(playerId || '');
  const stackEmpty = !Array.isArray(state?.stack) || state.stack.length === 0;
  const rawStep = String(state?.step || '').trim();
  const phase = String(state?.phase || '').toUpperCase();
  const hasTimingMarker = rawStep.length > 0 || phase.length > 0;
  const inMainPhase = !hasTimingMarker || isInMainPhase(ctx) || phase.includes('MAIN');

  return isTurnPlayer && stackEmpty && inMainPhase;
}

/**
 * Check if a card is a transform back face (not playable from hand)
 * 
 * Transform back faces have "(Transforms from [Name])" in their oracle text
 * and should only be accessible after the front face transforms.
 * 
 * Examples:
 * - "Barracks of the Thousand" has "(Transforms from Thousand Moons Smithy.)" 
 * - Back faces of werewolves, etc.
 */
export function isTransformBackFace(card: any): boolean {
  if (!card) return false;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for the standard transform pattern: "(Transforms from [Name])"
  // This is the indicator that this is a back face that cannot be played from hand
  return /\(transforms from [^)]+\)/i.test(oracleText);
}

export function getHandCastEvaluationCard(card: any): any {
  const candidates = getHandCastEvaluationCards(card);
  return candidates[0] || card;
}

export function isCardPlayableAsLandFromHand(card: any): boolean {
  if (!card || typeof card === 'string') return false;
  if (isTransformBackFace(card)) return false;

  const layout = String(card?.layout || '').toLowerCase();
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];

  if ((layout === 'transform' || layout === 'double_faced_token') && cardFaces.length >= 1) {
    return /\bland\b/i.test(String(cardFaces[0]?.type_line || ''));
  }

  if (layout === 'modal_dfc' && cardFaces.length >= 1) {
    return cardFaces.some((face: any) => /\bland\b/i.test(String(face?.type_line || '')));
  }

  return /\bland\b/i.test(String(card?.type_line || ''));
}

export function getPlayableLandFaceIndex(card: any): number | undefined {
  const layout = String(card?.layout || '').toLowerCase();
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];

  if (layout !== 'modal_dfc' || cardFaces.length === 0) {
    return undefined;
  }

  const landFaceIndex = cardFaces.findIndex((face: any) => /\bland\b/i.test(String(face?.type_line || '')));
  return landFaceIndex >= 0 ? landFaceIndex : undefined;
}

function hasRemainingLandPlay(ctx: GameContext, playerId: PlayerID): boolean {
  const state = ctx.state as any;
  const landsPlayedThisTurn = state?.landsPlayedThisTurn?.[playerId] ?? 0;
  const maxLandsPerTurn = calculateMaxLandsPerTurn(ctx, playerId);
  return landsPlayedThisTurn < maxLandsPerTurn;
}

function canPlayLandFromGraveyard(ctx: GameContext, playerId: PlayerID): boolean {
  const graveyard = ctx?.state?.zones?.[playerId]?.graveyard;
  return Array.isArray(graveyard)
    ? graveyard.some((card: any) => canPlaySpecificLandFromGraveyard(ctx, playerId, card))
    : false;
}

function isLandPlayableFromExile(state: any, playerId: PlayerID, card: any): boolean {
  const playableCards = (state as any)?.playableFromExile?.[playerId];
  const currentTurn = Number((state as any)?.turnNumber ?? 0);
  const cardId = String(card?.id || card?.name || '');
  return isCardPlayableFromExile(playableCards, cardId, currentTurn)
    || cardAllowsPlayerToPlayFromExile(card, playerId, currentTurn)
    || Boolean(getPlayableFromExileDurablePermissionForCard(state, playerId, card, 'play'));
}

export function getPlayableLandCandidates(
  ctx: GameContext,
  playerId: PlayerID,
  options?: { skipBattlefieldDuplicates?: boolean },
): SharedPlayableLandCandidate[] {
  try {
    const { state } = ctx;
    if (!state) return [];

    const zones = state.zones?.[playerId];
    if (!zones) return [];

    if (!isLandPlayTimingWindowOpen(ctx, playerId)) {
      return [];
    }

    if (!hasRemainingLandPlay(ctx, playerId)) {
      return [];
    }

    const skipBattlefieldDuplicates = options?.skipBattlefieldDuplicates === true;
    const battlefieldCardIds = skipBattlefieldDuplicates
      ? new Set(
          (Array.isArray(state.battlefield) ? state.battlefield : [])
            .filter((permanent: any) => permanent?.controller === playerId)
            .map((permanent: any) => String(permanent?.card?.id || ''))
            .filter((cardId: string) => cardId.length > 0),
        )
      : new Set<string>();
    const candidates: SharedPlayableLandCandidate[] = [];

    const pushCandidate = (
      card: any,
      sourceZone: SharedLandSourceZone,
      options?: {
        graveyardPermissionId?: string;
        graveyardPermissionSourceName?: string;
        leaveBattlefieldReplacementDestination?: 'exile';
        leaveBattlefieldReplacementSourceName?: string;
        leaveBattlefieldReplacementLifeGain?: number;
      },
    ) => {
      if (!card || typeof card === 'string') return;
      if (!isCardPlayableAsLandFromHand(card)) return;

      const cardId = String(card?.id || '');
      if (skipBattlefieldDuplicates && cardId && battlefieldCardIds.has(cardId)) {
        return;
      }

      candidates.push({
        card,
        sourceZone,
        selectedFaceIndex: getPlayableLandFaceIndex(card),
        ...(options?.graveyardPermissionId ? { graveyardPermissionId: options.graveyardPermissionId } : {}),
        ...(options?.graveyardPermissionSourceName ? { graveyardPermissionSourceName: options.graveyardPermissionSourceName } : {}),
        ...(options?.leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination: options.leaveBattlefieldReplacementDestination } : {}),
        ...(options?.leaveBattlefieldReplacementSourceName ? { leaveBattlefieldReplacementSourceName: options.leaveBattlefieldReplacementSourceName } : {}),
        ...(options?.leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain: options.leaveBattlefieldReplacementLifeGain } : {}),
      });
    };

    const topCard = getTopLibraryCard(ctx, playerId);
    if (topCard && canPlayTopLibraryLand(ctx, playerId, topCard)) {
      pushCandidate(topCard, 'library');
    }

    if (Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        const specificPermission = getSpecificLandFromGraveyardPermission(ctx, playerId, card);
        if (!specificPermission.allowed) {
          continue;
        }
        pushCandidate(card, 'graveyard', specificPermission);
      }
    }

    for (const card of getPlayableExileCardsForPlayer(state, playerId)) {
      if (!isLandPlayableFromExile(state, playerId, card)) {
        continue;
      }
      pushCandidate(card, 'exile');
    }

    if (Array.isArray(zones.hand)) {
      for (const card of zones.hand as any[]) {
        pushCandidate(card, 'hand');
      }
    }

    return candidates;
  } catch (err) {
    debugWarn(1, '[getPlayableLandCandidates] Error:', err);
    return [];
  }
}

/**
 * Check if player can play a land
 * This includes:
 * - Having a land in hand (excluding transform back faces)
 * - Having a land in graveyard AND an effect that allows playing from graveyard
 * - Having a land in exile AND an effect that allows playing from exile
 * - Having pending play effects (impulse draw, etc.)
 * - Not having reached the land play limit for this turn
 * 
 * NOTE: Caller should verify game is in main phase with empty stack before calling
 */
export function canPlayLand(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) {
      debug(2, `[canPlayLand] ${playerId}: No state`);
      return false;
    }
    
    const zones = state.zones?.[playerId];
    if (!zones) {
      debug(2, `[canPlayLand] ${playerId}: No zones found`);
      return false;
    }

    if (!isLandPlayTimingWindowOpen(ctx, playerId)) {
      const currentStep = String((state as any)?.step || '').toUpperCase();
      const currentPhase = String((state as any)?.phase || '').toUpperCase();
      const stackSize = Array.isArray((state as any)?.stack) ? (state as any).stack.length : 0;
      const turnPlayer = String((state as any)?.turnPlayer || (state as any)?.activePlayer || '');
      debug(2, `[canPlayLand] ${playerId}: Land timing window closed (step=${currentStep}, phase=${currentPhase}, stack=${stackSize}, turnPlayer=${turnPlayer})`);
      return false;
    }

    if (!hasRemainingLandPlay(ctx, playerId)) {
      const landsPlayedThisTurn = (state.landsPlayedThisTurn as any)?.[playerId] ?? 0;
      const maxLandsPerTurn = calculateMaxLandsPerTurn(ctx, playerId);
      debug(2, `[canPlayLand] ${playerId}: Already played max lands this turn (${landsPlayedThisTurn}/${maxLandsPerTurn})`);
      return false;
    }

    if (!Array.isArray(zones.hand)) {
      debug(2, `[canPlayLand] ${playerId}: zones.hand is not an array:`, typeof zones.hand, zones.hand);
      if (zones.handCount && zones.handCount > 0) {
        debugWarn(1, `[canPlayLand] ${playerId}: WARNING - handCount=${zones.handCount} but zones.hand is not an array! This is a data consistency issue.`);
        return true;
      }
    }

    const candidates = getPlayableLandCandidates(ctx, playerId);
    if (candidates.length > 0) {
      const firstCandidate = candidates[0];
      debug(2, `[canPlayLand] ${playerId}: Found playable land in ${firstCandidate.sourceZone}: ${firstCandidate.card?.name || 'unknown'}`);
      return true;
    }

    debug(2, `[canPlayLand] ${playerId}: No playable land candidates found`);
    return false;
  } catch (err) {
    debugWarn(1, "[canPlayLand] Error:", err);
    return false;
  }
}

/**
 * Check if player has an effect that allows playing cards from a specific zone
 * @param zone - The zone to check (graveyard, exile, etc.)
 */
function hasPlayFromZoneEffect(ctx: GameContext, playerId: PlayerID, zone: string): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    
    for (const permanent of battlefield) {
      // Only check permanents controlled by this player
      if (permanent.controller !== playerId) continue;
      
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      
      // Check for "you may play" or "you may cast" from the specified zone
      const hasPlayText = oracleText.includes("you may play") || oracleText.includes("you may cast");
      const hasZone = oracleText.includes(zone);
      
      if (hasPlayText && hasZone) {
        // For graveyard casting from Station cards, check charge counter threshold
        if (zone === "graveyard" && typeLine.includes("spacecraft")) {
          // Station cards: graveyard casting is threshold-gated
          // Check if the ability mentions "permanent spell" (Station restriction)
          if (oracleText.includes("permanent spell") && oracleText.includes("from your graveyard")) {
            // Parse required threshold - graveyard casting is typically at highest threshold
            // Pattern: "It's an artifact creature at N+." indicates when it becomes a creature
            const creatureMatch = oracleText.match(/it's an? (?:artifact )?creature at (\d+)\+/i);
            if (creatureMatch) {
              const threshold = parseInt(creatureMatch[1], 10);
              const chargeCounters = (permanent as any).counters?.charge || 0;
              
              // Only allow graveyard casting if threshold is met
              if (chargeCounters >= threshold) {
                return true;
              }
              // Threshold not met - continue checking other permanents
              continue;
            }
          }
        }
        
        // Additional check for lands specifically (Crucible of Worlds, etc.)
        if (zone === "graveyard" && oracleText.includes("land")) {
          return true;
        }
        
        // For exile, be more generous as it often comes from impulse draw effects
        if (zone === "exile") {
          return true;
        }
        
        // Generic graveyard casting (not Station-specific)
        if (zone === "graveyard" && !typeLine.includes("spacecraft")) {
          return true;
        }
      }
      
      // Special case: "play cards from exile" or "cast cards from exile"
      if (zone === "exile" && 
          (oracleText.includes("play") || oracleText.includes("cast")) && 
          oracleText.includes("from exile")) {
        return true;
      }
    }
    
    // Check for temporary effects stored in game state
    // Many impulse draw effects store exiled cards with "can play until end of turn" markers
    const stateAny = state as any;
    if (zone === "exile" && stateAny.playableFromExile) {
      const playableCards = stateAny.playableFromExile[playerId];
      const currentTurn = Number(stateAny?.turnNumber ?? 0);
      const hasUsableEntry = Array.isArray(playableCards)
        ? playableCards.length > 0
        : Object.keys(playableCards || {}).some((cardId) =>
            isCardPlayableFromExile(playableCards, cardId, currentTurn)
          );
      if (hasUsableEntry) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasPlayFromZoneEffect] Error:", err);
    return false;
  }
}

/**
 * Check if player has "play from top of library" effect
 * Examples: Experimental Frenzy, Future Sight, Bolas's Citadel
 */
function hasPlayFromTopOfLibraryEffect(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    
    for (const permanent of battlefield) {
      // Only check permanents controlled by this player
      if (permanent.controller !== playerId) continue;
      
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      
      // Check for various patterns of "play from top of library"
      if ((oracleText.includes("you may play") || oracleText.includes("you may cast")) &&
          (oracleText.includes("top") || oracleText.includes("off the top")) &&
          (oracleText.includes("library") || oracleText.includes("your library"))) {
        return true;
      }
      
      // Special case for Experimental Frenzy and similar
      if (oracleText.includes("play") && 
          oracleText.includes("from the top of your library")) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasPlayFromTopOfLibraryEffect] Error:", err);
    return false;
  }
}

/**
 * Determine if a player can respond to something on the stack or during priority.
 * 
 * A player can respond if they can cast an instant/flash spell or activate an ability
 * that uses the stack. This is used for auto-passing non-active players.
 * 
 * NOTE: This function is intentionally STRICT - it only returns true if the player
 * has instant-speed responses available. For the active player during their own turn,
 * use canAct() instead, which is more conservative.
 * 
 * @param ctx Game context
 * @param playerId The player to check
 * @returns true if the player can respond, false otherwise
 */
export function canRespond(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    debug(2, `[canRespond] ${playerId}: checking instant-speed responses only`);

    const currentStep = String((ctx.state as any).step || '').toUpperCase();
    if (currentStep === 'UNTAP') {
      debug(2, `[canRespond] ${playerId}: no player receives priority during untap (returning false)`);
      return false;
    }

    // Split Second: no spells/stack abilities can be responded with.
    if (isSplitSecondLockActive(ctx.state)) {
      debug(2, `[canRespond] ${playerId}: Split Second lock active (returning false)`);
      return false;
    }
    
    // Check if player can cast any instant/flash spells
    if (canCastAnySpell(ctx, playerId)) {
      debug(2, `[canRespond] ${playerId}: Can cast instant/flash spell`);
      return true;
    }
    
    // Check if player can activate any abilities
    if (canActivateAnyAbility(ctx, playerId)) {
      debug(2, `[canRespond] ${playerId}: Can activate ability`);
      return true;
    }
    
    // No instant-speed responses available
    debug(2, `[canRespond] ${playerId}: No instant-speed responses available (returning false)`);
    return false;
  } catch (err) {
    debugWarn(1, "[canRespond] Error:", err);
    // On error, default to true (don't auto-pass) to be safe
    return true;
  }
}

/**
 * Check if player can cast their commander(s) from the command zone
 * Commanders can be cast at any time they could normally cast that type of spell
 * (e.g., instant if it has flash, sorcery-speed otherwise)
 * 
 * @param ctx Game context
 * @param playerId Player to check
 * @returns true if player can afford to cast at least one commander
 */
function canCastCommanderFromCommandZone(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;

    const currentStep = String((state as any).step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !state.stack || state.stack.length === 0;

    for (const candidate of getCastableCommanderCandidates(ctx, playerId)) {
      if (candidate.grantsFlash) {
        debug(2, `[canCastCommanderFromCommandZone] ${playerId}: Commander ${candidate.card?.name} has flash/instant - can cast`);
        return true;
      }

      if (isMainPhase && stackIsEmpty) {
        debug(2, `[canCastCommanderFromCommandZone] ${playerId}: Commander ${candidate.card?.name} can be cast (main phase, empty stack)`);
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canCastCommanderFromCommandZone] Error:", err);
    return false;
  }
}

/**
 * Determine if the active player can take any action during their turn.
 * 
 * This is a MORE CONSERVATIVE check than canRespond - it returns true if the player
 * can take ANY action, including:
 * - Instant/flash spells (checked by canRespond)
 * - Activated abilities (checked by canRespond)
 * - Casting commanders from command zone
 * - Playing lands (if lands played < maxLands AND in main phase with empty stack)
 * - Sorcery-speed spells (if in main phase with empty stack)
 * 
 * This function should be used for the active player (turn player) to decide if they
 * should be auto-passed. The active player should almost NEVER be auto-passed during
 * their main phase if they have any possible actions.
 * 
 * @param ctx Game context
 * @param playerId The player to check (should be the active player)
 * @returns true if the player can take any action, false otherwise
 */

/**
 * Check if a creature is goaded (Rule 701.15)
 * Goaded creatures must attack each combat if able.
 */
function isCreatureGoaded(permanent: any, battlefield: any[], currentTurn?: number): boolean {
  return getCurrentGoaders(permanent, battlefield, currentTurn).length > 0;
}

/**
 * Check if player has any goaded creatures that MUST attack (Rule 701.15b)
 * This is different from hasValidAttackers - goaded creatures MUST attack if able,
 * so the player cannot skip combat declaration when they have goaded creatures.
 * 
 * @param ctx Game context
 * @param playerId The player to check
 * @returns true if the player has any goaded creatures that can attack
 */
function hasGoadedCreaturesThatMustAttack(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    const battlefield = state.battlefield || [];
    const currentTurn = (state as any).turn;
    
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      
      // Check if this creature is goaded
      if (!isCreatureGoaded(permanent, battlefield, currentTurn)) continue;
      
      // Can't attack if tapped
      if (permanent.tapped) continue;
      
      // Can't attack with summoning sickness (unless haste)
      const enteredThisTurn = permanent.enteredThisTurn === true;
      if (enteredThisTurn) {
        const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
        const grantedAbilities = permanent.grantedAbilities || [];
        const hasHaste = oracleText.includes("haste") || 
                        grantedAbilities.some((a: string) => a && a.toLowerCase().includes("haste"));
        
        if (!hasHaste) continue; // Summoning sickness
      }
      
      // Check for "can't attack" effects
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const grantedAbilities = permanent.grantedAbilities || [];
      
      if (oracleText.includes("can't attack") || oracleText.includes("cannot attack")) {
        continue;
      }
      
      const hasCantAttack = grantedAbilities.some((a: string) => {
        const abilityText = (a || "").toLowerCase();
        return abilityText.includes("can't attack") || abilityText.includes("cannot attack");
      });
      
      if (hasCantAttack) continue;
      
      // Found a goaded creature that CAN attack, so it MUST attack
      debug(2, `[hasGoadedCreaturesThatMustAttack] ${playerId}: Found goaded creature that must attack: ${permanent.card?.name || permanent.id}`);
      return true;
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasGoadedCreaturesThatMustAttack] Error:", err);
    return true; // On error, assume they might have goaded creatures (don't auto-pass)
  }
}

/**
 * Check if player has any valid attackers (untapped creatures that can attack)
 * Used to prevent auto-pass from skipping attack phase when creatures are available
 */
function hasValidAttackers(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    const battlefield = state.battlefield || [];
    
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      
      // Can't attack if tapped
      if (permanent.tapped) continue;
      
      // Can't attack with summoning sickness (unless haste)
      // Check if creature entered this turn AND doesn't have haste
      const enteredThisTurn = permanent.enteredThisTurn === true;
      if (enteredThisTurn) {
        // Check for haste in oracle text or granted abilities
        const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
        const grantedAbilities = permanent.grantedAbilities || [];
        const hasHaste = oracleText.includes("haste") || 
                        grantedAbilities.some((a: string) => a && a.toLowerCase().includes("haste"));
        
        if (!hasHaste) continue; // Summoning sickness
      }
      
      // Check for "can't attack" effects (like Pacifism, Trapped in the Tower, etc.)
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const grantedAbilities = permanent.grantedAbilities || [];
      
      // Check permanent's own text
      if (oracleText.includes("can't attack") || oracleText.includes("cannot attack")) {
        continue; // This creature can't attack
      }
      
      // Check granted abilities from other sources
      const hasCantAttack = grantedAbilities.some((a: string) => {
        const abilityText = (a || "").toLowerCase();
        return abilityText.includes("can't attack") || abilityText.includes("cannot attack");
      });
      
      if (hasCantAttack) continue; // Granted ability prevents attacking
      
      // If we have an untapped creature without summoning sickness that can attack, return true
      return true;
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasValidAttackers] Error:", err);
    return true; // On error, assume they might have attackers (don't auto-pass)
  }
}

/**
 * Check if player has any valid blockers (untapped creatures that can block)
 * Used to prevent auto-pass from skipping block phase when creatures are available
 */
function hasValidBlockers(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    const battlefield = state.battlefield || [];
    
    // First check if there are any declared attackers to block
    const declaredAttackers = (state as any).declaredAttackers || [];
    if (declaredAttackers.length === 0) {
      return false; // No attackers to block
    }
    
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      
      // Can't block if tapped
      if (permanent.tapped) continue;

      const unleashPreventsBlocking =
        (permanent as any).unleashed === true &&
        Number((permanent.counters || {})['+1/+1'] || 0) > 0;
      if (unleashPreventsBlocking) continue;
      
      // Check for "can't block" effects (like Goblin Tunneler's ability)
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const grantedAbilities = permanent.grantedAbilities || [];
      
      // Check permanent's own text
      if (oracleText.includes("can't block") || oracleText.includes("cannot block")) {
        continue; // This creature can't block
      }
      
      // Check granted abilities from other sources
      const hasCantBlock = grantedAbilities.some((a: string) => {
        const abilityText = (a || "").toLowerCase();
        return abilityText.includes("can't block") || abilityText.includes("cannot block");
      });
      
      if (hasCantBlock) continue; // Granted ability prevents blocking
      
      // Note: Flying/reach restrictions are complex and would require checking all attackers
      // For Smart Auto-Pass purposes, we're conservative: if any untapped creature exists, 
      // pause to let player decide (they might have flying blockers for flying attackers, etc.)
      // This is safer than auto-passing and missing a valid block
      return true;
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasValidBlockers] Error:", err);
    return true; // On error, assume they might have blockers (don't auto-pass)
  }
}

export function canAct(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const currentStep = String((ctx.state as any).step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !ctx.state.stack || ctx.state.stack.length === 0;
    const isTurnPlayer = (ctx.state as any).turnPlayer === playerId;

    if (currentStep === 'UNTAP') {
      debug(2, `[canAct] ${playerId}: no player receives priority during untap (returning false)`);
      return false;
    }
    
    debug(2, `[canAct] ${playerId}: step=${currentStep}, isMainPhase=${isMainPhase}, stackIsEmpty=${stackIsEmpty}, isTurnPlayer=${isTurnPlayer}`);
    
    // CRITICAL: During main phase with empty stack, the turn player should ALWAYS be allowed
    // to take sorcery-speed actions (play land, cast creatures, etc.) before auto-passing.
    // This prevents the race condition where auto-pass advances the step before the player
    // has a chance to play their land or cast sorcery-speed spells.
    //
    // Per MTG rules: During a main phase, if the stack is empty, the active player receives
    // priority and may play lands, cast spells, or activate abilities before passing.
    if (isMainPhase && stackIsEmpty && isTurnPlayer) {
      // Check if player can play a land FIRST (highest priority action)
      // This ensures we never skip the land play opportunity
      if (canPlayLand(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Turn player in main phase can play land - returning TRUE`);
        return true;
      }
    }
    
    // First check instant-speed responses (same as canRespond)
    if (canCastAnySpell(ctx, playerId)) {
      debug(2, `[canAct] ${playerId}: Can cast instant/flash spell - returning TRUE`);
      return true;
    }
    
    if (canActivateAnyAbility(ctx, playerId)) {
      debug(2, `[canAct] ${playerId}: Can activate ability - returning TRUE`);
      return true;
    }
    
    // Check if player can cast commander from command zone (any time they could cast it)
    if (canCastCommanderFromCommandZone(ctx, playerId)) {
      debug(2, `[canAct] ${playerId}: Can cast commander from command zone - returning TRUE`);
      return true;
    }
    
    // During main phase with empty stack, check sorcery-speed actions
    if (isMainPhase && stackIsEmpty) {
      debug(2, `[canAct] ${playerId}: In main phase with empty stack, checking sorcery-speed actions`);
      
      // Check if player can play a land (Note: This is also checked above for turn player specifically,
      // but we check here too for completeness in case of unusual game states)
      if (canPlayLand(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Can play land - returning TRUE`);
        return true;
      }
      
      // Check if player can cast any sorcery-speed spells
      if (canCastAnySorcerySpeed(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Can cast sorcery-speed spell - returning TRUE`);
        return true;
      }
      
      // Check if player can activate sorcery-speed abilities (equip, reconfigure, etc.)
      if (canActivateSorcerySpeedAbility(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Can activate sorcery-speed ability - returning TRUE`);
        return true;
      }
      
      debug(2, `[canAct] ${playerId}: No sorcery-speed actions available in main phase - returning FALSE`);
    } else {
      debug(1, `[canAct] ${playerId}: Not in main phase with empty stack (phase check failed or stack not empty) - returning FALSE`);
    }
    
    // Check combat phases - if player has valid attackers/blockers, they can act
    // This prevents auto-pass from skipping combat declaration when creatures are available
    
    // GOAD ENFORCEMENT (Rule 701.15b): Goaded creatures MUST attack if able
    // This check ensures that:
    // 1. Players cannot skip combat if they have goaded creatures
    // 2. Auto-pass and smart-pass do not bypass combat with goaded creatures
    // 3. Phase navigator cannot skip to end step if goaded creatures exist
    
    // Check during beginning of combat - if player has goaded creatures, they must proceed to declare attackers
    if ((currentStep === 'BEGIN_COMBAT' || currentStep === 'BEGINNING_OF_COMBAT') && isTurnPlayer && stackIsEmpty) {
      if (hasGoadedCreaturesThatMustAttack(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has goaded creatures that must attack - cannot skip combat - returning TRUE`);
        return true;
      }
    }
    
    if (currentStep === 'DECLARE_ATTACKERS' && isTurnPlayer && stackIsEmpty) {
      // FIRST: Check if player has goaded creatures that MUST attack (Rule 701.15b)
      // Goaded creatures must attack if able - player cannot skip this
      if (hasGoadedCreaturesThatMustAttack(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has goaded creatures that MUST attack - returning TRUE`);
        return true;
      }
      
      // Check if player has any creatures that can attack
      if (hasValidAttackers(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has valid attackers - returning TRUE`);
        return true;
      }
    }
    
    if (currentStep === 'DECLARE_BLOCKERS' && !isTurnPlayer && stackIsEmpty) {
      // Check if player has any creatures that can block
      if (hasValidBlockers(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has valid blockers - returning TRUE`);
        return true;
      }
    }
    
    // No actions available
    debug(2, `[canAct] ${playerId}: No actions available - returning FALSE`);
    return false;
  } catch (err) {
    debugWarn(1, "[canAct] Error:", err);
    // On error, default to true (don't auto-pass) to be safe
    return true;
  }
}

/**
 * Check if player can cast any sorcery-speed spell from hand, graveyard (flashback),
 * or exile (foretell/impulse draw)
 * (creatures, sorceries, artifacts, enchantments, planeswalkers)
 */
function canCastAnySorcerySpeed(ctx: GameContext, playerId: PlayerID): boolean {
  return getCastableSpellCandidates(ctx, playerId, {
    mode: 'sorcery',
    skipIgnoredCards: true,
    allowAlternateCosts: true,
    allowUnknownCostFallback: true,
  }).length > 0;
}

/**
 * Check if player can activate any sorcery-speed abilities (equip, reconfigure, etc.)
 * These can only be activated during main phase when stack is empty
 */
function canActivateSorcerySpeedAbility(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    const pool = getAvailableMana(state, playerId);
    
    // Check each permanent controlled by the player
    for (const permanent of battlefield) {
      if (!permanent || !permanent.card) continue;
      if (permanent.controller !== playerId) continue;
      
      const oracleText = permanent.card.oracle_text || "";
      const effectLower = oracleText.toLowerCase();
      
      // Check for equip ability: "Equip {cost}" or "{cost}: Equip"
      if (effectLower.includes("equip")) {
        // Try pattern 1: "Equip {cost}"
        let equipMatch = oracleText.match(/equip\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        
        // Try pattern 2: "{cost}: Equip"
        if (!equipMatch) {
          equipMatch = oracleText.match(/(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*:\s*equip/i);
        }
        
        if (equipMatch) {
          const costString = equipMatch[1];
          if (costString) {
            const parsedCost = parseManaCost(costString);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              // Also check if there's a valid target (a creature to equip)
              const hasCreatureTarget = battlefield.some((p: any) => 
                p.controller === playerId && 
                (p.card?.type_line || "").toLowerCase().includes("creature")
              );
              if (hasCreatureTarget) {
                return true;
              }
            }
          }
        }
      }
      
      // Check for reconfigure ability: "Reconfigure {cost}"
      if (effectLower.includes("reconfigure")) {
        const reconfigureMatch = oracleText.match(/reconfigure\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        if (reconfigureMatch) {
          const costString = reconfigureMatch[1];
          const parsedCost = parseManaCost(costString);
          if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
            return true;
          }
        }
      }
      
      // Check for other sorcery-speed only abilities
      // First check if this ability has sorcery-speed restriction
      if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText)) {
        // Look for any activated ability pattern before the restriction: "{cost}: Effect"
        const abilityPattern = /(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:\s*([^.]+)/gi;
        const matches = oracleText.matchAll(abilityPattern);
        
        for (const match of matches) {
          const costString = match[1];
          const fullAbilityText = `${String(costString || '').trim()}: ${String(match[2] || '').trim()}`;
          if (!isActivatedAbilityConditionMet(ctx, playerId, fullAbilityText, oracleText, match.index)) {
            continue;
          }
          if (costString) {
            const parsedCost = parseManaCost(costString);
            if (canPayManaCostWithAvailableSources(state, playerId, parsedCost)) {
              return true;
            }
          }
        }
      }
      
      // Check for planeswalker loyalty abilities (sorcery-speed by default).
      if (hasActivatableLoyaltyAbility(state, battlefield, playerId, permanent)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canActivateSorcerySpeedAbility] Error:", err);
    return false;
  }
}

