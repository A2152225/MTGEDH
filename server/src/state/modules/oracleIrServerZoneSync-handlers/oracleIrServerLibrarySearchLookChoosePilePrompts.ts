// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerLibrarySearchLookChoosePilePrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueLookChooseChoicePromptsFromOracleIRResult,
//   queueSearchLibraryChoicePromptsFromOracleIRResult, and
//   queueChoosePileChoicePromptsFromOracleIRResult, plus the choose-pile
//   helpers they close over (parseChoosePileRevealCount, listActiveOpponentIds,
//   revealCardsFromControllerLibrary, findNextLastSplitPileStep,
//   buildChoosePileSplitMetadata).
// look_select_top dest=library_top + all-cards reorder queues PONDER_EFFECT
// (Index / Ponder put-them-back); hand/battlefield/graveyard-rest stay LIBRARY_SEARCH.
// Public entry symbols: queueLookChooseChoicePromptsFromOracleIRResult,
//   queueSearchLibraryChoicePromptsFromOracleIRResult,
//   queueChoosePileChoicePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import {
  buildLookChooseFromTopSelectionOptions,
  buildLookSelectTopSelectionOptions,
  buildSearchLibrarySelectionOptions,
} from '../../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { inferSplitLibrarySearchPlan } from '../../../../../rules-engine/src/oracleIRSplitLibrarySearch.js';
import {
  detectTutorSpell,
  parseLibrarySearchFilter,
} from '../oracleIrSpellLegacyTutorUtils.js';
import { isCelestialReunionOracle } from '../chosen-creature-type.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from '../resolutionPromptEvents.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
  normalizeTopLibraryPromptCard,
} from '../oracleIrServerPromptResumeUtils.js';
import { isOracleIrSpellPrimaryEnabled } from '../oracleIrFeatureFlags.js';

function isLookSelectTopLibraryReorderOnly(
  built: {
    readonly destination: string;
    readonly restDestination: string;
    readonly restToTop: boolean;
    readonly restRandomOrder: boolean;
    readonly chooseCount: number;
    readonly chooseMin: number;
    readonly lookedCount: number;
  },
  step: { readonly raw?: string },
): boolean {
  if (built.destination !== 'library_top') return false;
  if (built.restDestination !== 'library') return false;
  if (built.restToTop) return false;
  if (built.restRandomOrder) return false;
  if (!(built.lookedCount > 0)) return false;
  if (built.chooseCount !== built.lookedCount) return false;
  if (built.chooseMin !== built.lookedCount) return false;

  const raw = String(step.raw || '');
  if (/\binto your hand\b/i.test(raw)) return false;
  if (/\bonto the battlefield\b/i.test(raw)) return false;
  if (/\binto your graveyard\b/i.test(raw)) return false;
  if (/\bface down\b/i.test(raw) && /\bexile\b/i.test(raw)) return false;
  return true;
}

function consumeLeadingDrawAfterReorder(
  result: OracleIRExecutionResult,
): { readonly drawAfter: boolean; readonly resultForResume: OracleIRExecutionResult } {
  const pending = result.pendingContinuationSteps;
  if (!Array.isArray(pending) || pending[0]?.kind !== 'draw') {
    return { drawAfter: false, resultForResume: result };
  }
  return {
    drawAfter: true,
    resultForResume: {
      ...result,
      pendingContinuationSteps: pending.slice(1),
    },
  };
}

