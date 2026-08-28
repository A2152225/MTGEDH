/**
 * Draw, life and destroy metadata annotation for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 22061-22499 of the
 * pre-split file).
 * Cluster moved: the candidate scanners that re-read an ability's raw text and stamp missing
 * damage, draw, life and destroy steps onto the parsed step tree.
 * Public entry symbols: annotateDrawMetadataAbilities, annotateLifeMetadataAbilities,
 * annotateDestroyMetadataAbilities, plus parseDamageMetadataStep re-exported at the foot of
 * this file for the sacrifice/counter/damage half of the pass.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import { parseLifeTailStep } from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import {
  shouldSkipDrawMetadataCandidate,
  splitDrawAndCreatureBuffStep,
  splitDrawAndDiscardStep,
  splitDrawUntapTailStep,
  stripTriggeredDrawPrefix,
} from './oracleIRParserPostprocessDrawDiscardStepSplitters';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { normalizeClauseForParse, normalizeOracleText } from './oracleIRParserUtils';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';

function uniqueDamageCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/(?:\bdeals?\b[\s\S]*\bdamage\b|\bdamage\b[\s\S]*\binstead\b|\bfights?\b)/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const activatedBody = value.match(/:\s*([\s\S]*?(?:\bdeals?\b[\s\S]*\bdamage\b|\bfights?\b)[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);

    const pipeBody = value.match(/^\s*[^|]+\|\s*(.+)$/);
    if (pipeBody) addCandidate(String(pipeBody[1] || '').trim(), false);
  };

  addCandidate(normalized);

  const triggerMatch = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
  if (triggerMatch) addCandidate(String(triggerMatch[1] || '').trim());

  const conditionalMatch = normalized.match(/^if\b.+?(?:\bwould\s+deal\b|,),\s+(.+)$/i);
  if (conditionalMatch) addCandidate(String(conditionalMatch[1] || '').trim());

  const commaEmbeddedDamage = normalized.match(/,\s*([^,;]*\bdeals?\b[\s\S]*)$/i);
  if (commaEmbeddedDamage) addCandidate(String(commaEmbeddedDamage[1] || '').trim());

  const andDamageMatch = normalized.match(/\band\s+([\s\S]*?(?:\bdeals?\b[\s\S]*\bdamage\b|\bfights?\b)[\s\S]*)$/i);
  if (andDamageMatch) addCandidate(String(andDamageMatch[1] || '').trim());

  const thenDamageMatch = normalized.match(/\bthen\s+([\s\S]*?(?:\bdeals?\b[\s\S]*\bdamage\b|\bfights?\b)[\s\S]*)$/i);
  if (thenDamageMatch) addCandidate(String(thenDamageMatch[1] || '').trim());

  const damageAnywhereMatch = normalized.match(/((?:if\b[\s\S]*?would\s+deal\s+[\s\S]*?instead|[\s\S]*?\bdeals?\s+[\s\S]*?\bdamage\b[\s\S]*|[\s\S]*?\bfights?\b[\s\S]*))$/i);
  if (damageAnywhereMatch) addCandidate(String(damageAnywhereMatch[1] || '').trim());

  for (const line of normalized.split(/\n+/)) addCandidate(line);
  for (const sentence of normalized.split(/\.\s+/)) addCandidate(sentence);

  const haveDealMatch = normalized.match(/(?:^|\.\s*)([^.]*\bmay\s+have\b[^.]*\bdeal\b[^.]*)/i);
  if (haveDealMatch) addCandidate(String(haveDealMatch[1] || '').trim());

  const quoted = /"([^"]+)"/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quoted.exec(normalized)) !== null) {
    const quotedText = String(quotedMatch[1] || '').trim();
    addCandidate(quotedText);
    const activatedBody = quotedText.match(/:\s*([\s\S]*?(?:\bdeals?\b[\s\S]*\bdamage\b|\bfights?\b)[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim());
  }

  return candidates;
}

function parseDamageMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueDamageCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate);
    const strippedMayCandidate = normalized.clause.replace(/^you\s+may\s+/i, '').trim();
    for (const damageClause of [normalized.clause, strippedMayCandidate]) {
      const parsed = tryParseLifeAndCombatClause({
        clause: damageClause,
        rawClause: candidate,
        withMeta: <T extends OracleEffectStep>(step: T): T => step,
      });
      if (parsed && (parsed.kind === 'deal_damage' || parsed.kind === 'modify_damage')) return parsed;
    }
  }

  return null;
}

function uniqueDrawCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\bdraws?\b/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const activatedBody = value.match(/:\s*([\s\S]*?\bdraws?\b[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }

  };

  addCandidate(normalized);
  return candidates;
}

function parseDrawMetadataSteps(rawText: string | undefined): OracleEffectStep[] {
  const results: OracleEffectStep[] = [];
  for (const candidate of uniqueDrawCandidates(rawText)) {
    if (shouldSkipDrawMetadataCandidate(candidate)) continue;
    const body = stripTriggeredDrawPrefix(candidate);
    const normalized = normalizeClauseForParse(body);
    const strippedMayCandidate = normalized.clause.replace(/^you\s+may\s+/i, '').trim();
    let parsed: OracleEffectStep | null = null;
    for (const drawClause of [normalized.clause, strippedMayCandidate, body]) {
      const clauseNormalized = normalizeClauseForParse(drawClause);
      parsed = tryParseSimpleActionClause({
        clause: clauseNormalized.clause,
        rawClause: candidate,
        withMeta: <T extends OracleEffectStep>(step: T): T => step,
      });
      if (parsed?.kind === 'draw') break;
    }
    if (!parsed || parsed.kind !== 'draw') continue;

    const splitDiscard = splitDrawAndDiscardStep(parsed);
    if (splitDiscard) {
      results.push(...splitDiscard);
      continue;
    }
    const splitUntap = splitDrawUntapTailStep(parsed);
    if (splitUntap) {
      results.push(...splitUntap);
      continue;
    }
    const splitBuff = splitDrawAndCreatureBuffStep(parsed);
    if (splitBuff) {
      results.push(...splitBuff);
      continue;
    }
    results.push(parsed);
  }
  return results;
}

function parseDrawMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  const steps = parseDrawMetadataSteps(rawText);
  return steps.length > 0 ? steps[0] : null;
}

function hasDrawStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'draw') return true;
    if (hasDrawStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasDrawStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasDrawStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function annotateDrawMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateDrawMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateDrawMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateDrawMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    if (hasDrawStepInTree(existingSteps)) return step;
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    if (
      effectTexts.some((effectText) =>
        /\bwhen(?:ever)?\b/i.test(String(effectText || '')) ||
        (/\bdraws?\b/i.test(String(effectText || '')) && /\bactivate only as a sorcery\b/i.test(String(effectText || '')))
      )
    ) {
      return step;
    }
    let metadataSteps = effectTexts.flatMap((effectText) => parseDrawMetadataSteps(effectText));
    if (metadataSteps.length === 0) {
      metadataSteps = parseDrawMetadataSteps(step.raw);
    }
    if (metadataSteps.length === 0) return step;
    return { ...step, steps: [...existingSteps, ...metadataSteps] };
  }

  if (step.kind === 'create_emblem') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    if (hasDrawStepInTree(existingSteps)) return step;
    let metadataSteps = step.abilities.flatMap((emblemAbility) => parseDrawMetadataSteps(emblemAbility));
    metadataSteps = [...metadataSteps, ...parseDrawMetadataSteps(step.raw)];
    if (metadataSteps.length === 0) return step;
    return { ...step, steps: [...existingSteps, ...metadataSteps] };
  }

  return step;
}

export function annotateDrawMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateDrawMetadataOnStep);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function uniqueLifeCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\b(?:gains?|loses?)\b[\s\S]*\blife\b/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }

    const activatedBody = value.match(/:\s*([\s\S]*?\b(?:gains?|loses?)\b[\s\S]*\blife\b[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);
  };

  addCandidate(normalized);
  return candidates;
}

function parseLifeMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueLifeCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate);
    if (/^until end of turn,\s+whenever\b/i.test(normalized.clause)) continue;
    const triggerBody = normalized.clause.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    const body = triggerBody ? String(triggerBody[1] || '').trim() : normalized.clause;
    const andLife = body.match(/\band\s+((?:you|each player|each other player|each opponent|target player|target opponent|that player|that opponent)\s+(?:gains?|loses?)\s+.+?\s+life)$/i);
    for (const lifeBody of [body, andLife ? String(andLife[1] || '').trim() : '']) {
      if (!lifeBody) continue;
      const parsed = parseLifeTailStep(lifeBody);
      if (parsed?.kind === 'gain_life' || parsed?.kind === 'lose_life') return parsed;
    }
  }

  return null;
}

function hasLifeStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'gain_life' || step.kind === 'lose_life') return true;
    if (hasLifeStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasLifeStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasLifeStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function annotateLifeMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateLifeMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateLifeMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'create_token') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    if (hasLifeStepInTree(existingSteps)) return step;
    const rawParsed = parseLifeMetadataStep(step.raw);
    if (!rawParsed) return step;
    return { ...(step as any), steps: [...existingSteps, rawParsed] } as unknown as OracleEffectStep;
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    if (hasLifeStepInTree(existingSteps)) return step;
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    if (
      effectTexts.some((effectText) => /^\s*whenever\b/i.test(String(effectText || ''))) ||
      /^\s*whenever\b/i.test(String(step.raw || ''))
    ) {
      return step;
    }
    const metadataSteps = effectTexts
      .map((effectText) => parseLifeMetadataStep(effectText))
      .filter((parsed): parsed is OracleEffectStep => Boolean(parsed));
    const rawParsed = parseLifeMetadataStep(step.raw);
    if (rawParsed && !metadataSteps.some((parsed) => parsed.kind === rawParsed.kind && String((parsed as any).raw || '') === String((rawParsed as any).raw || ''))) {
      metadataSteps.push(rawParsed);
    }
    if (metadataSteps.length === 0) return step;
    return { ...(step as any), steps: [...existingSteps, ...metadataSteps] } as unknown as OracleEffectStep;
  }

  return step;
}

export function annotateLifeMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateLifeMetadataOnStep);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function uniqueDestroyCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\bdestroys?\b/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }

    const activatedDestroyBody = value.match(/:\s*([\s\S]*?\bdestroys?\b[\s\S]*)$/i);
    if (activatedDestroyBody) addCandidate(String(activatedDestroyBody[1] || '').trim(), false);
  };

  addCandidate(normalized);
  return candidates;
}

function parseDestroyMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueDestroyCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate);
    const triggerBody = normalized.clause.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    const body = triggerBody ? String(triggerBody[1] || '').trim() : normalized.clause;
    const parsed = tryParseZoneAndRemovalClause({
      clause: normalizeClauseForParse(body).clause,
      rawClause: body,
      withMeta: <T extends OracleEffectStep>(step: T): T => step,
    });
    if (parsed?.kind === 'destroy') return parsed;
  }

  return null;
}

function hasDestroyStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'destroy') return true;
    if (hasDestroyStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasDestroyStepInTree(mode?.steps)) return true;
      }
    }
  }
  return false;
}

function annotateDestroyMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateDestroyMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateDestroyMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability' || step.kind === 'unknown') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as unknown as OracleEffectStep[])] : [];
    if (hasDestroyStepInTree(existingSteps)) return step;
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    const metadataSteps = effectTexts
      .map((effectText) => parseDestroyMetadataStep(effectText))
      .filter((parsed): parsed is OracleEffectStep => Boolean(parsed));
    const rawParsed = parseDestroyMetadataStep(step.raw);
    const rawTarget = String(((rawParsed as any)?.target as any)?.text || '').replace(/[\s."�]+$/g, '').trim();
    if (rawParsed && !metadataSteps.some((parsed) => {
      const parsedTarget = String(((parsed as any).target as any)?.text || '').replace(/[\s."�]+$/g, '').trim();
      return parsed.kind === rawParsed.kind && parsedTarget === rawTarget;
    })) {
      metadataSteps.push(rawParsed);
    }
    if (metadataSteps.length === 0) return step;
    return { ...(step as any), steps: [...existingSteps, ...metadataSteps] } as unknown as OracleEffectStep;
  }

  return step;
}

export function annotateDestroyMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateDestroyMetadataOnStep);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

export { parseDamageMetadataStep };
