// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseStructuredTriggerResidualGrant's chain covering
// targeted P/T grants with an X amount, can't-block and sacrifice-at-end-step riders, and the small
// payment and guessing fragments beside them.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';
import { createAnnihilatorGrantStep, createSemanticStaticGrantStep, createStructuredKeywordActionGrantStep } from './oracleIRParserPostprocessKeywordStaticGrantSteps';
import { buildForEachTemporaryPtStep } from './oracleIRParserPostprocessTemporaryGrantStepBuilders';

export function parseTriggerResidualTargetedPtAndCombatRestrictionsOne(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const anotherTargetTemporaryPtX = raw.match(
    /^another target creature gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (anotherTargetTemporaryPtX) {
    const powerToken = String(anotherTargetTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(anotherTargetTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('another target creature'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(anotherTargetTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const controlledTargetTemporaryPt = raw.match(
    /^target creature you control gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (controlledTargetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature you control'),
      power: Number.parseInt(String(controlledTargetTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(controlledTargetTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const upToOneTargetTemporaryPt = raw.match(
    /^up to one target creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (upToOneTargetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('up to one target creature'),
      power: Number.parseInt(String(upToOneTargetTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(upToOneTargetTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const multiTargetTemporaryPt = raw.match(
    /^(one or two target creatures|up to (?:one|two|three|four|five|\d+) target creatures|any number of target creatures(?: each)?) get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (multiTargetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(String(multiTargetTemporaryPt[1] || '').trim().toLowerCase()),
      power: Number.parseInt(String(multiTargetTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(multiTargetTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const exactCountMultiTargetTemporaryPt = raw.match(
    /^(one|two|three|four|five|\d+) target creatures get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (exactCountMultiTargetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(`${String(exactCountMultiTargetTemporaryPt[1] || '').trim().toLowerCase()} target creatures`),
      power: Number.parseInt(String(exactCountMultiTargetTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(exactCountMultiTargetTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetPlayerMassTemporaryPt = raw.match(
    /^creatures target player controls get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (targetPlayerMassTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures target player controls'),
      power: Number.parseInt(String(targetPlayerMassTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(targetPlayerMassTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetPlayerMassTemporaryPtX = raw.match(
    /^creatures target player controls get ([+-]?x)\s*\/\s*([+-]?x) until end of turn, where x is (.+?)\.?$/i,
  );
  if (targetPlayerMassTemporaryPtX) {
    const powerToken = String(targetPlayerMassTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(targetPlayerMassTemporaryPtX[2] || '').trim().toLowerCase();
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('creatures target player controls'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessToken.startsWith('-') ? -1 : 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(targetPlayerMassTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetTemporaryPtX = raw.match(
    /^target creature gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (targetTemporaryPtX) {
    const powerToken = String(targetTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(targetTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(targetTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const controlledTargetTemporaryPtX = raw.match(
    /^target creature you control gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (controlledTargetTemporaryPtX) {
    const powerToken = String(controlledTargetTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(controlledTargetTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(controlledTargetTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const opponentTargetTemporaryPtX = raw.match(
    /^target creature an opponent controls gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (opponentTargetTemporaryPtX) {
    const powerToken = String(opponentTargetTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(opponentTargetTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature an opponent controls'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(opponentTargetTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const opponentTargetTemporaryPt = raw.match(
    /^target creature an opponent controls gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (opponentTargetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature an opponent controls'),
      power: Number.parseInt(String(opponentTargetTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(opponentTargetTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetDontControlTemporaryPtX = raw.match(
    /^target creature you don(?:'|')t control gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (targetDontControlTemporaryPtX) {
    const powerToken = String(targetDontControlTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(targetDontControlTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector("target creature you don't control"),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(targetDontControlTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachAttackingControlledTemporaryPtX = raw.match(
    /^each attacking creature you control gets ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachAttackingControlledTemporaryPtX) {
    const powerToken = String(eachAttackingControlledTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(eachAttackingControlledTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each attacking creature you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(eachAttackingControlledTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const otherAttackingControlledTemporaryPtX = raw.match(
    /^other attacking creatures you control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (otherAttackingControlledTemporaryPtX) {
    const powerToken = String(otherAttackingControlledTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(otherAttackingControlledTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('other attacking creatures you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(otherAttackingControlledTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const attackingControlledTemporaryPtX = raw.match(
    /^attacking creatures you control get ([+-]?x)\s*\/\s*([+-]?(?:\d+|x)) until end of turn, where x is (.+?)\.?$/i,
  );
  if (attackingControlledTemporaryPtX) {
    const powerToken = String(attackingControlledTemporaryPtX[1] || '').trim().toLowerCase();
    const toughnessToken = String(attackingControlledTemporaryPtX[2] || '').trim().toLowerCase();
    const toughnessUsesX = toughnessToken === 'x' || toughnessToken === '+x' || toughnessToken === '-x';
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('attacking creatures you control'),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessUsesX ? (toughnessToken.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessToken, 10) || 0,
      powerUsesX: true,
      toughnessUsesX,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(attackingControlledTemporaryPtX[3] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOtherBasePtTeamTemporaryPtX = raw.match(
    /^each other creature you control with base power and toughness (\d+)\/(\d+) gets ([+-]?x)\s*\/\s*([+-]?x) until end of turn, where x is (.+?)\.?$/i,
  );
  if (eachOtherBasePtTeamTemporaryPtX) {
    const powerToken = String(eachOtherBasePtTeamTemporaryPtX[3] || '').trim().toLowerCase();
    const toughnessToken = String(eachOtherBasePtTeamTemporaryPtX[4] || '').trim().toLowerCase();
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(
        `each other creature you control with base power and toughness ${String(eachOtherBasePtTeamTemporaryPtX[1] || '').trim()}/${String(eachOtherBasePtTeamTemporaryPtX[2] || '').trim()}`,
      ),
      power: powerToken.startsWith('-') ? -1 : 1,
      toughness: toughnessToken.startsWith('-') ? -1 : 1,
      powerUsesX: true,
      toughnessUsesX: true,
      duration: 'end_of_turn',
      condition: { kind: 'where', raw: `x is ${String(eachOtherBasePtTeamTemporaryPtX[5] || '').trim()}` },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachOtherAttackingTemporaryPt = raw.match(
    /^each other attacking creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (eachOtherAttackingTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('each other attacking creature'),
      power: Number.parseInt(String(eachOtherAttackingTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(eachOtherAttackingTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const selfTemporaryPt = raw.match(
    /^(?:it|this creature|he|she|~|this) gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
  );
  if (selfTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('this creature'),
      power: Number.parseInt(String(selfTemporaryPt[1] || '0'), 10),
      toughness: Number.parseInt(String(selfTemporaryPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const selfForEachBlockingTemporaryPt = raw.match(
    /^(?:it|this creature|he|she|~|this) gets ([+-]\d+)\/([+-]\d+) until end of turn for each creature blocking it\.?$/i,
  );
  if (selfForEachBlockingTemporaryPt) {
    return [buildForEachTemporaryPtStep(
      'this creature',
      Number.parseInt(String(selfForEachBlockingTemporaryPt[1] || '0'), 10),
      Number.parseInt(String(selfForEachBlockingTemporaryPt[2] || '0'), 10),
      'creature blocking it',
      raw,
      sequence,
    )];
  }

  const doubleTargetPower = raw.match(
    /^double (?:up to one )?target creature(?: you control)?'s power until end of turn\.?$/i,
  );
  if (doubleTargetPower) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature'),
      power: 0,
      toughness: 0,
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const doubleTargetPowerToughness = raw.match(
    /^double (?:up to one )?target creature(?: you control)?'s power and toughness until end of turn\.?$/i,
  );
  if (doubleTargetPowerToughness) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature'),
      power: 0,
      toughness: 0,
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetCantBlockThisTurn = raw.match(
    /^(?:up to one )?target creature can't block this turn\.?$/i,
  );
  if (targetCantBlockThisTurn) {
    return [{
      kind: 'cant_block',
      target: parseObjectSelector('target creature'),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const countersRemainMatch = raw.match(
    /^counters remain on (this permanent|me) as it moves to any zone other than a player's hand or library$/i
  );
  if (countersRemainMatch) {
    const target = /^me$/i.test(String(countersRemainMatch[1] || '')) ? 'this card' : 'this permanent';
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(target),
      effectText: [raw],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const equipPayMatch = raw.match(/^equip-pay (.+)$/i);
  if (equipPayMatch) {
    return [createSemanticStaticGrantStep('this equipment', raw, raw, sequence)];
  }

  const equipSacrificeMatch = raw.match(/^equip-sacrifice (.+)$/i);
  if (equipSacrificeMatch) {
    return [createSemanticStaticGrantStep('this equipment', raw, raw, sequence)];
  }

  const flipNCoinsMatch = raw.match(/^flip (two|three|four|five|\d+) coins$/i);
  if (flipNCoinsMatch) {
    return [{
      kind: 'flip_coin',
      who: { kind: 'you' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^any player may (?:exile (?:a card|three cards) from their graveyard|discard three cards|pay half their life, rounded up|pay \d+ life|sacrifice two creatures of their choice|activate this ability but only during (?:their turn before the end step|any upkeep step)|activate this ability but only as a sorcery)$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('any player'),
      effectText: [raw],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^any opponent may (?:tap an untapped creature they control|have you put that card into your graveyard)$/i.test(raw)) {
    return [createSemanticStaticGrantStep('any opponent', raw, raw, sequence)];
  }

  if (/^any other player may pay that spell's mana cost$/i.test(raw)) {
    return [createSemanticStaticGrantStep('any other player', raw, raw, sequence)];
  }

  if (/^all suspected creatures are no longer suspected$/i.test(raw)) {
    return [createSemanticStaticGrantStep('all suspected creatures', raw, raw, sequence)];
  }

  if (/^an opponent chooses one of the exiled cards$/i.test(raw)) {
    return [createSemanticStaticGrantStep('an opponent', raw, raw, sequence)];
  }

  if (/^counter that spell or ability unless that player pays \d+ life$/i.test(raw)) {
    return [createSemanticStaticGrantStep('that spell or ability', raw, raw, sequence)];
  }

  const compoundKeywordBleed = raw.match(/^flying annihilator (\d+) evoke ((?:\{[^}]+\})+)$/i);
  if (compoundKeywordBleed) {
    const annihilatorCount = Number.parseInt(String(compoundKeywordBleed[1] || '0'), 10);
    const evokeCost = String(compoundKeywordBleed[2] || '').trim();
    return [
      createStructuredKeywordActionGrantStep(['flying'], 'flying', sequence, 'this permanent'),
      createAnnihilatorGrantStep(annihilatorCount, sequence, `annihilator ${annihilatorCount}`),
      createStructuredKeywordActionGrantStep([`evoke ${evokeCost}`], raw, sequence, 'this permanent'),
    ];
  }

  if (/^all lands lose all abilities except mana abilities$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('all lands'),
      effectText: ['lose all abilities except mana abilities'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const depthshakerMatch = raw.match(
    /^any number of target noncreature artifacts you control become 3\/3 artifact creatures(?: until end of turn)?\.?$/i
  );
  if (depthshakerMatch) {
    const untilEndOfTurn = /until end of turn/i.test(raw);
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector('any number of target noncreature artifacts you control'),
      addTypes: ['creature'],
      power: 3,
      toughness: 3,
      duration: untilEndOfTurn ? 'end_of_turn' : 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^sacrifice them at the beginning of (?:the )?next end step\.?$/i.test(raw)) {
    return [{
      kind: 'schedule_delayed_trigger',
      timing: 'next_end_step',
      effect: 'sacrifice them',
      steps: [{
        kind: 'sacrifice',
        what: parseObjectSelector('them'),
        raw: 'sacrifice them',
      } as unknown as OracleEffectStep],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^flying, lifelink each other nontoken creature you control has persist$/i.test(raw)) {
    return [
      createStructuredKeywordActionGrantStep(['flying', 'lifelink'], 'flying, lifelink', sequence, 'this permanent'),
      createStructuredKeywordActionGrantStep(['persist'], 'persist', sequence, 'each other nontoken creature you control'),
    ];
  }

  if (/^counter all abilities your opponents control$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('abilities your opponents control'),
      effectText: ['counter all abilities your opponents control'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^copy it if you control an artifact$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this spell'),
      effectText: [raw],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^count the number of permanents(?: you control)?$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [raw],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^count the number of \+1\/\+1 counters on creatures you control$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [raw],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^copy the enchanted instant card$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('the enchanted instant card'),
      effectText: [raw],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^an opponent guesses whether the top card of your library is the chosen kind$/i.test(raw)) {
    return [createSemanticStaticGrantStep('an opponent', raw, raw, sequence)];
  }

  if (/^you may choose new targets for the copies?\.?$/i.test(raw)) {
    return [];
  }

  if (/^if this spell was cast from a graveyard, copy that spell twice instead\.?$/i.test(raw)) {
    return [];
  }

  if (/^this ability triggers only once each turn\.?$/i.test(raw)) {
    return [];
  }

  if (/^you get an experience counter$/i.test(raw)) {
    return [{
      kind: 'add_player_counter',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      counter: 'experience',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const blightMayMatch = raw.match(/^you may blight (\d+)\.?$/i);
  if (blightMayMatch) {
    const count = Math.max(1, parseInt(String(blightMayMatch[1] || '1'), 10) || 1);
    return [{
      kind: 'add_counter',
      amount: { kind: 'number', value: count },
      counter: '-1/-1',
      target: parseObjectSelector('a creature you control'),
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const blightWhenDoMatch = raw.match(
    /^you may blight (\d+)\.\s*when you do,\s*(target creature gains haste until end of turn)\.?$/i
  );
  if (blightWhenDoMatch) {
    const count = Math.max(1, parseInt(String(blightWhenDoMatch[1] || '1'), 10) || 1);
    return [
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: count },
        counter: '-1/-1',
        target: parseObjectSelector('a creature you control'),
        optional: true,
        raw: `you may blight ${count}`,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('target creature'),
        abilities: ['haste'],
        duration: 'end_of_turn',
        raw: String(blightWhenDoMatch[2] || '').trim(),
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const payWhenDoCantBlock = raw.match(
    /^you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*when you do,\s*(target creature can't block this turn)\.?$/i
  );
  if (payWhenDoCantBlock) {
    return [
      {
        kind: 'pay_mana',
        who: { kind: 'you' },
        mana: String(payWhenDoCantBlock[1] || '').trim(),
        optional: true,
        raw: `you may pay ${String(payWhenDoCantBlock[1] || '').trim()}`,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'cant_block',
        target: parseObjectSelector('target creature'),
        raw: String(payWhenDoCantBlock[2] || '').trim(),
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const flyingTransformMatch = raw.match(/^flying as this creature transforms into this permanent, (.+)$/i);
  if (flyingTransformMatch) {
    return [
      createStructuredKeywordActionGrantStep(['flying'], 'flying', sequence, 'this permanent'),
      createSemanticStaticGrantStep(
        'this permanent',
        `as this creature transforms into this permanent, ${String(flyingTransformMatch[1] || '').trim()}`,
        raw,
        sequence
      ),
    ];
  }

  if (/^flying this permanent's power and toughness are each equal to the number of creatures you control$/i.test(raw)) {
    return [
      createStructuredKeywordActionGrantStep(['flying'], 'flying', sequence, 'this permanent'),
      createSemanticStaticGrantStep(
        'this permanent',
        "this permanent's power and toughness are each equal to the number of creatures you control",
        raw,
        sequence
      ),
    ];
  }
  return null;
}

