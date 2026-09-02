// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseStructuredTriggerResidualGrant's chain covering
// mass temporary P/T grants - self, other creatures, "they", each creature, and each opponent's
// creatures - plus the flip and combat-damage-prevention fragments that sit with them.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';
import { buildForEachScaledTemporaryPtStep, buildForEachTemporaryPtStep, buildTemporaryGrantStepFields, parseBareScaledPtComponents } from './oracleIRParserPostprocessTemporaryGrantStepBuilders';

export function parseTriggerResidualMassTemporaryPtGrantsOne(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const flipThisMatch = raw.match(/^flip this (creature|permanent)$/i);
  if (flipThisMatch) {
    return [{
      kind: 'turn_face_up',
      target: parseObjectSelector(`this ${String(flipThisMatch[1] || 'permanent').toLowerCase()}`),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^flip a coin at end of combat$/i.test(raw)) {
    return [{
      kind: 'flip_coin',
      who: { kind: 'you' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^flip a coin for each creature that isn't a demon, devil, or imp$/i.test(raw)) {
    return [{
      kind: 'flip_coin',
      who: { kind: 'you' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^flip that many coins$/i.test(raw)) {
    return [{
      kind: 'flip_coin',
      who: { kind: 'you' },
      count: 'that_many',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^flip a coin for each opponent you have$/i.test(raw)) {
    return [{
      kind: 'flip_coin',
      who: { kind: 'you' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^prevent\s+all\s+combat\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+(it|this creature|~)\s+this\s+turn\.?$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('this creature'),
      effectText: ['prevent all combat damage that would be dealt to this creature this turn'],
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const massTemporaryPt = raw.match(
    /^creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (massTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures you control'),
      power: Number.parseInt(String(massTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(massTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const teamMassTemporaryPtX = raw.match(
    /^creatures you control get ([+-]?x)\s*\/\s*([+-]?x) until end of turn, where x is (.+?)\.?$/i,
  );
  if (teamMassTemporaryPtX) {
    const powerToken = String(teamMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(teamMassTemporaryPtX[2] || '').trim().toLowerCase();
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessToken.startsWith('-') ? -1 : 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(teamMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const teamMassAsymmetricTemporaryPtX = raw.match(
    /^creatures you control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (teamMassAsymmetricTemporaryPtX) {
    const powerToken = String(teamMassAsymmetricTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(teamMassAsymmetricTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(teamMassAsymmetricTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const otherMassTemporaryPt = raw.match(
    /^other creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (otherMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('other creatures you control'),
      power: Number.parseInt(String(otherMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(otherMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const otherMassTemporaryPtX = raw.match(
    /^other creatures you control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (otherMassTemporaryPtX) {
    const powerToken = String(otherMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(otherMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('other creatures you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(otherMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const otherTypedTeamMassTemporaryPt = raw.match(
    /^other ([a-z][a-z -]*?) you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (otherTypedTeamMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(`other ${String(otherTypedTeamMassTemporaryPt[1] || '').trim()} you control`),
      power: Number.parseInt(String(otherTypedTeamMassTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(otherTypedTeamMassTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOtherMassTemporaryPt = raw.match(
    /^each other creature you control gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachOtherMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each other creature you control'),
      power: Number.parseInt(String(eachOtherMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(eachOtherMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const thoseCreaturesMassTemporaryPt = raw.match(
    /^those creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (thoseCreaturesMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('those creatures'),
      power: Number.parseInt(String(thoseCreaturesMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(thoseCreaturesMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOtherCreatureMassTemporaryPt = raw.match(
    /^each other creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachOtherCreatureMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each other creature'),
      power: Number.parseInt(String(eachOtherCreatureMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(eachOtherCreatureMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const theyMassTemporaryPt = raw.match(
    /^they get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (theyMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('they'),
      power: Number.parseInt(String(theyMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(theyMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const theyMassTemporaryPtX = raw.match(
    /^they get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (theyMassTemporaryPtX) {
    const powerToken = String(theyMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(theyMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('they'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(theyMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOfThemMassTemporaryPt = raw.match(
    /^each of them gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachOfThemMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each of them'),
      power: Number.parseInt(String(eachOfThemMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(eachOfThemMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOfThemMassTemporaryPtX = raw.match(
    /^each of them gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachOfThemMassTemporaryPtX) {
    const powerToken = String(eachOfThemMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(eachOfThemMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each of them'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(eachOfThemMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOfThemCompoundTemporaryPt = raw.match(
    /^each of them gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) and gains? (.+?) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachOfThemCompoundTemporaryPt) {
    const powerToken = String(eachOfThemCompoundTemporaryPt[1] || '').trim().toLowerCase();
    const toughnessToken = String(eachOfThemCompoundTemporaryPt[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    const grantFields = buildTemporaryGrantStepFields(String(eachOfThemCompoundTemporaryPt[3] || '').trim());
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('each of them'),
        power: powerToken.startsWith('-') ? -1 : 1,
        toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
        powerUsesX: true,
        toughnessUsesX,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: `x is ${String(eachOfThemCompoundTemporaryPt[4] || '').trim()}` },
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('each of them'),
        ...grantFields,
        duration: 'end_of_turn',
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const referenceCreatureTemporaryPt = raw.match(
    /^(that creature|the creature|equipped creature|enchanted creature) gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (referenceCreatureTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(String(referenceCreatureTemporaryPt[1] || '').trim().toLowerCase()),
      power: Number.parseInt(String(referenceCreatureTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(referenceCreatureTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const referenceCreatureTemporaryPtX = raw.match(
    /^(that creature|the creature|equipped creature|enchanted creature) gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (referenceCreatureTemporaryPtX) {
    const powerToken = String(referenceCreatureTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessToken = String(referenceCreatureTemporaryPtX[3] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(String(referenceCreatureTemporaryPtX[1] || '').trim().toLowerCase()),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(referenceCreatureTemporaryPtX[4] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const chosenCreatureTemporaryPt = raw.match(
    /^the chosen creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (chosenCreatureTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('the chosen creature'),
      power: Number.parseInt(String(chosenCreatureTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(chosenCreatureTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const chosenCreatureTemporaryPtX = raw.match(
    /^the chosen creature gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (chosenCreatureTemporaryPtX) {
    const powerToken = String(chosenCreatureTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(chosenCreatureTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('the chosen creature'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(chosenCreatureTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const nonartifactMassTemporaryPt = raw.match(
    /^nonartifact creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (nonartifactMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('nonartifact creatures'),
      power: Number.parseInt(String(nonartifactMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(nonartifactMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachCreatureMassTemporaryPt = raw.match(
    /^each creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachCreatureMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature'),
      power: Number.parseInt(String(eachCreatureMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(eachCreatureMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachGlobalWithQualifierMassTemporaryPt = raw.match(
    /^each creature with (.+?) gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachGlobalWithQualifierMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(`each creature with ${String(eachGlobalWithQualifierMassTemporaryPt[1] || '').trim()}`),
      power: Number.parseInt(String(eachGlobalWithQualifierMassTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(eachGlobalWithQualifierMassTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachCreatureMassTemporaryPtX = raw.match(
    /^each creature gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachCreatureMassTemporaryPtX) {
    const scaled = parseBareScaledPtComponents(
      String(eachCreatureMassTemporaryPtX[1] || ''),
      String(eachCreatureMassTemporaryPtX[2] || ''),
    );
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature'),
      ...scaled,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(eachCreatureMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const allCreaturesMassTemporaryPtX = raw.match(
    /^all creatures get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (allCreaturesMassTemporaryPtX) {
    const powerToken = String(allCreaturesMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(allCreaturesMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('all creatures'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(allCreaturesMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const allCreaturesMassTemporaryPt = raw.match(
    /^all creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (allCreaturesMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('all creatures'),
      power: Number.parseInt(String(allCreaturesMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(allCreaturesMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const allOtherCreaturesMassTemporaryPt = raw.match(
    /^all other creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (allOtherCreaturesMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('all other creatures'),
      power: Number.parseInt(String(allOtherCreaturesMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(allOtherCreaturesMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOpponentCreaturesMassTemporaryPt = raw.match(
    /^each opponent(?:'|')?s creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachOpponentCreaturesMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector("each opponent's creatures"),
      power: Number.parseInt(String(eachOpponentCreaturesMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(eachOpponentCreaturesMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOpponentCreaturesForEachFixed = raw.match(
    /^each opponent(?:'|')?s creatures get ([+-]\d+)\/([+-]\d+) until end of turn for each (.+?)\.?$/i,
  );
  if (eachOpponentCreaturesForEachFixed) {
    return [buildForEachTemporaryPtStep(
      "each opponent's creatures",
      Number.parseInt(String(eachOpponentCreaturesForEachFixed[1] || '0'), 10),
      Number.parseInt(String(eachOpponentCreaturesForEachFixed[2] || '0'), 10),
      String(eachOpponentCreaturesForEachFixed[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const eachOpponentCreaturesForEachScaled = raw.match(
    /^each opponent(?:'|')?s creatures get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn for each (.+?)\.?$/i,
  );
  if (eachOpponentCreaturesForEachScaled) {
    return [buildForEachScaledTemporaryPtStep(
      "each opponent's creatures",
      String(eachOpponentCreaturesForEachScaled[1] || ''),
      String(eachOpponentCreaturesForEachScaled[2] || ''),
      String(eachOpponentCreaturesForEachScaled[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const eachOpponentCreatureForEachFixed = raw.match(
    /^each creature an opponent controls gets ([+-]\d+)\/([+-]\d+) until end of turn for each (.+?)\.?$/i,
  );
  if (eachOpponentCreatureForEachFixed) {
    return [buildForEachTemporaryPtStep(
      'each creature an opponent controls',
      Number.parseInt(String(eachOpponentCreatureForEachFixed[1] || '0'), 10),
      Number.parseInt(String(eachOpponentCreatureForEachFixed[2] || '0'), 10),
      String(eachOpponentCreatureForEachFixed[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const eachOpponentCreatureForEachScaled = raw.match(
    /^each creature an opponent controls gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn for each (.+?)\.?$/i,
  );
  if (eachOpponentCreatureForEachScaled) {
    return [buildForEachScaledTemporaryPtStep(
      'each creature an opponent controls',
      String(eachOpponentCreatureForEachScaled[1] || ''),
      String(eachOpponentCreatureForEachScaled[2] || ''),
      String(eachOpponentCreatureForEachScaled[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const eachOpponentCreaturesMassTemporaryPtX = raw.match(
    /^each opponent(?:'|')?s creatures get ([+-]?x)\s*\/\s*([+-]?x) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachOpponentCreaturesMassTemporaryPtX) {
    const powerToken = String(eachOpponentCreaturesMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(eachOpponentCreaturesMassTemporaryPtX[2] || '').trim().toLowerCase();
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector("each opponent's creatures"),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessToken.startsWith('-') ? -1 : 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(eachOpponentCreaturesMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const opponentsMassTemporaryPtX = raw.match(
    /^creatures your opponents control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (opponentsMassTemporaryPtX) {
    const powerToken = String(opponentsMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(opponentsMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures your opponents control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(opponentsMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const opponentsMassTemporaryPt = raw.match(
    /^creatures your opponents control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (opponentsMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures your opponents control'),
      power: Number.parseInt(String(opponentsMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(opponentsMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOpponentCreatureMassTemporaryPtX = raw.match(
    /^each creature an opponent controls gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachOpponentCreatureMassTemporaryPtX) {
    const powerToken = String(eachOpponentCreatureMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(eachOpponentCreatureMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature an opponent controls'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(eachOpponentCreatureMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOpponentCreatureMassTemporaryPt = raw.match(
    /^each creature an opponent controls gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachOpponentCreatureMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature an opponent controls'),
      power: Number.parseInt(String(eachOpponentCreatureMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(eachOpponentCreatureMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

