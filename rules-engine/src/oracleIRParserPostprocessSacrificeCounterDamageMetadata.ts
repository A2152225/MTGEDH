/**
 * Sacrifice, counter and damage metadata annotation for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 22500-23013 of the
 * pre-split file).
 * Cluster moved: the candidate scanners that stamp missing sacrifice, counter and damage
 * steps onto the parsed step tree, including the ability-text damage fallback and its
 * blocked-kind guard.
 * Public entry symbols: annotateCounterMetadataAbilities, annotateSacrificeMetadataAbilities,
 * annotateDamageMetadataAbilities.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { parseSimpleCounterTailStep } from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import { parseDamageMetadataStep } from './oracleIRParserPostprocessDrawLifeDestroyMetadata';
import { expandUnlessSacrificeStep } from './oracleIRParserPostprocessUnlessSacrificeConditionals';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
} from './oracleIRParserUtils';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';

function uniqueSacrificeCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\bsacrifices?\b/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }

    const unclosedGrantedTrigger = value.match(/\bgains?\b[\s\S]*"([^"]*\bsacrifices?\b[\s\S]*)$/i);
    if (unclosedGrantedTrigger) addCandidate(String(unclosedGrantedTrigger[1] || '').trim(), false);

    const activatedBody = value.match(/:\s*([\s\S]*?\bsacrifices?\b[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);
  };

  addCandidate(normalized);
  return candidates;
}

function parseSacrificeMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueSacrificeCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate).clause;
    const candidateBodies = [normalized];
    const triggerBody = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    if (triggerBody) candidateBodies.push(String(triggerBody[1] || '').trim());
    for (const body of [...candidateBodies]) {
      const conditionalBody = String(body || '').trim().match(/^if\s+.+?,\s+(.+)$/i);
      if (conditionalBody) candidateBodies.push(String(conditionalBody[1] || '').trim());
    }

    for (const body of candidateBodies) {
      const clause = normalizeClauseForParse(body).clause.replace(/[.)]+$/g, '').trim();
      if (!clause) continue;

      const scheduledSacrifice = clause.match(
        /^sacrifice\s+(.+?)\s+at\s+(?:the\s+beginning\s+of\s+)?(?:your\s+)?(?:the\s+)?(?:next\s+)?(?:end\s+step|end\s+of\s+combat|cleanup\s+step)(?:\s+if\s+.+)?$/i
      );
      const effectiveClause = scheduledSacrifice ? `sacrifice ${String(scheduledSacrifice[1] || '').trim()}` : clause;
      const parsed = tryParseZoneAndRemovalClause({
        clause: effectiveClause,
        rawClause: effectiveClause,
        withMeta: <T extends OracleEffectStep>(step: T): T => step,
      });
      if (parsed?.kind === 'sacrifice') return expandUnlessSacrificeStep(parsed);
    }
  }

  return null;
}

function uniqueCounterCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''))
    .replace(/^[\s.)]+/, '')
    .replace(/[\s.)]+$/g, '')
    .trim();
  const candidates: string[] = [];

  const addCandidate = (raw: string, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s.)]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\+1\/\+1\s+counters?/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }

    const unclosedGrant = value.match(/\b(?:has|have|gains?)\b[\s\S]*"([^"]*\+1\/\+1\s+counters?[\s\S]*)$/i);
    if (unclosedGrant) addCandidate(String(unclosedGrant[1] || '').trim(), false);

    const activatedBody = value.match(/:\s*([\s\S]*?\+1\/\+1\s+counters?[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);
  };

  addCandidate(normalized);
  return candidates;
}

function parseCounterMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueCounterCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate).clause;
    const candidateBodies = [normalized];
    const triggerBody = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    if (triggerBody) candidateBodies.push(String(triggerBody[1] || '').trim());

    for (const body of candidateBodies) {
      const clause = normalizeClauseForParse(body).clause.replace(/[.)]+$/g, '').trim();
      if (!clause) continue;
      const tail = clause.match(/\b((?:you|they|that player|each player)?\s*(?:may\s+)?put\s+[\s\S]*\+1\/\+1\s+counters?[\s\S]*)$/i);
      const parseCandidates = tail ? [clause, String(tail[1] || '').trim()] : [clause];

      for (const parseCandidate of parseCandidates) {
        const parsed = tryParseSimpleActionClause({
          clause: normalizeClauseForParse(parseCandidate).clause.replace(/[.)]+$/g, '').trim(),
          rawClause: parseCandidate,
          withMeta: <T extends OracleEffectStep>(step: T): T => step,
        });
        if (parsed?.kind === 'add_counter') return parsed;
      }
    }
  }

  return null;
}

function hasCounterStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'add_counter') return true;
    if ((step as any).withCounters?.['+1/+1'] || (step as any).castedPermanentEntersWithCounters?.['+1/+1']) return true;
    if (hasCounterStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasCounterStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasCounterStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function appendUniqueCounterMetadataSteps(
  existingSteps: readonly OracleEffectStep[],
  metadataSteps: readonly OracleEffectStep[]
): OracleEffectStep[] {
  const nextSteps = [...existingSteps];
  const seen = new Set(nextSteps.map((step) => `${step.kind}:${normalizeOracleText(String(step.raw || ''))}`));
  for (const parsed of metadataSteps) {
    const key = `${parsed.kind}:${normalizeOracleText(String(parsed.raw || ''))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextSteps.push(parsed);
  }
  return nextSteps;
}

function shouldSkipCounterMetadataUnknown(raw: string): boolean {
  return /\b(?:monstrous|megamorph|renown|your choice of|spell costs?|can't have|remove x|for each \+1\/\+1 counter|one or more \+1\/\+1 counters would be put|twice that many|that many plus one|choose a creature with the least|turn it face up)\b/i.test(raw);
}

function annotateCounterMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateCounterMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateCounterMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateCounterMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'create_token') {
    const raw = normalizeOracleText(String(step.raw || ''));
    if (/\bto incubate\b/i.test(raw)) return step;
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    if (hasCounterStepInTree(existingSteps)) return step;
    const directCounterTail = raw.match(/\b(put\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+)\s+.+?\s+counters?\s+on\s+this\s+token)\b/i);
    const parsed = directCounterTail
      ? parseSimpleCounterTailStep(String(directCounterTail[1] || '').trim())
      : parseCounterMetadataStep(raw);
    if (!parsed) return step;
    const steps = appendUniqueCounterMetadataSteps(existingSteps, [parsed]);
    return steps.length === existingSteps.length ? step : ({ ...(step as any), steps } as unknown as OracleEffectStep);
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability' || step.kind === 'create_emblem') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    if (hasCounterStepInTree(existingSteps)) return step;
    const metadataSteps: OracleEffectStep[] = [];
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    for (const effectText of effectTexts) {
      const parsed = parseCounterMetadataStep(effectText);
      if (parsed) metadataSteps.push(parsed);
    }
    if (step.kind === 'create_emblem') {
      for (const emblemAbility of step.abilities) {
        const parsed = parseCounterMetadataStep(emblemAbility);
        if (parsed) metadataSteps.push(parsed);
      }
    }
    const rawParsed = parseCounterMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    const steps = appendUniqueCounterMetadataSteps(existingSteps, metadataSteps);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'unknown') {
    const raw = normalizeOracleText(String(step.raw || ''));
    if (
      /\+1\/\+1\s+counters?/i.test(raw) &&
      !shouldSkipCounterMetadataUnknown(raw) &&
      (/\b(?:has|have|gains?|with)\b[\s\S]*"[\s\S]*\+1\/\+1\s+counters?/i.test(raw) || /\bput\b[\s\S]*\+1\/\+1\s+counters?/i.test(raw))
    ) {
      const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
      const parsed = parseCounterMetadataStep(raw);
      if (!parsed) return step;
      const steps = appendUniqueCounterMetadataSteps(existingSteps, [parsed]);
      return steps.length === existingSteps.length ? step : ({ ...(step as any), steps } as unknown as OracleEffectStep);
    }
  }

  return step;
}

export function annotateCounterMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateCounterMetadataOnStep);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function hasSacrificeStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'sacrifice') return true;
    if (hasSacrificeStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasSacrificeStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasSacrificeStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function appendUniqueSacrificeMetadataSteps(
  existingSteps: readonly OracleEffectStep[],
  metadataSteps: readonly OracleEffectStep[]
): OracleEffectStep[] {
  const nextSteps = [...existingSteps];
  const seen = new Set(nextSteps.map((step) => `${step.kind}:${normalizeOracleText(String(step.raw || ''))}`));
  for (const parsed of metadataSteps) {
    const key = `${parsed.kind}:${normalizeOracleText(String(parsed.raw || ''))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextSteps.push(parsed);
  }
  return nextSteps;
}

function annotateSacrificeMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateSacrificeMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateSacrificeMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateSacrificeMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'create_token') {
    const raw = normalizeOracleText(String(step.raw || ''));
    if (
      !step.atNextEndStep &&
      (
        /at\s+the\s+beginning\s+of\s+(?:the\s+)?(?:next\s+)?end\s+step[,"]?\s*sacrifice\s+(?:this|that|the)?\s*(?:token|permanent|it)\b/i.test(raw)
        || /\.?\s*sacrifice\s+(?:this|that|the)?\s*(?:token|permanent|it)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step\b/i.test(raw)
      )
    ) {
      return { ...step, atNextEndStep: 'sacrifice' };
    }
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability' || step.kind === 'create_emblem') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    if (hasSacrificeStepInTree(existingSteps)) return step;
    const metadataSteps: OracleEffectStep[] = [];
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    for (const effectText of effectTexts) {
      const parsed = parseSacrificeMetadataStep(effectText);
      if (parsed) metadataSteps.push(parsed);
    }
    if (step.kind === 'create_emblem') {
      for (const emblemAbility of step.abilities) {
        const parsed = parseSacrificeMetadataStep(emblemAbility);
        if (parsed) metadataSteps.push(parsed);
      }
    }
    const rawParsed = parseSacrificeMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    const steps = appendUniqueSacrificeMetadataSteps(existingSteps, metadataSteps);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'unknown') {
    const raw = normalizeOracleText(String(step.raw || ''));
    if (/\bgains?\b[\s\S]*"[\s\S]*\bwhen\b[\s\S]*\bsacrifices?\b/i.test(raw) && !/\b(?:casualty|devour|echo|vanishing|champion)\b/i.test(raw)) {
      const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
      const parsed = parseSacrificeMetadataStep(raw);
      if (!parsed) return step;
      const steps = appendUniqueSacrificeMetadataSteps(existingSteps, [parsed]);
      return steps.length === existingSteps.length ? step : ({ ...(step as any), steps } as unknown as OracleEffectStep);
    }
  }

  return step;
}

export function annotateSacrificeMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateSacrificeMetadataOnStep);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function hasDamageStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'deal_damage' || step.kind === 'modify_damage') return true;
    if (hasDamageStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasDamageStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasDamageStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

/** Step keys inside folded "... instead" conditionals count as already present (Surtland Flinger, Charbelcher). */
function collectStepKeysIncludingConditionalBranches(steps: readonly OracleEffectStep[], into: Set<string>): void {
  for (const step of steps) {
    into.add(`${step.kind}:${normalizeOracleText(String(step.raw || ''))}`);
    if (step.kind === 'conditional') {
      collectStepKeysIncludingConditionalBranches(step.steps || [], into);
      collectStepKeysIncludingConditionalBranches(((step as any).elseSteps || []) as OracleEffectStep[], into);
    }
  }
}

