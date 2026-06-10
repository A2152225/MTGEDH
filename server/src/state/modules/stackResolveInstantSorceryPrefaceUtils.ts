import type { GameContext } from '../context.js';import { resolveGiftAwareOracleText } from '../../utils/gift.js';
import { detectInstantSorcerySpellShapeFlags } from './oracleIrSpellLegacySpellShapeUtils.js';
import { tryResolveInstantSorceryPreResolutionChoices } from './stackResolveSpellChoiceUtils.js';
import { tryResolveAcademicProbationSpellEffects } from './stackResolveSpellAcademicProbationUtils.js';
import { captureInstantSorceryRemovalTargetMetadata } from './stackResolveSpellTargetMetadataUtils.js';
import { tryResolveInstantSorceryOracleIrSpell } from './stackResolveSpellOracleIrUtils.js';
import { executeInstantSorceryLegacyCategorizedSpell } from './stackResolveSpellLegacySpecUtils.js';
import type { InstantSorceryPrefaceOptions, InstantSorceryPrefaceResult } from './stackResolveSharedTypes.js';

export type { InstantSorceryPrefaceContinuation, InstantSorceryPrefaceResult } from './stackResolveSharedTypes.js';

export function tryResolveInstantSorceryPreface(
  ctx: GameContext,
  options: InstantSorceryPrefaceOptions,
): InstantSorceryPrefaceResult {
  const { controller, card, effectiveCard, item, targets, spellXValue } = options;
  const isReplaying = !!(ctx as any).isReplaying;

  const oracleText = resolveGiftAwareOracleText(
    effectiveCard.oracle_text || '',
    Boolean((item as any)?.giftPromised ?? (item as any)?.card?.giftPromised),
  );
  const oracleTextLower = oracleText.toLowerCase();
  const {
    skipLegacySpellCategorization,
    isRiteOfHarmonyStyleWindow,
    isDivineReckoningStyleChoice,
    isPrisonersDilemmaStyleChoice,
    isSummonsOfSarumanStyle,
    isNibelheimAflameStyleSweep,
    hasNibelheimGraveyardRider,
  } = detectInstantSorcerySpellShapeFlags(String(effectiveCard.name || ''), oracleTextLower);

  if (tryResolveInstantSorceryPreResolutionChoices(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    oracleText,
    oracleTextLower,
    isReplaying,
  })) {
    return { handled: true };
  }

  const existingChosenColor = (card as any)?.chosenColor || (item as any)?.chosenColor;
  const existingChosenCreatureType = String((card as any)?.chosenCreatureType || (item as any)?.chosenCreatureType || '').trim();
  const selectedModes = Array.isArray((item as any)?.selectedModes)
    ? (item as any).selectedModes
    : Array.isArray((card as any)?.selectedModes)
      ? (card as any).selectedModes
      : [];

  if (tryResolveAcademicProbationSpellEffects(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    targets,
    selectedModes,
    isReplaying,
  })) {
    return { handled: true };
  }

  const removalTargetMetadata = captureInstantSorceryRemovalTargetMetadata(ctx, {
    targets,
    effectiveCard,
    oracleTextLower,
  });
  const {
    targetControllerForTokenCreation,
    targetControllerForRemovalEffects,
    targetPowerBeforeRemoval,
    targetSpellControllerForSupplemental,
    targetSpellNameForSupplemental,
  } = removalTargetMetadata;

  const oracleIrSpellOutcome = tryResolveInstantSorceryOracleIrSpell(ctx, {
    controller,
    card,
    effectiveCard,
    item,
    oracleText,
    targets,
    spellXValue,
    selectedModes,
    existingChosenColor,
    existingChosenCreatureType,
    skipLegacySpellCategorization,
  });

  if (oracleIrSpellOutcome.spellSpec && !oracleIrSpellOutcome.oracleIrSpellHandled) {
    executeInstantSorceryLegacyCategorizedSpell(ctx, {
      controller,
      card,
      effectiveCard,
      item,
      oracleText,
      targets,
      spellSpec: oracleIrSpellOutcome.spellSpec,
      spellXValue,
      targetSpellControllerForSupplemental,
      targetSpellNameForSupplemental,
      targetControllerForTokenCreation,
    });
  }

  return {
    handled: false,
    oracleText,
    oracleTextLower,
    isRiteOfHarmonyStyleWindow,
    isDivineReckoningStyleChoice,
    isPrisonersDilemmaStyleChoice,
    isSummonsOfSarumanStyle,
    isNibelheimAflameStyleSweep,
    hasNibelheimGraveyardRider,
    skipLegacySpellCategorization,
    ...oracleIrSpellOutcome,
    ...removalTargetMetadata,
  };
}
