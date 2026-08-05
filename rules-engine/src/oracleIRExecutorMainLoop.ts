import type { GameState, PlayerID, BattlefieldPermanent, OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import { isPerPlayerOptionalOracleStep } from './oracleIRPerPlayerOptional';
import { collectReplayMutationsFromAppliedStep, mergeReplayMutations, type OracleIRReplayMutation } from './oracleIRReplayMutations';
import { parseOracleTextToIR } from './oracleIRParser';
import {
  appendOracleAutomationGapRecords,
  createOracleAutomationGapRecord,
} from './oracleIRAutomationGaps';
import {
  applyConditionalReferenceAmount,
  evaluateConditionalWrapperCondition,
  resolveConditionalReferenceAmount,
} from './oracleIRExecutorConditionalStepSupport';
import { generateCoinFlipResult } from './coinFlip';
import {
  bindCopiedStackSpellTargetsToContext,
  getCopiedChapterAbilityReplaySteps,
  getCopiedSpellReplaySteps,
  getCopiedStackObjectReplaySteps,
  payCopiedSpellCastCost,
  prepareCopiedSpellExecutionContext,
  resolveCopySpellCount,
  resolveCopiedTargetSpellStackItem,
  resolveCopiedSpellSourceCards,
  resolveThisSpellCopyReplaySteps,
  shouldDeferStackSpellCopyToServer,
} from './oracleIRExecutorCopySpellSupport';
import { performDieRoll, performMultipleDieRolls } from './dieRoll';
import { applyAttachStep } from './oracleIRExecutorAttachStepHandlers';
import { applyChooseModeStep } from './oracleIRExecutorChooseModeStepHandlers';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';
import {
  applyCantAttackStep,
  applyCantActivateAbilitiesStep,
  applyAddCounterStep,
  applyAddTypesStep,
  applyCantBlockStep,
  applyForceBlockStep,
  applyDoubleCountersStep,
  applyDestroyStep,
  applyDetainStep,
  applyAirbendStep,
  applyEarthbendStep,
  applyAnimatePermanentStep,
  applyExertStep,
  applyExileStep,
  applyExchangeControlStep,
  applyGainClassLevelStep,
  applyGainControlStep,
  applyGrantStaticAbilityStep,
  applyRegenerateStep,
  applyGrantLeaveBattlefieldReplacementStep,
  applyGrantTemporaryAbilityStep,
  applyGrantTemporaryDiesTriggerStep,
  applyAssignNoCombatDamageStep,
  applyBecomeAuraStep,
  applyMonstrosityStep,
  applyBecomeRenownedStep,
  applyOptionalUntapChoiceStep,
  applyPhaseOutStep,
  applyCopyPermanentStep,
  applyPutStickerStep,
  applyRemoveCounterStep,
  applyMoveCountersStep,
  applySacrificeStep,
  applyScheduleDelayedBattlefieldActionStep,
  applyScheduleDelayedTriggerStep,
  applySuspectStep,
  applySkipNextUntapStep,
  applyTapMatchingPermanentsStep,
  applyTapOrUntapStep,
  applySetBasicLandTypeStep,
  applyTurnFaceDownStep,
  applyTurnFaceUpStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import { applyDamageCantBePreventedStep, applyDealDamageStep, applyPreventDamageStep } from './oracleIRExecutorDamageStepHandlers';
import {
  applyExileTopStep,
  applyGrantExilePermissionStep,
  applyImpulseExileTopStep,
  applyModifyExilePermissionsStep,
} from './oracleIRExecutorExileStepHandlers';
import { applyGrantFutureSpellEffectStep } from './oracleIRExecutorFutureSpellStepHandlers';
import { getStateGrantedCounterImmunityForSpell } from './futureSpellEffects';
import { applyGoadStep } from './oracleIRExecutorGoadStepHandlers';
import {
  applyBlightStep,
  applyInvestigateStep,
  applyPopulateStep,
  applyProliferateStep,
  applyRingTemptsYouStep,
  applyTimeTravelStep,
} from './oracleIRExecutorKeywordStepHandlers';
import { opponentsHaveCantWinEffect, playerHasCantLoseEffect } from './winEffectCards';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  applyModifyPtPerRevealedStep,
  applySetBasePtStep,
  applyModifyPtStep,
  applySwitchPowerToughnessStep,
} from './oracleIRExecutorModifyPtStepHandlers';
import { applyMoveZoneStep } from './oracleIRExecutorMoveZoneStepHandlers';
import { moveTargetedCardFromExile } from './oracleIRExecutorZoneOps';
import {
  applyAddManaStep,
  applyAddPlayerCounterStep,
  applyDoublePlayerCountersStep,
  applyAssembleStep,
  applyBecomeMonarchStep,
  applyAbandonSchemeStep,
  applyClashStep,
  applyChoosePileStep,
  applyChangeTargetStep,
  applyCollectEvidenceStep,
  applyConniveStep,
  applyCreateEmblemStep,
  applyDiscardStep,
  applyDrawStep,
  applyExploreStep,
  applyFatesealStep,
  applyLearnStep,
  applyManifestDreadStep,
  applyGrantGraveyardPermissionStep,
  applyGrantGraveyardKeywordAbilityStep,
  applyModifyGraveyardPermissionsStep,
  applyModifyTokenCreationStep,
  evaluateUnlessPaysLifeStep,
  evaluateUnlessPaysManaStep,
  evaluateUnlessDiscardsStep,
  applyRegisterLoseGameReplacementStep,
  applyGainLifeStep,
  applyLoseLifeStep,
  applyRedistributeLifeTotalsStep,
  applyLookHandStep,
  applyLookChooseFromTopStep,
  applyLookTopStep,
  applyPutOnBottomStep,
  applyRevealTopStep,
  applyLookSelectTopStep,
  applyMillStep,
  applyOpenAttractionStep,
  applyPayManaStep,
  applyPlaneswalkStep,
  applyRetainManaStep,
  applyRevealHandStep,
  applyRollVisitAttractionsStep,
  applyScryStep,
  applyExileNamedCardsFromZonesStep,
  applySearchLibraryStep,
  applyShuffleZonesIntoLibraryStep,
  applyShuffleLibraryStep,
  applySetInMotionStep,
  applySurveilStep,
  applyTakeInitiativeStep,
  applyVentureIntoDungeonStep,
  applyVoteStep,
} from './oracleIRExecutorPlayerStepHandlers';
import { applyCreateTokenStep } from './oracleIRExecutorTokenStepHandlers';
import { applyAddExtraCombat, applyEndTurnStep, applySkipNextDrawStep, applySkipNextTurnStep, applyTakeExtraTurn } from './oracleIRExecutorTurnStepHandlers';
import { stampCardsPutIntoGraveyardThisTurn, resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { getColorsFromObject, normalizeOracleManaCostString } from './oracleIRExecutorManaUtils';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
} from './oracleIRExecutionTypes';
import {
  acquireStepLedgerForExecution,
  flushObservationLedgerFromChoiceDeferredResult,
  flushStepLedgerFromAppliedResult,
  sanitizeBridgedStepCarryOver,
  snapshotStepLedger,
  type StepLedger,
} from './oracleIRStepLedgerRuntime';
import { trackAppliedStepKind } from './oracleIRStepLedger';
import { resolveAntecedentContextualCards } from './oracleIRLedgerCardAccess';

const COUNTER_IMMUNITY_COLOR_SYMBOLS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function normalizeCounterImmunityText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,]+$/g, '')
    .trim();
}

function normalizeCounterImmunityColors(value: unknown): readonly string[] {
  const rawValues = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawValues) {
    const parts = String(raw || '')
      .split(/(?:,|\/|\bor\b|\band\b)+/i)
      .map(part => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const lower = part.toLowerCase();
      const normalized = ['W', 'U', 'B', 'R', 'G'].includes(part.toUpperCase())
        ? part.toUpperCase()
        : COUNTER_IMMUNITY_COLOR_SYMBOLS[lower];
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }

  return out;
}

function getCardLikeOracleText(value: any): string {
  return String(
    value?.card?.oracle_text ||
    value?.card?.oracleText ||
    value?.card?.rulesText ||
    value?.oracle_text ||
    value?.oracleText ||
    value?.rulesText ||
    value?.abilityText ||
    ''
  ).replace(/\u2019/g, "'");
}

function getCardLikeTypeLineLower(value: any): string {
  return String(
    value?.card?.type_line ||
    value?.card?.cardType ||
    value?.type_line ||
    value?.cardType ||
    ''
  )
    .toLowerCase()
    .trim();
}

