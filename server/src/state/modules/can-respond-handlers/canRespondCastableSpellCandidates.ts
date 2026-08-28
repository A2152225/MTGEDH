// server/src/state/modules/can-respond-handlers/canRespondCastableSpellCandidates.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: getCastableSpellCandidates plus exclusive GY-keyword and
// candidate-mode helpers (spellMatchesCandidateMode, alternate-cost gate,
// printed/available GY cast keywords).
// Public entry symbols: getCastableSpellCandidates.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import { parseManaCost, normalizeParsedManaCost, canPayManaCostWithAvailableSources } from '../mana-check.js';
import { hasPayableAlternateCost } from '../alternate-costs.js';
import { hasValidTargetsForSpell } from '../../../rules-engine/target-availability.js';
import { getGrantedCastFromGraveyardKeywordInfo, type GraveyardCastingPermissionCostMode } from '../graveyard-permissions.js';
import { applyCostAdjustmentToParsedCost, buildCostAdjustmentPlan } from '../cost-adjustments.js';
import { getEffectiveAdditionalCost } from '../../../socket/game-actions.js';
import { debug, debugWarn } from '../../../utils/debug.js';
import { isSpellCastingProhibitedByChosenName } from '../chosen-name-restrictions.js';
import {
  cardAllowsPlayerToPlayFromExile,
  cardMeetsPlayFromExileConditions,
  getPlayableExileCardsForPlayer,
  getPlayableFromExileDurablePermissionForCard,
  isCardOnAdventureForPlayer,
} from '../playable-from-exile.js';
import { cardMayBeCastWithMayhem, parseMayhemCost } from '../keywordCastMechanics.js';
import { buildFreeCastIntentFields } from '../castIntent.js';
import type {
  SharedSpellSourceZone,
  SharedSpellCandidateMode,
  SharedSpellCastMethod,
  SharedSpellCastCandidate,
  SharedSourceGrantedAdditionalCost,
} from './canRespondTypes.js';
import { isSplitSecondLockActive, isLandTypeLine } from './canRespondSplitSecondLandPredicates.js';
import { getHandCastEvaluationCards, normalizeParsedCostForAnyTypeManaSpending } from './canRespondHandCastEvaluation.js';
import { isSorcerySpeedSpellCard } from './canRespondSpellTypePredicates.js';
import { buildSyntheticGraveyardPermissionMetadata } from './canRespondGraveyardPermissionMatching.js';
import { canPaySourceGrantedAdditionalCost, getSpecificSpellFromGraveyardPermission } from './canRespondGraveyardSpellPermission.js';
import { parseWordNumberForGraveyardCost } from './canRespondParseWordNumber.js';
import {
  getTopLibraryCard,
  getTopLibrarySpellPermission,
  hasFlashOrInstant,
  hasForetellOrCanCastFromExile,
  isCardPlayableFromExile,
} from './canRespondTopLibraryFlashExile.js';
import { getOrComputeCachedSpellCandidates } from './canRespondPriorityCache.js';

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

