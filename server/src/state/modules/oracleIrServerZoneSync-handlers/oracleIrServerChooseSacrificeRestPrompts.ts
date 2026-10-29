// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerChooseSacrificeRestPrompts.ts
// Origin: oracleIrServerChoiceFamilyPrompts.ts
// Cluster: APNAP TARGET_SELECTION for each_player_choose_then_sacrifice_rest
//   (Planetary Annihilation: each player chooses N lands, then sacrifices the rest).
// Public: queueEachPlayerChooseThenSacrificeRestPrompts
// Leaf must not import oracleIrServerZoneSync.ts or the handlers index.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import {
  chooserPlayerIdsForSacrificeRest,
  permanentMatchesChooseThenSacrificeKeepTypes,
  playersWhoMustChooseForSacrificeRest,
} from '../../../../../rules-engine/src/oracleIRExecutorEachPlayerChooseSacrificeRest.js';
import type { GameContext } from '../../context.js';
import { uid } from '../../utils.js';
import { debug, debugWarn } from '../../../utils/debug.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from '../resolutionPromptEvents.js';
import { attachOracleIrResumeMetadata } from '../oracleIrServerPromptResumeUtils.js';
import { createChooseThenSacrificeRestBatch } from '../chooseThenSacrificeRestBatch.js';

type SacrificeRestStep = Extract<OracleEffectStep, { kind: 'each_player_choose_then_sacrifice_rest' }>;

function typePhrase(keepTypes: readonly string[], count: number): string {
  const names = keepTypes.map((typeWord) => (count === 1 ? typeWord : `${typeWord}s`));
  if (names.length <= 1) return names[0] || 'permanents';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

function matchingPermanents(battlefield: readonly any[], playerId: string, keepTypes: readonly string[]): any[] {
  return battlefield.filter((permanent) => {
    if (String(permanent?.controller || '').trim() !== playerId) return false;
    return permanentMatchesChooseThenSacrificeKeepTypes(permanent, keepTypes);
  });
}

export function queueEachPlayerChooseThenSacrificeRestPrompts(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    gameId: string;
    step: SacrificeRestStep;
    result: OracleIRExecutionResult;
    irCtx?: OracleIRExecutionContext;
  },
): void {
  const state = (ctx as any).state;
  const step = options.step;
  const controller = options.controller;
  const gameId = options.gameId;
  const irCtx = {
    ...(options.irCtx || {}),
    controllerId: String(options.irCtx?.controllerId || controller),
  } as OracleIRExecutionContext;
  const players = Array.isArray(state?.players) ? state.players : [];
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const turnOrder: PlayerID[] = players
    .map((player: any) => player?.id)
    .filter((playerId: any) => typeof playerId === 'string') as PlayerID[];
  const activePlayerId: PlayerID =
    state?.turnPlayer
    || state?.activePlayerId
    || state?.activePlayer
    || players[state?.activePlayerIndex || 0]?.id
    || controller;
  const sourceId = String(options.item?.id || options.card?.id || options.effectiveCard?.id || '').trim() || undefined;
  const sourceName = String(options.effectiveCard?.name || options.card?.name || 'Spell').trim() || 'Spell';
  const batchId = `${sourceId || uid('choose_sacrifice_rest')}:choose_sacrifice_rest`;
  const mustChoose = new Set(playersWhoMustChooseForSacrificeRest(state, step, irCtx));
  const affectedPlayerIds = chooserPlayerIdsForSacrificeRest(state, step, irCtx);
  const choices: Record<string, string[]> = {};
  const stepConfigs: any[] = [];
  const expectedPlayerIds: string[] = [];
  const phrase = typePhrase(step.keepTypes, step.keepCount);
  const amount = step.upTo ? `up to ${step.keepCount}` : String(step.keepCount);

  for (const playerId of affectedPlayerIds) {
    const owned = matchingPermanents(battlefield, playerId, step.keepTypes);
    if (!mustChoose.has(playerId)) {
      choices[playerId] = owned.map((permanent) => String(permanent?.id || '').trim()).filter(Boolean);
      continue;
    }
    const cap = Math.min(step.keepCount, owned.length);
    expectedPlayerIds.push(playerId);
    stepConfigs.push({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId,
      description: `${sourceName}: choose ${amount} ${phrase} you control to keep. Sacrifice the rest.`,
      mandatory: true,
      sourceId,
      sourceName,
      sourceImage: options.effectiveCard?.image_uris?.small || options.effectiveCard?.image_uris?.normal,
      validTargets: owned.map((permanent) => ({
        id: permanent.id,
        label: permanent.card?.name || phrase,
        description: permanent.card?.type_line || phrase,
        imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
      })),
      targetTypes: [...step.keepTypes],
      minTargets: step.upTo ? 0 : cap,
      maxTargets: cap,
      targetDescription: `${phrase} you control`,
      priority: 0,
      chooseThenSacrificeRestChoice: true,
      chooseThenSacrificeRestBatchId: batchId,
      chooseThenSacrificeRestKeepTypes: [...step.keepTypes],
      chooseThenSacrificeRestKeepCount: step.keepCount,
      chooseThenSacrificeRestUpTo: step.upTo === true,
    });
  }

  if (stepConfigs.length === 0 || !gameId || gameId === 'unknown') {
    debug(2, `[queueEachPlayerChooseThenSacrificeRestPrompts] ${sourceName} had no keep choices to queue`);
    return;
  }

  const resumeCarrier = attachOracleIrResumeMetadata(
    {
      chooseThenSacrificeRestExpectedPlayerIds: expectedPlayerIds,
      chooseThenSacrificeRestAffectedPlayerIds: affectedPlayerIds,
      chooseThenSacrificeRestController: String(controller),
      chooseThenSacrificeRestSourceId: sourceId,
      chooseThenSacrificeRestSourceName: sourceName,
    },
    options.result,
    {
      controller,
      sourceId,
      sourceName,
      irCtx: options.irCtx,
    },
  );

  for (const config of stepConfigs) {
    Object.assign(config, resumeCarrier);
  }

  createChooseThenSacrificeRestBatch(state, {
    id: batchId,
    controller: String(controller),
    sourceId,
    sourceName,
    keepTypes: [...step.keepTypes],
    keepCount: step.keepCount,
    upTo: step.upTo === true,
    affectedPlayerIds,
    expectedPlayerIds,
    choices,
    respondedPlayerIds: Object.keys(choices),
    resumeStepsJson: String(resumeCarrier.oracleIrResumeStepsJson || '').trim() || undefined,
    oracleIrControllerId: String(resumeCarrier.oracleIrControllerId || controller),
    oracleIrSourceId: sourceId,
    oracleIrSourceName: sourceName,
  });

  try {
    const steps = ResolutionQueueManager.addStepsWithAPNAP(
      gameId,
      stepConfigs as any,
      turnOrder as any,
      activePlayerId as any,
    );
    appendQueuedResolutionPromptEvent(ctx, {
      playerId: String(steps[0]?.playerId || expectedPlayerIds[0] || '').trim(),
      sourceId: sourceId || String(steps[0]?.sourceId || '').trim(),
      queuedResolutionSteps: steps as any[],
    });
    debug(2, `[queueEachPlayerChooseThenSacrificeRestPrompts] ${sourceName} queued ${steps.length} keep choice step(s)`);
  } catch (err) {
    debugWarn(1, `[queueEachPlayerChooseThenSacrificeRestPrompts] ${sourceName} failed to queue keep choices:`, err);
  }
}
