// Extracted from rules-engine/src/oracleIRParser.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParser.ts: intervening-if wrapping plus additional-combat and split choose-mode ability merges.
//
// Public entry points:
//   wrapTriggeredInterveningIfAbility
//   mergeAdditionalCombatContinuationAbilities
//   mergeExileUntilFollowupAbilities
//   mergeSplitChooseModeParsedAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeOracleText } from './oracleIRParserUtils';
import type { OracleTextParseResult, ParsedAbility } from './oracleTextParser';
import { AbilityType } from './oracleTextParser';

export function wrapTriggeredInterveningIfAbility(ability: OracleIRAbility): OracleIRAbility {
  const interveningIf = String(ability.interveningIf || '').trim();
  if (ability.type !== AbilityType.TRIGGERED || !interveningIf) return ability;
  return {
    ...ability,
    steps: [
      {
        kind: 'conditional',
        condition: { kind: 'if', raw: interveningIf },
        steps: [...ability.steps],
        raw: `If ${interveningIf}, ${ability.effectText}`,
      },
    ],
  };
}

export function mergeAdditionalCombatContinuationAbilities(abilities: OracleIRAbility[]): OracleIRAbility[] {
  if (abilities.length < 2) return abilities;
  const merged: OracleIRAbility[] = [];

  for (const ability of abilities) {
    const steps = [...ability.steps];
    const isAdditionalCombatContinuation =
      (ability.type === AbilityType.STATIC || ability.type === AbilityType.SPELL) &&
      steps.length > 0 &&
      steps.every((step) => step.kind === 'add_extra_combat') &&
      /^\s*(?:after|and after)\s+(?:this\s+phase|this\s+main\s+phase|this\s+combat\s+phase|the\s+second\s+main\s+phase\s+this\s+turn)\b/i.test(ability.effectText || ability.text || '');

    if (isAdditionalCombatContinuation && merged.length > 0) {
      const previous = merged[merged.length - 1];
      merged[merged.length - 1] = {
        ...previous,
        text: [previous.text, ability.text].filter(Boolean).join(' '),
        effectText: [previous.effectText, ability.effectText].filter(Boolean).join(' '),
        steps: [...previous.steps, ...steps],
      };
      continue;
    }

    merged.push(ability);
  }

  return merged.length === abilities.length ? abilities : merged;
}

function isExileUntilStep(step: OracleEffectStep | undefined): boolean {
  if (!step || (step.kind !== 'exile_top' && step.kind !== 'impulse_exile_top')) return false;
  const raw = normalizeOracleText(String((step as { amount?: { raw?: string } }).amount?.raw || step.raw || ''));
  return /\buntil (?:they|you) exile\b/i.test(raw);
}

