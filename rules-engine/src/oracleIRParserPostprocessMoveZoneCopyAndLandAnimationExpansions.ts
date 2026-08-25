// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: move-zone copy-spell expansions and the small follow-up expanders that sit beside them -
// stripping a trailing "and copy it" into a real copy_spell step, folding a dangling copy_spell onto
// the preceding move_zone context, battlefield-entry haste follow-ups, land animation unknown steps,
// and the conditional "look at the top card, put one in hand, rest in graveyard" body.
//
// Public entry points:
//   expandMoveZoneCopiedSpellAbilities
//   mergeDanglingCopySpellAbilities
//   expandMoveZoneHasteFollowupAbilities
//   expandLandAnimationUnknownAbilities
//   expandConditionalLookTopChooseOneToHandRestToGraveyardAbilities
//   parseLookTopChooseOneToHandRestToGraveyardBody (consumed by the parent's deterministic body parser)

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import {
  appendFollowupSentence,
  applyCopySpellCastTail,
  copySpellRawMentionsRetarget,
  normalizeUnknownStepText,
  parseCopySpellCastTail,
  parseCopySpellRetargetTail,
} from './oracleIRParserPostprocessCopySpellTailHelpers';
import { normalizeOracleText, parseObjectSelector, parseQuantity } from './oracleIRParserUtils';

function stripCopyItSuffix(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): OracleEffectStep {
  const raw = String(step.raw || '').replace(/\s+and copy it\.?$/i, '').trim();
  const what =
    step.what.kind === 'raw'
      ? {
          ...step.what,
          text: String(step.what.text || '').replace(/\s+and copy it$/i, '').trim(),
        }
      : step.what;

  return {
    ...step,
    what,
    raw,
  };
}

export function expandMoveZoneCopiedSpellAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const expandedAbilities = abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const castTail = parseCopySpellCastTail(ability.steps[i + 2]);
      const retargetTail = castTail ? parseCopySpellRetargetTail(ability.steps[i + 3]) : null;

      if (
        current?.kind === 'move_zone' &&
        /\band copy it\.?$/i.test(String(current.raw || '')) &&
        next?.kind === 'unknown' &&
        /^you may cast the copy without paying its mana cost$/i.test(normalizeOracleText(String(next.raw || '')).replace(/[.]+$/g, '').trim())
      ) {
        expandedSteps.push(stripCopyItSuffix(current));
        expandedSteps.push({
          kind: 'copy_spell',
          subject: 'last_moved_card',
          withoutPayingManaCost: true,
          optional: true,
          raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
        });
        changed = true;
        i += 1;
        continue;
      }

      if (current?.kind === 'move_zone' && /\band copy it\.?$/i.test(String(current.raw || ''))) {
        expandedSteps.push(stripCopyItSuffix(current));
        expandedSteps.push({
          kind: 'copy_spell',
          subject: 'last_moved_card',
          raw: 'copy it',
        });
        changed = true;
        continue;
      }

      if (
        current?.kind === 'move_zone' &&
        next?.kind === 'copy_spell' &&
        next.subject === 'target_spell' &&
        /^it$/i.test(String((next.target as { text?: string } | undefined)?.text || ''))
      ) {
        expandedSteps.push(current);
        expandedSteps.push({
          ...next,
          subject: 'last_moved_card',
        });
        changed = true;
        i += 1;
        continue;
      }

      if (
        current?.kind === 'move_zone' &&
        next?.kind === 'unknown' &&
        /^(?:copy that card|copy it)$/i.test(normalizeUnknownStepText(next) || '') &&
        castTail !== null
      ) {
        expandedSteps.push(current);
        expandedSteps.push({
          kind: 'copy_spell',
          subject: 'last_moved_card',
          ...(castTail.castCost ? { castCost: castTail.castCost } : {}),
          ...(castTail.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
          ...(retargetTail ? { allowNewTargets: true } : {}),
          optional: true,
          raw: appendFollowupSentence(appendFollowupSentence(String(next.raw || '').trim(), castTail.raw), retargetTail),
        });
        changed = true;
        i += 2 + (retargetTail ? 1 : 0);
        continue;
      }

      expandedSteps.push(current);
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });

  const mergedAbilities: OracleIRAbility[] = [];
  let mergedChanged = false;

  for (let i = 0; i < expandedAbilities.length; i += 1) {
    const current = expandedAbilities[i];
    const next = expandedAbilities[i + 1];
    const currentSteps = current?.steps || [];
    const nextSteps = next?.steps || [];
    const currentLastStep = currentSteps[currentSteps.length - 1];
    const copyThatCardStep = nextSteps[0];
    const castTail = parseCopySpellCastTail(nextSteps[1]);
    const retargetTail = castTail ? parseCopySpellRetargetTail(nextSteps[2]) : parseCopySpellRetargetTail(nextSteps[1]);
    const consumedStepCount = 1 + (castTail ? 1 : 0) + (retargetTail ? 1 : 0);

    if (
      currentLastStep?.kind === 'move_zone' &&
      copyThatCardStep?.kind === 'unknown' &&
      /^(?:copy that card|copy it)$/i.test(normalizeUnknownStepText(copyThatCardStep) || '') &&
      nextSteps.length === consumedStepCount &&
      current?.type === next?.type
    ) {
      let mergedCopyStep: Extract<OracleEffectStep, { kind: 'copy_spell' }> = {
        kind: 'copy_spell',
        subject: 'last_moved_card',
        optional: true,
        raw: String(copyThatCardStep.raw || '').trim(),
      };

      if (castTail) {
        mergedCopyStep = applyCopySpellCastTail(mergedCopyStep, castTail);
      }

      if (retargetTail) {
        mergedCopyStep = {
          ...mergedCopyStep,
          allowNewTargets: true,
          raw: copySpellRawMentionsRetarget(mergedCopyStep.raw)
            ? mergedCopyStep.raw
            : appendFollowupSentence(mergedCopyStep.raw, retargetTail),
        };
      }

      mergedAbilities.push({
        ...current,
        text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
        effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
        steps: [...currentSteps, mergedCopyStep],
      });
      mergedChanged = true;
      i += 1;
      continue;
    }

    mergedAbilities.push(current);
  }

  return mergedChanged ? mergedAbilities : expandedAbilities;
}

