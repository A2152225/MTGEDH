// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: reminder/platform-only text predicates and the current-batch reminder unknown-ability prune that consumes them.
//
// Public entry points:
//   isExternallyHandledOracleFragmentText
//   createExternallyHandledOracleFragmentGrantStep
//   pruneCurrentBatchReminderUnknownAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import {
  isCurrentBatchReminderKeywordPattern,
} from './oracleIRParserPostprocessCurrentBatchReminderKeywordPatterns';
import {
  isCurrentBatchReminderRulesClarification,
} from './oracleIRParserPostprocessCurrentBatchReminderRulesClarifications';
import {
  isCurrentBatchReminderTargetOrDeckPattern,
} from './oracleIRParserPostprocessCurrentBatchReminderTargetAndDeckPatterns';
import { CONVOKE_DELVE_INNER_REMINDER_PATTERN } from './oracleIRParserPostprocessKeywordReminderPrunes';
import { parseStructuredKeywordActionGrant } from './oracleIRParserPostprocessKeywordStaticGrantSteps';
import { parseMyriadTokenCreationMetadataStep } from './oracleIRParserPostprocessTokenCreationMetadata';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';
import { isStandardOracleFragmentOnly } from './oracleReminderText';

function isCurrentBatchReminderOrPlatformOnlyText(raw: string): boolean {
  const rawNormalizedText = normalizeOracleText(String(raw || ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (rawNormalizedText === '(' || rawNormalizedText === ')' || rawNormalizedText === '()') return true;
  if (isStandardOracleFragmentOnly(rawNormalizedText)) return true;
  if (/^\.{3,}$/.test(rawNormalizedText) || rawNormalizedText === '\u2026') return true;
  if (/^[a-z0-9][a-z0-9\s'.,/&-]{0,80}\.{2,}\)?$/i.test(rawNormalizedText)) return true;
  const isParentheticalText = /^\(/.test(rawNormalizedText) || /\)$/.test(rawNormalizedText);
  const normalizedText = rawNormalizedText
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) return false;
  const normalizedModalHeader = normalizedText.replace(/\s*-\s*$/g, '').trim();

  return (
    isCurrentBatchReminderKeywordPattern(normalizedText, normalizedModalHeader, isParentheticalText) ||
    isCurrentBatchReminderRulesClarification(normalizedText, isParentheticalText) ||
    isCurrentBatchReminderTargetOrDeckPattern(normalizedText) ||
    /^[\w, ']+ gets [+-]x\/[+-]x until end of turn\b/i.test(normalizedText)
  );
}

function isOrphanReminderOnlyAbilityText(raw: string): boolean {
  const rawNormalized = normalizeOracleText(String(raw || ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (/^you may cast it without paying its mana cost\.?\)$/i.test(rawNormalized)) {
    return true;
  }
  const normalizedText = rawNormalized
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return (
    CONVOKE_DELVE_INNER_REMINDER_PATTERN.test(normalizedText) ||
    /^\(look at the top card of your library\.?$/i.test(normalizedText) ||
    /^put the rest of the cards on the bottom of your library in a random order\.?$/i.test(normalizedText) ||
    /^put the rest on the bottom of your library in a random order\.?$/i.test(normalizedText) ||
    /^put the revealed cards on the bottom of your library in any order\.?$/i.test(normalizedText) ||
    /^if you control a commander, you may cast this spell without paying its mana cost\.?$/i.test(normalizedText) ||
    /^cast it as a sorcery on a later turn without paying its mana cost\.?$/i.test(normalizedText) ||
    /^protection from black and from red\.?$/i.test(normalizedText) ||
    /^this ability triggers only once each turn\.?$/i.test(normalizedText) ||
    /^it(?:'|')s still a land\.?$/i.test(normalizedText) ||
    /^when you do, cast it for its madness cost or put it into your graveyard\.?$/i.test(normalizedText) ||
    /^cast it for its madness cost or put it into your graveyard\.?$/i.test(normalizedText) ||
    /^it(?:'|')s an artifact with "\{2\}, sacrifice this token: draw a card\.?$/i.test(normalizedText) ||
    /^this vehicle becomes an artifact creature until end of turn\.?$/i.test(normalizedText) ||
    /^then put any number of them on the bottom and the rest on top in any order\.?$/i.test(normalizedText) ||
    /^then shuffle\.?$/i.test(normalizedText) ||
    /^then give each another counter of each kind already there\.?$/i.test(normalizedText) ||
    /^you may choose new targets for the copies?\.?$/i.test(normalizedText) ||
    /^that much\.?$/i.test(normalizedText) ||
    /^otherwise,?\s*(?:you may )?put it into your (?:hand|graveyard)\.?$/i.test(normalizedText) ||
    /^if you cast a (?:card|spell) this way, you still pay its costs\.?$/i.test(normalizedText) ||
    /^spend this mana only to cast spells?\.?$/i.test(normalizedText) ||
    /^to mill a card, put the top card of your library into your graveyard\.?$/i.test(normalizedText) ||
    /^damage causes loss of life\.?$/i.test(normalizedText) ||
    /^you may cast this card from your graveyard for its (?:flashback|escape|retrace|jump-start|harmonize) cost(?: this turn)?(?:\. then exile it)?\.?$/i.test(normalizedText) ||
    /^then exile it\.?$/i.test(normalizedText) ||
    /^partner with \[name\]\.?$/i.test(normalizedText) ||
    /^\d+\s+points?\s+each\s*[→>-]\s*\+1\/\+1$/i.test(normalizedText)
  );
}

function isReminderGrantStaticAbilityStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_static_ability') return false;
  const targetText = String((step.target as { text?: string } | undefined)?.text || '').trim();
  return /^reminder text$/i.test(targetText);
}

function isPlatformReminderOnlyExecutableStep(step: OracleEffectStep): boolean {
  // An attached grant that resolved to named keywords ("Equipped creature has flying and ward {4}")
  // carries real structure, so it is kept even though the blanket "equipped creature has ..." entry in
  // the reminder-text prune list matches its wording.
  if (
    step.kind === 'grant_static_ability' &&
    step.duration === 'while_attached' &&
    (step.abilities?.length || 0) > 0
  ) {
    return false;
  }
  // A grant that lowered its quoted ability into nested steps ("Commander creatures you own have
  // \"Whenever this creature attacks a player, ... create two Treasure tokens.\"") carries real
  // structure that the reminder-text prune list would otherwise discard.
  if (
    step.kind === 'grant_static_ability' &&
    (step.steps || []).some((nested) => nested.kind !== 'unknown')
  ) {
    return false;
  }
  if (
    step.kind === 'move_zone'
    && /^then exile it\.?$/i.test(String((step as { raw?: string }).raw || '').replace(/^[()\s]+/, '').replace(/[.)\s]+$/g, '').trim())
  ) {
    return true;
  }
  return (
    step.kind === 'grant_static_ability' ||
    step.kind === 'grant_exile_permission' ||
    step.kind === 'grant_graveyard_permission' ||
    step.kind === 'modify_graveyard_permissions' ||
    step.kind === 'conditional' ||
    step.kind === 'draw' ||
    step.kind === 'unknown'
  );
}

function isStrictReminderOrPlatformOnlyTextForPruning(raw: string): boolean {
  if (!isCurrentBatchReminderOrPlatformOnlyText(raw)) return false;
  const normalizedText = normalizeOracleText(String(raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalizedText) return false;
  if (
    /^you may cast this card from your graveyard for its (?:flashback|escape|retrace|jump-start|harmonize) cost(?: this turn)?(?:\. then exile it)?\.?$/i.test(normalizedText)
    || /^if you discard a card with madness, discard it into exile\.?$/i.test(normalizedText)
    || /^then exile it\.?$/i.test(normalizedText)
  ) {
    return true;
  }
  if (
    /^(?:put|draw|return|exile|destroy|shuffle|look|reveal|search|create|mill|discard|counter|fight|regenerate|sacrifice|tap|untap)\b/.test(
      normalizedText
    )
  ) {
    return false;
  }
  if (/^target (?:player|creature|opponent|permanent|spell|land|artifact|enchantment|planeswalker)\b/.test(normalizedText)) {
    return false;
  }
  if (/^each (?:player|opponent|creature|permanent)\b/.test(normalizedText)) {
    return false;
  }
  if (/^until (?:end of turn|your next turn)\b/.test(normalizedText) && /\b(?:gets?|gain|becomes?|draw|deal|return|exile|destroy)\b/.test(normalizedText)) {
    return false;
  }
  if (/^you (?:draw|gain|lose|may draw|may put|may cast|may exile|may return)\b/.test(normalizedText)) {
    return false;
  }
  if (/^an opponent (?:separates|chooses)\b/.test(normalizedText)) {
    return false;
  }
  return true;
}

export function isExternallyHandledOracleFragmentText(raw: string): boolean {
  return isCurrentBatchReminderOrPlatformOnlyText(raw);
}

export function createExternallyHandledOracleFragmentGrantStep(raw: string): OracleEffectStep {
  const normalized = normalizeOracleText(String(raw || ''))
    .replace(/\s+/g, ' ')
    .trim();
  const keywordGrant = parseStructuredKeywordActionGrant(normalized, {});
  if (keywordGrant && keywordGrant.length > 0) return keywordGrant[0];
  return {
    kind: 'grant_static_ability',
    target: parseObjectSelector('this permanent'),
    effectText: [normalized],
    duration: 'static',
    raw: normalized,
  } as unknown as OracleEffectStep;
}

function isClueArtifactReminderTailText(raw: string): boolean {
  const normalizedText = normalizeOracleText(String(raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) return false;

  return /^it(?:'|’)?s an artifact with "?\{2\}, sacrifice this (?:artifact|token): draw a card"?$/i.test(normalizedText);
}

function isRoleTokenReminderText(raw: string): boolean {
  const normalizedText = normalizeOracleText(String(raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) return false;

  return (
    /^if you control another role on it, put that one into the graveyard$/i.test(normalizedText) ||
    /^enchanted creature gets [+-]\d+\/[+-]\d+(?: and has [a-z, ]+)?$/i.test(normalizedText) ||
    /^when this token is put into a graveyard, each opponent loses \d+ life$/i.test(normalizedText)
  );
}

function isStaticMyriadReminderText(raw: string): boolean {
  const normalizedText = normalizeOracleText(String(raw || ''))
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) return false;

  return /^(?:[a-z]+(?:,|\s)+)*myriad\s*\(whenever this creature attacks, for each opponent other than defending player, you may create a token cop(?:y|ies) that(?:'|’)?s tapped and attacking that player or a planeswalker they control(?:\.\s*exile the tokens at end of combat)?$/i.test(normalizedText);
}

export function pruneCurrentBatchReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown');
    const normalizedAbilityText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const mentionsRoleToken = /\brole token\b/i.test(normalizedAbilityText);

    if (
      /^you may cast this card from your graveyard for its (?:flashback|escape|retrace|jump-start|harmonize) cost(?: this turn)?(?:\. then exile it)?\.?$/i.test(normalizedAbilityText)
      || /^\(you may cast this card from your graveyard for its flashback cost\. then exile it\.?\)$/i.test(normalizedAbilityText)
      || /^if you discard a card with madness, discard it into exile\.?$/i.test(normalizedAbilityText)
      || /^then exile it\.?$/i.test(normalizedAbilityText)
      || /^\d+\s+points?\s+each\s*[→>-]\s*\+1\/\+1$/i.test(normalizedAbilityText)
    ) {
      return [];
    }

    if (isUnknownOnlyAbility && /^flash(?:\s*\([^)]*\))?$/i.test(normalizedAbilityText)) {
      return [{ ...ability, steps: [] }];
    }

    if (
      /^you may reveal this card from your opening hand(?:[.)]*\s*if you do, at the beginning of the first upkeep, .+)?$/i.test(normalizedAbilityText) ||
      /^if you do, at the beginning of the first upkeep,\s+create\b.+$/i.test(normalizedAbilityText)
    ) {
      return [];
    }

    if (/^conspire\s*\(as you cast this spell, you may tap two untapped creatures you control that share a color with it\./i.test(normalizedAbilityText)) {
      return [];
    }

    if (
      ability.steps.length === 1 &&
      ability.steps[0]?.kind === 'choose_mode' &&
      (!Array.isArray((ability.steps[0] as unknown as { modes?: unknown[] }).modes) ||
        ((ability.steps[0] as unknown as { modes?: unknown[] }).modes?.length || 0) === 0)
    ) {
      return [];
    }

    if (isOrphanReminderOnlyAbilityText(normalizedAbilityText)) {
      return [];
    }

    // Text that grants a quoted ability outside a reminder parenthetical is a real grant, not platform
    // boilerplate: "Commander creatures you own have \"Whenever this creature attacks a player, ...\"".
    // Reminder text that quotes an ability is always parenthesised, so it still prunes.
    const quotedGrantStep = ability.steps.length === 1 && ability.steps[0]?.kind === 'grant_static_ability'
      ? ability.steps[0]
      : null;
    const grantsQuotedAbility =
      quotedGrantStep !== null &&
      !normalizedAbilityText.startsWith('(') &&
      /^[^"]+\s(?:have|has|gains?)\s+"/i.test(normalizedAbilityText) &&
      // A selector that swallowed the P/T clause ("Equipped creature gets +1/+1 and has") means the
      // grant misparsed, so it stays prunable rather than shadowing the better shape downstream.
      !/\bgets?\s+[+-]/i.test(String((quotedGrantStep.target as { text?: string } | undefined)?.text || ''));

    if (
      !grantsQuotedAbility &&
      isCurrentBatchReminderOrPlatformOnlyText(normalizedAbilityText) &&
      ability.steps.length > 0 &&
      ability.steps.every(isPlatformReminderOnlyExecutableStep)
    ) {
      return [];
    }

    if (
      ability.steps.length === 1 &&
      ability.steps[0]?.kind === 'look_top' &&
      /^\(look at the top card of your library\.?$/i.test(normalizedAbilityText.toLowerCase())
    ) {
      return [];
    }

    if (/^this\s+vehicle\s+becomes\s+an\s+artifact\s+creature[.)]*$/i.test(normalizedAbilityText)) {
      return [];
    }

    if (
      /^it has "?sacrifice this token:\s*add \{c\}\."?\s*\(\{c\} represents colorless mana\.\)?[.)]*$/i.test(normalizedAbilityText) ||
      /^it(?:'|’)?s an artifact with "?\{2\}, \{t\}, sacrifice this token: you gain 3 life\."?\)?[.)]*$/i.test(normalizedAbilityText)
    ) {
      return [];
    }

    if (/^put\s+the\s+revealed\s+cards\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+any\s+order[.)]*$/i.test(normalizedAbilityText)) {
      return [];
    }

    if (isUnknownOnlyAbility && isStrictReminderOrPlatformOnlyTextForPruning(normalizedAbilityText)) {
      return [];
    }

    const nextSteps: OracleEffectStep[] = [];
    let changed = false;
    for (const step of ability.steps) {
      if (isClueArtifactReminderTailText(String(step.raw || ''))) {
        changed = true;
        continue;
      }

      if (isReminderGrantStaticAbilityStep(step)) {
        changed = true;
        continue;
      }

      if (step.kind !== 'unknown') {
        nextSteps.push(step);
        continue;
      }

      if (mentionsRoleToken && isRoleTokenReminderText(String(step.raw || ''))) {
        changed = true;
        continue;
      }

      if (isStaticMyriadReminderText(String(step.raw || ''))) {
        const metadataSteps = Array.isArray((step as any).steps) ? ((step as any).steps as readonly OracleEffectStep[]) : [];
        const parsedMyriad = metadataSteps.length > 0 ? [...metadataSteps] : [parseMyriadTokenCreationMetadataStep(String(step.raw || ''))].filter(Boolean) as unknown as OracleEffectStep[];
        if (parsedMyriad.length > 0) {
          nextSteps.push({
            kind: 'grant_static_ability',
            target: parseObjectSelector('this creature'),
            abilities: ['myriad'],
            duration: 'static',
            raw: String(step.raw || 'myriad'),
            steps: parsedMyriad,
          });
        }
        changed = true;
        continue;
      }

      if (/^20\s*\|\s*copy\s+that\s+spell\.\s+you\s+may\s+choose\s+new\s+targets\s+for\s+the\s+copy$/i.test(String(step.raw || '').trim())) {
        nextSteps.push({
          kind: 'grant_static_ability',
          target: parseObjectSelector('die result copy mode'),
          effectText: [String(step.raw || '').trim()],
          duration: 'static',
          raw: String(step.raw || '').trim(),
        } as unknown as OracleEffectStep);
        changed = true;
        continue;
      }

      if (isStrictReminderOrPlatformOnlyTextForPruning(String(step.raw || ''))) {
        changed = true;
        continue;
      }

      if (/^if\s+you\s+do,\s+look\s+at\s+the\s+top\s+two\s+cards\s+of\s+your\s+library$/i.test(String(step.raw || '').trim())) {
        nextSteps.push({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'you do' },
          steps: [{ kind: 'look_top', who: { kind: 'you' }, amount: { kind: 'number', value: 2 }, raw: 'look at the top two cards of your library' }],
          raw: String(step.raw || ''),
        } as unknown as OracleEffectStep);
        changed = true;
        continue;
      }

      nextSteps.push(step);
    }
    if (!changed) return [ability];
    if (nextSteps.length === 0) return [];
    return [{ ...ability, steps: nextSteps }];
  });
}

