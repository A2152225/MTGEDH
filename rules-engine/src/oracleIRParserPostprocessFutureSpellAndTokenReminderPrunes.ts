// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: future-spell unknown-step expansion plus reminder prunes for artifact tokens, token designations, Eldrazi mana tokens, decayed, enchant/protection auras, hidden agenda, and timing rules.
//
// Public entry points:
//   expandFutureSpellEffectUnknownAbilities
//   pruneRedundantArtifactTokenReminderUnknownAbilities
//   pruneRedundantTokenDesignationReminderUnknownAbilities
//   pruneRedundantEldraziTokenManaReminderUnknownAbilities
//   pruneRedundantDecayedReminderUnknownAbilities
//   pruneRedundantEnchantAttachmentReminderUnknownAbilities
//   pruneRedundantProtectionAuraReminderUnknownAbilities
//   pruneRedundantHiddenAgendaRevealUnknownAbilities
//   pruneRedundantTimingRulesReminderUnknownAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import {
  isArtifactTokenReminderLeadUnknownStep,
  isArtifactTokenReminderTailUnknownStep,
  normalizeUnknownStepText,
} from './oracleIRParserPostprocessCopySpellTailHelpers';
import { normalizeOracleText } from './oracleIRParserUtils';

function normalizeFutureSpellUnknownStepText(step: OracleEffectStep | undefined): string {
  if (!step || (step.kind !== 'unknown' && step.kind !== 'add_counter' && step.kind !== 'grant_static_ability' && step.kind !== 'grant_temporary_ability')) return '';
  return normalizeOracleText(String(step.raw || ''))
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/g, '')
    .trim();
}

export function expandFutureSpellEffectUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps: OracleEffectStep[] = [];
    let changed = false;

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      const normalizedStep = normalizeFutureSpellUnknownStepText(step);

      if (
        normalizedStep &&
        /^spells you control can(?:not|'t) be countered by blue or black spells this turn, and creatures you control can(?:not|'t) be the targets? of blue or black spells this turn$/i.test(normalizedStep)
      ) {
        changed = true;
        nextSteps.push({
          kind: 'grant_future_spell_effect',
          who: { kind: 'you' },
          duration: 'this_turn',
          scope: 'all_qualifying_spells',
          counterImmunity: { counterSourceColors: ['U', 'B'] },
          raw: "Spells you control can't be countered by blue or black spells this turn",
        });
        nextSteps.push({
          kind: 'grant_temporary_ability',
          target: { kind: 'raw', text: 'creatures you control' },
          duration: 'this_turn',
          effectText: ["can't be the targets of blue or black spells this turn"],
          raw: "Creatures you control can't be the targets of blue or black spells this turn",
        });
        continue;
      }

      const firstSavageClause = normalizedStep;
      const secondSavageClause = normalizeFutureSpellUnknownStepText(ability.steps[index + 1] as unknown as OracleEffectStep);
      const thirdSavageClause = normalizeFutureSpellUnknownStepText(ability.steps[index + 2] as unknown as OracleEffectStep);
      if (
        firstSavageClause &&
        secondSavageClause &&
        thirdSavageClause &&
        /^the next creature spell you cast this turn can be cast as though it had flash$/i.test(firstSavageClause) &&
        /^that spell can(?:not|'t) be countered$/i.test(secondSavageClause) &&
        /^that creature enters with an additional \+1\/\+1 counter on it$/i.test(thirdSavageClause)
      ) {
        changed = true;
        nextSteps.push({
          kind: 'grant_future_spell_effect',
          who: { kind: 'you' },
          duration: 'this_turn',
          scope: 'next_qualifying_spell',
          spellFilter: { cardTypes: ['creature'] },
          timingPermission: 'as_though_flash',
          counterImmunity: { unconditional: true },
          castedPermanentEntersWithCounters: { '+1/+1': 1 },
          raw: `${String((ability.steps[index] as any)?.raw || '').trim()}. ${String((ability.steps[index + 1] as any)?.raw || '').trim()}. ${String((ability.steps[index + 2] as any)?.raw || '').trim()}`,
        });
        index += 2;
        continue;
      }

      nextSteps.push(step);
    }

    return changed ? { ...ability, steps: nextSteps } : ability;
  });
}

function isRedundantArtifactTokenReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^(?:(?:it(?:'|’)s|it is)|(?:an?\s+[a-z0-9 ,.'’-]+?\s+token\s+is))\s+an artifact with\s+"[^"]+"$/i.test(normalized) ||
    /^(?:they(?:'|’)re|they are)\s+artifacts with\s+"[^"]+"$/i.test(normalized) ||
    // Residue left when the "(It's an artifact" lead of a Treasure/Clue reminder is consumed upstream
    // but its quoted ability tail is split off into its own step.
    /^with\s+"[^"]+"$/i.test(normalized)
  );
}

function isRedundantArtifactTokenReminderParsedStep(step: OracleEffectStep): boolean {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)"”\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return /^(?:search your library for a basic land card|put it onto the battlefield tapped|shuffle)$/i.test(normalized);
}

function isArtifactTokenReminderContextUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return (
    /\binvestigate(?:s)?\b/i.test(normalized) ||
    /\bcreate(?:s)?\b.*\b(?:clue|food|blood|treasure|gold|powerstone|junk|map|mutagen|lander)\s+tokens?\b/i.test(normalized)
  );
}

export function pruneRedundantArtifactTokenReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedAbilityText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown');

    // A granted ability ("...gains \"When this creature dies, ... create a Treasure token.\"") creates the
    // token inside a grant step rather than a create_token step, so the ability text is checked too.
    const mentionsArtifactTokenCreation =
      /\bcreates?\b[^.]*\b(?:clue|food|blood|treasure|gold|powerstone|junk|map|mutagen|lander)\s+tokens?\b/i.test(
        normalizedAbilityText
      );
    if (!mentionsArtifactTokenCreation && !ability.steps.some(
      (step) =>
        step.kind === 'create_token' ||
        step.kind === 'investigate' ||
        isArtifactTokenReminderContextUnknownStep(step)
    )) {
      return [ability];
    }

    const hasSplitReminderLead = ability.steps.some(isArtifactTokenReminderLeadUnknownStep);
    const hasInvestigateStep = ability.steps.some((candidate) => candidate.kind === 'investigate');
    const mentionsJunkToken = /\bjunk tokens?\b/i.test(normalizedAbilityText);
    const mentionsLanderToken = /\blander tokens?\b/i.test(normalizedAbilityText);
    const nextSteps = ability.steps.filter(step => {
      if (
        hasInvestigateStep &&
        step.kind === 'create_token' &&
        String((step as any).token || '').trim().toLowerCase() === 'clue'
      ) {
        return false;
      }
      if (isRedundantArtifactTokenReminderUnknownStep(step)) return false;
      if ((hasSplitReminderLead || mentionsLanderToken) && isRedundantArtifactTokenReminderParsedStep(step)) return false;
      if (hasSplitReminderLead && isArtifactTokenReminderLeadUnknownStep(step)) return false;
      if (hasSplitReminderLead && isArtifactTokenReminderTailUnknownStep(step)) return false;
      if (mentionsJunkToken && step.kind === 'unknown' && /^you may play that card this turn$/i.test(normalizeUnknownStepText(step))) return false;
      if (
        mentionsJunkToken &&
        step.kind === 'grant_exile_permission' &&
        /^you may play that card this turn$/i.test(normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim())
      ) {
        return false;
      }
      return true;
    });
    return nextSteps.length === ability.steps.length ? [ability] : [{ ...ability, steps: nextSteps }];
  });
}

function isTokenDesignationStaticGrantStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_static_ability') return false;

  const effectText = Array.isArray((step as any).effectText) ? (step as any).effectText : [];
  return effectText.some((text) => normalizeOracleText(String(text || '')).trim().toLowerCase() === 'are tokens');
}

function isRedundantTokenDesignationReminderUnknownStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^(?:they(?:'|’)re|they are) considered tokens for spells and abilities$/i.test(normalized) ||
    /^after a creature leaves the battlefield, it ceases to exist[.)]*$/i.test(normalized)
  );
}

export function pruneRedundantTokenDesignationReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some(isTokenDesignationStaticGrantStep)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantTokenDesignationReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantEldraziTokenManaReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = step.kind === 'unknown'
    ? normalizeUnknownStepText(step)
    : normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim();
  if (!normalized) return false;

  return /^(?:it has|they have) "sacrifice this (?:token|creature): add \{c\}\."$/i.test(normalized);
}

function isEldraziManaTokenCreateStep(step: OracleEffectStep): boolean {
  return step.kind === 'create_token' && /\beldrazi (?:scion|spawn)\b/i.test(String(step.token || ''));
}

export function pruneRedundantEldraziTokenManaReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some(isEldraziManaTokenCreateStep)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantEldraziTokenManaReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantDecayedAttackSacrificeReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^when it attacks, sacrifice it at end of combat[.)]*$/i.test(normalized);
}

function isDecayedTokenCreateStep(step: OracleEffectStep): boolean {
  return step.kind === 'create_token' && /\bwith decayed\b/i.test(String(step.raw || ''));
}

function isDecayedGrantStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_temporary_ability' && step.kind !== 'grant_static_ability') return false;
  const abilities = Array.isArray((step as any).abilities) ? (step as any).abilities : [];
  const effectText = Array.isArray((step as any).effectText) ? (step as any).effectText : [];
  return [...abilities, ...effectText, String((step as any).raw || '')].some((value) => /\bdecayed\b/i.test(String(value || '')));
}

export function pruneRedundantDecayedReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const mentionsDecayed = /\bdecayed\b/i.test(String(ability.text || ability.effectText || ''));
    if (!mentionsDecayed && !ability.steps.some((step) => isDecayedTokenCreateStep(step) || isDecayedGrantStep(step))) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantDecayedAttackSacrificeReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantEnchantAttachmentReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^this card enters attached to that creature[.)]*$/i.test(normalized);
}

export function pruneRedundantEnchantAttachmentReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!/^enchant\b/i.test(normalizedText)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantEnchantAttachmentReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantProtectionAuraReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^this effect does(?:n't| not) remove this aura[.)]*$/i.test(normalized);
}

export function pruneRedundantProtectionAuraReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!/\bprotection from\b/i.test(normalizedText) || !/\baura\b/i.test(normalizedText)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantProtectionAuraReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantTimingRulesReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^timing rules still apply[.)]*$/i.test(normalized);
}

function isRedundantHiddenAgendaRevealUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^you may turn this conspiracy face up any time and reveal that name[.)]*$/i.test(normalized);
}

export function pruneRedundantHiddenAgendaRevealUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!/^hidden agenda\b/i.test(normalizedText)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantHiddenAgendaRevealUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function pruneRedundantTimingRulesReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter((step) => !isRedundantTimingRulesReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

