// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseStructuredTriggerResidualGrant's chain covering
// for-each scaled P/T grants and the subtype, token and "creatures you don't control" scoped variants.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';
import { buildForEachScaledTemporaryPtStep, buildForEachTemporaryPtStep, buildTemporaryGrantStepFields, parseBareScaledPtComponents } from './oracleIRParserPostprocessTemporaryGrantStepBuilders';

export function parseTriggerResidualScaledAndSubtypePtGrantsOne(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const eachDontControlMassTemporaryPt = raw.match(
    /^each creature you don(?:'|')t control gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachDontControlMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector("each creature you don't control"),
      power: Number.parseInt(String(eachDontControlMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(eachDontControlMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachDontControlMassTemporaryPtX = raw.match(
    /^each creature you don(?:'|')t control gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachDontControlMassTemporaryPtX) {
    const powerToken = String(eachDontControlMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(eachDontControlMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector("each creature you don't control"),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(eachDontControlMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const allDontControlMassTemporaryPt = raw.match(
    /^all creatures you don(?:'|')t control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (allDontControlMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector("all creatures you don't control"),
      power: Number.parseInt(String(allDontControlMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(allDontControlMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const allDontControlMassTemporaryPtX = raw.match(
    /^all creatures you don(?:'|')t control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (allDontControlMassTemporaryPtX) {
    const powerToken = String(allDontControlMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(allDontControlMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector("all creatures you don't control"),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(allDontControlMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const allCreaturesForEachFixed = raw.match(
    /^all creatures get ([+-]\d+)\/([+-]\d+) until end of turn for each (.+?)\.?$/i,
  );
  if (allCreaturesForEachFixed) {
    return [buildForEachTemporaryPtStep(
      'all creatures',
      Number.parseInt(String(allCreaturesForEachFixed[1] || '0'), 10),
      Number.parseInt(String(allCreaturesForEachFixed[2] || '0'), 10),
      String(allCreaturesForEachFixed[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const allCreaturesForEachScaled = raw.match(
    /^all creatures get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn for each (.+?)\.?$/i,
  );
  if (allCreaturesForEachScaled) {
    return [buildForEachScaledTemporaryPtStep(
      'all creatures',
      String(allCreaturesForEachScaled[1] || ''),
      String(allCreaturesForEachScaled[2] || ''),
      String(allCreaturesForEachScaled[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const blockingCreatureMassTemporaryPt = raw.match(
    /^each creature blocking (?:it|this creature) gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (blockingCreatureMassTemporaryPt) {
    const targetText = /this creature/i.test(raw) ? 'each creature blocking this creature' : 'each creature blocking it';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(targetText),
      power: Number.parseInt(String(blockingCreatureMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(blockingCreatureMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const blockingCreatureMassTemporaryPtX = raw.match(
    /^each creature blocking (?:it|this creature) gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (blockingCreatureMassTemporaryPtX) {
    const powerToken = String(blockingCreatureMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(blockingCreatureMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    const targetText = /this creature/i.test(raw) ? 'each creature blocking this creature' : 'each creature blocking it';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(targetText),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(blockingCreatureMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const blockingCreaturesMassTemporaryPt = raw.match(
    /^blocking creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (blockingCreaturesMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('blocking creatures'),
      power: Number.parseInt(String(blockingCreaturesMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(blockingCreaturesMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const attackedCreatureTemporaryPt = raw.match(
    /^the creature that attacked gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (attackedCreatureTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('the creature that attacked'),
      power: Number.parseInt(String(attackedCreatureTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(attackedCreatureTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const attackedCreatureTemporaryPtX = raw.match(
    /^the creature that attacked gets ([+-]?x)\s*\/\s*([+-]?x) until end of turn, where x is (.+?)\.?$/i,
  );
  if (attackedCreatureTemporaryPtX) {
    const powerToken = String(attackedCreatureTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(attackedCreatureTemporaryPtX[2] || '').trim().toLowerCase();
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('the creature that attacked'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessToken.startsWith('-') ? -1 : 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(attackedCreatureTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const attackingMassTemporaryPt = raw.match(
    /^(?:each attacking creature|attacking creatures) you control gets? ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (attackingMassTemporaryPt) {
    const target = /^each attacking creature/i.test(raw)
      ? 'each attacking creature you control'
      : 'attacking creatures you control';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(target),
      power: Number.parseInt(String(attackingMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(attackingMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const flankingAttackingMassTemporaryPt = raw.match(
    /^all attacking creatures with flanking get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (flankingAttackingMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('all attacking creatures with flanking'),
      power: Number.parseInt(String(flankingAttackingMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(flankingAttackingMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const unblockedAttackingMassTemporaryPt = raw.match(
    /^unblocked attacking creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (unblockedAttackingMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('unblocked attacking creatures'),
      power: Number.parseInt(String(unblockedAttackingMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(unblockedAttackingMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const tokenMassTemporaryPt = raw.match(
    /^creature tokens you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (tokenMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creature tokens you control'),
      power: Number.parseInt(String(tokenMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(tokenMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const tokenMassTemporaryPtX = raw.match(
    /^creature tokens you control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (tokenMassTemporaryPtX) {
    const powerToken = String(tokenMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(tokenMassTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creature tokens you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(tokenMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const qualifiedMassTemporaryPt = raw.match(
    /^creatures you control with (.+?) get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (qualifiedMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(`creatures you control with ${String(qualifiedMassTemporaryPt[1] || '').trim()}`),
      power: Number.parseInt(String(qualifiedMassTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(qualifiedMassTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const reorderedQualifiedMassTemporaryPt = raw.match(
    /^creatures with (.+?) you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (reorderedQualifiedMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(`creatures you control with ${String(reorderedQualifiedMassTemporaryPt[1] || '').trim()}`),
      power: Number.parseInt(String(reorderedQualifiedMassTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(reorderedQualifiedMassTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const withoutFlyingMassTemporaryPt = raw.match(
    /^creatures you control without flying get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (withoutFlyingMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures you control without flying'),
      power: Number.parseInt(String(withoutFlyingMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(withoutFlyingMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const nonColorMassTemporaryPt = raw.match(
    /^non-(white|blue|black|red|green) creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (nonColorMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(`non-${String(nonColorMassTemporaryPt[1] || '').trim().toLowerCase()} creatures you control`),
      power: Number.parseInt(String(nonColorMassTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(nonColorMassTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const subtypeMassTemporaryPt = raw.match(
    /^([a-z][a-z -]+) creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (subtypeMassTemporaryPt) {
    const subtype = String(subtypeMassTemporaryPt[1] || '').trim();
    if (!/^(?:creature|each|other|those|all|non-(?:white|blue|black|red|green))$/i.test(subtype)) {
      return [{
        kind: 'modify_pt',
        target: parseObjectSelector(`${subtype.toLowerCase()} creatures you control`),
        power: Number.parseInt(String(subtypeMassTemporaryPt[2] || '0'), 10),
        toughness: Number.parseInt(String(subtypeMassTemporaryPt[3] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep];
    }
  }

  const compoundTeamPtAndKeyword = raw.match(
    /^(?:(other) )?creatures you control get ([+-]\d+)\/([+-]\d+) and (?:gain|have) (.+?) until end of turn\.?$/i,
  );
  if (compoundTeamPtAndKeyword) {
    const target = compoundTeamPtAndKeyword[1]
      ? 'other creatures you control'
      : 'creatures you control';
    const grantFields = buildTemporaryGrantStepFields(String(compoundTeamPtAndKeyword[4] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector(target),
        power: Number.parseInt(String(compoundTeamPtAndKeyword[2] || '0'), 10),
        toughness: Number.parseInt(String(compoundTeamPtAndKeyword[3] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(target),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  // Mass combat pumps: "Attacking creatures get +1/+1 and gain trample until end of turn."
  // Also covers "another target attacking creature gets +1/+0 and gains menace until end of turn."
  const compoundAttackingPtAndKeyword = raw.match(
    /^(another target attacking creature|(?:each )?attacking creatures?(?: you control)?) get(?:s)? ([+-]\d+)\/([+-]\d+) and gains? (.+?) until end of turn\.?$/i,
  );
  if (compoundAttackingPtAndKeyword) {
    const target = String(compoundAttackingPtAndKeyword[1] || 'attacking creatures').trim();
    const grantFields = buildTemporaryGrantStepFields(String(compoundAttackingPtAndKeyword[4] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector(target),
        power: Number.parseInt(String(compoundAttackingPtAndKeyword[2] || '0'), 10),
        toughness: Number.parseInt(String(compoundAttackingPtAndKeyword[3] || '0'), 10),
        duration: 'end_of_turn',
        raw: `${target} get${/creature$/i.test(target) ? 's' : ''} ${compoundAttackingPtAndKeyword[2]}/${compoundAttackingPtAndKeyword[3]} until end of turn`,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(target),
        duration: 'end_of_turn',
        ...grantFields,
        raw: `${target} gain${/creature$/i.test(target) ? 's' : ''} ${String(compoundAttackingPtAndKeyword[4] || '').trim()} until end of turn`,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const prefixTeamCombatTemporaryPt = raw.match(
    /^until end of combat,\s*creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (prefixTeamCombatTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures you control'),
      power: Number.parseInt(String(prefixTeamCombatTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(prefixTeamCombatTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const prefixEachControlledTemporaryPt = raw.match(
    /^until end of turn,\s*each creature you control gets ([+-]\d+)\/([+-]\d+)\.?$/i,
  );
  if (prefixEachControlledTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature you control'),
      power: Number.parseInt(String(prefixEachControlledTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(prefixEachControlledTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const prefixEachGlobalTemporaryPt = raw.match(
    /^until end of turn,\s*each creature gets ([+-]\d+)\/([+-]\d+)\.?$/i,
  );
  if (prefixEachGlobalTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature'),
      power: Number.parseInt(String(prefixEachGlobalTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(prefixEachGlobalTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const prefixEachGlobalTemporaryPtX = raw.match(
    /^until end of turn,\s*each creature gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)), where x is (.+?)\.?$/i,
  );
  if (prefixEachGlobalTemporaryPtX) {
    const scaled = parseBareScaledPtComponents(
      String(prefixEachGlobalTemporaryPtX[1] || ''),
      String(prefixEachGlobalTemporaryPtX[2] || ''),
    );
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature'),
      ...scaled,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(prefixEachGlobalTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const prefixEachControlledTemporaryPtX = raw.match(
    /^until end of turn,\s*each creature you control gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)), where x is (.+?)\.?$/i,
  );
  if (prefixEachControlledTemporaryPtX) {
    const scaled = parseBareScaledPtComponents(
      String(prefixEachControlledTemporaryPtX[1] || ''),
      String(prefixEachControlledTemporaryPtX[2] || ''),
    );
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each creature you control'),
      ...scaled,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(prefixEachControlledTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const prefixEachGlobalForEachFixed = raw.match(
    /^until end of turn,\s*each creature gets ([+-]\d+)\/([+-]\d+) for each (.+?)\.?$/i,
  );
  if (prefixEachGlobalForEachFixed) {
    return [buildForEachTemporaryPtStep(
      'each creature',
      Number.parseInt(String(prefixEachGlobalForEachFixed[1] || '0'), 10),
      Number.parseInt(String(prefixEachGlobalForEachFixed[2] || '0'), 10),
      String(prefixEachGlobalForEachFixed[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixEachGlobalForEachScaled = raw.match(
    /^until end of turn,\s*each creature gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) for each (.+?)\.?$/i,
  );
  if (prefixEachGlobalForEachScaled) {
    return [buildForEachScaledTemporaryPtStep(
      'each creature',
      String(prefixEachGlobalForEachScaled[1] || ''),
      String(prefixEachGlobalForEachScaled[2] || ''),
      String(prefixEachGlobalForEachScaled[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixEachControlledForEachFixed = raw.match(
    /^until end of turn,\s*each creature you control gets ([+-]\d+)\/([+-]\d+) for each (.+?)\.?$/i,
  );
  if (prefixEachControlledForEachFixed) {
    return [buildForEachTemporaryPtStep(
      'each creature you control',
      Number.parseInt(String(prefixEachControlledForEachFixed[1] || '0'), 10),
      Number.parseInt(String(prefixEachControlledForEachFixed[2] || '0'), 10),
      String(prefixEachControlledForEachFixed[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixEachControlledForEachScaled = raw.match(
    /^until end of turn,\s*each creature you control gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) for each (.+?)\.?$/i,
  );
  if (prefixEachControlledForEachScaled) {
    return [buildForEachScaledTemporaryPtStep(
      'each creature you control',
      String(prefixEachControlledForEachScaled[1] || ''),
      String(prefixEachControlledForEachScaled[2] || ''),
      String(prefixEachControlledForEachScaled[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixTeamForEachFixed = raw.match(
    /^until end of turn,\s*creatures you control get ([+-]\d+)\/([+-]\d+) for each (.+?)\.?$/i,
  );
  if (prefixTeamForEachFixed) {
    return [buildForEachTemporaryPtStep(
      'creatures you control',
      Number.parseInt(String(prefixTeamForEachFixed[1] || '0'), 10),
      Number.parseInt(String(prefixTeamForEachFixed[2] || '0'), 10),
      String(prefixTeamForEachFixed[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixTeamForEachScaled = raw.match(
    /^until end of turn,\s*creatures you control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) for each (.+?)\.?$/i,
  );
  if (prefixTeamForEachScaled) {
    return [buildForEachScaledTemporaryPtStep(
      'creatures you control',
      String(prefixTeamForEachScaled[1] || ''),
      String(prefixTeamForEachScaled[2] || ''),
      String(prefixTeamForEachScaled[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixAllForEachFixed = raw.match(
    /^until end of turn,\s*all creatures get ([+-]\d+)\/([+-]\d+) for each (.+?)\.?$/i,
  );
  if (prefixAllForEachFixed) {
    return [buildForEachTemporaryPtStep(
      'all creatures',
      Number.parseInt(String(prefixAllForEachFixed[1] || '0'), 10),
      Number.parseInt(String(prefixAllForEachFixed[2] || '0'), 10),
      String(prefixAllForEachFixed[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixAllForEachScaled = raw.match(
    /^until end of turn,\s*all creatures get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) for each (.+?)\.?$/i,
  );
  if (prefixAllForEachScaled) {
    return [buildForEachScaledTemporaryPtStep(
      'all creatures',
      String(prefixAllForEachScaled[1] || ''),
      String(prefixAllForEachScaled[2] || ''),
      String(prefixAllForEachScaled[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixEachOtherForEachFixed = raw.match(
    /^until end of turn,\s*each other creature you control gets ([+-]\d+)\/([+-]\d+) for each (.+?)\.?$/i,
  );
  if (prefixEachOtherForEachFixed) {
    return [buildForEachTemporaryPtStep(
      'each other creature you control',
      Number.parseInt(String(prefixEachOtherForEachFixed[1] || '0'), 10),
      Number.parseInt(String(prefixEachOtherForEachFixed[2] || '0'), 10),
      String(prefixEachOtherForEachFixed[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixEachOtherForEachScaled = raw.match(
    /^until end of turn,\s*each other creature you control gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) for each (.+?)\.?$/i,
  );
  if (prefixEachOtherForEachScaled) {
    return [buildForEachScaledTemporaryPtStep(
      'each other creature you control',
      String(prefixEachOtherForEachScaled[1] || ''),
      String(prefixEachOtherForEachScaled[2] || ''),
      String(prefixEachOtherForEachScaled[3] || '').trim(),
      raw,
      sequence,
    )];
  }

  const prefixTeamAsymmetricTemporaryPtX = raw.match(
    /^until end of turn,\s*creatures you control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)), where x is (.+?)\.?$/i,
  );
  if (prefixTeamAsymmetricTemporaryPtX) {
    const powerToken = String(prefixTeamAsymmetricTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(prefixTeamAsymmetricTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(prefixTeamAsymmetricTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const prefixTeamCompound = raw.match(
    /^until end of turn,\s*creatures you control get ([+-]\d+)\/([+-]\d+) and gain (.+?)\.?$/i,
  );
  if (prefixTeamCompound) {
    const grantFields = buildTemporaryGrantStepFields(String(prefixTeamCompound[3] || ''));
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('creatures you control'),
        power: Number.parseInt(String(prefixTeamCompound[1] || '0'), 10),
        toughness: Number.parseInt(String(prefixTeamCompound[2] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('creatures you control'),
        duration: 'end_of_turn',
        ...grantFields,
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }
  return null;
}