type GraveyardCastKeyword = 'flashback' | 'jump-start' | 'retrace' | 'escape' | 'harmonize' | 'mayhem';

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

  if (keyword === 'mayhem') {
    const mayhemCost = parseMayhemCost(oracleText);
    return { hasIt: Boolean(mayhemCost), ...(mayhemCost ? { cost: mayhemCost } : {}) };
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



function getAvailableGraveyardCastKeywordInfo(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
): { keyword: GraveyardCastKeyword; cost?: string; additionalExileCount?: number } | undefined {
  for (const keyword of ['flashback', 'jump-start', 'retrace', 'escape', 'harmonize', 'mayhem'] as GraveyardCastKeyword[]) {
    const printedInfo = getPrintedGraveyardCastKeywordInfo(card, keyword);
    if (printedInfo.hasIt) {
      if (keyword === 'mayhem' && !cardMayBeCastWithMayhem((ctx as any).state, playerId, card)) {
        continue;
      }
      return { keyword, cost: printedInfo.cost, additionalExileCount: printedInfo.additionalExileCount };
    }

    if (keyword !== 'mayhem') {
      const grantedInfo = getGrantedCastFromGraveyardKeywordInfo(ctx, playerId, card, keyword);
      if (grantedInfo.hasIt) {
        return { keyword, cost: grantedInfo.cost, additionalExileCount: grantedInfo.additionalExileCount };
      }
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
    conservativeTargets?: boolean;
  },
): SharedSpellCastCandidate[] {
  const mode = options?.mode || 'main';
  const skipIgnoredCards = options?.skipIgnoredCards === true;
  const allowAlternateCosts = options?.allowAlternateCosts !== false;
  const allowUnknownCostFallback = options?.allowUnknownCostFallback !== false;
  const conservativeTargets = options?.conservativeTargets !== false;
  const optionKey = `${mode}|${skipIgnoredCards}|${allowAlternateCosts}|${allowUnknownCostFallback}|${conservativeTargets}`;
  return getOrComputeCachedSpellCandidates(ctx, playerId, optionKey, () =>
    collectCastableSpellCandidates(ctx, playerId, {
      mode,
      skipIgnoredCards,
      allowAlternateCosts,
      allowUnknownCostFallback,
      conservativeTargets,
    }),
  );
}

function collectCastableSpellCandidates(
  ctx: GameContext,
  playerId: PlayerID,
  options: {
    mode: SharedSpellCandidateMode;
    skipIgnoredCards: boolean;
    allowAlternateCosts: boolean;
    allowUnknownCostFallback: boolean;
    conservativeTargets: boolean;
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

    const {
      mode,
      skipIgnoredCards,
      allowAlternateCosts,
      allowUnknownCostFallback,
      conservativeTargets,
    } = options;
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
        let castAsAdventureOnly = false;
        let libraryPermissionCostMode: string | undefined;
        let spendManaAsThoughAnyType = false;
        let freeCastIntent = false;
        let exileCastPermissionId: string | undefined;

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
            freeCastIntent = true;
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
            // Cast-intent identity for printed/granted GY keywords (Mayhem, Flashback, …).
            // Same DurablePermission.id convention as first-class grants; synthetic ids are
            // stable across live cast + reset/replay without a second pipeline.
            const syntheticPermission = buildSyntheticGraveyardPermissionMetadata(playerId, 'cast', {
              sourceId: String(card?.id || '').trim(),
              sourceName: String(card?.name || castCard?.name || '').trim(),
              cardId: String(card?.id || '').trim(),
              qualifier: graveyardKeywordInfo.keyword,
              costMode: 'normal',
              replacement: {
                ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
              },
            });
            graveyardPermissionId = syntheticPermission.graveyardPermissionId;
            graveyardPermissionSourceName = syntheticPermission.graveyardPermissionSourceName;
            graveyardPermissionCostMode = syntheticPermission.graveyardPermissionCostMode;
          } else {
            const specificPermission = getSpecificSpellFromGraveyardPermission(ctx, playerId, castCard);
            if (!specificPermission.allowed) {
              continue;
            }
            // Adventure-only GY permissions (Mosswood): only the Adventure face is legal.
            if (specificPermission.castAsAdventureOnly === true) {
              if (castCard?.castAsAdventure !== true && Number(castCard?.faceIndex) !== 1) {
                continue;
              }
              castMethod = 'graveyard_adventure';
            } else {
              castMethod = 'graveyard_permanent';
            }
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
              freeCastIntent = true;
            }
            castAsAdventureOnly = specificPermission.castAsAdventureOnly === true;
          }
        } else if (sourceZone === 'exile') {
          const onAdventure = isCardOnAdventureForPlayer(card, playerId);
          // On-adventure cards may only cast the permanent/creature face from exile.
          if (onAdventure && (castCard?.castAsAdventure === true || Number(castCard?.faceIndex) === 1)) {
            continue;
          }

          const exileInfo = hasForetellOrCanCastFromExile(card);
          const exileCardId = String(card?.id || castCard?.id || castCard?.name || '');
          const playableFromExile = isCardPlayableFromExile(exilePermissions, exileCardId, currentTurn)
            && cardMeetsPlayFromExileConditions(state, card, playerId);
          const cardAllows = cardAllowsPlayerToPlayFromExile(card, playerId, currentTurn, state);
          const durablePermission = getPlayableFromExileDurablePermissionForCard(state, playerId, card, 'cast');
          const durablePermissionAllows = Boolean(durablePermission);
          const durableCostMode = String(durablePermission?.costMode || '').trim();
          const durableGrantsFlash = durablePermission?.timingOverride?.asThoughFlash === true
            || durablePermission?.timingOverride?.ignoreTiming === true;
          const castWithoutPayingManaCost = (card as any)?.castWithoutPayingManaCost === true
            || durableCostMode === 'without_paying_mana_cost';
          spendManaAsThoughAnyType = (card as any)?.spendManaAsThoughAnyType === true
            || (durablePermission?.metadata as any)?.spendManaAsThoughAnyType === true;
          grantsFlash = durableGrantsFlash;
          exileCastPermissionId = String(durablePermission?.id || '').trim() || undefined;
          if (castWithoutPayingManaCost) {
            freeCastIntent = true;
          }

          if (onAdventure) {
            castMethod = 'adventure_creature';
            manaCost = String(castCard?.mana_cost || castCard?.manaCost || '');
          } else if (exileInfo.hasIt) {
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

        const freeCastFields = freeCastIntent
          ? buildFreeCastIntentFields(undefined, { force: true })
          : {};
        const castPermissionFields = graveyardPermissionId
          ? { castPermissionId: graveyardPermissionId, graveyardPermissionId }
          : exileCastPermissionId
            ? { castPermissionId: exileCastPermissionId }
            : {};

        if (!spellMatchesCandidateMode(castCard, mode, grantsFlash)) {
          continue;
        }

        if (!hasValidTargetsForSpell(state, playerId, castCard, { conservative: conservativeTargets })) {
          continue;
        }

        const addCost = getEffectiveAdditionalCost(castCard, castCard.oracle_text || castCard.oracleText || '');
        if (addCost && !canPaySourceGrantedAdditionalCost(state, playerId, card, addCost as any)) {
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
            ...castPermissionFields,
            ...(graveyardPermissionSourceName ? { graveyardPermissionSourceName } : {}),
            ...(graveyardPermissionCostMode ? { graveyardPermissionCostMode } : {}),
            ...(libraryPermissionCostMode ? { libraryPermissionCostMode } : {}),
            ...freeCastFields,
          });
          continue;
        }

        const parsedCost = parseManaCost(manaCost);
        const costAdjustmentPlan = buildCostAdjustmentPlan(state, playerId, castCard);
        const adjustedCost = normalizeParsedManaCost(
          applyCostAdjustmentToParsedCost(parsedCost, costAdjustmentPlan),
        );
        const payableCost = spendManaAsThoughAnyType
          ? normalizeParsedCostForAnyTypeManaSpending(adjustedCost)
          : adjustedCost;
        const castTypeLine = String(castCard?.type_line || '').toLowerCase();
        const restrictedSpendPurpose = {
          isCreature: castTypeLine.includes('creature'),
          isArtifact: castTypeLine.includes('artifact'),
          isInstantOrSorcery: castTypeLine.includes('instant') || castTypeLine.includes('sorcery'),
          isLegendary: castTypeLine.includes('legendary'),
          spellCard: castCard,
        };

        if (canPayManaCostWithAvailableSources(state, playerId, payableCost, Infinity, {
          ...manaPaymentOptions,
          restrictedSpendPurpose,
        })) {
          candidates.push({
            card,
            castCard,
            sourceZone,
            castMethod,
            payability: 'normal',
            manaCost,
            cost: adjustedCost,
            ...(spendManaAsThoughAnyType ? { payableCost, spendManaAsThoughAnyType: true } : {}),
            grantsFlash,
            ...(exileAfterResolution ? { exileAfterResolution: true } : {}),
            ...(leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination } : {}),
            ...(leaveBattlefieldReplacementSourceName ? { leaveBattlefieldReplacementSourceName } : {}),
            ...(leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain } : {}),
            ...(sourceGrantedAdditionalCost ? { sourceGrantedAdditionalCost } : {}),
            ...castPermissionFields,
            ...(graveyardPermissionSourceName ? { graveyardPermissionSourceName } : {}),
            ...(graveyardPermissionCostMode ? { graveyardPermissionCostMode } : {}),
            ...(castAsAdventureOnly ? { castAsAdventureOnly: true } : {}),
            ...(libraryPermissionCostMode ? { libraryPermissionCostMode } : {}),
            ...freeCastFields,
          });
          continue;
        }

        if (
          allowAlternateCosts &&
          canUseAlternateCostForSpellCandidate(sourceZone, castMethod) &&
          hasPayableAlternateCost(ctx, playerId, castCard, manaPaymentOptions?.excludedHandCardIds, sourceZone)
        ) {
          candidates.push({
            card,
            castCard,
            sourceZone,
            castMethod,
            payability: 'alternate',
            manaCost,
            grantsFlash,
            ...castPermissionFields,
            ...(graveyardPermissionSourceName ? { graveyardPermissionSourceName } : {}),
            ...(graveyardPermissionCostMode ? { graveyardPermissionCostMode } : {}),
            ...(castAsAdventureOnly ? { castAsAdventureOnly: true } : {}),
            ...(libraryPermissionCostMode ? { libraryPermissionCostMode } : {}),
            ...freeCastFields,
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
