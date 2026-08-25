// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: the small step builders shared by the residual-grant chains - splitting a "gains ..."
// clause into keyword parts, shaping a temporary grant step, and building the for-each and
// scaled for-each temporary P/T steps.
//
// These sit in their own module because the hoisted guard-run siblings need them; leaving them in
// the parent would force a leaf to import its own parent.
//
// Public entry points:
//   parseTemporaryKeywordAbilityParts
//   buildTemporaryGrantStepFields
//   buildForEachTemporaryPtStep
//   parseBareScaledPtComponents
//   buildForEachScaledTemporaryPtStep

import type { OracleEffectStep, OracleScaler } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';

function parseTemporaryKeywordAbilityParts(gainsRaw: string): string[] {
  return String(gainsRaw || '')
    .replace(/\s+until end of turn$/i, '')
    .replace(/[.]+$/g, '')
    .trim()
    .split(/\s+and\s+/i)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function buildTemporaryGrantStepFields(
  gainsRaw: string,
): { abilities?: string[]; effectText?: string[] } {
  const parts = parseTemporaryKeywordAbilityParts(gainsRaw);
  const keywordParts = parts.filter((part) =>
    /^(flying|trample|vigilance|lifelink|deathtouch|reach|menace|shroud|hexproof|indestructible|fear|intimidate|shadow|horsemanship|first strike|double strike|haste|ward|myriad|infect)$/.test(part),
  );
  if (keywordParts.length === parts.length && keywordParts.length > 0) {
    return { abilities: keywordParts };
  }
  const text = parts.join(' and ');
  return text ? { effectText: [text] } : {};
}

function buildForEachScalerField(forEachPartRaw: string): OracleScaler | undefined {
  const eachRaw = `for each ${String(forEachPartRaw || '').trim()}`.trim();
  if (/^for\s+each\s+card\s+revealed\s+this\s+way$/i.test(eachRaw)) {
    return { kind: 'per_revealed_this_way' };
  }
  if (/^for\s+each\s+creature\s+blocking\s+it$/i.test(eachRaw)) {
    return { kind: 'per_creature_blocking_it' };
  }
  if (/^for\s+each\s+basic\s+land\s+type\s+among\s+lands\s+you\s+control$/i.test(eachRaw)) {
    return { kind: 'per_basic_land_type_among_lands_you_control' };
  }
  if (/^for\s+each\s+artifact\s+you\s+control$/i.test(eachRaw)) {
    return { kind: 'per_artifact_you_control' };
  }
  if (/^for\s+each\s+creature\s+tapped\s+this\s+way$/i.test(eachRaw)) {
    return { kind: 'per_creature_tapped_this_way' };
  }
  if (/^for\s+each\s+goblin\s+you\s+control$/i.test(eachRaw)) {
    return { kind: 'per_goblin_you_control' };
  }
  if (/^for\s+each\s+other\s+attacking\s+aurochs$/i.test(eachRaw)) {
    return { kind: 'per_other_attacking_aurochs' };
  }
  return { kind: 'reference_scaler', raw: eachRaw };
}

function buildForEachTemporaryPtStep(
  targetRaw: string,
  power: number,
  toughness: number,
  forEachPartRaw: string,
  raw: string,
  sequence: { sequence?: 'then' },
): OracleEffectStep {
  return {
    kind: 'modify_pt',
    target: parseObjectSelector(targetRaw),
    power,
    toughness,
    scaler: buildForEachScalerField(forEachPartRaw),
    duration: 'end_of_turn',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep;
}

function parseBareScaledPtComponents(
  powerToken: string,
  toughnessToken: string,
): {
  power: number;
  toughness: number;
  powerUsesX: boolean;
  toughnessUsesX: boolean;
} {
  const powerRaw = String(powerToken || '').trim().toLowerCase();
  const toughnessRaw = String(toughnessToken || '').trim().toLowerCase();
  const powerUsesX = powerRaw === 'x' || powerRaw === '+x' || powerRaw === '-x';
  const toughnessUsesX = toughnessRaw === 'x' || toughnessRaw === '+x' || toughnessRaw === '-x';
  return {
    power: powerUsesX ? (powerRaw.startsWith('-') ? -1 : 1) : Number.parseInt(powerRaw, 10) || 0,
    toughness: toughnessUsesX ? (toughnessRaw.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessRaw, 10) || 0,
    powerUsesX,
    toughnessUsesX,
  };
}

function buildForEachScaledTemporaryPtStep(
  targetRaw: string,
  powerToken: string,
  toughnessToken: string,
  forEachPartRaw: string,
  raw: string,
  sequence: { sequence?: 'then' },
): OracleEffectStep {
  const scaled = parseBareScaledPtComponents(powerToken, toughnessToken);
  return {
    kind: 'modify_pt',
    target: parseObjectSelector(targetRaw),
    ...scaled,
    scaler: buildForEachScalerField(forEachPartRaw),
    duration: 'end_of_turn',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep;
}


export {
  parseTemporaryKeywordAbilityParts,
  buildTemporaryGrantStepFields,
  buildForEachTemporaryPtStep,
  parseBareScaledPtComponents,
  buildForEachScaledTemporaryPtStep,
};
