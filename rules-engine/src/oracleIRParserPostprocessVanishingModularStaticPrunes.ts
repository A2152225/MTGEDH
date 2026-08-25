// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: subjectless-draw repair plus reminder prunes for vanishing, modular, banding, externally handled statics, temporary land bonuses, trigger restrictions, phasing, and still-lands.
//
// Public entry points:
//   repairSubjectlessDrawAfterZoneShuffleAbilities
//   pruneRedundantVanishingReminderAbilities
//   pruneRedundantModularReminderAbilities
//   pruneRedundantBandingReminderUnknownAbilities
//   pruneExternallyHandledStaticUnknownAbilities
//   pruneExternallyHandledTemporaryLandBonusUnknownSteps
//   pruneRedundantTriggerRestrictionUnknownAbilities
//   pruneRedundantPhasingReminderUnknownAbilities
//   pruneRedundantStillLandUnknownAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeUnknownStepText } from './oracleIRParserPostprocessCopySpellTailHelpers';
import { normalizeReminderStepRaw } from './oracleIRParserPostprocessKeywordReminderPrunes';
import {
  hasNonBandingKeywordOnlyStaticText,
  isKeywordOnlyStaticAbilityText,
} from './oracleIRParserPostprocessKeywordStaticGrantSteps';
import { normalizeOracleText } from './oracleIRParserUtils';
import { parseKeywordsFromOracleText } from './oracleTextParserSupport';

export function repairSubjectlessDrawAfterZoneShuffleAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const steps = ability.steps.map((step, index) => {
      const previous = ability.steps[index - 1];
      if (
        step.kind === 'draw' &&
        (step.who as any)?.kind === 'you' &&
        /^(?:then\s+)?draws\b/i.test(String(step.raw || '').trim()) &&
        previous &&
        (
          (
            previous.kind === 'shuffle_zones_into_library' &&
            (previous.who as any)?.kind !== 'you'
          ) ||
          (
            previous.kind === 'discard' &&
            (previous.who as any)?.kind === 'each_player' &&
            (
              (
                (previous.amount as any)?.kind === 'number' &&
                Number((previous.amount as any)?.value) >= 9999
              ) ||
              /\b(?:their|your)\s+hand\b/i.test(String(previous.raw || ''))
            )
          )
        )
      ) {
        changed = true;
        return { ...step, who: previous.who } as unknown as OracleEffectStep;
      }
      return step;
    });
    return changed ? { ...ability, steps } : ability;
  });
}

function isRedundantVanishingReminderTriggeredAbility(ability: OracleIRAbility): boolean {
  if (ability.type !== 'triggered') return false;

  const normalizedEffectText = normalizeOracleText(String(ability.effectText || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!/^remove a time counter from it\. when the last is removed, sacrifice it[.)]*$/i.test(normalizedEffectText)) {
    return false;
  }

  const hasExpectedRemoveCounter = ability.steps.some(
    (step) =>
      step.kind === 'remove_counter' &&
      step.counter === 'time' &&
      step.target.kind === 'raw' &&
      /^it$/i.test(String(step.target.text || '').trim())
  );
  const hasExpectedReminderTail = ability.steps.some(
    (step) =>
      step.kind === 'unknown' &&
      /^when the last is removed, sacrifice it[.)]*$/i.test(
        normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim()
      )
  );

  return hasExpectedRemoveCounter && hasExpectedReminderTail;
}

export function pruneRedundantVanishingReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => !isRedundantVanishingReminderTriggeredAbility(ability));
}

function isRedundantModularReminderTriggeredAbility(ability: OracleIRAbility): boolean {
  if (ability.type !== 'triggered') return false;

  const normalizedEffectText = normalizeOracleText(String(ability.effectText || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!/^you may put its \+1\/\+1 counters on target artifact creature[.)]*$/i.test(normalizedEffectText)) {
    return false;
  }

  return ability.steps.length > 0 && ability.steps.every(
    (step) =>
      step.kind === 'unknown' &&
      /^you may put its \+1\/\+1 counters on target artifact creature[.)]*$/i.test(
        normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim()
      )
  );
}

export function pruneRedundantModularReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => !isRedundantModularReminderTriggeredAbility(ability));
}

function isRedundantBandingReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  return (
    /^banding \(any creatures with banding, and up to one without, can attack in a band$/i.test(normalized) ||
    /^any creatures with banding, and up to one without, can attack in a band$/i.test(normalized) ||
    /^bands are blocked as a group$/i.test(normalized) ||
    /^if any creatures with banding (?:you control|a player controls) are blocking or being blocked by a creature, (?:you|that player) divide that creature(?:'|’)s combat damage, not its controller, among any of the creatures it(?:'|’)s being blocked by or is blocking$/i.test(normalized) ||
    /^if any creatures with banding you control are blocking a creature, you divide that creature(?:'|’)s combat damage, not its controller, among any of the creatures it(?:'|’)s being blocked by$/i.test(normalized)
  );
}

export function pruneRedundantBandingReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedAbilityText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const referencesBanding = normalizedAbilityText.includes('banding');
    if (!referencesBanding) return [ability];

    const nextSteps = ability.steps.filter((step) => !isRedundantBandingReminderUnknownStep(step));
    if (nextSteps.length === ability.steps.length) {
      const abilityText = String(ability.text || ability.effectText || '').trim();
      if (
        nextSteps.length === 0 &&
        /\bbanding\b/i.test(abilityText) &&
        !hasNonBandingKeywordOnlyStaticText(abilityText)
      ) {
        return [];
      }
      return [ability];
    }

    const onlyKeywordStepsRemain = nextSteps.length > 0 && nextSteps.every((step) => {
      if (step.kind !== 'unknown') return false;
      const normalized = normalizeUnknownStepText(step);
      if (!normalized) return false;
      const parsedKeywords = parseKeywordsFromOracleText(normalized);
      return parsedKeywords.length === 1 && parsedKeywords[0] === normalized.toLowerCase();
    });

    if (nextSteps.length === 0 || onlyKeywordStepsRemain) {
      const abilityText = String(ability.text || ability.effectText || '').trim();
      if (
        isKeywordOnlyStaticAbilityText(abilityText) &&
        hasNonBandingKeywordOnlyStaticText(abilityText)
      ) {
        return [{ ...ability, steps: nextSteps }];
      }
      return [];
    }

    return [{ ...ability, steps: nextSteps }];
  });
}

export function pruneExternallyHandledStaticUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const EXTERNALLY_HANDLED_STANDALONE_KEYWORDS = new Set([
    'deathtouch',
    'defender',
    'double strike',
    'first strike',
    'flying',
    'haste',
    'hexproof',
    'indestructible',
    'lifelink',
    'menace',
    'reach',
    'shadow',
    'trample',
    'vigilance',
  ]);

  const isPureKeywordGrantList = (text: string): boolean => {
    const parts = String(text || '')
      .replace(/\s*\([^()]*\)\s*$/g, '')
      .toLowerCase()
      .split(/\s+and\s+|\s*,\s*/)
      .map(part => part.replace(/[.)\s]+$/g, '').trim())
      .filter(Boolean);

    return parts.length > 0 && parts.every((part) => {
      const parsedKeywords = parseKeywordsFromOracleText(part);
      return parsedKeywords.length === 1 && parsedKeywords[0] === part;
    });
  };

  const isStandaloneHandledKeywordList = (text: string): boolean => {
    const parts = String(text || '')
      .replace(/\s*\([^()]*\)\s*$/g, '')
      .toLowerCase()
      .split(/\s+and\s+|\s*,\s*/)
      .map(part => part.replace(/[.)\s]+$/g, '').trim())
      .filter(Boolean);

    return parts.length > 0 && parts.every((part) => {
      if (/^protection from .+$/i.test(part)) {
        return true;
      }

      const parsedKeywords = parseKeywordsFromOracleText(part);
      return (
        parsedKeywords.length === 1 &&
        parsedKeywords[0] === part &&
        EXTERNALLY_HANDLED_STANDALONE_KEYWORDS.has(parsedKeywords[0])
      );
    });
  };

  return abilities.flatMap((ability) => {
    const originalText = String(ability.text || ability.effectText || '').trim();
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const hasStructuredKeywordGrant = ability.steps.some(
      (step) =>
        step.kind === 'grant_static_ability' &&
        Array.isArray((step as unknown as { abilities?: string[] }).abilities) &&
        ((step as unknown as { abilities?: string[] }).abilities?.length || 0) > 0
    );
    if (hasStructuredKeywordGrant) {
      return [ability];
    }
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown');

    if (
      /^devour\s+\d+(?:\s+[^()]+)?\s*\(as this (?:creature|permanent) enters, you may sacrifice any number of creatures\.?[^)]*\)[.)]*$/i.test(normalizedText) ||
      /^as this land enters, you may reveal (?:a|an) .+? card from your hand\. if you don't, (?:this land|it) enters tapped[.)]*$/i.test(normalizedText) ||
      /^as this land enters, you may pay \d+ life\. if you don't, (?:this land|it) enters tapped[.)]*$/i.test(normalizedText) ||
      /^you have no maximum hand size(?: for the rest of the game)?[.)]*$/i.test(normalizedText) ||
      /^this spell can(?:not|'t) be countered(?:\. \(this includes by the ward ability\.\))?[.)]*$/i.test(normalizedText) ||
      /^put the revealed cards on the bottom of your library in any order$/i.test(normalizedText) ||
      /^crew\s+\d+\s*\(tap any number of creatures you control with total power \d+ or more:\s*this vehicle becomes an artifact creature until end of turn\. creatures can't be attached to other permanents\.\)$/i.test(normalizedText)
    ) {
      return [];
    }

    const isGrantStaticOnlyAbility =
      ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'grant_static_ability');

    if (isGrantStaticOnlyAbility && isStandaloneHandledKeywordList(normalizedText)) {
      return [];
    }

    if (!isUnknownOnlyAbility) {
      return [ability];
    }

    if (/^(?:enchanted|equipped) creature has protection from .+$/i.test(normalizedText)) {
      return [ability];
    }

    if (/^[a-z]/.test(originalText) && /^flanking\b/i.test(normalizedText)) {
      return [ability];
    }

    if (isStandaloneHandledKeywordList(normalizedText)) {
      return [];
    }

    if (
      /^draft this card face up[.)]*$/i.test(normalizedText) ||
      /^a deck can have any number of cards named (?:this permanent|this card)[.)]*$/i.test(normalizedText) ||
      /^remove this card from your deck before playing if you're not playing for ante[.)]*$/i.test(normalizedText) ||
      /^ready to run(?:\s*\([^)]*\))?[.)]*$/i.test(normalizedText) ||
      /^banding(?:\b|\s*\().*$/i.test(normalizedText) ||
      /^devour\s+\d+(?:\s+[^()]+)?\s*\(as this (?:creature|permanent) enters, you may sacrifice any number of creatures\.?[^)]*\)[.)]*$/i.test(normalizedText) ||
      /^entwine \{[^}]+\} \(choose both if you pay the entwine cost\.?\)[.)]*$/i.test(normalizedText) ||
      /^sunburst \(this (?:creature|permanent|artifact) enters with (?:a \+1\/\+1 counter|that many charge counters?|a charge counter) on it for each color of mana spent to cast it\.?\)[.)]*$/i.test(normalizedText) ||
      /^if it's neither day nor night, it becomes day as this (?:creature|permanent) enters[.)]*$/i.test(normalizedText) ||
      /^you may reveal this card from your opening hand(?:[.)]*\s*if you do, at the beginning of the first upkeep, .+)?$/i.test(normalizedText) ||
      /^if you do, at the beginning of the first upkeep,\s+create\b.+$/i.test(normalizedText) ||
      /^play with the top card of your library revealed[.)]*$/i.test(normalizedText) ||
      /^creatures you control get [+-]\d+\/[+-]\d+[.)]*$/i.test(normalizedText) ||
      /^other creatures you control get [+-]\d+\/[+-]\d+[.)]*$/i.test(normalizedText) ||
      /^(?:equipped|enchanted) creature gets [+-]\d+\/[+-]\d+[.)]*$/i.test(normalizedText) ||
      /^you control enchanted (?:creature|permanent)[.)]*$/i.test(normalizedText) ||
      /^creatures you control have haste[.)]*$/i.test(normalizedText) ||
      /^(?:instant and sorcery|instant or sorcery) spells you cast cost \{\d+\} less to cast[.)]*$/i.test(normalizedText) ||
      /^all creatures able to block (?:this creature|this permanent|~) do so[.)]*$/i.test(normalizedText) ||
      /^as this land enters, you may reveal (?:a|an) .+? card from your hand\. if you don't, (?:this land|it) enters tapped[.)]*$/i.test(normalizedText) ||
      /^as this land enters, you may pay \d+ life\. if you don't, (?:this land|it) enters tapped[.)]*$/i.test(normalizedText) ||
      /^you have hexproof(?:\.?\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
      /^players can't gain life[.)]*$/i.test(normalizedText) ||
      /^players can't gain life this turn[.)]*$/i.test(normalizedText) ||
      /^each creature you control with a \+1\/\+1 counter on it has trample[.)]*$/i.test(normalizedText) ||
      /^creatures with power less than (?:this creature|~|[a-z0-9', -]+)'?s power can(?:'|’)?t block (?:it|this creature|~)[.)]*$/i.test(normalizedText) ||
      /^(?:this (?:creature|permanent)'?s|~'?s) power and toughness are each equal to (?:the )?number of lands you control[.)]*$/i.test(normalizedText) ||
      /^(?:this (?:creature|permanent)'?s|~'?s) power and toughness are each equal to (?:the )?number of cards in your hand[.)]*$/i.test(normalizedText) ||
      /^(?:this (?:creature|permanent)'?s|~'?s) power and toughness are each equal to (?:the )?number of creatures you control[.)]*$/i.test(normalizedText) ||
      /^(?:this (?:creature|permanent)'?s|~'?s) power is equal to (?:the )?number of creatures you control[.)]*$/i.test(normalizedText) ||
      /^(?:enchanted creature|this creature|this permanent) does(?:n't| not) untap during (?:its controller(?:'|’)s|your) untap step[.)]*$/i.test(normalizedText) ||
      /^(?:this creature|~|[a-z0-9', -]+) can block an additional(?: (?:\d+|[a-z]+(?:[ -][a-z]+)*))? creature(?:s)? each combat[.)]*$/i.test(normalizedText) ||
      /^this creature can block only creatures with flying[.)]*$/i.test(normalizedText) ||
      /^if this card is in your opening hand, you may begin the game with it on the battlefield[.)]*$/i.test(normalizedText) ||
      /^you have no maximum hand size(?: for the rest of the game)?[.)]*$/i.test(normalizedText) ||
      /^you may play an additional land on each of your turns[.)]*$/i.test(normalizedText)
    ) {
      return [];
    }

    const keywordGrantMatch = normalizedText.match(/^(?:equipped|enchanted) creature (?:has|gains?) (.+?)[.)]*$/i);
    if (keywordGrantMatch && isPureKeywordGrantList(String(keywordGrantMatch[1] || '').trim())) {
      return [];
    }

    const compoundKeywordGrantMatch = normalizedText.match(
      /^(?:equipped|enchanted) creature gets [+-]\d+\/[+-]\d+ and (?:has|gains?) (.+?)[.)]*$/i
    );
    if (
      compoundKeywordGrantMatch &&
      isPureKeywordGrantList(String(compoundKeywordGrantMatch[1] || '').trim())
    ) {
      return [];
    }

    return [ability];
  });
}