function isAssimilateReminderUnknown(step: OracleEffectStep): boolean {
  if (step.kind !== 'unknown' && step.kind !== 'grant_static_ability') return false;
  const raw = normalizeOracleText(String(step.raw || (step as { effectText?: unknown }).effectText || ''));
  return /it(?:'s| is) a .+ and loses all other creature types/i.test(raw) || /to assimilate a card/i.test(raw);
}

function isExileUntilFollowupStep(step: OracleEffectStep): boolean {
  if (isAssimilateReminderUnknown(step)) return true;
  const raw = normalizeOracleText(String(step.raw || ''));
  if ((step as { battlefieldAssimilate?: boolean }).battlefieldAssimilate) return true;
  if (/^assimilate\s+(?:that card|it)$/i.test(raw)) return true;
  if (step.kind === 'move_zone') {
    const what = String((step as { what?: { text?: string } }).what?.text || '').trim().toLowerCase();
    if (what === 'that card' || what === 'it' || what === 'the rest' || what === 'the rest of the exiled cards') return true;
  }
  return /^(?:they|that player|that opponent|its controller|the defending player|you)\s+puts?\s+the rest on the bottom/i.test(raw);
}

function isExileUntilFollowupAbility(ability: OracleIRAbility): boolean {
  if (ability.type === AbilityType.TRIGGERED || ability.type === AbilityType.STATIC || ability.type === AbilityType.ACTIVATED) return false;
  if (String(ability.triggerCondition || '').trim()) return false;
  const steps = ability.steps || [];
  return steps.length > 0 && steps.every(isExileUntilFollowupStep);
}

/** Fold "Assimilate that card. They put the rest on the bottom..." back onto an exile-until trigger. */
export function mergeExileUntilFollowupAbilities(abilities: OracleIRAbility[]): OracleIRAbility[] {
  if (abilities.length < 2) return abilities;
  const merged: OracleIRAbility[] = [];
  for (const ability of abilities) {
    const previous = merged[merged.length - 1];
    const previousSteps = previous?.steps || [];
    if (previous && isExileUntilStep(previousSteps[previousSteps.length - 1]) && isExileUntilFollowupAbility(ability)) {
      const followupSteps = (ability.steps || []).filter((step) => !isAssimilateReminderUnknown(step));
      merged[merged.length - 1] = {
        ...previous,
        text: [previous.text, ability.text].filter(Boolean).join(' '),
        effectText: [previous.effectText, ability.effectText].filter(Boolean).join(' '),
        steps: [...previousSteps, ...followupSteps],
      };
      continue;
    }
    merged.push(ability);
  }
  return merged.length === abilities.length ? abilities : merged;
}

export function mergeSplitChooseModeParsedAbilities(parsed: OracleTextParseResult): OracleTextParseResult {
  const merged: ParsedAbility[] = [];

  for (let index = 0; index < parsed.abilities.length; index += 1) {
    const current = parsed.abilities[index];
    const currentText = String(current.text || '').trim();
    const isPWorthHeader = /^choose\s+up\s+to\s+\w+\s*\{P\}\s*worth\s+of\s+modes\b/i.test(currentText);
    const chooseHeaderPattern =
      /choose\s+(?:one\s+or\s+both|one\s+or\s+more|one|two|three|four|up\s+to\s+\w+|any\s+number)/i;
    // When newlines have been collapsed to spaces (audit paths do this), a saga chapter prefix hides
    // the header at the start of the line and the first bullet is glued onto it:
    // "I, II, III - Choose one at random - • Combine Powers! - ...".
    // The same collapse hides the header behind any lead-in, not just a saga chapter: a reflexive
    // trigger does it too ("you may sacrifice another creature. When you do, choose two - • Create...").
    const chooseHeaderMatch = isPWorthHeader ? null : currentText.match(chooseHeaderPattern);
    const headerHasInlineBullet =
      chooseHeaderMatch !== null &&
      currentText.slice((chooseHeaderMatch.index ?? 0) + chooseHeaderMatch[0].length).search(/[\u2022•]/) >= 0;
    if (
      !isPWorthHeader &&
      !headerHasInlineBullet &&
      !/^choose\s+(?:one\s+or\s+both|one\s+or\s+more|one|two|three|four|up\s+to\s+\w+|any\s+number)/i.test(currentText)
    ) {
      merged.push(current);
      continue;
    }

    const modeAbilities: ParsedAbility[] = [];
    // The first mode lives inside the header when bullets were inlined, so tails seen before any
    // bullet ability belong to the header rather than to a preceding mode.
    let headerTailText = currentText;
    let nextIndex = index + 1;
    while (nextIndex < parsed.abilities.length) {
      const next = parsed.abilities[nextIndex];
      const nextText = String(next.text || '').trim();
      const isBulletMode = /^[\u2022•\uFFFD]/.test(nextText);
      const isPMode = /^\{P\}/i.test(nextText);
      if (isPWorthHeader ? isPMode : isBulletMode) {
        modeAbilities.push(next);
        nextIndex += 1;
        continue;
      }
      // Season `{P}` modes are often sentence-split ("Choose artifact…. Destroy all…"), as are
      // bullet modes whose newlines were collapsed ("• Defense! - Put a shield counter…. You gain 3 life.").
      // Fold non-mode tails into the preceding mode line before breaking the block.
      if (
        (isPWorthHeader || headerHasInlineBullet) &&
        (modeAbilities.length > 0 || headerHasInlineBullet) &&
        nextText &&
        !/^(?:choose\s+up\s+to|when|whenever|at\s+the)\b/i.test(nextText)
      ) {
        if (modeAbilities.length === 0) {
          headerTailText = `${headerTailText} ${nextText}`.trim();
          nextIndex += 1;
          continue;
        }
        const previous = modeAbilities[modeAbilities.length - 1];
        const combinedModeText = `${String(previous.text || '').trim()} ${nextText}`.trim();
        modeAbilities[modeAbilities.length - 1] = {
          ...previous,
          text: combinedModeText,
          effect: combinedModeText,
        };
        nextIndex += 1;
        continue;
      }
      break;
    }

    if (modeAbilities.length === 0) {
      merged.push(current);
      continue;
    }

    const combinedText = [headerTailText, ...modeAbilities.map((ability) => String(ability.text || '').trim())]
      .filter(Boolean)
      .join('\n');
    const combinedTargets = Array.from(new Set(modeAbilities.flatMap((ability) => ability.targets || [])));

    merged.push({
      type: current.type || AbilityType.STATIC,
      text: combinedText,
      effect: combinedText,
      ...(combinedTargets.length > 0 ? { targets: combinedTargets } : {}),
      ...(current.requiresChoice ? { requiresChoice: current.requiresChoice } : {}),
    });
    index = nextIndex - 1;
  }

  return merged.length === parsed.abilities.length ? parsed : { ...parsed, abilities: merged, hasModes: true };
}

