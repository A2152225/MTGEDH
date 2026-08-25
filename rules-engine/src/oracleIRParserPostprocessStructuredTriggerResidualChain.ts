// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: the structured trigger-residual grant chain (now just the ordered dispatch over the
// TriggerResidual* guard modules) together with the standalone keyword fragment lowering that
// runs beside it.
//
// Public entry points:
//   parseStructuredTriggerResidualGrant
//   parseStandaloneKeywordFragmentUnknownStep
//   expandStandaloneStaticKeywordAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { tryParseChooseLeftOrRightLoyaltySteps } from './oracleIRParserLoyaltyDirectionChoice';
import { tryParseGenericUntilNextTurnResidualGrant } from './oracleIRParserPostprocessActivationCostReductionStatics';
import {
  STANDALONE_KEYWORD_STATICS,
  createAnnihilatorGrantStep,
  createSemanticStaticGrantStep,
  createStructuredKeywordActionGrantStep,
  extractWardKeywordAbilities,
  hasNonBandingKeywordOnlyStaticText,
  isKeywordOnlyStaticAbilityText,
} from './oracleIRParserPostprocessKeywordStaticGrantSteps';
import { hasCreateTokenStepInTree } from './oracleIRParserPostprocessTokenCreationMetadata';
import { parseTriggerResidualCompoundPtAndKeywordGrantsOne } from './oracleIRParserPostprocessTriggerResidualCompoundPtAndKeywordGrants';
import { parseTriggerResidualCopyAndGameStateFragmentsOne } from './oracleIRParserPostprocessTriggerResidualCopyAndGameStateFragments';
import { parseTriggerResidualMassTemporaryPtGrantsOne } from './oracleIRParserPostprocessTriggerResidualMassTemporaryPtGrants';
import { parseTriggerResidualScaledAndSubtypePtGrantsOne } from './oracleIRParserPostprocessTriggerResidualScaledAndSubtypePtGrants';
import { parseTriggerResidualTargetedPtAndCombatRestrictionsOne } from './oracleIRParserPostprocessTriggerResidualTargetedPtAndCombatRestrictions';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';
import { AbilityType } from './oracleTextParser';

