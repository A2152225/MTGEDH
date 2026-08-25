// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseStructuredTriggerResidualGrant's chain covering
// compound "gets +N/+N and gains <keyword>" grants across self, target, team and subtype scopes.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';
import { buildForEachScaledTemporaryPtStep, buildForEachTemporaryPtStep, buildTemporaryGrantStepFields } from './oracleIRParserPostprocessTemporaryGrantStepBuilders';

export function parseTriggerResidualCompoundPtAndKeywordGrantsOne(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const prefixTeamCompoundGainFirstX = raw.match(
    /^until end of turn,\s*creatures you control gain (.+?) and get ([+-]?x)\s*\/\s*([+-]?x), where x is (.+?)\.?$/i,
  );
  if (prefixTeamCompoundGainFirstX) {
    const grantFields = buildTemporaryGrantStepFields(String(prefixTeamCompoundGainFirstX[1] || ''));
    const powerToken = String(prefixTeamCompoundGainFirstX[2] || '').trim().toLowerCase();
    const toughnessToken = String(prefixTeamCompoundGainFirstX[3] || '').trim().toLowerCase();
    return [
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('creatures you control'),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'modify_pt',
        target: parseObjectSelector('creatures you control'),
        power: powerToken.startsWith('-') ? -1 : 1,
        toughness: toughnessToken.startsWith('-') ? -1 : 1,
        powerUsesX: true,
        toughnessUsesX: true,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: `x is ${String(prefixTeamCompoundGainFirstX[4] || '').trim()}` },
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const teamHaveKeywordUntilEot = raw.match(
    /^creatures you control have (.+?) until end of turn\.?$/i,
  );
  if (teamHaveKeywordUntilEot) {
    const grantFields = buildTemporaryGrantStepFields(String(teamHaveKeywordUntilEot[1] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('creatures you control'),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const teamGainKeywordUntilEot = raw.match(
    /^creatures you control gain (.+?) until end of turn\.?$/i,
  );
  if (teamGainKeywordUntilEot && !/\band get\b/i.test(raw)) {
    const grantFields = buildTemporaryGrantStepFields(String(teamGainKeywordUntilEot[1] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('creatures you control'),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetGainKeywordUntilEot = raw.match(
    /^target creature gains? (.+?) until end of turn\.?$/i,
  );
  if (targetGainKeywordUntilEot && !/\bgets?\s+[+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\b/i.test(raw)) {
    const grantFields = buildTemporaryGrantStepFields(String(targetGainKeywordUntilEot[1] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('target creature'),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const controlledTargetGainKeywordUntilEot = raw.match(
    /^target creature you control gains? (.+?) until end of turn\.?$/i,
  );
  if (controlledTargetGainKeywordUntilEot && !/\bgets?\s+[+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\b/i.test(raw)) {
    const grantFields = buildTemporaryGrantStepFields(String(controlledTargetGainKeywordUntilEot[1] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('target creature you control'),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const anotherControlledTargetGainKeywordUntilEot = raw.match(
    /^another target creature you control gains? (.+?) until end of turn\.?$/i,
  );
  if (anotherControlledTargetGainKeywordUntilEot && !/\bgets?\s+[+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\b/i.test(raw)) {
    const grantFields = buildTemporaryGrantStepFields(String(anotherControlledTargetGainKeywordUntilEot[1] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('another target creature you control'),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const referenceGainKeywordUntilEot = raw.match(
    /^(that creature|enchanted creature|equipped creature) gains? (.+?) until end of turn\.?$/i,
  );
  if (referenceGainKeywordUntilEot && !/\bgets?\s+[+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\b/i.test(raw)) {
    const grantFields = buildTemporaryGrantStepFields(String(referenceGainKeywordUntilEot[2] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector(String(referenceGainKeywordUntilEot[1] || '').trim().toLowerCase()),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const otherGainKeywordUntilEot = raw.match(
    /^other creatures you control gain (.+?) until end of turn\.?$/i,
  );
  if (otherGainKeywordUntilEot && !/\band get\b/i.test(raw)) {
    const grantFields = buildTemporaryGrantStepFields(String(otherGainKeywordUntilEot[1] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('other creatures you control'),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachControlledGainKeywordUntilEot = raw.match(
    /^each creature you control gains? (.+?) until end of turn\.?$/i,
  );
  if (eachControlledGainKeywordUntilEot && !/\band get\b/i.test(raw)) {
    const grantFields = buildTemporaryGrantStepFields(String(eachControlledGainKeywordUntilEot[1] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('each creature you control'),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const prefixSelfScaledTemporaryPtX = raw.match(
    /^until end of turn,\s*(?:it|this creature|he|she|~|this) gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)), where x is (.+?)\.?$/i,
  );
  if (prefixSelfScaledTemporaryPtX) {
    const powerToken = String(prefixSelfScaledTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(prefixSelfScaledTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('this creature'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(prefixSelfScaledTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachWithQualifierGrantKeywordUntilEot = raw.match(
    /^each creature you control with (.+?) gains? (.+?) until end of turn\.?$/i,
  );
  if (eachWithQualifierGrantKeywordUntilEot && !/\bgets?\s+[+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\b/i.test(raw)) {
    const grantFields = buildTemporaryGrantStepFields(String(eachWithQualifierGrantKeywordUntilEot[2] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector(`each creature you control with ${String(eachWithQualifierGrantKeywordUntilEot[1] || '').trim()}`),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const prefixSelfGainKeywordUntilEot = raw.match(
    /^until end of turn,\s*(?:it|this creature|he|she|~|this) gains? (.+?)\.?$/i,
  );
  if (prefixSelfGainKeywordUntilEot) {
    const grantFields = buildTemporaryGrantStepFields(String(prefixSelfGainKeywordUntilEot[1] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('this creature'),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const selfGainKeywordUntilEot = raw.match(
    /^(?:he|she|it|this creature|~|this) gains? (.+?) until end of turn\.?$/i,
  );
  if (selfGainKeywordUntilEot && !/\bgets?\s+[+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\b/i.test(raw)) {
    const grantFields = buildTemporaryGrantStepFields(String(selfGainKeywordUntilEot[1] || ''));
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('this creature'),
      duration: 'end_of_turn',
      ...grantFields,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const prefixTargetScaledTemporaryPtX = raw.match(
    /^until end of turn,\s*target creature gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)), where x is (.+?)\.?$/i,
  );
  if (prefixTargetScaledTemporaryPtX) {
    const powerToken = String(prefixTargetScaledTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(prefixTargetScaledTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(prefixTargetScaledTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetPlayerCompound = raw.match(
    /^creatures target player controls get ([+-]\d+)\/([+-]\d+) and gain (.+?) until end of turn\.?$/i,
  );
  if (targetPlayerCompound) {
    const grantFields = buildTemporaryGrantStepFields(String(targetPlayerCompound[3] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('creatures target player controls'),
        power: Number.parseInt(String(targetPlayerCompound[1] || '0'), 10),
        toughness: Number.parseInt(String(targetPlayerCompound[2] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('creatures target player controls'),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const compoundSelfPtAndKeyword = raw.match(
    /^(?:it|this creature|he|she|~|this) gets ([+-]\d+)\/([+-]\d+) and gains? (.+?) until end of turn\.?$/i,
  );
  if (compoundSelfPtAndKeyword) {
    const grantFields = buildTemporaryGrantStepFields(String(compoundSelfPtAndKeyword[3] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('this creature'),
        power: Number.parseInt(String(compoundSelfPtAndKeyword[1] || '0'), 10),
        toughness: Number.parseInt(String(compoundSelfPtAndKeyword[2] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('this creature'),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const prefixSelfCompoundPtAndKeyword = raw.match(
    /^until end of turn,\s*(?:it|this creature|he|she|~|this) gets ([+-]\d+)\/([+-]\d+) and gains? (.+?)\.?$/i,
  );
  if (prefixSelfCompoundPtAndKeyword) {
    const grantFields = buildTemporaryGrantStepFields(String(prefixSelfCompoundPtAndKeyword[3] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('this creature'),
        power: Number.parseInt(String(prefixSelfCompoundPtAndKeyword[1] || '0'), 10),
        toughness: Number.parseInt(String(prefixSelfCompoundPtAndKeyword[2] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('this creature'),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const selfScaledTemporaryPtX = raw.match(
    /^(?:it|this creature|he|she|~|this) gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (selfScaledTemporaryPtX) {
    const powerToken = String(selfScaledTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(selfScaledTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('this creature'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(selfScaledTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const selfScaledTemporaryPtNoCommaWhere = raw.match(
    /^(?:it|this creature|he|she|~|this) gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn where x is (.+?)\.?$/i,
  );
  if (selfScaledTemporaryPtNoCommaWhere) {
    const powerToken = String(selfScaledTemporaryPtNoCommaWhere[1] || '').trim().toLowerCase();
    const toughnessToken = String(selfScaledTemporaryPtNoCommaWhere[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('this creature'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(selfScaledTemporaryPtNoCommaWhere[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const compoundTargetGrantFirstPt = raw.match(
    /^target creature gains? (.+?) and gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (compoundTargetGrantFirstPt) {
    const grantFields = buildTemporaryGrantStepFields(String(compoundTargetGrantFirstPt[1] || ''));
    return [
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('target creature'),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'modify_pt',
        target: parseObjectSelector('target creature'),
        power: Number.parseInt(String(compoundTargetGrantFirstPt[2] || '0'), 10),
        toughness: Number.parseInt(String(compoundTargetGrantFirstPt[3] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const compoundTargetPtAndKeyword = raw.match(
    /^(?:until end of turn,\s+)?target creature gets ([+-]\d+)\/([+-]\d+) and gains? (.+?)\.?$/i,
  );
  if (compoundTargetPtAndKeyword) {
    const grantFields = buildTemporaryGrantStepFields(String(compoundTargetPtAndKeyword[3] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('target creature'),
        power: Number.parseInt(String(compoundTargetPtAndKeyword[1] || '0'), 10),
        toughness: Number.parseInt(String(compoundTargetPtAndKeyword[2] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('target creature'),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const eachControlledWithQualifierFixedTemporaryPt = raw.match(
    /^each creature you control with (.+?) gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachControlledWithQualifierFixedTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(`each creature you control with ${String(eachControlledWithQualifierFixedTemporaryPt[1] || '').trim()}`),
      power: Number.parseInt(String(eachControlledWithQualifierFixedTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(eachControlledWithQualifierFixedTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const forEachTeamTemporaryPt = raw.match(
    /^creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn for each (.+?)\.?$/i,
  );
  if (forEachTeamTemporaryPt) {
    return [buildForEachTemporaryPtStep(
      'creatures you control',
      Number.parseInt(String(forEachTeamTemporaryPt[1] || '0'), 10),
      Number.parseInt(String(forEachTeamTemporaryPt[2] || '0'), 10),
      String(forEachTeamTemporaryPt[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const forEachSingularTemporaryPt = raw.match(
    /^(each creature|each creature you control|each other creature you control|target creature) gets ([+-]\d+)\/([+-]\d+) until end of turn for each (.+?)\.?$/i,
  );
  if (forEachSingularTemporaryPt) {
    return [buildForEachTemporaryPtStep(
      String(forEachSingularTemporaryPt[1] || '').trim().toLowerCase(),
      Number.parseInt(String(forEachSingularTemporaryPt[2] || '0'), 10),
      Number.parseInt(String(forEachSingularTemporaryPt[3] || '0'), 10),
      String(forEachSingularTemporaryPt[4] || '').trim(),
      raw,
      sequence,
    )];
  }

  const forEachTeamScaledTemporaryPt = raw.match(
    /^creatures you control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn for each (.+?)\.?$/i,
  );
  if (forEachTeamScaledTemporaryPt) {
    return [buildForEachScaledTemporaryPtStep(
      'creatures you control',
      String(forEachTeamScaledTemporaryPt[1] || ''),
      String(forEachTeamScaledTemporaryPt[2] || ''),
      String(forEachTeamScaledTemporaryPt[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const forEachSingularScaledTemporaryPt = raw.match(
    /^(each creature|each creature you control|each other creature you control|target creature) gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn for each (.+?)\.?$/i,
  );
  if (forEachSingularScaledTemporaryPt) {
    return [buildForEachScaledTemporaryPtStep(
      String(forEachSingularScaledTemporaryPt[1] || '').trim().toLowerCase(),
      String(forEachSingularScaledTemporaryPt[2] || ''),
      String(forEachSingularScaledTemporaryPt[3] || ''),
      String(forEachSingularScaledTemporaryPt[4] || '').trim(),
      raw,
      sequence,
    )];
  }

  const eachControlledWithQualifierTemporaryPtX = raw.match(
    /^each creature you control with (.+?) gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachControlledWithQualifierTemporaryPtX) {
    const powerToken = String(eachControlledWithQualifierTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessToken = String(eachControlledWithQualifierTemporaryPtX[3] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(`each creature you control with ${String(eachControlledWithQualifierTemporaryPtX[1] || '').trim()}`),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(eachControlledWithQualifierTemporaryPtX[4] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachControlledTemporaryPt = raw.match(
    /^each creature you control gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachControlledTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature you control'),
      power: Number.parseInt(String(eachControlledTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(eachControlledTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachControlledTemporaryPtX = raw.match(
    /^each creature you control gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachControlledTemporaryPtX) {
    const powerToken = String(eachControlledTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(eachControlledTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(eachControlledTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const compoundChosenTypePtAndKeyword = raw.match(
    /^creatures you control of the chosen type get ([+-]\d+)\/([+-]\d+) and gain (.+?) until end of turn\.?$/i,
  );
  if (compoundChosenTypePtAndKeyword) {
    const grantFields = buildTemporaryGrantStepFields(String(compoundChosenTypePtAndKeyword[3] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('creatures you control of the chosen type'),
        power: Number.parseInt(String(compoundChosenTypePtAndKeyword[1] || '0'), 10),
        toughness: Number.parseInt(String(compoundChosenTypePtAndKeyword[2] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('creatures you control of the chosen type'),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const compoundSubtypeOtherThanSelfPtAndKeyword = raw.match(
    /^([a-z][a-z -]+) you control other than this creature get ([+-]\d+)\/([+-]\d+) and gain (.+?) until end of turn\.?$/i,
  );
  if (compoundSubtypeOtherThanSelfPtAndKeyword) {
    const targetText = `${String(compoundSubtypeOtherThanSelfPtAndKeyword[1] || '').trim().toLowerCase()} you control other than this creature`;
    const grantFields = buildTemporaryGrantStepFields(String(compoundSubtypeOtherThanSelfPtAndKeyword[4] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector(targetText),
        power: Number.parseInt(String(compoundSubtypeOtherThanSelfPtAndKeyword[2] || '0'), 10),
        toughness: Number.parseInt(String(compoundSubtypeOtherThanSelfPtAndKeyword[3] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(targetText),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const chosenTypeMassTemporaryPtX = raw.match(
    /^creatures you control of the chosen type get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (chosenTypeMassTemporaryPtX) {
    const powerToken = String(chosenTypeMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(chosenTypeMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures you control of the chosen type'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(chosenTypeMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const optionalTargetTemporaryPt = raw.match(
    /^you may have target creature get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (optionalTargetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature'),
      power: Number.parseInt(String(optionalTargetTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(optionalTargetTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetTemporaryPt = raw.match(
    /^target creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (targetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature'),
      power: Number.parseInt(String(targetTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(targetTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const anotherTargetTemporaryPt = raw.match(
    /^another target creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (anotherTargetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('another target creature'),
      power: Number.parseInt(String(anotherTargetTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(anotherTargetTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