export function queueLookChooseChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    triggerItem?: any;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    const kind = String(gap.stepKind || '');
    if (kind !== 'look_choose_from_top' && kind !== 'look_select_top') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step) continue;

    if (step.kind === 'look_choose_from_top') {
      const built = buildLookChooseFromTopSelectionOptions(state, step, params.irCtx);
      if (!built || built.availableCards.length === 0) continue;

      const queueKey = `look_choose:${String((step as any).raw || '')}:${built.playerId}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      const availableCards = built.availableCards.map(normalizeTopLibraryPromptCard);
      const selectableIds = new Set(built.selectableCardIds);
      const nonSelectableCards = availableCards.filter((card) => !selectableIds.has(String(card.id || '')));
      const stepRaw = String((step as any).raw || '');
      const isRevealUntil = (step as any).amount?.kind === 'reference_amount';
      const remainderIsGraveyard = String((step as any).nonMatchRest || '') === 'graveyard';
      const destinationFaceDown = built.destination === 'exile' && /face down/i.test(stepRaw);
      const grantPlayableFromExileToController = built.destination === 'exile'
        && /you may play the exiled card/i.test(stepRaw);
      const grantPlayableFromExileSpendManaAsThoughAnyType = grantPlayableFromExileToController
        && /mana as though it were mana of any/i.test(stepRaw);
      const libraryOwnerId = built.playerId;
      const chooserId = params.controller;
      const attachSelectedEquipmentToPermanentId = built.destination === 'battlefield'
        && /attached to that creature/i.test(stepRaw)
        ? String(
          params.triggerItem?.effectData?.exertedPermanentId
          || params.triggerItem?.exertedPermanentId
          || '',
        ).trim() || undefined
        : undefined;
      const queuedAvailableCards = (isRevealUntil || remainderIsGraveyard) && selectableIds.size > 0
        ? availableCards.filter((card) => selectableIds.has(String(card.id || '')))
        : availableCards;

      const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: chooserId,
        description: `${sourceName}: ${String((step as any).raw || 'Look and choose')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        searchOwnerId: libraryOwnerId,
        searchCriteria: built.destination === 'battlefield' && built.contextValue !== undefined
          ? `Top ${built.lookedCount} cards - creature card with mana value ${built.contextValue} or less`
          : String((step as any).raw || 'Look at the top cards of your library'),
        minSelections: built.minSelections,
        maxSelections: built.maxSelections,
        destination: built.destination === 'exile'
          ? 'exile'
          : built.destination === 'battlefield'
            ? 'battlefield'
            : 'hand',
        reveal: Boolean((step as any).reveal),
        shuffleAfter: false,
        remainderDestination: remainderIsGraveyard ? 'graveyard' : 'bottom',
        remainderRandomOrder: remainderIsGraveyard ? false : built.restOrder !== 'any',
        remainderPlayerChoosesOrder: !remainderIsGraveyard && built.restOrder === 'any',
        destinationFaceDown,
        ...(grantPlayableFromExileToController
          ? {
              grantPlayableFromExileToController: true,
              grantPlayableFromExileControllerId: chooserId,
              ...(grantPlayableFromExileSpendManaAsThoughAnyType
                ? { grantPlayableFromExileSpendManaAsThoughAnyType: true }
                : {}),
            }
          : {}),
        availableCards: queuedAvailableCards,
        nonSelectableCards,
        filter: built.filter,
        ...(attachSelectedEquipmentToPermanentId
          ? {
              attachSelectedEquipmentToPermanentId,
              persistLibrarySearchResolve: true,
              persistLibrarySearchResolveReason: 'stack_resolution',
            }
          : {}),
        ...(built.contextValue !== undefined ? { contextValue: built.contextValue } : {}),
        ...(attachSelectedEquipmentToPermanentId
          ? {}
          : {
              oracleIrChoiceStepJson: JSON.stringify([step]),
              oracleIrControllerId: params.controller,
              oracleIrSourceId: sourceId,
              oracleIrSourceName: sourceName,
            }),
      } as any, result, params) as any);
      appendQueuedResolutionPromptEvent(ctx, {
        playerId: chooserId,
        sourceId,
        queuedResolutionStep: queuedStep,
      });
      continue;
    }

    if (step.kind === 'look_select_top') {
      const built = buildLookSelectTopSelectionOptions(state, step, params.irCtx);
      if (!built || built.lookedCount === 0) continue;

      const queueKey = `look_select:${String((step as any).raw || '')}:${built.playerId}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      if (isLookSelectTopLibraryReorderOnly(built, step as { raw?: string })) {
        // PRIMARY=0: uncategorized IR may still apply this step; leave the
        // prompt to the legacy PONDER_EFFECT body so we do not double-queue.
        if (!isOracleIrSpellPrimaryEnabled()) {
          continue;
        }
        const stepRaw = String((step as any).raw || '');
        const { drawAfter, resultForResume } = consumeLeadingDrawAfterReorder(result);
        const cards = Array.isArray(built.availableCards)
          ? built.availableCards.map((card) => ({ ...card }))
          : [];
        const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
          type: ResolutionStepType.PONDER_EFFECT,
          playerId: built.playerId,
          description: `${sourceName}: ${stepRaw || 'Look at the top cards of your library'}`,
          mandatory: (step as any).optional !== true,
          sourceId,
          sourceName,
          cards,
          variant: drawAfter ? 'ponder' : 'index',
          cardCount: built.lookedCount,
          drawAfter,
          mayShuffleAfter: /you may shuffle/i.test(stepRaw),
          targetPlayerId: built.playerId,
          effectId: sourceId,
          oracleIrChoiceStepJson: JSON.stringify([step]),
          oracleIrControllerId: params.controller,
          oracleIrSourceId: sourceId,
          oracleIrSourceName: sourceName,
        } as any, resultForResume, params) as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId: built.playerId,
          sourceId,
          queuedResolutionStep: queuedStep,
        });
        continue;
      }

      const isLibraryTop = built.destination === 'library_top';
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: built.playerId,
        description: `${sourceName}: ${String((step as any).raw || 'Look and select')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        searchCriteria: String((step as any).raw || 'Look at the top cards of your library'),
        minSelections: built.chooseMin,
        maxSelections: built.chooseCount,
        destination: isLibraryTop ? 'top' : built.destination === 'graveyard' ? 'graveyard' : 'hand',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: built.restDestination === 'graveyard' ? 'graveyard' : 'bottom',
        remainderRandomOrder: built.restRandomOrder,
        availableCards: built.availableCards.map(normalizeTopLibraryPromptCard),
        ...(built.lookedCount > 0 ? { contextValue: built.lookedCount } : {}),
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
    }
  }
}

