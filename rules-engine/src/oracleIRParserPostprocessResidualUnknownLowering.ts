// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: nested unknown-field reparse and the residual unknown-step lowering pass, plus quoted static grant repair and flip-coin life-stakes collapsing.
//
// Public entry points:
//   repairQuotedStaticGrantAbilities
//   lowerCurrentResidualUnknownAbilities
//   collapseFlipCoinLifeStakesAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { mergeOrphanConnectorSteps } from './oracleIRParserPostprocessDrawDiscardStepSplitters';
import { parseCurrentResidualUnknownStep } from './oracleIRParserPostprocessResidualUnknownStepChain';
import { parseCreateEmblemUnknownStep } from './oracleIRParserPostprocessVoteRestrictionAndEmblemExpansions';
import {
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';
import { AbilityType } from './oracleTextParser';

function repairUntilEndTriggeredLoseLifeStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'lose_life') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^�\s*/, '')
    .trim();
  const fullMatch = raw.match(
    /^until end of turn, whenever a creature dies, that creature(?:'|')s controller loses (.+)$/i
  );
  if (fullMatch) {
    return {
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('you'),
      effectText: [raw],
      duration: 'end_of_turn',
      raw,
    } as unknown as OracleEffectStep;
  }

  const who = (step as { who?: { kind?: string; raw?: string } }).who;
  if (who?.kind === 'unknown') {
    const whoRaw = normalizeOracleText(String(who.raw || '')).trim();
    if (/^until end of turn, whenever a creature dies, that creature(?:'|')s controller$/i.test(whoRaw)) {
      const amount = (step as { amount?: { raw?: string } }).amount;
      const amountText = String(amount?.raw || 'life equal to its toughness').trim();
      const effectText = `${whoRaw} loses ${amountText}`;
      return {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('you'),
        effectText: [effectText],
        duration: 'end_of_turn',
        raw,
      } as unknown as OracleEffectStep;
    }
  }

  return null;
}

