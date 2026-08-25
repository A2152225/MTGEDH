/**
 * Vote scaling, activation-restriction prunes and emblem / attach expansion for the oracle IR
 * postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 27397-28138 of the
 * pre-split file).
 * Cluster moved: the destroy-and-cant-regenerate follow-up merge, vote-count scaling, the
 * redundant timing / activation / X-cant-be-zero / station charge / hand-reveal / buyback /
 * any-player-may-activate / impulse-cleanup unknown prunes, the deterministic keyword and
 * graveyard-permission follow-up merges, reminder self-exile permission conversion, and the
 * move-zone-with-attach plus create-emblem unknown expansions.
 * Public entry symbols: the merge, prune, expand and convert ability passes exported inline
 * below; parseCreateEmblemUnknownStep, parseMoveZoneWithAttachFollowup and
 * parseBattlefieldControllerForPostprocess are re-exported at the foot of this file.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import {
  isReminderGenericGraveyardGrant,
  isReminderSelfExileStep,
  isReminderSelfGraveyardGrant,
} from './oracleIRParserPostprocessCompoundMoveZoneAndChoiceExpansions';
import { attachGraveyardExileReplacementModifier } from './oracleIRParserPostprocessExileAndGraveyardPermissionModifiers';
import { grantRawEmbedsAdditionalCost } from './oracleIRParserPostprocessGraveyardAdditionalCostPermission';
import { inferZoneFromDestination } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

export function mergeDestroyCantRegenerateFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const mergedSteps: OracleEffectStep[] = [];
    let changed = false;

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      const next = ability.steps[index + 1];

      if (
        step?.kind === 'destroy' &&
        next?.kind === 'unknown' &&
        /^(?:it|they|that (?:permanent|creature|artifact|enchantment|land|planeswalker)|those (?:permanents|creatures|artifacts|enchantments|lands|planeswalkers)) can't be regenerated$/i.test(
          normalizeOracleText(String(next.raw || '')).replace(/^then\b\s*/i, '').trim()
        )
      ) {
        mergedSteps.push({
          ...step,
          cantBeRegenerated: true,
          raw: `${String(step.raw || '').trim()} ${String(next.raw || '').trim()}`.trim(),
        });
        changed = true;
        index += 1;
        continue;
      }

      mergedSteps.push(step);
    }

    return changed ? { ...ability, steps: mergedSteps } : ability;
  });
}

function createVotesForChoiceQuantity(choice: string, multiplier: number = 1) {
  return {
    kind: 'votes_for_choice' as const,
    choice: String(choice || '').trim(),
    ...(multiplier !== 1 ? { multiplier } : {}),
  };
}

