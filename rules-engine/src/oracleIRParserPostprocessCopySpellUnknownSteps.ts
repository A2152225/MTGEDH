/**
 * Copy-spell unknown-step expansion for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 24171-24976 of the
 * pre-split file).
 * Cluster moved: the `unknown` -> `copy_spell` / `copy_ability` re-parser and its step-list
 * expansion, the change-target exclusion follow-up merge, the redundant cast-additional-cost
 * prune, and the saga copy-chapter-ability expansion.
 * Public entry symbols: expandCopySpellUnknownAbilities,
 * mergeChangeTargetRestrictionFollowupAbilities,
 * pruneRedundantCastAdditionalCostUnknownAbilities, expandCopyChapterAbilityUnknownAbilities.
 */
import type { OracleEffectStep, OracleIRAbility, OracleObjectSelector } from './oracleIR';
import {
  appendFollowupSentence,
  applyCopySpellCastTail,
  applyCopySpellRetargetTailToSteps,
  copySpellRawMentionsRetarget,
  isCopyAbilityUnknownStep,
  normalizeUnknownStepText,
  parseCopySpellCastTail,
  parseCopySpellRetargetTail,
  stripInlineCopyRetargetTail,
} from './oracleIRParserPostprocessCopySpellTailHelpers';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

function parseCopySpellUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  nextStep?: OracleEffectStep
): OracleEffectStep | null {
  const retargetTail = parseCopySpellRetargetTail(nextStep);
  const stripped = stripInlineCopyRetargetTail(String(step.raw || ''));
  const normalized = stripped.body.replace(/^[•·●◦▪▫►➤\uFFFD]+\s*/u, '').trim();
  if (!normalized) return null;
  const allowNewTargets = stripped.allowNewTargets || retargetTail !== null;
  const rawRetargetTail = retargetTail ?? (stripped.allowNewTargets ? 'You may choose new targets for the copy' : null);
  const optional = Boolean(step.optional) || /^you may\s+/i.test(normalized);
  const abilityWordStripped = normalized.replace(/^spell mastery\s*[^a-z0-9]+\s*/i, '').trim();

  if (
    /^whenever you reveal an instant or sorcery card this way, copy that card(?: and you may cast the copy)?$/i.test(
      normalized
    )
  ) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      optional: true,
      raw: String(step.raw || '').trim(),
      ...(step.sequence ? { sequence: step.sequence } : {}),
    };
  }

  const leadingCopyClause = normalized.match(/^.+?,\s*(copy\s+(?:that\s+spell|the\s+spell|target\s+.+|all\s+other\s+.+|each\s+of\s+those\s+spells?.*))$/i);
  if (leadingCopyClause && /\b(?:spell|ability|abilities)\b/i.test(String(leadingCopyClause[1] || ''))) {
    return parseCopySpellUnknownStep({ ...step, raw: String(leadingCopyClause[1] || '').trim() }, nextStep);
  }

  if (abilityWordStripped !== normalized) {
    const conditionalMatch = abilityWordStripped.match(/^if\s+(.+?),\s+(.+)$/i);
    if (conditionalMatch) {
      const nestedRaw = String(conditionalMatch[2] || '').trim();
      const nestedStep = parseCopySpellUnknownStep(
        {
          ...step,
          raw: nestedRaw,
          optional: Boolean(step.optional) || /^you may\s+/i.test(nestedRaw),
        },
        nextStep
      );
      if (nestedStep) {
        const nestedSteps = nestedStep.kind === 'copy_spell' && allowNewTargets
          ? [{ ...nestedStep, allowNewTargets: true }]
          : [nestedStep];
        return {
          kind: 'conditional',
          condition: { kind: 'if', raw: String(conditionalMatch[1] || '').trim() },
          steps: nestedSteps,
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: appendFollowupSentence(normalized, rawRetargetTail),
        };
      }
    }
  }

  {
    const conditionalMatch = normalized.match(/^if\s+(.+?),\s+(.+)$/i);
    if (conditionalMatch) {
      const nestedRaw = String(conditionalMatch[2] || '').trim();
      const nestedStep = parseCopySpellUnknownStep(
        {
          ...step,
          raw: nestedRaw,
          optional: Boolean(step.optional) || /\bmay\b/i.test(nestedRaw),
        },
        nextStep
      );
      if (nestedStep) {
        const nestedSteps = nestedStep.kind === 'copy_spell' && allowNewTargets
          ? [{ ...nestedStep, allowNewTargets: true }]
          : [nestedStep];
        return {
          kind: 'conditional',
          condition: { kind: 'if', raw: String(conditionalMatch[1] || '').trim() },
          steps: nestedSteps,
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: appendFollowupSentence(normalized, rawRetargetTail),
        };
      }
    }
  }

  if (/^copy this spell for each spell cast before it this turn$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: { kind: 'spells_cast_before_this_turn' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:when you cast this spell,\s+)?copy it for each time you paid its replicate cost$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: { kind: 'replicate_count' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you|they|that player|the player)?\s*may\s+copy\s+this\s+spell$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThisSpellMatch = normalized.match(/^copy this spell(?:(?:\s+(twice))|(?:\s+(\d+|x)\s+times))?(?: except for its epic ability)?$/i);
  if (copyThisSpellMatch) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      ...(copyThisSpellMatch[1]
        ? { copies: { kind: 'number', value: 2 } as const }
        : copyThisSpellMatch[2]
          ? { copies: /^\d+$/.test(String(copyThisSpellMatch[2] || '')) ? { kind: 'number', value: Number.parseInt(String(copyThisSpellMatch[2] || ''), 10) } as const : { kind: 'reference_amount', raw: 'x' } as const }
          : {}),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyItForEachCommanderCastMatch = normalized.match(/^copy\s+it\s+for\s+each\s+time\s+you(?:'|’)?ve\s+cast\s+your\s+commander\s+from\s+the\s+command\s+zone\s+this\s+game$/i);
  if (copyItForEachCommanderCastMatch) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: { kind: 'reference_amount', raw: "for each time you've cast your commander from the command zone this game" },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThatSpellOrAbilityEitherMatch = normalized.match(/^(?:if you do,\s*)?(?:(?:you|they|that player|the player|each opponent|each player|up to one target opponent)\s+may\s+(?:also\s+)?)?copy that spell or ability(?:\s+(twice)|\s+(\d+|x)\s+times)?$/i);
  if (copyThatSpellOrAbilityEitherMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'that spell or ability' },
      ...(copyThatSpellOrAbilityEitherMatch[1]
        ? { copies: { kind: 'number', value: 2 } as const }
        : copyThatSpellOrAbilityEitherMatch[2]
          ? { copies: /^\d+$/.test(String(copyThatSpellOrAbilityEitherMatch[2] || '')) ? { kind: 'number', value: Number.parseInt(String(copyThatSpellOrAbilityEitherMatch[2] || ''), 10) } as const : { kind: 'reference_amount', raw: 'x' } as const }
          : {}),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThatSpellOrAbility = normalized.match(/^(?:if you do,\s*)?copy that (spell|ability)(?:\s+(twice))?$/i);
  if (copyThatSpellOrAbility) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: `that ${String(copyThatSpellOrAbility[1] || '').trim()}` },
      ...(copyThatSpellOrAbility[2] ? { copies: { kind: 'number', value: 2 } as const } : {}),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyItForEachPreviousSpellMatch = normalized.match(
    /^copy it for each (?:other )?(instant and sorcery spell|spell) (?:you(?:'ve| have) )?cast before it this turn$/i
  );
  if (copyItForEachPreviousSpellMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'it' },
      copies: { kind: 'spells_cast_before_this_turn' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyAllAbilitiesMatch = normalized.match(/^copy\s+(all\s+other\s+activated\s+and\s+triggered\s+abilities\s+you\s+control|that\s+ability|target\s+activated\s+or\s+triggered\s+ability.+|that\s+spell,\s+except\s+.+)$/i);
  if (copyAllAbilitiesMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: String(copyAllAbilitiesMatch[1] || '').trim() },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyEachThoseSpellsMatch = normalized.match(/^(?:if\s+.+?,\s*)?copy each of those spells(?:\s+(twice|\d+|x)\s+times?)?$/i);
  if (copyEachThoseSpellsMatch) {
    const rawCount = String(copyEachThoseSpellsMatch[1] || '').trim().toLowerCase();
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'each of those spells' },
      ...(rawCount
        ? { copies: rawCount === 'twice' ? { kind: 'number', value: 2 } as const : /^\d+$/.test(rawCount) ? { kind: 'number', value: Number.parseInt(rawCount, 10) } as const : { kind: 'reference_amount', raw: rawCount } as const }
        : {}),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^for each .+? exiled this way,\s*copy it$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^for each card exiled this way,\s*copy it,\s*and you may cast the copy without paying its mana cost$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThatSpellTimesMatch = normalized.match(/^copy that spell\s+(twice|\d+|x)\s+times?(?:\s+instead)?$/i);
  if (copyThatSpellTimesMatch) {
    const rawCount = String(copyThatSpellTimesMatch[1] || '').trim().toLowerCase();
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'that spell' },
      copies: rawCount === 'twice'
        ? { kind: 'number', value: 2 }
        : /^\d+$/.test(rawCount)
          ? { kind: 'number', value: Number.parseInt(rawCount, 10) }
          : { kind: 'reference_amount', raw: rawCount },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyNextSpellMatch = normalized.match(/^(?:until end of turn,\s*)?copy the next ((?:.+?\s+)?spell(?:\s+with\s+mana\s+value\s+[^\s]+\s+or\s+less)?) you cast this turn when you cast it$/i);
  if (copyNextSpellMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: `next ${String(copyNextSpellMatch[1] || '').trim()} you cast this turn` },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThatSpellForEachMatch = normalized.match(/^copy (that|the) (spell|ability|spell or ability) for each (.+)$/i);
  if (copyThatSpellForEachMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: `${String(copyThatSpellForEachMatch[1] || '').trim()} ${String(copyThatSpellForEachMatch[2] || '').trim()}` },
      copies: parseQuantity(`for each ${String(copyThatSpellForEachMatch[3] || '').trim()}`),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^copy all spells you control$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'all spells you control' },
      copies: { kind: 'all' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy the spell countered this way$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy that card$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copierCopiesThatSpellMatch = normalized.match(
    /^(?:(you|they|that player|the player|each opponent|each other player|each player|up to one target opponent)(\s+may(?:\s+also)?)?\s+)?cop(?:y|ies)\s+(that spell|the spell|it)$/i,
  );
  if (copierCopiesThatSpellMatch) {
    const copierRaw = String(copierCopiesThatSpellMatch[1] || '').trim();
    const targetText = String(copierCopiesThatSpellMatch[3] || '').trim() || 'that spell';
    const copierMay = Boolean(copierCopiesThatSpellMatch[2]);
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: targetText },
      ...(copierRaw ? { who: parsePlayerSelector(copierRaw) } : {}),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional || copierMay ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyAnyNumberTargetSpellsMatch = normalized.match(/^(?:you may\s+)?copy\s+any\s+number\s+of\s+(target\s+.+?\s+spells?)$/i);
  if (copyAnyNumberTargetSpellsMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: parseObjectSelector(String(copyAnyNumberTargetSpellsMatch[1] || '').trim()),
      copies: { kind: 'any_number' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy the exiled card$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'linked_exiled_cards',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:the token\s+)?copies\s+that\s+ability$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'that ability' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyDescribedSpellMatch = normalized.match(/^(?:you may\s+)?copy\s+(the\s+spell\s+that\s+.+)$/i);
  if (copyDescribedSpellMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: String(copyDescribedSpellMatch[1] || '').trim() },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy\s+each\s+card\s+exiled\s+with\s+.+$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'linked_exiled_cards',
      copies: { kind: 'all' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?create a copy of that card$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy (?:a|the) card(?:s)? (?:you )?exiled with .+$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'linked_exiled_cards',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const targetedSpellMatch = normalized.match(/^(?:you may\s+)?copy\s+(target(?:\s+.+?)?\s+spells?(?:\s+.+)?)$/i);
  if (targetedSpellMatch) {
    const targetText = String(targetedSpellMatch[1] || '').trim();
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: parseObjectSelector(targetText),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const targetedStackObjectMatch = normalized.match(/^(?:you may\s+)?copy\s+(target\s+.+)$/i);
  if (targetedStackObjectMatch && /\b(?:spell|ability|abilities)\b/i.test(String(targetedStackObjectMatch[1] || ''))) {
    const targetText = String(targetedStackObjectMatch[1] || '').trim();
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: parseObjectSelector(targetText),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  return null;
}

function expandCopySpellUnknownSteps(
  steps: readonly OracleEffectStep[]
): { steps: readonly OracleEffectStep[]; changed: boolean } {
  let changed = false;
  const expandedSteps: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const nextStep = steps[i + 1];
    const retargetTail = parseCopySpellRetargetTail(nextStep);

    if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
      const nested = expandCopySpellUnknownSteps(step.steps);
      const nestedRetarget = retargetTail !== null
        ? applyCopySpellRetargetTailToSteps(nested.steps, retargetTail)
        : { steps: nested.steps, changed: false, applied: false };
      if (nested.changed || nestedRetarget.changed) {
        changed = true;
        expandedSteps.push({
          ...step,
          steps: nestedRetarget.steps,
        });
        if (nestedRetarget.applied) {
          i += 1;
        }
      } else {
        expandedSteps.push(step);
        if (nestedRetarget.applied) {
          changed = true;
          i += 1;
        }
      }
      continue;
    }

    if (step.kind === 'choose_mode') {
      let modeChanged = false;
      const expandedModes = step.modes.map((mode) => {
        const nested = expandCopySpellUnknownSteps(mode.steps);
        if (!nested.changed) return mode;
        modeChanged = true;
        return {
          ...mode,
          steps: nested.steps,
        };
      });

      const retargetedModes = retargetTail !== null
        ? expandedModes.map((mode) => applyCopySpellRetargetTailToSteps(mode.steps, retargetTail))
        : [];
      const hasRetargetedMode = retargetedModes.some((result) => result.applied);
      const hasRetargetModeChange = retargetedModes.some((result) => result.changed);
      const finalModes = hasRetargetedMode
        ? expandedModes.map((mode, idx) => ({
            ...mode,
            steps: retargetedModes[idx]?.steps || mode.steps,
          }))
        : expandedModes;

      if (modeChanged || hasRetargetModeChange) {
        changed = true;
        expandedSteps.push({
          ...step,
          modes: finalModes,
        });
        if (hasRetargetedMode) {
          i += 1;
        }
      } else {
        expandedSteps.push(step);
        if (hasRetargetedMode) {
          changed = true;
          i += 1;
        }
      }
      continue;
    }

    if (step.kind === 'unknown') {
      const castTail = parseCopySpellCastTail(nextStep);
      const trailingRetargetTail = castTail ? parseCopySpellRetargetTail(steps[i + 2]) : retargetTail;
      const expanded = parseCopySpellUnknownStep(step, castTail ? steps[i + 2] : nextStep);
      if (!expanded) {
        if (retargetTail !== null && isCopyAbilityUnknownStep(step)) {
          changed = true;
          expandedSteps.push({
            ...step,
            raw: appendFollowupSentence(step.raw, retargetTail),
          });
          i += 1;
          continue;
        }

        expandedSteps.push(step);
        continue;
      }

      changed = true;
      expandedSteps.push(castTail && expanded.kind === 'copy_spell' ? applyCopySpellCastTail(expanded, castTail) : expanded);
      i += (castTail ? 1 : 0) + (trailingRetargetTail !== null ? 1 : 0);
      continue;
    }

    if (step.kind === 'copy_spell') {
      const castTail = parseCopySpellCastTail(nextStep);
      const preservedThenFollowupStep =
        castTail === null &&
        retargetTail === null &&
        nextStep?.sequence === 'then' &&
        parseCopySpellRetargetTail(steps[i + 2]) !== null
          ? nextStep
          : null;
      const trailingRetargetTail = castTail
        ? parseCopySpellRetargetTail(steps[i + 2])
        : retargetTail ?? (preservedThenFollowupStep ? parseCopySpellRetargetTail(steps[i + 2]) : null);
      if (castTail || trailingRetargetTail !== null) {
        changed = true;
        const castMerged = castTail ? applyCopySpellCastTail(step, castTail) : step;
        expandedSteps.push(
          trailingRetargetTail !== null
            ? {
                ...castMerged,
                allowNewTargets: true,
                raw: copySpellRawMentionsRetarget(castMerged.raw)
                  ? castMerged.raw
                  : appendFollowupSentence(castMerged.raw, trailingRetargetTail),
              }
            : castMerged
        );
        if (preservedThenFollowupStep) {
          expandedSteps.push(preservedThenFollowupStep);
        }
        i +=
          (castTail ? 1 : 0) +
          (trailingRetargetTail !== null ? 1 : 0) +
          (preservedThenFollowupStep ? 1 : 0);
        continue;
      }
    }

    expandedSteps.push(step);
  }

  return {
    steps: changed ? expandedSteps : steps,
    changed,
  };
}

export function expandCopySpellUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const expanded = expandCopySpellUnknownSteps(ability.steps);
    return expanded.changed ? { ...ability, steps: expanded.steps } : ability;
  });
}

function parseChangeTargetExcludeFromRaw(raw: string | undefined): OracleObjectSelector | null {
  const match = String(raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .match(/^the\s+new\s+targets?\s+can't\s+be\s+(.+)$/i);
  if (!match) return null;
  return parseObjectSelector(String(match[1] || '').trim());
}

function mergeExcludeOntoChangeTargetStep(
  step: Extract<OracleEffectStep, { kind: 'change_target' }>,
  followup: OracleEffectStep,
): Extract<OracleEffectStep, { kind: 'change_target' }> {
  const exclude = followup.kind === 'change_target' && followup.exclude
    ? followup.exclude
    : parseChangeTargetExcludeFromRaw(String((followup as { raw?: string }).raw || ''));
  if (!exclude) return step;
  return {
    ...step,
    exclude,
    raw: appendFollowupSentence(step.raw, String((followup as { raw?: string }).raw || '')),
  };
}

function isChangeTargetExcludeFollowupStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind === 'change_target' && step.exclude && !step.random && !step.newTarget) return true;
  return parseChangeTargetExcludeFromRaw(String((step as { raw?: string }).raw || '')) !== null;
}

function mergeChangeTargetRestrictionFollowupSteps(
  steps: readonly OracleEffectStep[],
): { readonly steps: readonly OracleEffectStep[]; readonly changed: boolean } {
  const nextSteps: OracleEffectStep[] = [];
  let changed = false;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const followup = steps[index + 1];
    if (step?.kind === 'change_target' && isChangeTargetExcludeFollowupStep(followup)) {
      nextSteps.push(mergeExcludeOntoChangeTargetStep(step, followup!));
      changed = true;
      index += 1;
      continue;
    }
    nextSteps.push(step);
  }
  return { steps: changed ? nextSteps : steps, changed };
}

/**
 * Fold "The new targets can't be you or a permanent you control" onto the preceding
 * random/change-target step so the restriction is executable instead of a static no-op.
 */
export function mergeChangeTargetRestrictionFollowupAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];
  let changed = false;

  for (let index = 0; index < abilities.length; index += 1) {
    const ability = abilities[index];
    const lowered = mergeChangeTargetRestrictionFollowupSteps(ability.steps);
    const nextAbility = abilities[index + 1];
    const lastStep = lowered.steps[lowered.steps.length - 1];
    const nextSingle = nextAbility?.steps.length === 1 ? nextAbility.steps[0] : undefined;

    if (lastStep?.kind === 'change_target' && isChangeTargetExcludeFollowupStep(nextSingle)) {
      merged.push({
        ...ability,
        text: `${String(ability.text || '').trim()} ${String(nextAbility?.text || '').trim()}`.trim(),
        effectText: `${String(ability.effectText || '').trim()} ${String(nextAbility?.effectText || '').trim()}`.trim(),
        steps: [...lowered.steps.slice(0, -1), mergeExcludeOntoChangeTargetStep(lastStep, nextSingle!)],
      });
      changed = true;
      index += 1;
      continue;
    }

    if (lowered.changed) {
      changed = true;
      merged.push({ ...ability, steps: lowered.steps });
      continue;
    }

    merged.push(ability);
  }

  return changed ? merged : abilities.slice();
}

function isRedundantCastAdditionalCostUnknownStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'unknown') return false;
  const normalized = normalizeUnknownStepText(step);
  return normalized !== null && /^as an additional cost to cast this spell,\s+.+$/i.test(normalized);
}

function isStandaloneCastAdditionalCostAbility(ability: OracleIRAbility): boolean {
  return ability.steps.length > 0 && ability.steps.every(isRedundantCastAdditionalCostUnknownStep);
}

export function pruneRedundantCastAdditionalCostUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  let changed = false;
  const filtered: OracleIRAbility[] = [];

  for (const ability of abilities) {
    if (isStandaloneCastAdditionalCostAbility(ability)) {
      changed = true;
      continue;
    }

    let firstMeaningfulStepIndex = 0;
    while (
      firstMeaningfulStepIndex < ability.steps.length &&
      isRedundantCastAdditionalCostUnknownStep(ability.steps[firstMeaningfulStepIndex])
    ) {
      firstMeaningfulStepIndex += 1;
    }

    if (firstMeaningfulStepIndex > 0 && firstMeaningfulStepIndex < ability.steps.length) {
      filtered.push({
        ...ability,
        steps: ability.steps.slice(firstMeaningfulStepIndex),
      });
      changed = true;
      continue;
    }

    filtered.push(ability);
  }

  return changed ? filtered : abilities.slice();
}

function parseCopyChapterAbilityUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^copy its chapter (i|ii|iii|iv|v|vi|vii|viii|ix|x) ability$/i);
  if (!match) return null;

  const roman = String(match[1] || '').trim().toUpperCase();
  const chapterMap: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
  };
  const chapter = chapterMap[roman];
  if (!chapter) return null;

  return {
    kind: 'copy_chapter_ability',
    subject: 'last_moved_card',
    chapter,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: String(step.raw || '').trim(),
  };
}

export function expandCopyChapterAbilityUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseCopyChapterAbilityUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export { parseCopySpellUnknownStep };
