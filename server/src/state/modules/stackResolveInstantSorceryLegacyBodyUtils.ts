import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import {
  applyInstantSorceryFracturedIdentityAndFallbackRiders,
  applyInstantSorceryGraveyardConditionalTokenRider,
} from './stackResolveSpellPostCategorizeRidersUtils.js';
import { applyInstantSorceryNibelheimAflameEffect } from './stackResolveSpellSpecialCaseUtils.js';
import {
  logLegacySpellRegexPrimaryMiss,
  applyLegacySpellRegexDrawHandlers,
} from './stackResolveSpellLegacyRegexDrawUtils.js';
import { applyInstantSorceryControlChangeAndMassZoneEffects } from './stackResolveSpellControlChangeUtils.js';
import {
  applyInstantSorceryTokenForEachCreatureHandler,
  applyInstantSorceryLibrarySearchSpellHandlers,
} from './stackResolveSpellLibraryHandlersUtils.js';
import { applyInstantSorceryJoinForcesAndTemptingOfferHandlers } from './stackResolveSpellMultiplayerPromptUtils.js';
import { applyInstantSorceryLibraryTopCardPromptHandlers } from './stackResolveSpellLibraryTopPromptUtils.js';
import { applyInstantSorcerySpecialAndRemovalRiders } from './stackResolveSpellLateRidersUtils.js';
import { applySimpleTargetedTemporarySpellEffects } from './oracleIrSpellLegacyTargetBuffUtils.js';
import { handleDispatch } from './oracleIrSpellLegacyDispatchUtils.js';
import { shouldSkipLegacySpellBodyHandlers } from './oracleIrSpellLegacyRouting.js';
import type { InstantSorceryPrefaceContinuation } from './stackResolveSharedTypes.js';

export type InstantSorceryLegacyBodyResult = {
  readonly shouldEarlyReturn: boolean;
};

export function tryApplyInstantSorceryLegacyBodyHandlers(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    targets: any[];
    spellXValue: unknown;
    oracleText: string;
    oracleTextLower: string;
    uncategorizedSpellFallbackApplied: number;
  },
  preface: InstantSorceryPrefaceContinuation,
): InstantSorceryLegacyBodyResult {
  const {
    controller,
    card,
    effectiveCard,
    item,
    targets,
    spellXValue,
    oracleText,
    oracleTextLower,
    uncategorizedSpellFallbackApplied,
  } = options;
  const {
    oracleIrSpellHandled,
    targetControllerForRemovalEffects,
    targetPowerBeforeRemoval,
  } = preface;
  const spellName = effectiveCard.name || 'spell';

  if (oracleIrSpellHandled && shouldSkipLegacySpellBodyHandlers(oracleText, spellName)) {
    applyInstantSorceryGraveyardConditionalTokenRider(ctx, {
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
    if (preface.isNibelheimAflameStyleSweep && targets.length > 0) {
      applyInstantSorceryNibelheimAflameEffect(ctx, {
        controller,
        effectiveCard,
        item,
        targets,
        isNibelheimAflameStyleSweep: preface.isNibelheimAflameStyleSweep,
        hasNibelheimGraveyardRider: preface.hasNibelheimGraveyardRider,
      });
    }
    logLegacySpellRegexPrimaryMiss(oracleIrSpellHandled, spellName, oracleText);
    debug(
      2,
      `[tryResolveInstantSorceryLegacyResolution] ${spellName}: skipping legacy body handlers (IR primary resolved effect)`,
    );
    return { shouldEarlyReturn: false };
  }

  applySimpleTargetedTemporarySpellEffects(
    ctx,
    oracleText,
    targets,
    spellName,
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

  logLegacySpellRegexPrimaryMiss(oracleIrSpellHandled, spellName, oracleText);

  applyInstantSorceryControlChangeAndMassZoneEffects(ctx, {
    controller,
    effectiveCard,
    item,
    oracleText,
    oracleTextLower,
    targets,
  });

  if (uncategorizedSpellFallbackApplied <= 0) {
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

  if (!preface.oracleIrSpellHandled) {
    const riderResult = applyInstantSorcerySpecialAndRemovalRiders(ctx, {
      controller,
      effectiveCard,
      item,
      oracleTextLower,
      targets,
      targetControllerForRemovalEffects,
      targetPowerBeforeRemoval,
    });
    if (riderResult.shouldEarlyReturn) {
      return { shouldEarlyReturn: true };
    }
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

  return { shouldEarlyReturn: false };
}