function expandVoteScaledStep(step: OracleEffectStep): OracleEffectStep {
  const normalizedRaw = normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim();
  if (!normalizedRaw) return step;

  if (
    step.kind === 'gain_life' ||
    step.kind === 'draw' ||
    step.kind === 'investigate' ||
    step.kind === 'create_token' ||
    step.kind === 'deal_damage'
  ) {
    const receivedPrefix = normalizedRaw.match(
      /^for each vote (you|an opponent|each player|that player) received,\s*.+$/i
    );
    const receivedSuffix = normalizedRaw.match(
      /^.+?\s+for each vote (you|an opponent|each player|that player) received$/i
    );
    const receivedWhoRaw = String(receivedPrefix?.[1] || receivedSuffix?.[1] || '').toLowerCase();
    if (receivedWhoRaw) {
      const who =
        receivedWhoRaw === 'you'
          ? 'you'
          : receivedWhoRaw === 'an opponent'
            ? 'opponents'
            : 'each_player';
      const explicitMultiplier = normalizedRaw.match(
        /(?:gain|draw|create|investigate|deals?)\s+(\d+)\s+(?:life|cards?|tokens?|damage)?/i,
      );
      const multiplier = step.amount.kind === 'number'
        ? step.amount.value
        : Number.parseInt(String(explicitMultiplier?.[1] || '1'), 10);
      return {
        ...step,
        amount: {
          kind: 'votes_received' as const,
          who: who as 'you' | 'opponents' | 'each_player',
          ...(multiplier !== 1 ? { multiplier } : {}),
        },
      };
    }

    const voteMatch = normalizedRaw.match(/\s+for each ([a-z0-9][a-z0-9' -]*) vote$/i);
    if (!voteMatch) return step;
    const explicitMultiplier = normalizedRaw.match(
      /(?:gain|draw|create|investigate)\s+(\d+)\s+(?:life|cards?|tokens?)?\s*for each\b/i,
    );
    const multiplier = step.amount.kind === 'number'
      ? step.amount.value
      : Number.parseInt(String(explicitMultiplier?.[1] || '1'), 10);
    return {
      ...step,
      amount: createVotesForChoiceQuantity(String(voteMatch[1] || '').trim(), multiplier),
    };
  }

  if (step.kind === 'add_counter' && step.target.kind === 'raw' && step.amount.kind === 'number') {
    const targetMatch = String(step.target.text || '').match(/^(.*?)\s+for each ([a-z0-9][a-z0-9' -]*) vote$/i);
    if (!targetMatch) return step;
    const targetText = String(targetMatch[1] || '').trim();
    const choice = String(targetMatch[2] || '').trim();
    if (!targetText || !choice) return step;
    return {
      ...step,
      target: parseObjectSelector(targetText),
      amount: createVotesForChoiceQuantity(choice, step.amount.value),
    };
  }

  return step;
}

function parseVoteScaledUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim();
  if (!normalized) return null;

  {
    const investigateMatch = normalized.match(/^for each ([a-z0-9][a-z0-9' -]*) vote,\s*investigate$/i);
    if (investigateMatch) {
      return {
        kind: 'investigate',
        who: { kind: 'you' },
        amount: createVotesForChoiceQuantity(String(investigateMatch[1] || '').trim()),
        ...(step.optional ? { optional: step.optional } : {}),
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: step.raw,
      };
    }
  }

  {
    const createTokenMatch = normalized.match(/^for each ([a-z0-9][a-z0-9' -]*) vote,\s*create (?:a|an) (.+?) token$/i);
    if (createTokenMatch) {
      const choice = String(createTokenMatch[1] || '').trim();
      const token = String(createTokenMatch[2] || '').trim();
      if (!choice || !token) return null;
      return {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: createVotesForChoiceQuantity(choice),
        token,
        ...(step.optional ? { optional: step.optional } : {}),
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: step.raw,
      };
    }
  }

  return null;
}

export function expandVoteChoiceCountAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind === 'unknown') {
        const expanded = parseVoteScaledUnknownStep(step);
        if (expanded) {
          changed = true;
          return expanded;
        }
      }

      const nextStep = expandVoteScaledStep(step);
      if (nextStep !== step) changed = true;
      return nextStep;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function isRedundantActivationRestrictionUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    /^activate only as a sorcery[.)"”]*$/i.test(normalized) ||
    /^(?:station|saddle) only as a sorcery[.)]*$/i.test(normalized) ||
    /^activate only during your turn[.)"”]*$/i.test(normalized) ||
    /^activate only during your turn, before attackers are declared[.)"”]*$/i.test(normalized) ||
    /^activate only during your upkeep[.)]*$/i.test(normalized) ||
    /^activate only if there are seven or more cards in your graveyard[.)"”]*$/i.test(normalized) ||
    /^activate(?: this ability)? only once(?: each turn)?[.)"”]*$/i.test(normalized)
  );
}

function isRedundantSpellTimingRestrictionUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^cast this spell only during the declare attackers step and only if you(?:'|�)?ve been attacked this step[.)]*$/i.test(normalized);
}

export function pruneRedundantSpellTimingRestrictionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantSpellTimingRestrictionUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function pruneRedundantActivationRestrictionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantActivationRestrictionUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantXCantBeZeroUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^x can't be 0[.)"”]*$/i.test(normalized);
}

export function pruneRedundantXCantBeZeroUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantXCantBeZeroUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isStationThresholdReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^it(?:'|’)s an artifact creature at \d+\+[.)]*$/i.test(normalized) || /^\d+\+\s*\|/i.test(normalized);
}

function isRedundantStationChargeCounterReminderUnknownStep(
  step: OracleEffectStep,
  ability: OracleIRAbility
): boolean {
  if (ability.type !== 'activated' && ability.type !== 'keyword') return false;

  if (step.kind === 'add_counter') {
    const targetText = String((step.target as any)?.text || '').trim();
    const amount = step.amount as any;
    const isStationChargeCounter =
      /^this (?:spacecraft|planet)$/i.test(targetText) &&
      String(step.counter || '').toLowerCase() === 'charge' &&
      amount?.kind === 'object_stat' &&
      amount?.subject === 'it' &&
      amount?.stat === 'power';
    if (!isStationChargeCounter) return false;

    return ability.steps.some(
      (candidate) =>
        candidate.kind === 'unknown' &&
        /^put charge counters equal to its power on this (?:spacecraft|planet)$/i.test(
          normalizeOracleText(String(candidate.raw || '')).trim()
        )
    );
  }

  if (step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!/^put charge counters equal to its power on this (?:spacecraft|planet)$/i.test(normalized)) {
    return false;
  }

  return ability.steps.some((candidate) => {
    if (candidate.kind !== 'add_counter') return false;
    const targetText = String((candidate.target as any)?.text || '').trim();
    const amount = candidate.amount as any;
    return (
      /^this (?:spacecraft|planet)$/i.test(targetText) &&
      String(candidate.counter || '').toLowerCase() === 'charge' &&
      amount?.kind === 'object_stat' &&
      amount?.subject === 'it' &&
      amount?.stat === 'power'
    );
  });
}

export function pruneRedundantStationChargeCounterReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(
      (step) => !isRedundantStationChargeCounterReminderUnknownStep(step, ability)
    );
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantHandRevealDiscardChoiceUnknownStep(
  step: OracleEffectStep,
  ability: OracleIRAbility
): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!/^you choose a nonland card from it$/i.test(normalized)) {
    return false;
  }

  const hasRevealHandStep = ability.steps.some((candidate) => candidate.kind === 'reveal_hand');
  const hasTargetedDiscardThatCardStep = ability.steps.some(
    (candidate) =>
      candidate.kind === 'discard' &&
      candidate.target?.kind === 'raw' &&
      /^that card$/i.test(String(candidate.target.text || '').trim())
  );

  return hasRevealHandStep && hasTargetedDiscardThatCardStep;
}

export function pruneRedundantHandRevealDiscardChoiceUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(
      (step) => !isRedundantHandRevealDiscardChoiceUnknownStep(step, ability)
    );
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantBuybackCostPaymentUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^you may pay an additional buyback cost as you cast this spell[.)]*$/i.test(normalized);
}

export function pruneRedundantBuybackCostReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some((step) => step.kind !== 'unknown')) return ability;
    const nextSteps = ability.steps.filter(step => !isRedundantBuybackCostPaymentUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isStandaloneAnyPlayerMayActivateAbility(ability: OracleIRAbility): boolean {
  const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (!/^any player may activate this ability[.)]*$/i.test(normalizedText)) return false;
  return ability.steps.length > 0 && ability.steps.every((step) => isRedundantAnyPlayerMayActivateUnknownStep(step));
}

function isRedundantAnyPlayerMayActivateUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^any player may activate this ability[.)]*$/i.test(normalized);
}

export function pruneRedundantAnyPlayerMayActivateUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities
    .filter((ability) => !isStandaloneAnyPlayerMayActivateAbility(ability))
    .map((ability) => {
    if (ability.type !== 'activated') return ability;
    if (!ability.steps.some((step) => step.kind !== 'unknown')) return ability;
    const nextSteps = ability.steps.filter(step => !isRedundantAnyPlayerMayActivateUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantImpulseCleanupUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    (/\bput\s+the\s+exiled\s+cards\b/i.test(normalized) &&
      /\bon\s+the\s+bottom\s+of\s+(?:that|their|your)\s+library\b/i.test(normalized)) ||
    (/\bput\s+the\s+exiled\s+card\b/i.test(normalized) &&
      /\bon\s+the\s+bottom\s+of\s+(?:that|their|your)\s+library\b/i.test(normalized)) ||
    (/\bput\s+all\s+cards\s+exiled\b/i.test(normalized) &&
      /\bon\s+the\s+bottom\s+of\s+their\s+library\b/i.test(normalized)) ||
    /\bshuffles\s+the\s+rest\s+into\s+their\s+library\b/i.test(normalized)
  );
}

export function pruneRedundantImpulseCleanupUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const nextSteps: OracleEffectStep[] = [];

    for (const step of ability.steps) {
      const previous = nextSteps[nextSteps.length - 1];
      if (previous?.kind === 'impulse_exile_top' && isRedundantImpulseCleanupUnknownStep(step)) {
        changed = true;
        const previousRaw = normalizeOracleText(String(previous.raw || ''))
          .replace(/[.]+$/g, '')
          .trim();
        const cleanupRaw = normalizeOracleText(String(step.raw || ''))
          .replace(/[.]+$/g, '')
          .trim();
        nextSteps[nextSteps.length - 1] = {
          ...previous,
          raw: `${previousRaw}. ${cleanupRaw}`.trim(),
        };
        continue;
      }

      nextSteps.push(step);
    }

    return changed ? { ...ability, steps: nextSteps } : ability;
  });
}

export function mergeDeterministicKeywordFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < abilities.length; i += 1) {
    const current = abilities[i];
    const next = abilities[i + 1];

    const nextIsKeywordFollowup =
      (next?.type === 'static' || next?.type === 'spell') &&
      next.steps.length === 1 &&
      (
        next.steps[0]?.kind === 'proliferate' ||
        next.steps[0]?.kind === 'ring_tempts_you' ||
        next.steps[0]?.kind === 'investigate' ||
        next.steps[0]?.kind === 'populate'
      );

    if (!current || !nextIsKeywordFollowup) {
      merged.push(current);
      continue;
    }

    merged.push({
      ...current,
      text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
      effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
      steps: [...current.steps, ...next.steps],
    });
    i += 1;
  }

  return merged;
}

export function mergeDeterministicGraveyardPermissionFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];
  const normalizedAbilities = abilities.map((ability) => ({
    ...ability,
    steps: attachGraveyardExileReplacementModifier(ability.steps),
  }));

  for (let i = 0; i < normalizedAbilities.length; i += 1) {
    const current = normalizedAbilities[i];
    const next = normalizedAbilities[i + 1];

    const currentHasGraveyardPermission = Boolean(
      current?.steps.some((step) => step.kind === 'grant_graveyard_permission')
    );
    const nextStartsWithModifier =
      (next?.type === 'static' || next?.type === 'spell') &&
      next.steps.length >= 1 &&
      next.steps[0]?.kind === 'modify_graveyard_permissions' &&
      next.steps.slice(1).every((step) => isReminderGenericGraveyardGrant(step));

    if (!current || !currentHasGraveyardPermission || !nextStartsWithModifier) {
      merged.push(current);
      continue;
    }

    const grantStep = current.steps.find((step) => step.kind === 'grant_graveyard_permission');
    let mergedModifier = next.steps[0];
    if (
      mergedModifier?.kind === 'modify_graveyard_permissions' &&
      grantStep?.kind === 'grant_graveyard_permission' &&
      mergedModifier.additionalCost &&
      !grantRawEmbedsAdditionalCost(String(grantStep.raw || ''), mergedModifier.additionalCost)
    ) {
      const costRaw = String(mergedModifier.additionalCost.raw || mergedModifier.raw || '').trim();
      mergedModifier = {
        ...mergedModifier,
        ...(costRaw ? { raw: costRaw } : {}),
      };
    }

    merged.push({
      ...current,
      text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
      effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
      steps: [...current.steps, mergedModifier],
    });
    i += 1;
  }

  return merged;
}

