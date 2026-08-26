import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { addTemporaryEtbTrigger } from './triggerEtbEntryEffects.js';
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
  // Trampoline to the same IR as production. Divine/Prisoner prompts are queued
  // from IR choice-family → oracleIrServerChooseDestroyRestSecretDamagePrompts,
  // not from this function.
  const shouldTrampolinePhase4ChoiceFamilyToIr = !isOracleIrSpellPrimaryEnabled()
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
