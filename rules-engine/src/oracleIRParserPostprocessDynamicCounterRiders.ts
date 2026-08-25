/**
 * Dynamic counter rider expansion for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 13145-13492 of the
 * pre-split file).
 * Cluster moved: expandDynamicCounterRiderSteps, the dispatcher that walks a parsed step list
 * and re-runs every compound-step splitter and unknown re-parser in a fixed order, plus its
 * ability-level wrapper.
 * Public entry symbols: expandDynamicCounterRiderAbilities, and expandDynamicCounterRiderSteps
 * re-exported at the foot of this file for the postprocess parent.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import {
  parseDynamicCounterRider,
  parseLifeTailStep,
  parseSimpleCounterTailStep,
  splitCounterAndDrawStep,
  splitDrawAndLifeStep,
  splitExileAndCounterRiderStep,
  splitGainLifeAndDrawStep,
  splitLifeAndDrawStep,
  stripMalformedDynamicWithCounters,
} from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import {
  parseChooseAndPutCounterUnknownStep,
  parseClauseUnknownStep,
  parseConditionalLifeUnknownStep,
  parseDiscardUnknownStep,
  parseDrawReplacementGainLifeUnknownStep,
  parseLifeUnknownStep,
  parsePrefixedTapCounterUnknownStep,
  parseQualifiedLifeUnknownStep,
  parseResultLifeUnknownStep,
  parseTrailingCommaLifeUnknownStep,
  parseTriggeredIfCounterUnknownStep,
  parseTriggeredLifeUnknownStep,
  splitAddManaAndLoseLifeUnknownStep,
  splitDamageAndLifeUnknownStep,
  splitDestroyAndCantBlockStep,
  splitDestroyAndNoCombatDamageStep,
  splitDestroyUnlessDamageStep,
  splitDiscardAndLifeStep,
  splitDiscardMillLifeFromMalformedDiscardStep,
  splitDiscardMillLifeStep,
  splitDiscardMillLifeUnknownStep,
  splitMillAndLifeUnknownStep,
  splitMillDrawLifeStep,
  splitMoveZoneAndLifeUnknownStep,
  splitSacrificeAndLifeStep,
  splitTapAndCounterStep,
} from './oracleIRParserPostprocessDiscardMillLifeStepSplitters';
import {
  pruneMalformedAbilitySteps,
  splitCommaChainedPlayerEffectStep,
  splitDrawAndCreatureBuffStep,
  splitDrawAndDiscardStep,
  splitDrawCreateTreasureStep,
  splitDrawUntapTailStep,
  splitGainLifeDrawLeadFromDrawStep,
  splitMisparseVillainousChoiceDrawStep,
  stripQuotedDrawBleedStep,
} from './oracleIRParserPostprocessDrawDiscardStepSplitters';
import {
  parseEnterAsCopyUnknownStep,
  parseForAnyNumberOpponentsDestroyUnknownStep,
  parseForEachGainLifeUnknownStep,
  parseForEachLifePairUnknownStep,
  parseForEachManaGainLifeUnknownStep,
  parseLibrarySearchUnknownStep,
  parseLifePairUnknownStep,
  parsePrefixedDestroyUnknownStep,
  parseTimedDestroyUnknownStep,
  parseUntilEndTriggeredLifeUnknownStep,
  parseWrappedDestroyUnknownStep,
} from './oracleIRParserPostprocessLifeDestroyLibrarySearchSteps';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { normalizeClauseForParse, normalizeOracleText } from './oracleIRParserUtils';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';

function expandDynamicCounterRiderSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const expanded: OracleEffectStep[] = [];

  for (const step of steps) {
    let cleanedStep = stripMalformedDynamicWithCounters(step);
    if (cleanedStep.kind === 'conditional') {
      const originalNestedSteps = cleanedStep.steps;
      const nestedSteps = expandDynamicCounterRiderSteps(originalNestedSteps);
      if (nestedSteps.length !== originalNestedSteps.length || nestedSteps.some((nested, index) => nested !== originalNestedSteps[index])) {
        cleanedStep = { ...cleanedStep, steps: nestedSteps };
      }
    }
    if (cleanedStep.kind === 'choose_mode') {
      const chooseMode = cleanedStep as Extract<OracleEffectStep, { kind: 'choose_mode' }>;
      if (Array.isArray(chooseMode.modes)) {
      const modes = chooseMode.modes.map((mode) => ({
        ...mode,
        steps: expandDynamicCounterRiderSteps(mode.steps || []),
      }));
      if (modes.some((mode, index) => mode.steps !== chooseMode.modes[index]?.steps)) {
        cleanedStep = { ...chooseMode, modes };
      }
      }
    }
    if (cleanedStep.kind === 'schedule_delayed_trigger' && !cleanedStep.steps) {
      const effect = normalizeOracleText(String(cleanedStep.effect || '')).trim();
      const followup = effect.replace(/^when you do(?: so)?,?\s*/i, '').trim();
      const nestedClause = normalizeClauseForParse(followup);
      const parsed = parseSimpleCounterTailStep(effect)
        ?? parseLifeTailStep(effect)
        ?? tryParseZoneAndRemovalClause({
          clause: nestedClause.clause,
          rawClause: followup,
          withMeta: <T extends OracleEffectStep>(value: T) => value,
        })
        ?? tryParseSimpleActionClause({
          clause: nestedClause.clause,
          rawClause: followup,
          withMeta: <T extends OracleEffectStep>(value: T) => value,
        });
      if (parsed && parsed.kind !== 'unknown') {
        cleanedStep = { ...cleanedStep, steps: [parsed] };
      }
    }
    const splitExile = splitExileAndCounterRiderStep(cleanedStep);
    if (splitExile) {
      expanded.push(...splitExile);
      continue;
    }
    const splitDraw = splitCounterAndDrawStep(cleanedStep);
    if (splitDraw) {
      expanded.push(...splitDraw);
      continue;
    }
    const splitLifeDraw = splitLifeAndDrawStep(cleanedStep);
    if (splitLifeDraw) {
      expanded.push(...splitLifeDraw);
      continue;
    }
    const splitDrawLife = splitDrawAndLifeStep(cleanedStep);
    if (splitDrawLife) {
      expanded.push(...splitDrawLife);
      continue;
    }
    const splitDrawDiscard = splitDrawAndDiscardStep(cleanedStep);
    if (splitDrawDiscard) {
      expanded.push(...splitDrawDiscard);
      continue;
    }
    const splitDrawUntap = splitDrawUntapTailStep(cleanedStep);
    if (splitDrawUntap) {
      expanded.push(...splitDrawUntap);
      continue;
    }
    const splitGainLifeDrawLead = splitGainLifeDrawLeadFromDrawStep(cleanedStep);
    if (splitGainLifeDrawLead) {
      expanded.push(...splitGainLifeDrawLead);
      continue;
    }
    const splitDrawBuff = splitDrawAndCreatureBuffStep(cleanedStep);
    if (splitDrawBuff) {
      expanded.push(...splitDrawBuff);
      continue;
    }
    const villainousChoice = splitMisparseVillainousChoiceDrawStep(cleanedStep);
    if (villainousChoice) {
      expanded.push(villainousChoice);
      continue;
    }
    const splitCommaChain = splitCommaChainedPlayerEffectStep(cleanedStep);
    if (splitCommaChain) {
      expanded.push(...splitCommaChain);
      continue;
    }
    const strippedDrawBleed = stripQuotedDrawBleedStep(cleanedStep);
    if (strippedDrawBleed) {
      expanded.push(strippedDrawBleed);
      continue;
    }
    const splitDrawTreasure = splitDrawCreateTreasureStep(cleanedStep);
    if (splitDrawTreasure) {
      expanded.push(...splitDrawTreasure);
      continue;
    }
    if (cleanedStep.kind === 'grant_static_ability' || cleanedStep.kind === 'grant_temporary_ability') {
      const nestedSteps = Array.isArray((cleanedStep as unknown as { steps?: OracleEffectStep[] }).steps)
        ? ((cleanedStep as unknown as { steps?: OracleEffectStep[] }).steps as unknown as OracleEffectStep[])
        : [];
      if (nestedSteps.length > 0) {
        const expandedNested = expandDynamicCounterRiderSteps(nestedSteps);
        if (expandedNested.length !== nestedSteps.length || expandedNested.some((nested, index) => nested !== nestedSteps[index])) {
          cleanedStep = { ...cleanedStep, steps: expandedNested };
        }
      }
    }
    const splitGainLifeDraw = splitGainLifeAndDrawStep(cleanedStep);
    if (splitGainLifeDraw) {
      expanded.push(...splitGainLifeDraw);
      continue;
    }
    const splitMillDrawLife = splitMillDrawLifeStep(cleanedStep);
    if (splitMillDrawLife) {
      expanded.push(...splitMillDrawLife);
      continue;
    }
    const splitDiscardLife = splitDiscardAndLifeStep(cleanedStep);
    if (splitDiscardLife) {
      expanded.push(...splitDiscardLife);
      continue;
    }
    const splitDiscardMillLife = splitDiscardMillLifeStep(cleanedStep);
    if (splitDiscardMillLife) {
      expanded.push(...splitDiscardMillLife);
      continue;
    }
    const splitMalformedDiscardMillLife = splitDiscardMillLifeFromMalformedDiscardStep(cleanedStep);
    if (splitMalformedDiscardMillLife) {
      expanded.push(...splitMalformedDiscardMillLife);
      continue;
    }
    const splitDiscardMillLifeUnknown = splitDiscardMillLifeUnknownStep(cleanedStep);
    if (splitDiscardMillLifeUnknown) {
      expanded.push(...splitDiscardMillLifeUnknown);
      continue;
    }
    const parsedDiscardUnknown = parseDiscardUnknownStep(cleanedStep);
    if (parsedDiscardUnknown) {
      expanded.push(parsedDiscardUnknown);
      continue;
    }
    const splitSacrificeLife = splitSacrificeAndLifeStep(cleanedStep);
    if (splitSacrificeLife) {
      expanded.push(...splitSacrificeLife);
      continue;
    }
    const splitTap = splitTapAndCounterStep(cleanedStep);
    if (splitTap) {
      expanded.push(...splitTap);
      continue;
    }
    const chooseCounter = parseChooseAndPutCounterUnknownStep(cleanedStep);
    if (chooseCounter) {
      expanded.push(chooseCounter);
      continue;
    }
    const triggeredCounter = parseTriggeredIfCounterUnknownStep(cleanedStep);
    if (triggeredCounter) {
      expanded.push(triggeredCounter);
      continue;
    }
    const triggeredLife = parseTriggeredLifeUnknownStep(cleanedStep);
    if (triggeredLife) {
      expanded.push(triggeredLife);
      continue;
    }
    const conditionalLife = parseConditionalLifeUnknownStep(cleanedStep);
    if (conditionalLife) {
      expanded.push(conditionalLife);
      continue;
    }
    const qualifiedLife = parseQualifiedLifeUnknownStep(cleanedStep);
    if (qualifiedLife) {
      expanded.push(qualifiedLife);
      continue;
    }
    const forEachLifePair = parseForEachLifePairUnknownStep(cleanedStep);
    if (forEachLifePair) {
      expanded.push(...forEachLifePair);
      continue;
    }
    const lifePair = parseLifePairUnknownStep(cleanedStep);
    if (lifePair) {
      expanded.push(...lifePair);
      continue;
    }
    const untilEndLife = parseUntilEndTriggeredLifeUnknownStep(cleanedStep);
    if (untilEndLife) {
      expanded.push(untilEndLife);
      continue;
    }
    const forAnyOpponentsDestroy = parseForAnyNumberOpponentsDestroyUnknownStep(cleanedStep);
    if (forAnyOpponentsDestroy) {
      expanded.push(forAnyOpponentsDestroy);
      continue;
    }
    const prefixedDestroy = parsePrefixedDestroyUnknownStep(cleanedStep);
    if (prefixedDestroy) {
      expanded.push(prefixedDestroy);
      continue;
    }
    const timedDestroy = parseTimedDestroyUnknownStep(cleanedStep);
    if (timedDestroy) {
      expanded.push(timedDestroy);
      continue;
    }
    const wrappedDestroy = parseWrappedDestroyUnknownStep(cleanedStep);
    if (wrappedDestroy) {
      expanded.push(wrappedDestroy);
      continue;
    }
    const librarySearch = parseLibrarySearchUnknownStep(cleanedStep);
    if (librarySearch) {
      expanded.push(librarySearch);
      continue;
    }
    const forEachManaGainLife = parseForEachManaGainLifeUnknownStep(cleanedStep);
    if (forEachManaGainLife) {
      expanded.push(forEachManaGainLife);
      continue;
    }
    const forEachGainLife = parseForEachGainLifeUnknownStep(cleanedStep);
    if (forEachGainLife) {
      expanded.push(forEachGainLife);
      continue;
    }
    const enterAsCopy = parseEnterAsCopyUnknownStep(cleanedStep);
    if (enterAsCopy) {
      expanded.push(enterAsCopy);
      continue;
    }
    const replacementGainLife = parseDrawReplacementGainLifeUnknownStep(cleanedStep);
    if (replacementGainLife) {
      expanded.push(replacementGainLife);
      continue;
    }
    const resultLife = parseResultLifeUnknownStep(cleanedStep);
    if (resultLife) {
      expanded.push(resultLife);
      continue;
    }
    const trailingCommaLife = parseTrailingCommaLifeUnknownStep(cleanedStep);
    if (trailingCommaLife) {
      expanded.push(trailingCommaLife);
      continue;
    }
    const parsedClauseUnknown = parseClauseUnknownStep(cleanedStep);
    if (parsedClauseUnknown) {
      expanded.push(parsedClauseUnknown);
      continue;
    }
    const lifeStep = parseLifeUnknownStep(cleanedStep);
    if (lifeStep) {
      expanded.push(lifeStep);
      continue;
    }
    const prefixedTapCounter = parsePrefixedTapCounterUnknownStep(cleanedStep);
    if (prefixedTapCounter) {
      expanded.push(...prefixedTapCounter);
      continue;
    }
    const splitMoveLife = splitMoveZoneAndLifeUnknownStep(cleanedStep);
    if (splitMoveLife) {
      expanded.push(...splitMoveLife);
      continue;
    }
    const splitDamageLife = splitDamageAndLifeUnknownStep(cleanedStep);
    if (splitDamageLife) {
      expanded.push(...splitDamageLife);
      continue;
    }
    const splitAddManaLife = splitAddManaAndLoseLifeUnknownStep(cleanedStep);
    if (splitAddManaLife) {
      expanded.push(...splitAddManaLife);
      continue;
    }
    const splitDestroyCantBlock = splitDestroyAndCantBlockStep(cleanedStep);
    if (splitDestroyCantBlock) {
      expanded.push(...splitDestroyCantBlock);
      continue;
    }
    const splitDestroyNoDamage = splitDestroyAndNoCombatDamageStep(cleanedStep);
    if (splitDestroyNoDamage) {
      expanded.push(...splitDestroyNoDamage);
      continue;
    }
    const splitDestroyDamage = splitDestroyUnlessDamageStep(cleanedStep);
    if (splitDestroyDamage) {
      expanded.push(...splitDestroyDamage);
      continue;
    }
    const splitMillLife = splitMillAndLifeUnknownStep(cleanedStep);
    if (splitMillLife) {
      expanded.push(...splitMillLife);
      continue;
    }
    if (
      cleanedStep.kind === 'lose_life' &&
      (cleanedStep.who as any)?.kind === 'you' &&
      /^lose\s+/i.test(String(cleanedStep.raw || '').trim())
    ) {
      const previousStep = expanded[expanded.length - 1];
      if (previousStep?.kind === 'mill' && (previousStep.who as any)?.kind === 'any_number_of_target_players') {
        expanded.push({ ...cleanedStep, who: previousStep.who });
        continue;
      }
    }
    expanded.push(cleanedStep);

    if (cleanedStep.kind === 'move_zone' && cleanedStep.to === 'battlefield') {
      const movedText = String((cleanedStep.what as any)?.text || '');
      const targetText = /\b(?:cards|permanents|creatures)\b/i.test(movedText) ? 'those creatures' : 'that creature';
      const counterStep = parseDynamicCounterRider(String(cleanedStep.toRaw || cleanedStep.raw || ''), targetText);
      if (counterStep) expanded.push(counterStep);
      continue;
    }

    if (cleanedStep.kind === 'create_token' && !(cleanedStep as any).withCounters) {
      const amount = (cleanedStep as any).amount;
      const tokenCount = amount?.kind === 'number' ? Number(amount.value || 0) : 0;
      const targetText = (cleanedStep as any).who?.kind === 'each_player' || tokenCount > 1 ? 'those tokens' : 'that token';
      const counterStep = parseDynamicCounterRider(String(cleanedStep.raw || ''), targetText);
      if (counterStep) expanded.push(counterStep);
    }
  }

  return expanded;
}

export function expandDynamicCounterRiderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const expandedSteps = pruneMalformedAbilitySteps(expandDynamicCounterRiderSteps(ability.steps));
    return expandedSteps.length === ability.steps.length && expandedSteps.every((step, index) => step === ability.steps[index])
      ? ability
      : { ...ability, steps: expandedSteps };
  });
}
export { expandDynamicCounterRiderSteps };
