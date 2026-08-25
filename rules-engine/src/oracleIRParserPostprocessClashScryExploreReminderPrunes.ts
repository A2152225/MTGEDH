// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: reminder-text prunes and small lowerings for clash, scry, look-top reorder, explore, bestow, self-entry counters, enters-tapped, infect, coin flip, and landwalk.
//
// Public entry points:
//   pruneRedundantClashReminderUnknownAbilities
//   pruneRedundantScryReminderUnknownAbilities
//   pruneRedundantLookTopReorderUnknownAbilities
//   pruneRedundantExploreReminderAbilities
//   pruneMalformedExploreReminderMoveZoneSteps
//   pruneRedundantBestowReminderUnknownAbilities
//   lowerSelfEntryCounterReplacementAbilities
//   pruneRedundantEntersTappedReplacementUnknownAbilities
//   pruneRedundantInfectKeywordUnknownAbilities
//   pruneRedundantCoinFlipLeadUnknownAbilities
//   pruneRedundantLandwalkKeywordUnknownAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeReminderStepRaw } from './oracleIRParserPostprocessKeywordReminderPrunes';
import { isUnknownOnlyAbility } from './oracleIRParserPostprocessUnknownAbilityPredicates';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseQuantity } from './oracleIRParserUtils';
import { AbilityType } from './oracleTextParser';

function isRedundantClashReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^each clashing player reveals the top card of their library$/i.test(normalized) ||
    /^then puts that card on their choice of the top or bottom$/i.test(normalized) ||
    /^a player wins if their card had a greater mana value$/i.test(normalized)
  );
}

function isRedundantClashReminderUnknownAbility(ability: OracleIRAbility): boolean {
  if (!isUnknownOnlyAbility(ability)) return false;

  const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (normalizedText && isRedundantClashReminderUnknownStep({ kind: 'unknown', raw: normalizedText })) {
    return true;
  }

  const normalizedStepRaws = ability.steps
    .map((step) => normalizeOracleText(String(step.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim())
    .filter(Boolean);

  return normalizedStepRaws.length > 0 && normalizedStepRaws.every((raw) =>
    isRedundantClashReminderUnknownStep({ kind: 'unknown', raw })
  );
}

export function pruneRedundantClashReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const hasClashStep = abilities.some((ability) => ability.steps.some((step) => step.kind === 'clash'));
  if (!hasClashStep) return [...abilities];

  return abilities
    .map((ability) => {
      const nextSteps = ability.steps.filter(step => !isRedundantClashReminderUnknownStep(step));
      return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
    })
    .filter((ability) => !isRedundantClashReminderUnknownAbility(ability));
}

function isRedundantScryReminderUnknownStep(step: OracleEffectStep): boolean {
  if (!step || (step.kind !== 'unknown' && step.kind !== 'look_top')) return false;
  if (step.kind === 'look_top' && !/^\s*\(/.test(String(step.raw || ''))) return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^look at the top (?:card|[a-z0-9-]+ cards?) of your library$/i.test(normalized) ||
    /^to scry\s+[^,]+, look at the top (?:card|[a-z0-9-]+ cards?) of your library$/i.test(normalized) ||
    /^to scry\s+[^,]+, look at the top (?:card|[a-z0-9-]+ cards?) of your library, (?:you may put that card on the bottom|then put any number of them on the bottom(?: of your library)? and the rest on top in any order)$/i.test(normalized) ||
    /^you may put that card on the bottom$/i.test(normalized) ||
    /^(?:then\s+)?put any number of them on the bottom(?: of your library)? and the rest on top in any order$/i.test(normalized)
  );
}

function isRedundantScryReminderUnknownAbility(ability: OracleIRAbility): boolean {
  if (!isUnknownOnlyAbility(ability)) return false;

  const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (normalizedText && isRedundantScryReminderUnknownStep({ kind: 'unknown', raw: normalizedText })) {
    return true;
  }

  const normalizedStepRaws = ability.steps
    .map((step) => normalizeOracleText(String(step.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim())
    .filter(Boolean);

  return normalizedStepRaws.length > 0 && normalizedStepRaws.every((raw) =>
    isRedundantScryReminderUnknownStep({ kind: 'unknown', raw })
  );
}

export function pruneRedundantScryReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const hasScryStep = abilities.some((ability) => ability.steps.some((step) => step.kind === 'scry'));
  if (!hasScryStep) return [...abilities];

  return abilities
    .map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantScryReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
    })
    .filter((ability) => !isRedundantScryReminderUnknownAbility(ability));
}

function isRedundantLookTopReorderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  return /^(?:then\s+)?put (?:them|those cards|it|that card) back in any order$/i.test(normalized);
}

export function pruneRedundantLookTopReorderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const hasTopLibraryInfo = ability.steps.some((step) => step.kind === 'look_top' || step.kind === 'reveal_top');
    if (!hasTopLibraryInfo) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantLookTopReorderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantExploreReminderStep(step: OracleEffectStep): boolean {
  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  if (step.kind === 'unknown') {
    return (
      /^reveal the top card of your library$/i.test(normalized) ||
      /^to have (?:this creature|that creature|it) explore, reveal the top card of your library$/i.test(normalized) ||
      /^otherwise, put a \+1\/\+1 counter on this creature$/i.test(normalized) ||
      /^then repeat this process$/i.test(normalized)
    );
  }

  if (step.kind === 'conditional') {
    const normalizedCondition = normalizeOracleText(String(step.condition.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim();

    return (
      /^put that card into your hand if it(?:'|’)s a land$/i.test(normalized) &&
      /^it(?:'|’)s a land$/i.test(normalizedCondition)
    );
  }

  if (step.kind === 'add_counter') {
    return /^(?:otherwise,\s*)?put a \+1\/\+1 counter on this creature$/i.test(normalized);
  }

  if (step.kind === 'reveal_top' && /^\s*\(/.test(String(step.raw || ''))) {
    return /^reveal the top card of your library$/i.test(normalized);
  }

  if (step.kind === 'move_zone') {
    return /^(?:then\s+)?put the card back or put it into your graveyard$/i.test(normalized);
  }

  return false;
}

function isRedundantExploreReminderOnlyAbility(ability: OracleIRAbility): boolean {
  const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();

  if (ability.steps.length === 0) {
    return (
      /reveal the top card of your library/i.test(normalizedText) &&
      /put that card into your hand if it(?:'|’)s a land/i.test(normalizedText)
    );
  }

  return ability.steps.every((step) => isRedundantExploreReminderStep(step));
}

export function pruneRedundantExploreReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const hasExploreStep = abilities.some((ability) =>
    ability.steps.some(
      (step) =>
        step.kind === 'explore' ||
        (step.kind === 'grant_static_ability' && /\bexplore\b/i.test(String(step.raw || step.keyword || '')))
    )
  );
  if (!hasExploreStep) return [...abilities];

  return abilities
    .map((ability) => {
      const nextSteps = ability.steps.filter((step) => !isRedundantExploreReminderStep(step));
      return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
    })
    .filter((ability) => !isRedundantExploreReminderOnlyAbility(ability));
}

export function pruneMalformedExploreReminderMoveZoneSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: ability.steps.filter((step) => {
      if (step.kind !== 'move_zone' || step.what.kind !== 'raw') return true;
      const what = String(step.what.text || '').trim().toLowerCase();
      if (what === 'the card back or put it') return false;
      const normalized = normalizeOracleText(String(step.raw || ''))
        .replace(/^[()\s]+/, '')
        .replace(/[.)\s]+$/g, '')
        .trim()
        .toLowerCase();
      return !/^then put the card back or put it into your graveyard$/.test(normalized);
    }),
  }));
}

