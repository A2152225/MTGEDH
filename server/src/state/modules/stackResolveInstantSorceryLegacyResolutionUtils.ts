import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  applyInstantSorcerySpecialCaseSpellEffects,
  applyInstantSorceryNibelheimAflameEffect,
} from './stackResolveSpellSpecialCaseUtils.js';
import { tryApplyInstantSorceryUncategorizedSpellFallback } from './stackResolveSpellUncategorizedUtils.js';
import {
  resolveInstantSorceryGraveyardEffectiveOracleText,
  applyInstantSorceryGraveyardZoneChangeAutomation,
} from './stackResolveSpellGraveyardAutomationUtils.js';
import {
  applyInstantSorceryCopyStackSpellRiders,
  applyInstantSorceryFracturedIdentityAndFallbackRiders,
} from './stackResolveSpellPostCategorizeRidersUtils.js';
import {
  resolveSkipLegacySpellRegexHandlers,
  logLegacySpellRegexPrimaryMiss,
  applyLegacySpellRegexLifeGainHandler,
  applyLegacySpellRegexDrawHandlers,
} from './stackResolveSpellLegacyRegexDrawUtils.js';
import { applyInstantSorceryControlChangeAndMassZoneEffects } from './stackResolveSpellControlChangeUtils.js';
import {
  applyInstantSorceryTokenForEachCreatureHandler,
  applyInstantSorceryLibrarySearchSpellHandlers,
} from './stackResolveSpellLibraryHandlersUtils.js';
import { applyInstantSorceryJoinForcesAndTemptingOfferHandlers } from './stackResolveSpellMultiplayerPromptUtils.js';
import { applyInstantSorceryLibraryTopCardPromptHandlers } from './stackResolveSpellLibraryTopPromptUtils.js';
import { finalizeResolvedInstantOrSorceryResolution } from './stackResolveSpellZoneUtils.js';
import { applyInstantSorcerySpecialAndRemovalRiders } from './stackResolveSpellLateRidersUtils.js';
import { applyGraveyardPermissionEffectsFromText } from './graveyard-permissions.js';
import { applySimpleTargetedTemporarySpellEffects } from './oracleIrSpellLegacyTargetBuffUtils.js';
import { handleDispatch } from './oracleIrSpellLegacyDispatchUtils.js';
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
    targetControllerForRemovalEffects,
    targetPowerBeforeRemoval,
  } = preface;

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

  applyInstantSorceryNibelheimAflameEffect(ctx, {
    controller,
    effectiveCard,
    item,
    targets,
    isNibelheimAflameStyleSweep,
    hasNibelheimGraveyardRider,
  });

  const uncategorizedSpellFallbackApplied = tryApplyInstantSorceryUncategorizedSpellFallback(ctx, {
    oracleIrSpellHandled,
    spellSpec,
    skipLegacySpellCategorization,
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
  });

  applySimpleTargetedTemporarySpellEffects(
    ctx,
    oracleText,
    targets,
    effectiveCard.name || 'spell',
  );

  handleDispatch(ctx, card, controller, targets, (ctx as any).state);

  applyInstantSorceryFracturedIdentityAndFallbackRiders(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    oracleText,
    oracleTextLower,
    targets,
    spellXValue,
    uncategorizedSpellFallbackApplied,
  });

  const skipLegacySpellRegexHandlers = resolveSkipLegacySpellRegexHandlers(
    oracleIrSpellHandled,
    oracleText,
    effectiveCard.name || 'spell',
  );
  logLegacySpellRegexPrimaryMiss(
    oracleIrSpellHandled,
    effectiveCard.name || 'spell',
    oracleText,
  );

  if (!skipLegacySpellRegexHandlers) {
    applyLegacySpellRegexLifeGainHandler(ctx, {
      controller,
      effectiveCard,
      oracleTextLower,
      spellXValue,
    });
  }

  applyInstantSorceryControlChangeAndMassZoneEffects(ctx, {
    controller,
    effectiveCard,
    item,
    oracleText,
    oracleTextLower,
    targets,
  });

  if (!skipLegacySpellRegexHandlers) {
    applyLegacySpellRegexDrawHandlers(ctx, {
      controller,
      effectiveCard,
      oracleTextLower,
    });
  }

  applyInstantSorceryTokenForEachCreatureHandler(ctx, {
    controller,
    effectiveCard,
    oracleTextLower,
  });

  applyInstantSorceryLibrarySearchSpellHandlers(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    oracleText,
    oracleTextLower,
  });

  const riderResult = applyInstantSorcerySpecialAndRemovalRiders(ctx, {
    controller,
    effectiveCard,
    item,
    oracleTextLower,
    targets,
    targetControllerForRemovalEffects: targetControllerForRemovalEffects,
    targetPowerBeforeRemoval,
  });
  if (riderResult.shouldEarlyReturn) {
    return true;
  }

  applyInstantSorceryJoinForcesAndTemptingOfferHandlers(ctx, {
    controller,
    effectiveCard,
    item,
    oracleText,
    oracleTextLower,
  });

  applyInstantSorceryLibraryTopCardPromptHandlers(ctx, {
    controller,
    effectiveCard,
    item,
    oracleTextLower,
    spellXValue,
    targets,
  });

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

  return false;
}
