// Extracted from rules-engine/src/oracleIRParserParseOracleTextToIR.ts (chat B 40KB split campaign).
//
// Late passes of the parseOracleTextToIR pipeline (reminder prunes, recoveries, surface repairs).
//
// Public entry points:
//   applyParseOracleTextToIRLatePasses

import type { OracleIRAbility, OracleIRResult } from './oracleIR';
import type { OracleTextParseResult, ParsedAbility } from './oracleTextParser';
import { AbilityType, isSpellInstructionLine, parseOracleText } from './oracleTextParser';
import { parseAbilityToIRAbility as parseAbilityToIRAbilityFromModule } from './oracleIRParserAbilityToIR';
import { repairCurrentBatchSurfaceSteps } from './oracleIRParserPostprocessCurrentBatchSurfaces';
import { repairIntraAbilityInsteadConditionalSteps } from './oracleIRParserPostprocessInsteadReplacementSteps';
import { extractQuotedAbilityRiderSteps } from './oracleIRParserPostprocessQuotedAbilityRiders';
import { pruneMalformedExploreReminderMoveZoneSteps, pruneRedundantExploreReminderAbilities, pruneRedundantInfectKeywordUnknownAbilities, pruneRedundantLandwalkKeywordUnknownAbilities, pruneRedundantScryReminderUnknownAbilities } from './oracleIRParserPostprocessClashScryExploreReminderPrunes';
import { lowerRecruitKeywordAbilities, pruneRedundantAmassSubtypeReminderUnknownAbilities } from './oracleIRParserPostprocessAmassDiscoverConniveRecruitKeywords';
import { pruneCascadeReminderAbilities, pruneCipherReminderAbilities, pruneConvokeReminderAbilities, pruneRedundantCascadeReminderUnknownAbilities } from './oracleIRParserPostprocessKeywordReminderPrunes';
import { pruneLateKeywordReminderOnlyAbilities } from './oracleIRParserPostprocessCrewChampionLateKeywordPrunes';
import { pruneRedundantEldraziTokenManaReminderUnknownAbilities, pruneRedundantEnchantAttachmentReminderUnknownAbilities } from './oracleIRParserPostprocessFutureSpellAndTokenReminderPrunes';
import { applyGlobalImpulseUpgrades, expandRepeatThisProcessOnceAbilities, mergeLookSelectTopFollowupAbilities } from './oracleIRParserPostprocessSearchLibraryLookSelectImpulse';
import { expandCopySpellUnknownAbilities, mergeChangeTargetRestrictionFollowupAbilities } from './oracleIRParserPostprocessCopySpellUnknownSteps';
import { expandMoveZoneCopiedSpellAbilities, mergeDanglingCopySpellAbilities } from './oracleIRParserPostprocessMoveZoneCopyAndLandAnimationExpansions';
import { expandOtherwiseConditionalUnknownAbilities, expandSimpleConditionalUnknownAbilities } from './oracleIRParserPostprocessDeterministicBodyAndConditionalExpansions';
import { mergeConditionalLookChooseFromTopAbilities, mergeLookChooseFromTopAbilities, mergeTopLibraryBottomRandomTailAbilities } from './oracleIRParserPostprocessLookChooseFromTop';
import { expandChaosZoneTemplateAbilities } from './oracleIRParserChaosZoneTemplates';
import { bindThisWayAntecedentOnAbilities } from './oracleIRThisWayBinding';
import { wrapTriggeredInterveningIfAbility } from './oracleIRParserAbilityMerges';
import { pruneBatch382MisparseExecutableSteps, upgradeSpryAndMightyCompoundSteps } from './oracleIRParserPostprocessMoveZoneFollowupUpgrades';
import { pruneIgnorableEffectReminderUnknownSteps } from './oracleIRParserPostprocessGapClosureStepRepairs';
import { recoverDroppedActivationCostReductionStaticAbilities } from './oracleIRParserPostprocessActivationCostReductionStatics';
import { expandFreeGraveyardCastPermissionAbilities, expandGraveyardOrExilePermissionAbilities, expandGraveyardPermissionUnknownAbilities } from './oracleIRParserPostprocessGraveyardCastPermission';
import { parseEffectClauseToStep } from './oracleIRParserEffectClauseToStep';
import { parseBareTriggerEffectFragmentSteps } from './oracleIRParserPostprocessBareTriggerFragmentSteps';
import { lowerCurrentResidualUnknownAbilities } from './oracleIRParserPostprocessResidualUnknownLowering';
import { expandKeywordActionUnknownAbilities } from './oracleIRParserPostprocessKeywordActionUnknownSteps';
import { expandChooseLeftOrRightLoyaltyAbilities } from './oracleIRParserLoyaltyDirectionChoice';
import { rewritePhase4ChoiceFamilyAbilities } from './oracleIRParserPhase4ChoiceFamilyLatePass';
import { rewriteDiscardHandAndDrawAbilities } from './oracleIRParserDiscardHandAndDrawLatePass';
import { expandWinIfCastSameNameThisGameAbilities } from './oracleIRParserWinIfCastSameNameThisGame';
import { expandWinIfControlDifferentNamesAbilities } from './oracleIRParserWinIfControlDifferentNames';

