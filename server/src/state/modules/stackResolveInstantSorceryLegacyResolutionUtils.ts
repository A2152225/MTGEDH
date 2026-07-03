import type { GameContext } from '../context.js';
import {
  applyInstantSorcerySpecialCaseSpellEffects,
} from './stackResolveSpellSpecialCaseUtils.js';
import { tryApplyInstantSorceryUncategorizedSpellFallback } from './stackResolveSpellUncategorizedUtils.js';
import {
  resolveInstantSorceryGraveyardEffectiveOracleText,
  applyInstantSorceryGraveyardZoneChangeAutomation,
} from './stackResolveSpellGraveyardAutomationUtils.js';
import {
  applyInstantSorceryCopyStackSpellRiders,
} from './stackResolveSpellPostCategorizeRidersUtils.js';
import { tryApplyInstantSorceryLegacyBodyHandlers } from './stackResolveInstantSorceryLegacyBodyUtils.js';
import {
  tryHandleInstantSorceryLegacyModalResolution,
} from './stackResolveSpellLegacyModalUtils.js';
import { finalizeResolvedInstantOrSorceryResolution } from './stackResolveSpellZoneUtils.js';
import { applyGraveyardPermissionEffectsFromText } from './graveyard-permissions.js';
import { resyncPreparedExileCopiesWithControllers } from './prepared.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import type {
  InstantSorceryPrefaceContinuation,
  InstantSorceryStackResolveOptions,
} from './stackResolveSharedTypes.js';

export function tryResolveInstantSorceryLegacyResolution(
  ctx: GameContext,
  options: InstantSorceryStackResolveOptions,
  preface: InstantSorceryPrefaceContinuation,
): boolean {
  const { controller, card, effectiveCard, item, targets, spellXValue, executeTriggerEffect } = options;
  const bumpSeq = typeof (ctx as any).bumpSeq === 'function' ? (ctx as any).bumpSeq.bind(ctx) : undefined;
  const gameId = (ctx as any).gameId || 'unknown';
  const {
    oracleText,
    oracleTextLower,
    isRiteOfHarmonyStyleWindow,
    isDivineReckoningStyleChoice,
    isPrisonersDilemmaStyleChoice,
    isSummonsOfSarumanStyle,
    isNibelheimAflameStyleSweep,
    hasNibelheimGraveyardRider,
    spellSpec,
    oracleIrSpellHandled,
    skipLegacySpellCategorization,
  } = preface;

  if (oracleIrSpellHandled) {
    const gameId = String((ctx as any).gameId || 'unknown');
    const pendingResolutionSteps = gameId !== 'unknown'
      ? ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0
      : 0;
    if (pendingResolutionSteps > 0) {
      // CR 608.2m: a spell finishes resolving (and moves to the graveyard) only after
      // all of its instructions are carried out. While IR-queued choices are pending,
      // keep the item on the stack; maybeResumeDeferredOracleIrStackSpell finalizes it
      // once the resolution queue empties.
      const state = (ctx as any).state;
      state.stack = state.stack || [];
      state.stack.push({ ...item, oracleIrDeferredFinalize: true });
      resyncPreparedExileCopiesWithControllers(state);
      return true;
    }
  }

  if ((item as any)?.oracleIrDeferredFinalize === true) {
    if (finalizeResolvedInstantOrSorceryResolution(ctx, {
      controller,
      card,
      effectiveCard,
      item,
      oracleText,
      oracleTextLower,
    })) {
      bumpSeq?.();
      return true;
    }
    resyncPreparedExileCopiesWithControllers((ctx as any).state);
    return true;
  }

  applyInstantSorcerySpecialCaseSpellEffects(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    gameId,
    spellXValue,
    isRiteOfHarmonyStyleWindow,
    isDivineReckoningStyleChoice,
    isPrisonersDilemmaStyleChoice,
    isSummonsOfSarumanStyle,
  });

  const legacyModalOutcome = tryHandleInstantSorceryLegacyModalResolution(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    targets,
    spellXValue,
    oracleText,
  });

  if (legacyModalOutcome === 'queued') {
    const state = (ctx as any).state;
    state.stack = state.stack || [];
    state.stack.push(item);
    return true;
  }

  const legacySelectedModalApplied = legacyModalOutcome === 'applied';

  const uncategorizedSpellFallbackApplied = tryApplyInstantSorceryUncategorizedSpellFallback(ctx, {
    oracleIrSpellHandled,
    spellSpec,
    skipLegacySpellCategorization: skipLegacySpellCategorization || legacySelectedModalApplied,
    oracleText,
    effectiveCard,
    controller,
    spellXValue,
    item,
    card,
  });

  const graveyardEffectiveOracleText = resolveInstantSorceryGraveyardEffectiveOracleText(item, oracleText);
  applyInstantSorceryGraveyardZoneChangeAutomation(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    targets,
    graveyardEffectiveOracleText,
    executeTriggerEffect,
  });

  applyGraveyardPermissionEffectsFromText(
    ctx,
    controller,
    effectiveCard.name || 'spell',
    graveyardEffectiveOracleText,
    item,
  );

  applyInstantSorceryCopyStackSpellRiders(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    oracleText,
    oracleTextLower,
    targets,
    spellXValue,
    uncategorizedSpellFallbackApplied,
    oracleIrSpellHandled,
  });

  const legacyBodyResult = legacySelectedModalApplied
    ? { shouldEarlyReturn: false }
    : tryApplyInstantSorceryLegacyBodyHandlers(
      ctx,
      {
        controller,
        card,
        effectiveCard,
        item,
        targets,
        spellXValue,
        oracleText,
        oracleTextLower,
        uncategorizedSpellFallbackApplied,
      },
      preface,
    );
  if (legacyBodyResult.shouldEarlyReturn) {
    resyncPreparedExileCopiesWithControllers((ctx as any).state);
    return true;
  }

  if (finalizeResolvedInstantOrSorceryResolution(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    oracleText,
    oracleTextLower,
  })) {
    bumpSeq?.();
    return true;
  }

  resyncPreparedExileCopiesWithControllers((ctx as any).state);
  return false;
}
