// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: reminder-only ability prunes for crew, champion, and the late keyword reminder pass.
//
// Public entry points:
//   pruneRedundantCrewReminderAbilities
//   pruneRedundantChampionReminderAbilities
//   pruneLateKeywordReminderOnlyAbilities

import type { OracleIRAbility } from './oracleIR';
import { normalizeReminderStepRaw } from './oracleIRParserPostprocessKeywordReminderPrunes';
import { normalizeOracleText } from './oracleIRParserUtils';

export function pruneRedundantCrewReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const normalizedAbilityText = (ability: OracleIRAbility): string => normalizeOracleText(
    String(ability.text || ability.effectText || '')
  )
    .replace(/\s+/g, ' ')
    .trim();

  const isUnknownOnlyAbility = (ability: OracleIRAbility): boolean => (
    ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown')
  );

  const isCrewKeywordOnlyAbility = (ability: OracleIRAbility): boolean => {
    const normalizedText = normalizedAbilityText(ability);
    if (!/^crew\s+\d+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText)) return false;
    if (ability.steps.length === 0) return true;
    return ability.steps.every(
      (step) =>
        step.kind === 'unknown'
        || step.kind === 'grant_static_ability'
        || step.kind === 'conditional',
    );
  };

  const isCrewReminderLeadAbility = (ability: OracleIRAbility): boolean => (
    (isUnknownOnlyAbility(ability) || isCrewKeywordOnlyAbility(ability))
    && /^crew\s+\d+\s*\(/i.test(normalizedAbilityText(ability))
  );

  const isCrewReminderTailAbility = (ability: OracleIRAbility): boolean => {
    if (!isUnknownOnlyAbility(ability)) return false;

    const normalizedText = normalizedAbilityText(ability).toLowerCase();
    return (
      /^this (?:vehicle|token) becomes an artifact creature until end of turn[.)]*$/i.test(normalizedText) ||
      /^creatures can't be attached to other permanents[.)]*$/i.test(normalizedText)
    );
  };

  const nextAbilities: OracleIRAbility[] = [];
  let pruningCrewReminderTail = false;

  for (const ability of abilities) {
    const normalizedText = normalizedAbilityText(ability);

    if (/^saddle\s+\d+\s*\(/i.test(normalizedText) && /\bbecomes saddled\b/i.test(normalizedText)) {
      continue;
    }

    if (isCrewKeywordOnlyAbility(ability)) {
      pruningCrewReminderTail = /^crew\s+\d+\s*\(/i.test(normalizedText) && !/\)\s*$/i.test(normalizedText);
      continue;
    }

    if (isCrewReminderLeadAbility(ability)) {
      pruningCrewReminderTail = !/\)\s*$/i.test(normalizedText);
      continue;
    }

    if (pruningCrewReminderTail && isCrewReminderTailAbility(ability)) {
      pruningCrewReminderTail = !/\)\s*$/i.test(normalizedText);
      continue;
    }

    pruningCrewReminderTail = false;
    nextAbilities.push(ability);
  }

  return nextAbilities;
}

export function pruneRedundantChampionReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const normalizedAbilityText = (ability: OracleIRAbility): string => normalizeOracleText(
    String(ability.text || ability.effectText || '')
  )
    .replace(/\s+/g, ' ')
    .trim();

  const isUnknownOnlyAbility = (ability: OracleIRAbility): boolean => (
    ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown')
  );

  const isChampionReminderLeadAbility = (ability: OracleIRAbility): boolean => (
    isUnknownOnlyAbility(ability) && /^champion\s+.+?\s*\(/i.test(normalizedAbilityText(ability))
  );

  const isChampionReminderTailAbility = (ability: OracleIRAbility): boolean => {
    if (!isUnknownOnlyAbility(ability)) return false;

    const normalizedText = normalizedAbilityText(ability).toLowerCase();
    return (
      /^when this (?:creature|permanent) leaves the battlefield, that card returns to the battlefield[.)]*$/i.test(normalizedText) ||
      /^when this leaves the battlefield, that card returns to the battlefield[.)]*$/i.test(normalizedText)
    );
  };

  const nextAbilities: OracleIRAbility[] = [];
  let pruningChampionReminderTail = false;

  for (const ability of abilities) {
    const normalizedText = normalizedAbilityText(ability);

    if (isChampionReminderLeadAbility(ability)) {
      pruningChampionReminderTail = !/\)\s*$/i.test(normalizedText);
      continue;
    }

    if (pruningChampionReminderTail && isChampionReminderTailAbility(ability)) {
      pruningChampionReminderTail = !/\)\s*$/i.test(normalizedText);
      continue;
    }

    pruningChampionReminderTail = false;
    nextAbilities.push(ability);
  }

  return nextAbilities;
}

export function pruneLateKeywordReminderOnlyAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities
    .flatMap((ability) => {
      const sourceText = String(ability.text || '').trim() === 'Token creation metadata'
        ? String(ability.effectText || '')
        : String(ability.text || ability.effectText || '');
      const originalText = sourceText.trim();
      const normalizedText = normalizeOracleText(sourceText)
        .replace(/\s+/g, ' ')
        .trim();

      const isUnknownOnlyAbility = ability.steps.length === 0 || ability.steps.every((step) => step.kind === 'unknown');
      // Keyword lines often lower into grant_static_ability (+ optional "If you do" conditional
      // reminder tails) after parenthetical stripping; still prune those reminder-only abilities.
      const isStructuredKeywordReminderAbility = ability.steps.length > 0 && ability.steps.every((step) => {
        if (step.kind === 'unknown' || step.kind === 'grant_static_ability') return true;
        if (step.kind === 'conditional') {
          const raw = String(step.raw || '').trim();
          return /^if you do,/i.test(raw);
        }
        return false;
      });

      const withoutCommanderEligibility = ability.steps.filter((step) => {
        if (step.kind !== 'unknown') return true;
        const normalizedStep = normalizeReminderStepRaw(step);
        return !/^.+\s+can be your commander[.)]*$/i.test(normalizedStep);
      });
      if (withoutCommanderEligibility.length !== ability.steps.length) {
        return withoutCommanderEligibility.length > 0 ? [{ ...ability, steps: withoutCommanderEligibility }] : [];
      }

      if (/\bdredge\s+\d+(?:\s*\(if you would draw a card\b)?/i.test(normalizedText)) {
        const dredgeStartIndex = ability.steps.findIndex((step) => {
          if (step.kind === 'grant_static_ability') {
            const granted = Array.isArray((step as any).abilities) ? (step as any).abilities : [];
            return granted.some((entry: unknown) => /^dredge\s+\d+$/i.test(String(entry || '')))
              || /^dredge\s+\d+$/i.test(String(step.raw || ''));
          }
          if (step.kind !== 'unknown') return false;
          return /^dredge\s+\d+(?:\s*\(if you would draw a card\b)?/i.test(
            normalizeReminderStepRaw(step)
          );
        });

        if (dredgeStartIndex >= 0) {
          // Keep the grant_static_ability itself. Only the reminder tail ("If you would draw a
          // card, you may mill... return this card") is platform boilerplate.
          const nextSteps = ability.steps.filter((step, index) => {
            if (index < dredgeStartIndex) return true;
            if (step.kind === 'grant_static_ability') return true;
            if (step.kind === 'unknown') {
              return !/^dredge\s+\d+(?:\s*\(if you would draw a card\b)?/i.test(normalizeReminderStepRaw(step));
            }
            const normalizedRaw = normalizeReminderStepRaw(step as any);
            return !/^(?:if you do,\s*)?return this card from your graveyard to your hand$/i.test(normalizedRaw);
          });
          return nextSteps.length > 0 ? [{ ...ability, steps: nextSteps }] : [];
        }

        // Standalone "Dredge N" after reminder stripping is a real keyword grant, not pruneable
        // reminder. Unknown-only leftovers of the parenthetical still drop.
      }

      if (/^warp\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText)) {
        return [];
      }

      if (
        /^plot\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
        /^flanking\s*\(/i.test(normalizedText)
      ) {
        return [];
      }

      if (
        /^umbra armor(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
        /^whenever another creature enters, you may move a \+1\/\+1 counter from this creature onto it[.)]*$/i.test(normalizedText)
      ) {
        return [];
      }

      if (/^squad\b.*$/i.test(normalizedText)) {
        return [];
      }

      if (/^when this creature enters, if x is 5 or more, draw a card[.)]*$/i.test(normalizedText)) {
        return [];
      }

      if (/^ravenous(?:\s*\(.*)?[.)]*$/i.test(normalizedText)) {
        return [];
      }

      if (/^this permanent \(this creature enters with x \+1\/\+1 counters on it\. if x is 5 or more, draw a card when it enters\.?(?:\))?[.)]*$/i.test(normalizedText)) {
        return [];
      }

      if (
        (ability.steps.length === 0 || ability.steps.every((step) => step.kind === 'unknown')) &&
        /^x can't be 0\. activate only during your turn\b/i.test(normalizedText)
      ) {
        return [];
      }

      const isPrunableKeywordReminderAbility = isUnknownOnlyAbility || isStructuredKeywordReminderAbility;

      if (
        isPrunableKeywordReminderAbility && (
          /^choose a background(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^.+\s+can be your commander[.)]*$/i.test(normalizedText) ||
          /^ascend(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^banding(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^bargain(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^bloodthirst\s+\d+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^bushido\s+\d+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^conspire(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^crew\s+\d+[.)]*$/i.test(normalizedText) ||
          /^cipher(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^delve(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^doctor(?:'|’)s companion(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^dash\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^this permanent\s+\d+\s*\(if an opponent was dealt damage this turn, this creature enters with a \+1\/\+1 counter on it\.?(?:\))?[.)]*$/i.test(normalizedText) ||
          /^enlist(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^evoke\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^aggressive(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^graft\s+\d+\s*\(this creature enters with .+? \+1\/\+1 counters? on it[.)]*$/i.test(normalizedText) ||
          /^hideaway\s+\d+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^improvise(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^modular\s+\d+(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^poison modular\s+\d+(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^offspring\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^overload\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^plot\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^mutate\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^whenever another creature enters, you may move a \+1\/\+1 counter from this creature onto it[.)]*$/i.test(normalizedText) ||
          /^phasing(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^saddle\s+\d+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^ravenous(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^shadow(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^split second(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^spree(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^station(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^squad\b.*$/i.test(normalizedText) ||
          /^umbra armor(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^unleash(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^sunburst(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^vanishing\s+\d+(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^wither(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^splice(?:\s+onto\s+.+?)?\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^partner(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^changeling(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^infect(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^fear(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^start your engines!?[.)]*$/i.test(normalizedText) ||
          /^attach this permanent to target creature you control(?:\.\s*activate only as a sorcery)?[.)]*$/i.test(normalizedText) ||
          /^reconfigure\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^aftermath(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^skulk(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^horsemanship(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^enchant (?:permanent|artifact(?: or creature)?|artifact|creature(?: you control)?|land|player)[.)]*$/i.test(normalizedText) ||
          /^do this only once each turn[.)]*$/i.test(normalizedText)
        )
      ) {
        return [];
      }

      if (
        isUnknownOnlyAbility &&
        /^as this saga enters and after your draw step, add a lore counter/i.test(normalizedText)
      ) {
        return [];
      }

      const hasFaceDownMove = ability.steps.some(
        (step) => step.kind === 'move_zone' && step.to === 'battlefield' && step.entersFaceDown === true
      );
      if (!hasFaceDownMove) return [ability];

      const nextSteps = ability.steps.filter((step) => {
        if (step.kind !== 'unknown') return true;
        const normalizedStep = normalizeReminderStepRaw(step);
        return !/^turn it face up any time for its mana cost if it(?:'|’)s a creature card$/i.test(normalizedStep);
      });

      return nextSteps.length === ability.steps.length ? [ability] : [{ ...ability, steps: nextSteps }];
    });
}

