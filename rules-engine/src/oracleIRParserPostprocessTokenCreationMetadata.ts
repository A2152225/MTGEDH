/**
 * Token-creation replacement and token metadata annotation for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 21712-22060 of the
 * pre-split file).
 * Cluster moved: the token-creation replacement unknown-step expansion, the candidate scan
 * that stamps `create_token` metadata onto steps and abilities, and the squad reminder
 * fallback that attaches token metadata when no create step parsed.
 * Public entry symbols: expandTokenCreationReplacementUnknownAbilities,
 * annotateTokenCreationMetadataAbilities.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { isKeywordOnlyStaticAbilityText } from './oracleIRParserPostprocessKeywordStaticGrantSteps';
import { enrichCreateTokenCombatEntryFromRaw } from './oracleIRParserTokenFollowup';
import { tryParseTokenCreationReplacementClause } from './oracleIRParserTokenReplacementClauses';
import { tryParseSimpleCreateTokenClause } from './oracleIRParserTokenSimpleClauses';
import { normalizeClauseForParse, normalizeOracleText } from './oracleIRParserUtils';
import { AbilityType } from './oracleTextParser';

export function expandTokenCreationReplacementUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some((step) => step.kind === 'unknown')) return ability;

    const rawText = String(ability.text || ability.effectText || '').trim();
    if (!rawText) return ability;

    const parsed = tryParseTokenCreationReplacementClause({
      clause: rawText,
      rawClause: rawText,
      withMeta: <T extends OracleEffectStep>(step: T): T => step,
    });
    if (!parsed) return ability;

    return {
      ...ability,
      effectText: rawText,
      steps: [parsed],
    };
  });
}

function uniqueTokenCreationCandidates(rawText: string): string[] {
  const normalized = normalizeOracleText(rawText)
    .replace(/^[\s(]+/, '')
    .replace(/[\s.)]+$/g, '')
    .replace(/^[\u2022�]\s*/, '')
    .trim();
  if (!normalized) return [];

  const candidates: string[] = [];
  const addCandidate = (candidate: string, includeDerived = true) => {
    const value = normalizeOracleText(candidate)
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const activatedBody = value.match(/:\s*(create(?:s)?\b.+)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);

    const pipeBody = value.match(/^\s*[^|]+\|\s*(.+)$/);
    if (pipeBody) addCandidate(String(pipeBody[1] || '').trim(), false);
  };

  addCandidate(normalized);

  const squadReminderCreate = normalized.match(/\bsquad\b[\s\S]*?\bwhen this (?:creature|permanent) enters,\s*(create(?:s)?\b[\s\S]*?)(?=\)|$)/i);
  if (squadReminderCreate) addCandidate(String(squadReminderCreate[1] || '').trim());

  const dieBandPattern = /(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*\|\s*([\s\S]*?)(?=\s+\d+(?:\s*[-\u2013\u2014]\s*\d+)?\s*\||$)/g;
  let dieBandMatch: RegExpExecArray | null;
  while ((dieBandMatch = dieBandPattern.exec(normalized)) !== null) {
    addCandidate(String(dieBandMatch[3] || '').trim());
  }

  const triggerMatch = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
  if (triggerMatch) addCandidate(String(triggerMatch[1] || '').trim());

  const conditionalMatch = normalized.match(/^if\b[^,]+,\s+(.+)$/i);
  if (conditionalMatch) addCandidate(String(conditionalMatch[1] || '').trim());

  const andCreateMatch = normalized.match(/\band\s+(create(?:s)?\b.+)$/i);
  if (andCreateMatch) addCandidate(String(andCreateMatch[1] || '').trim());

  const thenCreateMatch = normalized.match(/\bthen\s+(create(?:s)?\b.+)$/i);
  if (thenCreateMatch) addCandidate(String(thenCreateMatch[1] || '').trim());

  const createAnywhereMatch = normalized.match(/\b(create(?:s)?\b[\s\S]+)$/i);
  if (createAnywhereMatch && !/^for each .+,\s+(?:its|their) (?:controller|owner) creates/i.test(normalized)) {
    addCandidate(String(createAnywhereMatch[1] || '').trim());
  }

  for (const line of normalized.split(/\n+/)) {
    const createLineMatch = line.match(/\b(create(?:s)?\b.+)$/i);
    if (createLineMatch) addCandidate(String(createLineMatch[1] || '').trim());
  }

  const quoted = /"([^"]+)"/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quoted.exec(normalized)) !== null) {
    const quotedText = String(quotedMatch[1] || '').trim();
    addCandidate(quotedText);
    const activatedBody = quotedText.match(/:\s*(create(?:s)?\b.+)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim());
  }

  return candidates;
}