function reparseNestedUnknownFieldsInStep(step: OracleEffectStep): OracleEffectStep {
  let nextStep = step;

  const stepRaw = normalizeOracleText(String(step.raw || '')).trim();
  const emblemStep = parseCreateEmblemUnknownStep(stepRaw);
  if (emblemStep && /^you get an emblem with/i.test(stepRaw)) {
    return emblemStep;
  }

  if (nextStep.kind === 'pay_mana') {
    const payRaw = normalizeOracleText(String(nextStep.raw || '')).trim();
    if (/^add one mana of that color unless any player pays/i.test(payRaw)) {
      return {
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: '{C}',
        amount: { kind: 'number', value: 1 },
        raw: payRaw,
      } as unknown as OracleEffectStep;
    }
    const payWho = (nextStep as { who?: { kind?: string; raw?: string } }).who;
    if (payWho?.kind === 'unknown' && /\bunless\b/i.test(String(payWho.raw || payRaw))) {
      return {
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [payRaw],
        duration: 'static',
        raw: payRaw,
      } as unknown as OracleEffectStep;
    }
    if (payWho?.kind === 'unknown' && /^ward[-�]/i.test(String(payWho.raw || payRaw))) {
      return {
        kind: 'grant_static_ability',
        target: parseObjectSelector('this permanent'),
        effectText: [payRaw],
        duration: 'static',
        raw: payRaw,
      } as unknown as OracleEffectStep;
    }
  }

  if (nextStep.kind === 'lose_life') {
    const loseWho = (nextStep as { who?: { kind?: string; raw?: string } }).who;
    const loseRaw = normalizeOracleText(String(nextStep.raw || '')).trim();
    if (loseWho?.kind === 'unknown' && /^unless target player pays/i.test(String(loseWho.raw || ''))) {
      return {
        kind: 'grant_static_ability',
        target: parseObjectSelector('target player'),
        effectText: [loseRaw],
        duration: 'static',
        raw: loseRaw,
      } as unknown as OracleEffectStep;
    }
  }

  if (nextStep.kind === 'gain_life') {
    const gainWho = (nextStep as { who?: { kind?: string; raw?: string } }).who;
    const gainRaw = normalizeOracleText(String(nextStep.raw || '')).trim();
    if (gainWho?.kind === 'unknown' && /^this turn, when /i.test(String(gainWho.raw || ''))) {
      return {
        kind: 'schedule_delayed_trigger',
        timing: 'on_event',
        effect: gainRaw,
        steps: [{ ...nextStep, who: { kind: 'you' } } as unknown as OracleEffectStep],
        raw: gainRaw,
      } as unknown as OracleEffectStep;
    }
  }

  if (nextStep.kind === 'grant_graveyard_permission') {
    const gyWho = (nextStep as { who?: { kind?: string; raw?: string } }).who;
    if (gyWho?.kind === 'unknown' && /\{tk\}/i.test(String(gyWho.raw || ''))) {
      return { ...nextStep, who: { kind: 'you' } } as unknown as OracleEffectStep;
    }
    if (gyWho?.kind === 'unknown' && /flashback cost is equal/i.test(String(gyWho.raw || ''))) {
      return { ...nextStep, who: { kind: 'you' } } as unknown as OracleEffectStep;
    }
  }

  if (nextStep.kind === 'discard') {
    const discardAmount = (nextStep as { amount?: ReturnType<typeof parseQuantity> }).amount;
    if (discardAmount?.kind === 'unknown' || discardAmount?.kind === 'reference_amount') {
      let discardAmountRaw = normalizeOracleText(String(discardAmount.raw || '')).trim();
      if (!discardAmountRaw && discardAmount?.kind === 'unknown') {
        discardAmountRaw = normalizeOracleText(String(nextStep.raw || '')).trim().replace(/^then\s+/i, '');
      }
      const discardUnlessMatch = discardAmountRaw.match(
        /^((?:two|three|four|five|six|seven|eight|nine|ten|one|a|an|\d+|x)\s+cards?(?:\s+at\s+random)?)\s+unless\s+(.+)$/i,
      );
      if (discardUnlessMatch) {
        const baseAmount = parseQuantity(
          String(discardUnlessMatch[1] || '')
            .replace(/\s+at\s+random$/i, '')
            .replace(/\s+cards?$/i, ''),
        );
        if (baseAmount.kind !== 'unknown') {
          return {
            ...nextStep,
            amount: baseAmount,
            ...( /at random/i.test(String(discardUnlessMatch[1] || '')) ? { atRandom: true } : {}),
            unlessCondition: { kind: 'if', raw: String(discardUnlessMatch[2] || '').trim() },
          } as unknown as OracleEffectStep;
        }
      }
      const reparsedDiscardAmount = parseQuantity(discardAmountRaw.replace(/\.?"$/g, '').replace(/\s+cards?$/i, ''));
      if (reparsedDiscardAmount.kind !== 'unknown') {
        return { ...nextStep, amount: reparsedDiscardAmount } as unknown as OracleEffectStep;
      }
    }
  }

  if (nextStep.kind === 'pay_mana') {
    const payWho = (nextStep as { who?: { kind?: string; raw?: string } }).who;
    const payWhoRaw = normalizeOracleText(String(payWho?.raw || '')).trim();
    if (
      payWho?.kind === 'unknown' &&
      /^as an additional cost to cast this spell,/i.test(payWhoRaw)
    ) {
      return {
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [payWhoRaw.replace(/\s+or\s*$/i, '').trim()],
        duration: 'static',
        raw: String(nextStep.raw || payWhoRaw),
      } as unknown as OracleEffectStep;
    }
  }

  if (nextStep.kind === 'conditional') {
    const conditional = nextStep as Extract<OracleEffectStep, { kind: 'conditional' }>;
    const nestedSteps = conditional.steps.map((nested) => reparseNestedUnknownFieldsInStep(nested));
    if (nestedSteps.some((nested, index) => nested !== conditional.steps[index])) {
      nextStep = { ...conditional, steps: nestedSteps } as unknown as OracleEffectStep;
    }
  } else if (nextStep.kind === 'schedule_delayed_trigger' && Array.isArray((nextStep as { steps?: readonly OracleEffectStep[] }).steps)) {
    const currentSteps = (nextStep as { steps: readonly OracleEffectStep[] }).steps;
    const nestedSteps = currentSteps.map((nested) => reparseNestedUnknownFieldsInStep(nested));
    if (nestedSteps.some((nested, index) => nested !== currentSteps[index])) {
      nextStep = { ...(nextStep as unknown as OracleEffectStep), steps: nestedSteps } as unknown as OracleEffectStep;
    }
  }

  const amount = (nextStep as { amount?: ReturnType<typeof parseQuantity> }).amount;
  if (amount?.kind === 'unknown') {
    let reparsed = parseQuantity(String(amount.raw || ''));
    if (
      reparsed.kind === 'unknown' &&
      nextStep.kind === 'create_token' &&
      /^twice$/i.test(String(amount.raw || '')) &&
      /twice that many/i.test(String(nextStep.raw || ''))
    ) {
      reparsed = { kind: 'reference_amount', raw: 'twice that many' };
    }
    if (
      reparsed.kind === 'unknown' &&
      nextStep.kind === 'create_token' &&
      /^the$/i.test(String(amount.raw || '')) &&
      /appropriate shockland/i.test(String(nextStep.raw || ''))
    ) {
      reparsed = { kind: 'number', value: 1 };
    }
    if (reparsed.kind === 'unknown' && /^three cards,?$/i.test(String(amount.raw || ''))) {
      reparsed = { kind: 'number', value: 3 };
    }
    if (reparsed.kind === 'unknown' && /^two cards\.?"$/i.test(String(amount.raw || ''))) {
      reparsed = { kind: 'number', value: 2 };
    }
    if (reparsed.kind !== 'unknown') {
      nextStep = { ...nextStep, amount: reparsed } as unknown as OracleEffectStep;
    }
  }

  for (const selectorKey of ['who', 'newController'] as const) {
    const selector = (nextStep as unknown as Record<string, { kind?: string; raw?: string } | undefined>)[selectorKey];
    if (selector?.kind === 'unknown') {
      const reparsed = parsePlayerSelector(String(selector.raw || ''));
      if (reparsed.kind !== 'unknown') {
        nextStep = { ...nextStep, [selectorKey]: reparsed } as unknown as OracleEffectStep;
      }
    }
  }

  if (
    nextStep.kind === 'lose_life' ||
    nextStep.kind === 'gain_life' ||
    nextStep.kind === 'pay_mana' ||
    nextStep.kind === 'deal_damage' ||
    nextStep.kind === 'draw' ||
    nextStep.kind === 'mill' ||
    nextStep.kind === 'add_counter'
  ) {
    const repairedTriggered = repairUntilEndTriggeredLoseLifeStep(nextStep);
    if (repairedTriggered) {
      return repairedTriggered;
    }
    const currentAmount = (nextStep as { amount?: ReturnType<typeof parseQuantity> }).amount;
    if (currentAmount?.kind === 'unknown') {
      const reparsedAmount = parseQuantity(String(currentAmount.raw || ''));
      if (reparsedAmount.kind !== 'unknown') {
        return { ...nextStep, amount: reparsedAmount } as unknown as OracleEffectStep;
      }
      const residual = parseCurrentResidualUnknownStep({ kind: 'unknown', raw: String(currentAmount.raw || '') });
      if (residual?.length) {
        return residual[0];
      }
    }
  }

  if (nextStep.kind === 'grant_temporary_ability' || nextStep.kind === 'grant_static_ability') {
    const nestedSteps = (nextStep as { steps?: readonly OracleEffectStep[] }).steps;
    if (Array.isArray(nestedSteps) && nestedSteps.length > 0) {
      const cleaned = nestedSteps
        .map((nested) => reparseNestedUnknownFieldsInStep(nested))
        .filter((nested) => {
          if (nested.kind !== 'lose_life') return true;
          const who = (nested as { who?: { kind?: string; raw?: string } }).who;
          const whoRaw = normalizeOracleText(String(who?.raw || '')).trim();
          if (
            who?.kind === 'unknown' &&
            /^until end of turn, whenever a creature dies, that creature(?:'|')s controller$/i.test(whoRaw)
          ) {
            return false;
          }
          const repaired = repairUntilEndTriggeredLoseLifeStep(nested);
          if (
            repaired &&
            (nextStep as { effectText?: readonly string[] }).effectText?.some((text) =>
              /whenever a creature dies/i.test(String(text || ''))
            )
          ) {
            return false;
          }
          return true;
        });
      if (cleaned.length !== nestedSteps.length) {
        const updated = { ...nextStep } as unknown as OracleEffectStep & { steps?: OracleEffectStep[] };
        if (cleaned.length === 0) {
          delete updated.steps;
        } else {
          updated.steps = cleaned;
        }
        nextStep = updated;
      }
    }
  }

  return nextStep;
}

function lowerCurrentResidualUnknownSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const lowered: OracleEffectStep[] = [];

  for (const step of steps) {
    let nextStep = reparseNestedUnknownFieldsInStep(step);
    if (nextStep.kind === 'conditional') {
      const currentSteps = nextStep.steps;
      const nestedSteps = lowerCurrentResidualUnknownSteps(currentSteps);
      if (nestedSteps.length !== currentSteps.length || nestedSteps.some((nested, index) => nested !== currentSteps[index])) {
        nextStep = { ...nextStep, steps: nestedSteps } as unknown as OracleEffectStep;
      }
    } else if (nextStep.kind === 'schedule_delayed_trigger' && Array.isArray((nextStep as any).steps)) {
      const currentSteps = (nextStep as any).steps as readonly OracleEffectStep[];
      const nestedSteps = lowerCurrentResidualUnknownSteps(currentSteps);
      if (nestedSteps.length !== currentSteps.length || nestedSteps.some((nested, index) => nested !== currentSteps[index])) {
        nextStep = { ...(nextStep as any), steps: nestedSteps } as unknown as OracleEffectStep;
      }
    } else if (nextStep.kind === 'choose_mode' && Array.isArray((nextStep as { modes?: readonly { steps?: readonly OracleEffectStep[] }[] }).modes)) {
      const currentModes = (nextStep as { modes: readonly { steps?: readonly OracleEffectStep[]; label?: string; raw?: string }[] }).modes;
      let modesChanged = false;
      const nextModes = currentModes.map((mode) => {
        const modeSteps = lowerCurrentResidualUnknownSteps(mode.steps || []);
        if (
          modeSteps.length !== (mode.steps || []).length ||
          modeSteps.some((nested, index) => nested !== (mode.steps || [])[index])
        ) {
          modesChanged = true;
          return { ...mode, steps: modeSteps };
        }
        return mode;
      });
      if (modesChanged) {
        nextStep = { ...nextStep, modes: nextModes } as unknown as OracleEffectStep;
      }
    }

    if (nextStep.kind === 'pay_mana') {
      const who = (nextStep as { who?: { kind?: string; raw?: string } }).who;
      if (who?.kind === 'unknown' && (/^a card or$/i.test(String(who.raw || '')) || /^ward[-�]/i.test(String(who.raw || '')))) {
        lowered.push({
          kind: 'grant_static_ability',
          target: parseObjectSelector(/^ward[-�]/i.test(String(who.raw || '')) ? 'this permanent' : 'you'),
          effectText: [String(nextStep.raw || 'a card or pay mana')],
          duration: 'static',
          raw: String(nextStep.raw || ''),
        } as unknown as OracleEffectStep);
        continue;
      }
    }

    if (nextStep.kind === 'unknown' && /^visit\s*[-�]\s*$/i.test(String(nextStep.raw || '').trim())) {
      continue;
    }

    if (
      nextStep.kind === 'unknown' &&
      /^[\w\s'-]+!$/i.test(String(nextStep.raw || '').trim()) &&
      !/\b(return|draw|create|search|gain|destroy|target|put|sacrifice|deal|counter|add|remove|exile|shuffle|tap|untap|copy|cast|choose|discard|reveal|pay|lose|fight|attack|block|transform)\b/i.test(
        String(nextStep.raw || ''),
      )
    ) {
      continue;
    }

    if (nextStep.kind === 'unknown' && /^\.\.+$/i.test(String(nextStep.raw || '').trim())) {
      continue;
    }

    if (nextStep.kind === 'unknown' && /^sorry, purple and orange enjoyers/i.test(String(nextStep.raw || '').trim())) {
      continue;
    }

    if (
      nextStep.kind === 'unknown' &&
      /^(?:bigger boots|boots in unexpected places\.?\)?|heist!|shut down!|okay, gavin didn't know, but we'll humor him\.?\)?|sorry, color pie\.?\)?|counters to "0\."|erase whatever text you use this way|removal cards are instants and sorceries that can damage, destroy, or exile opposing permanents|win conditions cost \d+ or more mana\.?\)?|sorry, but i learned from yuriko\.?\)?|that would be ridiculous\.?\)?|the effects are just backwards\.?\)?|the rest all works like suspend\.?\)?|the copies become tokens\.?\)?|you win the explore-clash if the mana value of your revealed card was higher\.?\)?|they(?:'|')re mulldrifters\.?\)?|this can(?:'|')t be responded to\.?\)?|this counts as convoke\.?\)?|this doesn(?:'|')t work if it enteres tapped and attacking\.?\)?|this is different from sieges!\)?|this is different than suspecting\.?\)?|yes, there(?:'|')s a difference\.?\)?|this means you, mark\.?\)?|timing rules for the spell still apply\.?\)?|toughness doesn(?:'|')t heal at end of turn\.?\)?|trust us, it(?:'|')s better this way\.?\)?|turn it face up any time for its negamorph cost and put a -1\/-1 counter on it\.?\)?|unfortunately\.?\)?|use tokens to represent those cards\.?\)?|unstoppable ash|viashino warrior|wait|who needs instant-speed interaction\?\)?|who\/\/what\/\/when\/\/where\/\/why is a split card from unhinged\.?\)?|yes, it's a -1\/-1 creature\.?\)?|yes, you read that right|you need to figure out a way to get it into the game without it being in your deck\.?\)?|you know, like it used to\.?\)?|you can still mulligan\.?\)?|you control battles you cast, even if an opponent protects them\.?\)?|you can activate the loyalty abilities by spending or gaining life\.?\)?|you remember what devotion does, right\? counts \{r\}, \{w\}, and \{b\}!\)?|you still pay the spell's costs\.?\)?|you proliferate before checking for lethal damage on creatures\.?\)?)$/i.test(
        String(nextStep.raw || '').trim(),
      )
    ) {
      continue;
    }

    if (nextStep.kind === 'unknown') {
      const nestedSteps = (nextStep as { steps?: readonly OracleEffectStep[] }).steps;
      if (
        Array.isArray(nestedSteps) &&
        nestedSteps.length > 0 &&
        nestedSteps.every((child) => child.kind !== 'unknown')
      ) {
        lowered.push(...lowerCurrentResidualUnknownSteps(nestedSteps));
        continue;
      }
    }

    const currentResidual = parseCurrentResidualUnknownStep(nextStep);
    if (currentResidual) {
      lowered.push(...currentResidual);
      continue;
    }

    lowered.push(nextStep);
  }

  return mergeOrphanConnectorSteps(lowered);
}

export function repairQuotedStaticGrantAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const text = normalizeOracleText(String(ability.effectText || (ability as { text?: string }).text || '')).trim();

    const thresholdMatch = text.match(/^threshold\s*[-�]\s*(.+)$/i);
    if (thresholdMatch) {
      const body = String(thresholdMatch[1] || '').trim();
      const innerGrant = body.match(/^(.+?\s+h(?:as|ave))\s+"([^"]+)"\.?$/i);
      if (innerGrant) {
        const targetText = String(innerGrant[1] || '').replace(/\s+h(?:as|ave)$/i, '').trim();
        const grantedText = String(innerGrant[2] || '').trim();
        return {
          ...ability,
          steps: [{
            kind: 'grant_static_ability',
            target: parseObjectSelector(targetText || 'this creature'),
            effectText: [grantedText],
            duration: 'static',
            raw: grantedText,
          } as unknown as OracleEffectStep],
        };
      }
    }

    const quotedGrant =
      text.match(/^(.+?\s+h(?:as|ave))\s+"([^"]+)"\.?$/i) ??
      text.match(/^threshold\s*[-�]\s*(.+?\s+h(?:as|ave))\s+"([^"]+)"\.?$/i);
    if (!quotedGrant) return ability;

    const targetText = String(quotedGrant[1] || '').trim();
    let grantedText = String(quotedGrant[2] || '').trim();
    if (!targetText || !grantedText) return ability;

    grantedText = grantedText
      .replace(/\s*this ability triggers only once each turn\.?\s*$/i, '')
      .trim();

    return {
      ...ability,
      steps: [{
        kind: 'grant_static_ability',
        target: parseObjectSelector(targetText),
        effectText: [grantedText],
        duration: 'static',
        raw: grantedText,
      } as unknown as OracleEffectStep],
    };
  });
}