function matchesCounterImmunityWord(value: string, word: string): boolean {
  const escapedWord = String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escapedWord}\\b`, 'i').test(value);
}

function spellMatchesCounterImmunityQualifier(stackItem: any, qualifierRaw: string): boolean {
  const qualifier = normalizeCounterImmunityText(qualifierRaw);
  if (!qualifier) return false;

  const spellCard = stackItem?.card || stackItem;
  const colorSymbol = COUNTER_IMMUNITY_COLOR_SYMBOLS[qualifier];
  if (colorSymbol) {
    return getColorsFromObject(spellCard)
      .map(color => String(color || '').trim().toUpperCase())
      .includes(colorSymbol);
  }

  const typeLineLower = getCardLikeTypeLineLower(spellCard);
  if (!typeLineLower) return false;
  return matchesCounterImmunityWord(typeLineLower, qualifier);
}

function getStackItemCounterImmunityMetadata(stackItem: any): {
  readonly unconditional: boolean;
  readonly counterSourceColors: readonly string[];
} {
  const rawCounterImmunity = stackItem?.counterImmunity ?? stackItem?.card?.counterImmunity;
  const counterSourceColors = (() => {
    const direct = normalizeCounterImmunityColors(
      stackItem?.cantBeCounteredBySourceColors ?? stackItem?.card?.cantBeCounteredBySourceColors
    );
    if (direct.length > 0) return direct;

    if (Array.isArray(rawCounterImmunity)) {
      return normalizeCounterImmunityColors(rawCounterImmunity);
    }

    if (rawCounterImmunity && typeof rawCounterImmunity === 'object') {
      return normalizeCounterImmunityColors(
        (rawCounterImmunity as any)?.counterSourceColors ??
          (rawCounterImmunity as any)?.sourceColors ??
          (rawCounterImmunity as any)?.onlyAgainstSourceColors ??
          (rawCounterImmunity as any)?.cantBeCounteredBySourceColors
      );
    }

    return [];
  })();

  return {
    unconditional:
      Boolean(stackItem?.cantBeCountered || stackItem?.card?.cantBeCountered) ||
      rawCounterImmunity === true ||
      Boolean((rawCounterImmunity as any)?.unconditional) ||
      Boolean((rawCounterImmunity as any)?.cantBeCountered),
    counterSourceColors,
  };
}

function getCounterSourceColors(ctx?: OracleIRExecutionContext): readonly string[] {
  return normalizeCounterImmunityColors(ctx?.sourceColors);
}

function battlefieldGrantsCounterImmunity(state: GameState, stackItem: any): boolean {
  const spellController = String(
    stackItem?.controller || stackItem?.controllerId || stackItem?.owner || stackItem?.ownerId || ''
  ).trim();
  if (!spellController) return false;

  const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
  return battlefield.some((source: any) => {
    const sourceController = String(source?.controller || source?.controllerId || source?.ownerId || source?.owner || '').trim();
    const oracleText = getCardLikeOracleText(source);
    if (!oracleText) return false;

    const lines = oracleText
      .split(/\r?\n+/)
      .map(line => normalizeCounterImmunityText(line))
      .filter(Boolean);

    return lines.some((line) => {
      if (/^spells can(?:not|'t) be countered$/i.test(line)) return true;

      if (/^spells you control can(?:not|'t) be countered$/i.test(line)) {
        return spellController === sourceController;
      }

      const controllerQualifiedMatch = line.match(/^(.+?) spells you control can(?:not|'t) be countered$/i);
      if (controllerQualifiedMatch) {
        return spellController === sourceController && spellMatchesCounterImmunityQualifier(stackItem, String(controllerQualifiedMatch[1] || ''));
      }

      const globalQualifiedMatch = line.match(/^(.+?) spells can(?:not|'t) be countered$/i);
      if (globalQualifiedMatch) {
        return spellMatchesCounterImmunityQualifier(stackItem, String(globalQualifiedMatch[1] || ''));
      }

      return false;
    });
  });
}

function spellCanBeCountered(state: GameState, stackItem: any, ctx?: OracleIRExecutionContext): boolean {
  const stackCounterImmunity = getStackItemCounterImmunityMetadata(stackItem);
  const stateCounterImmunity = getStateGrantedCounterImmunityForSpell(state, stackItem);
  const counterImmunity = {
    unconditional: Boolean(stackCounterImmunity.unconditional) || Boolean(stateCounterImmunity?.unconditional),
    counterSourceColors: Array.from(
      new Set([
        ...(stackCounterImmunity.counterSourceColors || []),
        ...(stateCounterImmunity?.counterSourceColors || []),
      ])
    ),
  };
  if (counterImmunity.unconditional) {
    return false;
  }

  if (counterImmunity.counterSourceColors.length > 0) {
    const counterSourceColors = getCounterSourceColors(ctx);
    if (counterSourceColors.some(color => counterImmunity.counterSourceColors.includes(color))) {
      return false;
    }
  }

  const oracleText = normalizeCounterImmunityText(getCardLikeOracleText(stackItem));
  if (oracleText.includes("this spell can't be countered") || oracleText.includes('this spell cannot be countered')) {
    return false;
  }

  return !battlefieldGrantsCounterImmunity(state, stackItem);
}

function isPlayerStillInGame(player: any): boolean {
  return Boolean(player?.id) && !player?.hasLost && !player?.eliminated && !player?.conceded && !player?.spectator && !player?.isSpectator;
}

type RecurseExecutor = (
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions
) => OracleIRExecutionResult;

type CounterStackTargetKind = 'spell' | 'ability' | 'spell_or_ability';

function isStackAbilityStackType(type: string): boolean {
  const normalized = String(type || '').trim();
  return normalized === 'ability' || normalized === 'activated_ability' || normalized === 'triggered_ability';
}

function isStackManaAbilityItem(stackItem: any): boolean {
  return Boolean((stackItem as any)?.isManaAbility);
}

function counterSpellStepTargetText(step: Extract<OracleEffectStep, { kind: 'counter_spell' }>): string {
  const target = (step as any).target;
  if (target && typeof target === 'object' && typeof (target as any).text === 'string') {
    return String((target as any).text || '');
  }
  return String(step.raw || '');
}

function counterSpellStepCombinedText(step: Extract<OracleEffectStep, { kind: 'counter_spell' }>): string {
  return `${counterSpellStepTargetText(step)} ${String(step.raw || '')}`.toLowerCase();
}

function isSelfReferentialCounterSpellStep(step: Extract<OracleEffectStep, { kind: 'counter_spell' }>): boolean {
  const combined = counterSpellStepCombinedText(step);
  if (!/\b(?:this permanent|this spell|~)\b/.test(combined)) return false;
  return !/\btarget spell\b/.test(combined);
}

function resolveSelfReferentialCounterStackItem(
  stackItems: readonly any[],
  state: GameState,
  ctx: OracleIRExecutionContext,
  targetKind: CounterStackTargetKind,
): any | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  if (sourceId) {
    const direct = stackItems.find((item) => String((item as any)?.id || '').trim() === sourceId);
    if (direct && stackItemMatchesCounterTargetKind(state, direct, ctx, targetKind)) return direct;
  }
  const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
  if (!sourceName) return undefined;
  return stackItems.find((item) => {
    const itemName = String((item as any)?.card?.name || (item as any)?.name || '').trim().toLowerCase();
    return itemName === sourceName && stackItemMatchesCounterTargetKind(state, item, ctx, targetKind);
  });
}

function inferCounterStackTargetKind(step: Extract<OracleEffectStep, { kind: 'counter_spell' }>): CounterStackTargetKind {
  const combined = counterSpellStepCombinedText(step);
  const mentionsSpell = /\b(?:target spell|that spell|spells?\b)/.test(combined);
  const mentionsAbility = /\b(?:target ability|that ability|(?:activated|triggered)\s+abilit(?:y|ies)|abilities?\b)/.test(combined);

  if (mentionsSpell && mentionsAbility) {
    return 'spell_or_ability';
  }
  if (mentionsAbility && !mentionsSpell) {
    return 'ability';
  }
  return 'spell';
}

function stackItemMatchesCounterTargetKind(
  state: GameState,
  stackItem: any,
  ctx: OracleIRExecutionContext,
  targetKind: CounterStackTargetKind,
): boolean {
  const type = String((stackItem as any)?.type || '').trim();
  if (isStackAbilityStackType(type)) {
    if (targetKind === 'spell') return false;
    return !isStackManaAbilityItem(stackItem);
  }
  if (type !== 'spell') return false;
  if (targetKind === 'ability') return false;
  return spellCanBeCountered(state, stackItem, ctx);
}

function filterCounterStackCandidates(
  state: GameState,
  stackItems: readonly any[],
  ctx: OracleIRExecutionContext,
  targetKind: CounterStackTargetKind,
): any[] {
  return stackItems.filter((item) => {
    const itemId = String((item as any)?.id || '').trim();
    if (!itemId || itemId === String(ctx.sourceId || '').trim()) return false;
    return stackItemMatchesCounterTargetKind(state, item, ctx, targetKind);
  });
}

function applyCounterSpellStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'counter_spell' }>,
  ctx: OracleIRExecutionContext
):
  | { readonly applied: true; readonly state: GameState; readonly log: readonly string[]; readonly lastMovedCards: readonly any[] }
  | {
      readonly applied: false;
      readonly message: string;
      readonly reason: 'player_choice_required' | 'failed_to_apply';
      readonly options?: {
        readonly classification?: 'player_choice' | 'invalid_input';
        readonly metadata?: Record<string, string | number | boolean | readonly string[]>;
        readonly persist?: boolean;
      };
    } {
  const stackItems = Array.isArray((state as any).stack) ? [ ...((state as any).stack as any[]) ] : [];
  const directTargetId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  const targetKind = inferCounterStackTargetKind(step);
  const targetLabel = targetKind === 'ability' ? 'ability' : targetKind === 'spell_or_ability' ? 'spell or ability' : 'spell';
  const candidates = filterCounterStackCandidates(state, stackItems, ctx, targetKind);

  let targetStackItem = isSelfReferentialCounterSpellStep(step)
    ? resolveSelfReferentialCounterStackItem(stackItems, state, ctx, targetKind)
    : undefined;

  if (!targetStackItem && directTargetId) {
    targetStackItem = candidates.find(item => String((item as any)?.id || '').trim() === directTargetId);
  }

  if (!targetStackItem && directTargetId) {
    if (candidates.length === 1) {
      targetStackItem = candidates[0];
    } else if (candidates.length > 0) {
      targetStackItem = candidates.find(item => String((item as any)?.id || '').trim() === directTargetId) || candidates[0];
    }
  }

  if (!targetStackItem && directTargetId && candidates.length === 0) {
    const directStackItem = stackItems.find(item => String((item as any)?.id || '').trim() === directTargetId);
    if (directStackItem && stackItemMatchesCounterTargetKind(state, directStackItem, ctx, targetKind)) {
      targetStackItem = directStackItem;
    }
  }

  if (!targetStackItem) {
    if (candidates.length === 1) {
      targetStackItem = candidates[0];
    } else if (candidates.length === 0) {
      return {
        applied: false,
        message: `Skipped counter ${targetLabel} (no legal ${targetLabel} target on stack): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          classification: 'invalid_input',
          metadata: { stackSpellCount: 0, stackTargetCount: 0 },
          persist: false,
        },
      };
    } else {
      const candidateIds = candidates.map(item => String((item as any)?.id || '').trim()).filter(Boolean);
      return {
        applied: false,
        message: `Skipped counter ${targetLabel} (requires stack target choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            stackSpellCount: candidates.filter(item => String((item as any)?.type || '').trim() === 'spell').length,
            stackTargetCount: candidates.length,
            candidateSpellIds: candidateIds,
            candidateStackTargetIds: candidateIds,
          },
        },
      };
    }
  }

  const targetStackItemId = String((targetStackItem as any)?.id || '').trim();
  const targetType = String((targetStackItem as any)?.type || '').trim();
  const isAbilityTarget = isStackAbilityStackType(targetType);
  const updatedStack = stackItems.filter(item => String((item as any)?.id || '').trim() !== targetStackItemId);

  if (isAbilityTarget) {
    const abilityDesc = String(
      (targetStackItem as any)?.description ||
        (targetStackItem as any)?.ability?.text ||
        (targetStackItem as any)?.name ||
        targetStackItemId,
    ).trim() || targetStackItemId;

    return {
      applied: true,
      state: {
        ...state,
        stack: updatedStack,
      },
      log: [`Countered ability ${abilityDesc}`],
      lastMovedCards: [],
    };
  }

  const ownerId = String(
    (targetStackItem as any)?.owner ||
      (targetStackItem as any)?.ownerId ||
      (targetStackItem as any)?.controller ||
      (targetStackItem as any)?.controllerId ||
      ''
  ).trim();
  if (!targetStackItemId || !ownerId) {
    return {
      applied: false,
      message: `Skipped counter spell (missing stack spell owner metadata): ${step.raw}`,
      reason: 'failed_to_apply',
      options: {
        classification: 'invalid_input',
        metadata: { targetSpellId: targetStackItemId },
      },
    };
  }

  const movedCard = (targetStackItem as any)?.card || targetStackItem;
  const targetName = String((targetStackItem as any)?.card?.name || (targetStackItem as any)?.name || targetStackItemId).trim() || targetStackItemId;

  // Copied spells can cease instead of changing zones (ceaseOnCounter).
  if ((movedCard as any)?.ceaseOnCounter === true || (targetStackItem as any)?.ceaseOnCounter === true) {
    return {
      applied: true,
      state: {
        ...state,
        stack: updatedStack,
      },
      log: [`Countered copied spell ${targetName} (ceased to exist)`],
      lastMovedCards: [],
    };
  }

  // Mirror stack→GY replacements (flashback / jump-start / escape / disturb / harmonize,
  // castFromGraveyard, exileAfterResolution). Full overlay replacement stays server-side;
  // this covers the builtin exile-after-resolution family so IR primary matches counterStackItem.
  const castWithAbility = String(
    (targetStackItem as any)?.card?.castWithAbility
      || (targetStackItem as any)?.castWithAbility
      || (movedCard as any)?.castWithAbility
      || '',
  ).trim().toLowerCase();
  const STACK_GY_EXILE_ABILITIES = new Set(['flashback', 'jump-start', 'escape', 'disturb', 'harmonize']);
  const exileAfterResolution = Boolean(
    (targetStackItem as any)?.exileAfterResolution
      || (targetStackItem as any)?.card?.exileAfterResolution
      || (movedCard as any)?.exileAfterResolution,
  );
  const castFromGraveyard = Boolean(
    (targetStackItem as any)?.castFromGraveyard
      || (targetStackItem as any)?.card?.castFromGraveyard
      || (movedCard as any)?.castFromGraveyard,
  );
  const shouldExile = exileAfterResolution
    || castFromGraveyard
    || STACK_GY_EXILE_ABILITIES.has(castWithAbility);

  const updatedPlayers = (state.players || []).map((player: any) => {
    if (String(player?.id || '').trim() !== ownerId) return player;
    if (shouldExile) {
      const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
      const stamped = { ...(movedCard as any), zone: 'exile' };
      return {
        ...player,
        exile: [...exile, stamped],
      };
    }
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    return {
      ...player,
      graveyard: [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(state, [movedCard])],
    };
  });

  return {
    applied: true,
    state: {
      ...state,
      stack: updatedStack,
      players: updatedPlayers as any,
    },
    log: [
      shouldExile
        ? `Countered spell ${targetName} (exiled)`
        : `Countered spell ${targetName}`,
    ],
    lastMovedCards: [movedCard],
  };
}

function getLastDieRollResultForPlayer(state: GameState, playerId: PlayerID): number | null {
  const playerRoll = (state as any)?.lastDieRollByPlayer?.[playerId];
  if (typeof playerRoll === 'number' && Number.isFinite(playerRoll)) return playerRoll;
  if (Number.isFinite(Number(playerRoll?.result))) return Number(playerRoll.result);

  const globalLast = (state as any)?.lastDieRoll;
  if (String(globalLast?.playerId || '').trim() === String(playerId || '').trim() && Number.isFinite(Number(globalLast?.result))) {
    return Number(globalLast.result);
  }

  return null;
}

const HALT_ON_PLAYER_CHOICE_STEP_KINDS = new Set<string>([
  'add_mana',
  'blight',
  'change_target',
  'choose_pile',
  'connive',
  'discard',
  'explore',
  'look_choose_from_top',
  'look_select_top',
  'library_chaos_exchange',
  'move_zone',
  'pay_mana',
  'player_choice',
  'proliferate',
  'redistribute_life_totals',
  'populate',
  'repeated_zone_draft',
  'separate_into_piles',
  'sacrifice',
  'scry',
  'search_library',
  'surveil',
  'tap_matching_permanents',
]);

export function applyOracleIRStepsToGameStateImpl(
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions,
  recurse: RecurseExecutor
): OracleIRExecutionResult {
  type StepOutcomeKind = 'applied' | 'choice_required' | 'impossible' | 'unsupported';

  const log: string[] = [];
  const appliedSteps: OracleEffectStep[] = [];
  const skippedSteps: OracleEffectStep[] = [];
  const localAutomationGaps: OracleAutomationGap[] = [];
  const automationGaps: OracleAutomationGap[] = [];
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  let currentCtx: OracleIRExecutionContext & {
    readonly lastRevealedCards?: readonly unknown[];
    readonly lastGreatestDiscardedCardCount?: number;
    readonly lastCreatedTokenIds?: readonly string[];
  } = ctx;
  let lastRevealedCardCount = 0;
  let lastDiscardedCardCount = 0;
  let lastGreatestDiscardedCardCount = Math.max(0, Number((ctx as any).lastGreatestDiscardedCardCount) || 0);
  let lastDiscardedCards: any[] = Array.isArray(ctx.lastDiscardedCards) ? [...ctx.lastDiscardedCards] : [];
  let lastExiledCardCount = 0;
  let lastExiledCards: any[] = Array.isArray(ctx.lastExiledCards) ? [...ctx.lastExiledCards] : [];
  let lastGrantedGraveyardCards: any[] = [];
  let lastGrantedGraveyardPermissionIds: string[] = [];
  let lastMovedCards: any[] = Array.isArray(ctx.lastMovedCards) ? [...ctx.lastMovedCards] : [];
  let lastMovedBattlefieldPermanentIds: string[] = Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
    ? [...ctx.lastMovedBattlefieldPermanentIds]
    : [];
  let lastCreatedTokenIds: string[] = Array.isArray((ctx as any).lastCreatedTokenIds)
    ? (ctx as any).lastCreatedTokenIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  let lastGoadedCreatures: BattlefieldPermanent[] = [];
  let lastSacrificedCreaturesPowerTotal = 0;
  let lastSacrificedPermanents: LastKnownPermanentSnapshot[] = Array.isArray((ctx as any).lastSacrificedPermanents)
    ? [...((ctx as any).lastSacrificedPermanents as LastKnownPermanentSnapshot[])]
    : [];
  let lastExcessDamageDealtThisWay = 0;
  let lastScryLookedAtCount = 0;
  let lastTappedMatchingPermanentCount = Math.max(0, Number(ctx.lastTappedMatchingPermanentCount) || 0);
  let lastReferenceAmount = Number.isFinite(Number(ctx.referenceAmount))
    ? Math.max(0, Number(ctx.referenceAmount) || 0)
    : Number.isFinite(Number((ctx as any).lastReferenceAmount))
      ? Math.max(0, Number((ctx as any).lastReferenceAmount) || 0)
      : undefined;
  let lastMovedCountByPlayer: Readonly<Record<string, number>> | undefined = (ctx as any).lastMovedCountByPlayer;
  let lastClashWon = typeof ctx.lastClashWon === 'boolean' ? ctx.lastClashWon : undefined;
  let lastCollectedEvidence = typeof ctx.lastCollectedEvidence === 'boolean' ? ctx.lastCollectedEvidence : undefined;
  let lastSetInMotionScheme = (ctx as any).lastSetInMotionScheme;
  let lastStepOutcome: {
    readonly kind: StepOutcomeKind;
    readonly stepKind: OracleEffectStep['kind'];
    readonly count?: number;
  } | null = null;
  let lastActionOutcome: {
    readonly kind: StepOutcomeKind;
    readonly stepKind: OracleEffectStep['kind'];
    readonly count?: number;
  } | null = null;
  let lastConditionalEvaluation: boolean | null = null;
  let replayMutations: OracleIRReplayMutation[] = [];

  let nextState = state;
  const pendingOptionalSteps: OracleEffectStep[] = [];
  let haltedForPlayerChoice = false;
  let pendingContinuationSteps: OracleEffectStep[] | undefined;
  let automationGapSequence = 0;
  const stepLedger: StepLedger = acquireStepLedgerForExecution(ctx);
  const appliedStepKinds = new Map<number, string>(
    ctx.appliedStepKinds ? [...ctx.appliedStepKinds] : [],
  );

  const absorbExecutionReplayMutations = (execution: { readonly replayMutations?: readonly OracleIRReplayMutation[] }): void => {
    if (Array.isArray(execution.replayMutations) && execution.replayMutations.length > 0) {
      replayMutations = mergeReplayMutations(replayMutations, execution.replayMutations);
    }
  };

  const setLastStepOutcome = (step: OracleEffectStep, kind: StepOutcomeKind, metadata?: { readonly count?: number }): void => {
    lastStepOutcome = { kind, stepKind: step.kind, ...(metadata?.count !== undefined ? { count: metadata.count } : {}) };
    if (kind === 'applied' || kind === 'choice_required' || kind === 'impossible') {
      lastActionOutcome = { kind, stepKind: step.kind, ...(metadata?.count !== undefined ? { count: metadata.count } : {}) };
      if (typeof metadata?.count === 'number' && Number.isFinite(metadata.count)) {
        lastReferenceAmount = Math.max(0, Number(metadata.count) || 0);
      }
    }
  };

  const mergeNestedExecutionOutcome = (nestedResult: {
    readonly lastStepOutcome?: {
      readonly kind: StepOutcomeKind;
      readonly stepKind: OracleEffectStep['kind'];
      readonly count?: number;
    } | null;
  }): void => {
    if (!nestedResult.lastStepOutcome) return;
    lastStepOutcome = nestedResult.lastStepOutcome;
    const kind = nestedResult.lastStepOutcome.kind;
    if (kind === 'applied' || kind === 'choice_required' || kind === 'impossible') {
      lastActionOutcome = nestedResult.lastStepOutcome;
    }
  };

  const inferSkippedStepOutcome = (
    reasonCode: string,
    skipOptions: {
      readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      readonly persist?: boolean;
    } | undefined
  ): StepOutcomeKind => {
    if (reasonCode === 'impossible_action' || skipOptions?.classification === 'invalid_input') return 'impossible';
    if (reasonCode === 'player_choice_required' || skipOptions?.classification === 'player_choice') return 'choice_required';
    return 'unsupported';
  };

  const recordSkippedStep = (
    step: OracleEffectStep,
    message: string,
    reasonCode: string,
    skipOptions: {
      readonly pending?: boolean;
      readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
      readonly persist?: boolean;
    } = {}
  ): void => {
    setLastStepOutcome(step, inferSkippedStepOutcome(reasonCode, skipOptions));
    skippedSteps.push(step);
    if (skipOptions.pending) {
      pendingOptionalSteps.push(step);
    }
    log.push(message);

    if (skipOptions.persist === false) {
      return;
    }

    const gap = createOracleAutomationGapRecord({
      state: nextState,
      ctx: currentCtx,
      step,
      reasonCode,
      message,
      sequence: ++automationGapSequence,
      classification: skipOptions.classification,
      metadata: skipOptions.metadata,
    });
    localAutomationGaps.push(gap);
    automationGaps.push(gap);

    if (
      options.haltOnPlayerChoiceRequired === true &&
      reasonCode === 'player_choice_required' &&
      HALT_ON_PLAYER_CHOICE_STEP_KINDS.has(String(step.kind || ''))
    ) {
      haltedForPlayerChoice = true;
    }
  };

  const normalizeSkipMetadata = (
    metadata: Record<string, unknown> | undefined,
  ): Record<string, string | number | boolean | null | readonly string[]> | undefined => {
    if (!metadata) return undefined;
    return Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => {
        if (
          value === null ||
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          Array.isArray(value)
        ) {
          return [key, value];
        }
        return [key, JSON.stringify(value)];
      }),
    ) as Record<string, string | number | boolean | null | readonly string[]>;
  };

  const applyHandledStepResult = (
    step: OracleEffectStep,
    result: any,
    onApplied?: (appliedResult: any) => void
  ): boolean => {
    if ('message' in result) {
      if (result.state) {
        nextState = result.state;
      }
      const observationFlushed = flushObservationLedgerFromChoiceDeferredResult({
        ledger: stepLedger,
        appliedStepKinds,
        stepIndex: Number(currentCtx.currentStepIndex ?? 0),
        step,
        controllerId: String(controllerId),
        result,
      });
      if (observationFlushed) {
        if (Array.isArray(result.lastMovedCards) && result.lastMovedCards.length > 0) {
          lastMovedCards = [...result.lastMovedCards];
        }
        if (typeof result.lastScryLookedAtCount === 'number') {
          lastScryLookedAtCount = Math.max(0, Number(result.lastScryLookedAtCount) || 0);
        }
        currentCtx = {
          ...currentCtx,
          stepLedger: snapshotStepLedger(stepLedger),
          appliedStepKinds: new Map(appliedStepKinds),
          ...(lastMovedCards.length > 0 ? { lastMovedCards } : {}),
        };
      }
      recordSkippedStep(step, result.message, result.reason, result.options);
      return false;
    }

    nextState = result.state;
    if (currentCtx.transitionHaltState?.halted) {
      recordSkippedStep(
        step,
        'Deferred replacement effect choice required',
        'player_choice_required',
        { classification: 'player_choice' },
      );
      return false;
    }
    if (typeof result?.count === 'number' && Number.isFinite(result.count)) {
      setLastStepOutcome(step, 'applied', { count: result.count });
    } else {
      setLastStepOutcome(step, 'applied');
    }
    currentCtx = {
      ...currentCtx,
      ...(typeof lastReferenceAmount === 'number' && Number.isFinite(lastReferenceAmount)
        ? { referenceAmount: lastReferenceAmount }
        : {}),
    };
    onApplied?.(sanitizeBridgedStepCarryOver(result));
    trackAppliedStepKind(appliedStepKinds, Number(currentCtx.currentStepIndex ?? 0), step);
    if (!result.skipLedgerFlush) {
      flushStepLedgerFromAppliedResult({
        ledger: stepLedger,
        appliedStepKinds,
        stepIndex: Number(currentCtx.currentStepIndex ?? 0),
        step,
        controllerId: String(controllerId),
        appliedResult: result,
      });
    }
    currentCtx = {
      ...currentCtx,
      stepLedger: snapshotStepLedger(stepLedger),
      appliedStepKinds: new Map(appliedStepKinds),
    };
    log.push(...result.log);
    appliedSteps.push(step);
    replayMutations = mergeReplayMutations(
      replayMutations,
      collectReplayMutationsFromAppliedStep(step, result, nextState, currentCtx),
    );
    return true;
  };

  const applyModifyPtStepResult = (
    step: OracleEffectStep,
    result: any
  ): boolean => {
    if (result.kind === 'recorded_skip') {
      recordSkippedStep(step, result.message, result.reason);
      return false;
    }
    if (result.kind === 'unrecorded_skip') {
      setLastStepOutcome(step, 'unsupported');
      skippedSteps.push(step);
      log.push(result.log);
      return false;
    }
    if (result.kind !== 'applied') {
      return false;
    }

    nextState = result.state;
    setLastStepOutcome(step, 'applied');
    trackAppliedStepKind(appliedStepKinds, Number(currentCtx.currentStepIndex ?? 0), step);
    currentCtx = {
      ...currentCtx,
      stepLedger: snapshotStepLedger(stepLedger),
      appliedStepKinds: new Map(appliedStepKinds),
    };
    log.push(...result.log);
    appliedSteps.push(step);
    return true;
  };

  const baseStepIndex = Number.isFinite(Number(ctx.currentStepIndex)) && Number(ctx.currentStepIndex) >= 0
    ? Number(ctx.currentStepIndex)
    : 0;

  for (let relativeIndex = 0; relativeIndex < steps.length; relativeIndex += 1) {
    const step = steps[relativeIndex];
    const stepIndex = baseStepIndex + relativeIndex;
    currentCtx = {
      ...currentCtx,
      currentStepIndex: stepIndex,
      stepLedger: snapshotStepLedger(stepLedger),
      appliedStepKinds: new Map(appliedStepKinds),
    };
    if (step.kind !== 'conditional') {
      lastConditionalEvaluation = null;
    }
    const isOptional = Boolean((step as any).optional);
    const optionalLookLibraryStep =
      isOptional &&
      currentCtx.interactivePlayerChoices === true &&
      (step.kind === 'look_choose_from_top' || step.kind === 'look_select_top');
    const optionalAnyNumberDiscardStep =
      isOptional &&
      currentCtx.interactivePlayerChoices === true &&
      step.kind === 'discard' &&
      (step as any).amount?.kind === 'any_number';
    const optionalGrantGraveyardDuringResolutionStep =
      isOptional &&
      step.kind === 'grant_graveyard_permission' &&
      String((step as any).duration || '') === 'during_resolution' &&
      currentCtx.interactivePlayerChoices === true &&
      currentCtx.deferOptionalGrantGraveyardChoices === true;
    const optionalPerPlayerChoiceStep =
      isOptional &&
      currentCtx.interactivePlayerChoices === true &&
      currentCtx.deferOptionalPerPlayerChoices === true &&
      isPerPlayerOptionalOracleStep(step);
    if (optionalGrantGraveyardDuringResolutionStep) {
      recordSkippedStep(
        step,
        `Skipped optional step (needs player choice): ${(step as any).raw ?? step.kind}`,
        'optional_step_requires_player_choice',
        {
          pending: true,
          classification: 'player_choice',
        }
      );
      continue;
    }
    if (optionalPerPlayerChoiceStep) {
      recordSkippedStep(
        step,
        `Skipped optional step (needs per-player choice): ${(step as any).raw ?? step.kind}`,
        'optional_step_requires_player_choice',
        {
          pending: true,
          classification: 'player_choice',
        }
      );
      continue;
    }
    if (isOptional && !options.allowOptional && !optionalLookLibraryStep && !optionalAnyNumberDiscardStep) {
      if (options.declineOptionalSteps) {
        log.push(`Declined optional step: ${(step as any).raw ?? step.kind}`);
        setLastStepOutcome(step, 'choice_required');
        continue;
      }
      recordSkippedStep(
        step,
        `Skipped optional step (needs player choice): ${(step as any).raw ?? step.kind}`,
        'optional_step_requires_player_choice',
        {
          pending: true,
          classification: 'player_choice',
        }
      );
      pendingContinuationSteps = steps.slice(relativeIndex + 1) as OracleEffectStep[];
      break;
    }

    switch (step.kind) {
      case 'exile_top': {
        const result = applyExileTopStep(nextState, step, currentCtx, {
          lastRevealedCardCount,
          lastDiscardedCardCount,
          lastDiscardedCards,
          lastExiledCardCount,
          lastExiledCards,
          lastMovedCards,
          lastGoadedCreatures,
          lastSacrificedCreaturesPowerTotal,
          lastSacrificedPermanents,
          lastExcessDamageDealtThisWay,
          lastScryLookedAtCount,
          lastTappedMatchingPermanentCount,
          lastReferenceAmount,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          if (Array.isArray(appliedResult.lastExiledCards)) {
            lastExiledCards = [...appliedResult.lastExiledCards];
            currentCtx = { ...currentCtx, lastExiledCards };
          }
        });
        break;
      }
      case 'impulse_exile_top': {
        const result = applyImpulseExileTopStep(nextState, step, currentCtx, {
          lastRevealedCardCount,
          lastDiscardedCardCount,
          lastDiscardedCards,
          lastExiledCardCount,
          lastExiledCards,
          lastMovedCards,
          lastGoadedCreatures,
          lastSacrificedCreaturesPowerTotal,
          lastSacrificedPermanents,
          lastExcessDamageDealtThisWay,
          lastScryLookedAtCount,
          lastTappedMatchingPermanentCount,
          lastReferenceAmount,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          if (Array.isArray(appliedResult.lastExiledCards)) {
            lastExiledCards = [...appliedResult.lastExiledCards];
            currentCtx = { ...currentCtx, lastExiledCards };
          }
        });
        break;
      }
      case 'modify_exile_permissions': {
        const result = applyModifyExilePermissionsStep(nextState, step, { lastExiledCards }, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_exile_permission': {
        const result = applyGrantExilePermissionStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_future_spell_effect': {
        const result = applyGrantFutureSpellEffectStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'goad': {
        const result = applyGoadStep(nextState, step, currentCtx, controllerId);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGoadedCreatures = [...appliedResult.lastGoadedCreatures];
          const goadedIds = lastGoadedCreatures
            .map((perm: any) => String(perm?.id || '').trim())
            .filter(Boolean);
          if (goadedIds.length > 0) {
            currentCtx = {
              ...currentCtx,
              lastGoadedBattlefieldPermanentIds: goadedIds,
            };
          }
        });
        break;
      }
      case 'detain': {
        const result = applyDetainStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'cant_attack': {
        const result = applyCantAttackStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'cant_block': {
        const result = applyCantBlockStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'force_block': {
        const result = applyForceBlockStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'cant_activate_abilities': {
        const result = applyCantActivateAbilitiesStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'exert': {
        const result = applyExertStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'airbend': {
        const result = applyAirbendStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = Array.isArray(appliedResult.lastExiledCards)
            ? [...appliedResult.lastExiledCards]
            : [];
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
          } else if (lastExiledCards.length > 0) {
            lastMovedCards = [...lastExiledCards];
          }
        });
        break;
      }
      case 'earthbend': {
        const result = applyEarthbendStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'animate_permanent': {
        const result = applyAnimatePermanentStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'skip_next_untap': {
        const result = applySkipNextUntapStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'optional_untap_choice': {
        const result = applyOptionalUntapChoiceStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'flip_coin': {
        const players = resolvePlayers(nextState, step.who, currentCtx);
        if (players.length === 0) {
          recordSkippedStep(
            step,
            `Skipped flip coin step (unsupported player selector): ${step.raw}`,
            'unsupported_player_selector',
            {
              classification: 'ambiguous',
            }
          );
          break;
        }

        const call = step.call || 'heads';
        const stateAny: any = nextState as any;
        stateAny.lastCoinFlipByPlayer = stateAny.lastCoinFlipByPlayer || {};
        stateAny.coinFlipsThisTurn = stateAny.coinFlipsThisTurn || {};
        const flipSummaries: string[] = [];
        let lastWon = typeof currentCtx.wonCoinFlip === 'boolean' ? currentCtx.wonCoinFlip : undefined;

        for (const playerId of players) {
          const results: Array<'heads' | 'tails'> = [];
          const wins: boolean[] = [];
          const firstResult =
            typeof lastWon === 'boolean'
              ? lastWon
                ? call
                : call === 'heads'
                  ? 'tails'
                  : 'heads'
              : generateCoinFlipResult();
          results.push(firstResult);
          wins.push(firstResult === call);
          if (step.repeatUntil === 'lose_flip') {
            while (wins[wins.length - 1] && results.length < 100) {
              const nextFlip = generateCoinFlipResult();
              results.push(nextFlip);
              wins.push(nextFlip === call);
            }
          }
          const result = results[results.length - 1];
          const won = wins[wins.length - 1] === true;
          const timestamp = Date.now();
          const flipRecord = {
            playerId,
            call,
            result,
            won,
            timestamp,
            ...(step.repeatUntil === 'lose_flip' ? { repeatUntil: 'lose_flip', results, wins } : {}),
          };
          stateAny.lastCoinFlip = flipRecord;
          stateAny.lastCoinFlipByPlayer[playerId] = flipRecord;
          stateAny.coinFlipsThisTurn[playerId] = Array.isArray(stateAny.coinFlipsThisTurn[playerId])
            ? [...stateAny.coinFlipsThisTurn[playerId], flipRecord]
            : [flipRecord];
          flipSummaries.push(`${playerId} flipped ${results.length} coin(s): ${result}${won ? ' (won)' : ' (lost)'}`);
          lastWon = won;
        }

        nextState = stateAny as GameState;
        currentCtx = { ...currentCtx, wonCoinFlip: lastWon };
        setLastStepOutcome(step, 'applied');
        log.push(`[oracle-ir] ${flipSummaries.join('; ')}`);
        appliedSteps.push(step);
        break;
      }
      case 'roll_die': {
        const players = step.who.kind === 'you' && controllerId ? [controllerId] : [];
        if (players.length !== 1) {
          recordSkippedStep(
            step,
            `Skipped roll die step (unsupported player selector): ${step.raw}`,
            'unsupported_player_selector',
            {
              classification: 'ambiguous',
            }
          );
          break;
        }

        const count = Math.max(1, Math.trunc(Number(step.count ?? 1)) || 1);
        const forcedResult = Number(currentCtx.dieRollResult);
        const rolls =
          count === 1 && Number.isFinite(forcedResult) && forcedResult >= 1 && forcedResult <= step.sides
            ? [{ result: forcedResult }]
            : count === 1
              ? [performDieRoll(players[0], step.sides)]
              : [...performMultipleDieRolls(players[0], step.sides, count)];
        const results = rolls.map(roll => Number((roll as any).result)).filter(result => Number.isFinite(result));
        const total = results.reduce((sum, result) => sum + result, 0);
        const displayedResult = count === 1 ? (results[0] ?? 0) : total;
        const timestamp = Date.now();
        const stateAny: any = nextState as any;
        stateAny.lastDieRoll = {
          playerId: players[0],
          sides: step.sides,
          count,
          result: displayedResult,
          results,
          timestamp,
        };
        stateAny.lastDieRollByPlayer = stateAny.lastDieRollByPlayer || {};
        stateAny.lastDieRollByPlayer[players[0]] = {
          sides: step.sides,
          count,
          result: displayedResult,
          results,
          timestamp,
        };
        stateAny.dieRollsThisTurn = stateAny.dieRollsThisTurn || {};
        const rollRecord = { sides: step.sides, count, result: displayedResult, results, timestamp };
        stateAny.dieRollsThisTurn[players[0]] = Array.isArray(stateAny.dieRollsThisTurn[players[0]])
          ? [...stateAny.dieRollsThisTurn[players[0]], rollRecord]
          : [rollRecord];
        nextState = stateAny as GameState;
        setLastStepOutcome(step, 'applied');
        log.push(
          count === 1
            ? `[oracle-ir] ${players[0]} rolled d${step.sides}: ${displayedResult}`
            : `[oracle-ir] ${players[0]} rolled ${count}d${step.sides}: ${results.join(', ')} (total ${total})`
        );
        appliedSteps.push(step);
        break;
      }
      case 'die_roll_results': {
        const players = step.who.kind === 'you' && controllerId ? [controllerId] : [];
        if (players.length !== 1) {
          recordSkippedStep(
            step,
            `Skipped die-roll result table (unsupported player selector): ${step.raw}`,
            'unsupported_player_selector',
            {
              classification: 'ambiguous',
            }
          );
          break;
        }

        const rolled = getLastDieRollResultForPlayer(nextState, players[0]);
        if (!Number.isFinite(rolled)) {
          recordSkippedStep(
            step,
            `Skipped die-roll result table (no die roll result available): ${step.raw}`,
            'failed_to_apply',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const band = step.results.find(resultBand => rolled >= resultBand.min && rolled <= resultBand.max);
        if (!band) {
          setLastStepOutcome(step, 'applied');
          log.push(`[oracle-ir] No die-roll branch matched result ${rolled}`);
          appliedSteps.push(step);
          break;
        }

        const branchResult = recurse(nextState, band.steps, currentCtx, options);
        nextState = branchResult.state;
        setLastStepOutcome(step, 'applied');
        log.push(`[oracle-ir] Applied die-roll branch ${band.min}-${band.max} for result ${rolled}`);
        log.push(...branchResult.log);
        appliedSteps.push(...branchResult.appliedSteps);
        skippedSteps.push(...branchResult.skippedSteps);
        appliedSteps.push(step);
        automationGaps.push(...branchResult.automationGaps);
        pendingOptionalSteps.push(...branchResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(branchResult);
        break;
      }
      case 'draw': {
        const result = applyDrawStep(nextState, step, currentCtx, {
          lastRevealedCardCount,
          lastDiscardedCardCount,
          lastGreatestDiscardedCardCount,
          lastDiscardedCards,
          lastExiledCardCount,
          lastExiledCards,
          lastMovedCards,
          lastGoadedCreatures,
          lastSacrificedCreaturesPowerTotal,
          lastSacrificedPermanents,
          lastExcessDamageDealtThisWay,
          lastScryLookedAtCount,
          lastTappedMatchingPermanentCount,
          lastReferenceAmount,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          const antecedentIds = Array.isArray(appliedResult.lastAntecedentBattlefieldPermanentIds)
            ? appliedResult.lastAntecedentBattlefieldPermanentIds
                .map((id: unknown) => String(id || '').trim())
                .filter(Boolean)
            : [];
          if (antecedentIds.length > 0) {
            currentCtx = {
              ...currentCtx,
              lastAntecedentBattlefieldPermanentIds: antecedentIds,
            };
          }
        });
        break;
      }
      case 'win_game': {
        if (!controllerId) {
          recordSkippedStep(
            step,
            `Skipped win game (controller unavailable): ${step.raw}`,
            'invalid_controller',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const cantWin = opponentsHaveCantWinEffect(
          controllerId as any,
          (nextState.battlefield || []) as any,
          nextState.players as any,
          ((nextState as any).winLossEffects || []) as any
        );
        if (cantWin.hasCantWin) {
          recordSkippedStep(
            step,
            `Skipped win game (blocked by ${cantWin.source}): ${step.raw}`,
            'impossible_action',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        nextState = {
          ...nextState,
          winner: controllerId,
          status: 'finished' as any,
          winReason: String(step.raw || 'You win the game') as any,
        } as GameState;
        setLastStepOutcome(step, 'applied');
        log.push(`${controllerId} wins the game`);
        appliedSteps.push(step);
        break;
      }
      case 'lose_game': {
        if (!controllerId) {
          recordSkippedStep(
            step,
            `Skipped lose game (controller unavailable): ${step.raw}`,
            'invalid_controller',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const cantLose = playerHasCantLoseEffect(
          controllerId as any,
          (nextState.battlefield || []) as any,
          nextState.players as any,
          ((nextState as any).winLossEffects || []) as any
        );
        if (cantLose.hasCantLose) {
          recordSkippedStep(
            step,
            `Skipped lose game (blocked by ${cantLose.source}): ${step.raw}`,
            'impossible_action',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const nextPlayers = nextState.players.map((player) =>
          player.id === controllerId ? ({ ...player, hasLost: true } as typeof player) : player
        );
        nextState = {
          ...nextState,
          players: nextPlayers,
        } as GameState;

        log.push(`${controllerId} loses the game`);

        const remainingPlayers = nextPlayers.filter(isPlayerStillInGame);
        if (remainingPlayers.length === 1) {
          nextState = {
            ...nextState,
            winner: remainingPlayers[0].id,
            status: 'finished' as any,
            winReason: `${controllerId} lost the game` as any,
          } as GameState;
          log.push(`${remainingPlayers[0].id} wins the game`);
        }

        setLastStepOutcome(step, 'applied');
        appliedSteps.push(step);
        break;
      }
      case 'clash': {
        const result = applyClashStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastClashWon === 'boolean') {
            lastClashWon = appliedResult.lastClashWon;
            currentCtx = { ...currentCtx, lastClashWon };
          }
        });
        break;
      }
      case 'collect_evidence': {
        const result = applyCollectEvidenceStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastCollectedEvidence === 'boolean') {
            lastCollectedEvidence = appliedResult.lastCollectedEvidence;
            currentCtx = { ...currentCtx, lastCollectedEvidence };
          }
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'learn': {
        const result = applyLearnStep(nextState, step, currentCtx, options);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
          lastDiscardedCards = Array.isArray(appliedResult.lastDiscardedCards)
            ? [...appliedResult.lastDiscardedCards]
            : lastDiscardedCards;
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          lastReferenceAmount = lastDiscardedCardCount;
          currentCtx = {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
            referenceAmount: lastReferenceAmount,
          };
        });
        break;
      }
      case 'open_attraction': {
        const result = applyOpenAttractionStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'roll_visit_attractions': {
        const result = applyRollVisitAttractionsStep(nextState, step, currentCtx);
        const applied = applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        if (!applied) break;

        const visitedAttractions = Array.isArray((result as any).lastVisitedAttractions)
          ? (result as any).lastVisitedAttractions
          : [];
        for (const attraction of visitedAttractions) {
          const visitAbilityText = String(
            attraction?.card?.visitAbility || attraction?.visitAbility || attraction?.card?.oracle_text || ''
          ).trim();
          if (!visitAbilityText) continue;

          const visitIr = parseOracleTextToIR(visitAbilityText, String(attraction?.card?.name || attraction?.name || 'Attraction'));
          const visitSteps = visitIr.abilities.flatMap(ability => ability.steps);
          if (visitSteps.length === 0) continue;

          const visitCtx: OracleIRExecutionContext = {
            ...currentCtx,
            sourceId: String(attraction?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
            sourceName: String(attraction?.card?.name || attraction?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
          };
          const visitResult = recurse(nextState, visitSteps, visitCtx, options);
          nextState = visitResult.state;
          log.push(`[oracle-ir] Resolved Attraction visit ability from ${String(attraction?.card?.name || attraction?.name || 'Attraction')}`);
          log.push(...visitResult.log);
          appliedSteps.push(...visitResult.appliedSteps);
          skippedSteps.push(...visitResult.skippedSteps);
          automationGaps.push(...visitResult.automationGaps);
          pendingOptionalSteps.push(...visitResult.pendingOptionalSteps);
          absorbExecutionReplayMutations(visitResult);
        }
        break;
      }
      case 'take_initiative': {
        const result = applyTakeInitiativeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'become_monarch': {
        const result = applyBecomeMonarchStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'venture_into_dungeon': {
        const result = applyVentureIntoDungeonStep(nextState, step, currentCtx);
        const applied = applyHandledStepResult(step, result);
        if (!applied) break;

        const dungeonRoomEffectText = String((result as any).lastDungeonRoomEffectText || '').trim();
        if (!dungeonRoomEffectText) break;

        const dungeonName = String((result as any).lastDungeonName || 'Dungeon').trim() || 'Dungeon';
        const dungeonRoomName = String((result as any).lastDungeonRoomName || 'Room').trim() || 'Room';
        const roomIr = parseOracleTextToIR(dungeonRoomEffectText, `${dungeonName} - ${dungeonRoomName}`);
        const roomSteps = roomIr.abilities.flatMap(ability => ability.steps);
        if (roomSteps.length === 0) break;

        const roomResult = recurse(nextState, roomSteps, currentCtx, options);
        nextState = roomResult.state;
        log.push(`[oracle-ir] Resolved dungeon room ability from ${dungeonName} (${dungeonRoomName})`);
        log.push(...roomResult.log);
        appliedSteps.push(...roomResult.appliedSteps);
        skippedSteps.push(...roomResult.skippedSteps);
        automationGaps.push(...roomResult.automationGaps);
        pendingOptionalSteps.push(...roomResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(roomResult);
        break;
      }
      case 'planeswalk': {
        const result = applyPlaneswalkStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'assemble': {
        const result = applyAssembleStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'regenerate': {
        const result = applyRegenerateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'abandon_scheme': {
        const result = applyAbandonSchemeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'set_in_motion': {
        const result = applySetInMotionStep(nextState, step, currentCtx);
        const applied = applyHandledStepResult(step, result, (appliedResult) => {
          lastSetInMotionScheme = (appliedResult as any).lastSetInMotionScheme ?? lastSetInMotionScheme;
          currentCtx = {
            ...currentCtx,
            lastSetInMotionScheme,
          };
        });
        if (!applied) break;

        const setInMotionScheme = (result as any).lastSetInMotionScheme;
        const schemeOracleText = String(
          setInMotionScheme?.oracle_text || setInMotionScheme?.card?.oracle_text || ''
        ).trim();
        if (!schemeOracleText) break;

        const schemeIr = parseOracleTextToIR(
          schemeOracleText,
          String(setInMotionScheme?.name || setInMotionScheme?.card?.name || currentCtx.sourceName || 'Scheme')
        );
        const triggerSteps = schemeIr.abilities
          .filter(ability => String((ability as any)?.triggerCondition || '').trim().toLowerCase() === 'you set this scheme in motion')
          .flatMap(ability => ability.steps);
        if (triggerSteps.length === 0) break;

        const schemeCtx: OracleIRExecutionContext = {
          ...currentCtx,
          sourceId: String(setInMotionScheme?.id || setInMotionScheme?.card?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
          sourceName: String(setInMotionScheme?.name || setInMotionScheme?.card?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
          lastSetInMotionScheme: setInMotionScheme,
        };
        const schemeResult = recurse(nextState, triggerSteps, schemeCtx, options);
        nextState = schemeResult.state;
        log.push(`[oracle-ir] Replayed set-in-motion trigger for ${String(setInMotionScheme?.name || setInMotionScheme?.card?.name || 'Scheme')}`);
        log.push(...schemeResult.log);
        appliedSteps.push(...schemeResult.appliedSteps);
        skippedSteps.push(...schemeResult.skippedSteps);
        automationGaps.push(...schemeResult.automationGaps);
        pendingOptionalSteps.push(...schemeResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(schemeResult);
        break;
      }
      case 'search_library': {
        const result = applySearchLibraryStep(nextState, step, currentCtx);
        if (applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        })) {
          currentCtx = { ...currentCtx, searchedLibraryThisWay: true };
        } else {
          currentCtx = { ...currentCtx, searchedLibraryThisWay: false };
        }
        break;
      }
      case 'exile_named_cards_from_zones': {
        const result = applyExileNamedCardsFromZonesStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastExiledCards) && appliedResult.lastExiledCards.length > 0) {
            lastExiledCards = [...appliedResult.lastExiledCards];
            currentCtx = { ...currentCtx, lastExiledCards };
          }
        });
        break;
      }
      case 'shuffle_library': {
        const result = applyShuffleLibraryStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'prevent_library_search': {
        log.push(`[oracle-ir] Search prevention noted: ${step.raw}`);
        appliedSteps.push(step);
        break;
      }
      case 'skip_next_draw_step': {
        const result = applySkipNextDrawStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'skip_next_turn': {
        const result = applySkipNextTurnStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'end_turn': {
        const result = applyEndTurnStep(nextState, step);
        applyHandledStepResult(step, result);
        break;
      }
      case 'gain_control': {
        const result = applyGainControlStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, () => {
          const referencedPermanentId = String(
            currentCtx.targetPermanentId ||
              currentCtx.targetCreatureId ||
              currentCtx.selectorContext?.targetPermanentId ||
              currentCtx.selectorContext?.targetCreatureId ||
              ''
          ).trim();
          if (referencedPermanentId) {
            currentCtx = { ...currentCtx, lastReferencedPermanentId: referencedPermanentId };
          }
        });
        break;
      }
      case 'exchange_control': {
        const result = applyExchangeControlStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'take_extra_turn': {
        const result = applyTakeExtraTurn(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_extra_combat': {
        const result = applyAddExtraCombat(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'change_target': {
        const result = applyChangeTargetStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_graveyard_permission': {
        const result = applyGrantGraveyardPermissionStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGrantedGraveyardCards = Array.isArray(appliedResult.lastGrantedGraveyardCards)
            ? [...appliedResult.lastGrantedGraveyardCards]
            : [];
          lastGrantedGraveyardPermissionIds = Array.isArray(appliedResult.lastGrantedGraveyardPermissionIds)
            ? [...appliedResult.lastGrantedGraveyardPermissionIds]
            : [];
        });
        break;
      }
      case 'grant_graveyard_keyword_ability': {
        const result = applyGrantGraveyardKeywordAbilityStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'modify_graveyard_permissions': {
        const result = applyModifyGraveyardPermissionsStep(nextState, step, {
          lastGrantedGraveyardCards,
          lastGrantedGraveyardPermissionIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'modify_token_creation': {
        const result = applyModifyTokenCreationStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_static_ability': {
        const result = applyGrantStaticAbilityStep(nextState, step, currentCtx);
        if (applyHandledStepResult(step, result)) {
          if (/\bsearch\b[\s\S]*\blibrary\b|\blibrary\b[\s\S]*\bsearch\b/i.test(String(step.raw || ''))) {
            currentCtx = { ...currentCtx, searchedLibraryThisWay: true };
          }
        }
        break;
      }
      case 'add_mana': {
        const result = applyAddManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'shuffle_zones_into_library': {
        const result = applyShuffleZonesIntoLibraryStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_pile': {
        const result = applyChoosePileStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'put_sticker': {
        const result = applyPutStickerStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'become_aura': {
        const result = applyBecomeAuraStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'assign_no_combat_damage': {
        const result = applyAssignNoCombatDamageStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'retain_mana': {
        const result = applyRetainManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'pay_mana': {
        const result = applyPayManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_opponent': {
        const explicitOpponentId = (
          String(currentCtx.selectorContext?.targetOpponentId || '').trim() ||
          String(currentCtx.selectorContext?.targetPlayerId || '').trim()
        ) as PlayerID;
        const validExplicitOpponent = Boolean(
          explicitOpponentId &&
          (nextState.players || []).some(
            (p: any) => String(p?.id || '').trim() === explicitOpponentId && String(p?.id || '').trim() !== controllerId
          )
        );
        const opponentIds = (nextState.players || [])
          .map((p: any) => String(p?.id || '').trim())
          .filter((id: string) => Boolean(id) && id !== controllerId) as PlayerID[];
        const chosenOpponentId = (validExplicitOpponent
          ? explicitOpponentId
          : opponentIds.length === 1
            ? opponentIds[0]
            : '') as PlayerID | '';

        if (!chosenOpponentId) {
          recordSkippedStep(
            step,
            `Skipped choose opponent (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
              metadata: {
                opponentCount: opponentIds.length,
              },
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          ...(/promise an opponent a gift/i.test(String(step.raw || '')) ? { giftPromised: true } : {}),
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            targetOpponentId: chosenOpponentId,
            targetPlayerId: chosenOpponentId,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose opponent ${chosenOpponentId}`);
        appliedSteps.push(step);
        break;
      }
      case 'choose_color': {
        const allowedOptions = (Array.isArray(step.manaOptions) && step.manaOptions.length > 0
          ? step.manaOptions
          : ['{W}', '{U}', '{B}', '{R}', '{G}']
        ).map(option => String(option || '').trim()).filter(Boolean);
        const rawChosenMana = String(currentCtx.selectorContext?.chosenMana || '').trim();
        const normalizedChosenMana = (() => {
          const upper = rawChosenMana.toUpperCase();
          if (!upper) return '';
          const symbol = upper.startsWith('{') && upper.endsWith('}') ? upper : `{${upper}}`;
          return /^{[WUBRG]}$/i.test(symbol) ? symbol.toUpperCase() : '';
        })();

        if (!normalizedChosenMana) {
          recordSkippedStep(
            step,
            `Skipped choose color (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
              metadata: {
                optionCount: allowedOptions.length,
              },
            }
          );
          break;
        }

        if (!allowedOptions.some(option => option.toUpperCase() === normalizedChosenMana.toUpperCase())) {
          recordSkippedStep(
            step,
            `Skipped choose color (invalid chosen color): ${step.raw}`,
            'invalid_input',
            {
              classification: 'invalid_input',
              metadata: {
                chosenMana: normalizedChosenMana,
                options: allowedOptions,
              },
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            chosenMana: normalizedChosenMana,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose color ${normalizedChosenMana}`);
        appliedSteps.push(step);
        break;
      }
      case 'choose_creature_type': {
        const chosenCreatureType = String(currentCtx.selectorContext?.chosenCreatureType || '').trim();
        if (!chosenCreatureType) {
          recordSkippedStep(
            step,
            `Skipped choose creature type (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            chosenCreatureType,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose creature type ${chosenCreatureType}`);
        appliedSteps.push(step);
        break;
      }
      case 'choose_basic_land_type': {
        const chosenBasicLandType = String(currentCtx.selectorContext?.chosenBasicLandType || '').trim();
        const allowedBasicLandTypes = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
        const normalizedBasicLandType = allowedBasicLandTypes.find(
          landType => landType.toLowerCase() === chosenBasicLandType.toLowerCase()
        );
        if (!normalizedBasicLandType) {
          recordSkippedStep(
            step,
            `Skipped choose basic land type (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            chosenBasicLandType: normalizedBasicLandType,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose basic land type ${normalizedBasicLandType}`);
        appliedSteps.push(step);
        break;
      }
      case 'choose_card_name': {
        const chosenCardName = String(currentCtx.selectorContext?.chosenCardName || '').trim();
        if (!chosenCardName) {
          recordSkippedStep(
            step,
            `Skipped choose card name (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            chosenCardName,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose card name ${chosenCardName}`);
        appliedSteps.push(step);
        break;
      }
      case 'player_choice': {
        if (step.choice === 'letter') {
          const chosenLetter = String(currentCtx.selectorContext?.chosenLetter || '').trim();
          if (!chosenLetter) {
            recordSkippedStep(
              step,
              `Skipped player choice (${step.choice}): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  choice: step.choice,
                  options: Array.isArray(step.options) ? [...step.options] : undefined,
                },
              }
            );
            break;
          }

          currentCtx = {
            ...currentCtx,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenLetter: chosenLetter.slice(0, 1),
            },
          };
          setLastStepOutcome(step, 'applied');
          log.push(`Chose letter ${chosenLetter.slice(0, 1).toUpperCase()}`);
          appliedSteps.push(step);
          break;
        }

        if (step.choice === 'odd_even') {
          const chosenOddEven = String(currentCtx.selectorContext?.chosenOddEven || '').trim().toLowerCase();
          if (chosenOddEven !== 'odd' && chosenOddEven !== 'even') {
            recordSkippedStep(
              step,
              `Skipped player choice (${step.choice}): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  choice: step.choice,
                  options: Array.isArray(step.options) ? [...step.options] : undefined,
                },
              }
            );
            break;
          }

          currentCtx = {
            ...currentCtx,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenOddEven: chosenOddEven as 'odd' | 'even',
            },
          };
          setLastStepOutcome(step, 'applied');
          log.push(`Chose ${chosenOddEven}`);
          appliedSteps.push(step);
          break;
        }

        {
          const isKeywordCounterFromAmongChoice =
            step.choice === 'generic'
            && /counter from among/i.test(String(step.raw || ''))
            && Array.isArray(step.options)
            && step.options.length > 0;
          if (isKeywordCounterFromAmongChoice) {
            recordSkippedStep(
              step,
              `Skipped player choice (${step.choice}): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  choice: step.choice,
                  options: Array.isArray(step.options) ? [...step.options] : undefined,
                },
              },
            );
            break;
          }

          const chosenObjectIds = Array.isArray(currentCtx.selectorContext?.chosenObjectIds)
            ? currentCtx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
            : [];
          const normalizedChoiceRaw = String(step.raw || '')
            .replace(/\u2019/g, "'")
            .trim()
            .toLowerCase();
          const amongThemChoice = /\bfrom among them\b/.test(normalizedChoiceRaw);
          const contextualCardIds = amongThemChoice
            ? new Set(
                (resolveAntecedentContextualCards(currentCtx) as any[])
                  .map((card) => String(card?.id || '').trim())
                  .filter(Boolean),
              )
            : null;
          const validAmongThemChoice =
            !amongThemChoice
            || (
              chosenObjectIds.length > 0
              && chosenObjectIds.every((id) => contextualCardIds?.has(id))
            );
          const exactCountMatch = normalizedChoiceRaw.match(
            /^choose exactly (two|three|four|five|\d+) (?:target )?(?:creatures|creature cards|cards|permanents)(?: you control)?$/
          );
          const requiredCount = exactCountMatch
            ? ({ two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[String(exactCountMatch[1] || '').toLowerCase()] ??
              Number(exactCountMatch[1])
            : null;
          if (
            validAmongThemChoice &&
            chosenObjectIds.length > 0 &&
            (requiredCount === null || chosenObjectIds.length >= requiredCount)
          ) {
            const boundIds =
              requiredCount === null ? chosenObjectIds : chosenObjectIds.slice(0, Math.max(0, requiredCount));
            currentCtx = {
              ...currentCtx,
              selectorContext: {
                ...(currentCtx.selectorContext || {}),
                chosenObjectIds: boundIds,
              },
            };
            setLastStepOutcome(step, 'applied');
            log.push(`Chose ${boundIds.length} object(s) for player choice: ${step.raw}`);
            appliedSteps.push(step);
            break;
          }
        }

        recordSkippedStep(
          step,
          `Skipped player choice (${step.choice}): ${step.raw}`,
          'player_choice_required',
          {
            classification: 'player_choice',
            metadata: {
              choice: step.choice,
              options: Array.isArray(step.options) ? [...step.options] : undefined,
            },
          }
        );
        break;
      }
      case 'choose_target_creature': {
        const chosenTargetId = String(resolveSingleCreatureTargetId(nextState, step.target, currentCtx) || '').trim();
        if (!chosenTargetId) {
          recordSkippedStep(
            step,
            `Skipped choose target creature (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          targetCreatureId: chosenTargetId,
          targetPermanentId: chosenTargetId,
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose target creature ${chosenTargetId}`);
        appliedSteps.push(step);
        break;
      }
      case 'create_emblem': {
        const result = applyCreateEmblemStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'proliferate': {
        const result = applyProliferateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'redistribute_life_totals': {
        const result = applyRedistributeLifeTotalsStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'investigate': {
        const result = applyInvestigateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'blight': {
        const result = applyBlightStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'populate': {
        const result = applyPopulateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'paradigm': {
        setLastStepOutcome(step, 'applied');
        log.push(`Registered paradigm: ${step.raw}`);
        appliedSteps.push(step);
        break;
      }
      case 'ring_tempts_you': {
        const result = applyRingTemptsYouStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'time_travel': {
        const result = applyTimeTravelStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'suspect': {
        const result = applySuspectStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'become_renowned': {
        const result = applyBecomeRenownedStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'gain_class_level': {
        const result = applyGainClassLevelStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'monstrosity': {
        const result = applyMonstrosityStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'turn_face_up': {
        const result = applyTurnFaceUpStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'turn_face_down': {
        const result = applyTurnFaceDownStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
          lastDiscardedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'copy_permanent': {
        const result = applyCopyPermanentStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'scry': {
        const result = applyScryStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastScryLookedAtCount = Math.max(0, Number(appliedResult.lastScryLookedAtCount) || 0);
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
      case 'surveil': {
        const result = applySurveilStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
      case 'fateseal': {
        const result = applyFatesealStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'vote': {
        const result = applyVoteStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'look_top': {
        const result = applyLookTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (appliedResult.lastTopLibraryOwnerId) {
            currentCtx = { ...currentCtx, lastTopLibraryOwnerId: appliedResult.lastTopLibraryOwnerId };
          }
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
      case 'reveal_top': {
        const result = applyRevealTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastRevealedCardCount === 'number') {
            lastRevealedCardCount = Math.max(0, Number(appliedResult.lastRevealedCardCount) || 0);
          }
          if (appliedResult.lastTopLibraryOwnerId) {
            currentCtx = { ...currentCtx, lastTopLibraryOwnerId: appliedResult.lastTopLibraryOwnerId };
          }
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
          if (Array.isArray((appliedResult as any).lastRevealedCards) && (appliedResult as any).lastRevealedCards.length > 0) {
            currentCtx = {
              ...currentCtx,
              lastRevealedCards: [...(appliedResult as any).lastRevealedCards],
            };
          } else if (lastRevealedCardCount > 0 && Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            currentCtx = {
              ...currentCtx,
              lastRevealedCards: [...appliedResult.lastMovedCards],
            };
          }
        });
        break;
      }
      case 'look_select_top': {
        const result = applyLookSelectTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards)) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
      case 'look_choose_from_top': {
        const result = applyLookChooseFromTopStep(nextState, step, currentCtx, {
          lastRevealedCardCount,
          lastDiscardedCardCount,
          lastDiscardedCards,
          lastExiledCardCount,
          lastExiledCards,
          lastMovedCards,
          lastGoadedCreatures,
          lastSacrificedCreaturesPowerTotal,
          lastSacrificedPermanents,
          lastExcessDamageDealtThisWay,
          lastScryLookedAtCount,
          lastTappedMatchingPermanentCount,
          lastReferenceAmount,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'explore': {
        const result = applyExploreStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'manifest_dread': {
        const result = applyManifestDreadStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards) ? [...appliedResult.lastMovedCards] : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'connive': {
        const result = applyConniveStep(nextState, step, currentCtx, {
          lastRevealedCardCount,
          lastDiscardedCardCount,
          lastDiscardedCards,
          lastExiledCardCount,
          lastExiledCards,
          lastMovedCards,
          lastGoadedCreatures,
          lastSacrificedCreaturesPowerTotal,
          lastSacrificedPermanents,
          lastExcessDamageDealtThisWay,
          lastScryLookedAtCount,
          lastTappedMatchingPermanentCount,
          lastReferenceAmount,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
          lastDiscardedCards = Array.isArray(appliedResult.lastDiscardedCards)
            ? [...appliedResult.lastDiscardedCards]
            : [];
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          lastReferenceAmount = lastDiscardedCardCount;
          currentCtx = {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
            referenceAmount: lastReferenceAmount,
          };
        });
        break;
      }
      case 'put_on_bottom': {
        const result = applyPutOnBottomStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'mill': {
        const result = applyMillStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastRevealedCardCount === 'number') {
            lastRevealedCardCount = Math.max(0, Number(appliedResult.lastRevealedCardCount) || 0);
          }
          if (Array.isArray(appliedResult.lastMilledCards) && appliedResult.lastMilledCards.length > 0) {
            currentCtx = { ...currentCtx, lastMilledCards: [...appliedResult.lastMilledCards] };
          }
        });
        break;
      }
      case 'modify_pt': {
        const result = applyModifyPtStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
          },
          (s, cid, whereRaw, targetId, stepCtx, stepRuntime) =>
            evaluateModifyPtWhereX(s, cid, whereRaw, targetId, stepCtx, stepRuntime, 0, step),
          (state, actingControllerId, conditionRaw) => {
            const fromModifyPt = evaluateModifyPtCondition(state, actingControllerId, conditionRaw);
            if (fromModifyPt !== null) return fromModifyPt;
            return evaluateConditionalWrapperCondition({
              condition: { kind: 'if', raw: conditionRaw },
              nextState: state,
              controllerId: actingControllerId,
              ctx: currentCtx,
              lastActionOutcome,
              lastStepOutcome,
              lastConditionalEvaluation,
              lastMovedCards,
              lastDiscardedCards,
              lastCreatedTokenIds,
              lastExcessDamageDealtThisWay,
            });
          }
        );
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'set_base_pt': {
        const result = applySetBasePtStep(nextState, step, currentCtx);
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'switch_power_toughness': {
        const result = applySwitchPowerToughnessStep(nextState, step, currentCtx);
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'modify_pt_per_revealed': {
        const result = applyModifyPtPerRevealedStep(nextState, step, currentCtx, lastRevealedCardCount);
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'discard': {
        const result = applyDiscardStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
          lastGreatestDiscardedCardCount = Math.max(
            0,
            Number(appliedResult.lastGreatestDiscardedCardCount ?? appliedResult.lastDiscardedCardCount) || 0,
          );
          lastDiscardedCards = Array.isArray(appliedResult.lastDiscardedCards)
            ? [...appliedResult.lastDiscardedCards]
            : [];
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          lastReferenceAmount = lastDiscardedCardCount;
          currentCtx = {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
            referenceAmount: lastReferenceAmount,
            lastGreatestDiscardedCardCount,
          };
        });
        break;
      }
      case 'reveal_hand': {
        const result = applyRevealHandStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastRevealedCardCount === 'number') {
            lastRevealedCardCount = Math.max(0, Number(appliedResult.lastRevealedCardCount) || 0);
          }
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
          const revealedPlayers = resolvePlayers(nextState, step.who, currentCtx);
          if (revealedPlayers.length === 1) {
            currentCtx = {
              ...currentCtx,
              selectorContext: {
                ...(currentCtx.selectorContext || {}),
                targetPlayerId: revealedPlayers[0],
                ...(step.who.kind === 'target_opponent'
                  ? { targetOpponentId: revealedPlayers[0] }
                  : {}),
              },
            };
          }
        });
        break;
      }
      case 'look_hand': {
        const result = applyLookHandStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'register_lose_game_replacement': {
        const result = applyRegisterLoseGameReplacementStep(nextState, step, currentCtx, controllerId);
        applyHandledStepResult(step, result);
        break;
      }
      case 'gain_life': {
        const result = applyGainLifeStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
            lastReferenceAmount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'lose_life': {
        const result = applyLoseLifeStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
            lastReferenceAmount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_player_counter': {
        const result = applyAddPlayerCounterStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'double_player_counters': {
        const result = applyDoublePlayerCountersStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'deal_damage': {
        const result = applyDealDamageStep(nextState, step, currentCtx, {
          lastMovedCards,
          lastDiscardedCards,
          lastExiledCards,
          lastSacrificedPermanents,
          lastTappedMatchingPermanentCount,
          lastReferenceAmount,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExcessDamageDealtThisWay = Math.max(0, Number(appliedResult.excessDamageDealtThisWay) || 0);
        });
        break;
      }
      case 'prevent_damage': {
        const result = applyPreventDamageStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'damage_cant_be_prevented': {
        const result = applyDamageCantBePreventedStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'tap_or_untap': {
        const result = applyTapOrUntapStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastTappedMatchingPermanentCount === 'number') {
            lastTappedMatchingPermanentCount = Math.max(0, appliedResult.lastTappedMatchingPermanentCount);
          }
          const tappedIds = Array.isArray(appliedResult.lastTappedMatchingPermanentIds)
            ? appliedResult.lastTappedMatchingPermanentIds
                .map((id: unknown) => String(id || '').trim())
                .filter(Boolean)
            : [];
          if (tappedIds.length > 0) {
            currentCtx = {
              ...currentCtx,
              selectorContext: {
                ...(currentCtx.selectorContext || {}),
                chosenObjectIds: tappedIds,
              },
            };
          }
        });
        break;
      }
      case 'phase_out': {
        const result = applyPhaseOutStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'tap_matching_permanents': {
        const result = applyTapMatchingPermanentsStep(nextState, step, currentCtx);
        if ('message' in result) {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        nextState = result.state;
        lastTappedMatchingPermanentCount = Math.max(0, Number(result.lastTappedMatchingPermanentCount) || 0);
        const tappedIds = Array.isArray(result.lastTappedMatchingPermanentIds)
          ? result.lastTappedMatchingPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
          : [];
        setLastStepOutcome(step, 'applied', { count: lastTappedMatchingPermanentCount });
        if (tappedIds.length > 0) {
          currentCtx = {
            ...currentCtx,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenObjectIds: Array.from(
                new Set([
                  ...(Array.isArray(currentCtx.selectorContext?.chosenObjectIds)
                    ? currentCtx.selectorContext.chosenObjectIds
                    : []),
                  ...tappedIds,
                ])
              ),
            },
          };
        }
        log.push(...result.log);
        appliedSteps.push(step);
        break;
      }
      case 'remove_counter': {
        const result = applyRemoveCounterStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'move_counters': {
        const result = applyMoveCountersStep(nextState, step, currentCtx, {
          lastSacrificedPermanents,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_counter': {
        const result = applyAddCounterStep(nextState, step, currentCtx, {
          lastCreatedTokenIds,
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
          lastDiscardedCards,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards) ? [...appliedResult.lastMovedCards] : lastMovedCards;
          lastMovedBattlefieldPermanentIds = Array.isArray(appliedResult.lastMovedBattlefieldPermanentIds)
            ? [...appliedResult.lastMovedBattlefieldPermanentIds]
            : lastMovedBattlefieldPermanentIds;
          const referencedPermanentId = lastMovedBattlefieldPermanentIds.length > 0
            ? String(lastMovedBattlefieldPermanentIds[lastMovedBattlefieldPermanentIds.length - 1] || '').trim()
            : '';
          currentCtx = {
            ...currentCtx,
            lastMovedCards,
            lastMovedBattlefieldPermanentIds,
            ...(referencedPermanentId ? { lastReferencedPermanentId: referencedPermanentId } : {}),
          };
        });
        break;
      }
      case 'add_types': {
        const result = applyAddTypesStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'set_basic_land_type': {
        const result = applySetBasicLandTypeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'double_counters': {
        const result = applyDoubleCountersStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'move_zone': {
        const result = applyMoveZoneStep(nextState, step, currentCtx, {
          lastMovedCards,
          lastExiledCards,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            if (step.to === 'exile' || /\bexile\b/i.test(String(step.toRaw || ''))) {
              lastExiledCards = [...appliedResult.lastMovedCards];
              lastExiledCardCount = appliedResult.lastMovedCards.length;
            }
          }
          if (typeof appliedResult.lastReferenceAmount === 'number' && Number.isFinite(appliedResult.lastReferenceAmount)) {
            lastReferenceAmount = Math.max(0, Number(appliedResult.lastReferenceAmount) || 0);
          }
          if (appliedResult.lastMovedCountByPlayer) {
            lastMovedCountByPlayer = { ...appliedResult.lastMovedCountByPlayer };
          }
          lastMovedBattlefieldPermanentIds = Array.isArray(appliedResult.lastMovedBattlefieldPermanentIds)
            ? [...appliedResult.lastMovedBattlefieldPermanentIds]
            : [];
          currentCtx = {
            ...currentCtx,
            lastMovedCards,
            ...(lastExiledCards.length > 0 ? { lastExiledCards } : {}),
            lastMovedBattlefieldPermanentIds,
            ...(typeof lastReferenceAmount === 'number' && Number.isFinite(lastReferenceAmount)
              ? { referenceAmount: lastReferenceAmount }
              : {}),
            ...(lastMovedCountByPlayer ? { lastMovedCountByPlayer } : {}),
          };
        });
        break;
      }
      case 'attach': {
        const result = applyAttachStep(nextState, step, currentCtx, lastMovedBattlefieldPermanentIds);
        applyHandledStepResult(step, result);
        break;
      }
      case 'create_token': {
        const result = applyCreateTokenStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
          lastReferenceAmount,
          lastSacrificedPermanents,
          lastCreatedTokenIds,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastCreatedTokenIds = Array.isArray(appliedResult.createdTokenIds)
            ? appliedResult.createdTokenIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
            : [];
          if (lastCreatedTokenIds.length <= 0) return;
          lastMovedBattlefieldPermanentIds = [...lastCreatedTokenIds];
          currentCtx = {
            ...currentCtx,
            lastMovedBattlefieldPermanentIds,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenObjectIds: Array.from(
                new Set([
                  ...((currentCtx.selectorContext?.chosenObjectIds || []) as readonly string[]),
                  ...lastCreatedTokenIds,
                ].map((id: unknown) => String(id || '').trim()).filter(Boolean))
              ),
            },
          };
        });
        break;
      }
      case 'grant_temporary_dies_trigger': {
        const result = applyGrantTemporaryDiesTriggerStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_temporary_ability': {
        const result = applyGrantTemporaryAbilityStep(nextState, step, currentCtx, {
          lastCreatedTokenIds,
          lastMovedBattlefieldPermanentIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_leave_battlefield_replacement': {
        const result = applyGrantLeaveBattlefieldReplacementStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'copy_chapter_ability': {
        if (lastMovedCards.length !== 1) {
          recordSkippedStep(
            step,
            `Skipped copied chapter ability (no moved Saga card available): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const movedCard = lastMovedCards[0] as any;
        const replayableSteps = getCopiedChapterAbilityReplaySteps(movedCard, step.chapter);
        if (replayableSteps.length === 0) {
          recordSkippedStep(
            step,
            `Skipped copied chapter ability (no deterministic chapter steps): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const replayCtx: OracleIRExecutionContext = {
          ...currentCtx,
          sourceId: String(movedCard?.id || movedCard?.card?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
          sourceName: String(movedCard?.name || movedCard?.card?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
          castFromZone: undefined,
          enteredFromZone: undefined,
        };

        const replayResult = recurse(nextState, replayableSteps, replayCtx, options);
        nextState = replayResult.state;
        setLastStepOutcome(step, 'applied');
        log.push(
          `[oracle-ir] Replayed copied chapter ${step.chapter} ability from ${String(movedCard?.name || movedCard?.card?.name || 'copied Saga')}`
        );
        log.push(...replayResult.log);
        appliedSteps.push(...replayResult.appliedSteps);
        skippedSteps.push(...replayResult.skippedSteps);
        appliedSteps.push(step);
        automationGaps.push(...replayResult.automationGaps);
        pendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(replayResult);
        break;
      }
      case 'copy_spell': {
        if (shouldDeferStackSpellCopyToServer(currentCtx, step)) {
          const copyCount = Math.max(0, resolveCopySpellCount(nextState, controllerId, step, currentCtx));
          if (copyCount <= 0) {
            setLastStepOutcome(step, 'applied', { count: 0 });
            appliedSteps.push(step);
            log.push(`[oracle-ir] Copy spell produced 0 copies: ${step.raw}`);
            break;
          }

          const deferMessage = `Deferred ${copyCount} stack spell cop${copyCount === 1 ? 'y' : 'ies'} to server: ${step.raw}`;
          const gap = createOracleAutomationGapRecord({
            state: nextState,
            ctx: currentCtx,
            step,
            reasonCode: 'server_stack_copy_required',
            message: deferMessage,
            sequence: ++automationGapSequence,
            classification: 'ambiguous',
            metadata: { copyCount },
          });
          localAutomationGaps.push(gap);
          automationGaps.push(gap);
          appliedSteps.push(step);
          setLastStepOutcome(step, 'applied', { count: copyCount });
          log.push(`[oracle-ir] ${deferMessage}`);
          break;
        }

        if (step.subject === 'this_spell') {
          const replayableSteps = resolveThisSpellCopyReplaySteps({
            steps,
            stepIndex,
            state: nextState,
            ctx: currentCtx,
          });
          if (replayableSteps.length === 0) {
            const copyCount = resolveCopySpellCount(nextState, controllerId, step, currentCtx);
            setLastStepOutcome(step, 'applied', { count: Math.max(1, copyCount) });
            appliedSteps.push(step);
            log.push(`[oracle-ir] Copied spell (implicit resolution): ${step.raw}`);
            break;
          }

          const preparedCopy = prepareCopiedSpellExecutionContext({
            state: nextState,
            replaySteps: replayableSteps,
            ctx: currentCtx,
          });
          if (preparedCopy.requiresChoice) {
            recordSkippedStep(
              step,
              `Skipped copied spell retargeting (requires player choice): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  candidateCount: Number(preparedCopy.candidateCount || 0),
                },
              }
            );
            break;
          }

          const copyCount = resolveCopySpellCount(nextState, controllerId, step, currentCtx);
          if (copyCount <= 0) {
            setLastStepOutcome(step, 'applied', { count: 0 });
            appliedSteps.push(step);
            log.push(`[oracle-ir] Copy spell produced 0 copies: ${step.raw}`);
            break;
          }

          let workingState = nextState;
          for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
            const replayResult = recurse(workingState, replayableSteps, preparedCopy.ctx, options);
            workingState = replayResult.state;
            log.push(...preparedCopy.log);
            log.push(...replayResult.log);
            automationGaps.push(...replayResult.automationGaps);
            pendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
            absorbExecutionReplayMutations(replayResult);
          }

          nextState = workingState;
          setLastStepOutcome(step, 'applied', { count: copyCount });
          appliedSteps.push(step);
          break;
        }

        if (step.subject === 'target_spell') {
          const targetResolution = resolveCopiedTargetSpellStackItem({
            state: nextState,
            step,
            ctx: currentCtx,
          });
          if (!targetResolution.stackItem) {
            recordSkippedStep(
              step,
              targetResolution.reason === 'player_choice_required'
                ? `Skipped copy spell step (requires stack target choice): ${step.raw}`
                : `Skipped copy spell step (target spell unavailable): ${step.raw}`,
              targetResolution.reason === 'player_choice_required' ? 'player_choice_required' : 'invalid_copy_spell_source',
              {
                classification: targetResolution.reason === 'player_choice_required' ? 'player_choice' : 'invalid_input',
                ...(targetResolution.metadata ? { metadata: targetResolution.metadata as Record<string, string | number | boolean | readonly string[]> } : {}),
                ...(targetResolution.reason === 'invalid_source' ? { persist: false } : {}),
              }
            );
            break;
          }

          const replayableSteps = getCopiedStackObjectReplaySteps(targetResolution.stackItem, step);
          if (replayableSteps.length === 0) {
            recordSkippedStep(
              step,
              `Skipped copy spell step (no deterministic copied spell steps): ${step.raw}`,
              'invalid_copy_spell_source',
              {
                classification: 'invalid_input',
              }
            );
            break;
          }

          const copiedCtx = bindCopiedStackSpellTargetsToContext({
            state: nextState,
            stackItem: targetResolution.stackItem,
            ctx: currentCtx,
          });
          const preparedCopy = prepareCopiedSpellExecutionContext({
            state: nextState,
            replaySteps: replayableSteps,
            ctx: copiedCtx,
          });
          if (preparedCopy.requiresChoice) {
            recordSkippedStep(
              step,
              `Skipped copied spell retargeting (requires player choice): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  candidateCount: Number(preparedCopy.candidateCount || 0),
                },
              }
            );
            break;
          }

          const copyCount = resolveCopySpellCount(nextState, controllerId, step, currentCtx);
          if (copyCount <= 0) {
            setLastStepOutcome(step, 'applied', { count: 0 });
            appliedSteps.push(step);
            log.push(`[oracle-ir] Copy spell produced 0 copies: ${step.raw}`);
            break;
          }

          let workingState = nextState;
          for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
            const replayResult = recurse(workingState, replayableSteps, preparedCopy.ctx, options);
            workingState = replayResult.state;
            log.push(...preparedCopy.log);
            log.push(...replayResult.log);
            automationGaps.push(...replayResult.automationGaps);
            pendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
            absorbExecutionReplayMutations(replayResult);
          }

          nextState = workingState;
          setLastStepOutcome(step, 'applied', { count: copyCount });
          appliedSteps.push(step);
          break;
        }

        const sourceResolution = resolveCopiedSpellSourceCards({
          state: nextState,
          step,
          ctx: currentCtx,
          lastMovedCards,
        });
        if (!sourceResolution.cards || sourceResolution.cards.length === 0) {
          recordSkippedStep(
            step,
            `Skipped copy spell step (copied source unavailable): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        let workingState = nextState;
        const combinedLog: string[] = [];
        const combinedGaps: OracleAutomationGap[] = [];
        const combinedPendingOptionalSteps: OracleEffectStep[] = [];
        let appliedCopyCount = 0;

        for (const copiedCard of sourceResolution.cards) {
          const replayableSteps = getCopiedSpellReplaySteps(copiedCard);
          if (replayableSteps.length === 0) {
            recordSkippedStep(
              step,
              `Skipped copy spell step (no deterministic copied spell steps): ${step.raw}`,
              'invalid_copy_spell_source',
              {
                classification: 'invalid_input',
              }
            );
            continue;
          }

          const payment = payCopiedSpellCastCost({
            state: workingState,
            controllerId,
            card: copiedCard,
            step,
          });
          if (payment.reason) {
            recordSkippedStep(
              step,
              payment.reason === 'cannot_pay'
                ? `Skipped copy spell step (cannot pay copied spell cost): ${step.raw}`
                : `Skipped copy spell step (unsupported copied spell cost): ${step.raw}`,
              payment.reason === 'cannot_pay' ? 'failed_to_apply' : 'invalid_copy_spell_source',
              {
                classification: payment.reason === 'cannot_pay' ? 'invalid_input' : 'ambiguous',
                persist: false,
              }
            );
            continue;
          }

          workingState = payment.state;
          combinedLog.push(...payment.log);

          const replayCtx: OracleIRExecutionContext = {
            ...currentCtx,
            sourceId: String(copiedCard?.id || copiedCard?.card?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
            sourceName: String(copiedCard?.name || copiedCard?.card?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
            castFromZone: undefined,
            enteredFromZone: undefined,
            copyReplaySteps: replayableSteps,
          };

          const replayResult = recurse(
            workingState,
            replayableSteps,
            replayCtx,
            {
              ...options,
              allowOptional: step.optional ? options.allowOptional : true,
            }
          );
          workingState = replayResult.state;
          combinedLog.push(`[oracle-ir] Replayed copied spell from ${String(copiedCard?.name || copiedCard?.card?.name || 'copied card')}`);
          combinedLog.push(...replayResult.log);
          combinedGaps.push(...replayResult.automationGaps);
          combinedPendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
          absorbExecutionReplayMutations(replayResult);
          appliedCopyCount += 1;
        }

        if (appliedCopyCount === 0) break;

        nextState = workingState;
        setLastStepOutcome(step, 'applied');
        log.push(...combinedLog);
        appliedSteps.push(step);
        automationGaps.push(...combinedGaps);
        pendingOptionalSteps.push(...combinedPendingOptionalSteps);
        break;
      }
      case 'schedule_delayed_trigger': {
        const result = applyScheduleDelayedTriggerStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'destroy': {
        const result = applyDestroyStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        });
        break;
      }
      case 'counter_spell': {
        const result = applyCounterSpellStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'exile': {
        const result = applyExileStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = Array.isArray(appliedResult.lastExiledCards)
            ? [...appliedResult.lastExiledCards]
            : [];
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
          } else if (lastExiledCards.length > 0) {
            lastMovedCards = [...lastExiledCards];
          }
          currentCtx = {
            ...currentCtx,
            ...(lastMovedCards.length > 0 ? { lastMovedCards } : {}),
            ...(lastExiledCards.length > 0 ? { lastExiledCards } : {}),
          };
        });
        break;
      }
      case 'separate_into_piles': {
        const activePlayerIds = new Set(
          (nextState.players || [])
            .filter((player: any) => player?.inactive !== true)
            .map((player: any) => String(player?.id || '').trim())
            .filter(Boolean),
        );
        const turnOrderIds = (Array.isArray((nextState as any).turnOrder) && (nextState as any).turnOrder.length > 0
          ? (nextState as any).turnOrder
          : (nextState.players || []).map((player: any) => String(player?.id || '').trim()))
          .map((id: any) => String(id || '').trim())
          .filter((id: string) => id && activePlayerIds.has(id));
        const startId = String(controllerId || '').trim();
        const startIndex = Math.max(0, turnOrderIds.indexOf(startId));
        const playerOrder = turnOrderIds.length > 0
          ? [...turnOrderIds.slice(startIndex), ...turnOrderIds.slice(0, startIndex)]
          : [startId].filter(Boolean);

        recordSkippedStep(
          step,
          `Skipped pile separation (requires player assignments): ${step.raw}`,
          'player_choice_required',
          {
            classification: 'player_choice',
            metadata: {
              playerOrder,
              pileCount: Math.max(2, Number(step.pileCount) || 2),
              allowEmptyPiles: step.allowEmptyPiles === true,
              randomPileAction: step.randomPileAction || '',
              selector: String((step.what as any)?.text || (step.what as any)?.raw || ''),
            },
          },
        );
        break;
      }
      case 'library_chaos_exchange': {
        recordSkippedStep(
          step,
          `Skipped library chaos exchange (requires server zone/cast continuation): ${step.raw}`,
          step.targetMode === 'one_per_player'
            ? 'player_choice_required'
            : 'server_action_required',
          {
            classification: step.targetMode === 'one_per_player' ? 'player_choice' : 'unsupported',
            metadata: {
              targetMode: step.targetMode,
              targetText: String((step.target as any)?.text || (step.target as any)?.raw || ''),
              exileMode: step.exileMode,
              putLandOntoBattlefield: step.putLandOntoBattlefield === true,
              bottomRestRandom: step.bottomRestRandom === true,
            },
          },
        );
        break;
      }
      case 'repeated_zone_draft': {
        const draftPoolCards: any[] = Array.isArray(lastExiledCards) && lastExiledCards.length > 0
          ? [...lastExiledCards]
          : Array.isArray((currentCtx as any).lastMovedCards)
            ? [...(currentCtx as any).lastMovedCards]
            : [];
        const findExiledCardOwner = (cardId: string): string | null => {
          for (const player of (nextState.players || []) as any[]) {
            const exile = Array.isArray(player?.exile) ? player.exile : [];
            if (exile.some((card: any) => String(card?.id || '').trim() === cardId)) {
              return String(player?.id || '').trim();
            }
          }
          return null;
        };
        const remainingCardIds = draftPoolCards
          .map((card) => String(card?.id || '').trim())
          .filter((id) => Boolean(id) && findExiledCardOwner(id) !== null);

        if (remainingCardIds.length === 0) {
          setLastStepOutcome(step, 'applied');
          log.push(`No cards remain to draft: ${step.raw}`);
          appliedSteps.push(step);
          break;
        }

        const startingPlayerId =
          step.whoStarts?.kind === 'you' ? String(controllerId).trim() : String(controllerId).trim();
        const turnOrderIds = (Array.isArray((nextState as any).turnOrder) && (nextState as any).turnOrder.length > 0
          ? (nextState as any).turnOrder
          : (nextState.players || []).map((player: any) => player?.id)
        )
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean);
        const startIndex = Math.max(0, turnOrderIds.indexOf(startingPlayerId));
        const chooserOrder = turnOrderIds.length > 0
          ? [...turnOrderIds.slice(startIndex), ...turnOrderIds.slice(0, startIndex)]
          : [startingPlayerId];
        const entersTapped = step.entersTapped === true;

        if (currentCtx.interactivePlayerChoices === true) {
          recordSkippedStep(
            step,
            `Skipped repeated zone draft (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
              metadata: {
                remainingCardIds,
                chooserOrder,
                entersTapped,
                destination: step.destination,
              },
            }
          );
          break;
        }

        let workingState = nextState;
        let remainingPool = [...remainingCardIds];
        let chooserIndex = 0;
        const draftLog: string[] = [];
        const draftedBattlefieldIds: string[] = [];
        while (remainingPool.length > 0) {
          const chooserId = chooserOrder[chooserIndex % chooserOrder.length] as PlayerID;
          chooserIndex += 1;
          const cardId = remainingPool.shift() as string;
          const ownerId = findExiledCardOwner(cardId);
          if (!ownerId) continue;
          const result = moveTargetedCardFromExile(
            workingState,
            ownerId as PlayerID,
            cardId,
            'any',
            'battlefield',
            chooserId,
            entersTapped
          );
          if (result.kind !== 'applied') continue;
          workingState = result.state;
          draftLog.push(...(result.log || []));
          if (Array.isArray((result as any).movedPermanentIds)) {
            draftedBattlefieldIds.push(...((result as any).movedPermanentIds || []));
          }
        }

        nextState = workingState;
        lastMovedBattlefieldPermanentIds = draftedBattlefieldIds;
        currentCtx = {
          ...currentCtx,
          lastMovedBattlefieldPermanentIds: draftedBattlefieldIds,
        };
        setLastStepOutcome(step, 'applied');
        log.push(
          ...(draftLog.length > 0
            ? draftLog
            : [`Drafted ${remainingCardIds.length} card(s) onto the battlefield: ${step.raw}`])
        );
        appliedSteps.push(step);
        break;
      }
      case 'sacrifice': {
        const result = applySacrificeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastSacrificedCreaturesPowerTotal = Math.max(
            0,
            Number(appliedResult.lastSacrificedCreaturesPowerTotal) || 0
          );
          if (Array.isArray(appliedResult.lastSacrificedPermanents)) {
            lastSacrificedPermanents = [...appliedResult.lastSacrificedPermanents];
            currentCtx = {
              ...currentCtx,
              lastSacrificedPermanents,
            } as typeof currentCtx;
          }
        });
        break;
      }
      case 'schedule_delayed_battlefield_action': {
        const result = applyScheduleDelayedBattlefieldActionStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastCreatedTokenIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_mode': {
        const result = applyChooseModeStep(nextState, step, currentCtx, options, recurse);
        if (result.kind === 'recorded_skip') {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        nextState = result.state;
        log.push(...result.log);
        appliedSteps.push(...result.appliedSteps);
        skippedSteps.push(...result.skippedSteps);
        automationGaps.push(...result.automationGaps);
        pendingOptionalSteps.push(...result.pendingOptionalSteps);
        break;
      }
      case 'conditional': {
        const conditionEvaluation = evaluateConditionalWrapperCondition({
          condition: step.condition,
          nextState,
          controllerId,
          ctx: currentCtx,
          lastActionOutcome,
          lastStepOutcome,
          lastConditionalEvaluation,
          pendingSteps: step.steps,
          lastMovedCards,
          lastDiscardedCards,
          lastCreatedTokenIds,
          lastExcessDamageDealtThisWay,
          step,
        });

        if (conditionEvaluation === false) {
          lastConditionalEvaluation = false;
          if (step.elseSteps && step.elseSteps.length > 0) {
            const elseResult = recurse(nextState, step.elseSteps, currentCtx, options);
            nextState = elseResult.state;
            log.push(...elseResult.log);
            appliedSteps.push(...elseResult.appliedSteps);
            skippedSteps.push(...elseResult.skippedSteps);
            automationGaps.push(...elseResult.automationGaps);
            pendingOptionalSteps.push(...elseResult.pendingOptionalSteps);
            absorbExecutionReplayMutations(elseResult);
            mergeNestedExecutionOutcome(elseResult);
            appliedSteps.push(step);
            break;
          }
          appliedSteps.push(step);
          log.push(`Skipped conditional step (condition false): ${step.raw}`);
          break;
        }

        if (conditionEvaluation === null) {
          const normalizedConditionRaw = String(step.condition.raw || '')
            .replace(/\u2019/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
          const flatUnlessPayMatch = /^not \((?:you|that player|target player|target opponent|that opponent|an opponent|its controller) pay(?:s)? (?:\{[^}]+\}(?:\{[^}]+\})*|\d+ life)\)$/i.test(
            normalizedConditionRaw,
          );
          const scaledUnlessPayMatch = normalizedConditionRaw.match(
            /^not \((?:you|that player|target player|target opponent|that opponent|an opponent|its controller) pay(?:s)? (\{[^}]+\}(?:\{[^}]+\})*) for each (.+)\)$/i,
          );
          if (flatUnlessPayMatch || scaledUnlessPayMatch) {
            const conditionRaw = String(step.condition.raw || '').trim();
            const manaMatch = conditionRaw.match(/pay(?:s)? (\{[^}]+\}(?:\{[^}]+\})*)/i);
            const lifeMatch = conditionRaw.match(/pay(?:s)? (\d+) life/i);
            const scalerMatch = conditionRaw.match(/for each (.+?)\)?$/i);
            const nestedChoiceStep = step.steps.length === 1 ? step.steps[0] : step;
            recordSkippedStep(
              nestedChoiceStep,
              `Skipped ${nestedChoiceStep.kind} (requires player choice): ${nestedChoiceStep.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  unlessPayConditionRaw: step.condition.raw,
                  ...(manaMatch ? { unlessPayManaCost: normalizeOracleManaCostString(manaMatch[1]) } : {}),
                  ...(lifeMatch ? { unlessPayLifeAmount: Number(lifeMatch[1]) } : {}),
                  ...(scalerMatch ? { unlessPayScalerRaw: String(scalerMatch[1] || '').trim() } : {}),
                  unlessPayNestedStepKinds: step.steps.map(inner => inner.kind),
                },
              }
            );
            break;
          }

          lastConditionalEvaluation = null;
          recordSkippedStep(
            step,
            `Skipped conditional step (unsupported condition): ${step.raw}`,
            'unsupported_condition_clause',
            {
              metadata: {
                conditionKind: step.condition.kind,
                conditionRaw: step.condition.raw,
                nestedStepKinds: step.steps.map(inner => inner.kind),
              },
            }
          );
          break;
        }

        const resolvedAmount = resolveConditionalReferenceAmount({
          condition: step.condition,
          nextState,
          ctx: currentCtx,
        });
        const innerSteps = step.steps.map(inner => applyConditionalReferenceAmount(inner, resolvedAmount));
        const tokenIdsBeforeConditional = new Set(
          ((nextState.battlefield || []) as BattlefieldPermanent[])
            .filter((perm: any) => Boolean((perm as any)?.isToken))
            .map((perm: any) => String(perm?.id || '').trim())
            .filter(Boolean)
        );
        const result = recurse(
          nextState,
          innerSteps,
          {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
            lastSacrificedPermanents,
            lastCreatedTokenIds,
            lastMovedBattlefieldPermanentIds,
            copyReplaySteps: steps.slice(0, stepIndex),
            lastTappedMatchingPermanentCount,
            ...(typeof resolvedAmount === 'number' && Number.isFinite(resolvedAmount)
              ? { referenceAmount: Math.max(0, resolvedAmount) }
              : {}),
          },
          options
        );
        nextState = result.state;
        const newTokenIds = ((nextState.battlefield || []) as BattlefieldPermanent[])
          .filter((perm: any) => Boolean((perm as any)?.isToken))
          .map((perm: any) => String(perm?.id || '').trim())
          .filter(id => id && !tokenIdsBeforeConditional.has(id));
        if (newTokenIds.length > 0) {
          lastCreatedTokenIds = newTokenIds;
          lastMovedBattlefieldPermanentIds = Array.from(
            new Set([...newTokenIds, ...lastMovedBattlefieldPermanentIds])
          );
          currentCtx = {
            ...currentCtx,
            lastMovedBattlefieldPermanentIds,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenObjectIds: Array.from(
                new Set([
                  ...((currentCtx.selectorContext?.chosenObjectIds || []) as readonly string[]).map(id =>
                    String(id || '').trim()
                  ).filter(Boolean),
                  ...newTokenIds,
                ])
              ),
            },
          };
        }
        lastConditionalEvaluation = true;
        log.push(...result.log);
        appliedSteps.push(...result.appliedSteps);
        skippedSteps.push(...result.skippedSteps);
        automationGaps.push(...result.automationGaps);
        pendingOptionalSteps.push(...result.pendingOptionalSteps);
        absorbExecutionReplayMutations(result);
        mergeNestedExecutionOutcome(result);
        appliedSteps.push(step);
        break;
      }
      case 'unless_pays_life': {
        const result = evaluateUnlessPaysLifeStep(nextState, step, currentCtx);
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep(step, result.message, result.reason, {
            ...result.options,
            metadata: normalizeSkipMetadata(result.options?.metadata),
          });
          break;
        }

        if (result.state) {
          nextState = result.state;
        }
        log.push(...result.log);
        if (!result.shouldApplyNestedSteps) {
          appliedSteps.push(step);
          break;
        }

        const nestedResult = recurse(nextState, step.steps, currentCtx, options);
        nextState = nestedResult.state;
        log.push(...nestedResult.log);
        appliedSteps.push(...nestedResult.appliedSteps);
        skippedSteps.push(...nestedResult.skippedSteps);
        automationGaps.push(...nestedResult.automationGaps);
        pendingOptionalSteps.push(...nestedResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(nestedResult);
        mergeNestedExecutionOutcome(nestedResult);
        appliedSteps.push(step);
        break;
      }
      case 'unless_discards': {
        const result = evaluateUnlessDiscardsStep(nextState, step, currentCtx);
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep(result.innerStep ?? step, result.message, result.reason, {
            ...result.options,
            metadata: normalizeSkipMetadata(result.options?.metadata),
          });
          break;
        }

        if (result.state) {
          nextState = result.state;
        }
        log.push(...result.log);
        if (!result.shouldApplyNestedSteps) {
          appliedSteps.push(step);
          break;
        }

        const unlessDiscardsNestedResult = recurse(nextState, step.steps, currentCtx, options);
        nextState = unlessDiscardsNestedResult.state;
        log.push(...unlessDiscardsNestedResult.log);
        appliedSteps.push(...unlessDiscardsNestedResult.appliedSteps);
        skippedSteps.push(...unlessDiscardsNestedResult.skippedSteps);
        automationGaps.push(...unlessDiscardsNestedResult.automationGaps);
        pendingOptionalSteps.push(...unlessDiscardsNestedResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(unlessDiscardsNestedResult);
        mergeNestedExecutionOutcome(unlessDiscardsNestedResult);
        appliedSteps.push(step);
        break;
      }
      case 'unless_pays_mana': {
        const result = evaluateUnlessPaysManaStep(nextState, step, currentCtx);
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep(step, result.message, result.reason, {
            ...result.options,
            metadata: normalizeSkipMetadata(result.options?.metadata),
          });
          break;
        }

        if (result.state) {
          nextState = result.state;
        }
        log.push(...result.log);
        if (!result.shouldApplyNestedSteps) {
          appliedSteps.push(step);
          break;
        }

        const nestedResult = recurse(nextState, step.steps, currentCtx, options);
        nextState = nestedResult.state;
        log.push(...nestedResult.log);
        appliedSteps.push(...nestedResult.appliedSteps);
        skippedSteps.push(...nestedResult.skippedSteps);
        automationGaps.push(...nestedResult.automationGaps);
        pendingOptionalSteps.push(...nestedResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(nestedResult);
        mergeNestedExecutionOutcome(nestedResult);
        appliedSteps.push(step);
        break;
      }
      case 'modify_damage': {
        setLastStepOutcome(step, 'applied');
        log.push(`Registered damage modification: ${step.raw}`);
        appliedSteps.push(step);
        break;
      }
      default: {
        if (String(step.kind) === 'grant_cast_permission') {
          setLastStepOutcome(step, 'applied');
          log.push(`Registered cast permission: ${String((step as { raw?: string }).raw || '')}`);
          appliedSteps.push(step);
          break;
        }
        if (step.kind === 'unknown') {
          const normalizedUnknown = String(step.raw || '')
            .replace(/\u2019/g, "'")
            .trim()
            .toLowerCase();
          if (/cast it for its madness cost or put it into your graveyard/.test(normalizedUnknown)) {
            setLastStepOutcome(step, 'applied');
            log.push(`Registered madness resolution: ${step.raw}`);
            appliedSteps.push(step);
            break;
          }
        }
        recordSkippedStep(step, `Skipped unsupported step: ${step.raw}`, 'unsupported_step');
        break;
      }
    }

    if (haltedForPlayerChoice) {
      pendingContinuationSteps = steps.slice(relativeIndex + 1) as OracleEffectStep[];
      break;
    }
  }

  nextState = appendOracleAutomationGapRecords(nextState, localAutomationGaps);
  if (stepLedger.size > 0) {
    (nextState as any).oracleIrStepLedger = snapshotStepLedger(stepLedger);
  }
  if (appliedStepKinds.size > 0) {
    (nextState as any).oracleIrAppliedStepKinds = new Map(appliedStepKinds);
  }

  return {
    state: nextState,
    log,
    appliedSteps,
    skippedSteps,
    automationGaps,
    pendingOptionalSteps,
    ...(pendingContinuationSteps ? { pendingContinuationSteps } : {}),
    lastStepOutcome,
    ...(lastMovedCards.length > 0 ? { lastMovedCards } : {}),
    ...(lastRevealedCardCount > 0 ? { lastRevealedCardCount } : {}),
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  };
}