export function applyParseOracleTextToIRLatePasses(params: {
  abilities: OracleIRAbility[];
  normalizedOracleText: string;
  parsingOracleText: string;
  cardName?: string;
  parsed: OracleTextParseResult;
  parseOracleTextToIR: (oracleText: string, cardName?: string) => OracleIRResult;
}): OracleIRAbility[] {
  let { abilities, normalizedOracleText, parsingOracleText, cardName, parsed } = params;
  const parseAbilityToIRAbility = (ability: ParsedAbility, name?: string): OracleIRAbility =>
    parseAbilityToIRAbilityFromModule(ability, name, params.parseOracleTextToIR);

  // Late residual lowering can turn reminder fragments into executable-looking
  // steps after the earlier reminder passes have already run.
  abilities = pruneRedundantScryReminderUnknownAbilities(abilities);
  abilities = pruneRedundantExploreReminderAbilities(abilities);
  abilities = pruneMalformedExploreReminderMoveZoneSteps(abilities);
  abilities = pruneRedundantAmassSubtypeReminderUnknownAbilities(abilities);
  abilities = pruneCipherReminderAbilities(abilities);
  abilities = pruneConvokeReminderAbilities(abilities);
  abilities = pruneLateKeywordReminderOnlyAbilities(abilities);
  abilities = pruneRedundantEldraziTokenManaReminderUnknownAbilities(abilities);
  abilities = pruneRedundantEnchantAttachmentReminderUnknownAbilities(abilities);
  abilities = pruneCascadeReminderAbilities(abilities);
  abilities = pruneRedundantCascadeReminderUnknownAbilities(abilities);
  abilities = pruneRedundantInfectKeywordUnknownAbilities(abilities);
  abilities = pruneRedundantLandwalkKeywordUnknownAbilities(abilities);
  abilities = applyGlobalImpulseUpgrades(abilities, normalizedOracleText);
  abilities = expandCopySpellUnknownAbilities(abilities);
  abilities = expandMoveZoneCopiedSpellAbilities(abilities);
  abilities = mergeDanglingCopySpellAbilities(abilities);
  abilities = expandOtherwiseConditionalUnknownAbilities(abilities);
  abilities = mergeConditionalLookChooseFromTopAbilities(abilities);
  abilities = mergeLookChooseFromTopAbilities(abilities);
  abilities = mergeLookSelectTopFollowupAbilities(abilities);
  abilities = mergeTopLibraryBottomRandomTailAbilities(abilities);
  abilities = expandChaosZoneTemplateAbilities(abilities, normalizedOracleText);
  abilities = pruneCascadeReminderAbilities(abilities);
  abilities = pruneRedundantCascadeReminderUnknownAbilities(abilities);
  abilities = pruneRedundantEldraziTokenManaReminderUnknownAbilities(abilities);
  abilities = pruneRedundantEnchantAttachmentReminderUnknownAbilities(abilities);
  abilities = bindThisWayAntecedentOnAbilities(abilities);
  abilities = abilities.map(wrapTriggeredInterveningIfAbility);
  abilities = expandRepeatThisProcessOnceAbilities(abilities);
  abilities = pruneBatch382MisparseExecutableSteps(abilities);
  abilities = upgradeSpryAndMightyCompoundSteps(abilities);
  abilities = pruneIgnorableEffectReminderUnknownSteps(abilities);
  abilities = recoverDroppedActivationCostReductionStaticAbilities(abilities, parsed.abilities);

  const individuallyParsedAbilities = normalizedOracleText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => parseOracleText(line, cardName).abilities);
  const copyTailCandidates = Array.from(
    normalizedOracleText.matchAll(/copy that card\.\s*you may cast the copy(?: without paying its mana cost| by paying .+? rather than paying its mana cost)?\.?/gi),
    (match) => String(match[0] || '').trim(),
  ).flatMap((text) => parseOracleText(text, cardName).abilities);
  const recoveryCandidates = [...parsed.abilities, ...individuallyParsedAbilities, ...copyTailCandidates];

  const normalizeAbilityCoverageText = (value: string): string =>
    String(value || '')
      .toLowerCase()
      .replace(/[.!?]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const abilityTextAlreadyCovered = (text: string): boolean => {
    const normalized = normalizeAbilityCoverageText(text);
    if (!normalized) return true;
    if (abilities.some((ability) => normalizeAbilityCoverageText(String(ability.text || '')) === normalized)) {
      return true;
    }
    // Modal bullets already inside choose_mode must not be recovered as top-level steps
    // (Urza's Command PT / Construct "+1/+1" grant text).
    const coveredByChooseMode = abilities.some((ability) =>
      (ability.steps || []).some((step) => {
        if (step.kind !== 'choose_mode') return false;
        const modes = Array.isArray((step as any).modes) ? (step as any).modes : [];
        if (
          modes.some((mode: any) => {
            const raw = normalizeAbilityCoverageText(String(mode?.raw || ''));
            const label = normalizeAbilityCoverageText(String(mode?.label || ''));
            return (
              (raw && (raw === normalized || raw.includes(normalized) || normalized.includes(raw))) ||
              (label && label === normalized)
            );
          })
        ) {
          return true;
        }
        const chooseRaw = normalizeAbilityCoverageText(String((step as any).raw || ability.text || ''));
        return Boolean(chooseRaw && chooseRaw.includes(normalized));
      })
    );
    if (coveredByChooseMode) return true;
    // Paragraph recovery must not re-add text already sentence-split into spell abilities.
    const parts = normalized.split(/(?<=\.)\s+/).map((part) => part.replace(/[.!?]+$/g, '').trim()).filter(Boolean);
    if (parts.length <= 1) return false;
    return parts.every((part) =>
      abilities.some((ability) => {
        const existing = normalizeAbilityCoverageText(String(ability.text || ''));
        return existing === part || existing.includes(part) || part.includes(existing);
      })
    );
  };

  for (const parsedAbility of recoveryCandidates) {
    const text = String(parsedAbility.effect || parsedAbility.text || '').trim();
    if (!text || abilityTextAlreadyCovered(String(parsedAbility.text || text))) continue;
    if (
      !/^if\b.+,\s*target\b.+\bgets?\b/i.test(text) &&
      !/^you may cast\b.+\bfrom your graveyard\b/i.test(text) &&
      !/^enchanted creature (?:has ward|gets\b)/i.test(text) &&
      !/^as an additional cost to cast this spell\b[\s\S]*\.\s*draw\b/i.test(text) &&
      !(
        !/[()]/.test(text) &&
        !/\bany player may activate\b/i.test(text) &&
        /\bgets?\s+[+-](?:\d+|x)\s*\/\s*[+-](?:\d+|x)\b/i.test(text)
      ) &&
      !/^(?:spell mastery\s*-\s*)?if\b[\s\S]*\bcopy\b/i.test(text) &&
      !/^copy that card\b/i.test(text)
    ) {
      continue;
    }

    let recovered = [parseAbilityToIRAbility(parsedAbility, cardName)];
    recovered = expandSimpleConditionalUnknownAbilities(recovered);
    recovered = expandGraveyardPermissionUnknownAbilities(recovered);
    recovered = expandFreeGraveyardCastPermissionAbilities(recovered);
    recovered = expandGraveyardOrExilePermissionAbilities(recovered);
    recovered = recovered
      .map((ability) => ({
        ...ability,
        type:
          // A recovered ability that kept its trigger condition ("Landfall - Whenever a land you
          // control enters, ...") is triggered no matter how the surrounding line reads; downgrading
          // it to a spell effect loses the trigger for every consumer downstream.
          !ability.triggerCondition &&
          (/^as an additional cost to cast this spell/i.test(text) ||
            parsedAbility.type === AbilityType.SPELL ||
            isSpellInstructionLine(text))
            ? AbilityType.SPELL
            : ability.type,
        steps: ability.steps.filter(
          (step) => !/^as an additional cost to cast this spell\b/i.test(String(step.raw || '')),
        ),
      }))
      .filter((ability) => ability.steps.some((step) => step.kind !== 'unknown'));
    abilities.push(...recovered);
  }

  abilities = expandCopySpellUnknownAbilities(abilities);
  abilities = mergeDanglingCopySpellAbilities(abilities);

  for (const line of normalizedOracleText.split(/\n+/).map((part) => part.trim()).filter(Boolean)) {
    if (
      /[()]/.test(line) ||
      /^[•\u2022]\s+/i.test(line) ||
      /\bany player may activate\b/i.test(line) ||
      !/\bgets?\s+[+-](?:\d+|x)\s*\/\s*[+-](?:\d+|x)\b/i.test(line)
    ) continue;
    // Recover only the PT-bearing sentence(s). Multi-sentence ETB+static lines such as
    // "Mill two cards. Enchanted creature gets -X/-0, where X is…" must not be reparsed
    // as a single mill quantity with a borrowed where-X clause.
    const ptSentences = line
      .split(/(?<=\.)\s+/)
      .map((part) => part.trim())
      .filter((part) => /\bgets?\s+[+-](?:\d+|x)\s*\/\s*[+-](?:\d+|x)\b/i.test(part));
    const recoveryUnits = ptSentences.length > 0 ? ptSentences : [line];
    for (const unit of recoveryUnits) {
      // Ignore PT text that exists only inside quoted grants on the same unit.
      const withoutQuotes = unit.replace(/"[^"]*"/g, ' ');
      if (!/\bgets?\s+[+-](?:\d+|x)\s*\/\s*[+-](?:\d+|x)\b/i.test(withoutQuotes)) continue;
      if (abilityTextAlreadyCovered(unit)) continue;
      const step = parseEffectClauseToStep(unit);
      const lineType = isSpellInstructionLine(unit) ? AbilityType.SPELL : AbilityType.STATIC;
      if (step.kind === 'unknown') {
        const fragment = parseBareTriggerEffectFragmentSteps(unit);
        if (fragment && fragment.length > 0 && fragment.every((fragmentStep) => fragmentStep.kind !== 'unknown')) {
          abilities.push({
            type: lineType,
            text: unit,
            effectText: unit,
            steps: [...fragment],
          });
          continue;
        }
        abilities.push({
          type: lineType,
          text: unit,
          effectText: unit,
          steps: [],
        });
        continue;
      }
      abilities.push({
        type: lineType,
        text: unit,
        effectText: unit,
        steps: [step],
      });
    }
  }

  // Recovery above can reintroduce unknowns after the main residual pass
  // (e.g. multi-sentence aura statics with "instead as long as…" riders).
  abilities = lowerCurrentResidualUnknownAbilities(abilities);
  abilities = extractQuotedAbilityRiderSteps(abilities);
  abilities = repairCurrentBatchSurfaceSteps(abilities, parsingOracleText);
  abilities = lowerRecruitKeywordAbilities(abilities);
  abilities = expandKeywordActionUnknownAbilities(abilities);

  abilities = abilities.reduce<OracleIRAbility[]>((merged, ability) => {
    const previous = merged[merged.length - 1];
    if (
      previous?.type === AbilityType.SPELL &&
      ability.type === AbilityType.SPELL &&
      ability.steps.length === 1 &&
      ability.steps[0]?.kind === 'proliferate'
    ) {
      merged[merged.length - 1] = {
        ...previous,
        text: `${previous.text} ${ability.text}`.trim(),
        effectText: `${previous.effectText} ${ability.effectText}`.trim(),
        steps: [...previous.steps, { ...ability.steps[0], sequence: 'then' }],
      };
      return merged;
    }
    merged.push(ability);
    return merged;
  }, []);

  abilities = mergeLookSelectTopFollowupAbilities(abilities);

  abilities = abilities.map((ability) => {
    if (ability.steps.length !== 1 || ability.steps[0]?.kind !== 'grant_static_ability') return ability;
    const malformedTarget = String((ability.steps[0].target as any)?.text || '').trim();
    const tokenLead = malformedTarget.match(/^((?:you may\s+)?create(?:s)?\s+.+?\btokens?)\.\s+(?:it has|they have)$/i);
    if (!tokenLead || !/^sacrifice this (?:token|creature): add \{c\}/i.test(String(ability.steps[0].raw || '').trim())) {
      return ability;
    }
    const createStep = parseEffectClauseToStep(String(tokenLead[1] || '').trim());
    return createStep.kind === 'create_token' ? { ...ability, steps: [createStep] } : ability;
  });

  const bottomRandomTail = normalizedOracleText.match(
    /\bPut the rest on the bottom of your library in a random order\b/i,
  )?.[0];
  if (
    bottomRandomTail &&
    !abilities.some((ability) =>
      ability.steps.some((step) => /put the rest on the bottom of your library in a random order/i.test(String(step.raw || '')))
    )
  ) {
    const lastAbilityIndex = abilities.length - 1;
    const lastAbility = abilities[lastAbilityIndex];
    const lastStepIndex = (lastAbility?.steps.length || 0) - 1;
    if (lastAbility && lastStepIndex >= 0) {
      const lastStep = lastAbility.steps[lastStepIndex];
      abilities[lastAbilityIndex] = {
        ...lastAbility,
        steps: lastAbility.steps.map((step, index) =>
          index === lastStepIndex
            ? { ...lastStep, raw: `${String(lastStep.raw || '').replace(/[.]+$/g, '')}. ${bottomRandomTail}` }
            : step
        ),
      };
    }
  }

  const mayhemMatch = normalizedOracleText.match(
    /^mayhem\s+((?:\{[^}]+\})+)\s+\(you may cast this card from your graveyard for ((?:\{[^}]+\})+) if (.+?)\.\s*timing rules still apply\.\)$/i,
  );
  if (mayhemMatch) {
    const cost = String(mayhemMatch[1] || '').trim();
    const castCost = String(mayhemMatch[2] || cost).trim();
    const conditionRaw = String(mayhemMatch[3] || '').trim();
    abilities = [{
      type: AbilityType.KEYWORD,
      text: `Mayhem ${cost}`,
      cost,
      effectText: '',
      steps: [{
        kind: 'conditional',
        condition: { kind: 'as_long_as', raw: conditionRaw },
        steps: [
          {
            kind: 'grant_graveyard_permission',
            who: { kind: 'you' },
            what: { kind: 'raw', text: 'this card' },
            permission: 'cast',
            duration: 'during_resolution',
            optional: true,
            raw: 'you may cast this card from your graveyard',
          },
        ],
        raw: `if ${conditionRaw}, you may cast this card from your graveyard for ${castCost}`,
      }],
    }];
  }

  abilities = abilities.map((ability) => {
    const steps = ability.steps || [];
    if (steps.length > 0 && steps.some((step) => step.kind !== 'unknown')) return ability;
    const fragment = parseBareTriggerEffectFragmentSteps(
      String(ability.effectText || (ability as { text?: string }).text || '')
    );
    if (!fragment || fragment.length === 0 || fragment.some((step) => step.kind === 'unknown')) return ability;
    return { ...ability, steps: [...fragment] };
  });

  abilities = mergeChangeTargetRestrictionFollowupAbilities(abilities);
  abilities = expandChooseLeftOrRightLoyaltyAbilities(abilities);
  abilities = rewritePhase4ChoiceFamilyAbilities(abilities, normalizedOracleText);
  abilities = rewriteDiscardHandAndDrawAbilities(abilities);
  abilities = expandWinIfControlDifferentNamesAbilities(abilities);
  abilities = expandWinIfCastSameNameThisGameAbilities(abilities);
  return abilities;
}