function parseTokenCreationMetadataStep(rawText: string): OracleEffectStep | null {
  for (const candidate of uniqueTokenCreationCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate);
    const strippedMayCandidate = normalized.clause.replace(/^you\s+may\s+/i, '').trim();
    for (const createClause of [normalized.clause, strippedMayCandidate]) {
      const parsed = tryParseSimpleCreateTokenClause({
        clause: createClause,
        rawClause: rawText,
        withMeta: <T extends OracleEffectStep>(step: T): T => step,
      });
      if (parsed) return enrichCreateTokenCombatEntryFromRaw(parsed);
    }
  }

  return null;
}

function parseMyriadTokenCreationMetadataStep(rawText: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawText);
  const hasMyriadKeyword = /\bmyriad\b/i.test(normalized);
  if (!hasMyriadKeyword) {
    if (!/for each opponent other than defending player/i.test(normalized)) return null;
    if (!/\bcreate\s+a\s+token\s+cop(?:y|ies)\b/i.test(normalized)) return null;
  }

  return {
    kind: 'create_token',
    who: { kind: 'you' },
    amount: { kind: 'x' },
    token: 'copy of it',
    entersTapped: true,
    attacking: 'each_other_opponent',
    atEndOfCombat: 'exile',
    raw: rawText,
  };
}

function annotateTokenCreationMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateTokenCreationMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateTokenCreationMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateTokenCreationMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'populate') {
    const nestedStep: OracleEffectStep = {
      kind: 'create_token',
      who: step.who,
      amount: step.amount,
      token: 'copy of a creature token you control',
      raw: step.raw,
      ...(step.optional ? { optional: step.optional } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
    };
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    if (existingSteps.some((existingStep) => existingStep.kind === 'create_token')) return step;
    return { ...step, steps: [...existingSteps, nestedStep] };
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    const metadataSteps: OracleEffectStep[] = [];
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    for (const effectText of effectTexts) {
      const parsed = parseTokenCreationMetadataStep(effectText) ?? parseMyriadTokenCreationMetadataStep(effectText);
      if (parsed) metadataSteps.push(parsed);
    }
    const rawParsed = parseTokenCreationMetadataStep(step.raw) ?? parseMyriadTokenCreationMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (Array.isArray((step as any).abilities) && ((step as any).abilities as readonly string[]).includes('myriad')) {
      const parsed = parseMyriadTokenCreationMetadataStep(step.raw || 'myriad');
      if (parsed) metadataSteps.push(parsed);
    }
    if (metadataSteps.length === 0) return step;
    return { ...step, steps: [...existingSteps, ...metadataSteps] };
  }

  if (step.kind === 'unknown' && /(?:\bcreate(?:s)?\b[\s\S]*\btoken|\bmyriad\b)/i.test(normalizeOracleText(String(step.raw || '')))) {
    const parsed = parseTokenCreationMetadataStep(step.raw) ?? parseMyriadTokenCreationMetadataStep(step.raw);
    if (!parsed) return step;
    return { ...(step as any), steps: [parsed] } as unknown as OracleEffectStep;
  }

  if (step.kind === 'create_token') {
    return enrichCreateTokenCombatEntryFromRaw(step);
  }

  return step;
}

function hasCreateTokenStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'create_token') return true;
    if (hasCreateTokenStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasCreateTokenStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasCreateTokenStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function parseTokenCreationMetadataFromAbilityText(ability: OracleIRAbility): OracleEffectStep | null {
  if (ability.steps.some((step) => step.kind === 'investigate')) return null;
  const candidates = [ability.effectText, ability.text];
  for (const candidate of candidates) {
    if (/\bto investigate,\s*create a clue token\b/i.test(normalizeOracleText(String(candidate || '')))) continue;
    const parsed = parseTokenCreationMetadataStep(candidate) ?? parseMyriadTokenCreationMetadataStep(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function isSquadReminderAbilityText(ability: OracleIRAbility): boolean {
  return /^squad\b/i.test(
    normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function hasSquadTokenReminderText(rawText: string | undefined): boolean {
  return /\bsquad\b[\s\S]*?\bwhen this (?:creature|permanent) enters,\s*create(?:s)?\s+that many tokens? that (?:are|is) copies of it/i.test(
    normalizeOracleText(String(rawText || ''))
  );
}

const TOKEN_METADATA_ABILITY_FALLBACK_BLOCKED_KINDS = new Set<string>([
  'grant_static_ability',
  'grant_temporary_ability',
  'grant_temporary_dies_trigger',
  'modify_token_creation',
]);

function canAppendTokenMetadataDespiteBlockedKinds(ability: OracleIRAbility): boolean {
  const blockedSteps = ability.steps.filter((step) => TOKEN_METADATA_ABILITY_FALLBACK_BLOCKED_KINDS.has(step.kind));
  if (blockedSteps.length === 0) return true;
  const allBlockedStepsAreTemporaryGrant = blockedSteps.every((step) => step.kind === 'grant_temporary_ability');
  if (!allBlockedStepsAreTemporaryGrant) return false;

  const text = normalizeOracleText(`${String(ability.text || '')} ${String(ability.effectText || '')}`);
  return /\b\d+\+\s*\|[\s\S]*\bcreate(?:s)?\b[\s\S]*\btoken/i.test(text);
}

function findSquadTokenMetadataFallbackTargetIndex(abilities: readonly OracleIRAbility[]): number {
  const isEligible = (ability: OracleIRAbility): boolean =>
    !isSquadReminderAbilityText(ability) &&
    !hasCreateTokenStepInTree(ability.steps) &&
    ability.steps.some((step) => step.kind !== 'unknown');

  const triggeredEtBIndex = abilities.findIndex(
    (ability) =>
      isEligible(ability) &&
      ability.type === 'triggered' &&
      /\bwhen this creature enters\b/i.test(String(ability.text || ability.effectText || ''))
  );
  if (triggeredEtBIndex >= 0) return triggeredEtBIndex;

  const triggeredIndex = abilities.findIndex(
    (ability) => isEligible(ability) && ability.type === 'triggered'
  );
  if (triggeredIndex >= 0) return triggeredIndex;

  const nonKeywordStaticIndex = abilities.findIndex(
    (ability) =>
      isEligible(ability) &&
      !(ability.type === AbilityType.STATIC && isKeywordOnlyStaticAbilityText(String(ability.text || ability.effectText || '')))
  );
  if (nonKeywordStaticIndex >= 0) return nonKeywordStaticIndex;

  return abilities.findIndex(isEligible);
}

function appendSquadTokenMetadataFallback(
  abilities: readonly OracleIRAbility[],
  parsed: OracleEffectStep,
  rawText: string
): OracleIRAbility[] {
  const metadataWrapper = { kind: 'unknown', raw: 'Token creation metadata', steps: [parsed] } as any as unknown as OracleEffectStep;
  const targetIndex = findSquadTokenMetadataFallbackTargetIndex(abilities);

  if (targetIndex >= 0) {
    return abilities.map((ability, index) =>
      index === targetIndex ? { ...ability, steps: [...ability.steps, metadataWrapper] } : ability
    );
  }

  return [
    ...abilities,
    {
      type: AbilityType.STATIC,
      text: 'Token creation metadata',
      effectText: rawText,
      steps: [metadataWrapper],
    },
  ];
}

export function annotateTokenCreationMetadataAbilities(
  abilities: readonly OracleIRAbility[],
  oracleText?: string
): OracleIRAbility[] {
  const annotated = abilities.map((ability) => {
    const steps = ability.steps.map(annotateTokenCreationMetadataOnStep);
    const withAnnotatedSteps = steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
    if (withAnnotatedSteps.steps.some((step) => step.kind === 'investigate')) return withAnnotatedSteps;
    if (hasCreateTokenStepInTree(withAnnotatedSteps.steps)) return withAnnotatedSteps;

    const parsed = parseTokenCreationMetadataFromAbilityText(withAnnotatedSteps);
    if (!parsed) return withAnnotatedSteps;
    if (!canAppendTokenMetadataDespiteBlockedKinds(withAnnotatedSteps)) return withAnnotatedSteps;
    return { ...withAnnotatedSteps, steps: [...withAnnotatedSteps.steps, parsed] };
  });

  const nonSquadAbilities = annotated.filter((ability) => !isSquadReminderAbilityText(ability));
  if (hasCreateTokenStepInTree(nonSquadAbilities.flatMap((ability) => ability.steps))) return annotated;

  if (oracleText && hasSquadTokenReminderText(oracleText)) {
    const squadAbility = annotated.find((ability) => isSquadReminderAbilityText(ability));
    const parsed = squadAbility ? parseTokenCreationMetadataFromAbilityText(squadAbility) : parseTokenCreationMetadataStep(oracleText);
    if (parsed && nonSquadAbilities.length > 0) {
      return appendSquadTokenMetadataFallback(annotated, parsed, squadAbility?.text || oracleText);
    }
  }

  if (hasCreateTokenStepInTree(annotated.flatMap((ability) => ability.steps))) return annotated;
  if (annotated.length === 0 || !oracleText || !hasSquadTokenReminderText(oracleText)) return annotated;

  const parsed = parseTokenCreationMetadataStep(oracleText);
  if (!parsed) return annotated;
  return appendSquadTokenMetadataFallback(annotated, parsed, oracleText);
}

export {
  hasCreateTokenStepInTree,
  parseMyriadTokenCreationMetadataStep,
  parseTokenCreationMetadataStep,
};