function isRedundantBestowReminderUnknownStep(step: OracleEffectStep): boolean {
  if (!step) return false;

  if (step.kind === 'conditional') {
    const normalized = normalizeOracleText(String(step.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim();
    return /^it becomes a creature again if it(?:'|’)?s not attached$/i.test(normalized);
  }

  if (step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return /^it becomes a creature again if it(?:'|’)s not attached$/i.test(normalized);
}

export function pruneRedundantBestowReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter((step) => !isRedundantBestowReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function parseSelfEntryCounterReplacement(rawText: string): {
  readonly counter: string;
  readonly amount: ReturnType<typeof parseQuantity>;
  readonly raw: string;
} | null {
  const normalized = normalizeOracleText(String(rawText || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return null;

  const shortMatch = normalized.match(/^with\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+on\s+(?:it|him|her)$/i);
  const fullMatch = normalized.match(
    /^(?:this\s+[^.;]+?|it)\s+enters(?: the battlefield)?\s+with\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+on\s+(?:it|him|her)$/i
  );
  const match = shortMatch || fullMatch;
  if (!match) return null;

  const amount = parseQuantity(String(match[1] || '').trim());
  if (amount.kind !== 'number' && amount.kind !== 'x') return null;

  const counter = normalizeCounterName(String(match[2] || '').trim());
  if (!counter) return null;

  return {
    counter,
    amount,
    raw: String(rawText || '').trim() || normalized,
  };
}

export function lowerSelfEntryCounterReplacementAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type !== AbilityType.REPLACEMENT) return ability;

    const parsed = parseSelfEntryCounterReplacement(String(ability.effectText || ability.text || ''));
    if (!parsed) return ability;

    const hasAddCounterStep = ability.steps.some((step) => step.kind === 'add_counter');
    let removedMatchingUnknown = false;
    const nextSteps = ability.steps.filter((step) => {
      if (step.kind !== 'unknown') return true;
      if (!parseSelfEntryCounterReplacement(String(step.raw || ''))) return true;
      removedMatchingUnknown = true;
      return false;
    });

    if (hasAddCounterStep) {
      return removedMatchingUnknown ? { ...ability, steps: nextSteps } : ability;
    }

    return {
      ...ability,
      steps: [
        ...nextSteps,
        {
          kind: 'add_counter',
          target: { kind: 'raw', text: 'this permanent' },
          counter: parsed.counter,
          amount: parsed.amount,
          raw: parsed.raw,
        },
      ],
    };
  });
}

function isRedundantEntersTappedReplacementUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  return (
    /^tapped$/i.test(normalized) ||
    /^tapped unless you control two or fewer other lands$/i.test(normalized) ||
    /^tapped unless you control two or more other lands$/i.test(normalized) ||
    /^tapped unless a player has 13 or less life$/i.test(normalized) ||
    /^tapped unless you control two or more basic lands$/i.test(normalized) ||
    /^tapped unless you have two or more opponents$/i.test(normalized)
  );
}

export function pruneRedundantEntersTappedReplacementUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type !== AbilityType.REPLACEMENT) return ability;

    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/[.)\s]+$/g, '')
      .trim();
    if (!/\benters(?: the battlefield)? tapped(?: unless you control two or fewer other lands| unless you control two or more other lands| unless a player has 13 or less life| unless you control two or more basic lands| unless you have two or more opponents)?$/i.test(normalizedText)) {
      return ability;
    }

    const nextSteps = ability.steps.filter((step) => !isRedundantEntersTappedReplacementUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function pruneRedundantInfectKeywordUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/[.)\s]+$/g, '')
      .trim();
    if (!/^infect(?:\s*\(this creature deals damage to creatures in the form of -1\/-1 counters and to players in the form of poison counters)?$/i.test(normalizedText)) {
      return ability;
    }

    const nextSteps = ability.steps.filter((step) => {
      if (step.kind !== 'unknown') return true;
      const normalized = normalizeOracleText(String(step.raw || ''))
        .replace(/[.)\s]+$/g, '')
        .trim();
      return !/^infect(?:\s*\(this creature deals damage to creatures in the form of -1\/-1 counters and to players in the form of poison counters)?$/i.test(normalized);
    });
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantCoinFlipLeadUnknownStep(step: OracleEffectStep | undefined): boolean {
  if (step?.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.)\s]+$/g, '')
    .trim();
  return /^flip a coin$/i.test(normalized);
}

function isCoinFlipConditionalStep(step: OracleEffectStep | undefined): boolean {
  if (step?.kind !== 'conditional') return false;

  const normalized = normalizeOracleText(String(step.condition?.raw || ''))
    .replace(/[.)\s]+$/g, '')
    .trim();
  return normalized === 'you win the flip' || normalized === 'you lose the flip';
}

export function pruneRedundantCoinFlipLeadUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!isRedundantCoinFlipLeadUnknownStep(ability.steps[0])) return ability;
    if (!ability.steps.slice(1).some((step) => isCoinFlipConditionalStep(step))) return ability;
    return {
      ...ability,
      steps: ability.steps.slice(1),
    };
  });
}

function isRedundantLandwalkKeywordText(text: string | undefined): boolean {
  const normalized = normalizeOracleText(String(text || ''))
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (
    /^(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)\s*\(this creature can't be blocked as long as defending player controls an? (?:plains|island|swamp|mountain|forest)$/i.test(
      normalized
    )
  ) {
    return true;
  }

  return /^(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)(?:,\s*(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk))*$/i.test(
    normalized
  );
}

export function pruneRedundantLandwalkKeywordUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!isRedundantLandwalkKeywordText(String(ability.text || ability.effectText || ''))) {
      return ability;
    }

    const nextSteps = ability.steps.filter((step) => {
      if (step.kind !== 'unknown') return true;
      return !isRedundantLandwalkKeywordText(step.raw);
    });
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