function stepProvidesLastMovedCardContext(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;

  if (step.kind === 'move_zone') {
    return true;
  }

  if (step.kind === 'unknown') {
    const normalized = normalizeUnknownStepText(step);
    return normalized
      ? /^(?:that player|target player|each player|you|an opponent|a player|its controller|their controller) exiles? .+ card(?:s)?\b/i.test(normalized) ||
          /^exile .+ card(?:s)?\b/i.test(normalized)
      : false;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const nestedSteps = step.steps || [];
    return stepProvidesLastMovedCardContext(nestedSteps[nestedSteps.length - 1]);
  }

  return false;
}

function appendDanglingCopySpellToTrailingContext(
  steps: readonly OracleEffectStep[],
  copyStep: Extract<OracleEffectStep, { kind: 'copy_spell' }>
): { steps: readonly OracleEffectStep[]; applied: boolean } {
  if (steps.length === 0) {
    return { steps, applied: false };
  }

  const lastStep = steps[steps.length - 1];

  if (lastStep.kind === 'conditional' || lastStep.kind === 'unless_pays_life' || lastStep.kind === 'unless_pays_mana') {
    const nestedSteps = lastStep.steps || [];
    const nestedResult = appendDanglingCopySpellToTrailingContext(nestedSteps, copyStep);
    if (nestedResult.applied) {
      return {
        steps: [
          ...steps.slice(0, -1),
          {
            ...lastStep,
            steps: nestedResult.steps,
          },
        ],
        applied: true,
      };
    }
  }

  if (!stepProvidesLastMovedCardContext(lastStep)) {
    return { steps, applied: false };
  }

  return {
    steps: [...steps, copyStep],
    applied: true,
  };
}

export function mergeDanglingCopySpellAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const mergedAbilities: OracleIRAbility[] = [];
  let changed = false;

  for (let index = 0; index < abilities.length; index += 1) {
    const current = abilities[index];
    const next = abilities[index + 1];
    const nextCopyCandidate = next?.steps[0];
    const danglingCopyIt =
      nextCopyCandidate?.kind === 'copy_spell' &&
      nextCopyCandidate.subject === 'target_spell' &&
      /^it$/i.test(String((nextCopyCandidate.target as { text?: string } | undefined)?.text || ''));
    const nextCopyStep =
      (next?.type === 'static' || next?.type === 'spell') &&
      next.steps.length === 1 &&
      nextCopyCandidate?.kind === 'copy_spell' &&
      (nextCopyCandidate.subject === 'last_moved_card' || danglingCopyIt)
        ? ({
            ...nextCopyCandidate,
            subject: 'last_moved_card',
          } as Extract<OracleEffectStep, { kind: 'copy_spell' }>)
        : null;

    if (!nextCopyStep || current?.type === 'static') {
      mergedAbilities.push(current);
      continue;
    }

    const appended = appendDanglingCopySpellToTrailingContext(current.steps, nextCopyStep);
    if (!appended.applied) {
      mergedAbilities.push(current);
      continue;
    }

    mergedAbilities.push({
      ...current,
      text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
      effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
      steps: appended.steps,
    });
    changed = true;
    index += 1;
  }

  return changed ? mergedAbilities : [...abilities];
}

function parseBattlefieldMoveHasteFollowupStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): Extract<OracleEffectStep, { kind: 'grant_temporary_ability' }> | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^(it|that card|that creature|that permanent) (?:gains|has) haste(?: until your next turn)?$/i);
  if (!match) return null;

  return {
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(String(match[1] || '').trim()),
    duration: /until your next turn/i.test(normalized) ? 'until_next_turn' : 'end_of_turn',
    abilities: ['haste'],
    ...(step.optional ? { optional: true } : {}),
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: String(step.raw || '').trim(),
  };
}

export function expandMoveZoneHasteFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const current = ability.steps[index];
      const next = ability.steps[index + 1];

      if (
        current?.kind === 'move_zone' &&
        current.to === 'battlefield' &&
        next?.kind === 'unknown'
      ) {
        const expanded = parseBattlefieldMoveHasteFollowupStep(next);
        if (expanded) {
          expandedSteps.push(current, expanded);
          changed = true;
          index += 1;
          continue;
        }
      }

      if (
        next?.kind === 'unknown' &&
        current?.kind === 'conditional' &&
        current.steps.length > 0 &&
        current.steps[current.steps.length - 1]?.kind === 'schedule_delayed_trigger'
      ) {
        const expanded = parseBattlefieldMoveHasteFollowupStep(next);
        if (expanded) {
          const nestedSteps = [...current.steps];
          const delayed = nestedSteps[nestedSteps.length - 1] as Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }>;
          nestedSteps[nestedSteps.length - 1] = {
            ...delayed,
            effect: `${delayed.effect}. ${String(next.raw || '').trim()}`,
            raw: `${delayed.raw}. ${String(next.raw || '').trim()}`,
          };
          expandedSteps.push({ ...current, steps: nestedSteps });
          changed = true;
          index += 1;
          continue;
        }
      }

      expandedSteps.push(current);
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseLandAnimationUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const variablePowerMatch = normalized.match(
    /^(?:up to one )?target land(?: you control)? becomes an? x\/x (.+?) creature(?:\s+with\s+(.+?))?\s+until end of turn,\s*where x is this permanent'?s power$/i
  );
  if (variablePowerMatch) {
    const typeText = String(variablePowerMatch[1] || '').trim();
    const abilityText = String(variablePowerMatch[2] || '').trim();
    const addTypes = [
      'creature',
      ...typeText.split(/\s+/).map((part) => part.trim()).filter(Boolean),
    ];
    const abilities = abilityText
      .split(/,|\band\b/i)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);

    return {
      kind: 'animate_permanent',
      target: { kind: 'target', text: 'land you control' },
      addTypes,
      ...(abilities.length > 0 ? { abilities } : {}),
      duration: 'end_of_turn',
      ...(step.optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: String(step.raw || '').trim(),
    };
  }

  const match = normalized.match(
    /^(if you do,\s*)?(that land|target land(?: you control)?|it) becomes an? (\d+)\s*\/\s*(\d+)\s+(.+?)\s+creature(?:\s+with\s+(.+?))?\s+that'?s still a land$/i
  );
  if (!match) return null;

  const typeText = String(match[5] || '').trim();
  const abilityText = String(match[6] || '').trim();
  const addTypes = [
    'creature',
    ...typeText.split(/\s+/).map(part => part.trim()).filter(Boolean),
  ];
  const abilities = abilityText
    .split(/,|\band\b/i)
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);

  const animateStep: OracleEffectStep = {
    kind: 'animate_permanent',
    target: parseObjectSelector(String(match[2] || '').trim()),
    addTypes,
    power: Number.parseInt(String(match[3] || '0'), 10) || 0,
    toughness: Number.parseInt(String(match[4] || '0'), 10) || 0,
    ...(abilities.length > 0 ? { abilities } : {}),
    duration: 'static',
    ...(step.optional ? { optional: true } : {}),
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: String(step.raw || '').trim(),
  };

  if (match[1]) {
    return {
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you do' },
      steps: [animateStep],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: String(step.raw || '').trim(),
    };
  }

  return animateStep;
}