function convertReminderSelfExileStepsToPermissionModifiers(
  steps: readonly OracleEffectStep[]
): readonly OracleEffectStep[] {
  const nextSteps: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    if (current.kind === 'conditional') {
      const nested = convertReminderSelfExileStepsToPermissionModifiers(current.steps);
      nextSteps.push(nested === current.steps ? current : { ...current, steps: nested });
      continue;
    }

    const next = steps[i + 1];
    if (isReminderSelfGraveyardGrant(current) && next && isReminderSelfExileStep(next)) {
      nextSteps.push(current);
      nextSteps.push({
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        exileInsteadOfGraveyard: true,
        ...(next.sequence ? { sequence: next.sequence } : {}),
        raw: String(next.raw || '').trim(),
      });
      i += 1;
      continue;
    }

    nextSteps.push(current);
  }

  return nextSteps;
}

export function convertReminderSelfExilePermissionAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const converted = convertReminderSelfExileStepsToPermissionModifiers(ability.steps);
    return converted === ability.steps ? ability : { ...ability, steps: converted };
  });
}

function parseBattlefieldControllerForPostprocess(toRaw: string) {
  const normalized = normalizeOracleText(toRaw).toLowerCase();
  if (/\bunder\s+your\s+control\b/i.test(normalized)) return { kind: 'you' } as const;
  if (
    /\bunder\s+its\s+owner'?s\s+control\b/i.test(normalized) ||
    /\bunder\s+their\s+owners'?\s+control\b/i.test(normalized)
  ) {
    return { kind: 'owner_of_moved_cards' } as const;
  }
  if (/\bunder\s+(?:their|his\s+or\s+her)\s+control\b/i.test(normalized)) {
    return { kind: 'owner_of_moved_cards' } as const;
  }
  return undefined;
}

function parseMoveZoneWithAttachFollowup(rawClause: string): readonly OracleEffectStep[] | null {
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^(?:(?:it|this permanent|this enchantment)\s+becomes an aura with\s+"[^"]*?(?:\.)?"\s*)?(return|put)\s+(.+?)\s+(to|onto)\s+(.+?)\s+and attach\s+(this enchantment|this equipment|this permanent|it)\s+to\s+(it|that creature)$/i
  );
  if (!match) return null;

  const action = String(match[1] || '').trim().toLowerCase();
  const whatRaw = String(match[2] || '').trim();
  const preposition = String(match[3] || '').trim().toLowerCase();
  const toRaw = String(match[4] || '').trim();
  const attachmentRaw = String(match[5] || '').trim();
  const targetRaw = String(match[6] || '').trim();
  if (!whatRaw || !toRaw || !attachmentRaw || !targetRaw) return null;

  const fullToRaw = `${preposition} ${toRaw}`.trim();
  const to = inferZoneFromDestination(fullToRaw);
  if (to !== 'battlefield') return null;

  const moveStep: OracleEffectStep = {
    kind: 'move_zone',
    what: parseObjectSelector(whatRaw),
    to,
    toRaw: fullToRaw,
    battlefieldController: parseBattlefieldControllerForPostprocess(fullToRaw),
    raw: `${action === 'return' ? 'Return' : 'Put'} ${whatRaw} ${preposition} ${toRaw}`,
  };

  const attachStep: OracleEffectStep = {
    kind: 'attach',
    attachment: parseObjectSelector(attachmentRaw),
    to: parseObjectSelector(targetRaw),
    raw: `attach ${attachmentRaw} to ${targetRaw}`,
  };

  return [moveStep, attachStep];
}

