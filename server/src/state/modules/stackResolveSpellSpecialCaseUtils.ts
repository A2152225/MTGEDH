import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { isCreatureNow } from '../creatureTypeNow.js';
import { addTemporaryEtbTrigger } from './triggerEtbEntryEffects.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import {
  clearDivineReckoningChoiceBatch,
  clearPrisonersDilemmaChoiceBatch,
  createDivineReckoningChoiceBatch,
  createPrisonersDilemmaChoiceBatch,
} from './spellLegacyChoiceBatchUtils.js';
import { applySummonsOfSarumanEffect } from './oracleIrSpellLegacySummonsUtils.js';
import { wasSpellCastFromGraveyard } from './stackResolveSpellCopyChoiceUtils.js';
import { isOracleIrSpellPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { applyOracleIRUncategorizedSpellFallback } from './oracleIrUncategorizedSpellFallback.js';

function trampolinePhase4ChoiceFamilySpecialCaseToIr(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    spellXValue: unknown;
  },
): number {
  const oracleText = String(
    options.item?.card?.oracle_text
    || options.effectiveCard?.oracle_text
    || options.card?.oracle_text
    || options.effectiveCard?.oracleText
    || options.card?.oracleText
    || '',
  ).trim();
  if (!oracleText) return 0;

  const spellName = String(options.effectiveCard?.name || options.card?.name || 'spell');
  const sourceId = String(options.item?.id || options.card?.id || options.effectiveCard?.id || '');
  const castFromGraveyard = wasSpellCastFromGraveyard(options.item);
  const xValue = typeof options.spellXValue === 'number' && Number.isFinite(options.spellXValue)
    ? options.spellXValue
    : undefined;

  return applyOracleIRUncategorizedSpellFallback(
    ctx,
    oracleText,
    options.controller,
    spellName,
    xValue,
    undefined,
    sourceId,
    castFromGraveyard,
    buildOracleIRExecutionContext({
      controllerId: options.controller,
      sourceId,
      sourceName: spellName,
      sourceObjectType: 'spell',
      xValue,
      ...(castFromGraveyard ? { castFromZone: 'graveyard' as const } : {}),
    }),
    'spell',
    options.item,
  );
}

function hasMatchingTemporaryEtbWindow(
  state: any,
  options: {
    controller: PlayerID;
    sourceName: string;
    watchTypes: readonly string[];
    effect: string;
  },
): boolean {
  const watchKey = options.watchTypes.map((typeWord) => String(typeWord || '').trim().toLowerCase()).join('|');
  const effect = String(options.effect || '').replace(/[.]+$/g, '').trim();
  return (Array.isArray(state?.temporaryEtbTriggers) ? state.temporaryEtbTriggers : []).some((entry: any) => {
    const entryTypes = Array.isArray(entry?.watchTypes)
      ? entry.watchTypes.map((typeWord: unknown) => String(typeWord || '').trim().toLowerCase()).filter(Boolean)
      : [];
    return String(entry?.controller || '') === String(options.controller)
      && String(entry?.sourceName || '') === options.sourceName
      && entryTypes.join('|') === watchKey
      && String(entry?.effect || entry?.description || '').replace(/[.]+$/g, '').trim() === effect;
  });
}