export function expandLandAnimationUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const steps = ability.steps.map((step) => {
      const expanded = parseLandAnimationUnknownStep(step);
      if (expanded) {
        changed = true;
        return expanded;
      }
      return step;
    });

    return changed ? { ...ability, steps } : ability;
  });
}

function parseLookTopChooseOneToHandRestToGraveyardBody(
  step: OracleEffectStep,
  bodyClause: string
): readonly OracleEffectStep[] | null {
  const normalized = normalizeOracleText(String(bodyClause || ''))
    .replace(/[.]+$/g, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^look at the top (a|an|\d+|x|[a-z]+) cards? of your library,\s*then put one of those cards into your hand and the rest into your graveyard$/i
  );
  if (!match) return null;

  const amount = parseQuantity(String(match[1] || '').trim());
  if (amount.kind !== 'number') return null;

  const lookedAtCount = Math.max(0, amount.value | 0);
  const milledCount = Math.max(0, lookedAtCount - 1);

  const drawStep: OracleEffectStep = {
    kind: 'draw',
    who: { kind: 'you' },
    amount: { kind: 'number', value: lookedAtCount > 0 ? 1 : 0 },
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };

  const millStep: OracleEffectStep = {
    kind: 'mill',
    who: { kind: 'you' },
    amount: { kind: 'number', value: milledCount },
    raw: normalized,
  };

  return milledCount > 0 ? [drawStep, millStep] : [drawStep];
}

function expandConditionalLookTopChooseOneToHandRestToGraveyardStep(
  step: OracleEffectStep
): OracleEffectStep {
  if (step.kind !== 'conditional') return step;

  let changed = false;
  const expandedSteps: OracleEffectStep[] = [];

  for (let i = 0; i < step.steps.length; i += 1) {
    const current = step.steps[i];
    const next = step.steps[i + 1];

    if (current?.kind === 'unknown' && next?.kind === 'move_zone') {
      const deterministic = parseLookTopChooseOneToHandRestToGraveyardBody(
        current,
        `${String(current.raw || '').trim()}, ${String(next.raw || '').trim()}`.trim()
      );
      if (deterministic && deterministic.length > 0) {
        expandedSteps.push(...deterministic);
        changed = true;
        i += 1;
        continue;
      }
    }

    const nested = current.kind === 'conditional'
      ? expandConditionalLookTopChooseOneToHandRestToGraveyardStep(current)
      : current;
    if (nested !== current) changed = true;
    expandedSteps.push(nested);
  }

  return changed ? { ...step, steps: expandedSteps } : step;
}

export function expandConditionalLookTopChooseOneToHandRestToGraveyardAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'conditional') return step;
      const expanded = expandConditionalLookTopChooseOneToHandRestToGraveyardStep(step);
      if (expanded !== step) changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}


export { parseLookTopChooseOneToHandRestToGraveyardBody };