export function queueSearchLibraryChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    sourceItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'search_library') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'search_library') continue;

    const stepRaw = String((step as any).raw || 'Search your library');

    const built = buildSearchLibrarySelectionOptions(
      state,
      step as Extract<OracleEffectStep, { kind: 'search_library' }>,
      params.irCtx,
    );
    if (!built || built.matches.length === 0) continue;

    const queueKey = `search_library:${String((step as any).raw || '')}:${built.playerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const splitPlan = inferSplitLibrarySearchPlan(stepRaw);
    const tutorInfo = detectTutorSpell(stepRaw);
    const splitDestination = splitPlan?.splitDestination === true || tutorInfo.splitDestination === true;
    const destination = splitDestination
      ? 'split'
      : built.destination === 'battlefield'
        ? 'battlefield'
        : built.destination === 'graveyard'
          ? 'graveyard'
          : built.destination === 'exile'
            ? 'exile'
            : built.destination === 'top'
              ? 'top'
              : built.destination === 'bottom'
                ? 'bottom'
                : 'hand';
    const criteriaText = String((step as any).criteria?.text || tutorInfo.searchCriteria || '');
    const filter = parseLibrarySearchFilter(criteriaText);
    const criteriaLower = criteriaText.toLowerCase();
    const totalManaValueCapMatch = criteriaLower.match(/total mana value (\d+) or less/);
    const maxTotalManaValue = totalManaValueCapMatch
      ? Math.max(0, Number(totalManaValueCapMatch[1]) || 0)
      : undefined;
    if (
      typeof filter.maxCmc !== 'number'
      && maxTotalManaValue === undefined
      && /(?:mana value|converted mana cost|cmc)\s+x\s+or\s+less/.test(criteriaLower)
    ) {
      const xValue = Number(params.irCtx.xValue);
      if (Number.isFinite(xValue)) {
        filter.maxCmc = Math.max(0, Math.floor(xValue));
      }
    }

    const sourceItem = params.sourceItem;
    const chosenType = String(
      params.irCtx.selectorContext?.chosenCreatureType
      || (params.irCtx as any).chosenCreatureType
      || sourceItem?.chosenCreatureType
      || sourceItem?.card?.chosenCreatureType
      || '',
    ).trim();
    const beholdPaid = Boolean(
      sourceItem?.additionalCostPaid ?? sourceItem?.card?.additionalCostPaid,
    );
    const chosenTypeBattlefieldIfPaid =
      beholdPaid
      && chosenType
      && (
        isCelestialReunionOracle(stepRaw)
        || /creature card with mana value x or less/i.test(stepRaw)
      )
        ? { chosenType, additionalCostPaid: true as const }
        : undefined;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: built.playerId,
      description: `${sourceName}: ${stepRaw}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      searchCriteria: stepRaw,
      minSelections: built.minSelections,
      maxSelections: built.maxSelections,
      destination,
      reveal: Boolean((step as any).revealFound),
      shuffleAfter: (step as any).shuffle !== false,
      filter,
      availableCards: built.matches.map(normalizeTopLibraryPromptCard),
      persistLibrarySearchResolve: true,
      persistLibrarySearchResolveReason: 'stack_resolution',
      ...(maxTotalManaValue !== undefined ? { maxTotalManaValue } : {}),
      ...(chosenTypeBattlefieldIfPaid ? { chosenTypeBattlefieldIfPaid } : {}),
      ...(splitDestination
        ? {
            splitDestination: true,
            toBattlefield: splitPlan?.toBattlefield ?? tutorInfo.toBattlefield ?? 1,
            toHand: splitPlan?.toHand ?? tutorInfo.toHand ?? 1,
            entersTapped: splitPlan?.entersTapped === true
              || tutorInfo.entersTapped === true
              || Boolean((step as any).entersTapped),
          }
        : ((step as any).entersTapped ? { entersTapped: true } : {})),
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

