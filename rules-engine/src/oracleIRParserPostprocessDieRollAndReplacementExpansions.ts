/**
 * Die-roll tables, saga chapter copies, and prevent / win-loss / leave-battlefield unknown
 * step expansion for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 24977-25720 of the
 * pre-split file).
 * Cluster moved: the inline die-roll result-band table rewrite and its activated-ability
 * trailing-roll split, the saga chapter and copy-chapter follow-up merges, copy-permanent,
 * prevent-damage, win/lose-the-game, and leave-battlefield replacement unknown expansion.
 * Public entry symbols: mergeDieRollResultTableAbilities, mergeSagaChapterCopyFollowupAbilities,
 * mergeCopyChapterAbilityFollowupAbilities, expandCopyPermanentUnknownAbilities,
 * expandPreventDamageUnknownAbilities, expandWinLossUnknownAbilities,
 * expandLeaveBattlefieldReplacementUnknownAbilities.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { parseTokenCreationMetadataStep } from './oracleIRParserPostprocessTokenCreationMetadata';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseObjectSelector, parseQuantity } from './oracleIRParserUtils';

type DieRollResultBand = {
  readonly min: number;
  readonly max: number;
  readonly raw: string;
  readonly steps: readonly OracleEffectStep[];
};

function buildDieRollBand(
  min: number,
  max: number,
  effectText: string,
  raw: string
): DieRollResultBand | null {
  if (/^Copy that card\.\s*You may cast the copy\.?$/i.test(effectText)) {
    return {
      min,
      max,
      raw,
      steps: [
        {
          kind: 'copy_spell',
          subject: 'last_moved_card',
          castCost: 'mana_cost',
          optional: true,
          raw: effectText,
        },
      ],
    };
  }

  if (/^Copy that card\.\s*You may cast the copy by paying \{1\} rather than paying its mana cost\.?$/i.test(effectText)) {
    return {
      min,
      max,
      raw,
      steps: [
        {
          kind: 'copy_spell',
          subject: 'last_moved_card',
          castCost: '{1}',
          optional: true,
          raw: effectText,
        },
      ],
    };
  }

  if (
    /^Copy each card exiled with this artifact\.\s*You may cast any number of the copies without paying their mana costs\.?$/i.test(
      effectText
    )
  ) {
    return {
      min,
      max,
      raw,
      steps: [
        {
          kind: 'copy_spell',
          subject: 'linked_exiled_cards',
          withoutPayingManaCost: true,
          optional: true,
          raw: effectText,
        },
      ],
    };
  }

  const createTokenStep = parseTokenCreationMetadataStep(effectText);
  if (createTokenStep) {
    return {
      min,
      max,
      raw,
      steps: [createTokenStep],
    };
  }

  return null;
}

function parseDieRollBandAbility(ability: OracleIRAbility): DieRollResultBand | null {
  if (!ability) return null;
  if (ability.type !== 'static') return null;

  const rawText = String(ability.text || '').trim();
  const match = rawText.match(/^(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*\|\s*([\s\S]+)$/);
  if (!match) return null;

  const min = Number.parseInt(String(match[1] || ''), 10);
  const max = Number.parseInt(String(match[2] || match[1] || ''), 10);
  const effectText = String(match[3] || '').trim();
  if (!Number.isFinite(min) || !Number.isFinite(max) || !effectText) return null;
  return buildDieRollBand(min, max, effectText, rawText);
}

function rewriteInlineDieRollTableAbility(ability: OracleIRAbility): OracleIRAbility {
  if (ability.type !== 'activated') return ability;

  const steps = ability.steps;
  const rollIndex = steps.findIndex(
    step =>
      (step.kind === 'unknown' && /^Roll a d20$/i.test(String(step.raw || '').trim()))
      || (step.kind === 'roll_die' && step.sides === 20)
  );
  if (rollIndex < 0) return ability;
  if (
    steps[rollIndex + 1]?.kind !== 'unknown' ||
    !/^Activate only as a sorcery$/i.test(String(steps[rollIndex + 1]?.raw || '').trim())
  ) {
    return ability;
  }

  const bands: DieRollResultBand[] = [];
  let cursor = rollIndex + 2;
  while (cursor + 1 < steps.length) {
    const copyClause = steps[cursor];
    const castClause = steps[cursor + 1];
    if (copyClause?.kind !== 'unknown' || castClause?.kind !== 'unknown' || !castClause.optional) break;

    const rangeMatch = String(copyClause.raw || '').trim().match(/^(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*\|\s*(.+)$/);
    if (!rangeMatch) break;

    const min = Number.parseInt(String(rangeMatch[1] || ''), 10);
    const max = Number.parseInt(String(rangeMatch[2] || rangeMatch[1] || ''), 10);
    const copyText = String(rangeMatch[3] || '').trim();
    const castText = String(castClause.raw || '').trim();
    const band = buildDieRollBand(min, max, `${copyText}. ${castText}`, `${String(copyClause.raw || '').trim()}. ${castText}`);
    if (!band) break;

    bands.push(band);
    cursor += 2;
  }

  if (bands.length === 0) return ability;

  const rollStep = steps[rollIndex]?.kind === 'roll_die'
    ? steps[rollIndex]
    : {
        kind: 'roll_die' as const,
        who: { kind: 'you' as const },
        sides: 20,
        raw: 'Roll a d20',
      };

  return {
    ...ability,
    steps: [
      ...steps.slice(0, rollIndex),
      rollStep,
      {
        kind: 'die_roll_results',
        who: { kind: 'you' },
        sides: 20,
        results: bands,
        raw: bands.map(band => band.raw).join('\n'),
      },
      ...steps.slice(cursor),
    ],
  };
}

function splitActivatedTrailingRollClause(
  ability: OracleIRAbility
): { ability: OracleIRAbility; hadInlineRoll: boolean } {
  if (ability.type !== 'activated') return { ability, hadInlineRoll: false };
  if (ability.steps.length === 0) return { ability, hadInlineRoll: false };

  const lastStep = ability.steps[ability.steps.length - 1];
  if (lastStep?.kind !== 'move_zone') return { ability, hadInlineRoll: false };

  const stepRaw = String(lastStep.raw || '').trim();
  const whatText = lastStep.what.kind === 'raw' ? String(lastStep.what.text || '').trim() : '';
  const text = String(ability.text || '').trim();
  const effectText = String(ability.effectText || '').trim();

  if (
    !/\band roll a d20\.?$/i.test(stepRaw) &&
    !/\band roll a d20\.?$/i.test(whatText) &&
    !/\band roll a d20\.?$/i.test(effectText)
  ) {
    return { ability, hadInlineRoll: false };
  }

  const clean = (value: string): string =>
    value
      .replace(/\s+and roll a d20\.?$/i, '')
      .replace(/[.]\s*$/g, '')
      .trim();

  const cleanedRaw = clean(stepRaw);
  const cleanedWhatText = clean(whatText);
  const cleanedEffectText = clean(effectText);
  const cleanedText = clean(text);

  const rewrittenSteps = [
    ...ability.steps.slice(0, -1),
    {
      ...lastStep,
      ...(lastStep.what.kind === 'raw' && cleanedWhatText
        ? { what: { ...lastStep.what, text: cleanedWhatText } }
        : {}),
      raw: cleanedRaw || stepRaw,
    },
  ] as unknown as OracleEffectStep[];

  return {
    hadInlineRoll: true,
    ability: {
      ...ability,
      text: cleanedText || text,
      effectText: cleanedEffectText || effectText,
      steps: rewrittenSteps,
    },
  };
}

export function mergeDieRollResultTableAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const mergedInline = abilities.map(rewriteInlineDieRollTableAbility);
  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < mergedInline.length; i += 1) {
    const rewrittenCurrent = splitActivatedTrailingRollClause(mergedInline[i]);
    const current = rewrittenCurrent.ability;
    const rollAbility = mergedInline[i + 1];
    const hasInlineRollStep = current?.type === 'activated' && current.steps.some(
      (step) => step.kind === 'roll_die' && step.sides === 20
    );
    const hasSeparateRollAbility =
      (rollAbility?.type === 'static' || rollAbility?.type === 'spell') &&
      /^Roll a d20\.\s*Activate only as a sorcery\.?$/i.test(String(rollAbility.text || '').trim());
    if (
      current?.type !== 'activated' ||
      (!hasSeparateRollAbility && !rewrittenCurrent.hadInlineRoll && !hasInlineRollStep)
    ) {
      merged.push(current);
      continue;
    }

    const bands: DieRollResultBand[] = [];
    let cursor = i + (hasSeparateRollAbility ? 2 : 1);
    while (cursor < mergedInline.length) {
      const band = parseDieRollBandAbility(mergedInline[cursor]);
      if (!band) break;
      bands.push(band);
      cursor += 1;
    }

    if (bands.length === 0) {
      merged.push(current);
      continue;
    }

    merged.push({
      ...current,
      text: [
        current.text,
        ...(hasSeparateRollAbility ? [rollAbility.text] : []),
        ...bands.map(band => band.raw),
      ].join('\n'),
      effectText: [
        current.effectText,
        ...(hasSeparateRollAbility ? [rollAbility.effectText] : []),
        ...bands.map(band => band.raw),
      ].join('\n'),
      steps: [
        ...current.steps,
          ...(!hasInlineRollStep
            ? [{
                kind: 'roll_die' as const,
                who: { kind: 'you' as const },
                sides: 20,
                raw: 'Roll a d20',
              }]
            : []),
          {
            kind: 'die_roll_results',
            who: { kind: 'you' },
            sides: 20,
            results: bands,
            raw: bands.map(band => band.raw).join('\n'),
          },
      ],
    });
    i = cursor - 1;
  }

  return merged;
}

function parseCopySagaChapterAbilityStep(
  step: OracleEffectStep
): Extract<OracleEffectStep, { kind: 'copy_saga_chapter_ability' }> | null {
    if (!step || step.kind !== 'unknown') return null;

  const match = String(step.raw || '').trim().match(/^Copy its chapter (I|II|III|IV|V|VI|VII|VIII|IX|X) ability$/i);
  if (!match) return null;

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
  const chapterNumber = chapterMap[String(match[1] || '').trim().toUpperCase()];
  if (!Number.isFinite(chapterNumber)) return null;

  return {
    kind: 'copy_saga_chapter_ability',
    subject: 'last_moved_card',
    chapterNumber,
    raw: String(step.raw || '').trim(),
  };
}

export function mergeSagaChapterCopyFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < abilities.length; i += 1) {
    const current = abilities[i];
    const next = abilities[i + 1];
    const currentSteps = Array.isArray(current?.steps) ? current.steps : [];
    const nextSteps = Array.isArray(next?.steps) ? next.steps : [];
    const chapterCopyStep =
      nextSteps.length === 1
        ? ((nextSteps[0] as unknown as OracleEffectStep).kind === 'copy_chapter_ability'
            ? (nextSteps[0] as Extract<OracleEffectStep, { kind: 'copy_chapter_ability' }>)
            : null)
        : null;

    if (!current || !chapterCopyStep || currentSteps.length === 0) {
      merged.push(current);
      continue;
    }

    merged.push({
      ...current,
      text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
      effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
      steps: [...currentSteps, chapterCopyStep],
    });
    i += 1;
  }

  return merged;
}

export function mergeCopyChapterAbilityFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < abilities.length; i += 1) {
    const current = abilities[i];
    const next = abilities[i + 1];
    const currentSteps = current?.steps || [];
    const nextSteps = next?.steps || [];

    if (
      currentSteps.length === 1 &&
      currentSteps[0]?.kind === 'move_zone' &&
      nextSteps.length === 1 &&
      nextSteps[0]?.kind === 'copy_chapter_ability' &&
      current?.type === next?.type
    ) {
      merged.push({
        ...current,
        text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
        effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
        steps: [...currentSteps, ...nextSteps],
      });
      i += 1;
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function parseCopyPermanentUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  abilityText: string
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^(this creature|this permanent)\s+becomes a copy of\s+(that card|it|the exiled card),\s+except it has this ability$/i
  );
  if (!match) return null;

  return {
    kind: 'copy_permanent',
    target: parseObjectSelector(String(match[1] || '').trim()),
    source: parseObjectSelector(String(match[2] || '').trim()),
    retainAbilityText: String(abilityText || '').trim() || undefined,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandCopyPermanentUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseCopyPermanentUnknownStep(step, String(ability.text || '').trim());
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parsePreventDamageUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  if (/^prevent all combat damage that would be dealt this turn$/i.test(normalized)) {
    return {
      kind: 'prevent_damage',
      amount: 'all',
      duration: 'this_turn',
      combatOnly: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const nextDamageMatch = normalized.match(
    /^prevent the next (.+?) damage that would be dealt to (.+?) this turn$/i
  );
  if (nextDamageMatch) {
    const amount = parseQuantity(String(nextDamageMatch[1] || '').trim());
    if (amount.kind === 'number') {
      return {
        kind: 'prevent_damage',
        amount,
        recipientTarget: parseObjectSelector(String(nextDamageMatch[2] || '').trim()),
        duration: 'this_turn',
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }
  }

  const sourceChoiceNextDamageMatch = normalized.match(
    /^the next time (?:a|target) source(?: of your choice)? would deal damage to (.+?) this turn, prevent that damage$/i
  );
  if (sourceChoiceNextDamageMatch) {
    return {
      kind: 'prevent_damage',
      amount: 'all',
      target: parseObjectSelector('target source'),
      recipientTarget: parseObjectSelector(String(sourceChoiceNextDamageMatch[1] || '').trim()),
      duration: 'this_turn',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const unblockedCombatAllButMatch = normalized.match(
    /^the next time an unblocked creature(?: of your choice)? would deal combat damage to you this turn, prevent all but (\d+) of that damage$/i
  );
  if (unblockedCombatAllButMatch) {
    const leaveAmount = Math.max(0, Math.floor(Number(unblockedCombatAllButMatch[1]) || 0));
    return {
      kind: 'prevent_damage',
      amount: 'all',
      leaveAmount,
      target: parseObjectSelector('unblocked creature of your choice'),
      recipientTarget: parseObjectSelector('you'),
      duration: 'this_turn',
      combatOnly: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const selfDamageMatch = normalized.match(
    /^if damage would be dealt to this creature, prevent that damage$/i
  );
  if (selfDamageMatch) {
    return {
      kind: 'prevent_damage',
      amount: 'all',
      recipientTarget: parseObjectSelector('this creature'),
      duration: 'this_turn',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const selfDamageRemoveCounterMatch = normalized.match(
    /^if damage would be dealt to (.+?) while it has (?:a|an|one or more|\d+|[a-z]+) (.+?) counters? on it, prevent that damage and remove (a|an|one|\d+|[a-z]+) (.+?) counters? from (.+)$/i
  );
  if (selfDamageRemoveCounterMatch) {
    const recipientText = String(selfDamageRemoveCounterMatch[1] || '').trim();
    const removeAmountText = String(selfDamageRemoveCounterMatch[3] || '').trim();
    const removeCounterText = String(selfDamageRemoveCounterMatch[4] || '').trim();
    const removeTargetText = String(selfDamageRemoveCounterMatch[5] || '').trim();
    return {
      kind: 'conditional',
      condition: {
        kind: 'if',
        raw: `damage would be dealt to ${recipientText} while it has ${String(selfDamageRemoveCounterMatch[2] || '').trim()} counters on it`,
      },
      steps: [
        {
          kind: 'prevent_damage',
          amount: 'all',
          recipientTarget: parseObjectSelector(recipientText),
          duration: 'this_turn',
          raw: 'prevent that damage',
        },
        {
          kind: 'remove_counter',
          amount: parseQuantity(removeAmountText),
          counter: normalizeCounterName(removeCounterText),
          target: parseObjectSelector(removeTargetText),
          raw: `remove ${removeAmountText} ${removeCounterText} counter from ${removeTargetText}`,
        },
      ],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const match = normalized.match(
    /^prevent all damage that would be dealt this turn by (target source(?: of your choice)?) that shares a color with the exiled card$/i
  );
  if (!match) return null;

  return {
    kind: 'prevent_damage',
    amount: 'all',
    target: parseObjectSelector(String(match[1] || '').trim()),
    duration: 'this_turn',
    sharesColorWithLinkedExiledCard: true,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandPreventDamageUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parsePreventDamageUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseWinLossUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  if (/^you win the game$/i.test(normalized)) {
    return {
      kind: 'win_game',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^you lose the game$/i.test(normalized)) {
    return {
      kind: 'lose_game',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^that player loses the game$/i.test(normalized)) {
    return {
      kind: 'lose_game',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^that player wins the game$/i.test(normalized)) {
    return {
      kind: 'win_game',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  return null;
}

function expandWinLossUnknownStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'conditional') {
    let changed = false;
    const expandedNestedSteps = step.steps.map((nestedStep) => {
      const expandedNested = expandWinLossUnknownStep(nestedStep);
      if (expandedNested !== nestedStep) changed = true;
      return expandedNested;
    });
    return changed ? { ...step, steps: expandedNestedSteps } : step;
  }

  if (step.kind !== 'unknown') return step;
  return parseWinLossUnknownStep(step) || step;
}

export function expandWinLossUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      const expanded = expandWinLossUnknownStep(step);
      if (expanded !== step) changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseLeaveBattlefieldReplacementUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^if\s+(it|that card|that creature|that permanent|them|those creatures|those permanents)\s+would\s+leave\s+the\s+battlefield,\s+exile\s+(?:it|them)\s+instead\s+of\s+putting\s+(?:it|them)\s+anywhere\s+else$/i
  );
  if (!match) return null;

  return {
    kind: 'grant_leave_battlefield_replacement',
    target: parseObjectSelector(String(match[1] || '').trim()),
    destination: 'exile',
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function expandConditionalLeaveBattlefieldReplacementStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'conditional') return step;

  let changed = false;
  const expandedNestedSteps = step.steps.map((nestedStep) => {
    const expandedNested = expandConditionalLeaveBattlefieldReplacementStep(nestedStep);
    if (expandedNested !== nestedStep) changed = true;
    return expandedNested;
  });

  const normalizedCondition = normalizeOracleText(String(step.condition?.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  const normalizedRaw = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  const targetMatch = normalizedCondition.match(
    /^(it|that card|that creature|that permanent|them|those creatures|those permanents)\s+would\s+leave\s+the\s+battlefield$/i
  );
  const nestedReplacement = expandedNestedSteps.length === 1 ? expandedNestedSteps[0] : null;

  if (targetMatch && nestedReplacement?.kind === 'exile') {
    const exileTargetText =
      nestedReplacement.target?.kind === 'raw'
        ? normalizeOracleText(String(nestedReplacement.target.text || '')).trim()
        : '';
    const exilePronoun = String(exileTargetText.match(/^(it|them)\b/i)?.[1] || '').trim().toLowerCase();
    const targetPronoun = String(targetMatch[1] || '').trim().toLowerCase();
    if (
      /^(it|them)\s+instead\s+of\s+putting\s+(it|them)\s+anywhere\s+else$/i.test(exileTargetText) &&
      exilePronoun === targetPronoun
    ) {
      return {
        kind: 'grant_leave_battlefield_replacement',
        target: parseObjectSelector(String(targetMatch[1] || '').trim()),
        destination: 'exile',
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalizedRaw || step.raw,
      };
    }
  }

  return changed ? { ...step, steps: expandedNestedSteps } : step;
}

export function expandLeaveBattlefieldReplacementUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind === 'conditional') {
        const expandedConditional = expandConditionalLeaveBattlefieldReplacementStep(step);
        if (expandedConditional !== step) changed = true;
        return expandedConditional;
      }
      if (step.kind !== 'unknown') return step;
      const expanded = parseLeaveBattlefieldReplacementUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}