function parseStandaloneAttachUnknownStep(rawClause: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawClause).replace(/^then\b\s*/i, '').trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^(?:(you)\s+may\s+)?attach\s+((?:this aura|this enchantment|this equipment|this permanent|it|them|that equipment|target (?:aura|equipment|aura or equipment|equipment or aura)(?:\s+you control)?(?:\s+with\s+mana\s+value\s+.+?)?|any number of (?:(?:auras and equipment)|equipment|auras) you control))\s+to\s+(target (?:legendary\s+)?(?:creature|land|permanent|player|permanent or player)(?: (?:you control|an opponent controls|you don(?:'|’)?t control|you do not control))?|another creature|this creature|this permanent|that creature|that land|it)$/i
  );
  if (!match) return null;

  return {
    kind: 'attach',
    attachment: parseObjectSelector(String(match[2] || '').trim()),
    to: parseObjectSelector(String(match[3] || '').trim()),
    optional: Boolean(match[1]),
    raw: normalized,
  };
}

export function expandMoveZoneAttachUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const expandSteps = (steps: readonly OracleEffectStep[]): { readonly steps: readonly OracleEffectStep[]; readonly changed: boolean } => {
    let changed = false;
    const expandedSteps = steps.flatMap((step) => {
      if (step.kind === 'conditional') {
        const expandedNested = expandSteps(step.steps);
        if (!expandedNested.changed) return [step];
        changed = true;
        return [{ ...step, steps: expandedNested.steps }];
      }

      if (step.kind === 'move_zone') {
        const expanded = parseMoveZoneWithAttachFollowup(String(step.raw || ''));
        if (expanded) {
          changed = true;
          return [...expanded];
        }
        return [step];
      }

      if (step.kind !== 'unknown') return [step];
      const expanded = parseMoveZoneWithAttachFollowup(step.raw);
      if (expanded) {
        changed = true;
        return [...expanded];
      }
      const standaloneAttach = parseStandaloneAttachUnknownStep(step.raw);
      if (!standaloneAttach) return [step];
      changed = true;
      return [standaloneAttach];
    });

    return { steps: expandedSteps, changed };
  };

  return abilities.map((ability) => {
    const expanded = expandSteps(ability.steps);
    return expanded.changed ? { ...ability, steps: expanded.steps } : ability;
  });
}

function parseCreateEmblemUnknownStep(rawClause: string, cardName?: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawClause).replace(/^�\s*/, '').trim();
  if (!normalized) return null;

  if (!/^you get an emblem with\b/i.test(normalized)) return null;

  const abilities = Array.from(normalized.matchAll(/"([^"]+)"/g))
    .map(match => String(match[1] || '').trim())
    .filter(Boolean);
  if (abilities.length === 0) {
    const fallback = String(normalized.match(/^you get an emblem with\s+([\s\S]+)$/i)?.[1] || '')
      .replace(/[.]+$/g, '')
      .trim();
    if (fallback) abilities.push(fallback);
  }
  if (abilities.length === 0) return null;

  return {
    kind: 'create_emblem',
    abilities,
    ...(cardName ? { name: `${cardName} Emblem` } : {}),
    raw: normalized,
  };
}

export function expandCreateEmblemUnknownAbilities(
  abilities: readonly OracleIRAbility[],
  cardName?: string
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseCreateEmblemUnknownStep(step.raw, cardName);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export {
  parseBattlefieldControllerForPostprocess,
  parseCreateEmblemUnknownStep,
  parseMoveZoneWithAttachFollowup,
};