export function applyInstantSorcerySpecialCaseSpellEffects(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    gameId: string;
    spellXValue: unknown;
    isRiteOfHarmonyStyleWindow: boolean;
    isDivineReckoningStyleChoice: boolean;
    isPrisonersDilemmaStyleChoice: boolean;
    isSummonsOfSarumanStyle: boolean;
    fromOracleIrPromptQueue?: boolean;
  },
): void {
  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const gameId = options.gameId;
  const spellXValue = options.spellXValue;

  // PRIMARY=0 spell resolve still hits this helper (skipLegacy blocks uncategorized).
  // Trampoline to the same IR as production; prompt-queue re-entry must not recurse.
  const shouldTrampolinePhase4ChoiceFamilyToIr = !isOracleIrSpellPrimaryEnabled()
    && options.fromOracleIrPromptQueue !== true
    && (
      options.isRiteOfHarmonyStyleWindow
      || options.isDivineReckoningStyleChoice
      || options.isPrisonersDilemmaStyleChoice
      || options.isSummonsOfSarumanStyle
    );
  if (shouldTrampolinePhase4ChoiceFamilyToIr) {
    const trampolineGameId = String((ctx as any).gameId || gameId || 'unknown');
    const queueBefore = trampolineGameId !== 'unknown'
      ? ResolutionQueueManager.getQueue(trampolineGameId).steps?.length ?? 0
      : 0;
    const applied = trampolinePhase4ChoiceFamilySpecialCaseToIr(ctx, options);
    const queueAfter = trampolineGameId !== 'unknown'
      ? ResolutionQueueManager.getQueue(trampolineGameId).steps?.length ?? 0
      : 0;
    if (applied > 0 || queueAfter > queueBefore) {
      return;
    }
  }

  if (options.isRiteOfHarmonyStyleWindow) {
    const sourceName = String(effectiveCard?.name || 'spell');
    // IR primary already wrote this window (`grant_temporary_etb_trigger`). Replay
    // short-circuits IR-owned spells without re-applying, so only fill when missing.
    if (!hasMatchingTemporaryEtbWindow(state, {
      controller,
      sourceName,
      watchTypes: ['creature', 'enchantment'],
      effect: 'draw a card',
    })) {
      const sourceId = String(item?.source || effectiveCard?.id || item?.id || uid('rite_of_harmony'));
      addTemporaryEtbTrigger(state, {
        id: uid('temporary_etb_trigger'),
        controller: String(controller),
        sourceId,
        sourceName,
        description: 'draw a card',
        effect: 'draw a card',
        watchTypes: ['creature', 'enchantment'],
        triggerType: 'temporary_etb',
        mandatory: true,
        expiresAt: 'end_of_turn',
      });
      debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${sourceName} granted ${controller} a temporary creature/enchantment ETB draw trigger`);
    }
  }

  if (options.isDivineReckoningStyleChoice) {
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
        description: `${effectiveCard?.name || 'Divine Reckoning'}: choose a creature you control to keep. The rest will be destroyed.`,
        mandatory: true,
        sourceId,
        sourceName: effectiveCard?.name || 'Divine Reckoning',
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
        divineReckoningSourceName: effectiveCard?.name || 'Divine Reckoning',
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
        sourceName: effectiveCard?.name || 'Divine Reckoning',
        expectedPlayerIds,
      });

      try {
        const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, stepConfigs as any, turnOrder as any, activePlayerId as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId: String(steps[0]?.playerId || expectedPlayerIds[0] || '').trim(),
          sourceId: sourceId || String(steps[0]?.sourceId || '').trim(),
          queuedResolutionSteps: steps as any[],
        });
        debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || 'Divine Reckoning'} queued ${steps.length} Divine Reckoning survivor choice step(s)`);
      } catch (err) {
        clearDivineReckoningChoiceBatch(state, batchId);
        debugWarn(1, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || 'Divine Reckoning'} failed to queue Divine Reckoning choices:`, err);
      }
    } else {
      clearDivineReckoningChoiceBatch(state, batchId);
      debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || 'Divine Reckoning'} had no creatures to choose for Divine Reckoning`);
    }
  }

  if (options.isPrisonersDilemmaStyleChoice) {
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
    const stepConfigs: any[] = [];
    const expectedPlayerIds: string[] = [];

    for (const player of players) {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === String(controller) || player?.hasLost) continue;

      expectedPlayerIds.push(playerId);
      stepConfigs.push({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        description: `${effectiveCard?.name || "Prisoner's Dilemma"}: secretly choose silence or snitch.`,
        mandatory: true,
        sourceId,
        sourceName: effectiveCard?.name || "Prisoner's Dilemma",
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
        prisonersDilemmaSourceName: effectiveCard?.name || "Prisoner's Dilemma",
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
        sourceName: effectiveCard?.name || "Prisoner's Dilemma",
        expectedPlayerIds,
      });

      try {
        const steps = ResolutionQueueManager.addStepsWithAPNAP(gameId, stepConfigs as any, turnOrder as any, activePlayerId as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId: String(steps[0]?.playerId || expectedPlayerIds[0] || '').trim(),
          sourceId: sourceId || String(steps[0]?.sourceId || '').trim(),
          queuedResolutionSteps: steps as any[],
        });
        debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || "Prisoner's Dilemma"} queued ${steps.length} secret choice step(s)`);
      } catch (err) {
        clearPrisonersDilemmaChoiceBatch(state, batchId);
        debugWarn(1, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || "Prisoner's Dilemma"} failed to queue secret choices:`, err);
      }
    } else {
      clearPrisonersDilemmaChoiceBatch(state, batchId);
      debug(2, `[applyInstantSorcerySpecialCaseSpellEffects] ${effectiveCard?.name || "Prisoner's Dilemma"} had no opponents to choose`);
    }
  }

  if (options.isSummonsOfSarumanStyle) {
    applySummonsOfSarumanEffect(
      ctx,
      controller,
      effectiveCard?.name || 'Summons of Saruman',
      String(item?.id || card?.id || ''),
      effectiveCard?.image_uris?.small || effectiveCard?.image_uris?.normal,
      typeof spellXValue === 'number' && Number.isFinite(spellXValue) ? spellXValue : 0,
    );
  }
}

export function applyInstantSorceryNibelheimAflameEffect(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    item: any;
    targets: any[];
    isNibelheimAflameStyleSweep: boolean;
    hasNibelheimGraveyardRider: boolean;
  },
): void {
  if (!options.isNibelheimAflameStyleSweep || options.targets.length === 0) {
    return;
  }

  // IR primary already applied deal_damage + graveyard conditional.
  if (isOracleIrSpellPrimaryEnabled()) {
    return;
  }

  const oracleText = String(
    options.item?.card?.oracle_text
    || options.effectiveCard?.oracle_text
    || options.effectiveCard?.oracleText
    || '',
  ).trim();
  if (!oracleText) return;

  const targetIds = options.targets
    .map((targetRef: any) => (typeof targetRef === 'string' ? targetRef : String(targetRef?.id || '')))
    .map((id: string) => id.trim())
    .filter(Boolean);
  if (targetIds.length === 0) return;

  const spellName = String(options.effectiveCard?.name || 'spell');
  const sourceId = String(options.item?.id || options.effectiveCard?.id || '');
  const castFromGraveyard = wasSpellCastFromGraveyard(options.item);
  const targetCreatureId = targetIds[0];
  applyOracleIRUncategorizedSpellFallback(
    ctx,
    oracleText,
    options.controller,
    spellName,
    undefined,
    undefined,
    sourceId,
    castFromGraveyard,
    buildOracleIRExecutionContext({
      controllerId: options.controller,
      sourceId,
      sourceName: spellName,
      sourceObjectType: 'spell',
      ...(castFromGraveyard ? { castFromZone: 'graveyard' as const } : {}),
      targetCreatureId,
      targetPermanentId: targetCreatureId,
      selectorContext: {
        targetCreatureId,
        targetPermanentId: targetCreatureId,
        ...(castFromGraveyard ? { castFromZone: 'graveyard' } : {}),
      },
    }),
    'spell',
    options.item,
    targetIds,
  );
}
