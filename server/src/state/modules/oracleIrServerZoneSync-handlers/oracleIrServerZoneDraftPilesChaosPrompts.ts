// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerZoneDraftPilesChaosPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueRepeatedZoneDraftChoicePromptFromOracleIRResult,
//   queueSeparateIntoPilesPromptsFromOracleIRResult, and
//   bridgeLibraryChaosExchangeFromOracleIRResult.
// Public entry symbols: queueRepeatedZoneDraftChoicePromptFromOracleIRResult,
//   queueSeparateIntoPilesPromptsFromOracleIRResult,
//   bridgeLibraryChaosExchangeFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import {
  buildRepeatedZoneDraftCardChoiceInfo,
  filterLegalRepeatedZoneDraftCardIds,
  findNextRepeatedZoneDraftChooserIndex,
} from '../../../../../rules-engine/src/oracleIRExecutorRepeatedZoneDraft.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
} from '../oracleIrServerPromptResumeUtils.js';
import {
  executeLibraryChaosExchange,
  permanentMatchesLibraryChaosTarget,
  queueLibraryChaosCastOffers,
  type LibraryChaosExchangeStep,
} from '../oracleIrLibraryChaosExchange.js';

/**
 * Bridges a `repeated_zone_draft` player-choice gap (Thieves' Auction style) to a
 * queued resolution step. Only queues the initial prompt for the first chooser;
 * persists the full remaining pool + chooser order/index on the step so the
 * resolution handler can advance the rotation and re-queue for the next chooser
 * after each pick.
 */