function appendUniqueDamageMetadataSteps(
  existingSteps: readonly OracleEffectStep[],
  metadataSteps: readonly OracleEffectStep[]
): OracleEffectStep[] {
  const nextSteps = [...existingSteps];
  const seen = new Set<string>();
  collectStepKeysIncludingConditionalBranches(nextSteps, seen);
  for (const parsed of metadataSteps) {
    const key = `${parsed.kind}:${normalizeOracleText(String(parsed.raw || ''))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextSteps.push(parsed);
  }
  return nextSteps;
}

function annotateDamageMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateDamageMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateDamageMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateDamageMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'schedule_delayed_trigger') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    const parsed = parseDamageMetadataStep(step.effect);
    if (!parsed) return step;
    const steps = appendUniqueDamageMetadataSteps(existingSteps, [parsed]);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability') {
    const rawText = normalizeOracleText(String(step.raw || '')).toLowerCase();
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    if (
      /^firstest strike\b/.test(rawText) ||
      effectTexts.some((line) => /^firstest strike\b/i.test(String(line || '')))
    ) {
      return step;
    }
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    const metadataSteps: OracleEffectStep[] = [];
    for (const effectText of effectTexts) {
      const parsed = parseDamageMetadataStep(effectText);
      if (parsed) metadataSteps.push(parsed);
    }
    const rawParsed = parseDamageMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    const steps = appendUniqueDamageMetadataSteps(existingSteps, metadataSteps);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'create_emblem') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    const metadataSteps: OracleEffectStep[] = [];
    for (const emblemAbility of step.abilities) {
      const parsed = parseDamageMetadataStep(emblemAbility);
      if (parsed) metadataSteps.push(parsed);
    }
    const rawParsed = parseDamageMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    const steps = appendUniqueDamageMetadataSteps(existingSteps, metadataSteps);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'unknown' && /(?:\bdeals?\b[\s\S]*\bdamage\b|\bdamage\b[\s\S]*\binstead\b|\bfights?\b)/i.test(normalizeOracleText(String(step.raw || '')))) {
    const parsed = parseDamageMetadataStep(step.raw);
    if (!parsed) return step;
    const existingSteps = Array.isArray((step as any).steps) ? ((step as any).steps as readonly OracleEffectStep[]) : [];
    const steps = appendUniqueDamageMetadataSteps(existingSteps, [parsed]);
    return steps.length === existingSteps.length ? step : ({ ...(step as any), steps } as unknown as OracleEffectStep);
  }

  return step;
}

function parseDamageMetadataFromAbilityText(ability: OracleIRAbility): OracleEffectStep | null {
  const normalizedEffect = normalizeOracleText(String(ability.effectText || ability.text || '')).toLowerCase();
  if (/^firstest strike\b/.test(normalizedEffect)) return null;
  const candidates = [ability.effectText, ability.text];
  for (const candidate of candidates) {
    const parsed = parseDamageMetadataStep(candidate);
    if (parsed) return parsed;
  }
  return null;
}

const DAMAGE_METADATA_ABILITY_FALLBACK_BLOCKED_KINDS = new Set<string>([
  'grant_static_ability',
  'grant_temporary_ability',
  'deal_damage',
  'modify_damage',
  'prevent_damage',
  // A top-level choose_mode step (e.g. "choose one at random" saga/token abilities) already
  // scopes any damage clause to the mode that mentions it; hoisting it to an unconditional
  // top-level metadata step would apply it regardless of which mode was actually chosen.
  'choose_mode',
]);

function canAppendDamageMetadataDespiteBlockedKinds(ability: OracleIRAbility): boolean {
  return !ability.steps.some((step) => DAMAGE_METADATA_ABILITY_FALLBACK_BLOCKED_KINDS.has(step.kind));
}

export function annotateDamageMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateDamageMetadataOnStep);
    const withAnnotatedSteps = steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
    if (hasDamageStepInTree(withAnnotatedSteps.steps)) return withAnnotatedSteps;

    const parsed = parseDamageMetadataFromAbilityText(withAnnotatedSteps);
    if (!parsed) return withAnnotatedSteps;
    if (!canAppendDamageMetadataDespiteBlockedKinds(withAnnotatedSteps)) return withAnnotatedSteps;

    const metadataWrapper = {
      kind: 'grant_static_ability',
      target: parseObjectSelector('damage metadata'),
      effectText: ['damage metadata'],
      duration: 'static',
      raw: 'Damage metadata',
      steps: [parsed],
    } as any as unknown as OracleEffectStep;
    return { ...withAnnotatedSteps, steps: [...withAnnotatedSteps.steps, metadataWrapper] };
  });
}