function parseChoosePileRevealCount(raw: string): number {
  const match = String(raw || '').match(
    /reveal\s+the\s+top\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+cards?/i,
  );
  if (!match) return 3;
  const token = String(match[1] || '').toLowerCase();
  const words: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  if (words[token] !== undefined) return words[token];
  const parsed = parseInt(token, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function listActiveOpponentIds(state: any, controller: PlayerID): PlayerID[] {
  return (state.players || [])
    .filter((player: any) => String(player?.id || '') !== String(controller) && !player?.eliminated)
    .map((player: any) => String(player.id).trim() as PlayerID)
    .filter(Boolean);
}

function revealCardsFromControllerLibrary(
  ctx: GameContext,
  state: any,
  controller: PlayerID,
  count: number,
): any[] {
  const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  const player = (state.players || []).find((entry: any) => String(entry?.id || '') === String(controller));
  let library = libraries?.get(controller);
  if (!Array.isArray(library)) {
    library = Array.isArray(player?.library)
      ? [...player.library]
      : [...(state.zones?.[controller]?.library || [])];
  } else {
    library = [...library];
  }

  const revealCount = Math.min(Math.max(0, count), library.length);
  const revealed = library.splice(0, revealCount).map((card: any) => ({ ...card, zone: 'revealed' }));

  if (libraries) {
    libraries.set(controller, library);
  }
  if (player) {
    player.library = library.map((card: any) => ({ ...card, zone: 'library' }));
  }

  const zones = state.zones || {};
  const playerZones = { ...(zones[controller] || {}) };
  playerZones.library = library;
  playerZones.libraryCount = library.length;
  state.zones = { ...zones, [controller]: playerZones };

  return revealed;
}

function findNextLastSplitPileStep(steps: readonly OracleEffectStep[] | undefined): OracleEffectStep | undefined {
  if (!Array.isArray(steps)) return undefined;
  return steps.find((step) => step?.kind === 'choose_pile' && (step as any).source === 'last_split_piles');
}

function buildChoosePileSplitMetadata(
  step: OracleEffectStep,
  controller: PlayerID,
  sourceName: string,
  sourceId: string | undefined,
  revealed: readonly any[],
  result: OracleIRExecutionResult,
  params: { controller: PlayerID; sourceName?: string; sourceId?: string },
) {
  const originalOrder = revealed.map((card) => String(card?.id || '')).filter(Boolean);
  const chosenDestination = String((step as any).chosenDestination || 'hand');
  const otherDestination = String((step as any).otherDestination || 'graveyard');
  const nextChoosePileStep = findNextLastSplitPileStep(result.pendingContinuationSteps);
  const choiceStepJson = nextChoosePileStep ? JSON.stringify([nextChoosePileStep]) : undefined;

  return attachOracleIrResumeMetadata({
    items: revealed.map((card) => ({
      id: card.id,
      label: card.name || card.id,
      description: card.type_line,
      imageUrl: card.image_uris?.normal || card.image_uris?.small,
    })),
    minPerPile: 0,
    choosePileFromSplitChoice: true,
    choosePileFromSplitChooserPlayerId: controller,
    choosePileFromSplitSourceName: sourceName,
    choosePileFromSplitItems: revealed.map((card) => ({ ...card })),
    choosePileFromSplitOriginalOrder: originalOrder,
    choosePileFromSplitChosenAction: 'move_cards',
    choosePileFromSplitChosenDestination: chosenDestination,
    choosePileFromSplitOtherDestination: otherDestination,
    choosePileFromSplitMovePlayerId: controller,
    choosePileFromSplitChoiceDescription: `${sourceName}: Choose a pile`,
    choosePileFromSplitSplitMessage: `${sourceName}: The cards were separated into two piles.`,
    ...(choiceStepJson ? {
      oracleIrChoiceStepJson: choiceStepJson,
      oracleIrPlayerChoiceKind: 'choose_pile',
      oracleIrControllerId: controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } : {}),
  } as Record<string, unknown>, result, params);
}

export function queueChoosePileChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'choose_pile') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'choose_pile') continue;

    const chooser = String((gap.metadata as any)?.chooser || params.controller).trim() as PlayerID;
    const queueKey = `choose_pile:${String((step as any).source || '')}:${String((step as any).raw || '')}:${chooser}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const stepSource = String((step as any).source || 'last_split_piles');

    if (stepSource === 'top_library') {
      const revealCount = parseChoosePileRevealCount(String((step as any).raw || ''));
      const revealed = revealCardsFromControllerLibrary(ctx, state, params.controller, revealCount);
      if (revealed.length === 0) continue;

      const opponents = listActiveOpponentIds(state, params.controller);
      const splitMetadata = buildChoosePileSplitMetadata(
        step,
        params.controller,
        sourceName,
        sourceId,
        revealed,
        result,
        params,
      );

      if (opponents.length === 0) {
        const zones = state.zones?.[params.controller] || {};
        const hand = Array.isArray(zones.hand) ? [...zones.hand] : [];
        for (const card of revealed) {
          hand.push({ ...card, zone: 'hand' });
        }
        state.zones = {
          ...(state.zones || {}),
          [params.controller]: {
            ...zones,
            hand,
            handCount: hand.length,
          },
        };
        continue;
      }

      if (opponents.length > 1) {
        ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: params.controller,
          description: `${sourceName}: Choose an opponent to separate the revealed cards into two piles`,
          mandatory: (step as any).optional !== true,
          sourceId,
          sourceName,
          options: opponents.map((opponentId) => ({ id: opponentId, label: opponentId })),
          minSelections: 1,
          maxSelections: 1,
          choosePlayerForTwoPileSplitChoice: true,
          choosePlayerForTwoPileSplitController: params.controller,
          choosePlayerForTwoPileSplitSourceName: sourceName,
          choosePlayerForTwoPileSplitDescription: `${sourceName}: Separate the revealed cards into two piles`,
          choosePlayerForTwoPileSplitItems: revealed.map((card) => ({
            id: card.id,
            label: card.name || card.id,
            description: card.type_line,
            imageUrl: card.image_uris?.normal || card.image_uris?.small,
          })),
          choosePlayerForTwoPileSplitMinPerPile: 0,
          ...splitMetadata,
        } as any, result, params) as any);
        continue;
      }

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.TWO_PILE_SPLIT,
        playerId: opponents[0],
        description: `${sourceName}: Separate the revealed cards into two piles`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        ...splitMetadata,
      } as any, result, params) as any);
      continue;
    }

    const storedSplit = (state as any).oracleIrLastSplitPiles as {
      pileA?: string[];
      pileB?: string[];
      items?: any[];
      originalOrder?: string[];
      chosenDestination?: string;
      otherDestination?: string;
      movePlayerId?: PlayerID;
    } | undefined;

    const pilePayload = storedSplit?.pileA && storedSplit?.pileB
      ? {
          choosePileFromSplitChoice: true,
          choosePileFromSplitChooserPlayerId: chooser,
          choosePileFromSplitSourceName: sourceName,
          choosePileFromSplitItems: storedSplit.items || [],
          choosePileFromSplitOriginalOrder: storedSplit.originalOrder,
          choosePileFromSplitChosenAction: 'move_cards',
          choosePileFromSplitChosenDestination: storedSplit.chosenDestination
            || String((step as any).chosenDestination || 'hand'),
          choosePileFromSplitOtherDestination: storedSplit.otherDestination
            || String((step as any).otherDestination || 'graveyard'),
          choosePileFromSplitMovePlayerId: storedSplit.movePlayerId || params.controller,
          choosePileFromSplitPileA: storedSplit.pileA,
          choosePileFromSplitPileB: storedSplit.pileB,
        }
      : {};

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: chooser,
      description: `${sourceName}: ${String((step as any).raw || 'Choose a pile')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      options: [
        { id: 'pileA', label: 'Pile A' },
        { id: 'pileB', label: 'Pile B' },
      ],
      minSelections: 1,
      maxSelections: 1,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
      oracleIrPlayerChoiceKind: 'choose_pile',
      ...pilePayload,
    } as any, result, params) as any);
  }
}
