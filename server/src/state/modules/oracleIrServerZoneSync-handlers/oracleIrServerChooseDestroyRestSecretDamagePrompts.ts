// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerChooseDestroyRestSecretDamagePrompts.ts
// Origin parent: server/src/state/modules/stackResolveSpellSpecialCaseUtils.ts
// Cluster: queue APNAP survivor TARGET_SELECTION (each_player_choose_then_destroy_rest)
//   and secret silence/snitch OPTION_CHOICE (secret_opponent_choice_damage).
// Public: queueEachPlayerChooseThenDestroyRestPrompts,
//   queueSecretOpponentChoiceDamagePrompts
// Called from oracleIrServerChoiceFamilyPrompts (and tests). Not part of the
// public API. Leaf must not import oracleIrServerZoneSync.ts, the handlers
// index, or stackResolveSpellSpecialCaseUtils.ts.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import { uid } from '../../utils.js';
import { debug, debugWarn } from '../../../utils/debug.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { isCreatureNow } from '../../creatureTypeNow.js';
import { appendQueuedResolutionPromptEvent } from '../resolutionPromptEvents.js';
import {
  clearDivineReckoningChoiceBatch,
  clearPrisonersDilemmaChoiceBatch,
  createDivineReckoningChoiceBatch,
  createPrisonersDilemmaChoiceBatch,
} from '../spellLegacyChoiceBatchUtils.js';

export function queueEachPlayerChooseThenDestroyRestPrompts(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    gameId: string;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const gameId = options.gameId;
  const players = Array.isArray(state.players) ? state.players : [];
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const turnOrder: PlayerID[] = players
    .map((player: any) => player?.id)
    .filter((playerId: any) => typeof playerId === 'string') as PlayerID[];
  const activePlayerId: PlayerID =
    state?.turnPlayer ||
    state?.activePlayerId ||
    state?.activePlayer ||
    players[state?.activePlayerIndex || 0]?.id ||
    controller;
  const batchId = `${String(item?.id || card?.id || effectiveCard?.id || uid('divine_reckoning'))}:divine_reckoning`;
  const sourceId = String(item?.id || card?.id || effectiveCard?.id || '').trim() || undefined;
  const sourceName = String(effectiveCard?.name || 'Divine Reckoning');
  const stepConfigs: any[] = [];
  const expectedPlayerIds: string[] = [];

  for (const player of players) {
    const playerId = String(player?.id || '').trim();
    if (!playerId || player?.hasLost) continue;

    const validTargets = battlefield
      .filter((permanent: any) => permanent && String(permanent.controller || '') === playerId)
      .filter((permanent: any) => isCreatureNow(permanent))
      .map((permanent: any) => ({
        id: permanent.id,
        label: permanent.card?.name || 'Creature',
        description: permanent.card?.type_line || 'creature',
        imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
      }));

    if (validTargets.length === 0) continue;

    expectedPlayerIds.push(playerId);
    stepConfigs.push({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId,
      description: `${sourceName}: choose a creature you control to keep. The rest will be destroyed.`,
      mandatory: true,
      sourceId,
      sourceName,
      sourceImage: effectiveCard?.image_uris?.small || effectiveCard?.image_uris?.normal,
      validTargets,
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'creature you control',
      priority: 0,
      divineReckoningChoice: true,
      divineReckoningBatchId: batchId,
      divineReckoningExpectedPlayerIds: expectedPlayerIds,
      divineReckoningController: String(controller),
      divineReckoningSourceId: sourceId,
      divineReckoningSourceName: sourceName,
    });
  }

  if (stepConfigs.length > 0 && gameId && gameId !== 'unknown') {
    for (const config of stepConfigs) {
      config.divineReckoningExpectedPlayerIds = [...expectedPlayerIds];
    }

    createDivineReckoningChoiceBatch(state, {
      id: batchId,
      controller: String(controller),
      sourceId,
      sourceName,
      expectedPlayerIds,
    });

    try {
      const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, stepConfigs as any, turnOrder as any, activePlayerId as any);
      appendQueuedResolutionPromptEvent(ctx, {
        playerId: String(steps[0]?.playerId || expectedPlayerIds[0] || '').trim(),
        sourceId: sourceId || String(steps[0]?.sourceId || '').trim(),
        queuedResolutionSteps: steps as any[],
      });
      debug(2, `[queueEachPlayerChooseThenDestroyRestPrompts] ${sourceName} queued ${steps.length} survivor choice step(s)`);
    } catch (err) {
      clearDivineReckoningChoiceBatch(state, batchId);
      debugWarn(1, `[queueEachPlayerChooseThenDestroyRestPrompts] ${sourceName} failed to queue survivor choices:`, err);
    }
  } else {
    clearDivineReckoningChoiceBatch(state, batchId);
    debug(2, `[queueEachPlayerChooseThenDestroyRestPrompts] ${sourceName} had no creatures to choose`);
  }
}