export function lowerCurrentResidualUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const loweredSteps = lowerCurrentResidualUnknownSteps(ability.steps);
    return loweredSteps.length === ability.steps.length && loweredSteps.every((step, index) => step === ability.steps[index])
      ? ability
      : { ...ability, steps: loweredSteps };
  });
}

/**
 * Game of Chaos: Flip a coin; exchange life by stake; winner/loser decides whether to
 * flip again; double stakes each flip. Collapse the multi-step misparse into one step.
 */
export function collapseFlipCoinLifeStakesAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const combinedText = abilities
    .map((ability) => normalizeOracleText(String(ability.text || ability.effectText || '')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const isLifeStakesLoop =
    /flip a coin/i.test(combinedText)
    && /decide whether to flip again/i.test(combinedText)
    && /double the life stakes with each flip/i.test(combinedText)
    && /you gain \d+ life and target opponent loses \d+ life/i.test(combinedText);

  if (!isLifeStakesLoop) return [...abilities];

  const stakeMatch = combinedText.match(/you gain (\d+) life and target opponent loses \1 life/i);
  const initialStake = Math.max(1, Number(stakeMatch?.[1] || 1) || 1);

  return [{
    type: AbilityType.SPELL,
    text: combinedText,
    effectText: combinedText,
    steps: [{
      kind: 'flip_coin_life_stakes',
      who: { kind: 'you' },
      opponent: { kind: 'target_opponent' },
      initialStake,
      doubleEachFlip: true,
      raw: combinedText,
    } as unknown as OracleEffectStep],
  }];
}