export function queueRepeatedZoneDraftChoicePromptFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'repeated_zone_draft') continue;
    if (gap.reasonCode !== 'player_choice_required') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'repeated_zone_draft' }> | undefined;
    if (!step || step.kind !== 'repeated_zone_draft') continue;

    const queueKey = `repeated_zone_draft:${String(step.raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const remainingCardIds = Array.isArray(gap.metadata?.remainingCardIds)
      ? (gap.metadata!.remainingCardIds as readonly unknown[]).map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (remainingCardIds.length === 0) continue;

    const chooserOrder = Array.isArray(gap.metadata?.chooserOrder)
      ? (gap.metadata!.chooserOrder as readonly unknown[]).map((id) => String(id || '').trim()).filter(Boolean)
      : [String(params.controller)];
    const entersTapped = gap.metadata?.entersTapped === true;
    const destination = String(gap.metadata?.destination || 'battlefield');
    const firstChooserIndex = findNextRepeatedZoneDraftChooserIndex(state, remainingCardIds, chooserOrder, 0);
    if (firstChooserIndex === null) continue;
    const firstChooser = (chooserOrder[firstChooserIndex] || String(params.controller)) as PlayerID;
    const legalCardIds = filterLegalRepeatedZoneDraftCardIds(state, remainingCardIds, firstChooser);

    const cards = legalCardIds
      .map((cardId) => buildRepeatedZoneDraftCardChoiceInfo(state, cardId, firstChooser))
      .filter(Boolean);
    if (cards.length === 0) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.REPEATED_ZONE_DRAFT,
      playerId: firstChooser,
      description: `${sourceName}: ${String(step.raw || 'Choose a card from the exiled pool').trim()}`,
      mandatory: true,
      sourceId,
      sourceName,
      remainingCardIds,
      cards,
      chooserOrder,
      chooserIndex: firstChooserIndex,
      entersTapped,
      destination,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

/**
 * Bridge a generic per-player N-pile partition to the existing pile-split
 * resolution UI. The response handler advances through playerOrder, carrying
 * prior assignments on the next persisted prompt.
 */
export function queueSeparateIntoPilesPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'separate_into_piles') continue;
    if (gap.reasonCode !== 'player_choice_required') continue;

    const step = findSkippedOracleStep(result, gap) as
      | Extract<OracleEffectStep, { kind: 'separate_into_piles' }>
      | undefined;
    if (!step) continue;

    const playerOrder = (Array.isArray(gap.metadata?.playerOrder)
      ? gap.metadata!.playerOrder
      : [params.controller])
      .map((id: unknown) => String(id || '').trim())
      .filter(Boolean);
    const firstPlayerId = String(playerOrder[0] || params.controller).trim() as PlayerID;
    if (!firstPlayerId) continue;

    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const controlled = battlefield.filter(
      (perm: any) => String(perm?.controller || '').trim() === firstPlayerId,
    );
    const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
    const sourceId = String(params.sourceId || '').trim() || undefined;
    const pileCount = Math.max(2, Number(gap.metadata?.pileCount ?? step.pileCount) || 2);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TWO_PILE_SPLIT,
      playerId: firstPlayerId,
      description: `${sourceName}: Separate all permanents you control into ${pileCount} piles`,
      mandatory: true,
      sourceId,
      sourceName,
      items: controlled.map((perm: any) => ({
        id: String(perm?.id || ''),
        label: String(perm?.card?.name || perm?.name || perm?.id || 'Permanent'),
        description: String(perm?.card?.type_line || perm?.type_line || ''),
        imageUrl: perm?.card?.image_uris?.normal
          || perm?.card?.image_uris?.small
          || perm?.card?.imageUrl,
      })),
      minPerPile: step.allowEmptyPiles === true ? 0 : 1,
      pileCount,
      allowEmptyPiles: step.allowEmptyPiles === true,
      oracleIrSequentialPileSplit: true,
      oracleIrPileSplitPlayerOrder: playerOrder,
      oracleIrPileSplitPlayerIndex: 0,
      oracleIrPileAssignmentsByPlayer: {},
      oracleIrPileRandomAction: step.randomPileAction,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

export function bridgeLibraryChaosExchangeFromOracleIRResult(
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

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'library_chaos_exchange') continue;
    const step = findSkippedOracleStep(result, gap) as LibraryChaosExchangeStep | undefined;
    if (!step) continue;

    const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
    const sourceId = String(params.sourceId || '').trim() || undefined;
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '');
    const preselectedIds = [
      ...((params.irCtx.selectorContext as any)?.chosenObjectIds || []),
      ...(params.irCtx.chosenObjectIds || []),
      ...((params.irCtx as any).targetIds || []),
      ...(Array.isArray(params.sourceItem?.targets) ? params.sourceItem.targets : []),
    ].map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim()).filter(Boolean);
    const hadCastTimeTargets = preselectedIds.length > 0;

    if (step.targetMode === 'single_target') {
      const targetId = preselectedIds.find((id: string) =>
        battlefield.some((permanent: any) =>
          String(permanent?.id || '') === id
          && permanentMatchesLibraryChaosTarget(permanent, targetText),
        ),
      );
      if (!targetId) continue;
      const execution = executeLibraryChaosExchange(ctx, step, [targetId], { sourceId, sourceName });
      queueLibraryChaosCastOffers(ctx, execution.castOffers, { sourceId, sourceName });
      continue;
    }

    if (hadCastTimeTargets) {
      const legalTargetIds = Array.from(new Set(preselectedIds)).filter((id: string) =>
        battlefield.some((permanent: any) =>
          String(permanent?.id || '') === id
          && permanentMatchesLibraryChaosTarget(permanent, targetText),
        ),
      );
      const execution = executeLibraryChaosExchange(ctx, step, legalTargetIds, { sourceId, sourceName });
      queueLibraryChaosCastOffers(ctx, execution.castOffers, { sourceId, sourceName });
      continue;
    }

    const activeIds = new Set(
      (state.players || [])
        .filter((player: any) => player?.inactive !== true && player?.spectator !== true)
        .map((player: any) => String(player?.id || '').trim())
        .filter(Boolean),
    );
    const turnOrder = (Array.isArray(state.turnOrder) && state.turnOrder.length > 0
      ? state.turnOrder
      : (state.players || []).map((player: any) => player?.id))
      .map((id: unknown) => String(id || '').trim())
      .filter((id: string) => id && activeIds.has(id));
    const targetControllers = turnOrder.filter((playerId: string) =>
      battlefield.some((permanent: any) =>
        String(permanent?.controller || '') === playerId
        && permanentMatchesLibraryChaosTarget(permanent, targetText),
      ),
    );
    if (targetControllers.length === 0) continue;

    const firstController = targetControllers[0];
    const validTargets = battlefield
      .filter((permanent: any) =>
        String(permanent?.controller || '') === firstController
        && permanentMatchesLibraryChaosTarget(permanent, targetText),
      )
      .map((permanent: any) => ({
        id: String(permanent?.id || ''),
        label: String(permanent?.card?.name || permanent?.id || 'Permanent'),
        description: String(permanent?.card?.type_line || 'permanent'),
        imageUrl: permanent?.card?.image_uris?.normal || permanent?.card?.image_uris?.small,
        controller: firstController,
      }));

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: params.controller,
      description: `${sourceName}: Choose a ${targetText} controlled by ${firstController}`,
      mandatory: true,
      sourceId,
      sourceName,
      validTargets,
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: targetText,
      oracleIrLibraryChaosTargetSelection: true,
      oracleIrLibraryChaosStepJson: JSON.stringify(step),
      oracleIrLibraryChaosTargetControllers: targetControllers,
      oracleIrLibraryChaosTargetIndex: 0,
      oracleIrLibraryChaosSelectedIds: [],
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any);
  }
}