export function queueSecretOpponentChoiceDamagePrompts(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    gameId: string;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const gameId = options.gameId;
  const players = Array.isArray(state.players) ? state.players : [];
  const turnOrder: PlayerID[] = players
    .map((player: any) => player?.id)
    .filter((playerId: any) => typeof playerId === 'string') as PlayerID[];
  const activePlayerId: PlayerID =
    state?.turnPlayer ||
    state?.activePlayerId ||
    state?.activePlayer ||
    players[state?.activePlayerIndex || 0]?.id ||
    controller;
  const batchId = `${String(item?.id || card?.id || effectiveCard?.id || uid('prisoners_dilemma'))}:prisoners_dilemma`;
  const sourceId = String(item?.id || card?.id || effectiveCard?.id || '').trim() || undefined;
  const sourceName = String(effectiveCard?.name || "Prisoner's Dilemma");
  const stepConfigs: any[] = [];
  const expectedPlayerIds: string[] = [];

  for (const player of players) {
    const playerId = String(player?.id || '').trim();
    if (!playerId || playerId === String(controller) || player?.hasLost) continue;

    expectedPlayerIds.push(playerId);
    stepConfigs.push({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: `${sourceName}: secretly choose silence or snitch.`,
      mandatory: true,
      sourceId,
      sourceName,
      sourceImage: effectiveCard?.image_uris?.small || effectiveCard?.image_uris?.normal,
      options: [
        { id: 'silence', label: 'Silence' },
        { id: 'snitch', label: 'Snitch' },
      ],
      minSelections: 1,
      maxSelections: 1,
      priority: 0,
      prisonersDilemmaChoice: true,
      secretChoice: true,
      prisonersDilemmaBatchId: batchId,
      prisonersDilemmaExpectedPlayerIds: expectedPlayerIds,
      prisonersDilemmaController: String(controller),
      prisonersDilemmaSourceId: sourceId,
      prisonersDilemmaSourceName: sourceName,
    });
  }

  if (stepConfigs.length > 0 && gameId && gameId !== 'unknown') {
    for (const config of stepConfigs) {
      config.prisonersDilemmaExpectedPlayerIds = [...expectedPlayerIds];
    }

    createPrisonersDilemmaChoiceBatch(state, {
      id: batchId,
      controller: String(controller),
      sourceId,
      sourceName,
      expectedPlayerIds,
    });

    try {
      const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, stepConfigs as any, turnOrder as any, activePlayerId as any);
      appendQueuedResolutionPromptEvent(ctx, {
        playerId: String(steps[0]?.playerId || expectedPlayerIds[0] || '').trim(),
        sourceId: sourceId || String(steps[0]?.sourceId || '').trim(),
        queuedResolutionSteps: steps as any[],
      });
      debug(2, `[queueSecretOpponentChoiceDamagePrompts] ${sourceName} queued ${steps.length} secret choice step(s)`);
    } catch (err) {
      clearPrisonersDilemmaChoiceBatch(state, batchId);
      debugWarn(1, `[queueSecretOpponentChoiceDamagePrompts] ${sourceName} failed to queue secret choices:`, err);
    }
  } else {
    clearPrisonersDilemmaChoiceBatch(state, batchId);
    debug(2, `[queueSecretOpponentChoiceDamagePrompts] ${sourceName} had no opponents to choose`);
  }
}