function parseStructuredTriggerResidualGrant(
  raw: string,
  sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const chooseLeftOrRightLoyalty = tryParseChooseLeftOrRightLoyaltySteps(raw, sequence);
  if (chooseLeftOrRightLoyalty) return chooseLeftOrRightLoyalty;

  const genericUntilNextTurn = tryParseGenericUntilNextTurnResidualGrant(raw, sequence);
  if (genericUntilNextTurn) return genericUntilNextTurn;

  const hoistedTriggerResidualMassTemporaryPtGrantsOne = parseTriggerResidualMassTemporaryPtGrantsOne(raw, sequence);
  if (hoistedTriggerResidualMassTemporaryPtGrantsOne) return hoistedTriggerResidualMassTemporaryPtGrantsOne;

  const hoistedTriggerResidualScaledAndSubtypePtGrantsOne = parseTriggerResidualScaledAndSubtypePtGrantsOne(raw, sequence);
  if (hoistedTriggerResidualScaledAndSubtypePtGrantsOne) return hoistedTriggerResidualScaledAndSubtypePtGrantsOne;

  const hoistedTriggerResidualCompoundPtAndKeywordGrantsOne = parseTriggerResidualCompoundPtAndKeywordGrantsOne(raw, sequence);
  if (hoistedTriggerResidualCompoundPtAndKeywordGrantsOne) return hoistedTriggerResidualCompoundPtAndKeywordGrantsOne;

  const hoistedTriggerResidualTargetedPtAndCombatRestrictionsOne = parseTriggerResidualTargetedPtAndCombatRestrictionsOne(raw, sequence);
  if (hoistedTriggerResidualTargetedPtAndCombatRestrictionsOne) return hoistedTriggerResidualTargetedPtAndCombatRestrictionsOne;

  const flyingSuperNovaMatch = raw.match(/^flying super nova - as this creature transforms into this permanent, (.+)$/i);
  if (flyingSuperNovaMatch) {
    return [
      createStructuredKeywordActionGrantStep(['flying'], 'flying', sequence, 'this permanent'),
      createSemanticStaticGrantStep(
        'this permanent',
        `as this creature transforms into this permanent, ${String(flyingSuperNovaMatch[1] || '').trim()}`,
        raw,
        sequence
      ),
    ];
  }

  const semanticTriggerResiduals: ReadonlyArray<readonly [RegExp, string]> = [
    [/^copy that card and you may cast the copy$/i, 'that card'],
    [/^an opponent chooses a permanent you control other than this creature and exiles it$/i, 'an opponent'],
    [/^copy it, except the copy isn't legendary(?:\. you may choose new targets for the copy)?$/i, 'this spell'],
    [/^copy it if you control (?:a planeswalker, cleric, druid, shaman, warlock, or wizard|an artifact)$/i, 'this spell'],
    [/^copy it if you gained life this turn\. you may choose new targets for the copy$/i, 'this spell'],
    [/^copy it for each kind of counter among permanents you control\. you may choose new targets for the copies$/i, 'this spell'],
    [/^copy the next loyalty ability you activate this turn when you activate it\. you may choose new targets for the copy$/i, 'you'],
    [/^after that turn, that player takes an extra turn$/i, 'that player'],
    [/^bring it down!$/i, 'this permanent'],
    [/^copy it for each other instant and sorcery spell you've cast this turn\. you may choose new targets for the copies$/i, 'this spell'],
    [/^bats, birds, and\/or mice you control enter, scry 1$/i, 'bats, birds, and/or mice you control'],
    [/^counter that spell unless you sacrifice a creature$/i, 'that spell'],
    [/^as this permanent enters, you get an emblem with .+$/i, 'this permanent'],
    [/^counter that spell unless that player pays \{x\}, where x is the number of cards in all graveyards with the same name as the spell$/i, 'that spell'],
    [/^as this equipment becomes attached to a creature, choose an exiled creature card used to craft this equipment$/i, 'this equipment'],
    [/^an opponent chooses a nonland card exiled this way$/i, 'an opponent'],
    [/^as you cast spells from your hand this turn, they gain cascade$/i, 'spells you cast from your hand this turn'],
    [/^counter all spells with those names$/i, 'spells with those names'],
    [/^forest, or plains for mana, that player adds one mana of any type that land produced$/i, 'that player'],
    [/^go for the goal!$/i, 'this permanent'],
    [/^copy each exiled card you own with a kick counter on it$/i, 'each exiled card you own with a kick counter on it'],
    [/^give that permanent or player another counter of that kind$/i, 'that permanent or player'],
    [/^copy this spell for each creature sacrificed this way$/i, 'this spell'],
  ];
  for (const [pattern, target] of semanticTriggerResiduals) {
    if (pattern.test(raw)) {
      return [createSemanticStaticGrantStep(target, raw, raw, sequence)];
    }
  }

  const hoistedTriggerResidualCopyAndGameStateFragmentsOne = parseTriggerResidualCopyAndGameStateFragmentsOne(raw, sequence);
  if (hoistedTriggerResidualCopyAndGameStateFragmentsOne) return hoistedTriggerResidualCopyAndGameStateFragmentsOne;

  return null;
}

function parseStandaloneKeywordFragmentUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^�\s*/, '')
    .trim();
  const sequence = step.sequence ? { sequence: step.sequence } : {};
  const stripped = raw
    .replace(/\n+/g, ', ')
    .replace(/;/g, ',')
    .replace(/\s*\([^)]*$/g, '')
    .replace(/\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\.?\s*$/g, '')
    .replace(/[.)"]+$/g, '')
    .trim();
  if (
    !/\b(?:indestructible|annihilator\s+\d+|trample|haste|vigilance|lifelink|deathtouch|menace|reach|flying|first strike|double strike|hexproof|prowess|ward\s+\{|protection from|toxic\s+\d+|convoke|shadow|shroud|flash|defender|banding|riot|provoke|haunt|firebending\s+\d+)\b/i.test(
      stripped
    )
  ) {
    return null;
  }

  const steps: OracleEffectStep[] = [];
  let remaining = stripped;
  const supplementalEffectText: string[] = [];

  for (const match of stripped.matchAll(/\bannihilator\s+(\d+)\b/gi)) {
    const count = Number.parseInt(String(match[1] || '0'), 10);
    if (!Number.isFinite(count) || count <= 0) continue;
    steps.push(createAnnihilatorGrantStep(count, sequence, `annihilator ${count}`));
    remaining = remaining.replace(match[0], ' ').trim();
  }

  const staticAbilities: string[] = [];
  for (const keyword of STANDALONE_KEYWORD_STATICS) {
    const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(remaining)) {
      if (!staticAbilities.includes(keyword)) staticAbilities.push(keyword);
      remaining = remaining.replace(new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ').trim();
    }
  }

  const wardExtracted = extractWardKeywordAbilities(remaining);
  for (const wardAbility of wardExtracted.abilities) {
    if (!staticAbilities.includes(wardAbility)) staticAbilities.push(wardAbility);
  }
  remaining = wardExtracted.remaining;

  for (const match of remaining.matchAll(/\btoxic\s+(\d+)\b/gi)) {
    const ability = `toxic ${String(match[1] || '').trim()}`;
    if (!staticAbilities.includes(ability)) staticAbilities.push(ability);
    remaining = remaining.replace(match[0], ' ').trim();
  }

  for (const match of remaining.matchAll(/\bfirebending\s+(\d+)\b/gi)) {
    const ability = `firebending ${String(match[1] || '').trim()}`;
    if (!staticAbilities.includes(ability)) staticAbilities.push(ability);
    remaining = remaining.replace(match[0], ' ').trim();
  }

  for (const match of remaining.matchAll(/\bprotection from ([^,;]+)/gi)) {
    const line = `protection from ${String(match[1] || '').trim().toLowerCase()}`;
    if (!supplementalEffectText.includes(line)) supplementalEffectText.push(line);
    remaining = remaining.replace(match[0], ' ').trim();
  }

  if (staticAbilities.length > 0 || supplementalEffectText.length > 0) {
    steps.unshift({
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      ...(staticAbilities.length > 0 ? { abilities: staticAbilities } : {}),
      ...(supplementalEffectText.length > 0 ? { effectText: supplementalEffectText } : {}),
      duration: 'static',
      raw: [...staticAbilities, ...supplementalEffectText].join(', ') || stripped,
      ...sequence,
    } as unknown as OracleEffectStep);
  }

  let leftover = remaining;
  for (const keyword of STANDALONE_KEYWORD_STATICS) {
    leftover = leftover.replace(new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ');
  }
  leftover = leftover
    .replace(/\bannihilator\s+\d+\b/gi, ' ')
    .replace(/\bward\s+\{[^}]+\}/gi, ' ')
    .replace(/\btoxic\s+\d+\b/gi, ' ')
    .replace(/\bfirebending\s+\d+\b/gi, ' ')
    .replace(/\bprotection from [^,;]+/gi, ' ')
    .replace(/[.,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (steps.length === 0 || leftover) return null;
  return steps;
}

export function expandStandaloneStaticKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type !== AbilityType.STATIC) return ability;
    if (hasCreateTokenStepInTree(ability.steps)) return ability;
    const text = String(ability.text || ability.effectText || '').trim();
    if (!text || !isKeywordOnlyStaticAbilityText(text)) return ability;
    if (/\bbanding\b/i.test(text) && !hasNonBandingKeywordOnlyStaticText(text)) return ability;

    const isKeywordOnlySteps =
      ability.steps.length === 0 ||
      ability.steps.every((step) => step.kind === 'unknown');
    if (!isKeywordOnlySteps) return ability;

    const raw = normalizeOracleText(text).replace(/\n+/g, ', ').trim();
    const parsed = parseStandaloneKeywordFragmentUnknownStep({ kind: 'unknown', raw });
    if (!parsed || parsed.length === 0) return ability;

    return { ...ability, steps: parsed };
  });
}


export { parseStructuredTriggerResidualGrant, parseStandaloneKeywordFragmentUnknownStep };