function isExternallyHandledTemporaryLandBonusUnknownStep(step: OracleEffectStep | undefined): boolean {
  if (step?.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.)\s]+$/g, '')
    .trim();
  return /^you may play (?:(?:up to )?(?:a|an|one|two|three|four|five|\d+)) additional lands? this turn$/i.test(normalized);
}

export function pruneExternallyHandledTemporaryLandBonusUnknownSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const nextSteps = ability.steps.filter((step) => !isExternallyHandledTemporaryLandBonusUnknownStep(step));
    if (nextSteps.length === ability.steps.length) return [ability];
    if (nextSteps.length === 0) return [];
    return [{ ...ability, steps: nextSteps }];
  });
}

function isRedundantTriggerRestrictionUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    /^this ability triggers only once each turn[.)]*$/i.test(normalized) ||
    /^do this only once each turn[.)]*$/i.test(normalized)
  );
}

export function pruneRedundantTriggerRestrictionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantTriggerRestrictionUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantPhasingReminderUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeReminderStepRaw(step)
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    /^while (?:it(?:'|’)?s|they(?:'|’)?re) phased out, (?:it(?:'|’)?s|they(?:'|’)?re) treated as though (?:it|they) (?:(?:does|do)n(?:'|’)?t|do(?:es)? not) exist[.)]*$/i.test(normalized) ||
    /^each one phases in before its controller untaps during their next untap step[.)]*$/i.test(normalized)
  );
}

export function pruneRedundantPhasingReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter((step) => !isRedundantPhasingReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantStillLandUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^it(?:'|’)s still a land[.)]*$/i.test(normalized);
}

export function pruneRedundantStillLandUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantStillLandUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

